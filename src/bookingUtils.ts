import { addDays, dateKey, formatDate } from './lib';
import type { Member } from './types';

export function bookingWeekStart(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return dateKey(addDays(date, -((date.getDay() + 6) % 7)));
}
export function bookingWeekEnd(value: string) {
  return dateKey(addDays(new Date(`${value}T12:00:00`), 6));
}
export function weekLabel(start: string, end = bookingWeekEnd(start)) {
  return `${formatDate(start, { day: '2-digit', month: '2-digit' })} – ${formatDate(end, { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}
export function memberName(members: Member[], id?: string | null) {
  return id
    ? (members.find((m) => m.id === id)?.display_name ??
        'Thành viên đã lưu trong lịch sử')
    : 'Chưa phân công';
}
export const bookingTime = (value: string) =>
  new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
export const currency = (value: number) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
