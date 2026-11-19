export type ChatScope = 'schedule' | 'booking' | 'finance' | 'travel' | 'guide';
export interface ChatQuestion {
  message: string;
  history: string[];
  memberId: string | null;
  bookingToken: string | null;
  sessionId: string | null;
  activityId: string | null;
}
export interface ChatPlan {
  scope: ChatScope;
  start: string;
  end: string;
  personal: boolean;
  allBalances: boolean;
  sessionId: string | null;
  activityId: string | null;
}
export interface ChatSource {
  id: string;
  label: string;
  href: string;
}
export interface ChatReply {
  answer: string;
  sources: ChatSource[];
  checkedAt: string;
  needsMember?: boolean;
  needsVerification?: boolean;
}
export interface ChatContext {
  version: number;
  checked_at: string;
  scope: ChatScope;
  selected_member: { id: string; name: string; code: string } | null;
  needs_member: boolean;
  finance_authorized: boolean;
  limited: boolean;
  total_matches?: number;
  sessions?: Record<string, unknown>[];
  assignments?: Record<string, unknown>[];
  activities?: Record<string, unknown>[];
  [key: string]: unknown;
}
export class ChatError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
