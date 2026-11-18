-- Let an active selected member update only shared scheduling fields.
-- This follows the club's existing name-selected trust model; it does not grant
-- permission to edit organizers, attendance, costs, or booking notes.
begin;

create or replace function public.quick_update_booking_session(
  p_id uuid,
  p_member_id uuid,
  p_patch jsonb,
  p_expected_version integer,
  p_token text default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.sessions; c public.sessions; k text;
begin
  perform private.booking_lock();
  if p_member_id is null or not exists(
    select 1 from public.members where id=p_member_id and active
  ) then
    raise exception 'Hãy chọn một thành viên đang hoạt động trước khi cập nhật lịch.' using errcode='42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object'
    or p_patch='{}'::jsonb then
    raise exception 'Chưa có thông tin đặt sân cần cập nhật.';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in (
      'session_date','start_time','end_time','venue','court','address',
      'maps_url','booking_status'
    ) then
      raise exception 'Thành viên chỉ được cập nhật ngày giờ, sân, địa điểm, bản đồ và trạng thái đặt sân.' using errcode='42501';
    end if;
    if jsonb_typeof(p_patch->k) is distinct from 'string' then
      raise exception 'Giá trị đặt sân không hợp lệ.';
    end if;
  end loop;

  select * into v from public.sessions where id=p_id for update;
  if not found then raise exception 'Buổi đánh không tồn tại.'; end if;
  if v.version is distinct from p_expected_version then
    raise exception 'Lịch vừa được cập nhật trên thiết bị khác. Hãy xem bản mới trước khi lưu.' using errcode='PT409';
  end if;
  if (v.session_date+v.end_time) at time zone 'Asia/Ho_Chi_Minh'<=now() then
    raise exception 'Buổi đánh đã kết thúc; thành viên không thể sửa lịch cũ.' using errcode='42501';
  end if;

  select * into c from jsonb_populate_record(null::public.sessions,to_jsonb(v)||p_patch);
  if c.end_time<=c.start_time then
    raise exception 'Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.';
  end if;
  if (c.session_date+c.end_time) at time zone 'Asia/Ho_Chi_Minh'<=now() then
    raise exception 'Ngày giờ mới đã qua. Hãy chọn một thời điểm trong tương lai.';
  end if;

  perform set_config('app.booking_member_id',p_member_id::text,true);
  update public.sessions set
    session_date=c.session_date,
    start_time=c.start_time,
    end_time=c.end_time,
    venue=c.venue,
    court=c.court,
    address=c.address,
    maps_url=c.maps_url,
    booking_status=c.booking_status,
    version=v.version+1
  where id=p_id;
  return p_id;
end; $$;

revoke all on function public.quick_update_booking_session(uuid,uuid,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.quick_update_booking_session(uuid,uuid,jsonb,integer,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
