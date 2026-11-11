import React from 'react';
import { ArrowRight, ArrowLeftRight, BadgeCheck, CalendarDays, ClipboardCheck, Mountain, Users, Wallet } from 'lucide-react';
import { formatDate } from './lib';
import { currency, weekLabel, memberName } from './bookingUtils';
import { netPaid, type ClubActivity } from './activityTypes';
import { navigateRoute } from './navigation';
import { QuickRegistration } from './QuickRegistration';
import type { CourtSession, Snapshot } from './types';
import type { useClub } from './useClub';

type Club = ReturnType<typeof useClub>;
export function myTaskData(club: Snapshot, memberId: string | null, verifiedId: string | null, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const upcoming = club.sessions.filter((s) => s.booking_status !== 'cancelled' && new Date(s.session_date + 'T' + s.end_time + '+07:00') > now);
  const pending = upcoming.filter((s) => memberId && (!s.deadline || new Date(s.deadline) > now) && club.roster.some((r) => r.session_id === s.id && r.member_id === memberId) && !club.attendance.some((a) => a.session_id === s.id && a.member_id === memberId && a.status !== 'unanswered'));
  const assignments = club.booking?.assignments.filter((a) => a.member_id === verifiedId && a.week_end >= today) ?? [];
  const requests = club.booking?.requests.filter((r) => r.status === 'pending' && (r.to_member_id === verifiedId || r.from_member_id === verifiedId)) ?? [];
  const activities = club.activities?.activities.filter((a) => !a.merged_into_id && a.status !== 'cancelled') ?? [];
  const balances = activities
    .filter((activity) => activity.fee_status === 'finalized')
    .flatMap((activity) =>
      (activity.calculation?.people ?? [])
        .filter((person) => memberId && person.member_id === memberId)
        .map((person) => ({
          activity,
          person,
          balance:
            person.due - netPaid(activity.ledger ?? [], person.id),
        }))
        .filter((row) => row.balance !== 0),
    );
  const trips = activities.filter((a) => a.kind === 'trip' && a.status === 'open' && (!a.details.end_date || a.details.end_date >= today) && (!a.details.deadline || new Date(a.details.deadline) > now) && memberId && !(a.participants ?? []).some((p) => p.member_id === memberId && p.status !== 'unanswered'));
  return { pending, assignments, requests, balances, trips };
}

