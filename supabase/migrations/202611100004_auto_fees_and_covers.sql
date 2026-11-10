-- Run after 202611100003_finance_travel.sql. No historical fees are seeded.
begin;

alter table public.club_activities add column if not exists auto_created boolean not null default false;
alter table public.club_activities add column if not exists merged_into_id uuid references public.club_activities(id) on delete restrict;

-- Only untouched automatic singleton sheets may be combined. A voided expense
-- or receipt still counts as financial history and prevents regrouping.
create or replace function private.finance_can_regroup(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.club_activities a where a.id=p_id and a.kind='badminton'
    and a.auto_created and a.merged_into_id is null and a.version=1 and a.fee_status='draft'
    and a.organizer_id is null and a.rounding=1 and a.reserve=0 and a.cost_note='' and a.details='{}'::jsonb
    and a.status='planning' and a.final_summary is null
    and (select count(*) from public.activity_groups where activity_id=a.id)=1
    and not exists(select 1 from public.activity_expenses where activity_id=a.id)
    and not exists(select 1 from public.activity_ledger where activity_id=a.id)
    and not exists(select 1 from public.activity_finalizations where activity_id=a.id)
    and not exists(select 1 from public.activity_billable b join public.activity_groups g on g.id=b.group_id where g.activity_id=a.id));
$$;

create or replace function private.create_session_fee() returns trigger language plpgsql security definer set search_path='' as $$
declare aid uuid;
begin
  perform private.require_admin();
  perform private.booking_lock();
  perform private.require_booking_actor(null);
  -- A session is linked once; schedule edits and attendance changes do not
  -- recreate a sheet or change finalized financial snapshots.
  if exists(select 1 from public.activity_groups where session_id=new.id) then return null; end if;
  insert into public.club_activities(kind,title,auto_created)
  values('badminton',left('Cầu lông '||to_char(new.session_date,'DD/MM/YYYY')||' · '||to_char(new.start_time,'HH24:MI')||' · '||new.venue,180),true)
  returning id into aid;
  insert into public.activity_groups(activity_id,session_id,label,basis,sort_order)
  values(aid,new.id,left(coalesce(nullif(trim(new.court),''),'Nhóm tham gia')||' · '||to_char(new.start_time,'HH24:MI')||'–'||to_char(new.end_time,'HH24:MI'),100),'single',0);
  return null;
end; $$;
drop trigger if exists auto_session_fee on public.sessions;
create trigger auto_session_fee after insert on public.sessions for each row execute function private.create_session_fee();

-- Copying creates fresh sessions and therefore fresh, empty fee sheets. Set the
-- verified actor before the INSERT so all automatic financial audit rows agree.
create or replace function public.copy_week(p_week_start date) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform private.require_admin(); perform private.booking_lock(); perform private.require_booking_actor(null);
  if extract(isodow from p_week_start)<>1 then raise exception 'Tuần phải bắt đầu vào thứ Hai.'; end if;
  insert into public.sessions(session_date,start_time,end_time,venue,court,address,maps_url,organizer_id,organizer_mode,booking_status,max_players,note,deadline,copied_from,estimated_cost,booking_contact_note,deposit_note)
  select session_date+7,start_time,end_time,venue,court,address,maps_url,case when organizer_mode='override' then organizer_id end,organizer_mode,'pending',max_players,note,
    case when deadline is null then null else deadline+interval '7 days' end,id,estimated_cost,booking_contact_note,''
  from public.sessions where session_date>=p_week_start and session_date<p_week_start+7 and booking_status<>'cancelled'
  on conflict(copied_from,session_date) do nothing;
  get diagnostics n=row_count;
  return n;
end; $$;

