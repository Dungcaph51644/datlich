-- Run AFTER 202611090001_initial.sql. Existing data and admin accounts are retained.
-- Trusted-group mode: names/attendance are public and a visitor may choose a
-- member. Administrative mutations still require the existing admin login.
begin;

grant select on public.members, public.attendance, public.session_roster to anon;
drop policy if exists quick_members_read on public.members;
drop policy if exists quick_attendance_read on public.attendance;
drop policy if exists quick_roster_read on public.session_roster;
create policy quick_members_read on public.members for select to anon, authenticated using (true);
create policy quick_attendance_read on public.attendance for select to anon, authenticated using (true);
create policy quick_roster_read on public.session_roster for select to anon, authenticated using (true);

create or replace function private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare b jsonb; a jsonb; fields text[]; actor text; quick_member uuid;
begin
  if TG_OP <> 'INSERT' then b := to_jsonb(old); end if;
  if TG_OP <> 'DELETE' then a := to_jsonb(new); end if;
  select array_agg(k order by k) into fields from (
    select key as k from jsonb_object_keys(coalesce(a, b)) as key
    where (a -> key) is distinct from (b -> key)
  ) x;
  if TG_TABLE_NAME = 'sessions' and TG_OP = 'UPDATE' and (fields is null or fields = array['going_count']) then return new; end if;
  quick_member := nullif(current_setting('app.quick_member_id', true), '')::uuid;
  if quick_member is not null then
    select display_name || ' · chọn tên' into actor from public.members where id=quick_member;
  else
    select m.display_name into actor from public.account_links l join public.members m on m.id=l.member_id where l.user_id=auth.uid();
  end if;
  insert into public.audit_log(actor_id,actor_name,action,table_name,record_id,changed_fields,before_data,after_data)
  values(auth.uid(),coalesce(actor,'Quản trị hệ thống'),TG_OP,TG_TABLE_NAME,
    coalesce((a->>'id')::uuid,(b->>'id')::uuid,(a->>'user_id')::uuid,(b->>'user_id')::uuid),coalesce(fields,'{}'),b,a);
  if TG_OP='DELETE' then return old; else return new; end if;
end;
$$;

