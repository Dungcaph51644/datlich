-- Public team album. This is the ONLY module with deliberately open guest CRUD.
-- Run after the existing application migrations. Safe to run again; no seeds.
begin;
create schema if not exists private;

create table if not exists public.team_album_sync (
  id integer primary key check(id=1),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.team_album_sync(id) values(1) on conflict do nothing;
create table if not exists public.team_albums (
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 1 and 120),
  description text not null default '' check(length(description)<=5000),
  event_date date,
  kind text not null default 'badminton' check(kind in ('badminton','travel','meetup','other')),
  cover_photo_id uuid,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.team_album_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.team_albums(id) on delete restrict,
  original_path text not null unique,
  thumbnail_path text not null unique,
  original_mime text not null check(original_mime in ('image/jpeg','image/png','image/webp')),
  original_size bigint not null check(original_size between 1 and 15728640),
  width integer not null check(width between 1 and 50000),
  height integer not null check(height between 1 and 50000),
  filename text not null check(length(filename) between 1 and 255),
  caption text not null default '' check(length(caption)<=2000),
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists team_album_photos_album_idx on public.team_album_photos(album_id,created_at);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='team_albums_cover_photo_fk' and conrelid='public.team_albums'::regclass) then
    alter table public.team_albums add constraint team_albums_cover_photo_fk foreign key(cover_photo_id) references public.team_album_photos(id) on delete restrict;
  end if;
end $$;
create table if not exists private.team_album_uploads (
  operation_id uuid primary key,
  photo_id uuid not null unique default gen_random_uuid(),
  album_id uuid not null references public.team_albums(id) on delete restrict,
  original_path text not null unique,
  thumbnail_path text not null unique,
  original_mime text not null check(original_mime in ('image/jpeg','image/png','image/webp')),
  original_size bigint not null check(original_size between 1 and 15728640),
  thumbnail_size bigint not null check(thumbnail_size between 1 and 1048576),
  width integer not null check(width between 1 and 50000),
  height integer not null check(height between 1 and 50000),
  filename text not null check(length(filename) between 1 and 255),
  expires_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
-- Anonymous activity is intentionally not attributed to a selected member name.
create table if not exists private.team_album_history (
  id bigint generated always as identity primary key,
  entity text not null check(entity in ('album','photo')),
  record_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
revoke all on private.team_album_uploads,private.team_album_history from public,anon,authenticated;

create or replace function private.team_album_lock() returns void
language sql security definer set search_path='' as $$
  select 1 from public.team_album_sync where id=1 for update;
$$;
create or replace function private.team_album_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.team_album_history(entity,record_id,action,before_data,after_data)
  values(case when tg_table_name='team_albums' then 'album' else 'photo' end,
    case when tg_op='DELETE' then old.id else new.id end,
    case when tg_op='INSERT' then 'created' when tg_op='DELETE' then 'deleted'
      when old.deleted_at is null and new.deleted_at is not null then 'trashed'
      when old.deleted_at is not null and new.deleted_at is null then 'restored' else 'updated' end,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end);
  update public.team_album_sync set revision=revision+1,updated_at=now() where id=1;
  return null;
end; $$;
revoke execute on function private.team_album_lock(),private.team_album_changed() from public,anon,authenticated;

-- Read-only public revision enables Realtime. Tables themselves have no writes
-- granted: open CRUD must still pass validation, conflicts and trash handling.
do $$ declare name text; begin
  foreach name in array array['team_album_sync','team_albums','team_album_photos'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on public.%I from public,anon,authenticated',name);
    execute format('grant select on public.%I to anon,authenticated',name);
    execute format('drop policy if exists team_album_public_read on public.%I',name);
    execute format('create policy team_album_public_read on public.%I for select to anon,authenticated using(true)',name);
  end loop;
  foreach name in array array['team_albums','team_album_photos'] loop
    execute format('drop trigger if exists team_album_changed on public.%I',name);
    execute format('create trigger team_album_changed after insert or update or delete on public.%I for each row execute function private.team_album_changed()',name);
  end loop;
end $$;

create or replace function public.get_team_album_snapshot() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version',1,'revision',s.revision,
    'realtime_enabled',exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='team_album_sync'),
    'albums',coalesce((select jsonb_agg(to_jsonb(a) order by coalesce(a.event_date,a.created_at::date) desc,a.created_at desc,a.id) from public.team_albums a),'[]'::jsonb),
    'photos',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at,p.id) from public.team_album_photos p),'[]'::jsonb))
  from public.team_album_sync s where s.id=1;
