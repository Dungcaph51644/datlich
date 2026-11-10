import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Copy,
  Edit3,
  History,
  Info,
  LayoutGrid,
  LoaderCircle,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Mountain,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  addDays,
  configured,
  dateKey,
  formatDate,
  message,
  monday,
  registrationArgs,
  rpc,
  summary,
  supabase,
  vietnamToday,
} from './lib';
import {
  BOOKING_LABELS,
  STATUS_LABELS,
  type Attendance,
  type AttendanceStatus,
  type CourtSession,
  type Member,
} from './types';
import { useClub } from './useClub';
import { Modal } from './Modal';
import {
  BookingHome,
  BookingPage,
  BookingIdentityForm,
  BookingSessionEditor,
  CSBadge,
  SessionResponsibility,
  BookingWriteState,
} from './BookingFeatures';
import { AutoNote } from './AutoNote';
import { registrationClosed } from './lib';
import {
  BulkRegistration,
  MemberPicker,
  QuickRegistration,
} from './QuickRegistration';
import {
  MomentumStrip,
  MotionToggle,
  SportsHero,
  scrollToClubSection,
  useMotionPreference,
  useSportMotion,
} from './SportUI';

const ActivitiesPage = lazy(() =>
  import('./ActivityFeatures').then((module) => ({
    default: module.ActivitiesPage,
  })),
);
type Club = ReturnType<typeof useClub>;
type ModalState =
  | { type: 'login' }
  | { type: 'choose' }
  | { type: 'verify-booking' }
  | { type: 'booking-session'; session: CourtSession }
  | { type: 'member'; member?: Member }
  | { type: 'session'; session?: CourtSession }
  | { type: 'attendance'; session: CourtSession }
  | { type: 'note'; session: CourtSession; member: Member; row?: Attendance }
  | { type: 'link'; member: Member }
  | null;
const shortTime = (t: string) => t.slice(0, 5);

