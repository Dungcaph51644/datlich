-- Run after the existing booking migrations. Codes remain single-use.
begin;

-- Use the same lock as code issuance/activation. Extend still-valid legacy
-- codes to 60 days from issuance without reviving expired or consumed codes.
-- The function definition is the upgrade marker, so rerunning adds no time.
do $$
declare definition text;
begin
  perform private.booking_lock();
  definition:=pg_get_functiondef('public.issue_booking_code(uuid,boolean)'::regprocedure);
  if position('interval ''7 days''' in definition)>0 then
    update private.booking_invites
    set expires_at=expires_at+interval '53 days'
    where expires_at>now();
  end if;
end $$;

create or replace function public.issue_booking_code(p_member_id uuid,p_revoke_existing boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare code text:=replace(gen_random_uuid()::text,'-',''); expires timestamptz:=now()+interval '60 days';
begin
  perform private.require_admin(); perform private.booking_lock();
  if not exists(select 1 from public.members where id=p_member_id and active) then raise exception 'Thành viên không còn hoạt động.'; end if;
  if p_revoke_existing then delete from private.booking_devices where member_id=p_member_id; end if;
  insert into private.booking_invites values(p_member_id,encode(sha256(convert_to(code,'UTF8')),'hex'),expires)
  on conflict(member_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at;
  perform private.booking_log('identity_code_issued',jsonb_build_array(jsonb_build_object('member_id',p_member_id)),'Cấp mã dùng một lần; không ghi mã vào lịch sử.');
  return jsonb_build_object('code',code,'member_id',p_member_id,'expires_at',expires);
end;
$$;

notify pgrst,'reload schema';
commit;
