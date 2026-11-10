import type { CourtSession, QuickSnapshot } from './types';

export interface BookingAssignment {
  id: string;
  week_start: string;
  week_end: string;
  member_id: string;
  original_member_id: string;
  completed_member_id: string | null;
  completed_at: string | null;
  version: number;
  pending_swap_count: number;
}
export interface BookingRotation {
  member_id: string;
  eligible: boolean;
  sort_order: number;
  history_status: 'unknown' | 'confirmed';
  initial_completed_count: number;
  baseline_through: string;
  initial_last_week: string | null;
  version: number;
  completed_count: number;
  planned_count: number;
  last_week: string | null;
}
export type SwapStatus =
  'pending' | 'accepted' | 'rejected' | 'cancelled' | 'invalid';
export interface BookingSwap {
  id: string;
  from_assignment_id: string;
  to_assignment_id: string;
  from_member_id: string;
  to_member_id: string;
  from_version: number;
  to_version: number;
  from_week_start: string;
  from_week_end: string;
  to_week_start: string;
  to_week_end: string;
  reason: string;
  status: SwapStatus;
  created_at: string;
  responded_at: string | null;
  resolved_by_member_id: string | null;
  resolution_reason: string;
}
export interface BookingNotification {
  id: string;
  member_id: string;
  request_id: string | null;
  kind: string;
  message: string;
  read_at: string | null;
  created_at: string;
}
export interface AssignmentChange {
  assignment_id?: string;
  week_start?: string;
  week_end?: string;
  original_member_id?: string;
  before_member_id?: string | null;
  after_member_id?: string;
  completed_member_id?: string | null;
  member_id?: string;
}
export interface BookingHistory {
  id: number;
  event_type: string;
  actor_member_id: string | null;
  actor_name: string;
  changes: AssignmentChange[];
  request_id: string | null;
  requested_by_member_id: string | null;
  confirmed_by_member_id: string | null;
  session_id: string | null;
  session_snapshot: CourtSession | null;
  reason: string;
  created_at: string;
}
export interface BookingData {
  revision: number;
  realtime_enabled: boolean;
  initialized: boolean;
  setup_issues: { name: string; kind: 'missing' | 'ambiguous' }[];
  verified_member_id: string | null;
  identity_source: 'account' | 'code' | null;
  identity_expired: boolean;
  club: QuickSnapshot;
  assignments: BookingAssignment[];
  rotation: BookingRotation[];
  requests: BookingSwap[];
  notifications: BookingNotification[];
  history: BookingHistory[];
  credential_status: {
    member_id: string;
    devices: number;
    invite_pending: boolean;
  }[];
}
export interface ProposalRow {
  week_start: string;
  week_end: string;
  member_id: string;
  existing: boolean;
  reason: string;
  completed_count?: number;
  planned_count?: number;
  last_week?: string | null;
}
export interface BookingProposal {
  revision: number;
  rows: ProposalRow[];
}
export const SWAP_LABELS: Record<SwapStatus, string> = {
  pending: 'Chờ phản hồi',
  accepted: 'Đã chấp nhận',
  rejected: 'Đã từ chối',
  cancelled: 'Đã hủy',
  invalid: 'Không còn hiệu lực',
};
