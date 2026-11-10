import React, { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  CalendarDays,
  Check,
  Copy,
  Edit3,
  History,
  Info,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  addDays,
  dateKey,
  formatDate,
  message,
  monday,
  rpc,
  vietnamToday,
} from './lib';
import { Modal } from './Modal';
import {
  bookingTime,
  bookingWeekEnd,
  currency,
  memberName,
  weekLabel,
} from './bookingUtils';
import {
  SWAP_LABELS,
  type BookingAssignment,
  type BookingHistory,
  type BookingProposal,
  type BookingRotation,
  type BookingSwap,
} from './bookingTypes';
import type { CourtSession, Member } from './types';
import { BOOKING_LABELS } from './types';
import type { useClub } from './useClub';

type Club = ReturnType<typeof useClub>;
export function BookingWriteState({ club }: { club: Club }) {
  if (!club.online)
    return (
      <p className="form-error" role="alert">
        Đang mất mạng. Thao tác chưa được lưu.
      </p>
    );
  if (club.saveState === 'failed' && club.notice)
    return (
      <p className="form-error" role="alert">
        {club.notice}
      </p>
    );
  if (club.saveState === 'saving')
    return (
      <p className="form-help inline" role="status">
        <LoaderCircle className="spin" size={13} />
        Đang lưu, chờ máy chủ xác nhận…
      </p>
    );
  return null;
}
type Action =
  | { type: 'verify' | 'proposal' | 'seed' }
  | { type: 'assignment'; row?: BookingAssignment }
  | { type: 'request' | 'admin-swap'; row: BookingAssignment }
  | { type: 'rotation' | 'code'; member: Member };

export function CSBadge({
  session,
  memberId,
}: {
  session: CourtSession;
  memberId: string;
}) {
  if (!session.organizer_mode || session.organizer_id !== memberId) return null;
  return (
    <span className="cs-badge">
      <BadgeCheck size={12} />
      CS · Phụ trách đặt sân
    </span>
  );
}

