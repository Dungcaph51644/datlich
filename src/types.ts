import type { BookingData } from './bookingTypes';
import type { ActivityData } from './activityTypes';
export type AttendanceStatus = 'going' | 'not_going' | 'unanswered';
export type BookingStatus = 'pending' | 'booked' | 'cancelled';
export interface Member {
  id: string;
  code: string;
  display_name: string;
  note: string;
  active: boolean;
  version: number;
}
export interface CourtSession {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  court: string;
  address: string;
  maps_url: string;
  organizer_id: string | null;
  booking_status: BookingStatus;
  max_players: number | null;
  note: string;
  deadline: string | null;
  version: number;
  organizer_name?: string;
  going_count?: number;
  organizer_mode?: 'weekly' | 'override';
  booked_by_member_id?: string | null;
  booked_by_name?: string | null;
  booked_at?: string | null;
  weekly_member_id?: string | null;
  estimated_cost?: number | null;
  booking_contact_note?: string;
  deposit_note?: string;
}
export interface Attendance {
  id: string;
  session_id: string;
  member_id: string;
  status: AttendanceStatus;
  note: string;
  note_version: number;
  updated_at: string;
}
export interface Account {
  user_id: string;
  member_id: string;
  role: 'admin' | 'member';
}
export interface Roster {
  session_id: string;
  member_id: string;
}
export interface Audit {
  id: number;
  actor_name: string;
  action: string;
  table_name: string;
  record_id: string;
  changed_fields: string[];
  created_at: string;
}
export interface SessionTemplate {
  id: string;
  name: string;
  template: Partial<CourtSession>;
  updated_at: string;
}
export interface BulkResult {
  session_id: string;
  ok: boolean;
  message?: string;
}
export interface QuickSnapshot {
  version: number;
  sessions: CourtSession[];
  members: Member[];
  attendance: Attendance[];
  roster: Roster[];
}
export interface Snapshot {
  sessions: CourtSession[];
  members: Member[];
  attendance: Attendance[];
  roster: Roster[];
  account: Account | null;
  audits: Audit[];
  templates: SessionTemplate[];
  booking: BookingData | null;
  activities: ActivityData | null;
}
export const EMPTY: Snapshot = {
  sessions: [],
  members: [],
  attendance: [],
  roster: [],
  account: null,
  audits: [],
  templates: [],
  booking: null,
  activities: null,
};
export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  going: 'Đi',
  not_going: 'Không đi',
  unanswered: 'Chưa phản hồi',
};
export const BOOKING_LABELS: Record<BookingStatus, string> = {
  pending: 'Chưa đặt',
  booked: 'Đã đặt',
  cancelled: 'Đã hủy',
};