$$;

create or replace function public.save_team_album(p_id uuid,p_patch jsonb,p_expected_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.team_albums; next_cover uuid;
begin
  perform private.team_album_lock();
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('title','description','event_date','kind','cover_photo_id')) then
    raise exception 'Thông tin album không hợp lệ.';
  end if;
  if (p_patch ? 'title' and jsonb_typeof(p_patch->'title')<>'string')
    or (p_patch ? 'description' and jsonb_typeof(p_patch->'description')<>'string')
    or (p_patch ? 'kind' and jsonb_typeof(p_patch->'kind')<>'string') then
    raise exception 'Tên, mô tả và loại album phải là văn bản.';
  end if;
  if p_id is null then
    if nullif(btrim(p_patch->>'title'),'') is null then raise exception 'Nhập tên album.'; end if;
    insert into public.team_albums(title,description,event_date,kind)
    values(btrim(p_patch->>'title'),coalesce(p_patch->>'description',''),nullif(p_patch->>'event_date','')::date,coalesce(p_patch->>'kind','badminton')) returning * into a;
  else
    select * into a from public.team_albums where id=p_id for update;
    if not found then raise exception 'Không tìm thấy album.'; end if;
    if a.deleted_at is not null then raise exception 'Album đang ở Thùng rác. Khôi phục trước khi sửa.'; end if;
    if p_expected_version is null or a.version<>p_expected_version then raise exception 'Album vừa được người khác sửa. Tải dữ liệu mới rồi thử lại.' using errcode='PT409'; end if;
  end if;
  next_cover:=case when p_patch ? 'cover_photo_id' then nullif(p_patch->>'cover_photo_id','')::uuid else a.cover_photo_id end;
  if next_cover is not null and not exists(select 1 from public.team_album_photos where id=next_cover and album_id=a.id and deleted_at is null) then
    raise exception 'Ảnh bìa phải là ảnh còn hoạt động trong chính album này.';
  end if;
  if p_id is not null then
    update public.team_albums set title=case when p_patch ? 'title' then btrim(p_patch->>'title') else title end,
      description=case when p_patch ? 'description' then p_patch->>'description' else description end,
      event_date=case when p_patch ? 'event_date' then nullif(p_patch->>'event_date','')::date else event_date end,
      kind=case when p_patch ? 'kind' then p_patch->>'kind' else kind end,
      cover_photo_id=next_cover,version=version+1,updated_at=now()
    where id=a.id returning * into a;
  end if;
  return to_jsonb(a);
end; $$;

create or replace function public.save_team_album_photo(p_id uuid,p_patch jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.team_album_photos;
begin
  perform private.team_album_lock();
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k<>'caption')
    or not (p_patch ? 'caption') or jsonb_typeof(p_patch->'caption')<>'string' then raise exception 'Chỉ được sửa chú thích của ảnh.'; end if;
  select * into p from public.team_album_photos where id=p_id for update;
  if not found then raise exception 'Không tìm thấy ảnh.'; end if;
  if p.deleted_at is not null or exists(select 1 from public.team_albums where id=p.album_id and deleted_at is not null) then raise exception 'Ảnh hoặc album đang ở Thùng rác. Khôi phục trước khi sửa.'; end if;
  if p_expected_version is null or p.version<>p_expected_version then raise exception 'Chú thích vừa được người khác sửa. Tải dữ liệu mới rồi thử lại.' using errcode='PT409'; end if;
  update public.team_album_photos set caption=p_patch->>'caption',version=version+1,updated_at=now() where id=p.id returning * into p;
  return to_jsonb(p);
end; $$;