export function SessionResponsibility({
  session: s,
  compact = false,
}: {
  session: CourtSession;
  compact?: boolean;
}) {
  return (
    <div className={`session-responsibility ${compact ? 'compact' : ''}`}>
      <p>
        <BadgeCheck size={14} />
        <span>
          Phụ trách buổi <strong>{s.organizer_name || 'Chưa phân công'}</strong>
        </span>
        {s.organizer_mode && (
          <small
            className={s.organizer_mode === 'override' ? 'individual' : ''}
          >
            {s.organizer_mode === 'override' ? 'Chỉ định riêng' : 'Theo tuần'}
          </small>
        )}
      </p>
      {s.booked_by_member_id && (
        <p className="actual-booker">
          <Check size={13} />
          <span>
            {s.booking_status !== 'booked'
              ? 'Lần đặt đã ghi nhận: '
              : s.booked_at
                ? 'Đã đặt thực tế: '
                : 'Người đặt theo dữ liệu cũ: '}
            <strong>{s.booked_by_name || 'Đã ghi nhận'}</strong>
            {!compact && s.booked_at && (
              <small> · {bookingTime(s.booked_at)}</small>
            )}
          </span>
        </p>
      )}
      {s.estimated_cost != null && (
        <p>
          <span>
            Tiền sân dự kiến: <strong>{currency(s.estimated_cost)}</strong>
          </span>
        </p>
      )}
      {!compact && (s.booking_contact_note || s.deposit_note) && (
        <div className="booking-contact-notes">
          {s.booking_contact_note && (
            <p>
              <strong>Liên hệ:</strong> {s.booking_contact_note}
            </p>
          )}
          {s.deposit_note && (
            <p>
              <strong>Đặt cọc:</strong> {s.deposit_note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ActionModal({
  action,
  club,
  close,
}: {
  action: Action | null;
  club: Club;
  close: () => void;
}) {
  if (!action) return null;
  const titles = {
    verify: 'Xác minh quyền đặt sân',
    proposal: 'Đề xuất lịch phân công',
    seed: 'Liên kết lịch đã thống nhất',
    assignment:
      action.type === 'assignment' && action.row
        ? 'Chỉnh sửa phân công'
        : 'Phân công / nhập lịch sử',
    request: 'Đề nghị đổi lượt',
    'admin-swap': 'Đổi trực tiếp hai tuần',
    rotation: 'Vòng phân công và lịch sử ban đầu',
    code: 'Cấp mã xác minh cá nhân',
  };
  return (
    <Modal
      title={titles[action.type]}
      wide={action.type === 'proposal'}
      locked={club.saveState === 'saving'}
      onClose={close}
    >
      {action.type === 'verify' && (
        <BookingIdentityForm club={club} close={close} />
      )}
      {action.type === 'assignment' && (
        <AssignmentForm club={club} row={action.row} close={close} />
      )}
      {(action.type === 'request' || action.type === 'admin-swap') && (
        <SwapForm
          club={club}
          row={action.row}
          direct={action.type === 'admin-swap'}
          close={close}
        />
      )}
      {action.type === 'rotation' && (
        <RotationForm club={club} member={action.member} close={close} />
      )}
      {action.type === 'code' && (
        <CodeForm club={club} member={action.member} />
      )}
      {action.type === 'proposal' && <ProposalForm club={club} close={close} />}
      {action.type === 'seed' && <SeedForm club={club} close={close} />}
      <BookingWriteState club={club} />
    </Modal>
  );
}

function VerificationBar({
  club,
  onVerify,
}: {
  club: Club;
  onVerify: () => void;
}) {
  const data = club.booking;
  if (!data) return null;
  const verified = memberName(club.members, data.verified_member_id);
  return (
    <div
      className={`booking-verification ${data.verified_member_id ? 'verified' : ''}`}
    >
      {!data.realtime_enabled && (
        <p className="booking-realtime-missing" role="alert">
          Đồng bộ trực tiếp cho phân công chưa bật. Quản trị viên cần chạy đầy
          đủ phần Realtime của bản cập nhật CS.
        </p>
      )}
      {data.verified_member_id ? (
        <>
          <BadgeCheck size={20} />
          <div>
            <strong>Đã xác minh: {verified}</strong>
            <p>
              Quyền đặt sân dùng danh tính này, độc lập với tên chọn để đăng ký
              đánh cầu.
            </p>
          </div>
          {data.identity_source === 'code' && (
            <button
              className="text-btn"
              disabled={!club.online || club.saveState === 'saving'}
              onClick={() => void club.leaveBookingIdentity()}
            >
              Đăng xuất quyền này
            </button>
          )}
        </>
      ) : (
        <>
          <KeyRound size={20} />
          <div>
            <strong>
              {data.identity_expired
                ? 'Phiên xác minh đã hết hạn hoặc bị thu hồi'
                : 'Xác minh một lần, dùng cho các lần sau'}
            </strong>
            <p>
              Nhập mã cá nhân do quản trị viên cấp để đổi lượt và cập nhật sân.
              Không cần email.
            </p>
          </div>
          <button
            className="btn btn-dark"
            disabled={!club.online}
            onClick={onVerify}
          >
            Nhập mã <ArrowRight size={15} />
          </button>
        </>
      )}
    </div>
  );
}

export function BookingHome({
  club,
  onManage,
}: {
  club: Club;
  onManage: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const current = dateKey(monday()),
    next = dateKey(monday(1));
  const data = club.booking;
  const incoming =
    data?.requests.filter(
      (r) =>
        r.status === 'pending' && r.to_member_id === data.verified_member_id,
    ) ?? [];
  return (
    <section
      className="booking-home"
      aria-label="Người phụ trách đặt sân theo tuần"
    >
      <div className="booking-home-heading">
        <span className="section-kicker">
          <BadgeCheck size={14} /> CÓ NGƯỜI LO SÂN, CẢ NHÓM YÊN TÂM
        </span>
        <button className="text-btn" onClick={onManage}>
          Lịch phân công <ArrowRight size={15} />
        </button>
      </div>
      {club.bookingError && (
        <p className="form-error" role="alert">
          Không tải được phân công mới nhất: {club.bookingError}
        </p>
      )}
      <div className="booking-week-pair">
        {[current, next].map((start, i) => {
          const row = data?.assignments.find((a) => a.week_start === start);
          const mine = row && row.member_id === data?.verified_member_id;
          return (
            <article
              className={`booking-week-summary ${i ? '' : 'current'}`}
              key={start}
            >
              <div className="booking-week-icon">
                <CalendarDays size={22} />
              </div>
              <div>
                <span>Phụ trách {i ? 'tuần sau' : 'tuần này'}</span>
                <h3>
                  {row
                    ? memberName(club.members, row.member_id)
                    : club.loading
                      ? 'Đang tải…'
                      : data
                        ? 'Chưa phân công'
                        : 'Chưa bật phân công tuần'}
                </h3>
                <small>{weekLabel(start)}</small>
              </div>
              {mine && !row.pending_swap_count && (
                <button
                  className="btn btn-soft"
                  disabled={!club.online || club.saveState === 'saving'}
                  onClick={() => setAction({ type: 'request', row })}
                >
                  <ArrowLeftRight size={14} />
                  Đề nghị đổi lượt
                </button>
              )}
              {mine && !!row.pending_swap_count && (
                <span className="swap-status pending">
                  Có yêu cầu chờ phản hồi
                </span>
              )}
            </article>
          );
        })}
      </div>
      {!data && !club.loading && (
        <p className="form-help">
          Chức năng phân công tuần cần được cập nhật trong cơ sở dữ liệu. Lịch
          đánh và đăng ký hiện có vẫn dùng bình thường.
        </p>
      )}
      {data && (
        <VerificationBar
          club={club}
          onVerify={() => setAction({ type: 'verify' })}
        />
      )}
      {!!incoming.length && (
        <div className="booking-incoming">
          <h3>
            <Bell size={17} />
            Bạn có {incoming.length} đề nghị đổi lượt cần phản hồi
          </h3>
          {incoming.map((r) => (
            <RequestCard key={r.id} request={r} club={club} />
          ))}
        </div>
      )}
      <ActionModal action={action} club={club} close={() => setAction(null)} />
    </section>
  );
}

function RequestCard({
  request: r,
  club,
}: {
  request: BookingSwap;
  club: Club;
}) {
  const mid = club.booking?.verified_member_id;
  const busy = !club.online || club.saveState === 'saving';
  async function respond(decision: 'accept' | 'reject') {
    let result = '';
    const ok = await club.run(
      async () => {
        result = await club.bookingRpc<string>('respond_booking_swap', {
          p_request_id: r.id,
          p_decision: decision,
        });
      },
      decision === 'accept'
        ? 'Đã đồng ý; hai tuần đã đổi người đồng thời'
        : 'Đã từ chối; phân công được giữ nguyên',
    );
    if (ok && result === 'invalid')
      club.setNotice(
        'Yêu cầu không còn hiệu lực vì lịch đã thay đổi. Hai tuần chưa được đổi.',
      );
  }
  return (
    <article className="booking-request-card">
      <div className="booking-request-top">
        <strong>
          {memberName(club.members, r.from_member_id)}{' '}
          <ArrowLeftRight size={14} />{' '}
          {memberName(club.members, r.to_member_id)}
        </strong>
        <span className={`swap-status ${r.status}`}>
          {SWAP_LABELS[r.status]}
        </span>
      </div>
      <div className="swap-weeks">
        <span>{weekLabel(r.from_week_start, r.from_week_end)}</span>
        <ArrowLeftRight size={14} />
        <span>{weekLabel(r.to_week_start, r.to_week_end)}</span>
      </div>
      {r.reason && <p className="swap-reason">{r.reason}</p>}
      {r.resolution_reason && (
        <p className="swap-reason resolution">{r.resolution_reason}</p>
      )}
      <div className="booking-request-footer">
        <small>
          Gửi {bookingTime(r.created_at)}
          {r.responded_at && ` · Xử lý ${bookingTime(r.responded_at)}`}
        </small>
        {r.status === 'pending' && mid === r.to_member_id && (
          <div className="booking-inline-actions">
            <button
              className="btn btn-outline"
              disabled={busy}
              onClick={() => void respond('reject')}
            >
              <X size={14} />
              Từ chối
            </button>
            <button
              className="btn btn-dark"
              disabled={busy}
              onClick={() => void respond('accept')}
            >
              <Check size={14} />
              Đồng ý đổi lượt
            </button>
          </div>
        )}
        {r.status === 'pending' && mid === r.from_member_id && (
          <button
            className="text-btn"
            disabled={busy}
            onClick={() =>
              void club.run(
                () =>
                  club.bookingRpc('cancel_booking_swap', {
                    p_request_id: r.id,
                  }),
                'Đã hủy yêu cầu; phân công được giữ nguyên',
              )
            }
          >
            Hủy yêu cầu
          </button>
        )}
      </div>
    </article>
  );
}

export function BookingPage({ club }: { club: Club }) {
  const [tab, setTab] = useState<
    'schedule' | 'requests' | 'history' | 'rotation'
  >('schedule');
  const [action, setAction] = useState<Action | null>(null);
  const [past, setPast] = useState(false);
  const data = club.booking;
  const admin = club.account?.role === 'admin';
  const today = dateKey(vietnamToday());
  const busy = !club.online || club.saveState === 'saving';
  const unread = data?.notifications.filter((n) => !n.read_at) ?? [];
  const tabs = [
    { value: 'schedule', label: 'Lịch phân công', Icon: CalendarDays },
    { value: 'requests', label: 'Đổi lượt', Icon: ArrowLeftRight },
    { value: 'history', label: 'Lịch sử', Icon: History },
    { value: 'rotation', label: 'Vòng phân công', Icon: Users },
  ] as const;
  if (!data)
    return (
      <section className="management booking-page">
        <div className="section-heading">
          <div>
            <span className="section-kicker">CS · PHỤ TRÁCH ĐẶT SÂN</span>
            <h1>Lịch phân công</h1>
          </div>
        </div>
        <div className="empty-state">
          <BadgeCheck size={35} />
          <h3>
            {club.loading
              ? 'Đang tải phân công…'
              : 'Cần bật chức năng phân công tuần'}
          </h3>
          <p>
            {club.bookingError ||
              'Quản trị viên cần chạy bản cập nhật cơ sở dữ liệu cho phân công và đổi lượt. Chức năng này chưa được đồng bộ cho đến khi hoàn tất thiết lập.'}
          </p>
          <button className="btn btn-soft" onClick={() => void club.reload()}>
            Kiểm tra lại
          </button>
        </div>
      </section>
    );
  return (
    <section className="management booking-page">
      <div className="section-heading">
        <div>
          <span className="section-kicker">
            PHÂN CÔNG RÕ RÀNG, LÊN SÂN THẢNH THƠI
          </span>
          <h1>
            Người lo sân <span className="count-chip">CS · Theo tuần</span>
          </h1>
        </div>
        {admin && (
          <div className="heading-actions">
            <button
              className="btn btn-soft"
              disabled={busy}
              onClick={() => setAction({ type: 'proposal' })}
            >
              <Users size={16} />
              Đề xuất lịch phân công
            </button>
            <button
              className="btn btn-dark"
              disabled={busy}
              onClick={() => setAction({ type: 'assignment' })}
            >
              <Plus size={17} />
              Phân công / nhập lịch sử
            </button>
          </div>
        )}
      </div>
      {club.bookingError && (
        <p className="form-error" role="alert">
          {club.bookingError}
        </p>
      )}
      {!data.initialized && (
        <div className="alert">
          <Info size={19} />
          <div>
            <strong>Cần xác nhận thành viên cho lịch đã thống nhất</strong>
            <span>
              {data.setup_issues
                .map(
                  (i) =>
                    `${i.name}: ${i.kind === 'missing' ? 'không tìm thấy' : 'trùng tên hoặc ánh xạ trùng'}`,
                )
                .join(' · ') || 'Dữ liệu khởi tạo chưa hoàn tất.'}
            </span>
          </div>
          {admin && (
            <button
              className="btn btn-soft"
              onClick={() => setAction({ type: 'seed' })}
            >
              Liên kết đúng thành viên
            </button>
          )}
        </div>
      )}
      <VerificationBar
        club={club}
        onVerify={() => setAction({ type: 'verify' })}
      />
      {!!unread.length && (
        <details className="booking-notifications" open>
          <summary>
            <Bell size={17} />
            <strong>{unread.length} thông báo chưa đọc</strong>
          </summary>
          {unread.map((n) => (
            <div className="booking-notification" key={n.id}>
              <div>
                <p>{n.message}</p>
                <small>{bookingTime(n.created_at)}</small>
              </div>
              <button
                className="text-btn"
                disabled={busy}
                onClick={() =>
                  void club.run(
                    () =>
                      club.bookingRpc('mark_booking_notifications', {
                        p_ids: [n.id],
                      }),
                    'Đã đánh dấu thông báo',
                  )
                }
              >
                Đã đọc <Check size={13} />
              </button>
            </div>
          ))}
        </details>
      )}
      <div
        className="booking-tabs"
        role="tablist"
        aria-label="Thông tin phụ trách đặt sân"
      >
        {tabs
          .filter((t) => admin || t.value !== 'rotation')
          .map(({ value, label, Icon }) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'selected' : ''}
              onClick={() => setTab(value)}
            >
              <Icon size={15} />
              {label}
              {value === 'requests' &&
                !!data.requests.filter((r) => r.status === 'pending')
                  .length && (
                  <small>
                    {data.requests.filter((r) => r.status === 'pending').length}
                  </small>
                )}
            </button>
          ))}
      </div>
      {tab === 'schedule' && (
        <div className="booking-tab-panel" role="tabpanel">
          <div className="booking-list-toolbar">
            <p>
              Mỗi tuần tính một lượt khi xác nhận hoàn thành. Chỉ định riêng
              theo buổi được ghi lịch sử riêng.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={past}
                onChange={(e) => setPast(e.target.checked)}
              />
              Hiện các tuần đã kết thúc
            </label>
          </div>
          <div className="booking-assignment-list">
            {data.assignments
              .filter((a) => past || a.week_end >= today)
              .map((row) => {
                const sessions = club.sessions.filter(
                  (s) =>
                    s.session_date >= row.week_start &&
                    s.session_date <= row.week_end,
                );
                const mine = data.verified_member_id === row.member_id;
                const active = club.members.find(
                  (m) => m.id === row.member_id,
                )?.active;
                return (
                  <article
                    className={`booking-assignment ${mine ? 'mine' : ''}`}
                    key={row.id}
                  >
                    <div className="booking-assignment-heading">
                      <div>
                        <span className="assignment-week">
                          {weekLabel(row.week_start, row.week_end)}
                        </span>
                        <h3>
                          <span className="avatar">
                            {
                              memberName(club.members, row.member_id)
                                .split(' ')
                                .at(-1)?.[0]
                            }
                          </span>
                          {memberName(club.members, row.member_id)}
                          {mine && <small>Bạn phụ trách</small>}
                        </h3>
                        <p>
                          Ban đầu:{' '}
                          {memberName(club.members, row.original_member_id)}
                          {!active && (
                            <strong className="inactive-text">
                              {' '}
                              · Đã ngừng hoạt động, cần quản trị viên xử lý
                            </strong>
                          )}
                        </p>
                      </div>
                      <div className="assignment-actions">
                        {row.week_end >= today &&
                          mine &&
                          !row.pending_swap_count && (
                            <button
                              className="btn btn-soft"
                              disabled={busy}
                              onClick={() =>
                                setAction({ type: 'request', row })
                              }
                            >
                              <ArrowLeftRight size={14} />
                              Đề nghị đổi lượt
                            </button>
                          )}
                        {admin && (
                          <button
                            className="icon-btn"
                            aria-label={`Sửa phân công tuần ${row.week_start}`}
                            onClick={() =>
                              setAction({ type: 'assignment', row })
                            }
                          >
                            <Edit3 size={17} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="assignment-sessions">
                      {sessions.length ? (
                        sessions.map((s) => (
                          <div key={s.id}>
                            <span>
                              {formatDate(s.session_date)} ·{' '}
                              {s.start_time.slice(0, 5)} · {s.venue} / {s.court}
                            </span>
                            <span className={`badge ${s.booking_status}`}>
                              {BOOKING_LABELS[s.booking_status]}
                            </span>
                            {s.organizer_mode === 'override' && (
                              <small>Riêng buổi: {s.organizer_name}</small>
                            )}
                            {s.booked_by_member_id && (
                              <small>Đã đặt: {s.booked_by_name}</small>
                            )}
                          </div>
                        ))
                      ) : (
                        <p>
                          Chưa có buổi đánh. Phân công không đồng nghĩa đã đặt
                          sân.
                        </p>
                      )}
                    </div>
                    <div className="assignment-bottom">
                      <span>
                        {row.completed_member_id ? (
                          <>
                            <Check size={14} />
                            Đã hoàn thành · Tính 1 lượt cho{' '}
                            {memberName(club.members, row.completed_member_id)}
                          </>
                        ) : row.week_end < today ? (
                          'Chưa xác nhận hoàn thành'
                        ) : (
                          `${sessions.filter((s) => s.booking_status === 'booked').length}/${sessions.length} buổi đã đặt`
                        )}
                      </span>
                      {!!row.pending_swap_count && (
                        <button
                          className="text-btn"
                          onClick={() => setTab('requests')}
                        >
                          Có yêu cầu chờ phản hồi <ArrowRight size={13} />
                        </button>
                      )}
                      {row.week_end < today &&
                        !row.completed_member_id &&
                        (mine || admin) && (
                          <button
                            className="text-btn"
                            disabled={busy}
                            onClick={() =>
                              void club.run(
                                () =>
                                  club.bookingRpc('complete_booking_week', {
                                    p_assignment_id: row.id,
                                    p_expected_version: row.version,
                                  }),
                                'Đã ghi nhận hoàn thành một lượt cho tuần',
                              )
                            }
                          >
                            Xác nhận hoàn thành <Check size={14} />
                          </button>
                        )}
                      {admin && row.week_end >= today && (
                        <button
                          className="text-btn"
                          disabled={busy}
                          onClick={() => setAction({ type: 'admin-swap', row })}
                        >
                          Đổi trực tiếp <ShieldCheck size={13} />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
          </div>
          {!data.assignments.some((a) => past || a.week_end >= today) && (
            <div className="empty-state">
              <CalendarDays size={28} />
              <h3>Chưa có phân công cho các tuần tới</h3>
              <p>
                {admin
                  ? 'Thêm phân công hoặc xem và áp dụng bản đề xuất.'
                  : 'Nhờ quản trị viên lên lịch phụ trách cho nhóm.'}
              </p>
            </div>
          )}
        </div>
      )}
      {tab === 'requests' && (
        <div className="booking-tab-panel" role="tabpanel">
          {!data.verified_member_id ? (
            <div className="empty-state">
              <KeyRound size={28} />
              <h3>Xác minh để xem yêu cầu của bạn</h3>
              <button
                className="btn btn-dark"
                onClick={() => setAction({ type: 'verify' })}
              >
                Nhập mã cá nhân
              </button>
            </div>
          ) : data.requests.length ? (
            <div className="booking-request-list">
              {data.requests.map((r) => (
                <RequestCard key={r.id} request={r} club={club} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <ArrowLeftRight size={28} />
              <h3>Chưa có yêu cầu đổi lượt</h3>
              <p>
                Trao đổi với người phụ trách tuần kế tiếp, rồi gửi yêu cầu từ
                tuần của bạn.
              </p>
            </div>
          )}
        </div>
      )}
      {tab === 'history' && (
        <div className="booking-tab-panel" role="tabpanel">
          {!data.verified_member_id ? (
            <div className="empty-state">
              <History size={28} />
              <h3>Xác minh để xem lịch sử đặt sân</h3>
              <button
                className="btn btn-dark"
                onClick={() => setAction({ type: 'verify' })}
              >
                Nhập mã cá nhân
              </button>
            </div>
          ) : (
            <BookingHistoryList club={club} />
          )}
        </div>
      )}
      {tab === 'rotation' && admin && (
        <div className="booking-tab-panel" role="tabpanel">
          <div className="booking-list-toolbar">
            <p>
              Chỉ người còn hoạt động và được bật trong vòng mới được đề xuất.
              Thay đổi ở đây không tự sửa các tuần đã chốt.
            </p>
          </div>
          <div className="rotation-grid">
            {club.members.map((member) => {
              const r = data.rotation.find((x) => x.member_id === member.id);
              const creds = data.credential_status.find(
                (x) => x.member_id === member.id,
              );
              return (
                <article className="rotation-card" key={member.id}>
                  <div className="rotation-card-top">
                    <div>
                      <h3>{member.display_name}</h3>
                      <small>
                        {member.code} ·{' '}
                        {member.active ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                      </small>
                    </div>
                    <label className="rotation-toggle">
                      <input
                        type="checkbox"
                        aria-label={`Đủ điều kiện: ${member.display_name}`}
                        checked={r?.eligible ?? false}
                        disabled={busy || !member.active}
                        onChange={(e) =>
                          void club.run(
                            () =>
                              rpc('save_booking_rotation', {
                                p_member_id: member.id,
                                p_patch: {
                                  eligible: e.target.checked,
                                  ...(!r
                                    ? {
                                        sort_order:
                                          100 + club.members.indexOf(member),
                                      }
                                    : {}),
                                },
                                p_expected_version: r?.version ?? null,
                              }),
                            'Đã cập nhật vòng phân công; giữ nguyên lịch đã chốt',
                          )
                        }
                      />
                      <span />
                    </label>
                  </div>
                  <p
                    className={`rotation-history-state ${r?.history_status === 'confirmed' ? '' : 'unknown'}`}
                  >
                    {r?.history_status === 'confirmed'
                      ? r.completed_count === 0
                        ? 'Đã xác nhận chưa từng phụ trách'
                        : `${r.completed_count} lượt hoàn thành đã ghi nhận`
                      : 'Chưa có lịch sử ghi nhận'}
                  </p>
                  <p>
                    {r
                      ? `Thứ tự cố định: ${r.sort_order} · Đã xếp sắp tới: ${r.planned_count} tuần`
                      : 'Chưa nằm trong vòng phân công'}
                  </p>
                  <p>
                    {creds?.devices
                      ? `${creds.devices} thiết bị đã xác minh`
                      : 'Chưa có thiết bị đã xác minh'}
                    {creds?.invite_pending && ' · Có mã chờ sử dụng'}
                  </p>
                  <div className="rotation-card-actions">
                    <button
                      className="text-btn"
                      onClick={() => setAction({ type: 'rotation', member })}
                    >
                      <Edit3 size={14} />
                      Lịch sử & điều kiện
                    </button>
                    <button
                      className="text-btn"
                      disabled={busy || !member.active}
                      onClick={() => setAction({ type: 'code', member })}
                    >
                      <KeyRound size={14} />
                      Cấp mã cá nhân
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
      <ActionModal action={action} club={club} close={() => setAction(null)} />
    </section>
  );
}

export function BookingIdentityForm({
  club,
  close,
}: {
  club: Club;
  close: () => void;
}) {
  const [code, setCode] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await club.verifyBookingIdentity(code.trim())) close();
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="booking-login-art">
        <KeyRound size={32} />
        <strong>Một mã riêng cho đúng người.</strong>
      </div>
      <p className="form-intro">
        Nhờ quản trị viên gửi riêng mã cá nhân cho bạn. Mã dùng một lần; sau khi
        xác minh, thiết bị sẽ nhớ quyền đặt sân. Việc đổi tên đăng ký đánh cầu
        không thay đổi quyền này.
      </p>
      <label className="field">
        Mã xác minh cá nhân
        <input
          aria-label="Mã xác minh cá nhân"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          placeholder="Dán mã do quản trị viên cấp"
        />
      </label>
      <button
        className="btn btn-dark full"
        disabled={!club.online || club.saveState === 'saving' || !code.trim()}
      >
        {club.saveState === 'saving' ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <BadgeCheck size={16} />
        )}
        Xác minh và ghi nhớ thiết bị
      </button>
    </form>
  );
}

function SwapForm({
  club,
  row,
  direct,
  close,
}: {
  club: Club;
  row: BookingAssignment;
  direct: boolean;
  close: () => void;
}) {
  const next = club.booking?.assignments.find(
    (a) =>
      a.week_start ===
      dateKey(addDays(new Date(`${row.week_start}T12:00:00`), 7)),
  );
  const [reason, setReason] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!next) return;
    const ok = await club.run(
      () =>
        direct
          ? rpc('admin_swap_booking_weeks', {
              p_assignment_id: row.id,
              p_reason: reason.trim(),
              p_expected_version: row.version,
              p_next_version: next.version,
            })
          : club.bookingRpc('request_booking_swap', {
              p_assignment_id: row.id,
              p_reason: reason.trim(),
              p_expected_version: row.version,
              p_next_version: next.version,
            }),
      direct
        ? 'Đã đổi trực tiếp hai tuần và lưu lý do'
        : 'Đã gửi yêu cầu; phân công chỉ đổi sau khi người nhận đồng ý',
    );
    if (ok) close();
  }
  if (!next)
    return (
      <div className="empty-state">
        <Info size={28} />
        <h3>Tuần kế tiếp chưa có người phụ trách</h3>
        <p>
          Hãy liên hệ quản trị viên phân công tuần kế tiếp trước khi gửi yêu cầu
          đổi lượt.
        </p>
      </div>
    );
  if (row.member_id === next.member_id)
    return (
      <div className="empty-state">
        <Info size={28} />
        <h3>Hai tuần cùng một người phụ trách</h3>
        <p>
          Không thể đổi với chính mình. Nhờ quản trị viên điều chỉnh phân công
          nếu cần.
        </p>
      </div>
    );
  return (
    <form onSubmit={(e) => void submit(e)}>
      <p className="form-intro">
        {direct
          ? 'Bạn đang đổi trực tiếp bằng quyền quản trị. Các yêu cầu đang chờ liên quan sẽ không còn hiệu lực; người được đổi sẽ nhận thông báo.'
          : 'Hãy trao đổi trước với người phụ trách tuần kế tiếp. Người phụ trách hiện tại vẫn chịu trách nhiệm cho đến khi họ đồng ý trên website.'}
      </p>
      <div className="swap-preview">
        {[row, next].map((r, i) => (
          <div key={r.id}>
            <small>{weekLabel(r.week_start, r.week_end)}</small>
            <strong>{memberName(club.members, r.member_id)}</strong>
            <ArrowRight size={16} />
            <span>
              Sau khi {direct ? 'đổi' : 'đồng ý'}:{' '}
              <b>
                {memberName(club.members, i ? row.member_id : next.member_id)}
              </b>
            </span>
          </div>
        ))}
      </div>
      <label className="field">
        Lý do {direct ? '(bắt buộc)' : '(tùy chọn)'}
        <textarea
          required={direct}
          maxLength={1000}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ví dụ: Tuần đó đi công tác, đã trao đổi với nhau…"
        />
      </label>
      <div className="form-actions">
        <button
          className="btn btn-dark"
          disabled={!club.online || club.saveState === 'saving'}
        >
          <ArrowLeftRight size={16} />
          {club.saveState === 'saving'
            ? 'Đang lưu…'
            : direct
              ? 'Đổi trực tiếp và lưu lịch sử'
              : 'Gửi đề nghị đổi lượt'}
        </button>
      </div>
    </form>
  );
}

function AssignmentForm({
  club,
  row,
  close,
}: {
  club: Club;
  row?: BookingAssignment;
  close: () => void;
}) {
  const [week, setWeek] = useState(row?.week_start ?? dateKey(monday()));
  const [person, setPerson] = useState(row?.member_id ?? '');
  const [completed, setCompleted] = useState(!!row?.completed_member_id);
  const [reason, setReason] = useState('');
  const past = week && bookingWeekEnd(week) < dateKey(vietnamToday());
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      await club.run(
        () =>
          rpc('save_booking_assignment', {
            p_week_start: week,
            p_member_id: person,
            p_expected_version: row?.version ?? null,
            p_reason: reason.trim(),
            p_completed: completed,
          }),
        'Đã lưu phân công và lịch sử thay đổi',
      )
    )
      close();
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <p className="form-intro">
        Tuần tính từ thứ Hai đến Chủ nhật theo giờ Việt Nam. Có thể chọn tuần
        trong quá khứ để nhập lịch sử. Chỉ tính hoàn thành khi đã xác nhận,
        không tự suy ra từ số buổi hoặc trạng thái tham gia.
      </p>
      <label className="field">
        Ngày bắt đầu tuần (thứ Hai)
        <input
          name="week_start"
          type="date"
          required
          value={week}
          readOnly={!!row}
          onChange={(e) => {
            setWeek(e.target.value);
            setCompleted(false);
          }}
        />
      </label>
      {week && (
        <p className="booking-period">Thứ Hai – Chủ nhật: {weekLabel(week)}</p>
      )}
      <label className="field">
        Người phụ trách
        <select
          required
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        >
          <option value="">Chọn thành viên</option>
          {club.members
            .filter((m) => m.active || past || m.id === row?.member_id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name} · {m.code}
                {!m.active ? ' · Ngừng hoạt động' : ''}
              </option>
            ))}
        </select>
      </label>
      {row && (
        <p className="form-help">
          Người được phân công ban đầu:{' '}
          {memberName(club.members, row.original_member_id)}. Thông tin này được
          giữ trong lịch sử.
        </p>
      )}
      <label className="check-label booking-completion-check">
        <input
          type="checkbox"
          checked={completed}
          disabled={!past}
          onChange={(e) => setCompleted(e.target.checked)}
        />
        Đã xác nhận hoàn thành trách nhiệm tuần này (tính một lượt)
      </label>
      {!past && (
        <p className="form-help">
          Chỉ xác nhận hoàn thành sau Chủ nhật cuối tuần.
        </p>
      )}
      {row?.completed_member_id && (
        <p className="form-help">
          Lượt đã hoàn thành ghi cho{' '}
          {memberName(club.members, row.completed_member_id)}. Đổi người phụ
          trách không tự viết lại người đã hoàn thành.
        </p>
      )}
      <label className="field">
        Lý do / nguồn lịch sử
        <textarea
          rows={3}
          required
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ví dụ: Theo lịch nhóm đã chốt, nhập lại từ bảng cũ…"
        />
      </label>
      <div className="form-actions">
        <button
          className="btn btn-dark"
          disabled={!club.online || club.saveState === 'saving'}
        >
          <Check size={16} />
          {club.saveState === 'saving' ? 'Đang lưu…' : 'Lưu phân công'}
        </button>
      </div>
    </form>
  );
}

function RotationForm({
  club,
  member,
  close,
}: {
  club: Club;
  member: Member;
  close: () => void;
}) {
  const r = club.booking?.rotation.find((x) => x.member_id === member.id);
  const [status, setStatus] = useState(r?.history_status ?? 'unknown');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values = {
      eligible: fd.get('eligible') === 'on',
      sort_order: Number(fd.get('sort_order')),
      history_status: status,
      initial_completed_count:
        status === 'confirmed' ? Number(fd.get('initial_completed_count')) : 0,
      baseline_through: String(fd.get('baseline_through')),
      initial_last_week:
        status === 'confirmed' && fd.get('initial_last_week')
          ? String(fd.get('initial_last_week'))
          : null,
    };
    if (
      await club.run(
        () =>
          rpc('save_booking_rotation', {
            p_member_id: member.id,
            p_patch: values,
            p_expected_version: r?.version ?? null,
          }),
        'Đã lưu điều kiện và lịch sử ban đầu; lịch đã chốt được giữ nguyên',
      )
    )
      close();
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <p className="form-intro">
        <strong>
          {member.display_name} · {member.code}
        </strong>
        <br />
        Lịch sử chưa rõ không được coi là 0 lượt. Xác nhận số lượt thực tế trước
        khi dùng đề xuất tự động.
      </p>
      <label className="check-label booking-completion-check">
        <input
          name="eligible"
          type="checkbox"
          defaultChecked={r?.eligible ?? false}
        />
        Đưa vào vòng phân công (chỉ khi còn hoạt động)
      </label>
      <label className="field">
        Thứ tự cố định khi hòa điểm
        <input
          name="sort_order"
          type="number"
          min={1}
          max={10000}
          required
          defaultValue={r?.sort_order ?? 100 + club.members.indexOf(member)}
        />
      </label>
      <label className="field">
        Tình trạng lịch sử
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="unknown">Chưa có lịch sử ghi nhận</option>
          <option value="confirmed">
            Đã kiểm tra và xác nhận số lượt ban đầu
          </option>
        </select>
      </label>
      <label className="field">
        Tổng số lượt đã hoàn thành ban đầu
        <input
          name="initial_completed_count"
          type="number"
          min={0}
          max={10000}
          required
          disabled={status === 'unknown'}
          defaultValue={r?.initial_completed_count ?? 0}
        />
      </label>
      <label className="field">
        Số lượt trên đã tính đến hết Chủ nhật ngày
        <input
          name="baseline_through"
          type="date"
          required
          defaultValue={r?.baseline_through ?? '2026-11-08'}
        />
      </label>
      <label className="field">
        Tuần phụ trách gần nhất trong số lượt trên (thứ Hai, nếu biết)
        <input
          name="initial_last_week"
          type="date"
          disabled={status === 'unknown'}
          defaultValue={r?.initial_last_week ?? ''}
        />
      </label>
      <p className="form-help">
        Nhập 0 và chọn “đã kiểm tra” chỉ khi đã xác nhận chưa từng phụ trách đến
        mốc trên. Lịch sử từng tuần trước mốc này đã nằm trong tổng ban đầu nên
        không cộng lần nữa. Nếu đã có lượt nhưng chưa biết ngày gần nhất, hệ
        thống ghi rõ thay vì coi là chưa từng phụ trách.
      </p>
      <div className="form-actions">
        <button
          className="btn btn-dark"
          disabled={!club.online || club.saveState === 'saving'}
        >
          <Check size={16} />
          Lưu lịch sử & điều kiện
        </button>
      </div>
    </form>
  );
}

function CodeForm({ club, member }: { club: Club; member: Member }) {
  const [issued, setIssued] = useState<{
    code: string;
    expires_at: string;
  } | null>(null);
  const [revoke, setRevoke] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="form-intro">
        Cấp mã cho{' '}
        <strong>
          {member.display_name} · {member.code}
        </strong>
        . Gửi riêng mã này cho đúng người. Mã dùng một lần, có hiệu lực 7 ngày;
        thành viên không cần email.
      </p>
      {!issued ? (
        <>
          <label className="check-label booking-completion-check">
            <input
              type="checkbox"
              checked={revoke}
              onChange={(e) => setRevoke(e.target.checked)}
            />
            Thu hồi các thiết bị cũ của người này khi cấp mã mới
          </label>
          <button
            className="btn btn-dark full"
            disabled={!club.online || club.saveState === 'saving'}
            onClick={async () => {
              let result: typeof issued = null;
              const ok = await club.run(async () => {
                result = await rpc('issue_booking_code', {
                  p_member_id: member.id,
                  p_revoke_existing: revoke,
                });
              }, 'Đã cấp mã cá nhân');
              if (ok && result) setIssued(result);
            }}
          >
            <KeyRound size={16} />
            Tạo mã một lần
          </button>
        </>
      ) : (
        <>
          <div className="issued-booking-code">
            <span>Mã của {member.display_name}</span>
            <code>{issued.code.match(/.{1,4}/g)?.join('-')}</code>
            <small>Hạn dùng: {bookingTime(issued.expires_at)}</small>
          </div>
          <button
            className="btn btn-dark full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.code);
                setCopied(true);
              } catch {
                setCopied(false);
                club.setNotice(
                  'Chưa sao chép được. Hãy chọn và sao chép mã đang hiển thị.',
                );
              }
            }}
          >
            <Copy size={16} />
            {copied ? 'Đã sao chép mã' : 'Sao chép để gửi riêng'}
          </button>
          <p className="form-help">
            Mã chỉ hiển thị tại đây sau khi tạo. Đóng cửa sổ sẽ không xem lại
            được; có thể cấp mã mới khi cần.
          </p>
        </>
      )}
    </div>
  );
}

function ProposalForm({ club, close }: { club: Club; close: () => void }) {
  const assigned = club.booking?.assignments ?? [];
  const latest = assigned
    .filter((a) => a.week_end >= dateKey(vietnamToday()))
    .at(-1)?.week_start;
  const [start, setStart] = useState(
    latest
      ? dateKey(addDays(new Date(`${latest}T12:00:00`), 7))
      : dateKey(monday()),
  );
  const [weeks, setWeeks] = useState(8);
  const [proposal, setProposal] = useState<BookingProposal | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(
    'Áp dụng lịch đã kiểm tra và trao đổi với nhóm',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const unknown =
    club.booking?.rotation.filter(
      (r) =>
        r.eligible &&
        r.history_status === 'unknown' &&
        club.members.find((m) => m.id === r.member_id)?.active,
    ) ?? [];
  const eligible =
    club.booking?.rotation.filter(
      (r) =>
        r.eligible &&
        r.history_status === 'confirmed' &&
        club.members.find((m) => m.id === r.member_id)?.active,
    ) ?? [];
  const stale = proposal && proposal.revision !== club.booking?.revision;
  const newRows = proposal?.rows.filter((r) => !r.existing) ?? [];
  async function preview(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError('');
    try {
      setProposal(
        await rpc<BookingProposal>('propose_booking_assignments', {
          p_start: start,
          p_weeks: weeks,
        }),
      );
      setChoices({});
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <p className="form-intro">
        Ưu tiên tổng lượt đã hoàn thành cùng các tuần đã xếp, rồi người lâu chưa
        phụ trách; hòa điểm dùng thứ tự cố định. Hạn chế trùng tuần liền nhau.
        Đây là bản xem trước, chỉ lưu khi bạn áp dụng.
      </p>
      {!!unknown.length && (
        <div className="form-error">
          <strong>Cần xác nhận lịch sử trước khi đề xuất</strong>
          <p>
            {unknown
              .map((r) => memberName(club.members, r.member_id))
              .join(', ')}{' '}
            đang “Chưa có lịch sử ghi nhận”. Mở Vòng phân công để nhập hoặc xác
            nhận số lượt ban đầu.
          </p>
        </div>
      )}
      <form className="proposal-controls" onSubmit={(e) => void preview(e)}>
        <label className="field">
          Từ thứ Hai ngày
          <input
            type="date"
            value={start}
            required
            onChange={(e) => {
              setStart(e.target.value);
              setProposal(null);
            }}
          />
        </label>
        <label className="field">
          Số tuần
          <input
            type="number"
            min={1}
            max={26}
            value={weeks}
            required
            onChange={(e) => {
              setWeeks(Number(e.target.value));
              setProposal(null);
            }}
          />
        </label>
        <button
          className="btn btn-soft"
          disabled={pending || !club.online || !!unknown.length}
        >
          {pending ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Users size={15} />
          )}
          Lập bản đề xuất
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {proposal && (
        <>
          <div className="proposal-rows">
            {proposal.rows.map((row) => (
              <article key={row.week_start}>
                <strong>{weekLabel(row.week_start, row.week_end)}</strong>
                <label className="field">
                  <span>
                    {row.existing ? 'Lịch đã chốt' : 'Người được đề xuất'}
                  </span>
                  <select
                    aria-label={`Người phụ trách tuần ${row.week_start}`}
                    disabled={row.existing}
                    value={choices[row.week_start] ?? row.member_id}
                    onChange={(e) =>
                      setChoices({
                        ...choices,
                        [row.week_start]: e.target.value,
                      })
                    }
                  >
                    {row.existing ? (
                      <option value={row.member_id}>
                        {memberName(club.members, row.member_id)}
                      </option>
                    ) : (
                      eligible.map((r) => (
                        <option key={r.member_id} value={r.member_id}>
                          {memberName(club.members, r.member_id)}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <p>
                  {choices[row.week_start] &&
                  choices[row.week_start] !== row.member_id
                    ? `Quản trị viên điều chỉnh từ đề xuất ${memberName(club.members, row.member_id)}. Ghi rõ lý do trong phần áp dụng bên dưới.`
                    : row.reason}
                </p>
              </article>
            ))}
          </div>
          {stale && (
            <p className="form-error" role="alert">
              Dữ liệu vừa thay đổi. Tạo lại bản đề xuất trước khi áp dụng để
              tránh ghi đè lịch mới.
            </p>
          )}
          <label className="field">
            Lý do áp dụng / điều chỉnh
            <textarea
              rows={2}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
          <button
            className="btn btn-dark full"
            disabled={
              !!stale ||
              !newRows.length ||
              !reason.trim() ||
              !club.online ||
              club.saveState === 'saving'
            }
            onClick={async () => {
              if (
                await club.run(
                  () =>
                    rpc('apply_booking_proposal', {
                      p_rows: newRows.map((r) => ({
                        week_start: r.week_start,
                        member_id: choices[r.week_start] ?? r.member_id,
                      })),
                      p_expected_revision: proposal.revision,
                      p_reason: reason.trim(),
                    }),
                  'Đã áp dụng lịch phân công đã duyệt',
                )
              )
                close();
            }}
          >
            <Check size={16} />
            Áp dụng {newRows.length} tuần mới
          </button>
        </>
      )}
    </div>
  );
}

function SeedForm({ club, close }: { club: Club; close: () => void }) {
  const issues = club.booking?.setup_issues ?? [];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const mapping = Object.fromEntries(fd.entries());
    let result: { initialized: boolean } | null = null;
    const ok = await club.run(async () => {
      result = await rpc('initialize_booking_schedule', { p_mapping: mapping });
    }, 'Đã kiểm tra liên kết thành viên');
    if (ok && result && (result as { initialized: boolean }).initialized)
      close();
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <p className="form-intro">
        Chọn đúng mã thành viên hiện có cho từng tên cần xử lý. Website không
        tạo người mới và không ghi đè các tuần đã phân công.
      </p>
      {issues.map((i) => (
        <label className="field" key={i.name}>
          {i.name} ·{' '}
          {i.kind === 'missing' ? 'Không tìm thấy' : 'Có nhiều kết quả'}
          <select name={i.name} required>
            <option value="">Liên kết đúng thành viên</option>
            {club.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name} · {m.code}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button
        className="btn btn-dark full"
        disabled={!club.online || club.saveState === 'saving'}
      >
        <Check size={16} />
        Kiểm tra và khởi tạo lịch còn thiếu
      </button>
    </form>
  );
}

const HISTORY_LABELS: Record<string, string> = {
  agreed_schedule_seeded: 'Lịch đã thống nhất',
  assignment_created: 'Tạo phân công',
  assignment_changed: 'Điều chỉnh phân công',
  history_imported: 'Nhập lịch sử tuần',
  week_completed: 'Xác nhận hoàn thành tuần',
  swap_requested: 'Gửi đề nghị đổi lượt',
  swap_accepted: 'Chấp nhận đổi hai tuần',
  swap_rejected: 'Từ chối đổi lượt',
  swap_cancelled: 'Hủy yêu cầu đổi lượt',
  swap_invalid: 'Yêu cầu không còn hiệu lực',
  admin_swap: 'Quản trị viên đổi trực tiếp',
  proposal_applied: 'Áp dụng đề xuất',
  rotation_updated: 'Sửa vòng phân công / lịch sử ban đầu',
  identity_code_issued: 'Cấp mã xác minh',
  court_confirmed: 'Xác nhận đã đặt sân',
  court_cancelled: 'Hủy buổi đánh',
  court_updated: 'Cập nhật thông tin sân',
  session_override: 'Chỉ định phụ trách riêng theo buổi',
  booking_migrated: 'Giữ thông tin đặt sân trước nâng cấp',
};
function BookingHistoryList({ club }: { club: Club }) {
  const rows = club.booking?.history ?? [];
  return rows.length ? (
    <div className="booking-history-list">
      {rows.map((h: BookingHistory) => (
        <article className="booking-history-item" key={h.id}>
          <span className="audit-icon">
            <History size={16} />
          </span>
          <div>
            <div className="booking-history-title">
              <strong>{HISTORY_LABELS[h.event_type] ?? h.event_type}</strong>
              <time>{bookingTime(h.created_at)}</time>
            </div>
            <p>{h.actor_name}</p>
            {h.changes
              .filter((c) => c.week_start)
              .map((c, i) => (
                <div className="booking-history-change" key={i}>
                  <small>{weekLabel(c.week_start!, c.week_end)}</small>
                  <span>
                    Ban đầu: {memberName(club.members, c.original_member_id)}
                  </span>
                  <strong>
                    {memberName(club.members, c.before_member_id)}{' '}
                    <ArrowRight size={12} />{' '}
                    {memberName(club.members, c.after_member_id)}
                  </strong>
                  {c.completed_member_id && (
                    <span>
                      Hoàn thành:{' '}
                      {memberName(club.members, c.completed_member_id)}
                    </span>
                  )}
                </div>
              ))}
            {h.requested_by_member_id && (
              <p>
                Người gửi: {memberName(club.members, h.requested_by_member_id)}
                {h.confirmed_by_member_id &&
                  ` · Người xử lý: ${memberName(club.members, h.confirmed_by_member_id)}`}
              </p>
            )}
            {h.session_snapshot && (
              <div className="booking-history-session">
                <strong>
                  {formatDate(h.session_snapshot.session_date)} ·{' '}
                  {h.session_snapshot.venue} / {h.session_snapshot.court}
                </strong>
                <span>
                  Phụ trách:{' '}
                  {memberName(club.members, h.session_snapshot.organizer_id)} ·{' '}
                  {h.session_snapshot.organizer_mode === 'override'
                    ? 'Chỉ định riêng'
                    : 'Theo tuần'}
                </span>
                {h.session_snapshot.booked_by_member_id && (
                  <span>
                    Người đã đặt:{' '}
                    {memberName(
                      club.members,
                      h.session_snapshot.booked_by_member_id,
                    )}
                  </span>
                )}
                <span>
                  {BOOKING_LABELS[h.session_snapshot.booking_status]}
                  {h.session_snapshot.estimated_cost != null &&
                    ` · ${currency(h.session_snapshot.estimated_cost)}`}
                </span>
              </div>
            )}
            {h.reason && <p className="history-reason">{h.reason}</p>}
          </div>
        </article>
      ))}
    </div>
  ) : (
    <div className="empty-state">
      <History size={28} />
      <h3>Chưa có lịch sử được ghi nhận</h3>
    </div>
  );
}

export function BookingSessionEditor({
  session: s,
  club,
  close,
}: {
  session: CourtSession;
  club: Club;
  close: () => void;
}) {
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const values: Record<string, unknown> = Object.fromEntries(fd.entries());
    values.start_time = `${fd.get('start_time')}:00`;
    values.end_time = `${fd.get('end_time')}:00`;
    values.estimated_cost = fd.get('estimated_cost')
      ? Number(fd.get('estimated_cost'))
      : null;
    if (String(values.start_time) >= String(values.end_time)) {
      setError('Giờ kết thúc phải sau giờ bắt đầu.');
      return;
    }
    const patch = Object.fromEntries(
      Object.entries(values).filter(
        ([k, v]) => (s as unknown as Record<string, unknown>)[k] !== v,
      ),
    );
    if (!Object.keys(patch).length) {
      close();
      return;
    }
    if (
      await club.run(
        () =>
          club.bookingRpc('update_booking_session', {
            p_id: s.id,
            p_patch: patch,
            p_expected_version: s.version,
          }),
        'Đã cập nhật thông tin đặt sân',
      )
    )
      close();
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <SessionResponsibility session={s} />
      <p className="form-intro">
        Cập nhật thông tin sau khi liên hệ chủ sân. Phân công và đăng ký Đi /
        Không đi là hai việc độc lập.
      </p>
      <div className="form-grid">
        <label className="field">
          Ngày đánh
          <input
            name="session_date"
            type="date"
            required
            defaultValue={s.session_date}
          />
        </label>
        <label className="field">
          Trạng thái sân
          <select name="booking_status" defaultValue={s.booking_status}>
            {Object.entries(BOOKING_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Giờ bắt đầu
          <input
            name="start_time"
            type="time"
            required
            defaultValue={s.start_time.slice(0, 5)}
          />
        </label>
        <label className="field">
          Giờ kết thúc
          <input
            name="end_time"
            type="time"
            required
            defaultValue={s.end_time.slice(0, 5)}
          />
        </label>
        <label className="field">
          Tên sân
          <input name="venue" required maxLength={160} defaultValue={s.venue} />
        </label>
        <label className="field">
          Ca / số sân
          <input name="court" required maxLength={80} defaultValue={s.court} />
        </label>
        <label className="field span-2">
          Địa chỉ
          <input name="address" maxLength={500} defaultValue={s.address} />
        </label>
        <label className="field span-2">
          Google Maps
          <input name="maps_url" type="url" defaultValue={s.maps_url} />
        </label>
        <label className="field span-2">
          Tiền sân dự kiến (đồng)
          <input
            name="estimated_cost"
            type="number"
            min={0}
            max={999999999999}
            step={1000}
            defaultValue={s.estimated_cost ?? ''}
            placeholder="Chưa có dự kiến"
          />
        </label>
        <label className="field span-2">
          Ghi chú liên hệ đặt sân
          <textarea
            name="booking_contact_note"
            rows={2}
            maxLength={2000}
            defaultValue={s.booking_contact_note ?? ''}
          />
        </label>
        <label className="field span-2">
          Ghi chú đặt cọc
          <textarea
            name="deposit_note"
            rows={2}
            maxLength={2000}
            defaultValue={s.deposit_note ?? ''}
          />
        </label>
        <label className="field span-2">
          Ghi chú cho buổi đánh
          <textarea
            name="note"
            rows={2}
            maxLength={2000}
            defaultValue={s.note}
          />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          className="btn btn-dark"
          disabled={!club.online || club.saveState === 'saving'}
        >
          <Check size={16} />
          {club.saveState === 'saving' ? 'Đang lưu…' : 'Lưu thông tin sân'}
        </button>
      </div>
    </form>
  );
}
