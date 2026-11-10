import React, { useState } from 'react';
import {
  Check,
  ChevronDown,
  Edit3,
  LoaderCircle,
  Search,
  Users,
} from 'lucide-react';
import {
  formatDate,
  registrationArgs,
  summary,
  registrationClosed,
} from './lib';
import { AutoNote } from './AutoNote';
import { CSBadge } from './BookingFeatures';
export { AutoNote } from './AutoNote';
import {
  STATUS_LABELS,
  type AttendanceStatus,
  type BulkResult,
  type CourtSession,
} from './types';
import type { useClub } from './useClub';

type Club = ReturnType<typeof useClub>;
export function MemberPicker({
  club,
  onDone,
}: {
  club: Club;
  onDone: () => void;
}) {
  const [query, setQuery] = useState('');
  return (
    <div className="member-picker">
      <p className="form-intro">
        Chọn tên của bạn một lần. Lần sau thiết bị này sẽ nhớ, không cần email
        hay mật khẩu.
      </p>
      <label className="search">
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm tên hoặc mã thành viên…"
          aria-label="Tìm tên của bạn"
        />
      </label>
      {!club.quickReady && (
        <div className="alert">
          Đăng ký nhanh chưa được bật trên cơ sở dữ liệu. Quản trị viên cần hoàn
          tất cập nhật hệ thống.
        </div>
      )}
      <div className="picker-list">
        {club.members
          .filter(
            (m) =>
              m.active &&
              `${m.display_name} ${m.code}`
                .toLocaleLowerCase('vi')
                .includes(query.toLocaleLowerCase('vi')),
          )
          .map((m) => (
            <button
              key={m.id}
              className={club.memberId === m.id ? 'picked' : ''}
              onClick={() => {
                club.chooseMember(m.id);
                onDone();
              }}
            >
              <span className="avatar">
                {m.display_name.split(' ').at(-1)?.[0]}
              </span>
              <span>
                <strong>{m.display_name}</strong>
                <small>{m.code}</small>
              </span>
              {club.memberId === m.id ? (
                <Check size={19} />
              ) : (
                <span className="pick-label">Đây là tôi</span>
              )}
            </button>
          ))}
      </div>
      {club.quickReady &&
        !club.members.some(
          (m) =>
            m.active &&
            `${m.display_name} ${m.code}`
              .toLocaleLowerCase('vi')
              .includes(query.toLocaleLowerCase('vi')),
        ) && (
          <p className="form-help">
            Không thấy tên phù hợp. Nhờ quản trị viên thêm bạn vào nhóm.
          </p>
        )}
    </div>
  );
}