export default function App() {
  const club = useClub();
  const [page, setPage] = useState<
    'schedule' | 'members' | 'history' | 'booking' | 'finance' | 'travel'
  >('schedule');
  const [week, setWeek] = useState(0);
  const [modal, setModal] = useState<ModalState>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [motionEnabled, setMotionEnabled] = useMotionPreference();
  useSportMotion(page, week, motionEnabled);
  const isAdmin = club.account?.role === 'admin';
  const mine = club.me;
  const askedIdentity = useRef(false);
  useEffect(() => {
    if (
      club.quickReady &&
      !club.loading &&
      !club.me &&
      !askedIdentity.current &&
      !modal
    ) {
      askedIdentity.current = true;
      setModal({ type: 'choose' });
    }
  }, [club.quickReady, club.loading, club.me, modal]);
  const start = monday(week),
    end = addDays(start, 6);
  const inWeek = club.sessions.filter(
    (s) => s.session_date >= dateKey(start) && s.session_date <= dateKey(end),
  );
  const shown = inWeek.filter((s) => !day || s.session_date === day);
  const next = club.sessions.find(
    (s) =>
      s.booking_status !== 'cancelled' &&
      new Date(`${s.session_date}T${s.end_time}+07:00`) > new Date(),
  );
  const busy = club.saveState === 'saving' || !club.online || !configured;
  function register(session?: CourtSession) {
    if (!club.memberId && club.quickReady) setModal({ type: 'choose' });
    else if (!club.quickReady && !club.account) setModal({ type: 'login' });
    else if (session) scrollToClubSection('next-registration', 'center');
    else scrollToClubSection('weekly');
  }
  async function copyWeek() {
    if (
      !window.confirm(
        'Sao chép các ca/sân chưa hủy sang tuần tiếp theo? Trạng thái đặt sân sẽ là Chưa đặt; mọi người phải xác nhận lại.',
      )
    )
      return;
    await club.run(async () => {
      const count = await rpc<number>('copy_week', {
        p_week_start: dateKey(start),
      });
      if (!count)
        throw new Error(
          'Không có ca mới để sao chép. Lịch có thể đã được sao chép trước đó.',
        );
    }, 'Đã sao chép lịch, không mang theo xác nhận cũ');
  }

  return (
    <>
      <div className="scroll-progress" aria-hidden="true" />
      <header className="header">
        <div className="header-inner">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage('schedule');
            }}
          >
            <img src="/shuttle.svg" alt="" />
            <span>
              Cầu lông<span className="brand-sub">và những người bạn</span>
            </span>
          </a>
          <nav
            className={mobileMenu ? 'nav open' : 'nav'}
            aria-label="Điều hướng chính"
          >
            <button
              className={page === 'schedule' ? 'active' : ''}
              onClick={() => {
                setPage('schedule');
                setMobileMenu(false);
              }}
            >
              <CalendarDays size={17} />
              Lịch đánh cầu
            </button>
            <button
              className={page === 'members' ? 'active' : ''}
              onClick={() => {
                setPage('members');
                setMobileMenu(false);
              }}
            >
              <Users size={17} />
              Thành viên
            </button>
            <button
              className={page === 'booking' ? 'active' : ''}
              onClick={() => {
                setPage('booking');
                setMobileMenu(false);
              }}
            >
              <BadgeCheck size={17} />
              Phân công CS
              {!!club.booking?.notifications.filter((n) => !n.read_at)
                .length && (
                <small className="nav-notification-count">
                  {club.booking.notifications.filter((n) => !n.read_at).length}
                </small>
              )}
            </button>
            {isAdmin && (
              <button
                className={page === 'history' ? 'active' : ''}
                onClick={() => {
                  setPage('history');
                  setMobileMenu(false);
                }}
              >
                <History size={17} />
                Lịch sử
              </button>
            )}
            <button
              className={page === 'finance' ? 'active' : ''}
              onClick={() => {
                setPage('finance');
                setMobileMenu(false);
              }}
            >
              <Wallet size={17} /> Tiền sân
            </button>
            <button
              className={page === 'travel' ? 'active' : ''}
              onClick={() => {
                setPage('travel');
                setMobileMenu(false);
              }}
            >
              <Mountain size={17} /> Du lịch & sự kiện
            </button>
            <button
              className="mobile-admin-btn"
              onClick={() => {
                setMobileMenu(false);
                if (club.user)
                  void club.run(async () => {
                    const { error } = await supabase!.auth.signOut();
                    if (error) throw error;
                  }, 'Đã đăng xuất quản trị');
                else setModal({ type: 'login' });
              }}
            >
              <ShieldCheck size={17} />
              {club.user ? 'Đăng xuất quản trị' : 'Đăng nhập quản trị'}
            </button>
          </nav>
          <div className="header-actions">
            <MotionToggle
              enabled={motionEnabled}
              onToggle={() => setMotionEnabled(!motionEnabled)}
            />
            <button
              className="identity-button"
              disabled={!club.quickReady}
              onClick={() => setModal({ type: 'choose' })}
            >
              <Users size={16} />
              <span>{mine ? mine.display_name : 'Chọn tên'}</span>
              <Edit3 size={12} />
            </button>
            {club.user ? (
              <>
                <span className="user-name">
                  {isAdmin && <ShieldCheck size={15} />}
                </span>
                <button
                  className="icon-btn"
                  title="Đăng xuất"
                  aria-label="Đăng xuất"
                  onClick={() =>
                    void club.run(async () => {
                      const { error } = await supabase!.auth.signOut();
                      if (error) throw error;
                    }, 'Đã đăng xuất')
                  }
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <button
                className="icon-btn admin-login"
                title="Đăng nhập quản trị"
                aria-label="Đăng nhập quản trị"
                onClick={() => setModal({ type: 'login' })}
              >
                <ShieldCheck size={18} />
              </button>
            )}
            <button
              className="icon-btn menu-btn"
              aria-label="Mở điều hướng"
              aria-expanded={mobileMenu}
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              <Menu size={23} />
            </button>
          </div>
        </div>
      </header>

      <main data-page={page}>
        <div className="topline">
          <span>
            <span className="tiny-dot" /> HẸN NHAU TRÊN SÂN
          </span>
          <Connection club={club} />
        </div>
        {!configured && (
          <div className="alert setup">
            <Info size={19} />
            <div>
              <strong>Chưa kết nối cơ sở dữ liệu</strong>
              <span>
                Giao diện đã sẵn sàng. Cấu hình Supabase theo README để dùng
                lịch chung, đăng nhập và đồng bộ thời gian thực.
              </span>
            </div>
          </div>
        )}
        {!club.online && (
          <div className="alert danger">
            <WifiOff size={19} />
            Mất kết nối mạng. Bạn đang xem dữ liệu gần nhất; các thao tác lưu
            tạm thời bị khóa.
          </div>
        )}
        {club.error && (
          <div className="alert danger">
            <Info size={19} />
            <div>
              <strong>Không tải được dữ liệu mới nhất</strong>
              <span>{club.error}</span>
            </div>
            <button className="text-btn" onClick={() => void club.reload()}>
              Thử lại
            </button>
          </div>
        )}
        {configured && !club.quickReady && !club.loading && !club.error && (
          <div className="alert">
            <Info size={19} />
            <div>
              <strong>Chưa bật đăng ký nhanh</strong>
              <span>
                Quản trị viên cần chạy bản cập nhật cơ sở dữ liệu mới. Lịch hiện
                có vẫn được giữ nguyên.
              </span>
            </div>
          </div>
        )}
        {club.user && !club.account && !club.loading && (
          <div className="alert">
            <ShieldCheck size={19} />
            <div>
              <strong>Email này chưa có quyền quản trị</strong>
              <span>
                Bạn vẫn có thể chọn tên để đăng ký nhanh. Chủ nhóm cấp quyền
                quản trị riêng cho email này nếu cần.
              </span>
            </div>
          </div>
        )}

        {page === 'schedule' && (
          <>
            <section
              className="hero-grid"
              aria-label="Lên sân cùng những người bạn"
            >
              <SportsHero onRegister={() => register(next)} />
              <aside className="next-card">
                <div className="section-eyebrow">
                  <span className="live-dot" /> BUỔI ĐÁNH SẮP TỚI
                  <ArrowUpRight size={19} />
                </div>
                {club.loading ? (
                  <div className="empty-next">
                    <LoaderCircle className="spin" />
                    <p>Đang lấy lịch mới nhất…</p>
                  </div>
                ) : next ? (
                  <>
                    <div className="next-date">
                      <div>
                        {new Date(next.session_date + 'T12:00:00').getDate()}
                        <small>
                          THÁNG {Number(next.session_date.slice(5, 7))}
                        </small>
                      </div>
                      <span>
                        {formatDate(next.session_date, { weekday: 'long' })}
                        <strong>
                          {shortTime(next.start_time)} –{' '}
                          {shortTime(next.end_time)}
                        </strong>
                      </span>
                    </div>
                    <h2>{next.venue}</h2>
                    <p className="muted inline">
                      <MapPin size={15} />
                      {next.court} · {next.address || 'Chưa cập nhật địa chỉ'}
                    </p>
                    <div className="next-meta">
                      <span>
                        Phụ trách buổi<strong>{next.organizer_name}</strong>
                        {next.organizer_mode && (
                          <small>
                            {next.organizer_mode === 'override'
                              ? 'Chỉ định riêng'
                              : 'Theo phân công tuần'}
                          </small>
                        )}
                      </span>
                      <Badge status={next.booking_status} />
                    </div>
                    {next.booked_by_member_id && (
                      <p className="next-booked-by">
                        <Check size={13} />
                        {next.booked_at
                          ? 'Đã đặt thực tế: '
                          : 'Người đặt theo dữ liệu cũ: '}
                        <strong>{next.booked_by_name}</strong>
                      </p>
                    )}
                    <div className="next-count">
                      <Users size={18} />
                      <strong>
                        <span
                          className="animated-count"
                          key={next.going_count ?? 0}
                        >
                          {next.going_count ?? 0}
                        </span>
                        {next.max_players ? `/${next.max_players}` : ''}
                      </strong>
                      <span>người đã hẹn lên sân</span>
                    </div>
                    <div id="next-registration">
                      <QuickRegistration
                        session={next}
                        club={club}
                        onChoose={() => setModal({ type: 'choose' })}
                      />
                    </div>
                    <button
                      className="text-btn full"
                      onClick={() =>
                        setModal({ type: 'attendance', session: next })
                      }
                    >
                      Danh sách & chi tiết <ArrowRight size={15} />
                    </button>
                    {club.bookingReady &&
                      (isAdmin ||
                        club.booking?.verified_member_id ===
                          next.organizer_id) && (
                        <button
                          className="btn btn-soft full next-booking-edit"
                          disabled={busy}
                          onClick={() =>
                            setModal({ type: 'booking-session', session: next })
                          }
                        >
                          <Edit3 size={14} />
                          Cập nhật đặt sân
                        </button>
                      )}
                  </>
                ) : (
                  <div className="empty-next">
                    <div className="empty-icon">
                      <CalendarDays size={31} />
                    </div>
                    <h2>Chờ một chiếc hẹn mới</h2>
                    <p>
                      {configured
                        ? 'Lịch sắp tới sẽ xuất hiện ở đây ngay khi quản trị viên tạo buổi đánh.'
                        : 'Kết nối Supabase để bắt đầu lên lịch và rủ cả nhóm ra sân.'}
                    </p>
                    {isAdmin && (
                      <button
                        className="btn btn-dark"
                        onClick={() => setModal({ type: 'session' })}
                      >
                        <Plus size={17} />
                        Tạo buổi đầu tiên
                      </button>
                    )}
                  </div>
                )}
              </aside>
            </section>
            <MomentumStrip />
            <BookingHome
              club={club}
              onManage={() => {
                setPage('booking');
                window.scrollTo({ top: 0, behavior: 'instant' });
              }}
            />
            <section className="week-section" id="weekly">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">
                    SẮP XẾP THỜI GIAN, XÁCH VỢT LÊN
                  </span>
                  <h2>
                    Lịch đánh trong tuần{' '}
                    <span className="count-chip">{inWeek.length} ca / sân</span>
                  </h2>
                </div>
                <div className="heading-actions">
                  {isAdmin && (
                    <>
                      <button
                        className="btn btn-soft"
                        disabled={busy}
                        onClick={() => void copyWeek()}
                      >
                        <Copy size={16} />
                        <span>Sao chép tuần</span>
                      </button>
                      <button
                        className="btn btn-dark"
                        disabled={busy}
                        onClick={() => setModal({ type: 'session' })}
                      >
                        <Plus size={17} />
                        Tạo buổi đánh
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="calendar-toolbar">
                <div className="week-nav">
                  <button
                    className="icon-btn"
                    aria-label="Tuần trước"
                    onClick={() => {
                      setWeek(week - 1);
                      setDay(null);
                    }}
                  >
                    <ChevronLeft size={19} />
                  </button>
                  <strong>
                    {formatDate(dateKey(start), {
                      day: '2-digit',
                      month: '2-digit',
                    })}{' '}
                    —{' '}
                    {formatDate(dateKey(end), {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </strong>
                  <button
                    className="icon-btn"
                    aria-label="Tuần sau"
                    onClick={() => {
                      setWeek(week + 1);
                      setDay(null);
                    }}
                  >
                    <ChevronRight size={19} />
                  </button>
                  <button
                    className="text-btn today-btn"
                    onClick={() => {
                      setWeek(0);
                      setDay(null);
                    }}
                  >
                    Tuần này
                  </button>
                </div>
                <span className="muted calendar-label">
                  <LayoutGrid size={15} /> Lịch theo ca / sân · Giờ Việt Nam
                </span>
              </div>
              <div className="days-grid" key={week}>
                {Array.from({ length: 7 }, (_, i) => {
                  const d = addDays(start, i),
                    key = dateKey(d),
                    count = inWeek.filter((s) => s.session_date === key).length;
                  return (
                    <button
                      key={key}
                      className={`day ${key === dateKey(vietnamToday()) ? 'is-today' : ''} ${key === day ? 'selected' : ''}`}
                      aria-pressed={key === day}
                      aria-label={`${formatDate(key, { weekday: 'long', day: 'numeric', month: 'numeric' })}: ${count ? `${count} ca / sân` : 'Chưa có lịch'}`}
                      onClick={() => setDay(day === key ? null : key)}
                    >
                      <span>{i === 6 ? 'Chủ nhật' : `Thứ ${i + 2}`}</span>
                      <strong>{String(d.getDate()).padStart(2, '0')}</strong>
                      <small className={count ? 'has-session' : ''}>
                        {count ? `${count} ca` : '—'}
                      </small>
                    </button>
                  );
                })}
              </div>
              <BulkRegistration
                key={`${week}:${club.memberId}`}
                sessions={inWeek}
                club={club}
                onChoose={() => setModal({ type: 'choose' })}
              />
              {club.loading ? (
                <div className="empty-state">
                  <LoaderCircle className="spin" />
                  <p>Đang tải lịch…</p>
                </div>
              ) : shown.length ? (
                <div className="session-grid">
                  {shown.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      club={club}
                      onOpen={() => setModal({ type: 'attendance', session })}
                      onChoose={() => setModal({ type: 'choose' })}
                      onEdit={() =>
                        setModal({
                          type: isAdmin ? 'session' : 'booking-session',
                          session,
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <CalendarDays size={27} />
                  </div>
                  <h3>
                    {day
                      ? 'Ngày này chưa có lịch đánh'
                      : 'Tuần này còn trống, lên lịch thôi!'}
                  </h3>
                  <p>
                    {isAdmin
                      ? 'Tạo buổi mới hoặc sao chép lịch từ tuần trước. Mỗi ca / sân có danh sách đăng ký riêng.'
                      : 'Một buổi cầu vui đang chờ phía trước. Lịch sẽ được cập nhật tại đây.'}
                  </p>
                  {isAdmin && (
                    <button
                      className="text-btn"
                      onClick={() => setModal({ type: 'session' })}
                    >
                      Tạo buổi đánh <Plus size={16} />
                    </button>
                  )}
                </div>
              )}
            </section>
            <div className="bottom-note">
              <div className="note-icon">
                <Info size={20} />
              </div>
              <div>
                <strong>Một cú chạm xác nhận, cả nhóm dễ sắp xếp.</strong>
                <p>
                  Chọn Đi, Không đi hoặc để Chưa phản hồi. Có việc đến muộn?
                  Nhắn một dòng trong ghi chú nhé.
                </p>
              </div>
              <span className="outlined-shuttle">↗</span>
            </div>
          </>
        )}

        {page === 'booking' && <BookingPage club={club} />}
        {(page === 'finance' || page === 'travel') && (
          <Suspense
            fallback={
              <div className="activity-empty" role="status">
                Đang mở hoạt động…
              </div>
            }
          >
            <ActivitiesPage
              key={page}
              club={club}
              kind={page === 'travel' ? 'trip' : 'badminton'}
            />
          </Suspense>
        )}
        {page === 'members' && (
          <section className="management">
            <div className="section-heading">
              <div>
                <span className="section-kicker">ĐỒNG ĐỘI TRÊN SÂN</span>
                <h1>
                  Những người bạn{' '}
                  <span className="count-chip">
                    {club.members.filter((m) => m.active).length} hoạt động
                  </span>
                </h1>
              </div>
              {isAdmin && (
                <button
                  className="btn btn-dark"
                  disabled={busy}
                  onClick={() => setModal({ type: 'member' })}
                >
                  <Plus size={17} />
                  Thêm thành viên
                </button>
              )}
            </div>
            {!club.quickReady && !club.account ? (
              <AccessPrompt onLogin={() => setModal({ type: 'login' })} />
            ) : (
              <>
                <div className="member-toolbar">
                  <label className="search">
                    <Search size={18} />
                    <input
                      aria-label="Tìm thành viên"
                      placeholder="Tìm tên hoặc mã thành viên…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                    />{' '}
                    Hiện người ngừng hoạt động
                  </label>
                </div>
                <div className="members-grid">
                  {club.members
                    .filter(
                      (m) =>
                        (showInactive || m.active) &&
                        `${m.display_name} ${m.code}`
                          .toLocaleLowerCase('vi')
                          .includes(search.toLocaleLowerCase('vi')),
                    )
                    .map((member, i) => (
                      <article
                        className={`member-card ${member.active ? '' : 'inactive'}`}
                        key={member.id}
                      >
                        <div className={`avatar avatar-${i % 4}`}>
                          {member.display_name.split(' ').at(-1)?.slice(0, 1)}
                        </div>
                        <div className="member-info">
                          <h3>
                            {member.display_name}
                            {member.id === mine?.id && <small>Bạn</small>}
                          </h3>
                          <span className="member-code">
                            {member.code} ·{' '}
                            {member.active
                              ? 'Đang hoạt động'
                              : 'Ngừng hoạt động'}
                          </span>
                          <p>{member.note || 'Hẹn gặp trên sân!'}</p>
                        </div>
                        {isAdmin && (
                          <button
                            className="icon-btn"
                            aria-label={`Sửa ${member.display_name}`}
                            onClick={() => setModal({ type: 'member', member })}
                          >
                            <Edit3 size={17} />
                          </button>
                        )}
                        {isAdmin && member.active && (
                          <button
                            className="member-link text-btn"
                            onClick={() => setModal({ type: 'link', member })}
                          >
                            Liên kết email (tùy chọn) <ArrowUpRight size={14} />
                          </button>
                        )}
                      </article>
                    ))}
                </div>
                {!club.members.some(
                  (m) =>
                    (showInactive || m.active) &&
                    `${m.display_name} ${m.code}`
                      .toLocaleLowerCase('vi')
                      .includes(search.toLocaleLowerCase('vi')),
                ) && (
                  <div className="empty-state">
                    <Search />
                    <p>Không tìm thấy thành viên phù hợp.</p>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {page === 'history' && (
          <section className="management">
            <div className="section-heading">
              <div>
                <span className="section-kicker">
                  MỌI THAY ĐỔI ĐỀU CÓ DẤU VẾT
                </span>
                <h1>Lịch sử hoạt động</h1>
              </div>
              <span className="muted">80 thay đổi gần nhất</span>
            </div>
            {isAdmin ? (
              <div className="audit-list">
                {club.audits.map((a) => (
                  <div className="audit-row" key={a.id}>
                    <span className="audit-icon">
                      <History size={18} />
                    </span>
                    <div>
                      <strong>{a.actor_name}</strong>
                      <p>
                        {a.action === 'INSERT'
                          ? 'Thêm'
                          : a.action === 'DELETE'
                            ? 'Xóa'
                            : 'Cập nhật'}{' '}
                        {(
                          {
                            members: 'thành viên',
                            sessions: 'lịch đánh',
                            attendance: 'đăng ký',
                            account_links: 'liên kết tài khoản',
                            session_templates: 'mẫu lịch',
                          } as Record<string, string>
                        )[a.table_name] ?? a.table_name}{' '}
                        · <code>{a.record_id.slice(0, 8)}</code>
                      </p>
                      <small>
                        {a.changed_fields
                          .map(
                            (f) =>
                              (
                                ({
                                  display_name: 'tên',
                                  note: 'ghi chú',
                                  status: 'trạng thái',
                                  active: 'hoạt động',
                                  booking_status: 'đặt sân',
                                  session_date: 'ngày',
                                  start_time: 'giờ bắt đầu',
                                  end_time: 'giờ kết thúc',
                                  venue: 'tên sân',
                                  court: 'ca/sân',
                                  max_players: 'giới hạn',
                                  deadline: 'hạn đăng ký',
                                  address: 'địa chỉ',
                                  maps_url: 'bản đồ',
                                  organizer_id: 'người phụ trách buổi',
                                  organizer_mode: 'cách phân công',
                                  booked_by_member_id: 'người đã đặt thực tế',
                                  estimated_cost: 'tiền sân dự kiến',
                                  booking_contact_note: 'liên hệ đặt sân',
                                  deposit_note: 'ghi chú đặt cọc',
                                }) as Record<string, string>
                              )[f],
                          )
                          .filter(Boolean)
                          .join(', ')}
                      </small>
                    </div>
                    <time>
                      {new Date(a.created_at).toLocaleString('vi-VN', {
                        timeZone: 'Asia/Ho_Chi_Minh',
                      })}
                    </time>
                  </div>
                ))}
                {!club.audits.length && (
                  <div className="empty-state">
                    <p>Chưa có thay đổi nào.</p>
                  </div>
                )}
              </div>
            ) : (
              <AccessPrompt onLogin={() => setModal({ type: 'login' })} />
            )}
          </section>
        )}
      </main>
      <footer>
        <a
          className="footer-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('schedule');
          }}
        >
          <img src="/shuttle.svg" alt="" />
          Cầu lông và những người bạn
        </a>
        <span>
          Chung đam mê. Bền tình bạn. <span className="footer-dot">●</span>
        </span>
      </footer>
      {club.notice && (
        <div
          className={`toast ${club.saveState === 'failed' ? 'toast-error' : ''}`}
          role={club.saveState === 'failed' ? 'alert' : 'status'}
        >
          {club.saveState === 'failed' ? (
            <Info size={20} />
          ) : (
            <CircleCheck size={20} />
          )}
          <span>{club.notice}</span>
          <button
            className="icon-btn"
            aria-label="Đóng thông báo"
            onClick={() => club.setNotice('')}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={
            modal.type === 'choose'
              ? 'Bạn là ai trong nhóm?'
              : modal.type === 'verify-booking'
                ? 'Xác minh quyền đặt sân'
                : modal.type === 'booking-session'
                  ? 'Cập nhật thông tin đặt sân'
                  : modal.type === 'login'
                    ? 'Đăng nhập quản trị'
                    : modal.type === 'member'
                      ? modal.member
                        ? 'Chỉnh sửa thành viên'
                        : 'Thêm người bạn mới'
                      : modal.type === 'session'
                        ? modal.session
                          ? 'Chỉnh sửa buổi đánh'
                          : 'Lên lịch buổi đánh'
                        : modal.type === 'attendance'
                          ? 'Cùng nhau lên sân'
                          : modal.type === 'link'
                            ? 'Liên kết tài khoản'
                            : 'Ghi chú tham gia'
          }
          wide={
            modal.type === 'attendance' ||
            modal.type === 'session' ||
            modal.type === 'booking-session'
          }
          onClose={() => setModal(null)}
          locked={club.saveState === 'saving'}
        >
          {modal.type === 'choose' && (
            <>
              <MemberPicker
                club={club}
                onDone={() => {
                  setModal(null);
                  requestAnimationFrame(() =>
                    scrollToClubSection('next-registration', 'center'),
                  );
                }}
              />
              {!isAdmin && (
                <button
                  className="text-btn full"
                  onClick={() => setModal({ type: 'login' })}
                >
                  <ShieldCheck size={15} />
                  Đăng nhập quản trị
                </button>
              )}
            </>
          )}
          {modal.type === 'login' && <LoginForm />}
          {modal.type === 'verify-booking' && (
            <BookingIdentityForm club={club} close={() => setModal(null)} />
          )}
          {modal.type === 'booking-session' && (
            <BookingSessionEditor
              session={modal.session}
              club={club}
              close={() => setModal(null)}
            />
          )}
          {(modal.type === 'booking-session' ||
            modal.type === 'verify-booking' ||
            modal.type === 'session') && <BookingWriteState club={club} />}
          {modal.type === 'member' && isAdmin && (
            <MemberForm
              member={modal.member}
              club={club}
              close={() => setModal(null)}
            />
          )}
          {modal.type === 'session' && isAdmin && (
            <SessionForm
              session={modal.session}
              club={club}
              defaultDate={day ?? dateKey(week === 0 ? vietnamToday() : start)}
              close={() => setModal(null)}
            />
          )}
          {modal.type === 'attendance' && (
            <AttendancePanel
              session={
                club.sessions.find((s) => s.id === modal.session.id) ??
                modal.session
              }
              club={club}
              onLogin={() =>
                setModal({ type: club.quickReady ? 'choose' : 'login' })
              }
              onBookingEdit={() =>
                setModal({
                  type: 'booking-session',
                  session:
                    club.sessions.find((s) => s.id === modal.session.id) ??
                    modal.session,
                })
              }
              onNote={(member, row) =>
                setModal({ type: 'note', session: modal.session, member, row })
              }
            />
          )}
          {modal.type === 'note' && (
            <NoteForm
              session={modal.session}
              member={modal.member}
              row={modal.row}
              club={club}
              close={() =>
                setModal({ type: 'attendance', session: modal.session })
              }
            />
          )}
          {modal.type === 'link' && isAdmin && (
            <LinkForm
              member={modal.member}
              club={club}
              close={() => setModal(null)}
            />
          )}
        </Modal>
      )}
    </>
  );
}

function Connection({ club }: { club: Club }) {
  return (
    <span
      className={`connection ${!club.online ? 'offline' : ''}`}
      role="status"
    >
      {club.saveState === 'saving' ? (
        <>
          <LoaderCircle size={14} className="spin" />
          Đang lưu…
        </>
      ) : !club.online ? (
        <>
          <WifiOff size={14} />
          Mất mạng
        </>
      ) : !configured ? (
        <>
          <span className="status-dot amber" />
          Chưa kết nối
        </>
      ) : club.error ? (
        <>
          <Info size={14} />
          Lỗi kết nối dữ liệu
        </>
      ) : club.realtime ? (
        <>
          <Wifi size={14} />
          {club.saveState === 'failed'
            ? 'Lưu thất bại'
            : club.saveState === 'saved'
              ? 'Đã lưu · Trực tuyến'
              : 'Đồng bộ trực tiếp'}
        </>
      ) : (
        <>
          <span className="status-dot amber" />
          Đang kết nối Realtime…
        </>
      )}
    </span>
  );
}
function Badge({ status }: { status: CourtSession['booking_status'] }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {BOOKING_LABELS[status]}
    </span>
  );
}
function AccessPrompt({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <ShieldCheck size={29} />
      </div>
      <h3>Không gian của các thành viên</h3>
      <p>
        Đăng nhập bằng email đã liên kết để xem danh sách và cập nhật đăng ký
        của bạn.
      </p>
      <button className="btn btn-dark" onClick={onLogin}>
        Đăng nhập <ArrowRight size={16} />
      </button>
    </div>
  );
}

function SessionCard({
  session: s,
  club,
  onOpen,
  onEdit,
  onChoose,
}: {
  session: CourtSession;
  club: Club;
  onOpen: () => void;
  onEdit: () => void;
  onChoose: () => void;
}) {
  const own = club.attendance.find(
    (a) => a.session_id === s.id && a.member_id === club.memberId,
  );
  const count =
    club.quickReady || club.account
      ? summary(s, club.roster, club.attendance).going
      : (s.going_count ?? 0);
  return (
    <article
      className={`session-card ${s.booking_status === 'cancelled' ? 'cancelled' : ''}`}
    >
      <div className="session-top">
        <span className="session-day">{formatDate(s.session_date)}</span>
        <Badge status={s.booking_status} />
      </div>
      <div className="session-time">
        <Clock3 size={20} />
        <strong>
          {shortTime(s.start_time)} <span>–</span> {shortTime(s.end_time)}
        </strong>
        {(club.account?.role === 'admin' ||
          (club.booking?.verified_member_id === s.organizer_id &&
            !!s.organizer_id &&
            new Date(`${s.session_date}T${s.end_time}+07:00`) >
              new Date())) && (
          <button
            className="icon-btn"
            aria-label={`Sửa ${s.venue} ${s.court}`}
            onClick={onEdit}
          >
            <Edit3 size={16} />
          </button>
        )}
      </div>
      <h3>
        {s.venue} <span>· {s.court}</span>
      </h3>
      <p className="inline muted">
        <MapPin size={15} />
        <span>{s.address || 'Chưa cập nhật địa chỉ'}</span>
      </p>
      {s.maps_url && (
        <a
          className="map-link"
          href={s.maps_url}
          target="_blank"
          rel="noreferrer"
        >
          Xem bản đồ <ArrowUpRight size={13} />
        </a>
      )}
      <SessionResponsibility session={s} compact />
      {s.note && <p className="session-note">{s.note}</p>}
      <div className="session-bottom">
        <div>
          <strong className="inline">
            <Users size={17} />
            {count}
            {s.max_players ? `/${s.max_players}` : ''} người đi
          </strong>
          {own && (
            <small className={`own-status ${own.status}`}>
              Bạn: {STATUS_LABELS[own.status]}
            </small>
          )}
        </div>
        <button className="btn btn-soft" onClick={onOpen}>
          Xem chi tiết
          <ArrowUpRight size={16} />
        </button>
      </div>
      {club.quickReady && (
        <QuickRegistration
          session={s}
          club={club}
          compact
          onChoose={onChoose}
        />
      )}
    </article>
  );
}

function LoginForm() {
  const [email, setEmail] = useState(''),
    [sent, setSent] = useState(false),
    [token, setToken] = useState('');
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [verified, setVerified] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !navigator.onLine) return;
    setSaving(true);
    setError('');
    try {
      if (!sent) {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setSent(true);
      } else {
        const { error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: token.trim(),
          type: 'email',
        });
        if (error) throw error;
        setVerified(true);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }
  return verified ? (
    <div className="empty-state">
      <CircleCheck size={35} />
      <h3>Đăng nhập thành công</h3>
      <p>Đóng cửa sổ này để tiếp tục.</p>
    </div>
  ) : (
    <form onSubmit={(e) => void submit(e)}>
      <div className="login-art">
        <img src="/shuttle.svg" alt="" />
        <span>Một email. Một chiếc hẹn.</span>
      </div>
      <p className="form-intro">
        Chỉ người quản trị cần đăng nhập email để quản lý lịch và thành viên.
        Thành viên chọn tên trên trang chủ là có thể đăng ký ngay.
      </p>
      {!configured && (
        <div className="alert">
          Chưa thể đăng nhập: cần cấu hình Supabase trước.
        </div>
      )}
      <label className="field">
        Email của bạn
        <input
          type="email"
          autoComplete="email"
          required
          disabled={sent}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ban@example.com"
        />
      </label>
      {sent && (
        <>
          <div className="alert">
            Đã yêu cầu gửi email. Mở liên kết trong email bằng trình duyệt này
            để đăng nhập, hoặc nhập mã nếu email của nhóm có mã OTP. Kiểm tra cả
            thư rác.
          </div>
          <label className="field">
            Mã xác nhận (nếu có)
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              minLength={6}
              maxLength={10}
            />
          </label>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="btn btn-dark full"
        disabled={!configured || saving || !navigator.onLine}
      >
        {saving ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <LogIn size={17} />
        )}
        {sent ? 'Xác nhận mã' : 'Gửi liên kết đăng nhập'}
      </button>
      {sent && (
        <button
          type="button"
          className="text-btn resend"
          disabled={saving}
          onClick={() => {
            setSent(false);
            setToken('');
          }}
        >
          Đổi email / Gửi lại
        </button>
      )}
      <p className="form-help">
        Email chỉ dùng để xác thực, không xuất hiện trong lịch công khai.
      </p>
    </form>
  );
}

function MemberForm({
  member,
  club,
  close,
}: {
  member?: Member;
  club: Club;
  close: () => void;
}) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values = {
      display_name: String(fd.get('display_name')).trim(),
      note: String(fd.get('note')),
      active: fd.get('active') === 'on',
    };
    const patch = Object.fromEntries(
      Object.entries(values).filter(
        ([k, v]) => !member || member[k as keyof typeof values] !== v,
      ),
    );
    if (!Object.keys(patch).length) {
      close();
      return;
    }
    if (
      await club.run(() =>
        rpc('save_member', {
          p_id: member?.id ?? null,
          p_patch: patch,
          p_expected_version: member?.version ?? null,
        }),
      )
    )
      close();
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <p className="form-intro">
        {member
          ? `Mã thành viên ${member.code} không thay đổi khi sửa tên.`
          : 'Mã thành viên duy nhất sẽ được tạo tự động. Thành viên có thể trùng tên.'}
      </p>
      <label className="field">
        Tên hiển thị
        <input
          name="display_name"
          defaultValue={member?.display_name}
          required
          maxLength={80}
        />
      </label>
      <label className="field">
        Ghi chú
        <textarea
          name="note"
          defaultValue={member?.note}
          maxLength={1000}
          rows={3}
          placeholder="Một vài điều về người bạn này…"
        />
      </label>
      <label className="check-label">
        <input
          name="active"
          type="checkbox"
          defaultChecked={member?.active ?? true}
        />
        Đang hoạt động
      </label>
      <p className="form-help">
        Ngừng hoạt động giữ nguyên lịch sử tham gia và ngăn tài khoản cập nhật
        đăng ký.
      </p>
      <div className="form-actions">
        {member && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={club.saveState === 'saving' || !club.online}
            onClick={async () => {
              if (
                window.confirm(
                  `Xóa ${member.display_name} (${member.code})? Chỉ xóa được người chưa có lịch sử và tài khoản.`,
                ) &&
                (await club.run(
                  () =>
                    rpc('delete_member', {
                      p_id: member.id,
                      p_expected_version: member.version,
                    }),
                  'Đã xóa thành viên',
                ))
              )
                close();
            }}
          >
            <Trash2 size={16} />
            Xóa
          </button>
        )}
        <button
          className="btn btn-dark"
          disabled={club.saveState === 'saving' || !club.online}
        >
          <Check size={17} />
          {club.saveState === 'saving' ? 'Đang lưu…' : 'Lưu thành viên'}
        </button>
      </div>
    </form>
  );
}

function SessionForm({
  session: original,
  club,
  defaultDate,
  close,
}: {
  session?: CourtSession;
  club: Club;
  defaultDate: string;
  close: () => void;
}) {
  const [localError, setLocalError] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [organizerMode, setOrganizerMode] = useState<'weekly' | 'override'>(
    original?.organizer_mode ??
      (original?.organizer_id ? 'override' : 'weekly'),
  );
  const [bookingStatus, setBookingStatus] = useState(
    original?.booking_status ?? 'pending',
  );
  const preset = club.templates.find((t) => t.id === templateId);
  const s =
    original ??
    (preset
      ? ({
          ...preset.template,
          session_date: defaultDate,
          booking_status: 'pending',
          deadline: null,
        } as CourtSession)
      : undefined);
  function localDeadline(value?: string | null) {
    if (!value) return '';
    const d = new Date(new Date(value).getTime() + 7 * 3600000);
    return d.toISOString().slice(0, 16);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError('');
    const fd = new FormData(e.currentTarget);
    const templateName = String(
      fd.get('template_name') || `${fd.get('venue')} · ${fd.get('court')}`,
    ).trim();
    fd.delete('template_name');
    if (String(fd.get('end_time')) <= String(fd.get('start_time'))) {
      setLocalError('Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.');
      return;
    }
    const values: Record<string, unknown> = Object.fromEntries(fd.entries());
    values.max_players = fd.get('max_players')
      ? Number(fd.get('max_players'))
      : null;
    values.organizer_id = fd.get('organizer_id') || null;
    if (club.bookingReady) {
      values.organizer_mode = organizerMode;
      if (organizerMode === 'weekly')
        values.organizer_id = original?.organizer_id ?? null;
      values.estimated_cost = fd.get('estimated_cost')
        ? Number(fd.get('estimated_cost'))
        : null;
      if (fd.get('booked_by_member_id'))
        values.booked_by_member_id = fd.get('booked_by_member_id');
      else delete values.booked_by_member_id;
    }
    values.deadline = fd.get('deadline')
      ? new Date(`${fd.get('deadline')}:00+07:00`).toISOString()
      : null;
    values.start_time = `${fd.get('start_time')}:00`;
    values.end_time = `${fd.get('end_time')}:00`;
    if (
      ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value ===
      'template'
    ) {
      const template = Object.fromEntries(
        Object.entries(values).filter(
          ([k]) =>
            ![
              'session_date',
              'booking_status',
              'deadline',
              'booked_by_member_id',
              'deposit_note',
            ].includes(k),
        ),
      );
      await club.run(
        () =>
          rpc('save_session_template', {
            p_name: templateName,
            p_template: template,
          }),
        'Đã lưu mẫu lịch. Lần sau chỉ cần chọn mẫu và ngày đánh.',
      );
      return;
    }
    const patch = Object.fromEntries(
      Object.entries(values).filter(
        ([k, v]) =>
          !original ||
          (original as unknown as Record<string, unknown>)[k] !== v,
      ),
    );
    if (!Object.keys(patch).length) {
      close();
      return;
    }
    if (
      await club.run(
        () =>
          rpc('save_session', {
            p_id: s?.id ?? null,
            p_patch: patch,
            p_expected_version: s?.version ?? null,
          }),
        !s && club.activities?.automatic_fees
          ? 'Đã tạo lịch đánh và bảng phí trống ở mục Tiền sân'
          : 'Đã lưu lịch đánh',
      )
    )
      close();
  }
  return (
    <>
      {!original && !!club.templates.length && (
        <label className="field template-picker">
          Điền nhanh từ mẫu
          <select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const template = club.templates.find(
                (t) => t.id === e.target.value,
              )?.template;
              setOrganizerMode(
                template?.organizer_mode ??
                  (template?.organizer_id ? 'override' : 'weekly'),
              );
              setBookingStatus('pending');
            }}
          >
            <option value="">Nhập lịch mới</option>
            {club.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <form key={templateId} onSubmit={(e) => void submit(e)}>
        <p className="form-intro">
          Mỗi ca / sân là một mục đăng ký riêng. Nếu có hai ca hoặc hai sân, hãy
          tạo hai mục cùng ngày. Tất cả giờ dưới đây là giờ Việt Nam (UTC+7).
        </p>
        <div className="form-grid">
          <label className="field">
            Ngày đánh
            <input
              name="session_date"
              type="date"
              required
              defaultValue={s?.session_date ?? defaultDate}
            />
          </label>
          <label className="field">
            Trạng thái đặt sân
            <select
              name="booking_status"
              value={bookingStatus}
              onChange={(e) =>
                setBookingStatus(e.target.value as typeof bookingStatus)
              }
            >
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
              defaultValue={s ? shortTime(s.start_time) : '18:00'}
            />
          </label>
          <label className="field">
            Giờ kết thúc
            <input
              name="end_time"
              type="time"
              required
              defaultValue={s ? shortTime(s.end_time) : '20:00'}
            />
          </label>
          <label className="field">
            Tên sân
            <input
              name="venue"
              required
              maxLength={160}
              defaultValue={s?.venue}
              placeholder="Tên nhà thi đấu / cụm sân"
            />
          </label>
          <label className="field">
            Ca / số sân
            <input
              name="court"
              required
              maxLength={80}
              defaultValue={s?.court}
              placeholder="Ví dụ: Ca 1 · Sân 3"
            />
          </label>
          <label className="field span-2">
            Địa chỉ
            <input name="address" maxLength={500} defaultValue={s?.address} />
          </label>
          <label className="field span-2">
            Liên kết Google Maps
            <input
              name="maps_url"
              type="url"
              defaultValue={s?.maps_url}
              placeholder="https://maps.app.goo.gl/…"
            />
          </label>
          {club.bookingReady && (
            <label className="field">
              Cách phân công người phụ trách
              <select
                name="organizer_mode"
                value={organizerMode}
                onChange={(e) =>
                  setOrganizerMode(e.target.value as typeof organizerMode)
                }
              >
                <option value="weekly">Kế thừa người phụ trách tuần</option>
                <option value="override">Chỉ định riêng cho buổi này</option>
              </select>
            </label>
          )}
          {(!club.bookingReady || organizerMode === 'override') && (
            <label className="field">
              Người phụ trách đặt sân
              <select
                name="organizer_id"
                required={club.bookingReady && organizerMode === 'override'}
                defaultValue={s?.organizer_id ?? ''}
              >
                <option value="">Chưa phân công</option>
                {club.members
                  .filter((m) => m.active || m.id === s?.organizer_id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name} · {m.code}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="field">
            Số người tối đa (tùy chọn)
            <input
              name="max_players"
              type="number"
              min={1}
              max={200}
              defaultValue={s?.max_players ?? ''}
              placeholder="Không giới hạn"
            />
          </label>
          <label className="field span-2">
            Hạn đăng ký (tùy chọn, giờ Việt Nam)
            <input
              name="deadline"
              type="datetime-local"
              defaultValue={localDeadline(s?.deadline)}
            />
          </label>
          <label className="field span-2">
            Ghi chú buổi đánh
            <textarea
              name="note"
              rows={2}
              maxLength={2000}
              defaultValue={s?.note}
              placeholder="Mang cầu, giờ có mặt, lưu ý…"
            />
          </label>
          {club.bookingReady && (
            <>
              <label className="field span-2">
                Tiền sân dự kiến (đồng)
                <input
                  name="estimated_cost"
                  type="number"
                  min={0}
                  max={999999999999}
                  step={1000}
                  defaultValue={s?.estimated_cost ?? ''}
                  placeholder="Chưa có dự kiến"
                />
              </label>
              <label className="field span-2">
                Ghi chú liên hệ đặt sân
                <textarea
                  name="booking_contact_note"
                  rows={2}
                  maxLength={2000}
                  defaultValue={s?.booking_contact_note ?? ''}
                />
              </label>
              <label className="field span-2">
                Ghi chú đặt cọc
                <textarea
                  name="deposit_note"
                  rows={2}
                  maxLength={2000}
                  defaultValue={s?.deposit_note ?? ''}
                />
              </label>
              {s?.booked_by_member_id && (
                <p className="form-help span-2">
                  Người đã đặt sân thực tế:{' '}
                  {s.booked_by_name ||
                    club.members.find((m) => m.id === s.booked_by_member_id)
                      ?.display_name}
                  . Thông tin này được giữ khi đổi người phụ trách.
                </p>
              )}
              {bookingStatus === 'booked' && !s?.booked_by_member_id && (
                <label className="field span-2">
                  Người đã đặt sân thực tế
                  <select name="booked_by_member_id" defaultValue="">
                    <option value="">Người phụ trách buổi này</option>
                    {club.members
                      .filter((m) => m.active)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name} · {m.code}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </>
          )}
        </div>
        {club.quickReady && (
          <label className="field">
            Tên mẫu (nếu muốn dùng lại)
            <input
              name="template_name"
              maxLength={100}
              placeholder="Ví dụ: Thứ Ba · Sân 3"
              defaultValue={preset?.name}
            />
          </label>
        )}
        <p className="form-help">
          Website ghi nhận tình trạng do người phụ trách cập nhật. Hãy liên hệ
          chủ sân để đặt sân thực tế.
        </p>
        {localError && (
          <p className="form-error" role="alert">
            {localError}
          </p>
        )}
        <div className="form-actions">
          {s?.id && s.booking_status !== 'cancelled' && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={club.saveState === 'saving' || !club.online}
              onClick={async () => {
                if (
                  window.confirm(
                    'Hủy buổi đánh này? Các đăng ký cũ được giữ lại, ngừng nhận thay đổi mới.',
                  ) &&
                  (await club.run(
                    () =>
                      rpc('save_session', {
                        p_id: s.id,
                        p_patch: { booking_status: 'cancelled' },
                        p_expected_version: s.version,
                      }),
                    'Đã hủy buổi đánh',
                  ))
                )
                  close();
              }}
            >
              Hủy buổi đánh
            </button>
          )}
          {club.quickReady && (
            <button
              className="btn btn-soft"
              type="submit"
              value="template"
              disabled={club.saveState === 'saving' || !club.online}
            >
              <Copy size={16} />
              Lưu thành mẫu
            </button>
          )}
          <button
            className="btn btn-dark"
            disabled={club.saveState === 'saving' || !club.online}
          >
            <Check size={17} />
            {club.saveState === 'saving' ? 'Đang lưu…' : 'Lưu buổi đánh'}
          </button>
        </div>
      </form>
    </>
  );
}

function AttendancePanel({
  session: s,
  club,
  onLogin,
  onNote,
  onBookingEdit,
}: {
  session: CourtSession;
  club: Club;
  onLogin: () => void;
  onNote: (member: Member, row?: Attendance) => void;
  onBookingEdit: () => void;
}) {
  const [filter, setFilter] = useState<AttendanceStatus | 'all'>('all');
  const counts = summary(s, club.roster, club.attendance);
  const expired =
    new Date(`${s.session_date}T${s.end_time}+07:00`) <= new Date();
  const deadline = !!s.deadline && new Date(s.deadline) <= new Date();
  const locked =
    s.booking_status === 'cancelled' ||
    expired ||
    (deadline && club.account?.role !== 'admin');
  const members = club.members
    .filter(
      (m) =>
        club.roster.some(
          (r) => r.session_id === s.id && r.member_id === m.id,
        ) ||
        club.attendance.some(
          (a) => a.session_id === s.id && a.member_id === m.id,
        ),
    )
    .sort(
      (a, b) => Number(b.id === club.memberId) - Number(a.id === club.memberId),
    );
  return (
    <>
      <div className="attendance-intro">
        <h3>
          {s.venue} · {s.court}
        </h3>
        <p>
          {formatDate(s.session_date)} · {shortTime(s.start_time)} –{' '}
          {shortTime(s.end_time)} (giờ Việt Nam)
        </p>
        <Badge status={s.booking_status} />
        {s.deadline && (
          <p className="form-help">
            Hạn đăng ký:{' '}
            {new Date(s.deadline).toLocaleString('vi-VN', {
              timeZone: 'Asia/Ho_Chi_Minh',
            })}
          </p>
        )}
      </div>
      {locked && (
        <div className="alert danger">
          {s.booking_status === 'cancelled'
            ? 'Buổi đánh đã hủy. Tất cả thao tác đăng ký đã đóng.'
            : expired
              ? 'Buổi đánh đã kết thúc. Lịch sử tham gia được giữ nguyên.'
              : 'Đã hết hạn đăng ký. Liên hệ quản trị viên nếu cần thay đổi.'}
        </div>
      )}
      {!club.quickReady && !club.account ? (
        <AccessPrompt onLogin={onLogin} />
      ) : (
        <>
          {club.quickReady && (
            <QuickRegistration session={s} club={club} onChoose={onLogin} />
          )}
          <SessionResponsibility session={s} />
          {club.bookingReady &&
            (club.account?.role === 'admin' ||
              (!!s.organizer_id &&
                club.booking?.verified_member_id === s.organizer_id)) && (
              <button
                className="btn btn-soft"
                disabled={!club.online || club.saveState === 'saving'}
                onClick={onBookingEdit}
              >
                <Edit3 size={15} />
                Cập nhật đặt sân
              </button>
            )}
          <div className="attendance-stats">
            <div className="stat-going">
              <strong>{counts.going}</strong>
              <span>Đi{s.max_players ? ` / tối đa ${s.max_players}` : ''}</span>
            </div>
            <div>
              <strong>{counts.no}</strong>
              <span>Không đi</span>
            </div>
            <div>
              <strong>{counts.unanswered}</strong>
              <span>Chưa phản hồi</span>
            </div>
          </div>
          <div className="filter-row">
            {(['all', 'going', 'not_going', 'unanswered'] as const).map((v) => (
              <button
                key={v}
                className={filter === v ? 'selected' : ''}
                onClick={() => setFilter(v)}
              >
                {v === 'all' ? 'Tất cả' : STATUS_LABELS[v]}
              </button>
            ))}
          </div>
          <div className="attendance-table">
            <div className="attendance-header">
              <span>Thành viên</span>
              <span>Xác nhận tham gia</span>
              <span>Ghi chú / Cập nhật</span>
            </div>
            {members
              .filter(
                (m) =>
                  filter === 'all' ||
                  (club.attendance.find(
                    (a) => a.session_id === s.id && a.member_id === m.id,
                  )?.status ?? 'unanswered') === filter,
              )
              .map((m) => {
                const row = club.attendance.find(
                    (a) => a.session_id === s.id && a.member_id === m.id,
                  ),
                  status = row?.status ?? 'unanswered';
                const canEdit =
                  !locked &&
                  m.active &&
                  (club.account?.role === 'admin' || club.memberId === m.id);
                return (
                  <div className="attendance-row" key={m.id}>
                    <div className="attendee">
                      <span className="avatar">
                        {m.display_name.split(' ').at(-1)?.slice(0, 1)}
                      </span>
                      <div>
                        <strong>
                          {m.display_name}
                          {club.memberId === m.id && <small> (Bạn)</small>}
                        </strong>
                        <CSBadge session={s} memberId={m.id} />
                        <span>
                          {m.code}
                          {!m.active && ' · Ngừng hoạt động'}
                        </span>
                      </div>
                    </div>
                    <div className="status-buttons">
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <button
                          key={k}
                          disabled={
                            !canEdit ||
                            !club.online ||
                            club.saveState === 'saving'
                          }
                          className={`${k} ${status === k ? 'selected' : ''}`}
                          aria-pressed={status === k}
                          onClick={() =>
                            void club.saveAttendance(
                              registrationArgs(s.id, m.id, 'status', k),
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
                        className={
                          row?.note ? 'note-content' : 'note-placeholder'
                        }
                        disabled={
                          !canEdit ||
                          !club.online ||
                          club.saveState === 'saving'
                        }
                        onClick={() => onNote(m, row)}
                      >
                        {row?.note ||
                          (canEdit ? '+ Thêm ghi chú' : 'Chưa có ghi chú')}
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
              })}
          </div>
          <p className="form-help">
            {club.account?.role === 'admin'
              ? 'Bạn là quản trị viên, có thể cập nhật thay thành viên. Mọi thay đổi được ghi lại.'
              : 'Bạn đang thao tác theo tên đã chọn. Đổi tên ở góc trên nếu cần.'}{' '}
            Người chưa xác nhận luôn được tính là Chưa phản hồi.
          </p>
        </>
      )}
    </>
  );
}

function NoteForm({
  session,
  member,
  club,
  close,
}: {
  session: CourtSession;
  member: Member;
  row?: Attendance;
  club: Club;
  close: () => void;
}) {
  const current = club.sessions.find((s) => s.id === session.id) ?? session;
  const latest = club.attendance.find(
    (a) => a.session_id === session.id && a.member_id === member.id,
  );
  const closed = registrationClosed(current, club.account?.role === 'admin');
  return (
    <div>
      <p className="form-intro">
        {member.display_name} · {member.code} · {session.court}
      </p>
      {closed && <div className="alert">{closed}</div>}
      <AutoNote
        session={current}
        memberId={member.id}
        row={latest}
        club={club}
        disabled={!club.online || !!closed}
      />
      <div className="form-actions">
        <button className="btn btn-soft" onClick={close}>
          Quay lại danh sách
        </button>
      </div>
    </div>
  );
}

function LinkForm({
  member,
  club,
  close,
}: {
  member: Member;
  club: Club;
  close: () => void;
}) {
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (
          await club.run(
            () =>
              rpc('link_account', {
                p_email: fd.get('email'),
                p_member_id: member.id,
              }),
            'Đã liên kết tài khoản với thành viên',
          )
        )
          close();
      }}
    >
      <p className="form-intro">
        Liên kết email đã xác minh với{' '}
        <strong>
          {member.display_name} ({member.code})
        </strong>
        . Thành viên cần đăng nhập email một lần trước bước này.
      </p>
      <label className="field">
        Email đăng nhập
        <input
          name="email"
          type="email"
          required
          placeholder="Email do thành viên cung cấp"
        />
      </label>
      <div className="alert">
        <ShieldCheck size={18} />
        Kiểm tra đúng người trước khi liên kết. Mỗi tài khoản chỉ đại diện cho
        một thành viên.
      </div>
      <button
        className="btn btn-dark full"
        disabled={!club.online || club.saveState === 'saving'}
      >
        Xác nhận liên kết <ArrowRight size={17} />
      </button>
    </form>
  );
}
