-- Allow JPEG thumbnail fallback for Safari canvas encoders that do not emit WebP.
-- Existing uploads remain WebP and retain their original retry paths.
begin;

alter table private.team_album_uploads
  add column if not exists thumbnail_mime text not null default 'image/webp'
  check(thumbnail_mime in ('image/webp','image/jpeg'));

create or replace function public.prepare_team_album_upload(
  p_album_id uuid,
  p_operation_id uuid,
  p_original_mime text,
  p_original_size numeric,
  p_thumbnail_size numeric,
  p_width integer,
  p_height integer,
  p_filename text,
  p_thumbnail_mime text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u private.team_album_uploads; extension text; thumbnail_extension text;
begin
  perform private.team_album_lock();
  if p_operation_id is null then raise exception 'Thiếu mã thao tác tải ảnh.'; end if;
  if not exists(select 1 from public.team_albums where id=p_album_id and deleted_at is null) then raise exception 'Album không tồn tại hoặc đang ở Thùng rác.'; end if;
  if p_original_mime is null or p_original_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Chọn ảnh JPG, PNG hoặc WebP.'; end if;
  if p_thumbnail_mime is null or p_thumbnail_mime not in ('image/webp','image/jpeg') then raise exception 'Ảnh thu nhỏ phải là WebP hoặc JPEG.'; end if;
  if p_original_size is null or p_original_size<>trunc(p_original_size) or p_original_size<1 or p_original_size>15728640
    or p_thumbnail_size is null or p_thumbnail_size<>trunc(p_thumbnail_size) or p_thumbnail_size<1 or p_thumbnail_size>1048576 then raise exception 'Ảnh tối đa 15 MB, ảnh thu nhỏ tối đa 1 MB; dung lượng phải hợp lệ.'; end if;
  if p_width is null or p_height is null or p_width not between 1 and 50000 or p_height not between 1 and 50000 then raise exception 'Kích thước ảnh không hợp lệ.'; end if;
  if p_filename is null or length(btrim(p_filename)) not between 1 and 255 then raise exception 'Tên tệp ảnh không hợp lệ.'; end if;
  select * into u from private.team_album_uploads where operation_id=p_operation_id for update;
  if found then
    if u.album_id<>p_album_id or u.original_mime<>p_original_mime or u.original_size<>p_original_size
      or u.thumbnail_size<>p_thumbnail_size or u.thumbnail_mime<>p_thumbnail_mime
      or u.width<>p_width or u.height<>p_height or u.filename<>p_filename then
      raise exception 'Mã thao tác đã dùng cho một ảnh khác. Chọn lại tệp để tạo lượt tải mới.';
    end if;
    update private.team_album_uploads set expires_at=now()+interval '30 minutes'
      where operation_id=p_operation_id returning * into u;
  else
    extension:=case p_original_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
    thumbnail_extension:=case p_thumbnail_mime when 'image/jpeg' then 'jpg' else 'webp' end;
    insert into private.team_album_uploads(
      operation_id,album_id,original_path,thumbnail_path,original_mime,original_size,
      thumbnail_size,thumbnail_mime,width,height,filename,expires_at
    )
    values(
      p_operation_id,p_album_id,
      'originals/'||gen_random_uuid()::text||'.'||extension,
      'thumbnails/'||gen_random_uuid()::text||'.'||thumbnail_extension,
      p_original_mime,p_original_size::bigint,p_thumbnail_size::bigint,p_thumbnail_mime,
      p_width,p_height,p_filename,now()+interval '30 minutes'
    ) returning * into u;
  end if;
  return jsonb_build_object(
    'operation_id',u.operation_id,'photo_id',u.photo_id,'bucket','team-album',
    'original_path',u.original_path,'thumbnail_path',u.thumbnail_path,
    'expires_at',u.expires_at,
    'original_exists',exists(select 1 from storage.objects where bucket_id='team-album' and name=u.original_path),
    'thumbnail_exists',exists(select 1 from storage.objects where bucket_id='team-album' and name=u.thumbnail_path)
  );
end; $$;

create or replace function public.finish_team_album_upload(p_operation_id uuid,p_caption text)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  if original_meta->>'mimetype' is distinct from u.original_mime
    or thumbnail_meta->>'mimetype' is distinct from u.thumbnail_mime
    or not coalesce(original_meta->>'size' ~ '^[0-9]+$',false)
    or not coalesce(thumbnail_meta->>'size' ~ '^[0-9]+$',false) then
    raise exception 'Tệp tải lên không khớp định dạng ảnh đã chọn. Hãy chọn lại tệp.';
  end if;
  if (original_meta->>'size')::numeric<>u.original_size
    or (thumbnail_meta->>'size')::numeric<>u.thumbnail_size then
    raise exception 'Dung lượng tệp tải lên không khớp. Hãy chọn lại tệp.';
  end if;
  insert into public.team_album_photos(
    id,album_id,original_path,thumbnail_path,original_mime,original_size,width,height,filename,caption
  )
  values(u.photo_id,u.album_id,u.original_path,u.thumbnail_path,u.original_mime,u.original_size,u.width,u.height,u.filename,p_caption)
  returning * into p;
  update private.team_album_uploads set finished_at=now() where operation_id=p_operation_id;
  return to_jsonb(p);
end; $$;

revoke all on function public.prepare_team_album_upload(uuid,uuid,text,numeric,numeric,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.prepare_team_album_upload(uuid,uuid,text,numeric,numeric,integer,integer,text,text) to anon,authenticated;
revoke all on function public.finish_team_album_upload(uuid,text) from public,anon,authenticated;
grant execute on function public.finish_team_album_upload(uuid,text) to anon,authenticated;

notify pgrst,'reload schema';
commit;
