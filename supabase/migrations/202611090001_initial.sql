-- Run once in Supabase SQL Editor or with `supabase db push`.
create schema if not exists private;
revoke all on schema private from public;
create sequence public.member_code_seq;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('CL-' || lpad(nextval('public.member_code_seq')::text, 4, '0')),
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  note text not null default '' check (length(note) <= 1000),
  active boolean not null default true,
  version integer not null default 1
);
create table public.account_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id uuid not null unique references public.members(id) on delete restrict,
  role text not null default 'member' check (role in ('admin', 'member'))
);
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  venue text not null check (length(trim(venue)) between 1 and 160),
  court text not null check (length(trim(court)) between 1 and 80),
  address text not null default '' check (length(address) <= 500),
  maps_url text not null default '' check (maps_url = '' or maps_url ~ '^https://(www\.)?(google\.[a-z.]+/maps|maps\.google\.[a-z.]+/|maps\.app\.goo\.gl/|goo\.gl/maps)'),
  organizer_id uuid references public.members(id) on delete restrict,
  booking_status text not null default 'pending' check (booking_status in ('pending', 'booked', 'cancelled')),
  max_players integer check (max_players between 1 and 200),
  note text not null default '' check (length(note) <= 2000),
  deadline timestamptz,
  version integer not null default 1,
  going_count integer not null default 0,
  copied_from uuid references public.sessions(id) on delete restrict,
  unique(copied_from, session_date)
);
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,
  status text not null default 'unanswered' check (status in ('going', 'not_going', 'unanswered')),
  note text not null default '' check (length(note) <= 1000),
  note_version integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(session_id, member_id)
);
create index attendance_session_idx on public.attendance(session_id);
create index sessions_date_idx on public.sessions(session_date);
-- Freeze the eligible roster per court/shift so adding future members does not
-- change historical unanswered counts. Unanswered needs no attendance row.
create table public.session_roster (
  session_id uuid not null references public.sessions(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  primary key(session_id, member_id)
);
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_name text not null,
  action text not null,
  table_name text not null,
  record_id uuid not null,
  changed_fields text[] not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create function public.is_linked() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.account_links a join public.members m on m.id = a.member_id where a.user_id = auth.uid() and m.active);
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.account_links a join public.members m on m.id = a.member_id where a.user_id = auth.uid() and a.role = 'admin' and m.active);
$$;
create function private.require_admin() returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Bạn không có quyền quản trị.' using errcode = '42501'; end if;
end;
$$;

alter table public.members enable row level security;
alter table public.account_links enable row level security;
alter table public.sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_log enable row level security;
alter table public.session_roster enable row level security;
create policy members_read on public.members for select to authenticated using (public.is_linked());
create policy account_read on public.account_links for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy sessions_read on public.sessions for select to anon, authenticated using (true);
create policy attendance_read on public.attendance for select to authenticated using (public.is_linked());
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());
create policy roster_read on public.session_roster for select to authenticated using (public.is_linked());
revoke all on public.members, public.account_links, public.sessions, public.attendance, public.audit_log, public.session_roster from anon, authenticated;
grant select on public.sessions to anon, authenticated;
grant select on public.members, public.account_links, public.attendance, public.audit_log, public.session_roster to authenticated;
-- No write policies or table write grants. Only validated RPCs below can mutate data.

create function private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare b jsonb; a jsonb; fields text[]; actor text;
begin
  if TG_OP <> 'INSERT' then b := to_jsonb(old); end if;
  if TG_OP <> 'DELETE' then a := to_jsonb(new); end if;
  select array_agg(k order by k) into fields from (
    select key as k from jsonb_object_keys(coalesce(a, b)) as key
    where (a -> key) is distinct from (b -> key)
  ) x;
  if TG_TABLE_NAME = 'sessions' and TG_OP = 'UPDATE' and (fields is null or fields = array['going_count']) then return new; end if;
  select m.display_name into actor from public.account_links l join public.members m on m.id = l.member_id where l.user_id = auth.uid();
  insert into public.audit_log(actor_id, actor_name, action, table_name, record_id, changed_fields, before_data, after_data)
  values(auth.uid(), coalesce(actor, 'Quản trị hệ thống'), TG_OP, TG_TABLE_NAME, coalesce((a->>'id')::uuid, (b->>'id')::uuid, (a->>'user_id')::uuid, (b->>'user_id')::uuid), coalesce(fields, '{}'), b, a);
  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;