-- Both authenticated and quick registration use exactly the same validation
-- and row lock. No separate capacity counter in the browser.
create or replace function private.write_attendance(
  p_session_id uuid,p_member_id uuid,p_status text,p_note text,
  p_expected_note_version integer,p_admin boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare s public.sessions; a public.attendance;
begin
  select * into s from public.sessions where id=p_session_id for update;
  if not found then raise exception 'Buổi đánh không tồn tại.'; end if;
  if s.booking_status='cancelled' then raise exception 'Buổi đánh đã hủy, không nhận đăng ký.'; end if;
  if (s.session_date+s.end_time) at time zone 'Asia/Ho_Chi_Minh' <= now() then raise exception 'Buổi đánh đã kết thúc.'; end if;
  if s.deadline is not null and s.deadline<=now() and not p_admin then raise exception 'Đã hết hạn đăng ký. Hãy liên hệ quản trị viên.'; end if;
  if p_status is not null and p_status not in ('going','not_going','unanswered') then raise exception 'Trạng thái không hợp lệ.'; end if;
  if p_status is null and p_note is null then raise exception 'Chưa có thay đổi để lưu.'; end if;
  if not exists(select 1 from public.members where id=p_member_id and active) then raise exception 'Thành viên đã ngừng hoạt động hoặc không tồn tại.'; end if;
  if not exists(select 1 from public.session_roster where session_id=p_session_id and member_id=p_member_id) then raise exception 'Thành viên không thuộc danh sách buổi đánh này.'; end if;
  select * into a from public.attendance where session_id=p_session_id and member_id=p_member_id;
  if p_note is not null and coalesce(a.note_version,0) is distinct from p_expected_note_version then
    raise exception 'Ghi chú đã được sửa trên thiết bị khác. Nội dung đang nhập được giữ lại; hãy chọn bản muốn lưu.' using errcode='40001';
  end if;
  if p_status='going' and coalesce(a.status,'unanswered')<>'going' and s.max_players is not null
    and (select count(*) from public.attendance where session_id=p_session_id and status='going')>=s.max_players then
    raise exception 'Ca/sân này đã đủ người. Vui lòng chọn ca/sân khác.';
  end if;
  if a.id is not null and (p_status is null or p_status=a.status) and (p_note is null or p_note=a.note) then return; end if;
  insert into public.attendance(session_id,member_id,status,note,note_version,updated_at)
  values(p_session_id,p_member_id,coalesce(p_status,'unanswered'),coalesce(p_note,''),case when p_note is null then 0 else 1 end,now())
  on conflict(session_id,member_id) do update set
    status=coalesce(p_status,public.attendance.status),note=coalesce(p_note,public.attendance.note),
    note_version=public.attendance.note_version+case when p_note is null then 0 else 1 end,updated_at=now();
end;
$$;

create or replace function public.set_attendance(p_session_id uuid,p_member_id uuid,p_status text default null,p_note text default null,p_expected_note_version integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare my_member uuid; admin boolean;
begin
  admin:=public.is_admin();
  select l.member_id into my_member from public.account_links l join public.members m on m.id=l.member_id where l.user_id=auth.uid() and m.active;
  if my_member is null or (not admin and my_member<>p_member_id) then raise exception 'Bạn chỉ được sửa đăng ký của chính mình.' using errcode='42501'; end if;
  perform private.write_attendance(p_session_id,p_member_id,p_status,p_note,p_expected_note_version,admin);
end;
$$;

create or replace function public.quick_set_attendance(p_session_id uuid,p_member_id uuid,p_status text default null,p_note text default null,p_expected_note_version integer default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.quick_member_id',p_member_id::text,true);
  perform private.write_attendance(p_session_id,p_member_id,p_status,p_note,p_expected_note_version,false);
end;
$$;

create or replace function private.batch_attendance(p_session_ids uuid[],p_member_id uuid,p_status text,p_admin boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sid uuid; results jsonb:='[]';
begin
  if coalesce(cardinality(p_session_ids),0) not between 1 and 60 then raise exception 'Chọn từ 1 đến 60 ca/sân.'; end if;
  if p_status is null or p_status not in ('going','not_going','unanswered') then raise exception 'Trạng thái không hợp lệ.'; end if;
  -- Stable lock order prevents two overlapping multi-court requests deadlocking.
  for sid in select distinct x from unnest(p_session_ids) x order by x loop
    begin
      perform private.write_attendance(sid,p_member_id,p_status,null,null,p_admin);
      results:=results||jsonb_build_array(jsonb_build_object('session_id',sid,'ok',true));
    exception when others then
      results:=results||jsonb_build_array(jsonb_build_object('session_id',sid,'ok',false,'message',SQLERRM));
    end;
  end loop;
  return results;
end;
$$;
create or replace function public.quick_set_many_attendance(p_session_ids uuid[],p_member_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.quick_member_id',p_member_id::text,true);
  return private.batch_attendance(p_session_ids,p_member_id,p_status,false);
end;
$$;
create or replace function public.set_many_attendance(p_session_ids uuid[],p_member_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare my_member uuid; admin boolean;
begin
  admin:=public.is_admin();
  select l.member_id into my_member from public.account_links l join public.members m on m.id=l.member_id where l.user_id=auth.uid() and m.active;
  if my_member is null or (not admin and my_member<>p_member_id) then raise exception 'Bạn chỉ được sửa đăng ký của chính mình.' using errcode='42501'; end if;
  return private.batch_attendance(p_session_ids,p_member_id,p_status,admin);
end;
$$;

create or replace function public.get_quick_snapshot() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version',1,'sessions',public.get_public_schedule(),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.code) from public.members m),'[]'),
    'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from public.attendance a),'[]'),
    'roster',coalesce((select jsonb_agg(to_jsonb(r)) from public.session_roster r),'[]'));
$$;

create table if not exists public.session_templates(
  id uuid primary key default gen_random_uuid(),
  name text not null unique check(length(trim(name)) between 1 and 100),
  template jsonb not null check(jsonb_typeof(template)='object' and octet_length(template::text)<=12000),
  updated_at timestamptz not null default now()
);
alter table public.session_templates enable row level security;
revoke all on public.session_templates from anon,authenticated;
grant select on public.session_templates to authenticated;
drop policy if exists templates_read on public.session_templates;
create policy templates_read on public.session_templates for select to authenticated using(public.is_admin());
drop trigger if exists audit_templates on public.session_templates;
create trigger audit_templates after insert or update or delete on public.session_templates for each row execute function private.audit_change();

create or replace function public.save_session_template(p_name text,p_template jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare k text; tid uuid;
begin
  perform private.require_admin();
  if p_template is null or jsonb_typeof(p_template)<>'object' then raise exception 'Mẫu lịch không hợp lệ.'; end if;
  for k in select jsonb_object_keys(p_template) loop
    if k not in ('start_time','end_time','venue','court','address','maps_url','organizer_id','max_players','note') then raise exception 'Mẫu lịch chứa trường không hợp lệ.'; end if;
  end loop;
  if coalesce(length(trim(p_template->>'venue')),0) not between 1 and 160 or coalesce(length(trim(p_template->>'court')),0) not between 1 and 80 then raise exception 'Nhập tên sân và ca/sân cho mẫu.'; end if;
  if (p_template->>'start_time')::time is null or (p_template->>'end_time')::time is null or (p_template->>'end_time')::time<=(p_template->>'start_time')::time then raise exception 'Giờ kết thúc phải sau giờ bắt đầu.'; end if;
  insert into public.session_templates(name,template) values(trim(p_name),p_template)
  on conflict(name) do update set template=excluded.template,updated_at=now() returning id into tid;
  return tid;
end;
$$;

revoke execute on function public.quick_set_attendance(uuid,uuid,text,text,integer),public.quick_set_many_attendance(uuid[],uuid,text),public.set_many_attendance(uuid[],uuid,text),public.get_quick_snapshot(),public.save_session_template(text,jsonb) from public,anon,authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
grant execute on function public.quick_set_attendance(uuid,uuid,text,text,integer),public.quick_set_many_attendance(uuid[],uuid,text),public.get_quick_snapshot() to anon,authenticated;
grant execute on function public.set_many_attendance(uuid[],uuid,text),public.save_session_template(text,jsonb) to authenticated;

-- REALTIME: deployment-only block, omitted by local PostgreSQL tests.
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='session_templates') then
    alter publication supabase_realtime add table public.session_templates;
  end if;
end;
$$;
commit;
