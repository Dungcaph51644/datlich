-- Run after finance 003, automatic fees/covers 004 and practical updates.
-- No amounts, attendance, receipts or finalized calculations are changed.
begin;

create table if not exists private.payment_qr_uploads (
  path text primary key,
  actor_member_id uuid not null references public.members(id) on delete restrict,
  activity_id uuid not null references public.club_activities(id) on delete restrict,
  admin_issued boolean not null,
  mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check(byte_size between 1 and 5242880),
  expires_at timestamptz not null,
  ready_at timestamptz,
  created_at timestamptz not null default now()
);
revoke all on private.payment_qr_uploads from public,anon,authenticated;

create table if not exists public.activity_payment_settings (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null unique references public.club_activities(id) on delete restrict,
  qr_path text references private.payment_qr_uploads(path) on delete restrict,
  receiver_name text not null default '' check(length(receiver_name)<=120),
  bank_name text not null default '' check(length(bank_name)<=120),
  account_number text not null default '' check(length(account_number)<=80),
  transfer_note text not null default '' check(length(transfer_note)<=140),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.activity_payment_settings enable row level security;
revoke all on public.activity_payment_settings from public,anon,authenticated;
drop trigger if exists finance_sync_touch on public.activity_payment_settings;
create trigger finance_sync_touch after insert or update or delete on public.activity_payment_settings
for each row execute function private.booking_touch();
drop trigger if exists finance_audit on public.activity_payment_settings;
create trigger finance_audit after insert or update or delete on public.activity_payment_settings
for each row execute function private.finance_audit();

-- Random, immutable paths are shared image links, as with existing trip covers.
-- Only an exact short-lived capability can INSERT; no client UPDATE/DELETE.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-qrs','payment-qrs',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_upload_payment_qr(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from private.payment_qr_uploads u
    join public.members m on m.id=u.actor_member_id and m.active
    join public.club_activities a on a.id=u.activity_id and a.merged_into_id is null
    where u.path=p_path and u.expires_at>now() and u.ready_at is null
    and not exists(select 1 from storage.objects o where o.bucket_id='payment-qrs' and o.name=p_path)
    and (
      (u.admin_issued and exists(select 1 from public.account_links l where l.member_id=m.id and l.role='admin'))
      or a.organizer_id=m.id
      or (a.kind='badminton' and a.organizer_id is null
        and exists(select 1 from public.activity_groups where activity_id=a.id)
        and not exists(select 1 from public.activity_groups g join public.sessions s on s.id=g.session_id
          where g.activity_id=a.id and s.organizer_id is distinct from m.id))
    )
  );
$$;
revoke all on function public.can_upload_payment_qr(text) from public,anon,authenticated;
grant execute on function public.can_upload_payment_qr(text) to anon,authenticated;
drop policy if exists payment_qr_scoped_insert on storage.objects;
create policy payment_qr_scoped_insert on storage.objects for insert to anon,authenticated
with check(bucket_id='payment-qrs' and public.can_upload_payment_qr(name));

create or replace function public.prepare_payment_qr_upload(p_activity uuid,p_mime text,p_size numeric,p_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mid uuid; object_path text; deadline timestamptz:=now()+interval '15 minutes'; extension text;
begin
  mid:=private.finance_access(p_activity,p_token);
  if p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Chọn ảnh QR JPG, PNG hoặc WebP.'; end if;
  if p_size is null or p_size<>trunc(p_size) or p_size<1 or p_size>5242880 then raise exception 'Ảnh QR phải có dung lượng từ 1 byte đến 5 MB.'; end if;
  extension:=case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
  object_path:='qr/'||gen_random_uuid()::text||'.'||extension;
  insert into private.payment_qr_uploads(path,actor_member_id,activity_id,admin_issued,mime,byte_size,expires_at)
  values(object_path,mid,p_activity,public.is_admin(),p_mime,p_size::bigint,deadline);
  return jsonb_build_object('bucket','payment-qrs','path',object_path,'expires_at',deadline);
end; $$;

create or replace function public.complete_payment_qr_upload(p_path text,p_token text default null)
returns void language plpgsql security definer set search_path='' as $$
declare u private.payment_qr_uploads; mid uuid;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into u from private.payment_qr_uploads where path=p_path for update;
  if not found then raise exception 'Không tìm thấy ảnh QR đã tải.'; end if;
  if u.actor_member_id<>mid and not public.is_admin() then raise exception 'Bạn không được lưu ảnh QR này.' using errcode='42501'; end if;
  perform private.finance_access(u.activity_id,p_token);
  if u.ready_at is null and u.expires_at<=now() then raise exception 'Quyền tải ảnh đã hết hạn. Hãy chọn lại ảnh.'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='payment-qrs' and o.name=p_path
    and o.metadata->>'mimetype'=u.mime and (o.metadata->>'size')::bigint=u.byte_size) then
    raise exception 'Máy chủ chưa xác nhận đúng ảnh QR. Hãy thử tải lại.';
  end if;
  update private.payment_qr_uploads set ready_at=coalesce(ready_at,now()) where path=p_path;
end; $$;

