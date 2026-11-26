-- Run after booking responsibility 202611100002 and the installed upgrades.
-- Profiles and votes use verified identities; selected names never authorize writes.
begin;
create table if not exists private.member_styles (
  member_id uuid primary key references public.members(id) on delete restrict,
  avatar_key text not null default '' check(avatar_key in ('','jerry-smirk','smug-cat','side-eye-duck','cheeky-frog')),
  featured_badge text not null default '' check(featured_badge in ('','first_rally','regular','veteran','court_keeper','week_keeper','comic','teammate')),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists private.member_honor_votes (
  voter_id uuid not null references public.members(id) on delete restrict,
  month date not null check(extract(day from month)=1),
  category text not null check(category in ('comic','teammate')),
  nominee_id uuid references public.members(id) on delete restrict,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(voter_id,month,category),
  check(nominee_id is null or nominee_id<>voter_id)
);
revoke all on private.member_styles, private.member_honor_votes from public,anon,authenticated;
create index if not exists member_honor_vote_totals on private.member_honor_votes(month,category,nominee_id) where nominee_id is not null;
drop trigger if exists member_styles_sync on private.member_styles;
create trigger member_styles_sync after insert or update or delete on private.member_styles for each row execute function private.booking_touch();
drop trigger if exists member_votes_sync on private.member_honor_votes;
create trigger member_votes_sync after insert or update or delete on private.member_honor_votes for each row execute function private.booking_touch();

create or replace function private.member_honor_badges(p_member uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  with stats as (
    select (select count(distinct s.session_date) from public.attendance a join public.sessions s on s.id=a.session_id
      where a.member_id=p_member and a.status='going' and s.booking_status='booked'
      and (s.session_date+s.end_time) at time zone 'Asia/Ho_Chi_Minh' < now())::integer as days,
      (select count(*) from public.sessions where booked_by_member_id=p_member and booked_at is not null and booking_status='booked')::integer as booked,
      (select count(*) from public.weekly_booking_assignments where completed_member_id=p_member and completed_at is not null)::integer as weeks
  ), totals as (
    select month,category,nominee_id,count(*) as votes from private.member_honor_votes
    where nominee_id is not null and month<date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')::date
    group by month,category,nominee_id
  ), winners as (
    select category,max(month) as awarded_month from (
      select *,max(votes) over(partition by month,category) as top_votes from totals
    ) ranked where nominee_id=p_member and votes>=3 and votes=top_votes group by category
  ), badges as (
    select 'first_rally' as key,days as progress,1 as target,days>=1 as earned,null::date as awarded_month from stats
    union all select 'regular',days,5,days>=5,null from stats
    union all select 'veteran',days,20,days>=20,null from stats
    union all select 'court_keeper',booked,1,booked>=1,null from stats
    union all select 'week_keeper',weeks,1,weeks>=1,null from stats
    union all select category,case when awarded_month is null then 0 else 1 end,1,awarded_month is not null,awarded_month
      from (values ('comic'),('teammate')) c(category) left join winners using(category)
  ) select coalesce(jsonb_agg(to_jsonb(badges) order by key),'[]') from badges;
$$;

create or replace function public.get_member_hub(p_token text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',1,'as_of',now(),'month',to_char(now() at time zone 'Asia/Ho_Chi_Minh','YYYY-MM'),
    'viewer_member_id',private.booking_actor(p_token),
    'profiles',coalesce((select jsonb_agg(jsonb_build_object('member_id',m.id,'avatar_key',coalesce(s.avatar_key,''),
      'featured_badge',case when exists(select 1 from jsonb_array_elements(b.badges) badge where badge->>'key'=s.featured_badge and (badge->>'earned')::boolean) then s.featured_badge else '' end,
      'version',coalesce(s.version,0),'badges',b.badges) order by m.code)
      from public.members m left join private.member_styles s on s.member_id=m.id
      cross join lateral (select private.member_honor_badges(m.id) as badges) b),'[]'),
    'votes',coalesce((select jsonb_agg(to_jsonb(t) order by category,votes desc,member_id) from (
      select v.category,v.nominee_id as member_id,count(*)::integer as votes from private.member_honor_votes v
      join public.members m on m.id=v.nominee_id and m.active
      where v.month=date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')::date
      group by v.category,v.nominee_id) t),'[]'),
    'mine',case when private.booking_actor(p_token) is null then '[]'::jsonb else (
      select jsonb_agg(jsonb_build_object('category',c.category,'nominee_id',v.nominee_id,'version',coalesce(v.version,0)))
      from (values ('comic'),('teammate')) c(category) left join private.member_honor_votes v
      on v.category=c.category and v.voter_id=private.booking_actor(p_token)
      and v.month=date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')::date) end);
$$;

create or replace function public.save_member_style(p_avatar_key text,p_featured_badge text,p_expected_version integer,p_token text default null)
returns void language plpgsql security definer set search_path='' as $$
declare mid uuid; current_version integer;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select version into current_version from private.member_styles where member_id=mid;
  if coalesce(current_version,0) is distinct from p_expected_version then
    raise exception 'Diện mạo đã thay đổi trên thiết bị khác. Hãy dùng bản mới rồi chọn lại.' using errcode='PT409';
  end if;
  if p_avatar_key is null or p_avatar_key not in ('','jerry-smirk','smug-cat','side-eye-duck','cheeky-frog') then raise exception 'Avatar không hợp lệ.'; end if;
  if p_featured_badge is null or (p_featured_badge<>'' and not exists(
    select 1 from jsonb_array_elements(private.member_honor_badges(mid)) b where b->>'key'=p_featured_badge and (b->>'earned')::boolean)) then
    raise exception 'Chỉ được ghim huy hiệu bạn đang đủ điều kiện nhận.';
  end if;
  insert into private.member_styles(member_id,avatar_key,featured_badge) values(mid,p_avatar_key,p_featured_badge)
  on conflict(member_id) do update set avatar_key=excluded.avatar_key,featured_badge=excluded.featured_badge,
    version=private.member_styles.version+1,updated_at=now();
end; $$;

create or replace function public.vote_member_honor(p_category text,p_nominee uuid,p_month text,p_expected_version integer,p_token text default null)
returns void language plpgsql security definer set search_path='' as $$
declare mid uuid; current_version integer; this_month date:=date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  if p_month is distinct from to_char(this_month,'YYYY-MM') then raise exception 'Đã sang tháng mới. Tải lại bảng bình chọn trước khi gửi.' using errcode='PT409'; end if;
  if p_category is null or p_category not in ('comic','teammate') then raise exception 'Mục bình chọn không hợp lệ.'; end if;
  select version into current_version from private.member_honor_votes where voter_id=mid and month=this_month and category=p_category;
  if coalesce(current_version,0) is distinct from p_expected_version then
    raise exception 'Phiếu đã thay đổi hoặc đã sang tháng mới. Tải bản mới trước khi bình chọn lại.' using errcode='PT409';
  end if;
  if p_nominee=mid then raise exception 'Để đồng đội tặng danh hiệu cho bạn nhé, không tự bầu mình.'; end if;
  if p_nominee is not null and not exists(select 1 from public.members where id=p_nominee and active) then raise exception 'Thành viên này không còn hoạt động.'; end if;
  -- Preserve the version when withdrawing, preventing stale editors from re-creating old votes.
  insert into private.member_honor_votes(voter_id,month,category,nominee_id) values(mid,this_month,p_category,p_nominee)
  on conflict(voter_id,month,category) do update set nominee_id=excluded.nominee_id,version=private.member_honor_votes.version+1,updated_at=now();
end; $$;
revoke all on function private.member_honor_badges(uuid),public.get_member_hub(text),public.save_member_style(text,text,integer,text),public.vote_member_honor(text,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.get_member_hub(text),public.save_member_style(text,text,integer,text),public.vote_member_honor(text,uuid,text,integer,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