create trigger audit_members after insert or update or delete on public.members for each row execute function private.audit_change();
create trigger audit_sessions after insert or update or delete on public.sessions for each row execute function private.audit_change();
create trigger audit_attendance after insert or update or delete on public.attendance for each row execute function private.audit_change();
create trigger audit_accounts after insert or update or delete on public.account_links for each row execute function private.audit_change();

-- A public session event also refreshes aggregate counts for guests, who cannot
-- subscribe to private attendance rows. No participant identity is published.
create function private.refresh_session_count() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.sessions set going_count=(select count(*) from public.attendance where session_id=coalesce(new.session_id,old.session_id) and status='going') where id=coalesce(new.session_id,old.session_id);
  return null;
end;
$$;
create trigger attendance_count after insert or update or delete on public.attendance for each row execute function private.refresh_session_count();
create function private.refresh_organizer_name() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.display_name is distinct from old.display_name then update public.sessions set version=version where organizer_id=new.id; end if;
  return new;
end;
$$;
create trigger organizer_name after update on public.members for each row execute function private.refresh_organizer_name();

create function private.seed_roster() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_TABLE_NAME = 'sessions' then
    insert into public.session_roster(session_id,member_id) select new.id,id from public.members where active;
  elsif new.active then
    insert into public.session_roster(session_id,member_id)
    select id,new.id from public.sessions where booking_status<>'cancelled'
      and (session_date+end_time) at time zone 'Asia/Ho_Chi_Minh' > now()
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger new_session_roster after insert on public.sessions for each row execute function private.seed_roster();
create trigger new_member_roster after insert or update of active on public.members for each row execute function private.seed_roster();

create function public.get_public_schedule() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
    'organizer_name', coalesce(m.display_name, 'Chưa phân công'),
    'going_count', (select count(*) from public.attendance a where a.session_id = s.id and a.status = 'going')
  ) order by s.session_date, s.start_time), '[]'::jsonb)
  from public.sessions s left join public.members m on m.id = s.organizer_id;
$$;