create or replace function public.set_team_album_deleted(p_id uuid,p_deleted boolean,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.team_albums;
begin
  perform private.team_album_lock();
  if p_deleted is null then raise exception 'Chọn xóa hoặc khôi phục album.'; end if;
  select * into a from public.team_albums where id=p_id for update;
  if not found then raise exception 'Không tìm thấy album.'; end if;
  if p_expected_version is null or a.version<>p_expected_version then raise exception 'Album vừa thay đổi. Tải dữ liệu mới rồi thử lại.' using errcode='PT409'; end if;
  if (a.deleted_at is not null)=p_deleted then return to_jsonb(a); end if;
  update public.team_albums set deleted_at=case when p_deleted then now() else null end,version=version+1,updated_at=now() where id=a.id returning * into a;
  -- Do not touch photo deleted_at: restoring an album must NOT restore a photo
  -- that somebody had independently sent to Trash before deleting the album.
  return to_jsonb(a);
end; $$;

create or replace function public.set_team_album_photo_deleted(p_id uuid,p_deleted boolean,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.team_album_photos;
begin
  perform private.team_album_lock();
  if p_deleted is null then raise exception 'Chọn xóa hoặc khôi phục ảnh.'; end if;
  select * into p from public.team_album_photos where id=p_id for update;
  if not found then raise exception 'Không tìm thấy ảnh.'; end if;
  if p_expected_version is null or p.version<>p_expected_version then raise exception 'Ảnh vừa thay đổi. Tải dữ liệu mới rồi thử lại.' using errcode='PT409'; end if;
  if exists(select 1 from public.team_albums where id=p.album_id and deleted_at is not null) then raise exception 'Hãy khôi phục album trước khi thay đổi ảnh.'; end if;
  if (p.deleted_at is not null)=p_deleted then return to_jsonb(p); end if;
  update public.team_album_photos set deleted_at=case when p_deleted then now() else null end,version=version+1,updated_at=now() where id=p.id returning * into p;
  if p_deleted then
    update public.team_albums set cover_photo_id=null,version=version+1,updated_at=now() where id=p.album_id and cover_photo_id=p.id;
  end if;
  return to_jsonb(p);
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-album','team-album',true,15728640,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Each unguessable exact path is an INSERT-only capability. There is no UPDATE
-- or DELETE Storage grant/policy from this migration and no arbitrary folder ACL.
create or replace function public.can_upload_team_album(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.team_album_uploads u join public.team_albums a on a.id=u.album_id
    where p_path in (u.original_path,u.thumbnail_path) and u.expires_at>now() and u.finished_at is null and a.deleted_at is null
    and not exists(select 1 from storage.objects o where o.bucket_id='team-album' and o.name=p_path));
$$;
drop policy if exists team_album_scoped_insert on storage.objects;
create policy team_album_scoped_insert on storage.objects for insert to anon,authenticated
with check(bucket_id='team-album' and public.can_upload_team_album(name));

create or replace function public.prepare_team_album_upload(p_album_id uuid,p_operation_id uuid,p_original_mime text,p_original_size numeric,p_thumbnail_size numeric,p_width integer,p_height integer,p_filename text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u private.team_album_uploads; extension text;
begin
  perform private.team_album_lock();
  if p_operation_id is null then raise exception 'Thiếu mã thao tác tải ảnh.'; end if;
  if not exists(select 1 from public.team_albums where id=p_album_id and deleted_at is null) then raise exception 'Album không tồn tại hoặc đang ở Thùng rác.'; end if;
  if p_original_mime is null or p_original_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Chọn ảnh JPG, PNG hoặc WebP.'; end if;
  if p_original_size is null or p_original_size<>trunc(p_original_size) or p_original_size<1 or p_original_size>15728640
    or p_thumbnail_size is null or p_thumbnail_size<>trunc(p_thumbnail_size) or p_thumbnail_size<1 or p_thumbnail_size>1048576 then raise exception 'Ảnh tối đa 15 MB, ảnh thu nhỏ tối đa 1 MB; dung lượng phải hợp lệ.'; end if;
  if p_width is null or p_height is null or p_width not between 1 and 50000 or p_height not between 1 and 50000 then raise exception 'Kích thước ảnh không hợp lệ.'; end if;
  if p_filename is null or length(btrim(p_filename)) not between 1 and 255 then raise exception 'Tên tệp ảnh không hợp lệ.'; end if;
  select * into u from private.team_album_uploads where operation_id=p_operation_id for update;
  if found then
    if u.album_id<>p_album_id or u.original_mime<>p_original_mime or u.original_size<>p_original_size
      or u.thumbnail_size<>p_thumbnail_size or u.width<>p_width or u.height<>p_height or u.filename<>p_filename then
      raise exception 'Mã thao tác đã dùng cho một ảnh khác. Chọn lại tệp để tạo lượt tải mới.';
    end if;
    -- A lost finish response may be retried much later. Renew the response
    -- deadline even for completed operations; finished_at still forbids uploads.
    update private.team_album_uploads set expires_at=now()+interval '30 minutes' where operation_id=p_operation_id returning * into u;
  else
    extension:=case p_original_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
    insert into private.team_album_uploads(operation_id,album_id,original_path,thumbnail_path,original_mime,original_size,thumbnail_size,width,height,filename,expires_at)
    values(p_operation_id,p_album_id,'originals/'||gen_random_uuid()::text||'.'||extension,'thumbnails/'||gen_random_uuid()::text||'.webp',
      p_original_mime,p_original_size::bigint,p_thumbnail_size::bigint,p_width,p_height,p_filename,now()+interval '30 minutes') returning * into u;
  end if;
  return jsonb_build_object('operation_id',u.operation_id,'photo_id',u.photo_id,'bucket','team-album','original_path',u.original_path,'thumbnail_path',u.thumbnail_path,'expires_at',u.expires_at,
    'original_exists',exists(select 1 from storage.objects where bucket_id='team-album' and name=u.original_path),
    'thumbnail_exists',exists(select 1 from storage.objects where bucket_id='team-album' and name=u.thumbnail_path));
end; $$;

create or replace function public.finish_team_album_upload(p_operation_id uuid,p_caption text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u private.team_album_uploads; p public.team_album_photos; original_meta jsonb; thumbnail_meta jsonb;
begin
  perform private.team_album_lock();
  select * into u from private.team_album_uploads where operation_id=p_operation_id for update;
  if not found then raise exception 'Không tìm thấy lượt tải ảnh. Hãy thử tải lại.'; end if;
  select * into p from public.team_album_photos where id=u.photo_id;
  if found then return to_jsonb(p); end if;
  if u.expires_at<=now() then raise exception 'Lượt tải đã hết hạn. Bấm thử lại để tiếp tục.'; end if;
  if not exists(select 1 from public.team_albums where id=u.album_id and deleted_at is null) then raise exception 'Album đang ở Thùng rác. Khôi phục album rồi thử lại.'; end if;
  if p_caption is null or length(p_caption)>2000 then raise exception 'Chú thích tối đa 2.000 ký tự.'; end if;
  select metadata into original_meta from storage.objects where bucket_id='team-album' and name=u.original_path;
  select metadata into thumbnail_meta from storage.objects where bucket_id='team-album' and name=u.thumbnail_path;
  if original_meta is null or thumbnail_meta is null then raise exception 'Ảnh gốc hoặc ảnh thu nhỏ chưa tải xong. Hãy thử lại.'; end if;
  if original_meta->>'mimetype' is distinct from u.original_mime or thumbnail_meta->>'mimetype' is distinct from 'image/webp'
    or not coalesce(original_meta->>'size' ~ '^[0-9]+$',false) or not coalesce(thumbnail_meta->>'size' ~ '^[0-9]+$',false) then
    raise exception 'Tệp tải lên không khớp định dạng ảnh đã chọn. Hãy chọn lại tệp.';
  end if;
  if (original_meta->>'size')::numeric<>u.original_size or (thumbnail_meta->>'size')::numeric<>u.thumbnail_size then
    raise exception 'Dung lượng tệp tải lên không khớp. Hãy chọn lại tệp.';
  end if;
  insert into public.team_album_photos(id,album_id,original_path,thumbnail_path,original_mime,original_size,width,height,filename,caption)
  values(u.photo_id,u.album_id,u.original_path,u.thumbnail_path,u.original_mime,u.original_size,u.width,u.height,u.filename,p_caption) returning * into p;
  update private.team_album_uploads set finished_at=now() where operation_id=p_operation_id;
  return to_jsonb(p);
end; $$;

revoke execute on function public.get_team_album_snapshot(),public.save_team_album(uuid,jsonb,integer),public.save_team_album_photo(uuid,jsonb,integer),public.set_team_album_deleted(uuid,boolean,integer),public.set_team_album_photo_deleted(uuid,boolean,integer),public.can_upload_team_album(text),public.prepare_team_album_upload(uuid,uuid,text,numeric,numeric,integer,integer,text),public.finish_team_album_upload(uuid,text) from public,anon,authenticated;
grant execute on function public.get_team_album_snapshot(),public.save_team_album(uuid,jsonb,integer),public.save_team_album_photo(uuid,jsonb,integer),public.set_team_album_deleted(uuid,boolean,integer),public.set_team_album_photo_deleted(uuid,boolean,integer),public.can_upload_team_album(text),public.prepare_team_album_upload(uuid,uuid,text,numeric,numeric,integer,integer,text),public.finish_team_album_upload(uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;

-- REALTIME: Supabase deployment-only publication; local PostgreSQL tests omit it.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='team_album_sync') then
    alter publication supabase_realtime add table public.team_album_sync;
  end if;
end $$;
