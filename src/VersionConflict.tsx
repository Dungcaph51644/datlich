import React from 'react';
import type { CourtSession, Member } from './types';

export type FormFields = Record<string, string | boolean>;
export function memberFormValues(member: Member): FormFields {
  return { display_name: member.display_name, note: member.note, active: member.active };
}
export function sessionFormValues(session: CourtSession): FormFields {
  const deadline = session.deadline ? new Date(new Date(session.deadline).getTime() + 7 * 3600000).toISOString().slice(0, 16) : '';
  return {
    session_date: session.session_date, start_time: session.start_time.slice(0, 5), end_time: session.end_time.slice(0, 5), venue: session.venue, court: session.court, address: session.address, maps_url: session.maps_url,
    organizer_mode: session.organizer_mode ?? (session.organizer_id ? 'override' : 'weekly'), organizer_id: session.organizer_id ?? '', booking_status: session.booking_status, max_players: session.max_players == null ? '' : String(session.max_players), note: session.note, deadline,
    estimated_cost: session.estimated_cost == null ? '' : String(session.estimated_cost), booking_contact_note: session.booking_contact_note ?? '', deposit_note: session.deposit_note ?? '', booked_by_member_id: session.booked_by_member_id ?? '',
  };
}
/** Called only after the user explicitly picks a conflict-resolution action. */
export function mergeConflictFields(form: HTMLFormElement, before: FormFields, latest: FormFields, keepDraft: boolean): FormFields {
  const result = { ...latest };
  for (const [name, incoming] of Object.entries(latest)) {
    const element = form.elements.namedItem(name);
    const view = form.ownerDocument.defaultView;
    if (
      !view ||
      !(element instanceof view.HTMLInputElement) &&
        !(element instanceof view.HTMLTextAreaElement) &&
        !(element instanceof view.HTMLSelectElement)
    )
      continue;
    const checkbox =
      element instanceof view.HTMLInputElement && element.type === 'checkbox';
    const current = checkbox ? element.checked : element.value;
    const keep = keepDraft && current !== before[name];
    if (keep) result[name] = current;
    else if (checkbox && element instanceof view.HTMLInputElement)
      element.checked = Boolean(incoming);
    else element.value = String(incoming);
  }
  return result;
}
const labels: Record<string, string> = { display_name: 'Tên', active: 'Hoạt động', note: 'Ghi chú', session_date: 'Ngày', start_time: 'Giờ bắt đầu', end_time: 'Giờ kết thúc', venue: 'Tên sân', court: 'Ca / sân', address: 'Địa chỉ', maps_url: 'Bản đồ', organizer_mode: 'Cách phân công', organizer_id: 'Người phụ trách (ID)', booking_status: 'Trạng thái sân', max_players: 'Số người tối đa', deadline: 'Hạn đăng ký', estimated_cost: 'Tiền sân dự kiến', booking_contact_note: 'Liên hệ', deposit_note: 'Đặt cọc', booked_by_member_id: 'Người đã đặt (ID)' };
const display = (value: string | boolean) => value === true ? 'Có' : value === false ? 'Không' : value || '(Trống)';
export function VersionConflict({ before, latest, onKeepDraft, onUseLatest }: { before: FormFields; latest: FormFields; onKeepDraft: () => void; onUseLatest: () => void }) {
  const changes = Object.keys(latest).filter((key) => latest[key] !== before[key]);
  return <div className="form-conflict-details" role="alert"><strong>Dữ liệu vừa được sửa trên thiết bị khác</strong><p>Chưa ghi đè nội dung. Đối chiếu bản mới rồi chọn cách tiếp tục:</p><dl>{changes.map((key) => <React.Fragment key={key}><dt>{labels[key] ?? key}</dt><dd><small>Trước: {display(before[key])}</small><br /><strong>Mới: {display(latest[key])}</strong></dd></React.Fragment>)}</dl><div className="conflict-actions"><button type="button" className="btn btn-dark" onClick={onKeepDraft}>Giữ các trường tôi sửa</button><button type="button" className="btn btn-soft" onClick={onUseLatest}>Dùng toàn bộ bản mới</button></div><p className="form-help">Giữ các trường tôi sửa chỉ giữ phần bạn đã nhập; các trường còn lại lấy bản mới. Bấm Lưu sau khi kiểm tra.</p></div>;
}
