-- Run after 202611260001_member_honors.sql. Safe to run again.
-- Uses the existing verified identity and immutable Storage capability pattern.
begin;
create table if not exists private.member_avatar_uploads (
  path text primary key,
  member_id uuid not null references public.members(id) on delete restrict,
  mime text not null check(mime in ('image/jpeg','image/webp')),
  byte_size bigint not null check(byte_size between 1 and 1048576),
  expires_at timestamptz not null,
  ready_at timestamptz
);
revoke all on private.member_avatar_uploads from public,anon,authenticated;
create index if not exists member_avatar_upload_owner on private.member_avatar_uploads(member_id,expires_at);
alter table private.member_styles add column if not exists avatar_path text references private.member_avatar_uploads(path) on delete restrict;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='private.member_styles'::regclass and conname='member_style_single_avatar') then
    alter table private.member_styles add constraint member_style_single_avatar check(avatar_path is null or avatar_key='');
  end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('member-avatars','member-avatars',true,1048576,array['image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=1048576,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_upload_member_avatar(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.member_avatar_uploads u join public.members m on m.id=u.member_id and m.active
    where u.path=p_path and u.ready_at is null and u.expires_at>now()
    and not exists(select 1 from storage.objects o where o.bucket_id='member-avatars' and o.name=p_path));
$$;
drop policy if exists member_avatar_scoped_insert on storage.objects;
create policy member_avatar_scoped_insert on storage.objects for insert to anon,authenticated
with check(bucket_id='member-avatars' and public.can_upload_member_avatar(name));

create or replace function public.prepare_member_avatar_upload(p_mime text,p_size numeric,p_token text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare mid uuid; object_path text; deadline timestamptz:=now()+interval '15 minutes';
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  if p_mime is null or p_mime not in ('image/jpeg','image/webp') then raise exception 'Ảnh đại diện cần được xử lý thành JPG hoặc WebP.'; end if;
  if p_size is null or p_size<>trunc(p_size) or p_size<1 or p_size>1048576 then raise exception 'Ảnh đại diện đã xử lý không được quá 1 MB.'; end if;
  if (select count(*) from private.member_avatar_uploads where member_id=mid and expires_at>now())>=10 then raise exception 'Bạn đã tải nhiều ảnh liên tiếp. Hãy thử lại sau 15 phút.'; end if;
  object_path:='avatars/'||gen_random_uuid()::text||case p_mime when 'image/jpeg' then '.jpg' else '.webp' end;
  insert into private.member_avatar_uploads(path,member_id,mime,byte_size,expires_at) values(object_path,mid,p_mime,p_size::bigint,deadline);
  return jsonb_build_object('bucket','member-avatars','path',object_path,'expires_at',deadline);
end; $$;

create or replace function public.complete_member_avatar_upload(p_path text,p_token text default null) returns void
language plpgsql security definer set search_path='' as $$
declare mid uuid; u private.member_avatar_uploads;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into u from private.member_avatar_uploads where path=p_path for update;
  if not found or u.member_id<>mid then raise exception 'Bạn không được xác nhận ảnh đại diện này.' using errcode='42501'; end if;
  if u.ready_at is null and u.expires_at<=now() then raise exception 'Quyền tải ảnh hết hạn. Hãy chọn lại ảnh.'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='member-avatars' and o.name=p_path
    and o.metadata->>'mimetype'=u.mime and (case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric end)=u.byte_size) then
    raise exception 'Máy chủ chưa xác nhận đúng ảnh đại diện. Hãy thử lại.';
  end if;
  update private.member_avatar_uploads set ready_at=coalesce(ready_at,now()) where path=p_path;
end; $$;

create or replace function private.write_member_appearance(p_avatar_key text,p_avatar_path text,p_featured_badge text,p_expected_version integer,p_token text) returns void
language plpgsql security definer set search_path='' as $$
declare mid uuid; v integer;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select version into v from private.member_styles where member_id=mid;
  if coalesce(v,0) is distinct from p_expected_version then raise exception 'Diện mạo đã thay đổi trên thiết bị khác. Hãy dùng bản mới rồi chọn lại.' using errcode='PT409'; end if;
  if p_avatar_key is null or p_avatar_key not in ('','jerry-smirk','smug-cat','side-eye-duck','cheeky-frog') then raise exception 'Avatar không hợp lệ.'; end if;
  if p_avatar_path is not null and (p_avatar_key<>'' or not exists(
    select 1 from private.member_avatar_uploads u join storage.objects o on o.bucket_id='member-avatars' and o.name=u.path
    where u.path=p_avatar_path and u.member_id=mid and u.ready_at is not null)) then raise exception 'Chỉ được dùng ảnh của chính bạn đã tải và xác nhận.' using errcode='42501'; end if;
  if p_featured_badge is null or (p_featured_badge<>'' and not exists(
    select 1 from jsonb_array_elements(private.member_honor_badges(mid)) b where b->>'key'=p_featured_badge and (b->>'earned')::boolean)) then raise exception 'Chỉ được ghim huy hiệu bạn đang đủ điều kiện nhận.'; end if;
  insert into private.member_styles(member_id,avatar_key,avatar_path,featured_badge) values(mid,p_avatar_key,p_avatar_path,p_featured_badge)
  on conflict(member_id) do update set avatar_key=excluded.avatar_key,avatar_path=excluded.avatar_path,featured_badge=excluded.featured_badge,
    version=private.member_styles.version+1,updated_at=now();
end; $$;
create or replace function public.save_member_appearance(p_avatar_key text,p_avatar_path text,p_featured_badge text,p_expected_version integer,p_token text default null) returns void
language sql security definer set search_path='' as $$ select private.write_member_appearance(p_avatar_key,p_avatar_path,p_featured_badge,p_expected_version,p_token); $$;
-- Preserve the old RPC signature for clients that still choose a preset.
create or replace function public.save_member_style(p_avatar_key text,p_featured_badge text,p_expected_version integer,p_token text default null) returns void
language sql security definer set search_path='' as $$ select private.write_member_appearance(p_avatar_key,null,p_featured_badge,p_expected_version,p_token); $$;

create or replace function public.get_member_hub(p_token text default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',1,'custom_avatars',true,'as_of',now(),'month',to_char(now() at time zone 'Asia/Ho_Chi_Minh','YYYY-MM'),
    'viewer_member_id',private.booking_actor(p_token),
    'profiles',coalesce((select jsonb_agg(jsonb_build_object('member_id',m.id,'avatar_key',coalesce(s.avatar_key,''),'avatar_path',s.avatar_path,
      'featured_badge',case when exists(select 1 from jsonb_array_elements(b.badges) badge where badge->>'key'=s.featured_badge and (badge->>'earned')::boolean) then s.featured_badge else '' end,
      'version',coalesce(s.version,0),'badges',b.badges) order by m.code)
      from public.members m left join private.member_styles s on s.member_id=m.id
      cross join lateral (select private.member_honor_badges(m.id) as badges) b),'[]'),
    'votes',coalesce((select jsonb_agg(to_jsonb(t) order by category,votes desc,member_id) from (
      select v.category,v.nominee_id as member_id,count(*)::integer as votes from private.member_honor_votes v
      join public.members m on m.id=v.nominee_id and m.active where v.month=date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')::date
      group by v.category,v.nominee_id) t),'[]'),
    'mine',case when private.booking_actor(p_token) is null then '[]'::jsonb else (
      select jsonb_agg(jsonb_build_object('category',c.category,'nominee_id',v.nominee_id,'version',coalesce(v.version,0)))
      from (values ('comic'),('teammate')) c(category) left join private.member_honor_votes v
      on v.category=c.category and v.voter_id=private.booking_actor(p_token)
      and v.month=date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')::date) end);
$$;
revoke all on function public.can_upload_member_avatar(text),public.prepare_member_avatar_upload(text,numeric,text),public.complete_member_avatar_upload(text,text),public.save_member_appearance(text,text,text,integer,text),private.write_member_appearance(text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.can_upload_member_avatar(text),public.prepare_member_avatar_upload(text,numeric,text),public.complete_member_avatar_upload(text,text),public.save_member_appearance(text,text,text,integer,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
