import { netPaid, PAYMENT_STATUS, paymentStatus, TRIP_STATUS, type ClubActivity, type FeePerson } from './activityTypes';
import type { Member } from './types';

const money = (value: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
const memberLabel = (members: Member[], id: string | null) => members.find((m) => m.id === id)?.display_name ?? 'Chưa xác định';

/** Include a traveller who cancelled after paying, so the refund is never hidden. */
export function activityFinancialPeople(a: ClubActivity, members: Member[]): FeePerson[] {
  const people = [...(a.calculation?.people ?? [])];
  if (a.kind === 'trip') {
    for (const p of a.participants ?? []) {
      if (!people.some((person) => person.id === p.id) && netPaid(a.ledger ?? [], p.id) !== 0) {
        people.push({ id: p.id, member_id: p.member_id, name: p.member_id ? memberLabel(members, p.member_id) : p.guest_name, units: 0, groups: [], exact: 0, due: 0 });
      }
    }
  }
  return people;
}

export function buildActivityMessage(a: ClubActivity, members: Member[], url: string): string {
  const calc = a.calculation;
  const people = activityFinancialPeople(a, members);
  const trip = a.kind === 'trip';
  const lines = [
    `${trip ? '🧳' : '🏸'} ${a.title}`,
    `${a.fee_status === 'finalized' ? 'ĐÃ CHỐT PHÍ' : 'TẠM TÍNH — số tiền có thể thay đổi'}${trip ? ` · ${TRIP_STATUS[a.status]}` : ''}`,
  ];
  if (trip) {
    if (a.details.start_date) lines.push(`Thời gian: ${a.details.start_date}${a.details.end_date ? ` → ${a.details.end_date}` : ''}`);
    if (a.details.location) lines.push(`Địa điểm: ${a.details.location}`);
  }
  if (a.organizer_id) lines.push(`Phụ trách: ${memberLabel(members, a.organizer_id)}`);
  lines.push(`Chi phí: ${money(calc?.total_cost ?? 0)} · ${calc?.headcount ?? 0} người${trip ? ` / ${calc?.shares ?? 0} suất` : ''}`);
  for (const expense of (a.expenses ?? []).filter((expense) => !expense.voided_at)) {
    const scope = expense.scope === 'group' ? a.groups?.find((g) => g.id === expense.group_id)?.label ?? 'Nhóm riêng' : expense.scope === 'selected' ? 'Những người được chọn' : 'Chung';
    lines.push(`• ${expense.name}: ${money(expense.actual)} (${scope})`);
  }
  lines.push('', 'Đối chiếu từng người:');
  for (const person of people) {
    const paid = netPaid(a.ledger ?? [], person.id);
    const left = person.due - paid;
    lines.push(`• ${person.name}: phải đóng ${money(person.due)} · đã đóng ròng ${money(paid)} · ${left < 0 ? `cần hoàn ${money(-left)}` : left > 0 ? `còn thiếu ${money(left)}` : person.due === 0 ? 'không phát sinh' : 'đã đủ'}`);
  }
  if (!people.length) lines.push('Chưa đủ dữ liệu để chia tiền.');
  lines.push('', `Tổng phải thu: ${money(calc?.total_due ?? 0)}`);
  if (calc?.surplus) lines.push(`Thu dư do làm tròn: ${money(calc.surplus)}`);
  for (const warning of calc?.warnings ?? []) lines.push(`Lưu ý: ${warning}`);
  lines.push('Ghi nhận thanh toán thủ công; xem dữ liệu mới nhất tại:', url);
  return lines.join('\n');
}

function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  // Text is never interpreted as a spreadsheet formula, even after leading spaces.
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** CSV contains a human summary and raw integer VND columns, with no BOM. */
export function buildActivityCsv(a: ClubActivity, members: Member[]): string {
  const rows: (string | number)[][] = [
    ['Hoạt động', a.title],
    ['Trạng thái phí', a.fee_status === 'finalized' ? 'Đã chốt' : 'Tạm tính'],
    ['Tổng chi phí (đ)', a.calculation?.total_cost ?? 0],
    ['Tổng phải thu (đ)', a.calculation?.total_due ?? 0],
    ['Thu dư do làm tròn (đ)', a.calculation?.surplus ?? 0],
    [],
    ['Thành viên / khách', 'Mã thành viên', 'Nhóm tham gia / số suất', 'Phải đóng (đ)', 'Đã thu ròng (đ)', 'Còn thiếu (đ)', 'Cần hoàn lại (đ)', 'Trạng thái', 'Ghi chú đăng ký'],
  ];
  for (const p of activityFinancialPeople(a, members)) {
    const paid = netPaid(a.ledger ?? [], p.id);
    const left = p.due - paid;
    const participant = a.participants?.find((person) => person.id === p.id);
    rows.push([p.name, members.find((m) => m.id === p.member_id)?.code ?? (participant?.invited_by ? `Khách của ${memberLabel(members, participant.invited_by)}` : ''), a.kind === 'trip' ? p.units / 1000 : p.groups.map((id) => a.groups?.find((g) => g.id === id)?.label ?? '').join(' + '), p.due, paid, Math.max(0, left), Math.max(0, -left), PAYMENT_STATUS[paymentStatus(p.due, paid)], participant?.note ?? '']);
  }
  rows.push([], ['Khoản chi', 'Phạm vi', 'Dự toán (đ)', 'Thực tế (đ)', 'Nguồn chi', 'Người ứng', 'Ghi chú']);
  for (const expense of (a.expenses ?? []).filter((expense) => !expense.voided_at)) {
    rows.push([expense.name, expense.scope === 'group' ? a.groups?.find((g) => g.id === expense.group_id)?.label ?? 'Nhóm riêng' : expense.scope === 'selected' ? 'Những người được chọn' : 'Chung', expense.estimated, expense.actual, expense.paid_from === 'personal' ? 'Cá nhân ứng' : expense.paid_from === 'fund' ? 'Từ quỹ' : 'Chưa ghi nhận', expense.payer_member_id ? memberLabel(members, expense.payer_member_id) : '', expense.note]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
