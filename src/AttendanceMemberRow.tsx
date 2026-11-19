import { Check, Edit3 } from 'lucide-react';
import { CSBadge } from './BookingFeatures';
import { verifiedAttendanceMember } from './attendanceAccess';
import { registrationArgs } from './lib';
import {
  STATUS_LABELS,
  type Attendance,
  type CourtSession,
  type Member,
} from './types';
import type { useClub } from './useClub';

export function AttendanceMemberRow({
  session,
  member,
  row,
  club,
  locked,
  onNote,
}: {
  session: CourtSession;
  member: Member;
  row?: Attendance;
  club: ReturnType<typeof useClub>;
  locked: boolean;
  onNote: (member: Member, row?: Attendance) => void;
}) {
  const status = row?.status ?? 'unanswered';
  const canEdit =
    !locked &&
    member.active &&
    (club.account?.role === 'admin' ||
      club.memberId === member.id ||
      !!verifiedAttendanceMember(club));
  const disabled = !canEdit || !club.online || club.saveState === 'saving';
  return (
    <div className="attendance-row">
      <div className="attendee">
        <span className="avatar">
          {member.display_name.split(' ').at(-1)?.slice(0, 1)}
        </span>
        <div>
          <strong>
            {member.display_name}
            {club.memberId === member.id && <small> (Bạn)</small>}
          </strong>
          <CSBadge session={session} memberId={member.id} />
          <span>
            {member.code}
            {!member.active && ' · Ngừng hoạt động'}
          </span>
        </div>
      </div>
      <div className="status-buttons">
        {Object.entries(STATUS_LABELS).map(([k, v]) => (
          <button
            key={k}
            disabled={disabled}
            className={`${k} ${status === k ? 'selected' : ''}`}
            aria-pressed={status === k}
            onClick={() =>
              void club.saveAttendance(
                registrationArgs(session.id, member.id, 'status', k),
                `Đã cập nhật: ${v}`,
              )
            }
          >
            {status === k && <Check size={13} />}
            {k === 'unanswered' ? 'Chưa phản hồi' : v}
          </button>
        ))}
      </div>
      <div className="attendance-note">
        <button
          className={row?.note ? 'note-content' : 'note-placeholder'}
          disabled={disabled}
          onClick={() => onNote(member, row)}
        >
          {row?.note || (canEdit ? '+ Thêm ghi chú' : 'Chưa có ghi chú')}
          {canEdit && <Edit3 size={13} />}
        </button>
        <time>
          {row
            ? new Date(row.updated_at).toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Chưa cập nhật'}
        </time>
      </div>
    </div>
  );
}
