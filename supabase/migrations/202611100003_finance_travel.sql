-- Run after 202611100002_booking_responsibility.sql. No historical money is seeded.
begin;

create or replace function private.require_booking_actor(p_token text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid:=private.booking_actor(p_token);
begin
  if mid is null then raise exception 'Hãy xác minh bằng mã cá nhân do quản trị viên cấp trước khi thao tác.' using errcode='42501'; end if;
  perform set_config('app.booking_member_id',mid::text,true);
  return mid;
end; $$;

create table if not exists public.club_activities (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('badminton','trip')),
  title text not null check(length(trim(title)) between 1 and 180), organizer_id uuid references public.members(id) on delete restrict,
  details jsonb not null default '{}', status text not null default 'planning' check(status in ('planning','open','closed','completed','cancelled')),
  fee_status text not null default 'draft' check(fee_status in ('draft','finalized')), rounding integer not null default 1 check(rounding in (1,1000)),
  reserve bigint not null default 0 check(reserve between 0 and 100000000000), cost_note text not null default '',
  final_summary jsonb, version integer not null default 1, created_at timestamptz not null default now()
);
create table if not exists public.activity_groups (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.club_activities(id) on delete restrict,
  session_id uuid not null unique references public.sessions(id) on delete restrict,
  label text not null check(length(trim(label)) between 1 and 100), basis text not null check(basis in ('single','shift','court')), sort_order integer not null
);
create table if not exists public.activity_billable (
  group_id uuid not null references public.activity_groups(id), member_id uuid not null references public.members(id) on delete restrict,
  included boolean not null, primary key(group_id,member_id)
);
create table if not exists public.trip_participants (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.club_activities(id),
  member_id uuid references public.members(id) on delete restrict, invited_by uuid references public.members(id) on delete restrict,
  guest_name text not null default '', status text not null default 'unanswered' check(status in ('going','not_going','unanswered')),
  note text not null default '' check(length(note)<=2000), billable boolean not null default true,
  share_units integer not null default 1000 check(share_units between 0 and 100000), share_reason text not null default '',
  version integer not null default 1, updated_at timestamptz not null default now(),
  check((member_id is not null and invited_by is null and guest_name='') or (member_id is null and invited_by is not null and length(trim(guest_name)) between 1 and 120)),
  check(share_units=1000 or length(trim(share_reason))>0), unique(activity_id,member_id)
);
create unique index if not exists trip_guest_identity on public.trip_participants(activity_id,invited_by,lower(trim(guest_name))) where member_id is null;
create table if not exists public.activity_expenses (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.club_activities(id),
  name text not null check(length(trim(name)) between 1 and 180), category text not null check(category in ('court','shuttle','accommodation','equipment','food','transport','tickets','other')),
  estimated bigint not null default 0 check(estimated between 0 and 100000000000), actual bigint not null default 0 check(actual between 0 and 100000000000),
  scope text not null default 'all' check(scope in ('all','group','selected')), group_id uuid references public.activity_groups(id), person_ids uuid[] not null default '{}',
  paid_from text not null default 'unpaid' check(paid_from in ('unpaid','fund','personal')), payer_member_id uuid references public.members(id) on delete restrict,
  note text not null default '', version integer not null default 1, voided_at timestamptz, check(paid_from<>'personal' or payer_member_id is not null),
  check((scope='group' and group_id is not null) or (scope<>'group' and group_id is null)), check(scope<>'selected' or cardinality(person_ids)>0)
);
create table if not exists public.activity_ledger (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.club_activities(id), operation_id uuid not null unique,
  kind text not null check(kind in ('collection','supplement','refund','reimbursement')), person_id uuid,
  payee_member_id uuid references public.members(id) on delete restrict,
  amount bigint not null check(amount between 1 and 100000000000), note text not null default '',
  confirmed_by uuid not null references public.members(id) on delete restrict, created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references public.members(id) on delete restrict, void_reason text not null default '',
  check((kind='reimbursement' and payee_member_id is not null and person_id is null) or (kind<>'reimbursement' and person_id is not null and payee_member_id is null))
);
create table if not exists public.activity_finalizations (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.club_activities(id),
  summary jsonb not null, confirmed_by uuid not null references public.members(id), reason text not null, created_at timestamptz not null default now()
);
create table if not exists public.trip_checklist (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.club_activities(id), name text not null check(length(trim(name)) between 1 and 180),
  quantity numeric(12,3) not null default 1 check(quantity>0), unit text not null default '', responsible_id uuid references public.members(id) on delete restrict,
  status text not null default 'todo' check(status in ('todo','preparing','done')), note text not null default '',
  expense_id uuid references public.activity_expenses(id), version integer not null default 1, voided_at timestamptz
);
create table if not exists public.finance_history (
  id bigint generated always as identity primary key, activity_id uuid not null references public.club_activities(id),
  actor_member_id uuid not null references public.members(id) on delete restrict, actor_name text not null,
  action text not null, table_name text not null, record_id uuid not null, before_data jsonb, after_data jsonb,
  reason text not null default '', created_at timestamptz not null default now()
);
create index if not exists finance_history_activity on public.finance_history(activity_id,id desc);
create index if not exists expense_activity on public.activity_expenses(activity_id);
create index if not exists participant_activity on public.trip_participants(activity_id);
create index if not exists ledger_activity on public.activity_ledger(activity_id,person_id);