create function public.save_member(p_id uuid, p_patch jsonb, p_expected_version integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.members; k text;
begin
  perform private.require_admin();
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('display_name', 'note', 'active') then raise exception 'Trường thành viên không hợp lệ.'; end if;
  end loop;
  if p_id is null then
    insert into public.members(display_name, note, active) values(trim(p_patch->>'display_name'), coalesce(p_patch->>'note', ''), coalesce((p_patch->>'active')::boolean, true)) returning id into p_id;
  else
    select * into v from public.members where id = p_id for update;
    if not found then raise exception 'Không tìm thấy thành viên.'; end if;
    if v.version is distinct from p_expected_version then raise exception 'Dữ liệu thành viên đã thay đổi. Hãy đóng và mở lại biểu mẫu.' using errcode = '40001'; end if;
    if p_patch->>'active' = 'false' and exists(select 1 from public.account_links where member_id = p_id and user_id = auth.uid()) then raise exception 'Không thể ngừng hoạt động tài khoản của chính bạn.'; end if;
    update public.members set display_name = coalesce(trim(p_patch->>'display_name'), v.display_name), note = coalesce(p_patch->>'note', v.note), active = coalesce((p_patch->>'active')::boolean, v.active), version = v.version + 1 where id = p_id;
  end if;
  return p_id;
end;
$$;
create function public.delete_member(p_id uuid, p_expected_version integer) returns void language plpgsql security definer set search_path = '' as $$
declare v public.members;
begin
  perform private.require_admin();
  select * into v from public.members where id = p_id for update;
  if not found then raise exception 'Không tìm thấy thành viên.'; end if;
  if v.version is distinct from p_expected_version then raise exception 'Dữ liệu đã thay đổi. Hãy thử lại.' using errcode = '40001'; end if;
  if exists(select 1 from public.attendance where member_id = p_id) or exists(select 1 from public.sessions where organizer_id = p_id) or exists(select 1 from public.account_links where member_id = p_id) then
    raise exception 'Thành viên có lịch sử hoặc tài khoản liên kết. Hãy chọn Ngừng hoạt động để bảo toàn dữ liệu.';
  end if;
  delete from public.members where id = p_id;
end;
$$;
create function public.save_session(p_id uuid, p_patch jsonb, p_expected_version integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.sessions; candidate public.sessions; k text;
begin
  perform private.require_admin();
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('session_date','start_time','end_time','venue','court','address','maps_url','organizer_id','booking_status','max_players','note','deadline') then raise exception 'Trường lịch không hợp lệ.'; end if;
  end loop;
  if p_id is null then
    insert into public.sessions(session_date,start_time,end_time,venue,court,address,maps_url,organizer_id,booking_status,max_players,note,deadline)
    values((p_patch->>'session_date')::date,(p_patch->>'start_time')::time,(p_patch->>'end_time')::time,p_patch->>'venue',p_patch->>'court',coalesce(p_patch->>'address',''),coalesce(p_patch->>'maps_url',''),(p_patch->>'organizer_id')::uuid,coalesce(p_patch->>'booking_status','pending'),(p_patch->>'max_players')::integer,coalesce(p_patch->>'note',''),(p_patch->>'deadline')::timestamptz) returning id into p_id;
  else
    select * into v from public.sessions where id = p_id for update;
    if not found then raise exception 'Không tìm thấy buổi đánh.'; end if;
    if v.version is distinct from p_expected_version then raise exception 'Lịch đã được sửa ở thiết bị khác. Hãy đóng và mở lại biểu mẫu.' using errcode = '40001'; end if;
    select * into candidate from jsonb_populate_record(null::public.sessions, to_jsonb(v) || p_patch);
    if candidate.max_players is not null and candidate.max_players < (select count(*) from public.attendance where session_id = p_id and status = 'going') then raise exception 'Giới hạn mới nhỏ hơn số người đã đăng ký.'; end if;
    update public.sessions set session_date=candidate.session_date,start_time=candidate.start_time,end_time=candidate.end_time,venue=candidate.venue,court=candidate.court,address=candidate.address,maps_url=candidate.maps_url,organizer_id=candidate.organizer_id,booking_status=candidate.booking_status,max_players=candidate.max_players,note=candidate.note,deadline=candidate.deadline,version=v.version+1 where id=p_id;
  end if;
  return p_id;
end;
$$;

create function public.set_attendance(p_session_id uuid, p_member_id uuid, p_status text default null, p_note text default null, p_expected_note_version integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sessions; a public.attendance; my_member uuid; admin boolean;
begin
  admin := public.is_admin();
  select l.member_id into my_member from public.account_links l join public.members m on m.id=l.member_id where l.user_id=auth.uid() and m.active;
  if my_member is null or (not admin and my_member <> p_member_id) then raise exception 'Bạn chỉ được sửa đăng ký của chính mình.' using errcode = '42501'; end if;
  -- Serialize every attendance write and capacity edit for this court/shift.
  select * into s from public.sessions where id=p_session_id for update;
  if not found then raise exception 'Buổi đánh không tồn tại.'; end if;
  if s.booking_status='cancelled' then raise exception 'Buổi đánh đã hủy, không nhận đăng ký.'; end if;
  if (s.session_date + s.end_time) at time zone 'Asia/Ho_Chi_Minh' <= now() then raise exception 'Buổi đánh đã kết thúc.'; end if;
  if s.deadline is not null and s.deadline <= now() and not admin then raise exception 'Đã hết hạn đăng ký. Hãy liên hệ quản trị viên.'; end if;
  if p_status is not null and p_status not in ('going','not_going','unanswered') then raise exception 'Trạng thái không hợp lệ.'; end if;
  select * into a from public.attendance where session_id=p_session_id and member_id=p_member_id;
  if not exists(select 1 from public.members where id=p_member_id and active) then raise exception 'Thành viên đã ngừng hoạt động.'; end if;
  if not exists(select 1 from public.session_roster where session_id=p_session_id and member_id=p_member_id) then raise exception 'Thành viên không thuộc danh sách buổi đánh này.'; end if;
  if p_note is not null and coalesce(a.note_version,0) is distinct from p_expected_note_version then raise exception 'Ghi chú đã được sửa trên thiết bị khác. Nội dung bạn nhập vẫn được giữ; hãy xem bản mới và xử lý xung đột.' using errcode='40001'; end if;
  if p_status='going' and coalesce(a.status,'unanswered') <> 'going' and s.max_players is not null then
    if (select count(*) from public.attendance where session_id=p_session_id and status='going') >= s.max_players then raise exception 'Ca/sân này đã đủ người. Vui lòng chọn ca/sân khác.'; end if;
  end if;
  insert into public.attendance(session_id,member_id,status,note,note_version,updated_at)
  values(p_session_id,p_member_id,coalesce(p_status,'unanswered'),coalesce(p_note,''),case when p_note is null then 0 else 1 end,now())
  on conflict(session_id,member_id) do update set
    status=coalesce(p_status,public.attendance.status),
    note=coalesce(p_note,public.attendance.note),
    note_version=public.attendance.note_version + case when p_note is null then 0 else 1 end,
    updated_at=now();
end;
$$;

create function public.copy_week(p_week_start date) returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.require_admin();
  if extract(isodow from p_week_start) <> 1 then raise exception 'Tuần phải bắt đầu vào thứ Hai.'; end if;
  insert into public.sessions(session_date,start_time,end_time,venue,court,address,maps_url,organizer_id,booking_status,max_players,note,deadline,copied_from)
  select session_date+7,start_time,end_time,venue,court,address,maps_url,organizer_id,'pending',max_players,note,
    case when deadline is null then null else deadline+interval '7 days' end,id
  from public.sessions where session_date>=p_week_start and session_date<p_week_start+7 and booking_status<>'cancelled'
  on conflict(copied_from,session_date) do nothing;
  get diagnostics n = row_count;
  -- Deliberately never copy attendance. Absent row means unanswered.
  return n;
end;
$$;

create function public.link_account(p_email text, p_member_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  perform private.require_admin();
  if not exists(select 1 from public.members where id=p_member_id and active) then raise exception 'Thành viên không hoạt động.'; end if;
  select id into uid from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
  if uid is null then raise exception 'Chưa tìm thấy tài khoản đã xác minh. Hãy yêu cầu thành viên đăng nhập email trước.'; end if;
  insert into public.account_links(user_id,member_id,role) values(uid,p_member_id,'member');
end;
$$;

-- Harden default function execution. No admin/service-role key is used in the browser.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function public.get_public_schedule() to anon, authenticated;
grant execute on function public.is_admin(), public.is_linked() to authenticated;
grant execute on function public.save_member(uuid,jsonb,integer), public.delete_member(uuid,integer), public.save_session(uuid,jsonb,integer), public.set_attendance(uuid,uuid,text,text,integer), public.copy_week(date), public.link_account(text,uuid) to authenticated;

insert into public.members(display_name) values
('Dũng'),('Trường'),('Hiền'),('Quyết'),('Yến'),('Chi'),('Nguyên'),('Khôi'),('Newbie Long'),('Mỹ Linh'),('Ái');

-- REALTIME: run on hosted Supabase; tests omit this deployment-only block.
do $$
declare t text;
begin
  foreach t in array array['members','sessions','attendance','account_links','audit_log','session_roster'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
