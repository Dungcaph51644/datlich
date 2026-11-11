import React, { useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  CalendarDays,
  Check,
  CheckCheck,
  ClipboardList,
  Copy,
  Download,
  Edit3,
  History,
  Info,
  MapPin,
  Mountain,
  Plus,
  Receipt,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { Modal } from './Modal';
import { BookingIdentityForm, BookingWriteState } from './BookingFeatures';
import { TripCoverPicker } from './TripCoverPicker';
import { bookingTime, currency, memberName } from './bookingUtils';
import { dateKey, formatDate, vietnamToday } from './lib';
import { STATUS_LABELS } from './types';
import { useAppRoute } from './navigation';
import { copyText, downloadText } from './userActions';
import { activityFinancialPeople, buildActivityCsv, buildActivityMessage } from './financeExport';
import type { useClub } from './useClub';
import {
  CHECK_STATUS,
  EXPENSE_CATEGORIES,
  LEDGER_KIND,
  PAYMENT_STATUS,
  TRIP_STATUS,
  netPaid,
  paymentStatus,
  type ActivityExpense,
  type ActivityKind,
  type ClubActivity,
  type LedgerEntry,
  type TripChecklist,
  type TripParticipant,
} from './activityTypes';

type Club = ReturnType<typeof useClub>;
type Action = {
  type:
    | 'create'
    | 'settings'
    | 'expense'
    | 'roster'
    | 'fee'
    | 'payment'
    | 'participant'
    | 'checklist'
    | 'verify';
  expense?: ActivityExpense;
  entry?: LedgerEntry;
  personId?: string;
  participant?: TripParticipant;
  item?: TripChecklist;
  preset?: 'court' | 'shuttle';
  paymentKind?: LedgerEntry['kind'];
};
const activeExpenses = (a: ClubActivity) =>
  (a.expenses ?? []).filter((e) => !e.voided_at);
const busy = (club: Club) => !club.online || club.saveState === 'saving';
function MemberOptions({
  club,
  empty = 'Chọn thành viên',
}: {
  club: Club;
  empty?: string;
}) {
  return (
    <>
      <option value="">{empty}</option>
      {club.members
        .filter((m) => m.active)
        .map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name} · {m.code}
          </option>
        ))}
    </>
  );
}
function Money({
  name,
  label,
  value = 0,
  required = true,
  minimum = 0,
}: {
  name: string;
  label: string;
  value?: number;
  required?: boolean;
  minimum?: number;
}) {
  return (
    <label className="field">
      <span>{label} (đ)</span>
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min={minimum}
        max="100000000000"
        step="1"
        defaultValue={value}
        required={required}
      />
    </label>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="activity-empty">
      <ClipboardList size={30} />
      <p>{children}</p>
    </div>
  );
}
function SaveFooter({
  club,
  label = 'Lưu thay đổi',
  disabled = false,
}: {
  club: Club;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <BookingWriteState club={club} />
      <div className="form-actions">
        <button
          className="btn primary"
          disabled={busy(club) || disabled}
          type="submit"
        >
          <Check size={16} />
          {club.saveState === 'saving' ? 'Đang lưu…' : label}
        </button>
      </div>
    </>
  );
}
function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}
const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const num = (f: FormData, k: string) => Number(f.get(k) ?? 0);