-- Archived source sheets remain immutable and retain their original audit.
create or replace function private.finance_access(p_id uuid,p_token text,p_draft boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid; a public.club_activities;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into a from public.club_activities where id=p_id for update;
  if not found then raise exception 'Không tìm thấy hoạt động.'; end if;
  if a.merged_into_id is not null then raise exception 'Bảng phí này đã được ghép. Hãy mở bảng phí mới để tiếp tục.' using errcode='40001'; end if;
  if not public.is_admin() and not coalesce(a.organizer_id=mid or (a.kind='badminton' and a.organizer_id is null and exists(select 1 from public.activity_groups g join public.sessions s on s.id=g.session_id where g.activity_id=a.id) and not exists(select 1 from public.activity_groups g join public.sessions s on s.id=g.session_id where g.activity_id=a.id and s.organizer_id is distinct from mid)),false) then raise exception 'Chỉ người phụ trách đã xác minh hoặc quản trị viên được quản lý tài chính.' using errcode='42501'; end if;
  if p_draft and a.fee_status='finalized' then raise exception 'Bảng phí đã chốt. Mở lại với lý do trước khi sửa chi phí hoặc người chịu phí.'; end if;
  return mid;
end; $$;

-- Explicit grouping may absorb pristine automatic singles. Existing manual or
-- used sheets are never silently moved, even if their expenses were voided.
create or replace function public.create_club_activity(p_kind text,p_title text,p_sessions jsonb default '[]',p_details jsonb default '{}',p_token text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare mid uuid; aid uuid; g jsonb; sid uuid; n integer:=0; firstdate date; owner uuid; old_group public.activity_groups; old_aid uuid; seen uuid[]:='{}';
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  if p_kind not in ('badminton','trip') then raise exception 'Loại hoạt động không hợp lệ.'; end if;
  if p_kind='trip' and not public.is_admin() then raise exception 'Quản trị viên tạo chuyến đi và giao người phụ trách.' using errcode='42501'; end if;
  if p_kind='badminton' then
    if jsonb_typeof(p_sessions) is distinct from 'array' then raise exception 'Chọn từ 1 đến 12 nhóm tham gia.'; end if;
    if jsonb_array_length(p_sessions) not between 1 and 12 then raise exception 'Chọn từ 1 đến 12 nhóm tham gia.'; end if;
    for g in select value from jsonb_array_elements(p_sessions) loop
      sid:=(g->>'session_id')::uuid;
      if sid is null or sid=any(seen) then raise exception 'Mỗi ca/sân chỉ được chọn một lần.'; end if;
      seen:=array_append(seen,sid);
      if not exists(select 1 from public.sessions where id=sid and booking_status<>'cancelled' and (public.is_admin() or organizer_id=mid)) then raise exception 'Bạn không phụ trách ca/sân này.' using errcode='42501'; end if;
      if firstdate is null then select session_date into firstdate from public.sessions where id=sid; end if;
      if not exists(select 1 from public.sessions where id=sid and session_date=firstdate) then raise exception 'Các nhóm chia chung một buổi cần cùng ngày.'; end if;
      select activity_id into old_aid from public.activity_groups where session_id=sid;
      if found and not private.finance_can_regroup(old_aid) then raise exception 'Ca/sân đã có bảng phí được chỉnh sửa hoặc phát sinh. Chỉ ghép được bảng tự tạo còn trống.' using errcode='40001'; end if;
    end loop;
  end if;
  owner:=case when p_kind='trip' then coalesce((p_details->>'organizer_id')::uuid,mid) else null end;
  if owner is not null and not exists(select 1 from public.members where id=owner and active) then raise exception 'Người phụ trách phải còn hoạt động.'; end if;
  insert into public.club_activities(kind,title,organizer_id,details) values(p_kind,trim(p_title),owner,'{}') returning id into aid;
  if p_kind='badminton' then
    perform set_config('app.finance_reason','Ghép các bảng phí tự tạo còn trống theo lựa chọn của người phụ trách.',true);
    for g in select value from jsonb_array_elements(p_sessions) loop
      sid:=(g->>'session_id')::uuid;
      select * into old_group from public.activity_groups where session_id=sid;
      if found then
        old_aid:=old_group.activity_id;
        update public.activity_groups set activity_id=aid,label=g->>'label',basis=g->>'basis',sort_order=n where id=old_group.id;
        insert into public.finance_history(activity_id,actor_member_id,actor_name,action,table_name,record_id,before_data,after_data,reason)
        select aid,mid,m.display_name,'UPDATE','activity_groups',old_group.id,to_jsonb(old_group),to_jsonb(updated_group),current_setting('app.finance_reason',true)
        from public.members m cross join public.activity_groups updated_group where m.id=mid and updated_group.id=old_group.id;
        update public.club_activities set merged_into_id=aid,version=version+1 where id=old_aid;
      else
        insert into public.activity_groups(activity_id,session_id,label,basis,sort_order) values(aid,sid,g->>'label',g->>'basis',n);
      end if;
      n:=n+1;
    end loop;
  elsif p_details-'organizer_id'<>'{}'::jsonb then
    perform public.save_activity(aid,jsonb_build_object('details',p_details-'organizer_id'),1,p_token);
  end if;
  return aid;
end; $$;

create or replace function public.get_activity_snapshot(p_token text default null) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',1,'automatic_fees',true,'revision',(select revision from public.booking_sync where id=1),'club',public.get_quick_snapshot(),
    'activities',coalesce((select jsonb_agg(
      case when private.booking_actor(p_token) is null then to_jsonb(a)-'final_summary'-'cost_note' else to_jsonb(a)||jsonb_build_object(
        'can_manage',public.is_admin() or a.organizer_id=private.booking_actor(p_token) or (a.kind='badminton' and a.organizer_id is null and exists(select 1 from public.activity_groups where activity_id=a.id) and not exists(select 1 from public.activity_groups g join public.sessions s on s.id=g.session_id where g.activity_id=a.id and s.organizer_id is distinct from private.booking_actor(p_token))),
        'can_regroup',private.finance_can_regroup(a.id) and (public.is_admin() or exists(select 1 from public.activity_groups g join public.sessions s on s.id=g.session_id where g.activity_id=a.id and s.organizer_id=private.booking_actor(p_token))),
        'groups',coalesce((select jsonb_agg(to_jsonb(g) order by sort_order) from public.activity_groups g where activity_id=a.id),'[]'),
        'billable',coalesce((select jsonb_agg(to_jsonb(b)) from public.activity_billable b join public.activity_groups g on g.id=b.group_id where g.activity_id=a.id),'[]'),
        'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.trip_participants p where activity_id=a.id),'[]'),
        'expenses',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.activity_expenses e where activity_id=a.id),'[]'),
        'ledger',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id) from public.activity_ledger l where activity_id=a.id),'[]'),
        'checklist',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.trip_checklist c where activity_id=a.id),'[]'),
        'calculation',case when a.fee_status='finalized' then a.final_summary else private.finance_calculate(a.id) end,
        'finalizations',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from public.activity_finalizations f where activity_id=a.id),'[]'),
        'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from (select * from public.finance_history where activity_id=a.id or activity_id in (select id from public.club_activities where merged_into_id=a.id) order by id desc limit 150) h),'[]')
      ) end order by a.created_at desc) from public.club_activities a where a.merged_into_id is null),'[]'));
