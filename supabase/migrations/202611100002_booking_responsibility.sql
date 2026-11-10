-- Run after 202611100001_quick_registration.sql. Safe to run again.
-- Weekly responsibility is independent of attendance and of actual bookings.
begin;

create table if not exists public.booking_sync (
  id integer primary key check (id=1),
  revision bigint not null default 0,
  initialized boolean not null default false,
  setup_issues jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
insert into public.booking_sync(id) values(1) on conflict do nothing;
create table if not exists public.booking_rotation_members (
  member_id uuid primary key references public.members(id) on delete cascade,
  eligible boolean not null default true,
  sort_order integer not null check(sort_order between 1 and 10000),
  history_status text not null default 'unknown' check(history_status in ('unknown','confirmed')),
  initial_completed_count integer not null default 0 check(initial_completed_count between 0 and 10000),
  baseline_through date not null default '2026-11-08' check(extract(isodow from baseline_through)=7),
  initial_last_week date check(extract(isodow from initial_last_week)=1),
  version integer not null default 1,
  check(initial_last_week is null or initial_last_week+6<=baseline_through),
  check(initial_completed_count>0 or initial_last_week is null),
  check(history_status='confirmed' or (initial_completed_count=0 and initial_last_week is null))
);
create table if not exists public.weekly_booking_assignments (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique check(extract(isodow from week_start)=1),
  week_end date generated always as (week_start+6) stored,
  member_id uuid not null references public.members(id) on delete restrict,
  original_member_id uuid not null references public.members(id) on delete restrict,
  completed_member_id uuid references public.members(id) on delete restrict,
  completed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((completed_member_id is null)=(completed_at is null))
);
create table if not exists public.booking_swap_requests (
  id uuid primary key default gen_random_uuid(),
  from_assignment_id uuid not null references public.weekly_booking_assignments(id) on delete restrict,
  to_assignment_id uuid not null references public.weekly_booking_assignments(id) on delete restrict,
  from_member_id uuid not null references public.members(id) on delete restrict,
  to_member_id uuid not null references public.members(id) on delete restrict,
  from_version integer not null,
  to_version integer not null,
  reason text not null default '' check(length(reason)<=1000),
  status text not null default 'pending' check(status in ('pending','accepted','rejected','cancelled','invalid')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  resolved_by_member_id uuid references public.members(id) on delete restrict,
  resolution_reason text not null default '' check(length(resolution_reason)<=1000),
  check(from_assignment_id<>to_assignment_id and from_member_id<>to_member_id)
);
create index if not exists booking_requests_status_idx on public.booking_swap_requests(status);
create table if not exists private.booking_swap_slots (
  assignment_id uuid primary key references public.weekly_booking_assignments(id) on delete restrict,
  request_id uuid not null references public.booking_swap_requests(id) on delete cascade
);
create table if not exists public.booking_notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  request_id uuid references public.booking_swap_requests(id) on delete restrict,
  kind text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(member_id,request_id,kind)
);
create index if not exists booking_notifications_member_idx on public.booking_notifications(member_id,created_at desc);
create table if not exists public.booking_history (
  id bigint generated always as identity primary key,
  event_type text not null,
  actor_member_id uuid references public.members(id) on delete restrict,
  actor_name text not null,
  changes jsonb not null default '[]',
  request_id uuid references public.booking_swap_requests(id) on delete restrict,
  requested_by_member_id uuid references public.members(id) on delete restrict,
  confirmed_by_member_id uuid references public.members(id) on delete restrict,
  session_id uuid references public.sessions(id) on delete restrict,
  session_snapshot jsonb,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists private.booking_invites (
  member_id uuid primary key references public.members(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null
);
create table if not exists private.booking_devices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.sessions add column if not exists organizer_mode text;
alter table public.sessions add column if not exists booked_by_member_id uuid references public.members(id) on delete restrict;
alter table public.sessions add column if not exists booked_at timestamptz;
alter table public.sessions add column if not exists estimated_cost numeric(12,0) check(estimated_cost>=0);
alter table public.sessions add column if not exists booking_contact_note text not null default '' check(length(booking_contact_note)<=2000);
alter table public.sessions add column if not exists deposit_note text not null default '' check(length(deposit_note)<=2000);

create or replace function private.vn_today() returns date language sql stable set search_path='' as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date;
$$;
create or replace function private.booking_lock() returns void language plpgsql security definer set search_path='' as $$
begin perform 1 from public.booking_sync where id=1 for update; end;
$$;
create or replace function private.booking_touch() returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Attendance counts do not change the responsibility schedule.
  if TG_TABLE_NAME='sessions' and TG_OP='UPDATE' and (to_jsonb(new)-'going_count')=(to_jsonb(old)-'going_count') then return null; end if;
  update public.booking_sync set revision=revision+1,updated_at=now() where id=1;
  return null;
end;
$$;
create or replace function private.booking_actor(p_token text default null) returns uuid language sql stable security definer set search_path='' as $$
  select coalesce(
    (select l.member_id from public.account_links l join public.members m on m.id=l.member_id where l.user_id=auth.uid() and m.active),
    (select d.member_id from private.booking_devices d join public.members m on m.id=d.member_id
     where d.token_hash=encode(sha256(convert_to(coalesce(p_token,''),'UTF8')),'hex') and d.expires_at>now() and m.active)
  );
$$;
create or replace function private.require_booking_actor(p_token text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  mid:=private.booking_actor(p_token);
  if mid is null then raise exception 'Hãy xác minh bằng mã cá nhân do quản trị viên cấp để thao tác đặt sân.' using errcode='42501'; end if;
  perform set_config('app.booking_member_id',mid::text,true);
  return mid;
end;
$$;
create or replace function private.booking_log(p_event text,p_changes jsonb default '[]',p_reason text default '',p_request uuid default null,p_session uuid default null,p_snapshot jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare mid uuid; actor text; req public.booking_swap_requests;
begin
  if current_setting('app.booking_system',true)='true' then actor:='Hệ thống';
  else
    mid:=coalesce(nullif(current_setting('app.booking_member_id',true),'')::uuid,private.booking_actor(null));
    select display_name into actor from public.members where id=mid;
  end if;
  if p_request is not null then select * into req from public.booking_swap_requests where id=p_request; end if;
  insert into public.booking_history(event_type,actor_member_id,actor_name,changes,request_id,requested_by_member_id,confirmed_by_member_id,session_id,session_snapshot,reason)
  values(p_event,mid,coalesce(actor,'Quản trị hệ thống'),p_changes,p_request,req.from_member_id,req.resolved_by_member_id,p_session,p_snapshot,coalesce(p_reason,''));
end;
$$;

create or replace function public.issue_booking_code(p_member_id uuid,p_revoke_existing boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare code text:=replace(gen_random_uuid()::text,'-',''); expires timestamptz:=now()+interval '7 days';
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
create or replace function public.activate_booking_identity(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare invite private.booking_invites; token text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''); expires timestamptz:=now()+interval '180 days';
begin
  perform private.booking_lock();
  select * into invite from private.booking_invites
  where code_hash=encode(sha256(convert_to(lower(regexp_replace(coalesce(p_code,''),'[[:space:]-]','','g')),'UTF8')),'hex') and expires_at>now() for update;
  if not found or not exists(select 1 from public.members where id=invite.member_id and active) then
    raise exception 'Mã không hợp lệ, đã dùng hoặc hết hạn. Nhờ quản trị viên cấp mã mới.' using errcode='42501';
  end if;
  delete from private.booking_invites where member_id=invite.member_id;
  insert into private.booking_devices(member_id,token_hash,expires_at) values(invite.member_id,encode(sha256(convert_to(token,'UTF8')),'hex'),expires);
  return jsonb_build_object('token',token,'member_id',invite.member_id,'expires_at',expires);
end;
$$;
create or replace function public.end_booking_identity(p_token text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.booking_lock();
  delete from private.booking_devices where token_hash=encode(sha256(convert_to(coalesce(p_token,''),'UTF8')),'hex');
end;
$$;

create or replace function private.booking_assignment_before() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='UPDATE' then
    if new.week_start<>old.week_start or new.original_member_id<>old.original_member_id then raise exception 'Không đổi khoảng tuần hoặc người được phân công ban đầu.'; end if;
    new.version:=old.version+1; new.updated_at:=now();
  end if;
  if new.completed_member_id is not null and new.week_start+6>=private.vn_today() then raise exception 'Chỉ xác nhận hoàn thành sau khi tuần kết thúc.'; end if;
  return new;
end;
$$;
create or replace function private.booking_assignment_after() returns trigger language plpgsql security definer set search_path='' as $$
declare prior uuid; event text:=coalesce(nullif(current_setting('app.booking_event',true),''),'assignment_saved'); change jsonb;
begin
  if TG_OP='UPDATE' then prior:=old.member_id; end if;
  change:=jsonb_build_object('assignment_id',new.id,'week_start',new.week_start,'week_end',new.week_end,'original_member_id',new.original_member_id,
    'before_member_id',prior,'after_member_id',new.member_id,'completed_member_id',new.completed_member_id);
  if event not in ('swap_accepted','admin_swap') then
    perform private.booking_log(event,jsonb_build_array(change),current_setting('app.booking_reason',true));
  end if;
  if TG_OP='INSERT' or new.member_id is distinct from prior then
    update public.sessions set organizer_id=new.member_id,version=version+1
    where organizer_mode='weekly' and session_date between new.week_start and new.week_end and organizer_id is distinct from new.member_id;
  end if;
  update public.booking_swap_requests set status='invalid',responded_at=now(),
    resolution_reason='Phân công đã thay đổi. Hãy trao đổi và gửi yêu cầu mới.'
  where status='pending' and ((from_assignment_id=new.id and from_version<>new.version) or (to_assignment_id=new.id and to_version<>new.version));
  return null;
end;
$$;
drop trigger if exists booking_assignment_before on public.weekly_booking_assignments;
create trigger booking_assignment_before before update on public.weekly_booking_assignments for each row execute function private.booking_assignment_before();
drop trigger if exists booking_assignment_after on public.weekly_booking_assignments;
create trigger booking_assignment_after after insert or update on public.weekly_booking_assignments for each row execute function private.booking_assignment_after();

create or replace function private.booking_swap_after() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.weekly_booking_assignments; b public.weekly_booking_assignments; change jsonb:='[]'; label text; reason text;
begin
  select * into a from public.weekly_booking_assignments where id=new.from_assignment_id;
  select * into b from public.weekly_booking_assignments where id=new.to_assignment_id;
  if TG_OP='INSERT' then
    insert into private.booking_swap_slots values(new.from_assignment_id,new.id),(new.to_assignment_id,new.id);
    insert into public.booking_notifications(member_id,request_id,kind,message)
    select new.to_member_id,new.id,'pending',m.display_name||' đề nghị đổi lượt '||to_char(a.week_start,'DD/MM/YYYY')||' ↔ '||to_char(b.week_start,'DD/MM/YYYY') from public.members m where m.id=new.from_member_id;
    reason:=new.reason;
  elsif new.status is distinct from old.status then
    delete from private.booking_swap_slots where request_id=new.id;
    label:=case new.status when 'accepted' then 'Đã đồng ý đổi lượt' when 'rejected' then 'Đã từ chối đổi lượt' when 'cancelled' then 'Đề nghị đổi lượt đã hủy' else 'Đề nghị đổi lượt không còn hiệu lực' end;
    insert into public.booking_notifications(member_id,request_id,kind,message)
    select mid,new.id,new.status,label||': '||to_char(a.week_start,'DD/MM/YYYY')||' ↔ '||to_char(b.week_start,'DD/MM/YYYY') from unnest(array[new.from_member_id,new.to_member_id]) mid on conflict do nothing;
    reason:=coalesce(nullif(new.resolution_reason,''),new.reason);
  else return null;
  end if;
  change:=jsonb_build_array(
    jsonb_build_object('assignment_id',a.id,'week_start',a.week_start,'week_end',a.week_end,'original_member_id',a.original_member_id,'before_member_id',new.from_member_id,'after_member_id',case when new.status='accepted' then new.to_member_id else new.from_member_id end),
    jsonb_build_object('assignment_id',b.id,'week_start',b.week_start,'week_end',b.week_end,'original_member_id',b.original_member_id,'before_member_id',new.to_member_id,'after_member_id',case when new.status='accepted' then new.from_member_id else new.to_member_id end));
  perform private.booking_log('swap_'||case when TG_OP='INSERT' then 'requested' else new.status end,change,reason,new.id);
  return null;
end;
$$;
drop trigger if exists booking_swap_after on public.booking_swap_requests;
create trigger booking_swap_after after insert or update on public.booking_swap_requests for each row execute function private.booking_swap_after();

create or replace function public.request_booking_swap(p_assignment_id uuid,p_reason text default '',p_token text default null,p_expected_version integer default null,p_next_version integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid; a public.weekly_booking_assignments; b public.weekly_booking_assignments; rid uuid;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into a from public.weekly_booking_assignments where id=p_assignment_id for update;
  if not found or a.member_id<>mid then raise exception 'Bạn chỉ được gửi yêu cầu từ tuần mình phụ trách.' using errcode='42501'; end if;
  if a.week_end<private.vn_today() or a.completed_member_id is not null then raise exception 'Không thể đổi tuần đã kết thúc hoặc đã hoàn thành.'; end if;
  select * into b from public.weekly_booking_assignments where week_start=a.week_start+7 for update;
  if not found then raise exception 'Tuần kế tiếp chưa có người phụ trách. Hãy liên hệ quản trị viên.'; end if;
  if (p_expected_version is not null and p_expected_version<>a.version) or (p_next_version is not null and p_next_version<>b.version) then raise exception 'Phân công đã thay đổi. Hãy mở lại yêu cầu trước khi gửi.' using errcode='40001'; end if;
  if a.member_id=b.member_id then raise exception 'Không thể đổi lượt với chính mình.'; end if;
  if not exists(select 1 from public.members where id=b.member_id and active) then raise exception 'Người tuần kế tiếp đã ngừng hoạt động. Hãy liên hệ quản trị viên.'; end if;
  if exists(select 1 from private.booking_swap_slots where assignment_id in (a.id,b.id)) then raise exception 'Một trong hai tuần đang có yêu cầu chờ phản hồi. Hãy xử lý hoặc hủy yêu cầu đó trước.'; end if;
  insert into public.booking_swap_requests(from_assignment_id,to_assignment_id,from_member_id,to_member_id,from_version,to_version,reason)
  values(a.id,b.id,mid,b.member_id,a.version,b.version,coalesce(trim(p_reason),'')) returning id into rid;
  return rid;
end;
$$;
create or replace function public.respond_booking_swap(p_request_id uuid,p_decision text,p_token text default null)
returns text language plpgsql security definer set search_path='' as $$
declare mid uuid; r public.booking_swap_requests; a public.weekly_booking_assignments; b public.weekly_booking_assignments;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into r from public.booking_swap_requests where id=p_request_id for update;
  if not found or r.to_member_id<>mid then raise exception 'Chỉ đúng người nhận mới được xác nhận yêu cầu này.' using errcode='42501'; end if;
  if r.status<>'pending' then raise exception 'Yêu cầu đã được xử lý hoặc không còn hiệu lực.'; end if;
  if p_decision not in ('accept','reject') or p_decision is null then raise exception 'Lựa chọn không hợp lệ.'; end if;
  select * into a from public.weekly_booking_assignments where id=r.from_assignment_id for update;
  select * into b from public.weekly_booking_assignments where id=r.to_assignment_id for update;
  if a.member_id<>r.from_member_id or b.member_id<>r.to_member_id or a.version<>r.from_version or b.version<>r.to_version
    or a.week_end<private.vn_today() or b.week_start<>a.week_start+7 or a.completed_member_id is not null or b.completed_member_id is not null
    or not exists(select 1 from public.members where id=r.from_member_id and active) then
    update public.booking_swap_requests set status='invalid',responded_at=now(),resolved_by_member_id=mid,resolution_reason='Lịch hoặc thành viên đã thay đổi; không thể áp dụng yêu cầu cũ.' where id=r.id;
    return 'invalid';
  end if;
  if p_decision='reject' then
    update public.booking_swap_requests set status='rejected',responded_at=now(),resolved_by_member_id=mid where id=r.id;
    return 'rejected';
  end if;
  -- Mark this request accepted before assignment triggers invalidate other requests.
  -- The request and BOTH assignments commit or roll back as a single transaction.
  perform set_config('app.booking_event','swap_accepted',true);
  update public.booking_swap_requests set status='accepted',responded_at=now(),resolved_by_member_id=mid where id=r.id;
  update public.weekly_booking_assignments set member_id=r.to_member_id where id=a.id;
  update public.weekly_booking_assignments set member_id=r.from_member_id where id=b.id;
  return 'accepted';
end;
$$;
create or replace function public.cancel_booking_swap(p_request_id uuid,p_token text default null)
returns void language plpgsql security definer set search_path='' as $$
declare mid uuid; r public.booking_swap_requests;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into r from public.booking_swap_requests where id=p_request_id for update;
  if not found or r.from_member_id<>mid then raise exception 'Bạn chỉ được hủy yêu cầu do mình gửi.' using errcode='42501'; end if;
  if r.status<>'pending' then raise exception 'Yêu cầu đã được xử lý hoặc không còn hiệu lực.'; end if;
  update public.booking_swap_requests set status='cancelled',responded_at=now(),resolved_by_member_id=mid where id=r.id;
end;
$$;

create or replace function public.save_booking_assignment(p_week_start date,p_member_id uuid,p_expected_version integer default null,p_reason text default '',p_completed boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.weekly_booking_assignments; mid uuid;
begin
  perform private.require_admin(); perform private.booking_lock();
  mid:=private.require_booking_actor(null);
  if coalesce(length(trim(p_reason)),0) not between 1 and 1000 then raise exception 'Nhập lý do phân công hoặc chỉnh sửa để lưu lịch sử.'; end if;
  if p_week_start is null or extract(isodow from p_week_start)<>1 then raise exception 'Tuần phải bắt đầu từ thứ Hai.'; end if;
  if not exists(select 1 from public.members where id=p_member_id and (active or p_week_start+6<private.vn_today())) then raise exception 'Chọn thành viên còn hoạt động cho tuần hiện tại hoặc tương lai.'; end if;
  if p_completed and p_week_start+6>=private.vn_today() then raise exception 'Chỉ xác nhận hoàn thành sau khi tuần kết thúc.'; end if;
  perform set_config('app.booking_reason',trim(p_reason),true);
  select * into a from public.weekly_booking_assignments where week_start=p_week_start for update;
  if found then
    if a.version is distinct from p_expected_version then raise exception 'Phân công đã thay đổi. Hãy mở lại biểu mẫu.' using errcode='40001'; end if;
    perform set_config('app.booking_event','assignment_changed',true);
    update public.weekly_booking_assignments set member_id=p_member_id,
      completed_member_id=case when not p_completed then null else coalesce(a.completed_member_id,p_member_id) end,
      completed_at=case when not p_completed then null else coalesce(a.completed_at,now()) end where id=a.id;
    return a.id;
  else
    if p_expected_version is not null then raise exception 'Phân công không còn tồn tại.' using errcode='40001'; end if;
    perform set_config('app.booking_event',case when p_week_start+6<private.vn_today() then 'history_imported' else 'assignment_created' end,true);
    insert into public.weekly_booking_assignments(week_start,member_id,original_member_id,completed_member_id,completed_at)
    values(p_week_start,p_member_id,p_member_id,case when p_completed then p_member_id end,case when p_completed then now() end) returning id into mid;
    return mid;
  end if;
end;
$$;
create or replace function public.complete_booking_week(p_assignment_id uuid,p_expected_version integer,p_token text default null)
returns void language plpgsql security definer set search_path='' as $$
declare mid uuid; a public.weekly_booking_assignments;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into a from public.weekly_booking_assignments where id=p_assignment_id for update;
  if not found or (a.member_id<>mid and not public.is_admin()) then raise exception 'Bạn chỉ được xác nhận tuần mình phụ trách.' using errcode='42501'; end if;
  if a.version<>p_expected_version then raise exception 'Phân công đã thay đổi. Hãy tải dữ liệu mới nhất.' using errcode='40001'; end if;
  if a.week_end>=private.vn_today() then raise exception 'Chỉ xác nhận hoàn thành sau khi tuần kết thúc.'; end if;
  if a.completed_member_id is not null then raise exception 'Tuần này đã được tính hoàn thành một lượt.'; end if;
  perform set_config('app.booking_event','week_completed',true);
  update public.weekly_booking_assignments set completed_member_id=member_id,completed_at=now() where id=a.id;
end;
$$;
create or replace function public.admin_swap_booking_weeks(p_assignment_id uuid,p_reason text,p_expected_version integer default null,p_next_version integer default null)
returns void language plpgsql security definer set search_path='' as $$
declare a public.weekly_booking_assignments; b public.weekly_booking_assignments; mid uuid;
begin
  perform private.require_admin(); perform private.booking_lock(); mid:=private.require_booking_actor(null);
  if coalesce(length(trim(p_reason)),0) not between 1 and 1000 then raise exception 'Quản trị viên cần ghi lý do đổi trực tiếp.'; end if;
  select * into a from public.weekly_booking_assignments where id=p_assignment_id for update;
  select * into b from public.weekly_booking_assignments where week_start=a.week_start+7 for update;
  if a.id is null or b.id is null then raise exception 'Cần có phân công cho cả hai tuần kế tiếp.'; end if;
  if a.version is distinct from p_expected_version or b.version is distinct from p_next_version then raise exception 'Phân công đã thay đổi. Hãy mở lại biểu mẫu đổi trực tiếp.' using errcode='40001'; end if;
  if a.week_end<private.vn_today() or a.completed_member_id is not null or b.completed_member_id is not null then raise exception 'Không thể đổi tuần đã kết thúc hoặc hoàn thành.'; end if;
  if a.member_id=b.member_id then raise exception 'Hai tuần đang cùng một người phụ trách.'; end if;
  if exists(select 1 from public.members where id in (a.member_id,b.member_id) and not active) then raise exception 'Cần phân công người còn hoạt động.'; end if;
  perform set_config('app.booking_event','admin_swap',true); perform set_config('app.booking_reason',p_reason,true);
  update public.weekly_booking_assignments set member_id=b.member_id where id=a.id;
  update public.weekly_booking_assignments set member_id=a.member_id where id=b.id;
  perform private.booking_log('admin_swap',jsonb_build_array(
    jsonb_build_object('week_start',a.week_start,'week_end',a.week_end,'original_member_id',a.original_member_id,'before_member_id',a.member_id,'after_member_id',b.member_id),
    jsonb_build_object('week_start',b.week_start,'week_end',b.week_end,'original_member_id',b.original_member_id,'before_member_id',b.member_id,'after_member_id',a.member_id)),p_reason);
  insert into public.booking_notifications(member_id,kind,message) values
    (a.member_id,'admin_swap','Quản trị viên đã đổi lượt hai tuần bắt đầu '||a.week_start||' và '||b.week_start||'. Lý do: '||p_reason),
    (b.member_id,'admin_swap','Quản trị viên đã đổi lượt hai tuần bắt đầu '||a.week_start||' và '||b.week_start||'. Lý do: '||p_reason);
end;
$$;

create or replace function public.save_booking_rotation(p_member_id uuid,p_patch jsonb,p_expected_version integer default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.booking_rotation_members; c public.booking_rotation_members; k text;
begin
  perform private.require_admin(); perform private.booking_lock();
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('eligible','sort_order','history_status','initial_completed_count','baseline_through','initial_last_week') then raise exception 'Trường vòng phân công không hợp lệ.'; end if;
  end loop;
  if (p_patch->>'baseline_through')::date>=private.vn_today() then raise exception 'Mốc lịch sử ban đầu phải là một Chủ nhật đã kết thúc.'; end if;
  if not exists(select 1 from public.members where id=p_member_id) then raise exception 'Không tìm thấy thành viên.'; end if;
  select * into r from public.booking_rotation_members where member_id=p_member_id for update;
  if found then
    if r.version is distinct from p_expected_version then raise exception 'Vòng phân công vừa thay đổi. Hãy mở lại biểu mẫu.' using errcode='40001'; end if;
    select * into c from jsonb_populate_record(null::public.booking_rotation_members,to_jsonb(r)||p_patch);
    update public.booking_rotation_members set eligible=c.eligible,sort_order=c.sort_order,history_status=c.history_status,
      initial_completed_count=c.initial_completed_count,baseline_through=c.baseline_through,initial_last_week=c.initial_last_week,version=version+1 where member_id=p_member_id;
  else
    if p_expected_version is not null then raise exception 'Dữ liệu vòng phân công không còn tồn tại.' using errcode='40001'; end if;
    insert into public.booking_rotation_members(member_id,eligible,sort_order,history_status,initial_completed_count,baseline_through,initial_last_week)
    values(p_member_id,coalesce((p_patch->>'eligible')::boolean,true),coalesce((p_patch->>'sort_order')::integer,100),coalesce(p_patch->>'history_status','unknown'),coalesce((p_patch->>'initial_completed_count')::integer,0),coalesce((p_patch->>'baseline_through')::date,'2026-11-08'),(p_patch->>'initial_last_week')::date);
  end if;
  perform private.booking_log('rotation_updated',jsonb_build_array(jsonb_build_object('member_id',p_member_id,'before',to_jsonb(r),'after',p_patch)), 'Cập nhật điều kiện và lịch sử ban đầu; giữ nguyên các lịch đã chốt.');
end;
$$;

create or replace function private.booking_statistics(p_week date) returns table(member_id uuid,completed_count bigint,planned_count bigint,last_week date)
language sql stable security definer set search_path='' as $$
  select r.member_id,
    (case when r.history_status='confirmed' then r.initial_completed_count else 0 end)::bigint+
      (select count(*) from public.weekly_booking_assignments a where a.completed_member_id=r.member_id and (r.history_status='unknown' or a.week_end>r.baseline_through)),
    (select count(*) from public.weekly_booking_assignments a where a.member_id=r.member_id and a.completed_member_id is null and a.week_end>=private.vn_today()),
    greatest(r.initial_last_week,(select max(a.week_start) from public.weekly_booking_assignments a
      where (a.completed_member_id=r.member_id or (a.member_id=r.member_id and a.week_end>=private.vn_today())) and a.week_start<p_week))
  from public.booking_rotation_members r;
$$;
create or replace function public.propose_booking_assignments(p_start date,p_weeks integer default 8)
returns jsonb language plpgsql security definer set search_path='' as $$
declare plan jsonb:='[]'; d date; chosen record; existing public.weekly_booking_assignments; previous uuid; unknown_names text; i integer; rev bigint;
begin
  perform private.require_admin(); perform private.booking_lock();
  if p_start is null or extract(isodow from p_start)<>1 or p_start+6<private.vn_today() then raise exception 'Chọn thứ Hai của tuần chưa kết thúc.'; end if;
  if p_weeks is null or p_weeks not between 1 and 26 then raise exception 'Đề xuất từ 1 đến 26 tuần.'; end if;
  if not exists(select 1 from public.booking_rotation_members r join public.members m on m.id=r.member_id where r.eligible and m.active) then raise exception 'Chưa có thành viên hoạt động đủ điều kiện trong vòng phân công.'; end if;
  select string_agg(m.display_name,', ' order by r.sort_order) into unknown_names
  from public.booking_rotation_members r join public.members m on m.id=r.member_id where r.eligible and m.active and r.history_status='unknown';
  if unknown_names is not null then raise exception 'Chưa có lịch sử ghi nhận: %. Hãy nhập hoặc xác nhận số lượt ban đầu trước khi đề xuất; không tự coi là chưa từng phụ trách.',unknown_names; end if;
  select revision into rev from public.booking_sync where id=1;
  for i in 0..p_weeks-1 loop
    d:=p_start+i*7;
    select * into existing from public.weekly_booking_assignments where week_start=d;
    if found then
      plan:=plan||jsonb_build_array(jsonb_build_object('week_start',d,'week_end',d+6,'member_id',existing.member_id,'existing',true,'reason','Lịch đã chốt, giữ nguyên.'));
      previous:=existing.member_id;
      continue;
    end if;
    if previous is null then select member_id into previous from public.weekly_booking_assignments where week_start=d-7; end if;
    select m.id,m.display_name,st.completed_count,st.planned_count,
      (select count(*) from jsonb_array_elements(plan) x where not coalesce((x->>'existing')::boolean,false) and x->>'member_id'=m.id::text) as proposed_count,
      greatest(st.last_week,(select max((x->>'week_start')::date) from jsonb_array_elements(plan) x where x->>'member_id'=m.id::text)) as last_week
    into chosen
    from public.booking_rotation_members r join public.members m on m.id=r.member_id join private.booking_statistics(d) st on st.member_id=m.id
    where r.eligible and m.active and (m.id is distinct from previous or not exists(select 1 from public.booking_rotation_members r2 join public.members m2 on m2.id=r2.member_id where r2.eligible and m2.active and m2.id is distinct from previous))
    order by st.completed_count+st.planned_count+(select count(*) from jsonb_array_elements(plan) x where not coalesce((x->>'existing')::boolean,false) and x->>'member_id'=m.id::text),
      coalesce(greatest(st.last_week,(select max((x->>'week_start')::date) from jsonb_array_elements(plan) x where x->>'member_id'=m.id::text)),case when st.completed_count=0 then '0001-01-01'::date else '9999-12-31'::date end),
      r.sort_order,m.code limit 1;
    plan:=plan||jsonb_build_array(jsonb_build_object('week_start',d,'week_end',d+6,'member_id',chosen.id,'existing',false,
      'completed_count',chosen.completed_count,'planned_count',chosen.planned_count+chosen.proposed_count,'last_week',chosen.last_week,
      'reason',format('%s lượt đã hoàn thành; %s lượt đã xếp/đề xuất phía trước. Lần gần nhất: %s. Hạn chế trùng người tuần liền trước; hòa điểm dùng thứ tự cố định.',chosen.completed_count,chosen.planned_count+chosen.proposed_count,coalesce(to_char(chosen.last_week,'DD/MM/YYYY'),case when chosen.completed_count=0 then 'đã xác nhận chưa từng phụ trách' else 'chưa ghi nhận ngày, xếp sau người có mốc rõ ràng' end))));
    previous:=chosen.id;
  end loop;
  return jsonb_build_object('revision',rev,'rows',plan);
end;
$$;
create or replace function public.apply_booking_proposal(p_rows jsonb,p_expected_revision bigint,p_reason text default 'Áp dụng đề xuất phân công đã duyệt')
returns integer language plpgsql security definer set search_path='' as $$
declare row jsonb; d date; mid uuid; rev bigint; n integer:=0;
begin
  perform private.require_admin(); perform private.booking_lock();
  select revision into rev from public.booking_sync where id=1;
  if rev is distinct from p_expected_revision then raise exception 'Dữ liệu phân công đã thay đổi sau khi đề xuất. Hãy tạo đề xuất mới.' using errcode='40001'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 26 then raise exception 'Danh sách đề xuất không hợp lệ.'; end if;
  if coalesce(length(trim(p_reason)),0) not between 1 and 1000 then raise exception 'Nhập lý do áp dụng phân công.'; end if;
  if (select count(distinct x->>'week_start') from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then raise exception 'Các tuần trong đề xuất bị trùng.'; end if;
  perform set_config('app.booking_event','proposal_applied',true); perform set_config('app.booking_reason',p_reason,true);
  for row in select value from jsonb_array_elements(p_rows) loop
    d:=(row->>'week_start')::date; mid:=(row->>'member_id')::uuid;
    if d is null or extract(isodow from d)<>1 or d+6<private.vn_today() then raise exception 'Đề xuất có tuần không hợp lệ hoặc đã kết thúc.'; end if;
    if exists(select 1 from public.weekly_booking_assignments where week_start=d) then raise exception 'Tuần % đã được phân công; không ghi đè lịch đã chốt.',d using errcode='40001'; end if;
    if not exists(select 1 from public.booking_rotation_members r join public.members m on m.id=r.member_id where r.member_id=mid and r.eligible and m.active and r.history_status='confirmed') then raise exception 'Đề xuất có người không còn đủ điều kiện hoặc lịch sử chưa xác nhận.'; end if;
    insert into public.weekly_booking_assignments(week_start,member_id,original_member_id) values(d,mid,mid); n:=n+1;
  end loop;
  return n;
end;
$$;

-- New functionality stays readable even if a one-time member-name mapping needs attention.
create or replace function private.initialize_booking_schedule(p_mapping jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare names text[]:=array['Dũng','Trường','Hiền','Quyết','Yến','Chi','Nguyên','Khôi','Newbie Long','Mỹ Linh','Ái']; ids uuid[]:='{}'; issues jsonb:='[]'; name text; mid uuid; total integer; i integer; k text;
begin
  perform private.booking_lock();
  if (select initialized from public.booking_sync where id=1) then return jsonb_build_object('initialized',true,'issues','[]'::jsonb); end if;
  for k in select jsonb_object_keys(p_mapping) loop if not k=any(names) then raise exception 'Tên ánh xạ không thuộc danh sách khởi tạo.'; end if; end loop;
  foreach name in array names loop
    mid:=null;
    if p_mapping ? name then
      mid:=(p_mapping->>name)::uuid;
      if not exists(select 1 from public.members where id=mid) then mid:=null; end if;
      total:=case when mid is null then 0 else 1 end;
    else
      select count(*),min(id::text)::uuid into total,mid from public.members where lower(trim(display_name))=lower(name);
    end if;
    if total<>1 or mid=any(ids) then
      issues:=issues||jsonb_build_array(jsonb_build_object('name',name,'kind',case when total=0 then 'missing' else 'ambiguous' end));
    end if;
    ids:=array_append(ids,mid);
  end loop;
  if jsonb_array_length(issues)>0 then
    update public.booking_sync set setup_issues=issues,revision=revision+1,updated_at=now() where id=1;
    return jsonb_build_object('initialized',false,'issues',issues);
  end if;
  perform set_config('app.booking_event','agreed_schedule_seeded',true);
  perform set_config('app.booking_reason','Lịch đã thống nhất trước khi bổ sung chức năng; không ghi đè dữ liệu hiện có.',true);
  for i in 1..array_length(names,1) loop
    insert into public.booking_rotation_members(member_id,sort_order) values(ids[i],i) on conflict(member_id) do nothing;
  end loop;
  insert into public.weekly_booking_assignments(week_start,member_id,original_member_id) values
    ('2026-11-09',ids[5],ids[5]),('2026-11-16',ids[7],ids[7]),('2026-11-23',ids[9],ids[9]),('2026-11-30',ids[11],ids[11]),
    ('2026-12-07',ids[2],ids[2]),('2026-12-14',ids[10],ids[10]),('2026-12-21',ids[6],ids[6])
  on conflict(week_start) do nothing;
  update public.booking_sync set initialized=true,setup_issues='[]',revision=revision+1,updated_at=now() where id=1;
  return jsonb_build_object('initialized',true,'issues','[]'::jsonb);
end;
$$;
create or replace function public.initialize_booking_schedule(p_mapping jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_admin(); return private.initialize_booking_schedule(p_mapping); end;
$$;

-- Preserve existing explicit contacts and the best known actual booker BEFORE inheritance.
update public.sessions set booked_by_member_id=organizer_id where booking_status='booked' and booked_by_member_id is null and organizer_id is not null;
select private.initialize_booking_schedule();
update public.sessions s set organizer_mode=case when s.organizer_id is null or s.organizer_id=(select a.member_id from public.weekly_booking_assignments a where s.session_date between a.week_start and a.week_end) then 'weekly' else 'override' end where organizer_mode is null;
alter table public.sessions alter column organizer_mode set default 'weekly';
alter table public.sessions alter column organizer_mode set not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='sessions_organizer_mode_check' and conrelid='public.sessions'::regclass) then alter table public.sessions add constraint sessions_organizer_mode_check check(organizer_mode in ('weekly','override')); end if;
end $$;

create or replace function private.booking_session_before() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.organizer_mode='weekly' then
    select member_id into new.organizer_id from public.weekly_booking_assignments where new.session_date between week_start and week_end;
  elsif new.organizer_id is null then raise exception 'Chọn người phụ trách riêng cho buổi này.';
  end if;
  -- Changing the weekly contact must NEVER overwrite the actual booker.
  if TG_OP='UPDATE' then
    if old.booking_status='booked' and old.booked_by_member_id is not null and new.booked_by_member_id is distinct from old.booked_by_member_id then
      raise exception 'Người đã đặt thực tế đã được ghi nhận. Đổi phân công không thay đổi thông tin này.';
    end if;
    if new.booking_status=old.booking_status then new.booked_at:=old.booked_at; end if;
  end if;
  if new.booking_status='booked' and (TG_OP='INSERT' or old.booking_status<>'booked') then
    new.booked_by_member_id:=coalesce(new.booked_by_member_id,nullif(current_setting('app.booking_member_id',true),'')::uuid,new.organizer_id);
    if new.booked_by_member_id is null then raise exception 'Chọn người đã liên hệ đặt sân thực tế trước khi xác nhận Đã đặt.'; end if;
    new.booked_at:=now();
  end if;
  return new;
end;
$$;
create or replace function private.booking_session_after() returns trigger language plpgsql security definer set search_path='' as $$
declare event text;
begin
  if TG_OP='INSERT' then
    if new.booking_status<>'booked' and new.organizer_mode<>'override' then return null; end if;
    event:=case when new.booking_status='booked' then 'court_confirmed' else 'session_override' end;
  elsif (to_jsonb(new)-'going_count'-'version')=(to_jsonb(old)-'going_count'-'version') then return null;
  elsif (new.organizer_mode='override' or old.organizer_mode='override') and (new.organizer_mode is distinct from old.organizer_mode or new.organizer_id is distinct from old.organizer_id) then event:='session_override';
  elsif new.booking_status='booked' and (old.booking_status<>'booked' or new.booked_by_member_id is distinct from old.booked_by_member_id) then event:='court_confirmed';
  elsif new.booking_status='cancelled' and old.booking_status<>'cancelled' then event:='court_cancelled';
  elsif (to_jsonb(new)-'going_count'-'version'-'organizer_id')=(to_jsonb(old)-'going_count'-'version'-'organizer_id') then return null;
  else event:='court_updated'; end if;
  perform private.booking_log(event,'[]','Ghi nhận riêng theo buổi; không tính thêm lượt hoàn thành theo tuần.',null,new.id,to_jsonb(new));
  return null;
end;
$$;
drop trigger if exists booking_session_before on public.sessions;
create trigger booking_session_before before insert or update on public.sessions for each row execute function private.booking_session_before();
drop trigger if exists booking_session_after on public.sessions;
create trigger booking_session_after after insert or update on public.sessions for each row execute function private.booking_session_after();
update public.sessions s set organizer_id=a.member_id,version=s.version+1 from public.weekly_booking_assignments a
where s.organizer_mode='weekly' and s.session_date between a.week_start and a.week_end and s.organizer_id is distinct from a.member_id;
insert into public.booking_history(event_type,actor_name,session_id,session_snapshot,reason)
select 'booking_migrated','Hệ thống',s.id,to_jsonb(s),'Giữ thông tin đặt sân đã có khi nâng cấp. Thời điểm đặt gốc chưa được ghi nhận.'
from public.sessions s where s.booking_status='booked' and not exists(select 1 from public.booking_history h where h.session_id=s.id and h.event_type='booking_migrated');

create or replace function private.write_booking_session(p_id uuid,p_patch jsonb,p_expected_version integer,p_actor uuid,p_admin boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.sessions; c public.sessions; k text;
begin
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Thông tin buổi đánh không hợp lệ.'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('session_date','start_time','end_time','venue','court','address','maps_url','organizer_id','organizer_mode','booking_status','max_players','note','deadline','estimated_cost','booking_contact_note','deposit_note','booked_by_member_id') then raise exception 'Trường lịch không hợp lệ.'; end if;
    if not p_admin and k in ('organizer_id','organizer_mode','max_players','deadline','booked_by_member_id') then raise exception 'Người phụ trách không được thay phân công hoặc giới hạn đăng ký.' using errcode='42501'; end if;
  end loop;
  if p_id is null then
    if not p_admin then raise exception 'Chỉ quản trị viên được tạo buổi đánh.' using errcode='42501'; end if;
    -- Older clients choosing an explicit organizer remain explicit overrides.
    if p_patch ? 'organizer_id' and not p_patch ? 'organizer_mode' and nullif(p_patch->>'organizer_id','') is not null then p_patch:=p_patch||'{"organizer_mode":"override"}'; end if;
    select * into c from jsonb_populate_record(null::public.sessions,
      '{"organizer_mode":"weekly","booking_status":"pending","address":"","maps_url":"","note":"","booking_contact_note":"","deposit_note":""}'::jsonb||p_patch);
  else
    select * into v from public.sessions where id=p_id for update;
    if not found then raise exception 'Không tìm thấy buổi đánh.'; end if;
    if v.version is distinct from p_expected_version then raise exception 'Lịch đã được sửa ở thiết bị khác. Hãy mở lại biểu mẫu; nội dung chưa được ghi đè.' using errcode='40001'; end if;
    if not p_admin and (v.organizer_id is distinct from p_actor or (v.session_date+v.end_time) at time zone 'Asia/Ho_Chi_Minh'<=now()) then raise exception 'Bạn chỉ được cập nhật buổi chưa kết thúc do mình phụ trách.' using errcode='42501'; end if;
    if p_patch ? 'organizer_id' and not p_patch ? 'organizer_mode' and (p_patch->>'organizer_id')::uuid is distinct from v.organizer_id then p_patch:=p_patch||'{"organizer_mode":"override"}'; end if;
    select * into c from jsonb_populate_record(null::public.sessions,to_jsonb(v)||p_patch);
  end if;
  if not p_admin and c.organizer_mode='weekly' and not exists(select 1 from public.weekly_booking_assignments where c.session_date between week_start and week_end and member_id=p_actor) then
    raise exception 'Ngày mới nằm ngoài tuần bạn phụ trách. Nhờ quản trị viên chuyển buổi sang tuần khác.' using errcode='42501';
  end if;
  if not p_admin and (c.session_date+c.end_time) at time zone 'Asia/Ho_Chi_Minh'<=now() then raise exception 'Ngày giờ mới đã qua. Nhờ quản trị viên chỉnh sửa dữ liệu lịch sử nếu cần.'; end if;
  if c.organizer_mode='override' and not exists(select 1 from public.members where id=c.organizer_id and (active or c.session_date<private.vn_today())) then raise exception 'Người phụ trách riêng không còn hoạt động.'; end if;
  if c.max_players is not null and c.max_players<(select count(*) from public.attendance where session_id=p_id and status='going') then raise exception 'Giới hạn mới nhỏ hơn số người đã đăng ký.'; end if;
  if c.booking_status='booked' and (p_id is null or v.booking_status<>'booked') then
    if not p_admin then c.booked_by_member_id:=p_actor;
    elsif not p_patch ? 'booked_by_member_id' then c.booked_by_member_id:=coalesce(case when c.organizer_mode='override' then c.organizer_id else (select member_id from public.weekly_booking_assignments where c.session_date between week_start and week_end) end,p_actor); end if;
  end if;
  if p_id is null then
    insert into public.sessions(session_date,start_time,end_time,venue,court,address,maps_url,organizer_id,organizer_mode,booking_status,max_players,note,deadline,estimated_cost,booking_contact_note,deposit_note,booked_by_member_id)
    values(c.session_date,c.start_time,c.end_time,c.venue,c.court,c.address,c.maps_url,c.organizer_id,c.organizer_mode,c.booking_status,c.max_players,c.note,c.deadline,c.estimated_cost,c.booking_contact_note,c.deposit_note,c.booked_by_member_id) returning id into p_id;
  else
    update public.sessions set session_date=c.session_date,start_time=c.start_time,end_time=c.end_time,venue=c.venue,court=c.court,address=c.address,maps_url=c.maps_url,
      organizer_id=c.organizer_id,organizer_mode=c.organizer_mode,booking_status=c.booking_status,max_players=c.max_players,note=c.note,deadline=c.deadline,
      estimated_cost=c.estimated_cost,booking_contact_note=c.booking_contact_note,deposit_note=c.deposit_note,booked_by_member_id=c.booked_by_member_id,version=v.version+1 where id=p_id;
  end if;
  return p_id;
end;
$$;
create or replace function public.save_session(p_id uuid,p_patch jsonb,p_expected_version integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  perform private.require_admin(); perform private.booking_lock(); mid:=private.require_booking_actor(null);
  return private.write_booking_session(p_id,p_patch,p_expected_version,mid,true);
end;
$$;
create or replace function public.update_booking_session(p_id uuid,p_patch jsonb,p_expected_version integer,p_token text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  return private.write_booking_session(p_id,p_patch,p_expected_version,mid,public.is_admin());
end;
$$;
create or replace function public.copy_week(p_week_start date) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform private.require_admin(); perform private.booking_lock();
  if extract(isodow from p_week_start)<>1 then raise exception 'Tuần phải bắt đầu vào thứ Hai.'; end if;
  insert into public.sessions(session_date,start_time,end_time,venue,court,address,maps_url,organizer_id,organizer_mode,booking_status,max_players,note,deadline,copied_from,estimated_cost,booking_contact_note,deposit_note)
  select session_date+7,start_time,end_time,venue,court,address,maps_url,case when organizer_mode='override' then organizer_id end,organizer_mode,'pending',max_players,note,
    case when deadline is null then null else deadline+interval '7 days' end,id,estimated_cost,booking_contact_note,''
  from public.sessions where session_date>=p_week_start and session_date<p_week_start+7 and booking_status<>'cancelled'
  on conflict(copied_from,session_date) do nothing;
  get diagnostics n=row_count;
  return n;
end;
$$;
create or replace function public.save_session_template(p_name text,p_template jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare k text; tid uuid;
begin
  perform private.require_admin();
  if p_template is null or jsonb_typeof(p_template)<>'object' then raise exception 'Mẫu lịch không hợp lệ.'; end if;
  for k in select jsonb_object_keys(p_template) loop
    if k not in ('start_time','end_time','venue','court','address','maps_url','organizer_id','organizer_mode','max_players','note','estimated_cost','booking_contact_note') then raise exception 'Mẫu lịch chứa trường không hợp lệ.'; end if;
  end loop;
  if coalesce(length(trim(p_template->>'venue')),0) not between 1 and 160 or coalesce(length(trim(p_template->>'court')),0) not between 1 and 80 then raise exception 'Nhập tên sân và ca/sân cho mẫu.'; end if;
  if (p_template->>'start_time')::time is null or (p_template->>'end_time')::time is null or (p_template->>'end_time')::time<=(p_template->>'start_time')::time then raise exception 'Giờ kết thúc phải sau giờ bắt đầu.'; end if;
  insert into public.session_templates(name,template) values(trim(p_name),p_template) on conflict(name) do update set template=excluded.template,updated_at=now() returning id into tid;
  return tid;
end;
$$;

-- All app writers acquire the responsibility lock before taking session/member locks.
-- Attendance only updates going_count and does not acquire this lock.
create or replace function public.save_member(p_id uuid,p_patch jsonb,p_expected_version integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.members; k text;
begin
  perform private.require_admin(); perform private.booking_lock();
  for k in select jsonb_object_keys(p_patch) loop if k not in ('display_name','note','active') then raise exception 'Trường thành viên không hợp lệ.'; end if; end loop;
  if p_id is null then
    insert into public.members(display_name,note,active) values(trim(p_patch->>'display_name'),coalesce(p_patch->>'note',''),coalesce((p_patch->>'active')::boolean,true)) returning id into p_id;
  else
    select * into v from public.members where id=p_id for update;
    if not found then raise exception 'Không tìm thấy thành viên.'; end if;
    if v.version is distinct from p_expected_version then raise exception 'Dữ liệu thành viên đã thay đổi. Hãy mở lại biểu mẫu.' using errcode='40001'; end if;
    if p_patch->>'active'='false' and exists(select 1 from public.account_links where member_id=p_id and user_id=auth.uid()) then raise exception 'Không thể ngừng hoạt động tài khoản của chính bạn.'; end if;
    update public.members set display_name=coalesce(trim(p_patch->>'display_name'),v.display_name),note=coalesce(p_patch->>'note',v.note),active=coalesce((p_patch->>'active')::boolean,v.active),version=v.version+1 where id=p_id;
  end if;
  return p_id;
end;
$$;
create or replace function public.delete_member(p_id uuid,p_expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare v public.members;
begin
  perform private.require_admin(); perform private.booking_lock();
  select * into v from public.members where id=p_id for update;
  if not found then raise exception 'Không tìm thấy thành viên.'; end if;
  if v.version is distinct from p_expected_version then raise exception 'Dữ liệu đã thay đổi. Hãy thử lại.' using errcode='40001'; end if;
  if exists(select 1 from public.attendance where member_id=p_id) or exists(select 1 from public.sessions where organizer_id=p_id or booked_by_member_id=p_id)
    or exists(select 1 from public.account_links where member_id=p_id)
    or exists(select 1 from public.weekly_booking_assignments where member_id=p_id or original_member_id=p_id or completed_member_id=p_id)
    or exists(select 1 from public.booking_rotation_members where member_id=p_id and initial_completed_count>0)
    or exists(select 1 from public.booking_history where actor_member_id=p_id or requested_by_member_id=p_id or confirmed_by_member_id=p_id)
    or exists(select 1 from public.booking_notifications where member_id=p_id) then
    raise exception 'Thành viên có lịch sử đặt sân, tham gia hoặc tài khoản. Hãy chọn Ngừng hoạt động để bảo toàn dữ liệu.';
  end if;
  delete from public.members where id=p_id;
end;
$$;
create or replace function private.booking_member_after() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.active and not new.active then
    delete from private.booking_invites where member_id=new.id;
    delete from private.booking_devices where member_id=new.id;
    update public.booking_swap_requests set status='invalid',responded_at=now(),resolution_reason='Một thành viên đã ngừng hoạt động; liên hệ quản trị viên.' where status='pending' and new.id in (from_member_id,to_member_id);
  end if;
  return null;
end;
$$;
drop trigger if exists booking_member_after on public.members;
create trigger booking_member_after after update on public.members for each row execute function private.booking_member_after();
create or replace function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; fields text[]; actor text; mid uuid;
begin
  if TG_OP<>'INSERT' then b:=to_jsonb(old); end if;
  if TG_OP<>'DELETE' then a:=to_jsonb(new); end if;
  select array_agg(k order by k) into fields from (select key as k from jsonb_object_keys(coalesce(a,b)) key where (a->key) is distinct from (b->key)) x;
  if TG_TABLE_NAME='sessions' and TG_OP='UPDATE' and (fields is null or fields=array['going_count']) then return new; end if;
  mid:=nullif(current_setting('app.booking_member_id',true),'')::uuid;
  if mid is not null then select display_name||' · đã xác minh' into actor from public.members where id=mid;
  else
    mid:=nullif(current_setting('app.quick_member_id',true),'')::uuid;
    if mid is not null then select display_name||' · chọn tên' into actor from public.members where id=mid;
    else select m.display_name into actor from public.account_links l join public.members m on m.id=l.member_id where l.user_id=auth.uid(); end if;
  end if;
  insert into public.audit_log(actor_id,actor_name,action,table_name,record_id,changed_fields,before_data,after_data)
  values(auth.uid(),coalesce(actor,'Quản trị hệ thống'),TG_OP,TG_TABLE_NAME,coalesce((a->>'id')::uuid,(b->>'id')::uuid,(a->>'user_id')::uuid,(b->>'user_id')::uuid),coalesce(fields,'{}'),b,a);
  if TG_OP='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.mark_booking_notifications(p_ids uuid[],p_token text default null) returns void language plpgsql security definer set search_path='' as $$
declare mid uuid;
begin
  perform private.booking_lock();
  mid:=private.require_booking_actor(p_token);
  if cardinality(p_ids)>200 then raise exception 'Chỉ đánh dấu tối đa 200 thông báo.'; end if;
  if exists(select 1 from unnest(p_ids) id where not exists(select 1 from public.booking_notifications n where n.id=id and n.member_id=mid)) then raise exception 'Bạn chỉ được xử lý thông báo của mình.' using errcode='42501'; end if;
  update public.booking_notifications set read_at=now() where member_id=mid and id=any(p_ids) and read_at is null;
end;
$$;
create or replace function public.get_public_schedule() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('organizer_name',coalesce(m.display_name,'Chưa phân công'),
    'booked_by_name',b.display_name,'weekly_member_id',w.member_id,
    'going_count',(select count(*) from public.attendance a where a.session_id=s.id and a.status='going')) order by s.session_date,s.start_time),'[]')
  from public.sessions s left join public.members m on m.id=s.organizer_id left join public.members b on b.id=s.booked_by_member_id
  left join public.weekly_booking_assignments w on s.session_date between w.week_start and w.week_end;
$$;
create or replace function public.get_quick_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',2,'sessions',public.get_public_schedule(),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.code) from public.members m),'[]'),
    'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from public.attendance a),'[]'),
    'roster',coalesce((select jsonb_agg(to_jsonb(r)) from public.session_roster r),'[]'));
$$;
create or replace function public.get_booking_snapshot(p_token text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare mid uuid:=private.booking_actor(p_token); admin boolean:=public.is_admin(); result jsonb;
begin
  if exists(select 1 from public.booking_swap_requests r join public.weekly_booking_assignments a on a.id=r.from_assignment_id where r.status='pending' and a.week_end<private.vn_today()) then
    perform private.booking_lock(); perform set_config('app.booking_system','true',true);
    update public.booking_swap_requests r set status='invalid',responded_at=now(),resolution_reason='Tuần đã kết thúc; yêu cầu cũ không còn hiệu lực.'
    from public.weekly_booking_assignments a where a.id=r.from_assignment_id and r.status='pending' and a.week_end<private.vn_today();
    perform set_config('app.booking_system','false',true);
  end if;
  -- A single SQL snapshot keeps BOTH weeks and all inherited sessions consistent.
  select jsonb_build_object(
    'revision',s.revision,'initialized',s.initialized,'setup_issues',s.setup_issues,
    'realtime_enabled',exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='booking_sync'),
    'verified_member_id',mid,'identity_source',case when exists(select 1 from public.account_links where user_id=auth.uid() and member_id=mid) then 'account' when mid is not null then 'code' end,
    'identity_expired',nullif(p_token,'') is not null and mid is null,
    'club',public.get_quick_snapshot(),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('pending_swap_count',(select count(*) from public.booking_swap_requests r where r.status='pending' and a.id in (r.from_assignment_id,r.to_assignment_id))) order by a.week_start) from public.weekly_booking_assignments a),'[]'),
    'rotation',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('completed_count',st.completed_count,'planned_count',st.planned_count,'last_week',st.last_week) order by r.sort_order,m.code)
      from public.booking_rotation_members r join public.members m on m.id=r.member_id join private.booking_statistics(private.vn_today()-extract(isodow from private.vn_today())::integer+1) st on st.member_id=r.member_id),'[]'),
    'requests',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('from_week_start',a.week_start,'from_week_end',a.week_end,'to_week_start',b.week_start,'to_week_end',b.week_end) order by r.created_at desc)
      from public.booking_swap_requests r join public.weekly_booking_assignments a on a.id=r.from_assignment_id join public.weekly_booking_assignments b on b.id=r.to_assignment_id
      where admin or mid in (r.from_member_id,r.to_member_id)),'[]'),
    'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from (select * from public.booking_notifications where member_id=mid order by created_at desc limit 100) n),'[]'),
    'history',case when mid is null and not admin then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from (select * from public.booking_history order by id desc limit 200) h),'[]') end,
    'credential_status',case when not admin then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('member_id',m.id,'devices',(select count(*) from private.booking_devices d where d.member_id=m.id and d.expires_at>now()),'invite_pending',exists(select 1 from private.booking_invites i where i.member_id=m.id and i.expires_at>now()))) from public.members m),'[]') end
  ) into result from public.booking_sync s where id=1;
  return result;
end;
$$;

-- RLS + denied direct writes. A public revision signal carries NO token, reason,
-- notification, or identity. Token-authenticated clients fetch their own RPC view.
do $$ declare t text; begin
  foreach t in array array['booking_sync','booking_rotation_members','weekly_booking_assignments','booking_swap_requests','booking_notifications','booking_history'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
  end loop;
  foreach t in array array['booking_sync','booking_rotation_members','weekly_booking_assignments'] loop
    execute format('grant select on public.%I to anon,authenticated',t);
    execute format('drop policy if exists booking_public_read on public.%I',t);
    execute format('create policy booking_public_read on public.%I for select to anon,authenticated using(true)',t);
  end loop;
  foreach t in array array['booking_rotation_members','weekly_booking_assignments','booking_swap_requests','booking_notifications','booking_history','members','sessions'] loop
    execute format('drop trigger if exists booking_sync_touch on public.%I',t);
    execute format('create trigger booking_sync_touch after insert or update or delete on public.%I for each row execute function private.booking_touch()',t);
  end loop;
  foreach t in array array['booking_invites','booking_devices'] loop
    execute format('drop trigger if exists booking_sync_touch on private.%I',t);
    execute format('create trigger booking_sync_touch after insert or update or delete on private.%I for each row execute function private.booking_touch()',t);
  end loop;
end $$;
revoke all on all tables in schema private from public,anon,authenticated;
revoke execute on all functions in schema private from public,anon,authenticated;
revoke execute on function public.issue_booking_code(uuid,boolean),public.activate_booking_identity(text),public.end_booking_identity(text),public.request_booking_swap(uuid,text,text,integer,integer),public.respond_booking_swap(uuid,text,text),public.cancel_booking_swap(uuid,text),public.save_booking_assignment(date,uuid,integer,text,boolean),public.complete_booking_week(uuid,integer,text),public.admin_swap_booking_weeks(uuid,text,integer,integer),public.save_booking_rotation(uuid,jsonb,integer),public.propose_booking_assignments(date,integer),public.apply_booking_proposal(jsonb,bigint,text),public.initialize_booking_schedule(jsonb),public.update_booking_session(uuid,jsonb,integer,text),public.mark_booking_notifications(uuid[],text),public.get_booking_snapshot(text) from public,anon,authenticated;
grant execute on function public.activate_booking_identity(text),public.end_booking_identity(text),public.request_booking_swap(uuid,text,text,integer,integer),public.respond_booking_swap(uuid,text,text),public.cancel_booking_swap(uuid,text),public.complete_booking_week(uuid,integer,text),public.update_booking_session(uuid,jsonb,integer,text),public.mark_booking_notifications(uuid[],text),public.get_booking_snapshot(text) to anon,authenticated;
grant execute on function public.issue_booking_code(uuid,boolean),public.save_booking_assignment(date,uuid,integer,text,boolean),public.admin_swap_booking_weeks(uuid,text,integer,integer),public.save_booking_rotation(uuid,jsonb,integer),public.propose_booking_assignments(date,integer),public.apply_booking_proposal(jsonb,bigint,text),public.initialize_booking_schedule(jsonb) to authenticated;
-- CREATE OR REPLACE retains the already restricted grants of existing RPCs.

-- REALTIME: deployment-only block, omitted by local PostgreSQL tests.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='booking_sync') then
    alter publication supabase_realtime add table public.booking_sync;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
