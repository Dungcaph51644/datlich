import type { Account, Member } from './types';

export interface AttendanceIdentity {
  account: Account | null;
  booking?: { verified_member_id: string | null } | null;
  members: Member[];
}

export function verifiedAttendanceMember(identity: AttendanceIdentity) {
  const id =
    identity.booking?.verified_member_id ?? identity.account?.member_id;
  return identity.members.find((m) => m.id === id && m.active) ?? null;
}

export function attendanceWriteRequest(
  args: Record<string, unknown>,
  identity: AttendanceIdentity,
  quickReady: boolean,
  token: string | null,
) {
  if (verifiedAttendanceMember(identity))
    return {
      name: 'set_verified_attendance',
      args: {
        p_session_id: args.p_session_id,
        p_member_id: args.p_member_id,
        p_status: args.p_status,
        p_note: args.p_note,
        p_expected_note_version: args.p_expected_note_version,
        p_token: token,
      },
    };
  return {
    name:
      identity.account?.role === 'admin' || !quickReady
        ? 'set_attendance'
        : 'quick_set_attendance',
    args,
  };
}