create or replace function private.finance_preserve_member() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.club_activities where organizer_id=old.id)
    or exists(select 1 from public.activity_billable where member_id=old.id)
    or exists(select 1 from public.trip_participants where member_id=old.id or invited_by=old.id)
    or exists(select 1 from public.activity_expenses where payer_member_id=old.id)
    or exists(select 1 from public.activity_ledger where confirmed_by=old.id or payee_member_id=old.id or voided_by=old.id)
    or exists(select 1 from public.finance_history where actor_member_id=old.id) then
    raise exception 'Thành viên đã có lịch sử tài chính hoặc chuyến đi. Hãy chuyển sang Ngừng hoạt động để giữ dữ liệu.';
  end if;
  return old;
end; $$;
drop trigger if exists finance_preserve_member on public.members;
create trigger finance_preserve_member before delete on public.members for each row execute function private.finance_preserve_member();

create or replace function private.finance_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare mid uuid:=nullif(current_setting('app.booking_member_id',true),'')::uuid; aid uuid; rid uuid; row_data jsonb;
begin
  row_data:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  aid:=(row_data->>case when TG_TABLE_NAME='club_activities' then 'id' else 'activity_id' end)::uuid;
  rid:=(row_data->>'id')::uuid;
  insert into public.finance_history(activity_id,actor_member_id,actor_name,action,table_name,record_id,before_data,after_data,reason)
  select aid,mid,m.display_name,TG_OP,TG_TABLE_NAME,rid,case when TG_OP<>'INSERT' then to_jsonb(old) end,case when TG_OP<>'DELETE' then to_jsonb(new) end,coalesce(current_setting('app.finance_reason',true),'') from public.members m where m.id=mid;
  if mid is null then raise exception 'Thao tác tài chính cần danh tính đã xác minh.' using errcode='42501'; end if;
  return null;
end; $$;
create or replace function private.finance_access(p_id uuid,p_token text,p_draft boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid; a public.club_activities;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into a from public.club_activities where id=p_id for update;
  if not found then raise exception 'Không tìm thấy hoạt động.'; end if;
  if not public.is_admin() and not coalesce(a.organizer_id=mid or (a.kind='badminton' and a.organizer_id is null and exists(select 1 from public.activity_groups g join public.sessions s on s.id=g.session_id where g.activity_id=a.id) and not exists(select 1 from public.activity_groups g join public.sessions s on s.id=g.session_id where g.activity_id=a.id and s.organizer_id is distinct from mid)),false) then raise exception 'Chỉ người phụ trách đã xác minh hoặc quản trị viên được quản lý tài chính.' using errcode='42501'; end if;
  if p_draft and a.fee_status='finalized' then raise exception 'Bảng phí đã chốt. Mở lại với lý do trước khi sửa chi phí hoặc người chịu phí.'; end if;
  return mid;
end; $$;
create or replace function private.finance_version(p_id uuid,p_version integer) returns void language plpgsql set search_path='' as $$
begin
  if p_version is distinct from (select version from public.club_activities where id=p_id) then raise exception 'Dữ liệu đã thay đổi trên thiết bị khác. Mở lại biểu mẫu để đối chiếu.' using errcode='40001'; end if;
end; $$;
create or replace function private.finance_people(p_id uuid) returns table(id uuid,member_id uuid,name text,units integer,groups uuid[]) language sql stable security definer set search_path='' as $$
  select m.id,m.id,m.display_name,1000,array_agg(g.id order by g.sort_order)
  from public.club_activities a join public.activity_groups g on g.activity_id=a.id cross join public.members m
  left join public.attendance t on t.session_id=g.session_id and t.member_id=m.id
  left join public.activity_billable b on b.group_id=g.id and b.member_id=m.id
  where a.id=p_id and a.kind='badminton' and coalesce(b.included,t.status='going',false) group by m.id
  union all
  select p.id,p.member_id,coalesce(m.display_name,p.guest_name),p.share_units,'{}'::uuid[]
  from public.trip_participants p join public.club_activities a on a.id=p.activity_id left join public.members m on m.id=p.member_id
  where a.id=p_id and a.kind='trip' and p.status='going' and p.billable;
$$;
-- All arithmetic is PostgreSQL integer/numeric; no floating-point amounts.
create or replace function private.finance_calculate(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; a public.club_activities;
begin
  select * into a from public.club_activities where id=p_id;
  with people as (select * from private.finance_people(p_id)), expenses as (select * from public.activity_expenses where activity_id=p_id and voided_at is null),
  targets as (
    select e.id expense_id,p.id person_id,p.units,e.actual, sum(p.units) over(partition by e.id) total_units,row_number() over(partition by e.id order by p.id) rn
    from expenses e join people p on p.units>0 and (e.scope='all' or (e.scope='group' and e.group_id=any(p.groups)) or (e.scope='selected' and p.id=any(e.person_ids)))
  ), base as (select *,floor(actual::numeric*units/total_units)::bigint amount from targets),
  shares as (select *,amount+case when rn<=actual-sum(amount) over(partition by expense_id) then 1 else 0 end allocated from base),
  owed as (
    select p.*,coalesce((select sum(allocated) from shares where person_id=p.id),0)::bigint exact from people p
    union all
    select m.id,m.id,m.display_name,0,'{}'::uuid[],0::bigint from public.members m
    where a.kind='badminton' and not exists(select 1 from people p where p.id=m.id)
      and exists(select 1 from public.activity_ledger l where l.activity_id=p_id and l.person_id=m.id)
  ),
  rounded as (select *, (ceil(exact::numeric/a.rounding)*a.rounding)::bigint due from owed)
  select jsonb_build_object(
    'total_cost',coalesce((select sum(actual) from expenses),0),'estimated',coalesce((select sum(estimated) from expenses),0),
    'headcount',(select count(*) from people),'shares',coalesce((select sum(units)::numeric/1000 from people),0),
    'total_due',coalesce((select sum(due) from rounded),0),'surplus',coalesce((select sum(due-exact) from rounded),0),
    'people',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from rounded r),'[]'),
    'breakdown',coalesce((select jsonb_agg(jsonb_build_object('expense_id',e.id,'name',e.name,'scope',e.scope,'group_id',e.group_id,'amount',e.actual,'heads',(select count(*) from targets where expense_id=e.id),'units',coalesce((select max(total_units) from targets where expense_id=e.id),0),'allocations',coalesce((select jsonb_agg(jsonb_build_object('person_id',person_id,'amount',allocated) order by person_id) from shares where expense_id=e.id),'[]')) order by e.id) from expenses e),'[]'),
    'warnings',coalesce((select jsonb_agg(e.name||': có chi phí nhưng chưa có người được phân bổ') from expenses e where e.actual>0 and not exists(select 1 from targets where expense_id=e.id)),'[]') || case when not exists(select 1 from people where units>0) then '["Chưa đủ dữ liệu để chia tiền"]'::jsonb else '[]'::jsonb end
  ) into result;
  return result;