$$;

revoke all on function private.finance_can_regroup(uuid),private.create_session_fee() from public,anon,authenticated;
revoke execute on function public.copy_week(date),public.create_club_activity(text,text,jsonb,jsonb,text),public.get_activity_snapshot(text) from public,anon,authenticated;
grant execute on function public.copy_week(date) to authenticated;
grant execute on function public.create_club_activity(text,text,jsonb,jsonb,text),public.get_activity_snapshot(text) to anon,authenticated;

-- STORAGE: Supabase-only bucket and policies; local fee tests omit this section.
create table if not exists private.trip_cover_uploads (
  path text primary key,
  actor_member_id uuid not null references public.members(id) on delete cascade,
  activity_id uuid references public.club_activities(id) on delete restrict,
  mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check(byte_size between 1 and 5242880),
  expires_at timestamptz not null default now()+interval '15 minutes',
  created_at timestamptz not null default now()
);
revoke all on private.trip_cover_uploads from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('trip-covers','trip-covers',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

-- A temporary random exact path is a narrow upload capability. A code-verified
-- member need not obtain an email-based Auth JWT or expose the personal token
-- to Storage. Public image paths cannot overwrite an existing uploaded object.
create or replace function public.can_upload_trip_cover(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from private.trip_cover_uploads u join public.members m on m.id=u.actor_member_id and m.active
    where u.path=p_path and u.expires_at>now()
      and not exists(select 1 from storage.objects o where o.bucket_id='trip-covers' and o.name=p_path)
      and (
        exists(select 1 from public.account_links l where l.member_id=m.id and l.role='admin')
        or exists(select 1 from public.club_activities a where a.id=u.activity_id and a.kind='trip' and a.organizer_id=m.id and a.merged_into_id is null)
      )
  );
$$;
revoke execute on function public.can_upload_trip_cover(text) from public,anon,authenticated;
grant execute on function public.can_upload_trip_cover(text) to anon,authenticated;
drop policy if exists trip_cover_scoped_insert on storage.objects;
create policy trip_cover_scoped_insert on storage.objects for insert to anon,authenticated
with check(bucket_id='trip-covers' and public.can_upload_trip_cover(name));

create or replace function public.prepare_trip_cover_upload(p_activity uuid,p_mime text,p_size numeric,p_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mid uuid; object_path text; deadline timestamptz:=now()+interval '15 minutes'; extension text;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  if p_activity is null then perform private.require_admin();
  else
    perform private.finance_access(p_activity,p_token);
    if not exists(select 1 from public.club_activities where id=p_activity and kind='trip') then raise exception 'Ảnh bìa chỉ dùng cho chuyến đi / sự kiện.'; end if;
  end if;
  if p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Chọn ảnh JPG, PNG hoặc WebP.'; end if;
  if p_size is null or p_size<>trunc(p_size) or p_size<1 or p_size>5242880 then raise exception 'Ảnh phải có dung lượng từ 1 byte đến 5 MB.'; end if;
  extension:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
  object_path:='covers/'||gen_random_uuid()::text||'.'||extension;
  insert into private.trip_cover_uploads(path,actor_member_id,activity_id,mime,byte_size,expires_at)
  values(object_path,mid,p_activity,p_mime,p_size::bigint,deadline);
  return jsonb_build_object('bucket','trip-covers','path',object_path,'expires_at',deadline);
end; $$;
revoke execute on function public.prepare_trip_cover_upload(uuid,text,numeric,text) from public,anon,authenticated;
grant execute on function public.prepare_trip_cover_upload(uuid,text,numeric,text) to anon,authenticated;

notify pgrst,'reload schema';
commit;
