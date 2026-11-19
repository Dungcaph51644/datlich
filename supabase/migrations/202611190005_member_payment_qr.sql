-- Run after 202611190003_activity_payment_qr.sql (and club_chat if installed).
-- One current QR per verified member. Automatic organizer settlement is a
-- convention, separate from actual cash receipts and refundable transfers.
begin;

-- Keep the version even when reverting an activity override to its personal
-- default, so an old editor cannot overwrite a newly recreated override.
alter table public.activity_payment_settings add column if not exists inherit_member boolean not null default false;

create table if not exists private.member_qr_uploads (
  path text primary key,
  member_id uuid not null references public.members(id) on delete restrict,
  mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check(byte_size between 1 and 5242880),
  expires_at timestamptz not null,
  ready_at timestamptz
);
create table if not exists private.member_payment_qrs (
  member_id uuid primary key references public.members(id) on delete restrict,
  qr_path text references private.member_qr_uploads(path) on delete restrict,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
revoke all on private.member_qr_uploads,private.member_payment_qrs from public,anon,authenticated;
drop trigger if exists member_qr_sync on private.member_payment_qrs;
create trigger member_qr_sync after insert or update or delete on private.member_payment_qrs
for each row execute function private.booking_touch();

create or replace function public.can_upload_member_payment_qr(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.member_qr_uploads u join public.members m on m.id=u.member_id and m.active
    where u.path=p_path and u.ready_at is null and u.expires_at>now()
    and not exists(select 1 from storage.objects o where o.bucket_id='payment-qrs' and o.name=p_path));
$$;
drop policy if exists member_payment_qr_insert on storage.objects;
create policy member_payment_qr_insert on storage.objects for insert to anon,authenticated
with check(bucket_id='payment-qrs' and public.can_upload_member_payment_qr(name));

create or replace function public.prepare_member_payment_qr_upload(p_mime text,p_size numeric,p_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mid uuid; object_path text; deadline timestamptz:=now()+interval '15 minutes';
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  if p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') then raise exception 'Chọn ảnh QR JPG, PNG hoặc WebP.'; end if;
  if p_size is null or p_size<>trunc(p_size) or p_size<1 or p_size>5242880 then raise exception 'Ảnh QR phải có dung lượng từ 1 byte đến 5 MB.'; end if;
  -- Bound abandoned permits as well as saved images, without changing another member's profile.
  if (select count(*) from private.member_qr_uploads where member_id=mid and expires_at>now())>=10 then
    raise exception 'Bạn đã tải nhiều ảnh liên tiếp. Hãy thử lại sau 15 phút.';
  end if;
  object_path:='qr/'||gen_random_uuid()::text||case p_mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
  insert into private.member_qr_uploads(path,member_id,mime,byte_size,expires_at) values(object_path,mid,p_mime,p_size::bigint,deadline);
  return jsonb_build_object('bucket','payment-qrs','path',object_path,'expires_at',deadline);
end; $$;

create or replace function public.complete_member_payment_qr_upload(p_path text,p_token text default null)
returns void language plpgsql security definer set search_path='' as $$
declare mid uuid; u private.member_qr_uploads;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into u from private.member_qr_uploads where path=p_path for update;
  if not found or u.member_id<>mid then raise exception 'Bạn không được lưu ảnh QR này.' using errcode='42501'; end if;
  if u.ready_at is null and u.expires_at<=now() then raise exception 'Quyền tải ảnh đã hết hạn. Hãy chọn lại ảnh.'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='payment-qrs' and o.name=p_path
    and o.metadata->>'mimetype'=u.mime and (o.metadata->>'size')::bigint=u.byte_size) then
    raise exception 'Máy chủ chưa xác nhận đúng ảnh QR. Hãy thử tải lại.';
  end if;
  update private.member_qr_uploads set ready_at=coalesce(ready_at,now()) where path=p_path;
end; $$;

create or replace function public.save_member_payment_qr(p_path text,p_expected_version integer,p_token text default null)
returns void language plpgsql security definer set search_path='' as $$
declare mid uuid; v private.member_payment_qrs;
begin
  perform private.booking_lock(); mid:=private.require_booking_actor(p_token);
  select * into v from private.member_payment_qrs where member_id=mid for update;
  if coalesce(v.version,0) is distinct from p_expected_version then
    raise exception 'QR cá nhân đã thay đổi trên thiết bị khác. Đối chiếu bản mới trước khi lưu.' using errcode='PT409';
  end if;
  if p_path is not null and not exists(select 1 from private.member_qr_uploads u join storage.objects o on o.bucket_id='payment-qrs' and o.name=u.path
    where u.path=p_path and u.member_id=mid and u.ready_at is not null) then
    raise exception 'Chỉ được dùng ảnh QR của chính bạn đã tải và xác nhận.' using errcode='42501';
  end if;
  insert into private.member_payment_qrs(member_id,qr_path) values(mid,p_path)
  on conflict(member_id) do update set qr_path=excluded.qr_path,version=private.member_payment_qrs.version+1,updated_at=now();
end; $$;

create or replace function private.member_payment_qr_snapshot(p_member uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p_member is null then null else jsonb_build_object('member_id',p_member,
    'qr_path',(select qr_path from private.member_payment_qrs where member_id=p_member),
    'version',coalesce((select version from private.member_payment_qrs where member_id=p_member),0)) end;
$$;

-- Resolve the assigned organizer, never the selected display name or the person
-- who clicked "booked". Mixed/unassigned groups have no automatic recipient.
create or replace function private.current_payment_organizer(p_activity uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select coalesce(a.organizer_id,case when a.kind='badminton' then (
    select (array_agg(distinct s.organizer_id))[1] from public.activity_groups g join public.sessions s on s.id=g.session_id
    where g.activity_id=a.id having count(distinct s.organizer_id)=1 and bool_and(s.organizer_id is not null)
  ) end) from public.club_activities a where a.id=p_activity;
$$;
create table if not exists private.final_payment_organizers (
  activity_id uuid primary key references public.club_activities(id) on delete restrict,
  member_id uuid references public.members(id) on delete restrict
);
revoke all on private.final_payment_organizers from public,anon,authenticated;
-- Preserve the current recipient for existing finalized sheets too. No fee or receipt is rewritten.
insert into private.final_payment_organizers(activity_id,member_id)
select id,private.current_payment_organizer(id) from public.club_activities where fee_status='finalized'
on conflict do nothing;

create or replace function private.freeze_payment_organizer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.fee_status='finalized' and old.fee_status is distinct from new.fee_status then
    insert into private.final_payment_organizers(activity_id,member_id) values(new.id,private.current_payment_organizer(new.id))
    on conflict(activity_id) do update set member_id=excluded.member_id;
  elsif new.fee_status='draft' then
    delete from private.final_payment_organizers where activity_id=new.id;
  end if;
  return null;
end; $$;
drop trigger if exists freeze_payment_organizer on public.club_activities;
create trigger freeze_payment_organizer after update of fee_status on public.club_activities
for each row execute function private.freeze_payment_organizer();

create or replace function private.payment_organizer(p_activity uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select case when a.fee_status='finalized' then (select member_id from private.final_payment_organizers where activity_id=a.id)
    else private.current_payment_organizer(a.id) end from public.club_activities a where a.id=p_activity;
$$;
create or replace function private.payment_calculation(p_activity uuid,p_calculation jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p_calculation is null then null else jsonb_set(p_calculation,'{people}',coalesce((
    select jsonb_agg(p||jsonb_build_object('organizer_paid',coalesce(a.kind='badminton' and (p->>'member_id')::uuid=private.payment_organizer(a.id),false)) order by ord)
    from public.club_activities a cross join jsonb_array_elements(p_calculation->'people') with ordinality as person(p,ord)
    where a.id=p_activity),'[]'::jsonb)) end;
$$;

create or replace function private.activity_payment_snapshot(p_activity uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when p.id is not null and not p.inherit_member then to_jsonb(p)-'id'-'activity_id'-'inherit_member'||jsonb_build_object('source','activity','organizer_id',mid)
    else jsonb_build_object('version',coalesce(p.version,0),'source','member','organizer_id',mid,'qr_path',q.qr_path,
      'receiver_name',coalesce(m.display_name,''),'bank_name','','account_number','','transfer_note','') end
  from (select private.payment_organizer(p_activity) mid) owner
  left join public.members m on m.id=mid
  left join private.member_payment_qrs q on q.member_id=mid
  left join public.activity_payment_settings p on p.activity_id=p_activity;
$$;
-- Explicit legacy settings remain available. Removing the override restores the personal QR.
create or replace function public.use_organizer_payment_qr(p_activity uuid,p_expected_version integer,p_token text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v integer;
begin
  perform private.finance_access(p_activity,p_token);
  select version into v from public.activity_payment_settings where activity_id=p_activity for update;
  if coalesce(v,0) is distinct from p_expected_version then raise exception 'Thông tin nhận tiền đã thay đổi. Hãy tải lại.' using errcode='PT409'; end if;
  update public.activity_payment_settings set inherit_member=true,qr_path=null,receiver_name='',bank_name='',account_number='',transfer_note='',version=version+1,updated_at=now()
  where activity_id=p_activity;
end; $$;

do $$
declare target regprocedure; definition text; original text;
begin
  target:=to_regprocedure('public.get_activity_snapshot(text)');
  if target is null then raise exception 'Cần cài phần tài chính và QR thanh toán trước.'; end if;
  definition:=pg_get_functiondef(target);
  if position('personal_payment_qr' in definition)=0 then
    definition:=replace(definition,'''automatic_fees'',true,','''automatic_fees'',true,''personal_payment_qr'',private.member_payment_qr_snapshot(private.booking_actor(p_token)),');
    definition:=replace(definition,'case when a.fee_status=''finalized'' then a.final_summary else private.finance_calculate(a.id) end',
      'private.payment_calculation(a.id,case when a.fee_status=''finalized'' then a.final_summary else private.finance_calculate(a.id) end)');
    if position('personal_payment_qr' in definition)=0 or position('private.payment_calculation' in definition)=0 then raise exception 'Snapshot tài chính chưa tương thích.'; end if;
    execute definition;
  end if;
  target:=to_regprocedure('public.save_activity_payment_settings(uuid,jsonb,integer,text)');
  definition:=pg_get_functiondef(target);
  if position('inherit_member=false' in definition)=0 then
    original:='set qr_path=v.qr_path,';
    if position(original in definition)=0 then raise exception 'Hàm lưu QR riêng chưa tương thích.'; end if;
    definition:=replace(definition,original,'set inherit_member=false,qr_path=v.qr_path,');
    execute definition;
  end if;
  -- Block duplicate charging of the organizer; refunds remain limited to actual receipts.
  target:=to_regprocedure('public.record_activity_payment(uuid,uuid,text,numeric,uuid,text,text)');
  definition:=pg_get_functiondef(target);
  if position('private.payment_organizer' in definition)=0 then
    original:='if p_kind=''settle'' then';
    if position(original in definition)=0 then raise exception 'Hàm ghi nhận thanh toán chưa tương thích.'; end if;
    definition:=replace(definition,original,$guard$
      if a.kind='badminton' and p_person=private.payment_organizer(p_activity) then
        if p_kind='settle' then return null; end if;
        if p_kind in ('collection','supplement') then raise exception 'Người phụ trách đã thanh toán mặc định; không thu trùng phần đóng của họ.'; end if;
      end if;
      if p_kind='settle' then
    $guard$);
    execute definition;
  end if;
  -- The chatbot must agree with the payment table while keeping actual receipts distinct.
  target:=to_regprocedure('public.get_chat_context(text,date,date,uuid,uuid,uuid,boolean,boolean,text)');
  if target is not null then
    definition:=pg_get_functiondef(target);
    if position('private.payment_calculation' in definition)=0 then
      definition:=replace(definition,'calc:=case when a.fee_status=''finalized'' then a.final_summary else private.finance_calculate(a.id) end;',
        'calc:=private.payment_calculation(a.id,case when a.fee_status=''finalized'' then a.final_summary else private.finance_calculate(a.id) end);');
      definition:=replace(definition,'''net_paid'',paid,', '''net_paid'',paid,''organizer_paid'',coalesce((p->>''organizer_paid'')::boolean,false),');
      definition:=replace(definition,'''balance'',(p->>''due'')::numeric-paid',
        '''balance'',(p->>''due'')::numeric-case when coalesce((p->>''organizer_paid'')::boolean,false) then greatest(paid,(p->>''due'')::numeric) else paid end');
      -- The cancelled-trip refund branch has no p variable; preserve that branch unchanged.
      definition:=replace(definition,'''due'',0,''net_paid'',paid,''organizer_paid'',coalesce((p->>''organizer_paid'')::boolean,false),', '''due'',0,''net_paid'',paid,');
      execute definition;
    end if;
  end if;
end $$;

revoke all on function private.member_payment_qr_snapshot(uuid),private.current_payment_organizer(uuid),private.freeze_payment_organizer(),private.payment_organizer(uuid),private.payment_calculation(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.can_upload_member_payment_qr(text),public.prepare_member_payment_qr_upload(text,numeric,text),public.complete_member_payment_qr_upload(text,text),public.save_member_payment_qr(text,integer,text),public.use_organizer_payment_qr(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.can_upload_member_payment_qr(text),public.prepare_member_payment_qr_upload(text,numeric,text),public.complete_member_payment_qr_upload(text,text),public.save_member_payment_qr(text,integer,text),public.use_organizer_payment_qr(uuid,integer,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
