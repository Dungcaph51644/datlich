import type { QuickSnapshot } from './types';
export type ActivityKind = 'badminton' | 'trip';
export interface ActivityGroup {
  id: string;
  activity_id: string;
  session_id: string;
  label: string;
  basis: 'single' | 'shift' | 'court';
  sort_order: number;
}
export interface TripParticipant {
  id: string;
  activity_id: string;
  member_id: string | null;
  invited_by: string | null;
  guest_name: string;
  status: 'going' | 'not_going' | 'unanswered';
  note: string;
  billable: boolean;
  share_units: number;
  share_reason: string;
  version: number;
  updated_at: string;
}
export interface ActivityExpense {
  id: string;
  activity_id: string;
  name: string;
  category: string;
  estimated: number;
  actual: number;
  scope: 'all' | 'group' | 'selected';
  group_id: string | null;
  person_ids: string[];
  paid_from: 'unpaid' | 'fund' | 'personal';
  payer_member_id: string | null;
  note: string;
  version: number;
  voided_at: string | null;
}
export interface LedgerEntry {
  id: string;
  activity_id: string;
  operation_id: string;
  kind: 'collection' | 'supplement' | 'refund' | 'reimbursement';
  person_id: string | null;
  payee_member_id: string | null;
  amount: number;
  note: string;
  confirmed_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string;
}
export interface FeePerson {
  id: string;
  member_id: string | null;
  name: string;
  units: number;
  groups: string[];
  exact: number;
  due: number;
}
export interface FeeCalculation {
  total_cost: number;
  estimated: number;
  headcount: number;
  shares: number;
  total_due: number;
  surplus: number;
  people: FeePerson[];
  warnings: string[];
  breakdown: {
    expense_id: string;
    name: string;
    scope: string;
    group_id: string | null;
    amount: number;
    heads: number;
    units: number;
    allocations: { person_id: string; amount: number }[];
  }[];
}
export interface TripChecklist {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  responsible_id: string | null;
  status: 'todo' | 'preparing' | 'done';
  note: string;
  expense_id: string | null;
  version: number;
  voided_at: string | null;
}
export interface FinanceHistory {
  id: number;
  actor_name: string;
  action: string;
  table_name: string;
  record_id: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  reason: string;
  created_at: string;
}
export interface ActivityDetails {
  description?: string;
  cover_url?: string;
  location?: string;
  address?: string;
  maps_url?: string;
  start_date?: string;
  end_date?: string;
  itinerary?: { day: string; content: string }[];
  budget_per_person?: number;
  deadline?: string;
  note?: string;
  reserve_decision?: string;
}
export interface ClubActivity {
  id: string;
  kind: ActivityKind;
  title: string;
  organizer_id: string | null;
  details: ActivityDetails;
  status: 'planning' | 'open' | 'closed' | 'completed' | 'cancelled';
  fee_status: 'draft' | 'finalized';
  rounding: number;
  reserve: number;
  cost_note?: string;
  version: number;
  can_manage?: boolean;
  auto_created?: boolean;
  can_regroup?: boolean;
  merged_into_id?: string | null;
  groups?: ActivityGroup[];
  billable?: { group_id: string; member_id: string; included: boolean }[];
  participants?: TripParticipant[];
  expenses?: ActivityExpense[];
  ledger?: LedgerEntry[];
  checklist?: TripChecklist[];
  calculation?: FeeCalculation;
  history?: FinanceHistory[];
  finalizations?: {
    id: string;
    summary: FeeCalculation;
    confirmed_by: string;
    reason: string;
    created_at: string;
  }[];
}
export interface ActivityData {
  version: number;
  revision: number;
  club?: QuickSnapshot;
  automatic_fees?: boolean;
  activities: ClubActivity[];
}
export const TRIP_STATUS = {
  planning: 'Đang lên kế hoạch',
  open: 'Mở đăng ký',
  closed: 'Đã chốt',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
};
export const EXPENSE_CATEGORIES: Record<string, string> = {
  court: 'Tiền sân',
  shuttle: 'Tiền cầu',
  accommodation: 'Homestay / chỗ nghỉ',
  equipment: 'Thuê đồ, dụng cụ ăn uống',
  food: 'Đồ ăn, đồ uống',
  transport: 'Di chuyển',
  tickets: 'Vé & hoạt động',
  other: 'Khoản chi khác',
};
export const CHECK_STATUS = {
  todo: 'Chưa chuẩn bị',
  preparing: 'Đang chuẩn bị',
  done: 'Đã xong',
};
export const LEDGER_KIND = {
  collection: 'Thu trước / thu tiền',
  supplement: 'Thu bổ sung',
  refund: 'Hoàn tiền đóng',
  reimbursement: 'Quỹ hoàn tiền ứng',
};

// Display-only aggregation of server amounts. Allocation and authorization stay in SQL.
export function netPaid(entries: LedgerEntry[], personId: string) {
  return entries
    .filter((e) => !e.voided_at && e.person_id === personId)
    .reduce((n, e) => n + (e.kind === 'refund' ? -e.amount : e.amount), 0);
}
export function paymentStatus(due: number, paid: number) {
  return due === 0 && paid === 0
    ? 'none'
    : paid > due
      ? 'overpaid'
      : paid >= due
        ? 'paid'
        : paid > 0
          ? 'partial'
          : 'unpaid';
}
export const PAYMENT_STATUS = {
  none: 'Không phát sinh',
  unpaid: 'Chưa thanh toán',
  partial: 'Thanh toán một phần',
  paid: 'Đã thanh toán',
  overpaid: 'Thu thừa',
};