end; $$;

create or replace function public.create_club_activity(p_kind text,p_title text,p_sessions jsonb default '[]',p_details jsonb default '{}',p_token text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid; aid uuid; g jsonb; sid uuid; n integer:=0; firstdate date; owner uuid;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  if p_kind not in ('badminton','trip') then raise exception 'Loại hoạt động không hợp lệ.'; end if;
  if p_kind='trip' and not public.is_admin() then raise exception 'Quản trị viên tạo chuyến đi và giao người phụ trách.' using errcode='42501'; end if;
  if p_kind='badminton' then
    if jsonb_typeof(p_sessions)<>'array' or jsonb_array_length(p_sessions) not between 1 and 12 then raise exception 'Chọn từ 1 đến 12 nhóm tham gia.'; end if;
    for g in select value from jsonb_array_elements(p_sessions) loop
      sid:=(g->>'session_id')::uuid;
      if not exists(select 1 from public.sessions where id=sid and booking_status<>'cancelled' and (public.is_admin() or organizer_id=mid)) then raise exception 'Bạn không phụ trách ca/sân này.' using errcode='42501'; end if;
      if firstdate is null then select session_date into firstdate from public.sessions where id=sid; end if;
      if not exists(select 1 from public.sessions where id=sid and session_date=firstdate) then raise exception 'Các nhóm chia chung một buổi cần cùng ngày.'; end if;
    end loop;
  end if;
  owner:=case when p_kind='trip' then coalesce((p_details->>'organizer_id')::uuid,mid) else null end;
  if owner is not null and not exists(select 1 from public.members where id=owner and active) then raise exception 'Người phụ trách phải còn hoạt động.'; end if;
  insert into public.club_activities(kind,title,organizer_id,details) values(p_kind,trim(p_title),owner,'{}') returning id into aid;
  if p_kind='badminton' then
    for g in select value from jsonb_array_elements(p_sessions) loop
      insert into public.activity_groups(activity_id,session_id,label,basis,sort_order) values(aid,(g->>'session_id')::uuid,g->>'label',g->>'basis',n); n:=n+1;
    end loop;
  elsif p_details-'organizer_id'<>'{}'::jsonb then
    perform public.save_activity(aid,jsonb_build_object('details',p_details-'organizer_id'),1,p_token);
  end if;
  return aid;
end; $$;

create or replace function public.save_activity(p_id uuid,p_patch jsonb,p_expected_version integer,p_token text default null) returns void language plpgsql security definer set search_path='' as $$
declare mid uuid; a public.club_activities; k text; d jsonb; day_row jsonb;
begin
  mid:=private.finance_access(p_id,p_token); perform private.finance_version(p_id,p_expected_version); select * into a from public.club_activities where id=p_id;
  for k in select jsonb_object_keys(p_patch) loop if k not in ('title','organizer_id','details','status','rounding','reserve','cost_note') then raise exception 'Trường hoạt động không hợp lệ.'; end if; end loop;
  if p_patch ? 'organizer_id' then perform private.require_admin(); if (a.kind='trip' or p_patch->>'organizer_id' is not null) and not exists(select 1 from public.members where id=(p_patch->>'organizer_id')::uuid and active) then raise exception 'Chọn người phụ trách đang hoạt động.'; end if; end if;
  if a.fee_status='finalized' and (p_patch ? 'rounding' or p_patch ? 'cost_note') then raise exception 'Mở lại bảng phí trước khi sửa.'; end if;
  if p_patch?'details' and jsonb_typeof(p_patch->'details')<>'object' then raise exception 'Thông tin chuyến đi phải là một đối tượng.'; end if;
  d:=a.details||coalesce(p_patch->'details','{}');
  for k in select jsonb_object_keys(d) loop if k not in ('description','cover_url','location','address','maps_url','start_date','end_date','itinerary','budget_per_person','deadline','note','reserve_decision') then raise exception 'Thông tin chuyến đi không hợp lệ.'; end if; end loop;
  if coalesce(d->>'maps_url','')<>'' and d->>'maps_url' !~ '^https://' then raise exception 'Liên kết bản đồ phải dùng https.'; end if;
  if coalesce(d->>'cover_url','')<>'' and d->>'cover_url' !~ '^https://' then raise exception 'Ảnh bìa phải là liên kết https.'; end if;
  if nullif(d->>'start_date','') is not null then perform (d->>'start_date')::date; end if;
  if nullif(d->>'end_date','') is not null then perform (d->>'end_date')::date; end if;
  if d?'itinerary' then
    if jsonb_typeof(d->'itinerary')<>'array' or jsonb_array_length(d->'itinerary')>60 then raise exception 'Lịch trình phải là danh sách tối đa 60 ngày.'; end if;
    for day_row in select value from jsonb_array_elements(d->'itinerary') loop
      if jsonb_typeof(day_row)<>'object' or jsonb_typeof(day_row->'content') is distinct from 'string' or jsonb_typeof(day_row->'day') is distinct from 'string' then raise exception 'Mỗi ngày cần ngày và nội dung lịch trình.'; end if;
      if nullif(day_row->>'day','') is not null then perform (day_row->>'day')::date; end if;
    end loop;
  end if;
  if (d->>'budget_per_person') is not null and ((d->>'budget_per_person') !~ '^\d+$' or (d->>'budget_per_person')::numeric>100000000000) then raise exception 'Ngân sách phải là số đồng nguyên không âm.'; end if;
  if nullif(d->>'start_date','') is not null and nullif(d->>'end_date','') is not null and (d->>'end_date')::date<(d->>'start_date')::date then raise exception 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.'; end if;
  if nullif(d->>'deadline','') is not null then perform (d->>'deadline')::timestamptz; end if;
  update public.club_activities set title=coalesce(trim(p_patch->>'title'),title),organizer_id=case when p_patch?'organizer_id' then (p_patch->>'organizer_id')::uuid else organizer_id end,
    details=d,status=coalesce(p_patch->>'status',status),rounding=coalesce((p_patch->>'rounding')::integer,rounding),reserve=coalesce((p_patch->>'reserve')::bigint,reserve),cost_note=coalesce(p_patch->>'cost_note',cost_note),version=version+1 where id=p_id;
end; $$;

-- Only one group/member field is patched per write. No client submits an entire roster.
create or replace function public.set_activity_billable(p_group uuid,p_member uuid,p_included boolean,p_expected_revision bigint,p_token text default null) returns void language plpgsql security definer set search_path='' as $$
declare aid uuid; previous boolean;
begin
  select activity_id into aid from public.activity_groups where id=p_group;
  perform private.finance_access(aid,p_token,true);
  if p_expected_revision is distinct from (select revision from public.booking_sync where id=1) then raise exception 'Danh sách vừa thay đổi. Hãy kiểm tra lại trước khi lưu.' using errcode='40001'; end if;
  select included into previous from public.activity_billable where group_id=p_group and member_id=p_member;
  if p_included is null then delete from public.activity_billable where group_id=p_group and member_id=p_member;
  else insert into public.activity_billable values(p_group,p_member,p_included) on conflict(group_id,member_id) do update set included=excluded.included; end if;
  update public.club_activities set version=version+1 where id=aid;
  insert into public.finance_history(activity_id,actor_member_id,actor_name,action,table_name,record_id,before_data,after_data)
  select aid,m.id,m.display_name,'BILLABLE','activity_billable',p_group,jsonb_build_object('member_id',p_member,'included',previous),jsonb_build_object('member_id',p_member,'included',p_included) from public.members m where m.id=private.booking_actor(p_token);
end; $$;

create or replace function public.save_activity_expense(p_activity uuid,p_id uuid,p_patch jsonb,p_expected_version integer default null,p_reason text default '',p_token text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.activity_expenses; k text; ids uuid[];
begin
  perform private.finance_access(p_activity,p_token,true); perform set_config('app.finance_reason',p_reason,true);
  for k in select jsonb_object_keys(p_patch) loop if k not in ('name','category','estimated','actual','scope','group_id','person_ids','paid_from','payer_member_id','note','void') then raise exception 'Trường chi phí không hợp lệ.'; end if; end loop;
  if p_id is not null then
    select * into e from public.activity_expenses where id=p_id and activity_id=p_activity and voided_at is null for update;
    if not found then raise exception 'Khoản chi không tồn tại hoặc đã hủy.'; end if;
    if p_expected_version is distinct from e.version then raise exception 'Khoản chi vừa được sửa. Mở lại để đối chiếu.' using errcode='40001'; end if;
    if e.paid_from='personal' and exists(select 1 from public.activity_ledger where activity_id=p_activity and kind='reimbursement' and payee_member_id=e.payer_member_id and voided_at is null) and (p_patch ? 'actual' or p_patch ? 'paid_from' or p_patch ? 'payer_member_id' or p_patch ? 'void') then raise exception 'Đã hoàn ứng cho người này. Hủy bản ghi hoàn ứng trước khi điều chỉnh khoản ứng.'; end if;
    if (p_patch->>'void')::boolean then
      if length(trim(p_reason))=0 then raise exception 'Nhập lý do hủy khoản chi.'; end if;
      update public.activity_expenses set voided_at=now(),version=version+1 where id=p_id; return p_id;
    end if;
  else e.activity_id:=p_activity; e.name:='';e.category:='other';e.estimated:=0;e.actual:=0;e.scope:='all';e.person_ids:='{}';e.paid_from:='unpaid';e.note:=''; end if;
  e:=jsonb_populate_record(e,p_patch-'void');
  if e.scope='group' and not exists(select 1 from public.activity_groups where id=e.group_id and activity_id=p_activity) then raise exception 'Nhóm chia tiền không thuộc hoạt động này.'; end if;
  if e.scope<>'group' then e.group_id:=null; end if;
  if e.category='court' and e.scope<>'group' then raise exception 'Tiền sân phải phân bổ riêng theo nhóm ca/sân.'; end if;
  if e.scope='selected' and exists(select 1 from unnest(e.person_ids) x where not exists(select 1 from public.trip_participants where id=x and activity_id=p_activity)) then raise exception 'Người được chọn không thuộc chuyến này.'; end if;
  if p_id is null then
    insert into public.activity_expenses(activity_id,name,category,estimated,actual,scope,group_id,person_ids,paid_from,payer_member_id,note) values(p_activity,e.name,e.category,e.estimated,e.actual,e.scope,e.group_id,e.person_ids,e.paid_from,e.payer_member_id,e.note) returning id into p_id;
  else update public.activity_expenses set name=e.name,category=e.category,estimated=e.estimated,actual=e.actual,scope=e.scope,group_id=e.group_id,person_ids=e.person_ids,paid_from=e.paid_from,payer_member_id=e.payer_member_id,note=e.note,version=version+1 where id=p_id; end if;
  return p_id;
end; $$;

create or replace function public.set_activity_fee_state(p_id uuid,p_action text,p_expected_revision bigint,p_reason text default '',p_token text default null) returns void language plpgsql security definer set search_path='' as $$
declare mid uuid; a public.club_activities; s jsonb;
begin
  mid:=private.finance_access(p_id,p_token); select * into a from public.club_activities where id=p_id;
  if p_expected_revision is distinct from (select revision from public.booking_sync where id=1) then raise exception 'Dữ liệu vừa thay đổi. Xem lại bảng tính mới nhất trước khi chốt hoặc mở lại.' using errcode='40001'; end if;
  perform set_config('app.finance_reason',p_reason,true);
  if p_action='finalize' and a.fee_status='draft' then
    s:=private.finance_calculate(p_id);
    if jsonb_array_length(s->'warnings')>0 then raise exception 'Chưa đủ dữ liệu hoặc còn chi phí chưa phân bổ. Kiểm tra cảnh báo trước khi chốt.'; end if;
    if not exists(select 1 from public.activity_expenses where activity_id=p_id and voided_at is null) then raise exception 'Chưa nhập khoản chi.'; end if;
    insert into public.activity_finalizations(activity_id,summary,confirmed_by,reason) values(p_id,s,mid,coalesce(p_reason,''));
    update public.club_activities set fee_status='finalized',final_summary=s,version=version+1 where id=p_id;
  elsif p_action='reopen' and a.fee_status='finalized' then
    if length(trim(p_reason))=0 then raise exception 'Nhập lý do mở lại để điều chỉnh.'; end if;
    update public.club_activities set fee_status='draft',final_summary=null,version=version+1 where id=p_id;
  else raise exception 'Trạng thái bảng phí đã thay đổi hoặc thao tác không hợp lệ.'; end if;
end; $$;

create or replace function public.record_activity_payment(p_activity uuid,p_person uuid,p_kind text,p_amount numeric,p_operation uuid,p_note text default '',p_token text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid; a public.club_activities; s jsonb; receipt_amount bigint; net bigint; due bigint; rid uuid; old public.activity_ledger; advanced bigint;
begin
  mid:=private.finance_access(p_activity,p_token); select * into a from public.club_activities where id=p_activity;
  if p_operation is null then raise exception 'Thiếu mã thao tác chống trùng.'; end if;
  select * into old from public.activity_ledger where operation_id=p_operation;
  if found then
    if old.activity_id<>p_activity or coalesce(old.person_id,old.payee_member_id) is distinct from p_person or (p_kind<>'settle' and (old.kind<>p_kind or old.amount is distinct from p_amount)) then raise exception 'Mã thao tác đã dùng cho khoản khác.'; end if;
    return old.id;
  end if;
  if a.kind='badminton' and a.fee_status<>'finalized' then raise exception 'Chốt bảng phí cầu lông trước khi thu tiền.'; end if;
  if p_kind not in ('collection','supplement','refund','reimbursement','settle') then raise exception 'Loại khoản thu không hợp lệ.'; end if;
  if p_kind='reimbursement' then
    select coalesce(sum(actual),0) into advanced from public.activity_expenses where activity_id=p_activity and voided_at is null and paid_from='personal' and payer_member_id=p_person;
    select coalesce(sum(amount),0) into net from public.activity_ledger where activity_id=p_activity and kind='reimbursement' and payee_member_id=p_person and voided_at is null;
    if a.kind<>'trip' or p_amount>advanced-net then raise exception 'Hoàn ứng vượt số tiền cá nhân đã ứng còn lại.'; end if;
  else
    s:=case when a.fee_status='finalized' then a.final_summary else private.finance_calculate(p_activity) end;
    if a.kind='badminton' then
      if not exists(select 1 from jsonb_array_elements(s->'people') p where p->>'id'=p_person::text) then raise exception 'Người này không nằm trong bảng phí đã chốt.'; end if;
    elsif not exists(select 1 from public.trip_participants where id=p_person and activity_id=p_activity) then raise exception 'Người này không thuộc chuyến đi.'; end if;
    select coalesce(sum(case when kind='refund' then -amount else amount end),0) into net from public.activity_ledger where activity_id=p_activity and person_id=p_person and voided_at is null;
    select (p->>'due')::bigint into due from jsonb_array_elements(s->'people') p where p->>'id'=p_person::text;
    if p_kind='settle' then
      if a.fee_status<>'finalized' then raise exception 'Chốt bảng phí trước khi dùng Đã thu đủ.'; end if;
      receipt_amount:=greatest(0,coalesce(due,0)-net);
      if receipt_amount=0 then return null; end if;
    end if;
    if p_kind='refund' and p_amount>net then raise exception 'Số hoàn vượt số tiền đã đóng ròng. Hãy kiểm tra hoặc hủy khoản thu sai.'; end if;
  end if;
  if p_kind<>'settle' then
    if p_amount is null or p_amount<=0 or p_amount<>trunc(p_amount) or p_amount>100000000000 then raise exception 'Số tiền phải là đồng nguyên dương hợp lệ.'; end if;
    receipt_amount:=p_amount::bigint;
  end if;
  insert into public.activity_ledger(activity_id,operation_id,kind,person_id,payee_member_id,amount,note,confirmed_by)
  values(p_activity,p_operation,case when p_kind='settle' then 'collection' else p_kind end,case when p_kind<>'reimbursement' then p_person end,case when p_kind='reimbursement' then p_person end,receipt_amount,p_note,mid) returning id into rid;
  return rid;
end; $$;

create or replace function public.void_activity_payment(p_id uuid,p_reason text,p_token text default null) returns void language plpgsql security definer set search_path='' as $$
declare l public.activity_ledger;
begin
  perform private.booking_lock(); select * into l from public.activity_ledger where id=p_id;
  perform private.finance_access(l.activity_id,p_token);
  if length(trim(p_reason))=0 then raise exception 'Nhập lý do hủy khoản thu/hoàn.'; end if;
  perform set_config('app.finance_reason',p_reason,true);
  if l.voided_at is null then
    if l.kind in ('collection','supplement') and l.amount>(select coalesce(sum(case when kind='refund' then -amount else amount end),0) from public.activity_ledger where activity_id=l.activity_id and person_id=l.person_id and voided_at is null) then raise exception 'Đã hoàn một phần khoản này. Hủy bản ghi hoàn tiền liên quan trước.'; end if;
    update public.activity_ledger set voided_at=now(),voided_by=private.booking_actor(p_token),void_reason=p_reason where id=p_id;
  end if;
end; $$;

create or replace function public.replace_activity_payment(p_id uuid,p_amount numeric,p_note text,p_reason text,p_operation uuid,p_token text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.activity_ledger; existing public.activity_ledger;
begin
  perform private.booking_lock(); select * into l from public.activity_ledger where id=p_id;
  perform private.finance_access(l.activity_id,p_token);
  if length(trim(p_reason))=0 then raise exception 'Nhập lý do điều chỉnh khoản tiền.'; end if;
  select * into existing from public.activity_ledger where operation_id=p_operation;
  if found then
    if existing.activity_id<>l.activity_id or existing.amount is distinct from p_amount or existing.person_id is distinct from l.person_id or existing.payee_member_id is distinct from l.payee_member_id then raise exception 'Mã thao tác đã được dùng.'; end if;
    return existing.id;
  end if;
  if l.voided_at is not null then raise exception 'Khoản tiền đã bị hủy hoặc được điều chỉnh trên thiết bị khác.' using errcode='40001'; end if;
  perform public.void_activity_payment(p_id,p_reason,p_token);
  return public.record_activity_payment(l.activity_id,coalesce(l.person_id,l.payee_member_id),l.kind,p_amount,p_operation,p_note,p_token);
end; $$;

create or replace function public.save_trip_participant(p_activity uuid,p_id uuid,p_patch jsonb,p_expected_version integer default null,p_token text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid; a public.club_activities; p public.trip_participants; k text; manager boolean;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into a from public.club_activities where id=p_activity for update;
  if not found or a.kind<>'trip' then raise exception 'Không tìm thấy chuyến đi.'; end if;
  manager:=public.is_admin() or a.organizer_id=mid;
  if not manager and (a.status<>'open' or (nullif(a.details->>'deadline','')::timestamptz<now())) then raise exception 'Chuyến này đã ngừng nhận thay đổi đăng ký.'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('member_id','invited_by','guest_name','status','note','billable','share_units','share_reason') then raise exception 'Trường người tham gia không hợp lệ.'; end if;
    if not manager and k in ('billable','share_units','share_reason') then raise exception 'Chỉ người phụ trách xác nhận người chịu phí; số suất giảm do quản trị viên thiết lập.' using errcode='42501'; end if;
  end loop;
  if p_patch ? 'share_units' or p_patch ? 'share_reason' then perform private.require_admin(); end if;
  if a.fee_status='finalized' and (p_patch?'billable' or p_patch?'share_units') then raise exception 'Mở lại bảng phí trước khi thay đổi suất chia.'; end if;
  if p_id is not null then
    select * into p from public.trip_participants where id=p_id and activity_id=p_activity for update;
    if not found then raise exception 'Người tham gia không tồn tại.'; end if;
    if p.version is distinct from p_expected_version then raise exception 'Đăng ký hoặc ghi chú vừa thay đổi. Đối chiếu nội dung mới trước khi lưu.' using errcode='40001'; end if;
    if not manager and coalesce(p.member_id,p.invited_by)<>mid then raise exception 'Bạn chỉ được sửa đăng ký của mình và khách mình mời.' using errcode='42501'; end if;
    if p_patch?'member_id' or p_patch?'invited_by' then raise exception 'Không được đổi danh tính một dòng đã có.'; end if;
  else
    p.activity_id:=p_activity;p.member_id:=(p_patch->>'member_id')::uuid;p.invited_by:=(p_patch->>'invited_by')::uuid;p.guest_name:=coalesce(p_patch->>'guest_name','');
    p.status:='unanswered';p.note:='';p.billable:=true;p.share_units:=1000;p.share_reason:='';
    if not manager and coalesce(p.member_id,p.invited_by) is distinct from mid then raise exception 'Không được đăng ký thay thành viên khác.' using errcode='42501'; end if;
  end if;
  p:=jsonb_populate_record(p,p_patch);
  if p_id is null then insert into public.trip_participants(activity_id,member_id,invited_by,guest_name,status,note,billable,share_units,share_reason) values(p_activity,p.member_id,p.invited_by,trim(p.guest_name),p.status,p.note,p.billable,p.share_units,p.share_reason) returning id into p_id;
  else update public.trip_participants set guest_name=trim(p.guest_name),status=p.status,note=p.note,billable=p.billable,share_units=p.share_units,share_reason=p.share_reason,version=version+1,updated_at=now() where id=p_id; end if;
  return p_id;
end; $$;

create or replace function public.save_trip_checklist(p_activity uuid,p_id uuid,p_patch jsonb,p_expected_version integer default null,p_token text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.trip_checklist; k text;
begin
  perform private.finance_access(p_activity,p_token);
  if not exists(select 1 from public.club_activities where id=p_activity and kind='trip') then raise exception 'Danh sách chỉ dành cho chuyến đi.'; end if;
  for k in select jsonb_object_keys(p_patch) loop if k not in ('name','quantity','unit','responsible_id','status','note','expense_id','void') then raise exception 'Trường chuẩn bị không hợp lệ.'; end if; end loop;
  if p_id is not null then
    select * into v from public.trip_checklist where id=p_id and activity_id=p_activity and voided_at is null for update;
    if not found or v.version is distinct from p_expected_version then raise exception 'Danh sách chuẩn bị đã thay đổi. Mở lại biểu mẫu.' using errcode='40001'; end if;
    if (p_patch->>'void')::boolean then update public.trip_checklist set voided_at=now(),version=version+1 where id=p_id; return p_id; end if;
  else v.name:='';v.quantity:=1;v.unit:='';v.status:='todo';v.note:=''; end if;
  v:=jsonb_populate_record(v,p_patch-'void');
  if v.expense_id is not null and not exists(select 1 from public.activity_expenses where id=v.expense_id and activity_id=p_activity and voided_at is null) then raise exception 'Khoản chi liên kết không thuộc chuyến này.'; end if;
  if p_id is null then insert into public.trip_checklist(activity_id,name,quantity,unit,responsible_id,status,note,expense_id) values(p_activity,v.name,v.quantity,v.unit,v.responsible_id,v.status,v.note,v.expense_id) returning id into p_id;
  else update public.trip_checklist set name=v.name,quantity=v.quantity,unit=v.unit,responsible_id=v.responsible_id,status=v.status,note=v.note,expense_id=v.expense_id,version=version+1 where id=p_id; end if;
  return p_id;
end; $$;

-- Attendance and finalization share the existing lock, including batch writes.
-- This makes reviewing a revision meaningful even if a member changes attendance.
create or replace function private.write_attendance(p_session_id uuid,p_member_id uuid,p_status text,p_note text,p_expected_note_version integer,p_admin boolean)
returns void language plpgsql security definer set search_path='' as $$
declare s public.sessions; a public.attendance;
begin
  perform private.booking_lock();
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
  if p_note is not null and coalesce(a.note_version,0) is distinct from p_expected_note_version then raise exception 'Ghi chú đã được sửa trên thiết bị khác. Nội dung đang nhập được giữ lại; hãy chọn bản muốn lưu.' using errcode='40001'; end if;
  if p_status='going' and coalesce(a.status,'unanswered')<>'going' and s.max_players is not null and (select count(*) from public.attendance where session_id=p_session_id and status='going')>=s.max_players then raise exception 'Ca/sân này đã đủ người. Vui lòng chọn ca/sân khác.'; end if;
  if a.id is not null and (p_status is null or p_status=a.status) and (p_note is null or p_note=a.note) then return; end if;
  insert into public.attendance(session_id,member_id,status,note,note_version,updated_at)
  values(p_session_id,p_member_id,coalesce(p_status,'unanswered'),coalesce(p_note,''),case when p_note is null then 0 else 1 end,now())
  on conflict(session_id,member_id) do update set status=coalesce(p_status,public.attendance.status),note=coalesce(p_note,public.attendance.note),note_version=public.attendance.note_version+case when p_note is null then 0 else 1 end,updated_at=now();
end; $$;
drop trigger if exists finance_attendance_sync on public.attendance;
create trigger finance_attendance_sync after insert or update or delete on public.attendance for each row execute function private.booking_touch();

-- Capability version avoids probing a nonexistent RPC on older installations.
create or replace function public.get_quick_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',3,'sessions',public.get_public_schedule(),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.code) from public.members m),'[]'),
    'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from public.attendance a),'[]'),
    'roster',coalesce((select jsonb_agg(to_jsonb(r)) from public.session_roster r),'[]'));
$$;

-- One read supplies a consistent server-calculated snapshot. Anonymous visitors
-- receive trip descriptions only; financial detail requires a verified identity.
create or replace function public.get_activity_snapshot(p_token text default null) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',1,'revision',(select revision from public.booking_sync where id=1),'club',public.get_quick_snapshot(),
    'activities',coalesce((select jsonb_agg(
      case when private.booking_actor(p_token) is null then to_jsonb(a)-'final_summary'-'cost_note' else to_jsonb(a)||jsonb_build_object(
        'can_manage',public.is_admin() or a.organizer_id=private.booking_actor(p_token) or (a.kind='badminton' and a.organizer_id is null and exists(select 1 from public.activity_groups where activity_id=a.id) and not exists(select 1 from public.activity_groups g join public.sessions s on s.id=g.session_id where g.activity_id=a.id and s.organizer_id is distinct from private.booking_actor(p_token))),
        'groups',coalesce((select jsonb_agg(to_jsonb(g) order by sort_order) from public.activity_groups g where activity_id=a.id),'[]'),
        'billable',coalesce((select jsonb_agg(to_jsonb(b)) from public.activity_billable b join public.activity_groups g on g.id=b.group_id where g.activity_id=a.id),'[]'),
        'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.trip_participants p where activity_id=a.id),'[]'),
        'expenses',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.activity_expenses e where activity_id=a.id),'[]'),
        'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id) from public.activity_ledger l where activity_id=a.id),'[]'),
        'checklist',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.trip_checklist c where activity_id=a.id),'[]'),
        'calculation',case when a.fee_status='finalized' then a.final_summary else private.finance_calculate(a.id) end,
        'finalizations',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from public.activity_finalizations f where activity_id=a.id),'[]'),
        'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from (select * from public.finance_history where activity_id=a.id order by id desc limit 150) h),'[]')
      ) end order by a.created_at desc) from public.club_activities a),'[]'));