create or replace function public.get_payment_qr_library(p_activity uuid,p_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  -- Managers can reuse shared QR images without being allowed to edit other events.
  perform private.finance_access(p_activity,p_token);
  return coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (
    select u.path,u.created_at,
      coalesce((select nullif(p.receiver_name,'') from public.activity_payment_settings p where p.qr_path=u.path order by p.updated_at desc limit 1),'QR đã tải') label,
      coalesce((select p.bank_name from public.activity_payment_settings p where p.qr_path=u.path order by p.updated_at desc limit 1),'') bank_name,
      coalesce((select p.account_number from public.activity_payment_settings p where p.qr_path=u.path order by p.updated_at desc limit 1),'') account_number
    from private.payment_qr_uploads u where u.ready_at is not null
      and exists(select 1 from storage.objects o where o.bucket_id='payment-qrs' and o.name=u.path)
    order by u.created_at desc limit 60
  ) q),'[]'::jsonb);
end; $$;

create or replace function public.save_activity_payment_settings(p_activity uuid,p_patch jsonb,p_expected_version integer,p_token text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v public.activity_payment_settings; mid uuid; k text; text_value text;
begin
  mid:=private.finance_access(p_activity,p_token);
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb then raise exception 'Chưa có thay đổi thanh toán để lưu.'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('qr_path','receiver_name','bank_name','account_number','transfer_note') then raise exception 'Trường thông tin thanh toán không hợp lệ.'; end if;
    if jsonb_typeof(p_patch->k) is distinct from 'string' and not (k='qr_path' and p_patch->k='null'::jsonb) then raise exception 'Thông tin thanh toán cần là văn bản.'; end if;
  end loop;
  select * into v from public.activity_payment_settings where activity_id=p_activity for update;
  if coalesce(v.version,0) is distinct from p_expected_version then raise exception 'Thông tin nhận tiền đã thay đổi trên thiết bị khác. Đối chiếu bản mới trước khi lưu.' using errcode='PT409'; end if;
  if v.id is null then v.receiver_name:='';v.bank_name:='';v.account_number:='';v.transfer_note:=''; end if;
  v:=jsonb_populate_record(v,p_patch);
  v.receiver_name:=trim(v.receiver_name);v.bank_name:=trim(v.bank_name);v.account_number:=trim(v.account_number);v.transfer_note:=trim(v.transfer_note);
  foreach text_value in array array[v.receiver_name,v.bank_name,v.account_number,v.transfer_note] loop
    if text_value~'[[:cntrl:]]' then raise exception 'Thông tin chuyển khoản không được chứa ký tự điều khiển hoặc xuống dòng.'; end if;
  end loop;
  if length(v.receiver_name)>120 or length(v.bank_name)>120 or length(v.account_number)>80 or length(v.transfer_note)>140 then raise exception 'Thông tin nhận tiền quá dài.'; end if;
  if v.qr_path is not null and not exists(select 1 from private.payment_qr_uploads u join storage.objects o on o.bucket_id='payment-qrs' and o.name=u.path where u.path=v.qr_path and u.ready_at is not null) then raise exception 'Ảnh QR chưa được tải và xác nhận trên máy chủ.'; end if;
  if (v.qr_path is not null or v.receiver_name<>'' or v.bank_name<>'' or v.account_number<>'') and (v.receiver_name='' or v.bank_name='' or v.account_number='') then raise exception 'Nhập đủ tên người nhận, ngân hàng và số tài khoản để thành viên đối chiếu.'; end if;
  if v.id is null then
    insert into public.activity_payment_settings(activity_id,qr_path,receiver_name,bank_name,account_number,transfer_note)
    values(p_activity,v.qr_path,v.receiver_name,v.bank_name,v.account_number,v.transfer_note);
  else
    update public.activity_payment_settings set qr_path=v.qr_path,receiver_name=v.receiver_name,bank_name=v.bank_name,account_number=v.account_number,transfer_note=v.transfer_note,version=version+1,updated_at=now() where id=v.id;
  end if;
  -- Prevent regrouping an automatic sheet after payment setup; preserve all fees.
  update public.club_activities set version=version+1 where id=p_activity;
end; $$;

create or replace function private.activity_payment_snapshot(p_activity uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce((select to_jsonb(p)-'id'-'activity_id' from public.activity_payment_settings p where activity_id=p_activity),
    jsonb_build_object('version',0,'qr_path',null,'receiver_name','','bank_name','','account_number','','transfer_note',''));
$$;

-- Extend the existing snapshot in place: preserve every previous feature and
-- permission fix, and avoid copying/forking the finance snapshot implementation.
do $$
declare target regprocedure:=to_regprocedure('public.get_activity_snapshot(text)'); definition text;
begin
  if target is null then raise exception 'Cần chạy migration tài chính trước khi cài QR thanh toán.'; end if;
  definition:=pg_get_functiondef(target);
  if position('private.activity_payment_snapshot' in definition)=0 then
    definition:=replace(definition,'to_jsonb(a)||jsonb_build_object(', 'to_jsonb(a)||jsonb_build_object(''payment'',private.activity_payment_snapshot(a.id),');
    if position('private.activity_payment_snapshot' in definition)=0 then raise exception 'Phiên bản snapshot chưa tương thích. Cần cài migration tài chính 004 trước.'; end if;
    execute definition;
  end if;
end $$;

revoke all on function private.activity_payment_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.prepare_payment_qr_upload(uuid,text,numeric,text),public.complete_payment_qr_upload(text,text),public.get_payment_qr_library(uuid,text),public.save_activity_payment_settings(uuid,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.prepare_payment_qr_upload(uuid,text,numeric,text),public.complete_payment_qr_upload(text,text),public.get_payment_qr_library(uuid,text),public.save_activity_payment_settings(uuid,jsonb,integer,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