export function ActivitiesPage({
  club,
  kind,
}: {
  club: Club;
  kind: ActivityKind;
}) {
  const [route, navigateRoute] = useAppRoute();
  const page = kind === 'trip' ? 'travel' : 'finance';
  const selected = route.page === page ? route.activity : undefined;
  const setSelected = (id: string | null) =>
    navigateRoute({ page, activity: id ?? undefined });
  const [action, setAction] = useState<Action | null>(null);
  const isAdmin = club.account?.role === 'admin';
  const verified = club.booking?.verified_member_id;
  const activities = (club.activities?.activities ?? []).filter(
    (a) => a.kind === kind,
  );
  const activity = activities.find((a) => a.id === selected);
  const canCreate =
    isAdmin ||
    (kind === 'badminton' &&
      !!verified &&
      club.sessions.some((s) => s.organizer_id === verified));
  return (
    <section className={`activities-page ${kind}`}>
      <div className="activity-page-heading">
        <div>
          <span className="section-eyebrow">
            {kind === 'trip'
              ? 'NHỮNG CHUYẾN ĐI CÙNG NHAU'
              : 'MINH BẠCH TỪNG BUỔI ĐÁNH'}
          </span>
          <h1>
            {kind === 'trip' ? 'Du lịch & sự kiện' : 'Tiền sân & thanh toán'}
            <span className="lime-dot">.</span>
          </h1>
          <p>
            {kind === 'trip'
              ? 'Lên kế hoạch, chuẩn bị và chia sẻ những khoảnh khắc.'
              : 'Rõ khoản chi, đúng người chia, dễ theo dõi tiền đã thu.'}
          </p>
        </div>
        {club.activities && canCreate && (
          <button
            className="btn primary"
            disabled={busy(club)}
            onClick={() => setAction({ type: 'create' })}
          >
            <Plus size={17} />
            {kind === 'trip'
              ? 'Tạo chuyến đi'
              : club.activities?.automatic_fees
                ? 'Gộp ca / sân'
                : 'Tạo bảng phí'}
          </button>
        )}
      </div>
      {club.activityError && (
        <div className="alert danger">
          Không tải được dữ liệu tài chính mới nhất: {club.activityError}
          <button className="text-btn" onClick={() => void club.reload()}>
            Thử lại
          </button>
        </div>
      )}
      {!club.activities ? (
        <div className="activity-setup">
          <Wallet size={32} />
          <h2>
            {club.loading ? 'Đang lấy dữ liệu…' : 'Cần cập nhật cơ sở dữ liệu'}
          </h2>
          <p>
            Chạy migration tài chính & du lịch trong Supabase SQL Editor, sau đó
            bấm tải lại. Chưa có dữ liệu tiền được lưu hoặc đồng bộ cho phần
            này.
          </p>
          <code>202611100003_finance_travel.sql</code>
          <button className="btn" onClick={() => void club.reload()}>
            Tải lại dữ liệu
          </button>
        </div>
      ) : (
        <>
          {!verified && (
            <div className="alert">
              <ShieldCheck size={20} />
              <div>
                <strong>Xác minh một lần bằng mã cá nhân</strong>
                <span>
                  Để xem chi tiết tài chính, đăng ký du lịch và thao tác theo
                  quyền được giao. Việc chọn tên đánh cầu chưa cấp quyền tài
                  chính.
                </span>
              </div>
              <button
                className="btn primary"
                onClick={() => setAction({ type: 'verify' })}
              >
                Nhập mã cá nhân
              </button>
            </div>
          )}
          {activity ? (
            <>
              <button
                className="text-btn activity-back"
                onClick={() => setSelected(null)}
              >
                <ArrowLeft size={16} />
                Tất cả {kind === 'trip' ? 'chuyến đi' : 'bảng phí'}
              </button>
              <ActivityDetail
                club={club}
                activity={activity}
                onAction={setAction}
              />
            </>
          ) : (
            <>
              {kind === 'badminton' && (
                <div className="activity-intro">
                  <Receipt size={28} />
                  <div>
                    <strong>Một buổi, một bảng phí</strong>
                    <p>
                      {club.activities?.automatic_fees
                        ? 'Tạo lịch đánh là có bảng phí trống tại đây. Khi cần chia chung nhiều ca/sân, gộp các bảng tự tạo chưa chỉnh sửa và chưa có chi phí.'
                        : 'Chọn đúng các ca hoặc sân cùng buổi. Mỗi nhóm chia tiền sân riêng; khoản chung chia theo người duy nhất.'}
                    </p>
                  </div>
                </div>
              )}
              {activities.length === 0 ? (
                <Empty>
                  {kind === 'trip'
                    ? 'Chuyến đi mới đang chờ nhóm mình lên ý tưởng. Quản trị viên có thể tạo chuyến đầu tiên.'
                    : club.activities?.automatic_fees
                      ? 'Lịch đánh mới sẽ tự xuất hiện tại đây với bảng phí trống. Các lịch cũ vẫn có thể tạo bảng phí thủ công.'
                      : 'Chưa có bảng phí. Người phụ trách hoặc quản trị viên tạo từ các ca/sân đã có.'}
                </Empty>
              ) : (
                <div className="activity-grid">
                  {activities.map((a) => (
                    <button
                      className="activity-card"
                      key={a.id}
                      onClick={() => setSelected(a.id)}
                    >
                      {kind === 'trip' && (
                        <div
                          className={`trip-cover ${a.details.cover_url ? 'has-image' : ''}`}
                        >
                          {a.details.cover_url ? (
                            <img
                              src={a.details.cover_url}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : (
                            <Mountain size={74} />
                          )}
                          <span>{TRIP_STATUS[a.status]}</span>
                        </div>
                      )}
                      <div className="activity-card-body">
                        <div className="activity-card-top">
                          <span>
                            {kind === 'trip'
                              ? 'CHUYẾN ĐI CỦA NHÓM'
                              : 'BẢNG PHÍ CẦU LÔNG'}
                          </span>
                          <ArrowRight size={19} />
                        </div>
                        <h2>{a.title}</h2>
                        <p>
                          {kind === 'trip'
                            ? a.details.location || 'Đang chọn địa điểm'
                            : (a.groups ?? [])
                                .map((g) => g.label)
                                .join(' · ') || 'Xác minh để xem chi tiết'}
                        </p>
                        <div className="activity-card-bottom">
                          <span className={`fee-badge ${a.fee_status}`}>
                            {a.fee_status === 'finalized'
                              ? 'Đã chốt phí'
                              : 'Tạm tính'}
                          </span>
                          <strong>
                            {a.calculation
                              ? currency(a.calculation.total_cost)
                              : a.details.start_date
                                ? formatDate(a.details.start_date)
                                : 'Xem thông tin'}
                          </strong>
                        </div>
                        {a.calculation && (
                          <small>
                            {a.calculation.headcount} người chịu phí
                            {kind === 'trip'
                              ? ` · ${a.calculation.shares} suất`
                              : ''}
                          </small>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      {action && (
        <Modal
          wide={action.type !== 'verify' && action.type !== 'fee'}
          locked={club.saveState === 'saving'}
          title={
            {
              create:
                kind === 'trip'
                  ? 'Tạo chuyến đi'
                  : club.activities?.automatic_fees
                    ? 'Gộp ca / sân vào một bảng phí'
                    : 'Tạo bảng phí cầu lông',
              settings: 'Thông tin & thiết lập',
              expense: action.expense ? 'Sửa khoản chi' : 'Thêm khoản chi',
              roster: 'Xác nhận người thực tế chịu phí',
              fee:
                activity?.fee_status === 'finalized'
                  ? 'Mở lại bảng phí'
                  : 'Chốt bảng phí',
              payment: action.entry
                ? 'Điều chỉnh khoản thu'
                : 'Ghi nhận thu / hoàn tiền',
              participant: action.participant
                ? 'Sửa đăng ký'
                : 'Thêm người tham gia',
              checklist: 'Danh sách chuẩn bị',
              verify: 'Xác minh cá nhân',
            }[action.type]
          }
          onClose={() => setAction(null)}
        >
          {action.type === 'verify' ? (
            <BookingIdentityForm club={club} close={() => setAction(null)} />
          ) : action.type === 'create' ? (
            <ActivityForm
              club={club}
              kind={kind}
              close={(id) => {
                setAction(null);
                if (id) setSelected(id);
              }}
            />
          ) : (
            activity && (
              <>
                {action.type === 'settings' && (
                  <ActivityForm
                    club={club}
                    kind={kind}
                    activity={activity}
                    close={() => setAction(null)}
                  />
                )}
                {action.type === 'expense' && (
                  <ExpenseForm
                    club={club}
                    activity={activity}
                    original={action.expense}
                    preset={action.preset}
                    close={() => setAction(null)}
                  />
                )}
                {action.type === 'roster' && (
                  <BillableRoster club={club} activity={activity} />
                )}
                {action.type === 'fee' && (
                  <FeeStateForm
                    club={club}
                    activity={activity}
                    close={() => setAction(null)}
                  />
                )}
                {action.type === 'payment' && (
                  <PaymentForm
                    club={club}
                    activity={activity}
                    personId={action.personId}
                    initialKind={action.paymentKind}
                    original={action.entry}
                    close={() => setAction(null)}
                  />
                )}
                {action.type === 'participant' && (
                  <ParticipantForm
                    club={club}
                    activity={activity}
                    original={action.participant}
                    close={() => setAction(null)}
                  />
                )}
                {action.type === 'checklist' && (
                  <ChecklistForm
                    club={club}
                    activity={activity}
                    original={action.item}
                    close={() => setAction(null)}
                  />
                )}
              </>
            )
          )}
        </Modal>
      )}
    </section>
  );
}

export function ActivityDetail({
  club,
  activity: a,
  onAction,
}: {
  club: Club;
  activity: ClubActivity;
  onAction: (a: Action) => void;
}) {
  const [tab, setTab] = useState('fees');
  const [exportNotice, setExportNotice] = useState('');
  const calc = a.calculation,
    trip = a.kind === 'trip',
    manager = !!a.can_manage;
  const groups = a.groups ?? [],
    entries = a.ledger ?? [],
    expenses = activeExpenses(a);
  const people = calc?.people ?? [];
  const payers = people.filter((p) => p.due > 0);
  const enough = payers.filter((p) => netPaid(entries, p.id) >= p.due).length;
  const net = entries
    .filter((e) => !e.voided_at && e.kind !== 'reimbursement')
    .reduce((n, e) => n + (e.kind === 'refund' ? -e.amount : e.amount), 0);
  const missing = people.reduce(
    (n, p) => n + Math.max(0, p.due - netPaid(entries, p.id)),
    0,
  );
  const returned = entries
    .filter((e) => !e.voided_at && e.kind === 'reimbursement')
    .reduce((n, e) => n + e.amount, 0);
  const advanced = expenses
    .filter((e) => e.paid_from === 'personal')
    .reduce((n, e) => n + e.actual, 0);
  const cash =
    net -
    returned -
    expenses
      .filter((e) => e.paid_from === 'fund')
      .reduce((n, e) => n + e.actual, 0);
  const owner = a.organizer_id
    ? memberName(club.members, a.organizer_id)
    : [
        ...new Set(
          groups.map(
            (g) =>
              club.sessions.find((s) => s.id === g.session_id)
                ?.organizer_name ||
              memberName(
                club.members,
                club.sessions.find((s) => s.id === g.session_id)?.organizer_id,
              ),
          ),
        ),
      ].join(', ');
  function shareUrl() {
    const url = new URL(window.location.href);
    url.hash = `${trip ? 'travel' : 'finance'}?${new URLSearchParams({ activity: a.id })}`;
    return url.toString();
  }
  return (
    <div className="activity-detail">
      {trip && a.details.cover_url && (
        <img
          className="trip-detail-cover"
          src={a.details.cover_url}
          alt="Ảnh bìa chuyến đi"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      <div className="activity-detail-heading">
        <div>
          <span className={`fee-badge ${a.fee_status}`}>
            {trip ? TRIP_STATUS[a.status] : 'Cầu lông'} ·{' '}
            {a.fee_status === 'finalized' ? 'Đã chốt phí' : 'Tạm tính'}
          </span>
          <h2>{a.title}</h2>
          <p>
            <BadgeCheck size={15} />
            Phụ trách & thu tiền: {owner || 'Chưa phân công'}
          </p>
        </div>
        {manager && (
          <button
            className="btn"
            onClick={() => onAction({ type: 'settings' })}
          >
            <Edit3 size={15} />
            Thông tin
          </button>
        )}
      </div>
      {calc && (
        <div className="finance-actions" aria-label="Chia sẻ và xuất dữ liệu">
          <button
            className="btn"
            onClick={async () => {
              try {
                await copyText(buildActivityMessage(a, club.members, shareUrl()));
                setExportNotice('Đã sao chép tin nhắn. Bạn có thể dán vào nhóm Zalo.');
              } catch {
                setExportNotice('Chưa sao chép được. Hãy thử lại hoặc dùng Xuất CSV.');
              }
            }}
          >
            <Copy size={15} /> Sao chép tin nhắn nhóm
          </button>
          <button
            className="btn"
            onClick={() => {
              try {
                downloadText(buildActivityCsv(a, club.members), `${trip ? 'chuyen-di' : 'bang-phi'}-${a.id}.csv`);
                setExportNotice('Đã tạo tệp CSV từ dữ liệu đang hiển thị.');
              } catch {
                setExportNotice('Chưa xuất được tệp CSV. Hãy thử lại.');
              }
            }}
          >
            <Download size={15} /> Xuất CSV
          </button>
        </div>
      )}
      {exportNotice && <p role="status" className="form-help">{exportNotice}</p>}
      {trip && (
        <div className="trip-information">
          <p className="trip-description">{a.details.description}</p>
          <div className="trip-meta">
            <span>
              <MapPin size={16} />
              {a.details.location || 'Đang chọn địa điểm'}
              {a.details.maps_url && (
                <a href={a.details.maps_url} target="_blank" rel="noreferrer">
                  Mở bản đồ ↗
                </a>
              )}
            </span>
            <span>
              <CalendarDays size={16} />
              {a.details.start_date
                ? formatDate(a.details.start_date)
                : 'Chưa chọn ngày'}
              {a.details.end_date && ` – ${formatDate(a.details.end_date)}`}
            </span>
            <span>
              <Wallet size={16} />
              Ngân sách dự kiến: {currency(a.details.budget_per_person ?? 0)}
              /người
            </span>
          </div>
          {a.details.address && <p>{a.details.address}</p>}
          {a.details.deadline && (
            <small>Hạn xác nhận: {bookingTime(a.details.deadline)}</small>
          )}
          {a.details.note && <p className="activity-note">{a.details.note}</p>}
          {!!a.details.itinerary?.length && (
            <details className="itinerary">
              <summary>Lịch trình từng ngày</summary>
              {a.details.itinerary.map((d, i) => (
                <div key={i}>
                  <strong>{d.day ? formatDate(d.day) : `Ngày ${i + 1}`}</strong>
                  <p>{d.content}</p>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
      {!calc ? (
        <Empty>Xác minh cá nhân để xem chi tiết và đăng ký tham gia.</Empty>
      ) : (
        <>
          {trip && (
            <TripRegistration club={club} activity={a} onAction={onAction} />
          )}
          <div className="finance-stats">
            <Stat
              label="Tổng chi phí thực tế"
              value={currency(calc.total_cost)}
            />
            <Stat
              label={trip ? 'Người / suất chịu phí' : 'Người chịu phí duy nhất'}
              value={
                trip
                  ? `${calc.headcount} / ${calc.shares}`
                  : String(calc.headcount)
              }
            />
            <Stat
              label={`Đã thanh toán đủ: ${enough}/${payers.length} người`}
              value={currency(net)}
            />
            <Stat label="Còn phải thu" value={currency(missing)} accent />
          </div>
          <p className="finance-total-line">
            Tổng phải thu: <strong>{currency(calc.total_due)}</strong> · Đã thu
            ròng: <strong>{currency(net)}</strong>
            {a.kind === 'trip' &&
              ` · Cần hoàn lại tiền đóng: ${currency((a.participants ?? []).reduce((total, p) => total + Math.max(0, netPaid(entries, p.id) - (people.find((x) => x.id === p.id)?.due ?? 0)), 0))}`}
          </p>
          <div
            className="activity-tabs"
            role="tablist"
            aria-label="Chi tiết hoạt động"
          >
            {[
              ['fees', 'Chia tiền', Receipt],
              ['expenses', 'Khoản chi', Wallet],
              ['payments', 'Thu & hoàn', Banknote],
              ...(trip ? [['checklist', 'Chuẩn bị', ClipboardList]] : []),
              ['history', 'Lịch sử', History],
            ].map(([key, label, Icon]) => {
              const I = Icon as typeof Receipt;
              return (
                <button
                  key={String(key)}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(String(key))}
                  className={tab === key ? 'active' : ''}
                >
                  <I size={16} />
                  {String(label)}
                </button>
              );
            })}
          </div>
          {tab === 'fees' && (
            <>
              <div className="finance-toolbar">
                <div>
                  <h3>
                    {a.fee_status === 'finalized'
                      ? 'Bảng phí đã chốt'
                      : 'Bảng phí tạm tính'}
                  </h3>
                  <p>
                    {a.fee_status === 'finalized'
                      ? 'Giữ số tiền và danh sách tại lúc chốt. Đăng ký thay đổi không làm đổi công nợ.'
                      : 'Máy chủ tính lại theo chi phí và người chịu phí mới nhất.'}
                  </p>
                </div>
                {manager && (
                  <div className="finance-actions">
                    {a.fee_status === 'draft' && (
                      <button
                        className="btn"
                        onClick={() => onAction({ type: 'roster' })}
                      >
                        <Users size={15} />
                        Xác nhận người chia
                      </button>
                    )}
                    <button
                      className="btn primary"
                      disabled={busy(club)}
                      onClick={() => onAction({ type: 'fee' })}
                    >
                      {a.fee_status === 'finalized'
                        ? 'Mở lại bảng phí'
                        : 'Chốt tiền'}
                    </button>
                  </div>
                )}
              </div>
              {!!calc.warnings.length && (
                <div className="finance-warnings" role="alert">
                  {calc.warnings.map((w) => (
                    <p key={w}>
                      <Info size={15} />
                      {w}
                    </p>
                  ))}
                </div>
              )}
              {a.rounding === 1000 && (
                <div className="alert">
                  <Info size={18} />
                  <span>
                    Làm tròn lên 1.000đ mỗi người · Khoản thu dư:{' '}
                    <strong>{currency(calc.surplus)}</strong>. Tổng phải thu{' '}
                    {currency(calc.total_due)}.
                  </span>
                </div>
              )}
              {a.cost_note && (
                <p className="activity-note">Ghi chú chi phí: {a.cost_note}</p>
              )}
              <FeePeople club={club} activity={a} onAction={onAction} />
              <details className="fee-formula" open>
                <summary>Công thức & từng khoản được chia</summary>
                <p>
                  Tiền sân từng nhóm ÷ số người trong nhóm + phần khoản chung ÷
                  người duy nhất. Với chuyến đi, dùng số suất chia của từng
                  người.
                </p>
                {calc.breakdown.map((b) => (
                  <div className="formula-line" key={b.expense_id}>
                    <span>
                      {b.name}
                      <small>
                        {b.scope === 'group'
                          ? groups.find((g) => g.id === b.group_id)?.label
                          : b.scope === 'selected'
                            ? 'Những người được chọn'
                            : 'Chung toàn bộ'}{' '}
                        · {b.heads} người
                        {trip ? ` / ${b.units / 1000} suất` : ''}
                      </small>
                    </span>
                    <strong>
                      {currency(b.amount)}
                      {b.units > 0 && ` ÷ ${trip ? b.units / 1000 : b.heads}`}
                    </strong>
                  </div>
                ))}
                <p className="form-help">
                  Chia đến đồng nguyên; phần dư từng khoản lần lượt phân bổ theo
                  ID ổn định. Một người đi nhiều nhóm chỉ có một suất trong
                  khoản chung.
                </p>
                <strong>
                  Tổng phải thu: {currency(calc.total_due)} · Chi phí:{' '}
                  {currency(calc.total_cost)} · Thu dư do làm tròn:{' '}
                  {currency(calc.surplus)}
                </strong>
              </details>
            </>
          )}
          {tab === 'expenses' && (
            <>
              <div className="finance-toolbar">
                <div>
                  <h3>Các khoản chi</h3>
                  <p>
                    {trip
                      ? 'Dự toán và thực tế được theo dõi riêng.'
                      : 'Ghi rõ chi phí thuộc nhóm ca/sân nào.'}
                  </p>
                </div>
                {manager && a.fee_status === 'draft' && (
                  <div className="finance-actions">
                    {!trip && (
                      <>
                        <button
                          className="btn"
                          onClick={() =>
                            onAction({ type: 'expense', preset: 'court' })
                          }
                        >
                          + Tiền sân
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            onAction({ type: 'expense', preset: 'shuttle' })
                          }
                        >
                          + Tiền cầu
                        </button>
                      </>
                    )}
                    <button
                      className="btn primary"
                      onClick={() => onAction({ type: 'expense' })}
                    >
                      <Plus size={15} />
                      Khoản chi
                    </button>
                  </div>
                )}
              </div>
              <div className="cost-comparison">
                <span>
                  Dự toán<strong>{currency(calc.estimated)}</strong>
                </span>
                <span>
                  Thực tế<strong>{currency(calc.total_cost)}</strong>
                </span>
                <span>
                  Chênh lệch
                  <strong>{currency(calc.total_cost - calc.estimated)}</strong>
                </span>
              </div>
              {!expenses.length ? (
                <Empty>Chưa nhập chi phí.</Empty>
              ) : (
                expenses.map((e) => (
                  <div className="expense-row" key={e.id}>
                    <div className="expense-icon">
                      <Receipt size={19} />
                    </div>
                    <div className="expense-text">
                      <strong>{e.name}</strong>
                      <small>
                        {EXPENSE_CATEGORIES[e.category]} ·{' '}
                        {e.scope === 'group'
                          ? groups.find((g) => g.id === e.group_id)?.label
                          : e.scope === 'selected'
                            ? `${e.person_ids.length} người được chọn`
                            : 'Chung cả buổi / chuyến'}
                      </small>
                      <small>
                        {e.paid_from === 'personal'
                          ? `${memberName(club.members, e.payer_member_id)} ứng cá nhân`
                          : e.paid_from === 'fund'
                            ? 'Đã chi từ quỹ'
                            : 'Chưa ghi nhận nguồn chi'}
                        {e.note && ` · ${e.note}`}
                      </small>
                    </div>
                    <div className="expense-money">
                      <strong>{currency(e.actual)}</strong>
                      <small>Dự toán {currency(e.estimated)}</small>
                    </div>
                    {manager && a.fee_status === 'draft' && (
                      <button
                        className="icon-btn"
                        aria-label={`Sửa ${e.name}`}
                        onClick={() =>
                          onAction({ type: 'expense', expense: e })
                        }
                      >
                        <Edit3 size={17} />
                      </button>
                    )}
                  </div>
                ))
              )}
              {trip && (
                <div className="reserve-box">
                  <strong>Quỹ dự phòng kế hoạch: {currency(a.reserve)}</strong>
                  <p>
                    Dự kiến cần thu theo kế hoạch:{' '}
                    {currency(calc.estimated + a.reserve)}. Dự phòng chưa chi
                    không cộng vào chi phí thực tế.
                  </p>
                  <p>
                    Số dư quỹ ghi nhận hiện tại:{' '}
                    <strong>{currency(cash)}</strong> · Chưa hoàn ứng:{' '}
                    {currency(advanced - returned)}.
                  </p>
                  <p>
                    {a.details.reserve_decision
                      ? `Thống nhất xử lý dư quỹ: ${a.details.reserve_decision}`
                      : 'Chưa ghi nhận thống nhất hoàn / giữ lại tiền dư. Người phụ trách cập nhật trong Thông tin.'}
                  </p>
                </div>
              )}
            </>
          )}
          {tab === 'payments' && (
            <>
              <div className="finance-toolbar">
                <div>
                  <h3>Sổ thu & hoàn tiền</h3>
                  <p>
                    Mỗi lần thu là một bản ghi. Ghi nhầm dùng điều chỉnh hoặc
                    hủy có lý do.
                  </p>
                </div>
                {manager && (
                  <button
                    className="btn primary"
                    disabled={
                      busy(club) || (!trip && a.fee_status !== 'finalized')
                    }
                    onClick={() => onAction({ type: 'payment' })}
                  >
                    <Plus size={15} />
                    Ghi nhận khoản tiền
                  </button>
                )}
              </div>
              {trip && (
                <>
                  <div className="cost-comparison">
                    <span>
                      Đóng quỹ ròng<strong>{currency(net)}</strong>
                    </span>
                    <span>
                      Cá nhân ứng / đã hoàn ứng
                      <strong>
                        {currency(advanced)} / {currency(returned)}
                      </strong>
                    </span>
                    <span>
                      Tiền còn trong quỹ<strong>{currency(cash)}</strong>
                    </span>
                  </div>
                  <div className="advance-list">
                    {[
                      ...new Set(
                        expenses
                          .filter((e) => e.paid_from === 'personal')
                          .map((e) => e.payer_member_id),
                      ),
                    ].map((id) => {
                      const total = expenses
                        .filter(
                          (e) =>
                            e.paid_from === 'personal' &&
                            e.payer_member_id === id,
                        )
                        .reduce((n, e) => n + e.actual, 0);
                      const paid = entries
                        .filter(
                          (e) =>
                            !e.voided_at &&
                            e.kind === 'reimbursement' &&
                            e.payee_member_id === id,
                        )
                        .reduce((n, e) => n + e.amount, 0);
                      return (
                        <div key={id}>
                          <span>
                            {memberName(club.members, id)} đã ứng{' '}
                            {currency(total)} · Còn cần hoàn ứng{' '}
                            <strong>{currency(total - paid)}</strong>
                          </span>
                          {manager && total > paid && (
                            <button
                              className="text-btn"
                              onClick={() =>
                                onAction({
                                  type: 'payment',
                                  personId: id ?? undefined,
                                })
                              }
                            >
                              Hoàn tiền ứng
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {!entries.length ? (
                <Empty>
                  Chưa có khoản thu. Chỉ người phụ trách hoặc quản trị viên xác
                  nhận thủ công.
                </Empty>
              ) : (
                entries.map((l) => (
                  <div
                    className={`ledger-row ${l.voided_at ? 'voided' : ''}`}
                    key={l.id}
                  >
                    <span className="ledger-indicator">
                      {l.kind === 'refund' || l.kind === 'reimbursement'
                        ? '−'
                        : '+'}
                    </span>
                    <div>
                      <strong>
                        {l.kind === 'reimbursement'
                          ? memberName(club.members, l.payee_member_id)
                          : personLabel(club, a, l.person_id)}
                      </strong>
                      <small>
                        {LEDGER_KIND[l.kind]} · {bookingTime(l.created_at)}
                      </small>
                      <small>
                        {memberName(club.members, l.confirmed_by)} xác nhận
                        {l.note && ` · ${l.note}`}
                      </small>
                      {l.voided_at && (
                        <small>
                          Đã hủy bởi {memberName(club.members, l.voided_by)} ·{' '}
                          {l.void_reason}
                        </small>
                      )}
                    </div>
                    <strong>{currency(l.amount)}</strong>
                    {manager && !l.voided_at && (
                      <button
                        className="icon-btn"
                        aria-label="Điều chỉnh hoặc hủy khoản tiền"
                        onClick={() => onAction({ type: 'payment', entry: l })}
                      >
                        <Edit3 size={16} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </>
          )}
          {tab === 'checklist' && (
            <>
              <div className="finance-toolbar">
                <div>
                  <h3>Chuẩn bị cho chuyến đi</h3>
                  <p>
                    Đồ cần mang theo; chỉ tính tiền khi có khoản chi tương ứng.
                  </p>
                </div>
                {manager && (
                  <button
                    className="btn primary"
                    onClick={() => onAction({ type: 'checklist' })}
                  >
                    <Plus size={16} />
                    Thêm đồ
                  </button>
                )}
              </div>
              {!(a.checklist ?? []).some((i) => !i.voided_at) ? (
                <Empty>
                  Thêm đồ ăn, nước uống, bếp nướng hoặc dụng cụ cần chuẩn bị.
                </Empty>
              ) : (
                (a.checklist ?? [])
                  .filter((i) => !i.voided_at)
                  .map((i) => (
                    <div className="checklist-row" key={i.id}>
                      <span className={`check-status ${i.status}`}>
                        <CheckCheck size={19} />
                      </span>
                      <div>
                        <strong>
                          {i.name} · {i.quantity} {i.unit}
                        </strong>
                        <small>
                          {memberName(club.members, i.responsible_id)} ·{' '}
                          {CHECK_STATUS[i.status]}
                        </small>
                        {i.note && <small>{i.note}</small>}
                        <small>
                          {i.expense_id
                            ? `Liên kết khoản chi: ${expenses.find((e) => e.id === i.expense_id)?.name ?? 'Khoản chi đã hủy'}`
                            : 'Chưa liên kết khoản chi · không cộng tiền'}
                        </small>
                        {manager && (
                          <label className="field">
                            <span>Trạng thái chuẩn bị {i.name}</span>
                            <select
                              aria-label={`Trạng thái chuẩn bị ${i.name}`}
                              value={i.status}
                              disabled={busy(club)}
                              onChange={(event) => {
                                const status = event.target.value;
                                if (status === i.status) return;
                                void club.run(
                                  () => club.bookingRpc('save_trip_checklist', {
                                    p_activity: a.id,
                                    p_id: i.id,
                                    p_patch: { status },
                                    p_expected_version: i.version,
                                  }),
                                  `Đã cập nhật trạng thái ${i.name}`,
                                );
                              }}
                            >
                              {Object.entries(CHECK_STATUS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                      {manager && (
                        <button
                          className="icon-btn"
                          aria-label={`Sửa đồ ${i.name}`}
                          onClick={() =>
                            onAction({ type: 'checklist', item: i })
                          }
                        >
                          <Edit3 size={16} />
                        </button>
                      )}
                    </div>
                  ))
              )}
            </>
          )}
          {tab === 'history' && <FinanceAudit activity={a} club={club} />}
        </>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`finance-stat ${accent ? 'accent' : ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
function personLabel(club: Club, a: ClubActivity, id: string | null) {
  const p = a.participants?.find((p) => p.id === id);
  return (
    a.calculation?.people.find((p) => p.id === id)?.name ??
    (p
      ? p.member_id
        ? memberName(club.members, p.member_id)
        : p.guest_name
      : memberName(club.members, id))
  );
}

function FeePeople({
  club,
  activity: a,
  onAction,
}: {
  club: Club;
  activity: ClubActivity;
  onAction: (a: Action) => void;
}) {
  const [filter, setFilter] = useState('all');
  const ledger = a.ledger ?? [];
  const people = activityFinancialPeople(a, club.members);
  return (
    <>
      <label className="finance-filter">
        Lọc thanh toán
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Tất cả</option>
          <option value="missing">Chưa đóng / còn thiếu</option>
          {Object.entries(PAYMENT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <div className="fee-people">
        <div className="fee-table-heading">
          <span>Thành viên</span>
          <span>Phải đóng</span>
          <span>Đã thu ròng</span>
          <span>Còn lại</span>
          <span>Trạng thái</span>
          <span />
        </div>
        {people
          .filter((p) => {
            const paid = netPaid(ledger, p.id);
            return (
              filter === 'all' ||
              (filter === 'missing'
                ? paid < p.due
                : paymentStatus(p.due, paid) === filter)
            );
          })
          .map((p) => {
            const paid = netPaid(ledger, p.id),
              left = p.due - paid,
              status = paymentStatus(p.due, paid);
            return (
              <div className="fee-person" key={p.id}>
                <div className="fee-person-name">
                  <strong>{p.name}</strong>
                  <small>
                    {a.kind === 'trip'
                      ? `${p.units / 1000} suất`
                      : p.groups
                          .map(
                            (id) => a.groups?.find((g) => g.id === id)?.label,
                          )
                          .join(' + ')}
                  </small>
                </div>
                <div data-label="Phải đóng">{currency(p.due)}</div>
                <div data-label="Đã thu ròng">{currency(paid)}</div>
                <div
                  data-label={left < 0 ? 'Cần hoàn lại' : 'Còn thiếu'}
                  className={
                    left > 0 ? 'amount-due' : left < 0 ? 'amount-return' : ''
                  }
                >
                  {currency(Math.abs(left))}
                  {left < 0 && <small>Cần hoàn lại</small>}
                </div>
                <div>
                  <span className={`payment-status ${status}`}>
                    {PAYMENT_STATUS[status]}
                  </span>
                </div>
                <div className="fee-person-actions">
                  {a.can_manage && (
                    <>
                      {left > 0 && a.fee_status === 'finalized' && (
                        <button
                          className="text-btn"
                          disabled={busy(club)}
                          onClick={() =>
                            void club.run(
                              () =>
                                club.bookingRpc('record_activity_payment', {
                                  p_activity: a.id,
                                  p_person: p.id,
                                  p_kind: 'settle',
                                  p_amount: null,
                                  p_operation: crypto.randomUUID(),
                                  p_note: 'Đã thu đủ',
                                }),
                              'Đã ghi nhận thu đủ số còn thiếu',
                            )
                          }
                        >
                          <CheckCheck size={14} />
                          Đã thu đủ
                        </button>
                      )}
                      <button
                        className="text-btn"
                        disabled={
                          busy(club) ||
                          (a.kind === 'badminton' &&
                            a.fee_status !== 'finalized')
                        }
                        onClick={() =>
                          onAction({ type: 'payment', personId: p.id, paymentKind: left < 0 ? 'refund' : 'collection' })
                        }
                      >
                        {left < 0 ? 'Hoàn tiền' : 'Thu / hoàn'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        {!people.length && <Empty>Chưa đủ dữ liệu để chia tiền.</Empty>}
      </div>
    </>
  );
}

function ActivityForm({
  club,
  kind,
  activity: a,
  close,
}: {
  club: Club;
  kind: ActivityKind;
  activity?: ClubActivity;
  close: (id?: string) => void;
}) {
  const trip = kind === 'trip',
    admin = club.account?.role === 'admin';
  const original = useRef(a);
  const [selected, setSelected] = useState<string[]>([]),
    [basis, setBasis] = useState('shift');
  const [itinerary, setItinerary] = useState(a?.details.itinerary ?? []);
  const [coverUrl, setCoverUrl] = useState(a?.details.cover_url ?? '');
  const [coverBlocked, setCoverBlocked] = useState(false);
  const [formError, setFormError] = useState('');
  const already = new Set(
    (club.activities?.activities ?? [])
      .filter((x) => !x.can_regroup)
      .flatMap((x) => (x.groups ?? []).map((g) => g.session_id)),
  );
  const available = club.sessions.filter(
    (s) =>
      !already.has(s.id) &&
      s.booking_status !== 'cancelled' &&
      (admin || s.organizer_id === club.booking?.verified_member_id),
  );
  const [date, setDate] = useState(
    available.find((s) => s.session_date >= dateKey(vietnamToday()))
      ?.session_date ??
      available[0]?.session_date ??
      dateKey(vietnamToday()),
  );
  const d = a?.details;
  async function submit(e: FormEvent<HTMLFormElement>) {
    const f = formValues(e);
    if (coverBlocked) {
      setFormError(
        'Ảnh chưa tải xong. Hãy thử tải lại hoặc bỏ ảnh vừa chọn trước khi lưu.',
      );
      return;
    }
    setFormError('');
    if (!trip && !a && selected.length === 1) {
      const existing = club.activities?.activities.find(
        (x) =>
          x.can_regroup && x.groups?.some((g) => g.session_id === selected[0]),
      );
      if (existing) {
        close(existing.id);
        return;
      }
    }
    const details = trip
      ? {
          description: text(f, 'description'),
          cover_url: coverUrl,
          location: text(f, 'location'),
          address: text(f, 'address'),
          maps_url: text(f, 'maps_url'),
          start_date: text(f, 'start_date'),
          end_date: text(f, 'end_date'),
          budget_per_person: num(f, 'budget_per_person'),
          deadline: text(f, 'deadline')
            ? new Date(text(f, 'deadline') + '+07:00').toISOString()
            : null,
          note: text(f, 'note'),
          reserve_decision: text(f, 'reserve_decision'),
          itinerary,
        }
      : undefined;
    let id = a?.id;
    const ok = await club.run(
      async () => {
        if (a) {
          const patch: Record<string, unknown> = {};
          for (const [key, value] of Object.entries({
            title: text(f, 'title'),
            ...(trip
              ? {
                  details,
                  status: text(f, 'status'),
                  reserve: num(f, 'reserve'),
                }
              : a.fee_status === 'draft'
                ? {
                    rounding: num(f, 'rounding'),
                    cost_note: text(f, 'cost_note'),
                  }
                : {}),
            ...(admin ? { organizer_id: text(f, 'organizer_id') || null } : {}),
          })) {
            if (
              JSON.stringify(value) !==
              JSON.stringify(original.current?.[key as keyof ClubActivity])
            )
              patch[key] = value;
          }
          await club.bookingRpc('save_activity', {
            p_id: a.id,
            p_patch: patch,
            p_expected_version: original.current?.version,
          });
        } else {
          if (!trip && !selected.length)
            throw new Error('Chọn ít nhất một ca/sân để tạo bảng phí.');
          id = await club.bookingRpc<string>('create_club_activity', {
            p_kind: kind,
            p_title: text(f, 'title'),
            p_sessions: selected.map((id, i) => ({
              session_id: id,
              label:
                selected.length === 1
                  ? 'Nhóm tham gia'
                  : `${basis === 'court' ? 'Sân' : 'Ca'} ${i + 1}`,
              basis: selected.length === 1 ? 'single' : basis,
            })),
            p_details: trip
              ? {
                  ...details,
                  organizer_id:
                    text(f, 'organizer_id') || club.booking?.verified_member_id,
                }
              : {},
          });
        }
      },
      a ? 'Đã cập nhật hoạt động' : 'Đã tạo hoạt động',
    );
    if (ok) close(id);
  }
  return (
    <form className="activity-form" onSubmit={submit}>
      <label className="field">
        <span>{trip ? 'Tên chuyến đi / sự kiện' : 'Tên bảng phí'}</span>
        <input
          name="title"
          defaultValue={
            a?.title ?? (!trip ? `Cầu lông ${formatDate(date)}` : '')
          }
          required
          maxLength={180}
        />
      </label>
      {!trip && !a && (
        <>
          <label className="field">
            <span>Ngày đánh</span>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSelected([]);
              }}
            />
          </label>
          <label className="field">
            <span>Các nhóm đang chia theo</span>
            <select value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="shift">Ca đánh riêng (khác khung giờ)</option>
              <option value="court">Sân riêng (nhóm tham gia từng sân)</option>
            </select>
          </label>
          <div className="group-picks">
            {available
              .filter((s) => s.session_date === date)
              .map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, s.id]
                          : selected.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <span>
                    <strong>
                      {s.court} · {s.start_time.slice(0, 5)}–
                      {s.end_time.slice(0, 5)}
                    </strong>
                    <small>{s.venue}</small>
                  </span>
                </label>
              ))}
            {!available.some((s) => s.session_date === date) && (
              <p>
                Không còn ca/sân có thể tạo bảng phí trong ngày này. Mỗi ca/sân
                thuộc một bảng phí.
              </p>
            )}
          </div>
          <p className="form-help">
            Tiền sân từng nhóm chia riêng. Nếu nhiều nhóm khác người phụ trách,
            admin cần chỉ định người thu chung trong Thông tin.
          </p>
        </>
      )}
      {admin && (trip || a) && (
        <label className="field">
          <span>
            Người phụ trách & thu tiền{' '}
            {trip ? '' : '(để trống: kế thừa người phụ trách sân)'}
          </span>
          <select
            name="organizer_id"
            defaultValue={
              a?.organizer_id ?? club.booking?.verified_member_id ?? ''
            }
            required={trip}
          >
            <MemberOptions
              club={club}
              empty={trip ? 'Chọn người phụ trách' : 'Kế thừa từ ca/sân'}
            />
          </select>
        </label>
      )}
      {trip && (
        <>
          <label className="field">
            <span>Mô tả</span>
            <textarea
              name="description"
              defaultValue={d?.description}
              rows={3}
            />
          </label>
          <TripCoverPicker
            club={club}
            activityId={a?.id ?? null}
            value={coverUrl}
            onChange={setCoverUrl}
            onBlockedChange={setCoverBlocked}
          />
          <div className="form-grid">
            <label className="field">
              <span>Địa điểm</span>
              <input name="location" defaultValue={d?.location} />
            </label>
            <label className="field">
              <span>Liên kết bản đồ</span>
              <input
                name="maps_url"
                type="url"
                pattern="https://.*"
                defaultValue={d?.maps_url}
              />
            </label>
          </div>
          <label className="field">
            <span>Địa chỉ</span>
            <input name="address" defaultValue={d?.address} />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Ngày bắt đầu</span>
              <input
                type="date"
                name="start_date"
                defaultValue={d?.start_date}
                required
              />
            </label>
            <label className="field">
              <span>Ngày kết thúc</span>
              <input
                type="date"
                name="end_date"
                defaultValue={d?.end_date}
                required
              />
            </label>
            <Money
              name="budget_per_person"
              label="Ngân sách dự kiến mỗi người"
              value={d?.budget_per_person}
            />
            <label className="field">
              <span>Hạn xác nhận (giờ Việt Nam)</span>
              <input
                type="datetime-local"
                name="deadline"
                defaultValue={
                  d?.deadline
                    ? new Date(new Date(d.deadline).getTime() + 7 * 3600000)
                        .toISOString()
                        .slice(0, 16)
                    : ''
                }
              />
            </label>
          </div>
          <div className="itinerary-editor">
            <strong>Lịch trình từng ngày</strong>
            {itinerary.map((x, i) => (
              <div key={i}>
                <input
                  type="date"
                  aria-label={`Ngày lịch trình ${i + 1}`}
                  value={x.day}
                  onChange={(e) =>
                    setItinerary(
                      itinerary.map((d, j) =>
                        j === i ? { ...d, day: e.target.value } : d,
                      ),
                    )
                  }
                />
                <textarea
                  aria-label={`Nội dung ngày ${i + 1}`}
                  placeholder="Lịch trình…"
                  value={x.content}
                  onChange={(e) =>
                    setItinerary(
                      itinerary.map((d, j) =>
                        j === i ? { ...d, content: e.target.value } : d,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Xóa ngày ${i + 1}`}
                  onClick={() =>
                    setItinerary(itinerary.filter((_, j) => j !== i))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              className="text-btn"
              type="button"
              onClick={() =>
                setItinerary([...itinerary, { day: '', content: '' }])
              }
            >
              + Thêm ngày
            </button>
          </div>
          {a && (
            <div className="form-grid">
              <label className="field">
                <span>Trạng thái chuyến đi</span>
                <select name="status" defaultValue={a.status}>
                  {Object.entries(TRIP_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <Money
                name="reserve"
                label="Quỹ dự phòng trong kế hoạch"
                value={a.reserve}
              />
            </div>
          )}
          <label className="field">
            <span>Ghi chú chung</span>
            <textarea name="note" defaultValue={d?.note} />
          </label>
          {a && (
            <label className="field">
              <span>Thống nhất xử lý tiền dư (hoàn / giữ lại, lý do)</span>
              <textarea
                name="reserve_decision"
                defaultValue={d?.reserve_decision}
              />
            </label>
          )}
        </>
      )}
      {!trip && a && a.fee_status === 'draft' && (
        <>
          <label className="field">
            <span>Làm tròn</span>
            <select name="rounding" defaultValue={a.rounding}>
              <option value="1">Chia chính xác đến đồng</option>
              <option value="1000">
                Làm tròn lên 1.000đ · hiển thị thu dư
              </option>
            </select>
          </label>
          <label className="field">
            <span>Ghi chú chi phí</span>
            <textarea name="cost_note" defaultValue={a.cost_note} />
          </label>
        </>
      )}
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <SaveFooter
        club={club}
        disabled={coverBlocked}
        label={
          a
            ? 'Lưu thông tin'
            : trip
              ? 'Tạo chuyến đi'
              : club.activities?.automatic_fees
                ? selected.length === 1
                  ? 'Mở / tạo bảng phí'
                  : 'Gộp bảng phí'
                : 'Tạo bảng phí'
        }
      />
    </form>
  );
}

function ExpenseForm({
  club,
  activity: a,
  original: e,
  preset,
  close,
}: {
  club: Club;
  activity: ClubActivity;
  original?: ActivityExpense;
  preset?: 'court' | 'shuttle';
  close: () => void;
}) {
  const [category, setCategory] = useState(e?.category ?? preset ?? 'other');
  const [scope, setScope] = useState(
    e?.scope ?? (preset === 'court' ? 'group' : 'all'),
  );
  const [group, setGroup] = useState(e?.group_id ?? a.groups?.[0]?.id ?? '');
  const [paidFrom, setPaidFrom] = useState(e?.paid_from ?? 'unpaid');
  const [selected, setSelected] = useState(e?.person_ids ?? []);
  const initial = useRef(e);
  const [reviewedVersion, setReviewedVersion] = useState(e?.version);
  const latest = e ? a.expenses?.find((x) => x.id === e.id) : undefined;
  async function submit(event: FormEvent<HTMLFormElement>) {
    const f = formValues(event),
      old = initial.current;
    const candidate = {
      name: text(f, 'name'),
      category,
      estimated: num(f, 'estimated'),
      actual: num(f, 'actual'),
      scope,
      group_id: scope === 'group' ? group : null,
      person_ids: scope === 'selected' ? selected : [],
      paid_from: paidFrom,
      payer_member_id:
        paidFrom === 'personal' ? text(f, 'payer_member_id') : null,
      note: text(f, 'note'),
    };
    const patch = Object.fromEntries(
      Object.entries(candidate).filter(
        ([k, v]) =>
          !old ||
          JSON.stringify(old[k as keyof ActivityExpense]) !== JSON.stringify(v),
      ),
    );
    if (
      await club.run(
        () =>
          club.bookingRpc('save_activity_expense', {
            p_activity: a.id,
            p_id: old?.id ?? null,
            p_patch: patch,
            p_expected_version: reviewedVersion ?? null,
            p_reason: text(f, 'reason'),
          }),
        'Đã lưu khoản chi',
      )
    )
      close();
  }
  return (
    <form className="activity-form" onSubmit={submit}>
      {latest && latest.version !== reviewedVersion && (
        <div className="finance-warnings" role="alert">
          <p>
            Khoản chi đã thay đổi trên thiết bị khác. Bản đang nhập được giữ
            lại.
          </p>
          <p>
            Máy chủ: {currency(latest.actual)} · Ghi chú:{' '}
            {latest.note || 'Trống'}
          </p>
          <button
            type="button"
            className="text-btn"
            onClick={() => setReviewedVersion(latest.version)}
          >
            Đã đối chiếu, giữ các trường tôi vừa sửa
          </button>
        </div>
      )}
      <label className="field">
        <span>Tên khoản chi</span>
        <input
          name="name"
          defaultValue={e?.name ?? (preset ? EXPENSE_CATEGORIES[preset] : '')}
          maxLength={180}
          required
        />
      </label>
      <label className="field">
        <span>Nhóm chi phí</span>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            if (e.target.value === 'court') setScope('group');
          }}
        >
          {Object.entries(EXPENSE_CATEGORIES)
            .filter(([k]) =>
              a.kind === 'trip'
                ? !['court', 'shuttle'].includes(k)
                : ['court', 'shuttle', 'other'].includes(k),
            )
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
      </label>
      <div className="form-grid">
        <Money name="estimated" label="Dự toán" value={e?.estimated} />
        <Money name="actual" label="Thực tế" value={e?.actual} />
      </div>
      {category === 'shuttle' && !!a.groups?.length && (
        <button
          className="btn shuttle-preset"
          type="button"
          onClick={() => {
            setScope('group');
            setGroup(a.groups![0].id);
          }}
        >
          Tiền cầu tính vào {a.groups[0].label.toLowerCase()}
        </button>
      )}
      <label className="field">
        <span>Phân bổ khoản chi cho</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
        >
          {category !== 'court' && (
            <option value="all">
              Chung cả{' '}
              {a.kind === 'trip'
                ? 'chuyến · theo suất'
                : 'buổi · người duy nhất'}
            </option>
          )}
          {a.kind === 'badminton' && (
            <option value="group">Riêng một nhóm ca/sân</option>
          )}
          {a.kind === 'trip' && (
            <option value="selected">Chỉ những người được chọn</option>
          )}
        </select>
      </label>
      {scope === 'group' && (
        <label className="field">
          <span>Nhóm tham gia chịu phí</span>
          <select
            value={group}
            required
            onChange={(e) => setGroup(e.target.value)}
          >
            {a.groups?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label} ·{' '}
                {g.basis === 'court'
                  ? 'theo sân'
                  : g.basis === 'shift'
                    ? 'theo ca'
                    : 'một nhóm'}
              </option>
            ))}
          </select>
        </label>
      )}
      {scope === 'selected' && (
        <div className="group-picks">
          {a.participants?.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, p.id]
                      : selected.filter((id) => id !== p.id),
                  )
                }
              />
              <span>
                {personLabel(club, a, p.id)} · {STATUS_LABELS[p.status]} ·{' '}
                {p.share_units / 1000} suất
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="form-grid">
        <label className="field">
          <span>Nguồn chi tiền</span>
          <select
            value={paidFrom}
            onChange={(e) => setPaidFrom(e.target.value as typeof paidFrom)}
          >
            <option value="unpaid">Chưa ghi nhận nguồn chi</option>
            <option value="fund">Quỹ đã chi</option>
            {a.kind === 'trip' && (
              <option value="personal">Cá nhân ứng trước</option>
            )}
          </select>
        </label>
        {paidFrom === 'personal' && (
          <label className="field">
            <span>Người ứng tiền cá nhân</span>
            <select
              name="payer_member_id"
              required
              defaultValue={e?.payer_member_id ?? ''}
            >
              <MemberOptions club={club} />
            </select>
          </label>
        )}
      </div>
      <label className="field">
        <span>Ghi chú khoản chi</span>
        <textarea name="note" defaultValue={e?.note} />
      </label>
      {e && (
        <label className="field">
          <span>Lý do điều chỉnh (nếu cần)</span>
          <input name="reason" />
        </label>
      )}
      <SaveFooter club={club} label="Lưu khoản chi" />
      {e && (
        <button
          type="button"
          className="text-btn danger-text"
          disabled={busy(club)}
          onClick={async () => {
            const reason = window.prompt('Lý do hủy khoản chi?');
            if (
              reason?.trim() &&
              (await club.run(
                () =>
                  club.bookingRpc('save_activity_expense', {
                    p_activity: a.id,
                    p_id: e.id,
                    p_patch: { void: true },
                    p_expected_version: initial.current?.version,
                    p_reason: reason,
                  }),
                'Đã hủy khoản chi; giữ lịch sử',
              ))
            )
              close();
          }}
        >
          <Trash2 size={15} />
          Hủy khoản chi
        </button>
      )}
    </form>
  );
}

function BillableRoster({
  club,
  activity: a,
}: {
  club: Club;
  activity: ClubActivity;
}) {
  return (
    <div className="billable-roster">
      <p>
        Mặc định lấy người chọn Đi. Đánh dấu thực tế chỉ thay đổi người chịu
        phí, không sửa đăng ký ban đầu.
      </p>
      {a.kind === 'trip' ? (
        <>
          <p>
            Số suất giảm do quản trị viên thiết lập trong đăng ký từng người.
          </p>
          <div className="group-picks">
            {(a.participants ?? [])
              .filter((p) => p.status === 'going')
              .map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={p.billable}
                    disabled={busy(club)}
                    onChange={(e) =>
                      void club.run(
                        () =>
                          club.bookingRpc('save_trip_participant', {
                            p_activity: a.id,
                            p_id: p.id,
                            p_patch: { billable: e.target.checked },
                            p_expected_version: p.version,
                          }),
                        'Đã xác nhận người chịu phí',
                      )
                    }
                  />
                  <span>
                    {personLabel(club, a, p.id)}
                    <small>
                      {p.share_units / 1000} suất ·{' '}
                      {p.share_reason || 'Một suất đầy đủ'}
                    </small>
                  </span>
                </label>
              ))}
          </div>
        </>
      ) : (
        a.groups?.map((g) => (
          <div key={g.id}>
            <h3>
              {g.label} ·{' '}
              {g.basis === 'court'
                ? 'Nhóm theo sân'
                : g.basis === 'shift'
                  ? 'Nhóm theo ca'
                  : 'Nhóm tham gia'}
            </h3>
            <div className="group-picks">
              {club.members
                .filter(
                  (m) =>
                    m.active ||
                    a.calculation?.people.some((p) => p.id === m.id),
                )
                .map((m) => {
                  const override = a.billable?.find(
                      (x) => x.group_id === g.id && x.member_id === m.id,
                    ),
                    going =
                      club.attendance.find(
                        (t) =>
                          t.member_id === m.id && t.session_id === g.session_id,
                      )?.status === 'going';
                  return (
                    <label key={m.id}>
                      <input
                        type="checkbox"
                        checked={override?.included ?? going}
                        disabled={busy(club)}
                        onChange={(e) =>
                          void club.run(
                            () =>
                              club.bookingRpc('set_activity_billable', {
                                p_group: g.id,
                                p_member: m.id,
                                p_included: e.target.checked,
                                p_expected_revision: club.activities?.revision,
                              }),
                            'Đã xác nhận người chịu phí',
                          )
                        }
                      />
                      <span>
                        {m.display_name}
                        <small>
                          {going
                            ? 'Đăng ký Đi'
                            : 'Không tự tính phí từ đăng ký'}
                          {override && ' · Đã xác nhận riêng'}
                        </small>
                      </span>
                      {override && (
                        <button
                          type="button"
                          className="text-btn"
                          disabled={busy(club)}
                          onClick={() =>
                            void club.run(
                              () =>
                                club.bookingRpc('set_activity_billable', {
                                  p_group: g.id,
                                  p_member: m.id,
                                  p_included: null,
                                  p_expected_revision:
                                    club.activities?.revision,
                                }),
                              'Đã lấy lại trạng thái đăng ký',
                            )
                          }
                        >
                          Theo đăng ký
                        </button>
                      )}
                    </label>
                  );
                })}
            </div>
          </div>
        ))
      )}
      <BookingWriteState club={club} />
    </div>
  );
}
function FeeStateForm({
  club,
  activity: a,
  close,
}: {
  club: Club;
  activity: ClubActivity;
  close: () => void;
}) {
  const finalized = useRef(a.fee_status === 'finalized').current;
  const [reviewed, setReviewed] = useState(() => ({
    revision: club.activities?.revision,
    calculation: a.calculation,
  }));
  const changed = reviewed.revision !== club.activities?.revision;
  const stateChanged = finalized !== (a.fee_status === 'finalized');
  return (
    <form
      className="activity-form"
      onSubmit={async (e) => {
        const f = formValues(e);
        if (changed || stateChanged) return;
        if (
          await club.run(
            () =>
              club.bookingRpc('set_activity_fee_state', {
                p_id: a.id,
                p_action: finalized ? 'reopen' : 'finalize',
                p_expected_revision: reviewed.revision,
                p_reason: text(f, 'reason'),
              }),
            finalized
              ? 'Đã mở lại, các khoản thu được giữ nguyên'
              : 'Đã chốt bảng phí và danh sách chịu phí',
          )
        )
          close();
      }}
    >
      <p>
        {finalized
          ? 'Các khoản thu và bản chốt cũ được giữ trong lịch sử. Sau khi sửa, hãy chốt lại để xác nhận số tiền mới.'
          : 'Kiểm tra người thực tế chịu phí và các khoản trước khi chốt. Số tiền sau khi chốt giữ nguyên dù đăng ký thay đổi.'}
      </p>
      <div className="fee-confirm-total">
        <strong>{currency(reviewed.calculation?.total_due ?? 0)}</strong>
        <span>
          {reviewed.calculation?.headcount ?? 0} người · {reviewed.calculation?.shares ?? 0}{' '}
          suất
        </span>
      </div>
      {(changed || stateChanged) && (
        <div className="finance-warnings" role="alert">
          <p>Dữ liệu đã thay đổi từ khi mở bảng xác nhận. Ghi chú bạn đang nhập vẫn được giữ lại.</p>
          {stateChanged ? (
            <p>Thiết bị khác đã {a.fee_status === 'finalized' ? 'chốt' : 'mở lại'} bảng phí. Hãy đóng cửa sổ này và kiểm tra trạng thái mới trước khi tiếp tục.</p>
          ) : (
            <>
              <p>Bản mới nhất: {currency(a.calculation?.total_due ?? 0)} · {a.calculation?.headcount ?? 0} người · {a.calculation?.shares ?? 0} suất.</p>
              <button type="button" className="text-btn" onClick={() => setReviewed({ revision: club.activities?.revision, calculation: a.calculation })}>Đã đối chiếu, dùng bảng phí mới nhất</button>
            </>
          )}
        </div>
      )}
      {!finalized && !!reviewed.calculation?.warnings.length && (
        <div className="finance-warnings">
          {reviewed.calculation.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      <label className="field">
        <span>
          {finalized ? 'Lý do mở lại (bắt buộc)' : 'Ghi chú xác nhận'}
        </span>
        <textarea name="reason" required={finalized} />
      </label>
      <SaveFooter
        club={club}
        label={finalized ? 'Mở lại để điều chỉnh' : 'Xác nhận chốt tiền'}
        disabled={changed || stateChanged}
      />
    </form>
  );
}

function PaymentForm({
  club,
  activity: a,
  personId,
  initialKind,
  original: l,
  close,
}: {
  club: Club;
  activity: ClubActivity;
  personId?: string;
  initialKind?: LedgerEntry['kind'];
  original?: LedgerEntry;
  close: () => void;
}) {
  const trip = a.kind === 'trip';
  const advance =
    !!personId &&
    !(a.participants ?? []).some((p) => p.id === personId) &&
    trip;
  const [kind, setKind] = useState<LedgerEntry['kind']>(
    l?.kind ?? initialKind ??
      (advance
        ? 'reimbursement'
        : netPaid(a.ledger ?? [], personId ?? '') >
            (a.calculation?.people.find((p) => p.id === personId)?.due ??
              0)
          ? 'refund'
          : 'collection'),
  );
  const [person, setPerson] = useState(
    l?.person_id ?? l?.payee_member_id ?? personId ?? '',
  );
  const operation = useRef(crypto.randomUUID());
  const amount =
    l?.amount ??
    (kind === 'reimbursement'
      ? Math.max(
          0,
          activeExpenses(a)
            .filter(
              (e) => e.paid_from === 'personal' && e.payer_member_id === person,
            )
            .reduce((n, e) => n + e.actual, 0) -
            (a.ledger ?? [])
              .filter(
                (e) =>
                  !e.voided_at &&
                  e.kind === 'reimbursement' &&
                  e.payee_member_id === person,
              )
              .reduce((n, e) => n + e.amount, 0),
        )
      : Math.abs(
          (a.calculation?.people.find((p) => p.id === person)?.due ?? 0) -
            netPaid(a.ledger ?? [], person),
        ));
  const options = trip
    ? (a.participants ?? []).map((p) => ({
        id: p.id,
        name: personLabel(club, a, p.id),
      }))
    : (a.calculation?.people ?? []).map((p) => ({ id: p.id, name: p.name }));
  async function submit(event: FormEvent<HTMLFormElement>) {
    const f = formValues(event);
    const args = {
      p_activity: a.id,
      p_person: person,
      p_kind: kind,
      p_amount: num(f, 'amount'),
      p_operation: operation.current,
      p_note: text(f, 'note'),
    };
    if (
      await club.run(
        () =>
          l
            ? club.bookingRpc('replace_activity_payment', {
                p_id: l.id,
                p_amount: num(f, 'amount'),
                p_note: text(f, 'note'),
                p_reason: text(f, 'reason'),
                p_operation: operation.current,
              })
            : club.bookingRpc('record_activity_payment', args),
        l
          ? 'Đã điều chỉnh khoản tiền; giữ bản cũ trong lịch sử'
          : 'Đã ghi nhận khoản tiền thủ công',
      )
    )
      close();
  }
  return (
    <form className="activity-form" onSubmit={submit}>
      <div className="alert">
        <Info size={17} />
        <span>{kind === 'refund' ? 'Bạn đang ghi nhận hoàn tiền đã đóng cho thành viên. Chỉ xác nhận sau khi đã hoàn tiền thực tế.' : kind === 'reimbursement' ? 'Bạn đang ghi nhận quỹ hoàn lại tiền cá nhân đã ứng. Khoản này không tính là tiền thành viên đóng.' : 'Bạn đang ghi nhận thu tiền vào quỹ. Chỉ xác nhận sau khi đã nhận tiền thực tế.'}</span>
      </div>
      <label className="field">
        <span>Loại ghi nhận</span>
        <select
          value={kind}
          disabled={!!l}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setPerson('');
          }}
        >
          {Object.entries(LEDGER_KIND)
            .filter(([k]) => trip || k !== 'reimbursement')
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        <span>
          {kind === 'reimbursement'
            ? 'Người nhận hoàn tiền ứng'
            : 'Người đóng / nhận hoàn'}
        </span>
        <select
          value={person}
          required
          disabled={!!l}
          onChange={(e) => setPerson(e.target.value)}
        >
          <option value="">Chọn người</option>
          {kind === 'reimbursement'
            ? club.members
                .filter((m) =>
                  activeExpenses(a).some(
                    (e) =>
                      e.paid_from === 'personal' && e.payer_member_id === m.id,
                  ),
                )
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))
            : options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
        </select>
      </label>
      <Money
        key={`${kind}:${person}`}
        name="amount"
        label="Số tiền thực nhận / hoàn"
        value={amount}
        minimum={1}
      />
      <label className="field">
        <span>Ghi chú lần thu / hoàn</span>
        <textarea name="note" defaultValue={l?.note} />
      </label>
      {l && (
        <label className="field">
          <span>Lý do điều chỉnh (bắt buộc)</span>
          <textarea name="reason" required />
        </label>
      )}
      <p className="form-help">
        Tiền cá nhân ứng được ghi ở khoản chi. Hoàn tiền ứng không tính là tiền
        thành viên đóng cho quỹ.
      </p>
      <SaveFooter
        club={club}
        label={l ? 'Lưu điều chỉnh' : kind === 'refund' ? 'Xác nhận hoàn tiền đóng' : kind === 'reimbursement' ? 'Xác nhận hoàn tiền ứng' : 'Xác nhận đã thu tiền'}
      />
      {l && (
        <button
          className="text-btn danger-text"
          type="button"
          disabled={busy(club)}
          onClick={async () => {
            const reason = window.prompt(
              'Lý do hủy khoản tiền? Bản ghi cũ vẫn được giữ.',
            );
            if (
              reason?.trim() &&
              (await club.run(
                () =>
                  club.bookingRpc('void_activity_payment', {
                    p_id: l.id,
                    p_reason: reason,
                  }),
                'Đã hủy khoản tiền; lịch sử vẫn được giữ',
              ))
            )
              close();
          }}
        >
          <Trash2 size={15} />
          Hủy bản ghi khoản tiền
        </button>
      )}
    </form>
  );
}

function TripRegistration({
  club,
  activity: a,
  onAction,
}: {
  club: Club;
  activity: ClubActivity;
  onAction: (a: Action) => void;
}) {
  const [show, setShow] = useState(false);
  const mid = club.booking?.verified_member_id;
  const own = a.participants?.find((p) => p.member_id === mid);
  const people = a.participants ?? [];
  const going = people.filter((p) => p.status === 'going').length;
  const closed =
    !a.can_manage &&
    (a.status !== 'open' ||
      (!!a.details.deadline &&
        new Date(a.details.deadline).getTime() <= Date.now()));
  return (
    <div className="trip-registration">
      <div className="trip-register-heading">
        <div>
          <strong>{going} người đã xác nhận Đi</strong>
          <p>
            {people.filter((p) => p.status === 'not_going').length} không đi ·{' '}
            {club.members.filter(
              (m) =>
                m.active &&
                !people.some(
                  (p) => p.member_id === m.id && p.status !== 'unanswered',
                ),
            ).length +
              people.filter((p) => !p.member_id && p.status === 'unanswered')
                .length}{' '}
            chưa phản hồi
          </p>
        </div>
        <button className="text-btn" onClick={() => setShow(!show)}>
          {show ? 'Thu gọn' : 'Danh sách đăng ký'}
          <Users size={16} />
        </button>
      </div>
      {mid && (
        <>
          <div className="trip-own-status">
            <span>Đăng ký của {memberName(club.members, mid)}</span>
            <div>
              {(['going', 'not_going', 'unanswered'] as const).map((status) => (
                <button
                  key={status}
                  className={`btn ${(own?.status ?? 'unanswered') === status ? 'primary' : ''}`}
                  disabled={busy(club) || closed}
                  onClick={() =>
                    void club.run(
                      () =>
                        club.bookingRpc('save_trip_participant', {
                          p_activity: a.id,
                          p_id: own?.id ?? null,
                          p_patch: {
                            ...(own ? {} : { member_id: mid }),
                            status,
                          },
                          p_expected_version: own?.version ?? null,
                        }),
                      'Đã lưu đăng ký chuyến đi',
                    )
                  }
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
            {own && (
              <button
                className="text-btn"
                disabled={closed}
                onClick={() =>
                  onAction({ type: 'participant', participant: own })
                }
              >
                Ghi chú / sửa đăng ký
              </button>
            )}
            <button
              className="text-btn"
              disabled={closed}
              onClick={() => onAction({ type: 'participant' })}
            >
              + Người đi cùng
            </button>
          </div>
          {closed && (
            <p className="form-help">
              Chuyến đi đang {TRIP_STATUS[a.status].toLowerCase()} hoặc đã hết
              hạn xác nhận. Liên hệ người phụ trách để điều chỉnh.
            </p>
          )}
        </>
      )}
      {show && (
        <div className="trip-participant-list">
          {club.members
            .filter((m) => m.active || people.some((p) => p.member_id === m.id))
            .map((m) => {
              const p = people.find((p) => p.member_id === m.id);
              return (
                <div key={m.id}>
                  <div>
                    <strong>{m.display_name}</strong>
                    <small>
                      {p?.note || m.code}
                      {p &&
                        ` · ${p.share_units / 1000} suất${!p.billable ? ' · Không chịu phí' : ''}`}
                    </small>
                    {p?.share_reason && (
                      <small>Lý do suất chia: {p.share_reason}</small>
                    )}
                  </div>
                  <span className={`trip-status ${p?.status ?? 'unanswered'}`}>
                    {STATUS_LABELS[p?.status ?? 'unanswered']}
                  </span>
                  {p && (a.can_manage || p.member_id === mid) && (
                    <button
                      className="icon-btn"
                      aria-label={`Sửa đăng ký ${m.display_name}`}
                      onClick={() =>
                        onAction({ type: 'participant', participant: p })
                      }
                    >
                      <Edit3 size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          {people
            .filter((p) => !p.member_id)
            .map((p) => (
              <div key={p.id}>
                <div>
                  <strong>{p.guest_name}</strong>
                  <small>
                    Khách của {memberName(club.members, p.invited_by)} ·{' '}
                    {p.share_units / 1000} suất
                    {!p.billable ? ' · Không chịu phí' : ''}
                  </small>
                  <small>
                    {p.note}
                    {p.share_reason && ` · ${p.share_reason}`}
                  </small>
                </div>
                <span className={`trip-status ${p.status}`}>
                  {STATUS_LABELS[p.status]}
                </span>
                {(a.can_manage || p.invited_by === mid) && (
                  <button
                    className="icon-btn"
                    aria-label={`Sửa khách ${p.guest_name}`}
                    onClick={() =>
                      onAction({ type: 'participant', participant: p })
                    }
                  >
                    <Edit3 size={16} />
                  </button>
                )}
              </div>
            ))}
          {a.can_manage && (
            <button
              className="btn"
              onClick={() => onAction({ type: 'participant' })}
            >
              + Thêm thành viên / khách
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ParticipantForm({
  club,
  activity: a,
  original: p,
  close,
}: {
  club: Club;
  activity: ClubActivity;
  original?: TripParticipant;
  close: () => void;
}) {
  const initial = useRef(p),
    [type, setType] = useState('guest');
  const [reviewedVersion, setReviewedVersion] = useState(p?.version);
  const latest = p ? a.participants?.find((x) => x.id === p.id) : undefined;
  const manager = !!a.can_manage,
    admin = club.account?.role === 'admin';
  async function submit(e: FormEvent<HTMLFormElement>) {
    const f = formValues(e),
      old = initial.current;
    const next: Record<string, unknown> = {
      status: text(f, 'status'),
      note: text(f, 'note'),
      ...(!p
        ? type === 'member'
          ? { member_id: text(f, 'member_id') }
          : {
              guest_name: text(f, 'guest_name'),
              invited_by: manager
                ? text(f, 'invited_by')
                : club.booking?.verified_member_id,
            }
        : !p.member_id
          ? { guest_name: text(f, 'guest_name') }
          : {}),
    };
    if (manager && a.fee_status === 'draft')
      next.billable = f.get('billable') === 'on';
    if (admin && a.fee_status === 'draft') {
      next.share_units = Math.round(num(f, 'shares') * 1000);
      next.share_reason = text(f, 'share_reason');
    }
    const patch = Object.fromEntries(
      Object.entries(next).filter(
        ([k, v]) => !old || old[k as keyof TripParticipant] !== v,
      ),
    );
    if (
      await club.run(
        () =>
          club.bookingRpc('save_trip_participant', {
            p_activity: a.id,
            p_id: old?.id ?? null,
            p_patch: patch,
            p_expected_version: reviewedVersion ?? null,
          }),
        'Đã lưu người tham gia',
      )
    )
      close();
  }
  return (
    <form className="activity-form" onSubmit={submit}>
      {latest && latest.version !== reviewedVersion && (
        <div className="finance-warnings" role="alert">
          <p>
            Đăng ký hoặc ghi chú đã thay đổi trên thiết bị khác. Bản đang nhập
            được giữ lại.
          </p>
          <p>
            Máy chủ: {STATUS_LABELS[latest.status]} · Ghi chú:{' '}
            {latest.note || 'Trống'}
          </p>
          <button
            type="button"
            className="text-btn"
            onClick={() => setReviewedVersion(latest.version)}
          >
            Đã đối chiếu, giữ các trường tôi vừa sửa
          </button>
        </div>
      )}
      {!p && manager && (
        <label className="field">
          <span>Thêm người</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="guest">Người đi cùng / khách</option>
            <option value="member">Thành viên trong nhóm</option>
          </select>
        </label>
      )}
      {!p && type === 'member' ? (
        <label className="field">
          <span>Thành viên</span>
          <select name="member_id" required>
            <option value="">Chọn thành viên chưa có dòng đăng ký</option>
            {club.members
              .filter(
                (m) =>
                  m.active &&
                  !a.participants?.some((p) => p.member_id === m.id),
              )
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name} · {m.code}
                </option>
              ))}
          </select>
        </label>
      ) : (
        (!p || !p.member_id) && (
          <>
            <label className="field">
              <span>Tên người đi cùng</span>
              <input
                name="guest_name"
                required
                defaultValue={p?.guest_name}
                maxLength={120}
              />
            </label>
            {!p && manager && (
              <label className="field">
                <span>Thành viên mời</span>
                <select
                  name="invited_by"
                  required
                  defaultValue={club.booking?.verified_member_id ?? ''}
                >
                  <MemberOptions club={club} />
                </select>
              </label>
            )}
          </>
        )
      )}
      {p?.member_id && <strong>{memberName(club.members, p.member_id)}</strong>}
      <label className="field">
        <span>Trạng thái tham gia</span>
        <select name="status" defaultValue={p?.status ?? 'going'}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Ghi chú riêng</span>
        <textarea name="note" defaultValue={p?.note} maxLength={2000} />
      </label>
      {manager && a.fee_status === 'draft' && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="billable"
            defaultChecked={p?.billable ?? true}
          />
          Xác nhận tham gia chịu phí (khi chọn Đi)
        </label>
      )}
      {admin && a.fee_status === 'draft' && (
        <div className="form-grid">
          <label className="field">
            <span>Số suất chia (0–100, tối đa 3 số lẻ)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.001"
              name="shares"
              defaultValue={(p?.share_units ?? 1000) / 1000}
              required
            />
          </label>
          <label className="field">
            <span>Lý do giảm / thay đổi suất</span>
            <input name="share_reason" defaultValue={p?.share_reason} />
          </label>
        </div>
      )}
      {a.fee_status === 'finalized' && (
        <p className="form-help">
          Thay đổi đăng ký không sửa công nợ đã chốt. Người phụ trách cần mở lại
          bảng phí nếu muốn điều chỉnh.
        </p>
      )}
      <SaveFooter club={club} label="Lưu đăng ký" />
    </form>
  );
}

function ChecklistForm({
  club,
  activity: a,
  original: i,
  close,
}: {
  club: Club;
  activity: ClubActivity;
  original?: TripChecklist;
  close: () => void;
}) {
  const initial = useRef(i);
  return (
    <form
      className="activity-form"
      onSubmit={async (e) => {
        const f = formValues(e),
          old = initial.current;
        const values = {
          name: text(f, 'name'),
          quantity: num(f, 'quantity'),
          unit: text(f, 'unit'),
          responsible_id: text(f, 'responsible_id') || null,
          status: text(f, 'status'),
          note: text(f, 'note'),
          expense_id: text(f, 'expense_id') || null,
        };
        const patch = Object.fromEntries(
          Object.entries(values).filter(
            ([k, v]) => !old || old[k as keyof TripChecklist] !== v,
          ),
        );
        if (
          await club.run(
            () =>
              club.bookingRpc('save_trip_checklist', {
                p_activity: a.id,
                p_id: old?.id ?? null,
                p_patch: patch,
                p_expected_version: old?.version ?? null,
              }),
            'Đã lưu danh sách chuẩn bị',
          )
        )
          close();
      }}
    >
      <label className="field">
        <span>Tên đồ cần chuẩn bị</span>
        <input name="name" required defaultValue={i?.name} />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Số lượng</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.001"
            step="0.001"
            name="quantity"
            required
            defaultValue={i?.quantity ?? 1}
          />
        </label>
        <label className="field">
          <span>Đơn vị</span>
          <input
            name="unit"
            defaultValue={i?.unit}
            placeholder="kg, chai, bộ…"
          />
        </label>
        <label className="field">
          <span>Người chuẩn bị</span>
          <select name="responsible_id" defaultValue={i?.responsible_id ?? ''}>
            <MemberOptions club={club} empty="Chưa phân công" />
          </select>
        </label>
        <label className="field">
          <span>Trạng thái chuẩn bị</span>
          <select name="status" defaultValue={i?.status ?? 'todo'}>
            {Object.entries(CHECK_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Liên kết khoản chi đã tạo (nếu có)</span>
        <select name="expense_id" defaultValue={i?.expense_id ?? ''}>
          <option value="">Chưa liên kết · không tự cộng tiền</option>
          {activeExpenses(a).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Ghi chú chuẩn bị</span>
        <textarea name="note" defaultValue={i?.note} />
      </label>
      <SaveFooter club={club} />
      {i && (
        <button
          className="text-btn danger-text"
          type="button"
          disabled={busy(club)}
          onClick={async () => {
            if (
              window.confirm('Bỏ mục chuẩn bị này?') &&
              (await club.run(
                () =>
                  club.bookingRpc('save_trip_checklist', {
                    p_activity: a.id,
                    p_id: i.id,
                    p_patch: { void: true },
                    p_expected_version: initial.current?.version,
                  }),
                'Đã bỏ mục chuẩn bị',
              ))
            )
              close();
          }}
        >
          Bỏ mục chuẩn bị
        </button>
      )}
    </form>
  );
}
function FinanceAudit({
  activity: a,
  club,
}: {
  activity: ClubActivity;
  club: Club;
}) {
  return (
    <div className="finance-audit">
      <h3>Lịch sử tài chính & hoạt động</h3>
      {a.finalizations?.map((f) => (
        <details key={f.id}>
          <summary>
            Chốt {currency(f.summary.total_due)} · {f.summary.headcount} người ·{' '}
            {bookingTime(f.created_at)}
          </summary>
          <p>
            {memberName(club.members, f.confirmed_by)} ·{' '}
            {f.reason || 'Xác nhận chốt phí'}
          </p>
          {f.summary.people.map((p) => (
            <p key={p.id}>
              {p.name}: {currency(p.due)}
            </p>
          ))}
        </details>
      ))}
      {!a.history?.length ? (
        <Empty>Chưa có lịch sử thay đổi.</Empty>
      ) : (
        a.history.map((h) => (
          <details key={h.id}>
            <summary>
              <span>
                <strong>{h.actor_name}</strong> ·{' '}
                {(
                  {
                    club_activities: 'Hoạt động / bảng phí',
                    activity_expenses: 'Khoản chi',
                    activity_ledger: 'Thu / hoàn tiền',
                    activity_finalizations: 'Chốt tiền',
                    trip_participants: 'Người tham gia',
                    trip_checklist: 'Chuẩn bị',
                    activity_billable: 'Người chịu phí',
                  } as Record<string, string>
                )[h.table_name] ?? h.table_name}
                <small>
                  {bookingTime(h.created_at)}
                  {h.reason && ` · ${h.reason}`}
                </small>
              </span>
              <History size={15} />
            </summary>
            <div className="audit-diff">
              <div>
                <strong>Trước</strong>
                <pre>{JSON.stringify(h.before_data, null, 2) || 'Chưa có'}</pre>
              </div>
              <div>
                <strong>Sau</strong>
                <pre>{JSON.stringify(h.after_data, null, 2) || 'Không có'}</pre>
              </div>
            </div>
          </details>
        ))
      )}
    </div>
  );
}
