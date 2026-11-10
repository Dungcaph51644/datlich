import { createClient } from '@supabase/supabase-js';
import type {
  Attendance,
  AttendanceStatus,
  CourtSession,
  Roster,
} from './types';

const url = import.meta.env?.VITE_SUPABASE_URL;
const key = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = !!(
  url?.startsWith('https://') &&
  key &&
  !url.includes('YOUR_PROJECT') &&
  !key.includes('YOUR_')
);
export const supabase = configured
  ? createClient(url, key, {
      auth: { detectSessionInUrl: true, flowType: 'pkce' },
    })
  : null;
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!supabase)
    throw new Error('Chưa kết nối Supabase. Hãy cấu hình backend theo README.');
  if (!navigator.onLine)
    throw new Error('Bạn đang mất mạng. Dữ liệu chưa được lưu.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  return 'Không thể kết nối máy chủ. Vui lòng thử lại.';
}
export async function selectAll<T>(
  table: 'members' | 'attendance' | 'session_roster',
) {
  if (!supabase) throw new Error('Chưa kết nối Supabase.');
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabase
      .from(table)
      .select('*')
      .order(
        table === 'members'
          ? 'code'
          : table === 'attendance'
            ? 'id'
            : 'session_id',
      );
    if (table === 'session_roster') query = query.order('member_id');
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data as T[]));
    if (data.length < 500) return { data: rows, error: null };
  }
}
export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function monday(offset = 0) {
  const date = vietnamToday();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + offset * 7);
  return date;
}
export function vietnamToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (part: string) => parts.find((p) => p.type === part)!.value;
  return new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00`);
}
export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
export function formatDate(
  value: string,
  opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  },
) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('vi-VN', opts);
}
export function summary(
  session: CourtSession,
  roster: Roster[],
  attendance: Attendance[],
) {
  const rows = attendance.filter((a) => a.session_id === session.id);
  const ids = new Set([
    ...roster
      .filter((r) => r.session_id === session.id)
      .map((r) => r.member_id),
    ...rows.map((a) => a.member_id),
  ]);
  const going = rows.filter((a) => a.status === 'going').length;
  const no = rows.filter((a) => a.status === 'not_going').length;
  return { going, no, unanswered: ids.size - going - no, total: ids.size };
}
export function registrationArgs(
  sessionId: string,
  memberId: string,
  field: 'status' | 'note',
  value: string,
  row?: Attendance,
) {
  return {
    p_session_id: sessionId,
    p_member_id: memberId,
    p_status: field === 'status' ? (value as AttendanceStatus) : null,
    p_note: field === 'note' ? value : null,
    p_expected_note_version: field === 'note' ? (row?.note_version ?? 0) : null,
  };
}
export function registrationClosed(session: CourtSession, admin = false) {
  if (session.booking_status === 'cancelled') return 'Buổi đánh đã hủy';
  if (
    new Date(`${session.session_date}T${session.end_time}+07:00`) <= new Date()
  )
    return 'Buổi đánh đã kết thúc';
  if (!admin && session.deadline && new Date(session.deadline) <= new Date())
    return 'Đã hết hạn đăng ký';
  return '';
}
