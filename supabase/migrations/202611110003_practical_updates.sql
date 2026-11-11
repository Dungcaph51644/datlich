-- Upgrade in place after finance 003 (and automatic fees 004 when installed).
-- No rows, fee snapshots, receipts, Storage objects or grants are removed.
begin;

do $$
declare target oid; definition text; replacement text;
begin
  target:=to_regprocedure('public.get_activity_snapshot(text)');
  if target is null then
    raise exception 'Cần chạy migration tài chính 202611100003 trước bản cập nhật này.';
  end if;
  definition:=pg_get_functiondef(target);
  if position('coalesce(a.organizer_id=private.booking_actor(p_token),false)' in definition)=0 then
    replacement:=replace(definition,
      'a.organizer_id=private.booking_actor(p_token)',
      'coalesce(a.organizer_id=private.booking_actor(p_token),false)');
    if replacement=definition then
      raise exception 'Không nhận diện được API bảng phí hiện tại; dừng để không ghi đè định nghĩa khác.';
    end if;
    execute replacement;
  end if;
end $$;

-- Only the club's explicit business-version failures become HTTP 409.
-- Real PostgreSQL serialization failures remain untouched. CREATE OR REPLACE
-- keeps each existing function's owner and grants.
do $$
declare target record; definition text; replacement text;
begin
  for target in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f' and (
      (n.nspname='public' and p.proname=any(array[
        'save_member','delete_member','save_session','update_booking_session',
        'set_attendance','quick_set_attendance','request_booking_swap',
        'save_booking_assignment','complete_booking_week','admin_swap_booking_weeks',
        'save_booking_rotation','apply_booking_proposal','save_activity',
        'set_activity_billable','save_activity_expense','set_activity_fee_state',
        'replace_activity_payment','save_trip_participant','save_trip_checklist',
        'create_club_activity'
      ])) or (n.nspname='private' and p.proname=any(array[
        'write_attendance','write_booking_session','finance_version','finance_access'
      ]))
    )
  loop
    definition:=pg_get_functiondef(target.oid);
    replacement:=regexp_replace(definition,'\merrcode\s*=\s*''40001''','errcode=''PT409''','gi');
    if replacement<>definition then execute replacement; end if;
  end loop;
end $$;

-- One request and one shared club payload for the initial read/reconciliation.
-- Reuses the existing identity checks and per-module snapshots.
create or replace function public.get_app_snapshot(p_token text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare booking jsonb; activities jsonb; club jsonb;
begin
  -- The booking snapshot may reconcile expired requests. Allow that existing
  -- behavior and read the activity snapshot after reconciliation is complete.
  booking:=public.get_booking_snapshot(p_token);
  activities:=public.get_activity_snapshot(p_token);
  club:=coalesce(activities->'club',booking->'club');
  return jsonb_build_object(
    'version',1,'practical_updates',true,'club',club,
    'booking',booking-'club','activities',activities-'club'
  );
end $$;
revoke all on function public.get_app_snapshot(text) from public,anon,authenticated;
grant execute on function public.get_app_snapshot(text) to anon,authenticated;

notify pgrst,'reload schema';
commit;