export function QuickRegistration({
  session,
  club,
  onChoose,
  compact = false,
}: {
  session: CourtSession;
  club: Club;
  onChoose: () => void;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const row = club.attendance.find(
    (a) => a.session_id === session.id && a.member_id === club.memberId,
  );
  const mine = club.me;
  const status = row?.status ?? 'unanswered';
  const closed = registrationClosed(session, club.account?.role === 'admin');
  const eligible =
    !!mine &&
    club.roster.some(
      (r) => r.session_id === session.id && r.member_id === mine.id,
    );
  const disabled = !!closed || !club.online || !eligible;
  return (
    <div className={`quick-registration ${compact ? 'compact' : ''}`}>
      {mine ? (
        <>
          <div className="quick-identity">
            <span>
              <span className="tiny-dot" />
              Đăng ký của <strong>{mine.display_name}</strong>
            </span>
            <button className="text-btn" onClick={onChoose}>
              Đổi tên <Edit3 size={12} />
            </button>
          </div>
          <div
            className="quick-status-buttons"
            aria-label={`Đăng ký ${session.venue} ${session.court}`}
          >
            {(Object.keys(STATUS_LABELS) as AttendanceStatus[]).map((value) => (
              <button
                key={value}
                className={`${value} ${value === status ? 'selected' : ''}`}
                aria-pressed={value === status}
                disabled={
                  disabled || pending || (!club.quickReady && !club.account)
                }
                onClick={async () => {
                  setPending(true);
                  try {
                    await club.saveAttendance(
                      registrationArgs(session.id, mine.id, 'status', value),
                      `${mine.display_name}: ${STATUS_LABELS[value]}`,
                    );
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {value === status && <Check size={15} />} {STATUS_LABELS[value]}
              </button>
            ))}
          </div>
          {pending && (
            <span className="inline-save" role="status">
              <LoaderCircle size={13} className="spin" />
              Đang lưu…
            </span>
          )}
          {closed ? (
            <p className="quick-closed">{closed}</p>
          ) : !eligible ? (
            <p className="form-help">Bạn chưa thuộc danh sách của buổi này.</p>
          ) : compact ? (
            row?.note && <p className="quick-note-preview">{row.note}</p>
          ) : (
            <AutoNote
              key={`${session.id}:${mine.id}`}
              session={session}
              memberId={mine.id}
              row={row}
              club={club}
              disabled={!club.online}
            />
          )}
        </>
      ) : (
        <button
          className="btn btn-lime full"
          disabled={!club.quickReady}
          onClick={onChoose}
        >
          <Users size={17} />
          Chọn tên để đăng ký ngay
        </button>
      )}
      {club.quickReady && (
        <TeamSummary session={session} club={club} compact={compact} />
      )}
    </div>
  );
}

function TeamSummary({
  session,
  club,
  compact,
}: {
  session: CourtSession;
  club: Club;
  compact: boolean;
}) {
  const counts = summary(session, club.roster, club.attendance);
  const roster = club.members.filter((m) =>
    club.roster.some(
      (r) => r.session_id === session.id && r.member_id === m.id,
    ),
  );
  const going = roster.filter((m) =>
    club.attendance.some(
      (a) =>
        a.session_id === session.id &&
        a.member_id === m.id &&
        a.status === 'going',
    ),
  );
  return (
    <details className="team-summary">
      <summary>
        <span>
          <Users size={14} />
          <strong>{counts.going} người đi</strong>
          {session.max_players !== null && (
            <small>
              {' '}
              · Còn {Math.max(0, session.max_players - counts.going)} chỗ
            </small>
          )}
        </span>
        <ChevronDown size={15} />
      </summary>
      {!!going.length && (
        <p className="going-names">
          {going.map((m) => m.display_name).join(' · ')}
        </p>
      )}
      <div className="team-totals">
        Không đi: {counts.no} · Chưa phản hồi: {counts.unanswered}
      </div>
      {(['going', 'unanswered', 'not_going'] as const).map((status) => (
        <div className="team-group" key={status}>
          <strong>{STATUS_LABELS[status]}</strong>
          {roster
            .filter(
              (m) =>
                (club.attendance.find(
                  (a) => a.session_id === session.id && a.member_id === m.id,
                )?.status ?? 'unanswered') === status,
            )
            .map((m) => {
              const a = club.attendance.find(
                (a) => a.session_id === session.id && a.member_id === m.id,
              );
              return (
                <div className="team-person" key={m.id}>
                  <span>
                    {m.display_name}
                    <CSBadge session={session} memberId={m.id} />
                    <small>{m.code}</small>
                  </span>
                  {a?.note && <p>{a.note}</p>}
                </div>
              );
            })}
        </div>
      ))}
      {!compact && (
        <p className="form-help">
          Mở chi tiết buổi đánh để xem thời điểm cập nhật của từng người.
        </p>
      )}
    </details>
  );
}

export function BulkRegistration({
  sessions,
  club,
  onChoose,
}: {
  sessions: CourtSession[];
  club: Club;
  onChoose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<BulkResult[]>([]);
  const eligible = sessions.filter(
    (s) =>
      !registrationClosed(s, club.account?.role === 'admin') &&
      (!club.memberId ||
        club.roster.some(
          (r) => r.session_id === s.id && r.member_id === club.memberId,
        )),
  );
  const valid = selected.filter((id) => eligible.some((s) => s.id === id));
  if (!club.quickReady || eligible.length < 2) return null;
  return (
    <details className="bulk-registration">
      <summary>
        <span>
          <Check size={16} />
          Đăng ký nhiều ca / sân
        </span>
        <ChevronDown size={17} />
      </summary>
      <p className="form-help">
        Chọn các ca muốn đăng ký. Ca hết chỗ sẽ được báo riêng.
      </p>
      {!club.me ? (
        <button className="btn btn-dark" onClick={onChoose}>
          Chọn tên của bạn
        </button>
      ) : (
        <>
          <div className="bulk-options">
            {eligible.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={valid.includes(s.id)}
                  disabled={pending}
                  onChange={(e) => {
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, s.id]
                        : old.filter((id) => id !== s.id),
                    );
                    setResults([]);
                  }}
                />
                <span>
                  <strong>
                    {formatDate(s.session_date)} · {s.start_time.slice(0, 5)}
                  </strong>
                  <small>
                    {s.venue} · {s.court}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="bulk-actions">
            {(['going', 'not_going', 'unanswered'] as const).map((status) => (
              <button
                className={`btn ${status === 'going' ? 'btn-dark' : 'btn-soft'}`}
                key={status}
                disabled={!valid.length || pending || !club.online}
                onClick={async () => {
                  setPending(true);
                  try {
                    const result = await club.saveMany(valid, status);
                    if (result) {
                      setResults(result);
                      setSelected(
                        result.filter((r) => !r.ok).map((r) => r.session_id),
                      );
                    }
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {pending ? <LoaderCircle className="spin" size={14} /> : null}
                {STATUS_LABELS[status]}{' '}
                {valid.length ? `(${valid.length} ca)` : ''}
              </button>
            ))}
          </div>
        </>
      )}
      {!!results.length && (
        <div className="bulk-results" role="status">
          {results.map((result) => {
            const s = sessions.find((s) => s.id === result.session_id);
            return (
              <p
                key={result.session_id}
                className={result.ok ? 'ok' : 'failed'}
              >
                {result.ok ? '✓' : '!'} {s?.session_date} · {s?.court}:{' '}
                {result.ok ? 'Đã lưu' : result.message}
              </p>
            );
          })}
        </div>
      )}
    </details>
  );
}