$$;

do $$ declare t text; begin
  foreach t in array array['club_activities','activity_groups','activity_billable','trip_participants','activity_expenses','activity_ledger','activity_finalizations','trip_checklist','finance_history'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('drop trigger if exists finance_sync_touch on public.%I',t);
    execute format('create trigger finance_sync_touch after insert or update or delete on public.%I for each row execute function private.booking_touch()',t);
    if t not in ('activity_groups','activity_billable','finance_history') then
      execute format('drop trigger if exists finance_audit on public.%I',t);
      execute format('create trigger finance_audit after insert or update or delete on public.%I for each row execute function private.finance_audit()',t);
    end if;
  end loop;
end; $$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke execute on function public.replace_activity_payment(uuid,numeric,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.replace_activity_payment(uuid,numeric,text,text,uuid,text) to anon,authenticated;
revoke execute on function public.create_club_activity(text,text,jsonb,jsonb,text),public.save_activity(uuid,jsonb,integer,text),public.set_activity_billable(uuid,uuid,boolean,bigint,text),public.save_activity_expense(uuid,uuid,jsonb,integer,text,text),public.set_activity_fee_state(uuid,text,bigint,text,text),public.record_activity_payment(uuid,uuid,text,numeric,uuid,text,text),public.void_activity_payment(uuid,text,text),public.save_trip_participant(uuid,uuid,jsonb,integer,text),public.save_trip_checklist(uuid,uuid,jsonb,integer,text),public.get_activity_snapshot(text) from public,anon,authenticated;
grant execute on function public.create_club_activity(text,text,jsonb,jsonb,text),public.save_activity(uuid,jsonb,integer,text),public.set_activity_billable(uuid,uuid,boolean,bigint,text),public.save_activity_expense(uuid,uuid,jsonb,integer,text,text),public.set_activity_fee_state(uuid,text,bigint,text,text),public.record_activity_payment(uuid,uuid,text,numeric,uuid,text,text),public.void_activity_payment(uuid,text,text),public.save_trip_participant(uuid,uuid,jsonb,integer,text),public.save_trip_checklist(uuid,uuid,jsonb,integer,text),public.get_activity_snapshot(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
-- Realtime reuses booking_sync, already published by migration 002. Every new
-- table emits only a revision notification; clients refetch their authorized view.