export function MyTasks({ club, onChoose, onOpenSession }: { club: Club; onChoose: () => void; onOpenSession: (session: CourtSession) => void }) {
  const verified = club.booking?.verified_member_id ?? null;
  const { pending, assignments, requests, balances, trips } = myTaskData(club, club.memberId, verified);
  const busy = !club.online || club.saveState === 'saving';
  const total = pending.length + requests.filter((r) => r.to_member_id === verified).length + balances.length + trips.length;
  async function respond(id: string, decision: 'accept' | 'reject') {
    let outcome = '';
    const ok = await club.run(async () => {
      outcome = await club.bookingRpc<string>('respond_booking_swap', { p_request_id: id, p_decision: decision });
    }, decision === 'accept' ? 'Đã đồng ý đổi lượt' : 'Đã từ chối, giữ nguyên phân công');
    if (ok && outcome === 'invalid') club.setNotice('Yêu cầu đã hết hiệu lực vì lịch vừa thay đổi. Phân công chưa được đổi.');
  }
  function openActivity(activity: ClubActivity) { navigateRoute({ page: activity.kind === 'trip' ? 'travel' : 'finance', activity: activity.id }); }
  return <section className="management my-tasks-page">
    <div className="section-heading"><div><span className="section-kicker">MỞ LÀ BIẾT, CHẠM LÀ XONG</span><h1>Việc của tôi <span className="count-chip">{total} việc cần xem</span></h1><p className="muted">Lịch cần trả lời, lượt đặt sân và tiền của bạn trong một chỗ.</p></div>{club.me && <button className="btn btn-soft" onClick={onChoose}><Users size={16} /> {club.me.display_name} · Đổi tên</button>}</div>
    {club.loading && <p role="status">Đang lấy dữ liệu mới nhất…</p>}
    {club.bookingError && <div className="alert danger" role="alert">Chưa tải được việc đặt sân: {club.bookingError}</div>}
    {club.activityError && <div className="alert danger" role="alert">Chưa tải được tiền sân và du lịch: {club.activityError} <button className="text-btn" onClick={() => void club.reload()}>Thử lại</button></div>}
    {!club.loading && !club.activities && !club.activityError && <div className="alert">Dữ liệu tiền sân và du lịch chưa sẵn sàng. Mở mục Tiền sân để kiểm tra kết nối hoặc cấu hình backend.</div>}
    {!club.me && <div className="activity-empty"><Users size={32} /><h2>Chọn tên để xem việc của bạn</h2><p>Không cần email để xem lịch và đăng ký nhanh.</p><button className="btn btn-dark" onClick={onChoose}>Chọn tên của tôi</button></div>}
    {club.me && <>
      <div className="task-overview">{[
        ['Chờ phản hồi', pending.length], ['Đổi lượt đang chờ', requests.length], ['Khoản cần đối chiếu', balances.length], ['Chuyến mở đăng ký', trips.length],
      ].map(([label, count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
      <div className="my-tasks-grid">
        <section className="task-section"><h2><CalendarDays size={20} /> Lịch chờ tôi phản hồi <small>{pending.length}</small></h2>
          {pending.length ? pending.map((s) => <article className="task-card" key={s.id}><div className="task-card-heading"><strong>{formatDate(s.session_date)} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</strong><button className="text-btn" onClick={() => onOpenSession(s)}>Chi tiết <ArrowRight size={14} /></button></div><p>{s.venue} · {s.court}</p><QuickRegistration session={s} club={club} compact onChoose={onChoose} /></article>) : <p className="task-empty"><ClipboardCheck size={18} /> Đã trả lời các lịch đang mở đăng ký.</p>}
        </section>
        <section className="task-section"><h2><BadgeCheck size={20} /> Việc đặt sân của tôi</h2>
          {!verified ? <p className="task-empty">Xác minh mã cá nhân ở mục Phân công CS để hiện lượt đặt sân và yêu cầu gửi đến bạn. <button className="text-btn" onClick={() => navigateRoute({ page: 'booking' })}>Mở Phân công CS <ArrowRight size={14} /></button></p> : <>
            <p className="form-help">Theo danh tính đã xác minh: <strong>{memberName(club.members, verified)}</strong>.</p>
            {assignments.slice(0, 4).map((assignment) => { const sessions = club.sessions.filter((s) => s.session_date >= assignment.week_start && s.session_date <= assignment.week_end && s.booking_status !== 'cancelled' && s.organizer_id === verified); return <article className="task-card" key={assignment.id}><strong>{weekLabel(assignment.week_start, assignment.week_end)}</strong><p>{sessions.filter((s) => s.booking_status === 'booked').length}/{sessions.length} buổi đã đặt sân{!sessions.length ? ' · Chưa có buổi cần đặt' : ''}</p><button className="text-btn" onClick={() => navigateRoute({ page: 'schedule', week: assignment.week_start, day: undefined, session: undefined })}>Mở tuần phụ trách <ArrowRight size={14} /></button></article>; })}
            {!assignments.length && <p className="task-empty">Bạn chưa có phân công sắp tới.</p>}
            {requests.map((r) => <article className="task-card task-swap" key={r.id}><strong><ArrowLeftRight size={16} /> {memberName(club.members, r.from_member_id)} ↔ {memberName(club.members, r.to_member_id)}</strong><p>{weekLabel(r.from_week_start)} / {weekLabel(r.to_week_start)}</p>{r.reason && <p>{r.reason}</p>}{r.to_member_id === verified ? <div className="task-card-actions"><button className="btn btn-soft" disabled={busy} onClick={() => void respond(r.id, 'reject')}>Từ chối</button><button className="btn btn-dark" disabled={busy} onClick={() => void respond(r.id, 'accept')}>Đồng ý đổi lượt</button></div> : <p className="form-help">Đã gửi, đang chờ người nhận phản hồi.</p>}</article>)}
          </>}
        </section>
        <section className="task-section"><h2><Wallet size={20} /> Tiền cần đối chiếu <small>{balances.length}</small></h2><p className="form-help">Chỉ tính các bảng phí đã chốt. Tiền tạm tính xem trong từng hoạt động.</p>
          {balances.map(({ activity, person, balance }) => <article className="task-card" key={activity.id + ':' + person.id}><strong>{activity.title}</strong><p className={balance > 0 ? 'task-money-due' : 'task-money-refund'}>{balance > 0 ? 'Còn cần đóng: ' : 'Cần nhận hoàn: '}{currency(Math.abs(balance))}</p><button className="text-btn" onClick={() => openActivity(activity)}>Xem bảng phí và khoản thu <ArrowRight size={14} /></button></article>)}
          {!balances.length && club.activities && !club.activityError && <p className="task-empty"><ClipboardCheck size={18} /> Không có khoản còn thiếu hoặc cần hoàn trong bảng phí đã chốt.</p>}
        </section>
        <section className="task-section"><h2><Mountain size={20} /> Chuyến đi chờ tôi trả lời <small>{trips.length}</small></h2>
          {trips.map((trip) => <article className="task-card" key={trip.id}><strong>{trip.title}</strong><p>{trip.details.start_date ? formatDate(trip.details.start_date) : 'Ngày sẽ được cập nhật'}{trip.details.location ? ' · ' + trip.details.location : ''}</p><button className="btn btn-soft" onClick={() => openActivity(trip)}>Xem chuyến và đăng ký <ArrowRight size={14} /></button></article>)}
          {!trips.length && club.activities && !club.activityError && <p className="task-empty">Không có chuyến mở đăng ký cần bạn phản hồi.</p>}
        </section>
      </div>
    </>}
  </section>;
}
