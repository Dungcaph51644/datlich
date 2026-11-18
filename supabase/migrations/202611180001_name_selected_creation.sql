-- Run after the existing booking/finance upgrades. Preserve all group data.
-- Trusted-group mode: an active selected name can add sessions and members.
begin;

create or replace function private.require_selected_member(p_member_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform private.booking_lock();
  perform 1 from public.members where id=p_member_id and active for share;
  if not found then
    raise exception 'Hãy chọn một thành viên đang hoạt động trước khi thêm buổi đánh hoặc thành viên.' using errcode='42501';
  end if;
  -- Request-local attribution for existing session, booking and finance triggers.
  -- This does not create an account, device token, or administrative role.
  perform set_config('app.booking_member_id',p_member_id::text,true);
  perform set_config('app.quick_member_id',p_member_id::text,true);
  return p_member_id;
end; $$;
revoke all on function private.require_selected_member(uuid) from public,anon,authenticated;

create or replace function public.quick_create_member(p_member_id uuid,p_patch jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare k text; mid uuid;
begin
  perform private.require_selected_member(p_member_id);
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then
    raise exception 'Thông tin thành viên không hợp lệ.';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('display_name','note','active') then
      raise exception 'Trường thành viên không hợp lệ.';
    end if;
  end loop;
  insert into public.members(display_name,note,active)
  values(trim(p_patch->>'display_name'),coalesce(p_patch->>'note',''),coalesce((p_patch->>'active')::boolean,true))
  returning id into mid;
  return mid;
end; $$;

create or replace function public.quick_create_session(p_member_id uuid,p_patch jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform private.require_selected_member(p_member_id);
  -- Only INSERT is reachable here. Reuse all existing field validation,
  -- weekly assignment, roster, Realtime and automatic fee triggers.
  return private.write_booking_session(null,p_patch,null,p_member_id,true);
end; $$;

revoke all on function public.quick_create_member(uuid,jsonb),public.quick_create_session(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.quick_create_member(uuid,jsonb),public.quick_create_session(uuid,jsonb) to anon,authenticated;

-- The automatic fee trigger previously required an admin login even for an
-- otherwise permitted session INSERT. Public writers validate their caller;
-- the trigger accepts the selected actor only for this request's empty sheet.
do $$
declare target oid; definition text; replacement text;
begin
  target:=to_regprocedure('private.create_session_fee()');
  if target is not null then
    definition:=pg_get_functiondef(target);
    if position('private.require_selected_member' in definition)=0 then
      replacement:=replace(definition,
        'perform private.require_admin();',
        'if nullif(current_setting(''app.quick_member_id'',true),'''') is not null then
    perform private.require_selected_member(nullif(current_setting(''app.quick_member_id'',true),'''')::uuid);
  else
    perform private.require_admin();
  end if;');
      replacement:=replace(replacement,
        'perform private.require_booking_actor(null);',
        'if nullif(current_setting(''app.quick_member_id'',true),'''') is null then
    perform private.require_booking_actor(null);
  end if;');
      if replacement=definition then raise exception 'Không nhận diện được trigger bảng phí; dừng để giữ nguyên dữ liệu.'; end if;
      execute replacement;
    end if;
  end if;
end $$;

-- Selected-name attribution takes precedence over the trigger actor context.
create or replace function private.audit_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; fields text[]; actor text; mid uuid;
begin
  if TG_OP<>'INSERT' then b:=to_jsonb(old); end if;
  if TG_OP<>'DELETE' then a:=to_jsonb(new); end if;
  select array_agg(k order by k) into fields from (select key as k from jsonb_object_keys(coalesce(a,b)) key where (a->key) is distinct from (b->key)) x;
  if TG_TABLE_NAME='sessions' and TG_OP='UPDATE' and (fields is null or fields=array['going_count']) then return new; end if;
  mid:=nullif(current_setting('app.quick_member_id',true),'')::uuid;
  if mid is not null then select display_name||' · chọn tên' into actor from public.members where id=mid;
  else
    mid:=nullif(current_setting('app.booking_member_id',true),'')::uuid;
    if mid is not null then select display_name||' · đã xác minh' into actor from public.members where id=mid;
    else select m.display_name into actor from public.account_links l join public.members m on m.id=l.member_id where l.user_id=auth.uid(); end if;
  end if;
  insert into public.audit_log(actor_id,actor_name,action,table_name,record_id,changed_fields,before_data,after_data)
  values(auth.uid(),coalesce(actor,'Quản trị hệ thống'),TG_OP,TG_TABLE_NAME,coalesce((a->>'id')::uuid,(b->>'id')::uuid,(a->>'user_id')::uuid,(b->>'user_id')::uuid),coalesce(fields,'{}'),b,a);
  if TG_OP='DELETE' then return old; else return new; end if;
end; $$;

notify pgrst,'reload schema';
commit;
