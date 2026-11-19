import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Copy,
  Download,
  ImagePlus,
  LoaderCircle,
  QrCode,
  RefreshCw,
  Trash2,
  ZoomIn,
} from 'lucide-react';
import { Modal } from './Modal';
import { message } from './lib';
import { currency } from './bookingUtils';
import { copyText } from './userActions';
import { activityFinancialPeople } from './financeExport';
import {
  netPaid,
  effectivePaid,
  type ActivityPaymentSettings,
  type ClubActivity,
  type FeePerson,
  type PaymentQrAsset,
} from './activityTypes';
import {
  downloadPaymentQr,
  isPaymentQrPath,
  validatePaymentQrFile,
} from './paymentQr';
import type { useClub } from './useClub';

type Club = ReturnType<typeof useClub>;
const empty: ActivityPaymentSettings = {
  version: 0,
  qr_path: null,
  receiver_name: '',
  bank_name: '',
  account_number: '',
  transfer_note: '',
};
const keys = [
  'qr_path',
  'receiver_name',
  'bank_name',
  'account_number',
  'transfer_note',
] as const;
const caution = 'Kiểm tra người nhận và nhập đúng số tiền trước khi chuyển';
const locked = (club: Club) => !club.online || club.saveState === 'saving';
const imageUrl = (club: Club, path: string | null | undefined) =>
  path && isPaymentQrPath(path) ? (club.paymentQrUrl?.(path) ?? '') : '';
const hasPaymentCalculation = (a: ClubActivity) =>
  !!a.calculation &&
  !a.calculation.warnings.length &&
  (a.fee_status === 'finalized' ||
    (a.expenses ?? []).some((e) => !e.voided_at && e.actual > 0));

export function ActivityPayment({
  club,
  activity: a,
}: {
  club: Club;
  activity: ClubActivity;
}) {
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const selected = club.memberId ?? club.booking?.verified_member_id;
  const person = activityFinancialPeople(a, club.members).find(
    (p) => p.member_id === selected,
  );
  const p = a.payment;
  return (
    <section
      className="activity-payment"
      aria-label="Chuyển khoản của hoạt động"
    >
      {imageUrl(club, p?.qr_path) ? (
        <button
          className="payment-card-thumbnail"
          aria-label="Mở QR thanh toán"
          onClick={() => setPaying(true)}
        >
          <img src={imageUrl(club, p?.qr_path)} alt="QR nhận tiền của buổi" />
        </button>
      ) : (
        <span className="payment-qr-icon">
          <QrCode size={24} />
        </span>
      )}
      <div className="payment-card-copy">
        <h3>Thanh toán chuyển khoản</h3>
        <p>
          {p?.receiver_name
            ? [p.receiver_name, p.bank_name].filter(Boolean).join(' · ')
            : 'Người phụ trách bổ sung QR và tài khoản nhận tiền tại đây.'}
        </p>
        {person && (
          <small>
            {person.name} ·{' '}
            {a.fee_status === 'draft' ? 'Tạm tính còn đóng' : 'Còn phải đóng'}:{' '}
            <strong>
              {hasPaymentCalculation(a)
                ? currency(
                    Math.max(
                      0,
                      person.due - effectivePaid(a.ledger ?? [], person),
                    ),
                  )
                : 'Chưa xác định'}
            </strong>
          </small>
        )}
        {p?.source === 'member' && (
          <small>
            {p.organizer_id
              ? 'Tự dùng QR cá nhân của người phụ trách đặt sân.'
              : 'Chưa có người phụ trách chung. Cần chỉ định người nhận tiền cho bảng phí này.'}
          </small>
        )}
      </div>
      <div className="payment-card-actions">
        <button className="btn primary" onClick={() => setPaying(true)}>
          <QrCode size={16} />
          Thanh toán
        </button>
        {a.can_manage && (
          <button
            className="text-btn"
            onClick={() => setEditing(true)}
            disabled={locked(club)}
          >
            {p?.source === 'member'
              ? 'Dùng QR riêng cho buổi'
              : p?.version
                ? 'Sửa QR & tài khoản'
                : 'Thêm QR & tài khoản'}
          </button>
        )}
        {a.can_manage && p?.source === 'activity' && (
          <button
            className="text-btn"
            disabled={locked(club)}
            onClick={() =>
              void club.run(
                () =>
                  club.bookingRpc('use_organizer_payment_qr', {
                    p_activity: a.id,
                    p_expected_version: p.version,
                  }),
                'Đã chuyển sang QR cá nhân của người phụ trách.',
              )
            }
          >
            Dùng QR người phụ trách
          </button>
        )}
      </div>
      {editing && a.can_manage && (
        <Modal
          title="QR & tài khoản nhận tiền"
          locked={club.saveState === 'saving'}
          onClose={() => setEditing(false)}
        >
          <PaymentSettingsForm
            club={club}
            activity={a}
            close={() => setEditing(false)}
          />
        </Modal>
      )}
      {paying && (
        <Modal
          title="Thanh toán chuyển khoản"
          protectUnsaved={false}
          onClose={() => setPaying(false)}
        >
          <PaymentSheet club={club} activity={a} initialPersonId={person?.id} />
        </Modal>
      )}
    </section>
  );
}

export function PaymentSettingsForm({
  club,
  activity: a,
  close,
}: {
  club: Club;
  activity: ClubActivity;
  close: () => void;
}) {
  const initial =
    a.payment?.source === 'member'
      ? { ...empty, version: a.payment.version }
      : (a.payment ?? empty);
  const [base, setBase] = useState(() => ({ ...initial }));
  const [draft, setDraft] = useState(() => ({ ...initial }));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState('');
  const [library, setLibrary] = useState<PaymentQrAsset[] | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const librarySequence = useRef(0);
  const conflict = initial.version !== base.version;
  const disabled = saving || locked(club);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      librarySequence.current++;
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  function discardFile() {
    setFile(null);
    setPreview('');
    setUploaded(null);
    if (input.current) input.current.value = '';
  }
  function choose(file: File) {
    if (disabled) return;
    try {
      validatePaymentQrFile(file);
    } catch (e) {
      setError(message(e));
      return;
    }
    setFile(file);
    setUploaded(null);
    setPreview(URL.createObjectURL(file));
    setError('');
  }
  async function loadLibrary() {
    const seq = ++librarySequence.current;
    setLoadingLibrary(true);
    setLibraryError('');
    try {
      const result = await club.bookingRpc<PaymentQrAsset[]>(
        'get_payment_qr_library',
        { p_activity: a.id },
      );
      if (
        !Array.isArray(result) ||
        !result.every(
          (x) =>
            isPaymentQrPath(x.path) &&
            typeof x.label === 'string' &&
            typeof x.bank_name === 'string' &&
            typeof x.account_number === 'string',
        )
      )
        throw new Error('Danh sách QR chưa hợp lệ. Hãy tải lại.');
      if (mounted.current && seq === librarySequence.current)
        setLibrary(result);
    } catch (e) {
      if (mounted.current && seq === librarySequence.current)
        setLibraryError(message(e));
    } finally {
      if (mounted.current && seq === librarySequence.current)
        setLoadingLibrary(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || conflict) return;
    setSaving(true);
    setError('');
    let failure = '';
    const ok = await club.run(async () => {
      try {
        let path = draft.qr_path;
        if (file) {
          setPhase('Đang tải ảnh QR…');
          path = uploaded ?? (await club.uploadPaymentQr(file, a.id));
          if (!mounted.current)
            throw new Error('Cửa sổ đã thay đổi. Ảnh chưa được gắn vào buổi.');
          setUploaded(path);
        }
        const patch: Record<string, string | null> = {};
        for (const key of keys) {
          const value = key === 'qr_path' ? path : draft[key].trim();
          if (value !== base[key]) patch[key] = value;
        }
        if (!Object.keys(patch).length) return;
        setPhase('Đang lưu thông tin nhận tiền…');
        await club.bookingRpc('save_activity_payment_settings', {
          p_activity: a.id,
          p_patch: patch,
          p_expected_version: base.version,
        });
      } catch (e) {
        failure = message(e);
        if (
          /schema cache|PGRST202|function.*not.*found|Could not find the function/i.test(
            failure,
          )
        )
          failure =
            'Cần chạy migration QR thanh toán trên Supabase trước khi lưu.';
        throw new Error(failure);
      }
    }, 'Đã lưu QR và tài khoản nhận tiền');
    if (!mounted.current) return;
    setSaving(false);
    setPhase('');
    if (ok) close();
    else
      setError(
        failure || 'Chưa lưu được thông tin. Kiểm tra kết nối rồi thử lại.',
      );
  }
  const needsAccount = !!(
    file ||
    draft.qr_path ||
    draft.receiver_name ||
    draft.bank_name ||
    draft.account_number
  );
  return (
    <form className="payment-settings-form" onSubmit={submit}>
      <p className="form-help">
        Thông tin này chỉ áp dụng cho <strong>{a.title}</strong>. Chọn ảnh để
        xem trước, rồi bấm Lưu.
      </p>
      {conflict && (
        <div className="alert" role="alert">
          <strong>Thông tin nhận tiền vừa thay đổi trên thiết bị khác.</strong>
          <p>
            Bản mới: {initial.receiver_name || 'Chưa có tên'} ·{' '}
            {initial.bank_name || 'Chưa có ngân hàng'} ·{' '}
            {initial.account_number || 'Chưa có tài khoản'}.{' '}
            {initial.qr_path !== base.qr_path && 'Ảnh QR cũng đã thay đổi.'}
          </p>
          <div className="payment-inline-actions">
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() => {
                discardFile();
                setBase({ ...initial });
                setDraft({ ...initial });
                setError('');
              }}
            >
              Dùng bản mới
            </button>
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() => {
                const merged = { ...initial };
                for (const key of keys)
                  if (draft[key] !== base[key])
                    Object.assign(merged, { [key]: draft[key] });
                setDraft(merged);
                setBase({ ...initial });
              }}
            >
              Giữ phần tôi sửa
            </button>
          </div>
        </div>
      )}
      <input
        type="hidden"
        name="qr_selection"
        value={
          file
            ? `file:${file.name}:${file.size}:${file.lastModified}`
            : (draft.qr_path ?? '')
        }
      />
      {(preview || imageUrl(club, draft.qr_path)) && (
        <figure className="payment-qr-preview">
          <img
            src={preview || imageUrl(club, draft.qr_path)}
            alt="Xem trước ảnh QR nhận tiền"
          />
          <figcaption>
            {file
              ? 'Ảnh vừa chọn · Chưa lưu'
              : draft.qr_path !== initial.qr_path
                ? 'QR đã chọn · Chưa lưu'
                : 'QR đang dùng'}
          </figcaption>
        </figure>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="payment-file-input"
        aria-label="Chọn ảnh QR từ thiết bị"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) choose(f);
          e.target.value = '';
        }}
      />
      <div className="payment-inline-actions">
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={17} />
          {file || draft.qr_path ? 'Thay ảnh QR' : 'Chọn ảnh QR'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || loadingLibrary}
          onClick={() => void loadLibrary()}
        >
          {loadingLibrary ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          Dùng QR đã tải
        </button>
        {(file || draft.qr_path) && (
          <button
            type="button"
            className="text-btn"
            disabled={disabled}
            onClick={() => {
              discardFile();
              setDraft((d) => ({ ...d, qr_path: null }));
              setError('');
            }}
          >
            <Trash2 size={16} />
            Xóa QR khỏi buổi
          </button>
        )}
      </div>
      <p className="form-help">
        JPG, PNG, WebP tối đa 5 MB. Giữ nguyên ảnh để mã QR rõ nét. Xóa khỏi
        buổi vẫn giữ ảnh trong thư viện để dùng lại.
      </p>
      {libraryError && (
        <p role="alert" className="form-error">
          {libraryError}
        </p>
      )}
      {library && (
        <div className="payment-qr-library" aria-label="Thư viện QR đã tải">
          {library.length ? (
            library.map((asset) => (
              <button
                type="button"
                className={
                  draft.qr_path === asset.path && !file ? 'selected' : ''
                }
                key={asset.path}
                disabled={disabled}
                onClick={() => {
                  discardFile();
                  setDraft((d) => ({
                    ...d,
                    qr_path: asset.path,
                    receiver_name:
                      asset.label === 'QR đã tải'
                        ? d.receiver_name
                        : asset.label,
                    bank_name: asset.bank_name || d.bank_name,
                    account_number: asset.account_number || d.account_number,
                  }));
                  setError('');
                }}
              >
                <img
                  src={imageUrl(club, asset.path)}
                  alt="Ảnh QR trong thư viện"
                  loading="lazy"
                />
                <span>
                  {asset.label}
                  <small>
                    {asset.bank_name} {asset.account_number}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>Chưa có QR đã tải. Bạn chọn ảnh từ thiết bị nhé.</p>
          )}
        </div>
      )}
      <div className="payment-account-fields">
        <label className="field">
          <span>Tên người nhận</span>
          <input
            name="receiver_name"
            value={draft.receiver_name}
            maxLength={120}
            required={needsAccount}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) =>
              setDraft({ ...draft, receiver_name: e.target.value })
            }
            placeholder="Tên chủ tài khoản"
          />
        </label>
        <label className="field">
          <span>Ngân hàng</span>
          <input
            name="bank_name"
            value={draft.bank_name}
            maxLength={120}
            required={needsAccount}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => setDraft({ ...draft, bank_name: e.target.value })}
            placeholder="Ví dụ: Vietcombank"
          />
        </label>
        <label className="field">
          <span>Số tài khoản</span>
          <input
            name="account_number"
            value={draft.account_number}
            maxLength={80}
            required={needsAccount}
            disabled={disabled}
            autoComplete="off"
            inputMode="text"
            onChange={(e) =>
              setDraft({ ...draft, account_number: e.target.value })
            }
          />
        </label>
        <label className="field">
          <span>Nội dung chuyển khoản chung (tùy chọn)</span>
          <input
            name="transfer_note"
            value={draft.transfer_note}
            maxLength={140}
            disabled={disabled}
            onChange={(e) =>
              setDraft({ ...draft, transfer_note: e.target.value })
            }
            placeholder="Để trống: dùng tên buổi và tên người đóng"
          />
        </label>
      </div>
      <p className="payment-qr-caution">
        {caution}. QR tải lên có thể chứa số tiền cố định.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          data-modal-close
          disabled={disabled}
          onClick={close}
        >
          Hủy
        </button>
        <button
          type="submit"
          className="btn primary"
          disabled={disabled || conflict}
        >
          {saving && <LoaderCircle className="spin" size={16} />}
          {saving ? phase || 'Đang lưu…' : 'Lưu QR & tài khoản'}
        </button>
      </div>
    </form>
  );
}

function CopyValue({
  label,
  value,
  onNotice,
}: {
  label: string;
  value: string;
  onNotice: (value: string) => void;
}) {
  return (
    <button
      type="button"
      className="text-btn"
      aria-label={`Sao chép ${label}`}
      disabled={!value}
      onClick={async () => {
        try {
          await copyText(value);
          onNotice(`Đã sao chép ${label}.`);
        } catch (e) {
          onNotice(message(e));
        }
      }}
    >
      <Copy size={15} />
      Sao chép
    </button>
  );
}

export function PaymentSheet({
  club,
  activity: a,
  initialPersonId,
}: {
  club: Club;
  activity: ClubActivity;
  initialPersonId?: string;
}) {
  const [personId, setPersonId] = useState(initialPersonId ?? '');
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [brokenUrl, setBrokenUrl] = useState('');
  const people = activityFinancialPeople(a, club.members);
  const p = a.payment ?? empty;
  const person = people.find((x) => x.id === personId);
  const paid = person ? effectivePaid(a.ledger ?? [], person) : 0;
  const balance = person ? person.due - paid : null;
  const calculable = hasPaymentCalculation(a);
  const amount = balance != null && calculable ? Math.max(0, balance) : null;
  const note = person
    ? (p.transfer_note || `${a.title} - ${person.name}`).slice(0, 140)
    : '';
  const url = imageUrl(club, p.qr_path);
  async function download() {
    if (!url || downloading) return;
    setDownloading(true);
    setNotice('');
    try {
      await downloadPaymentQr(
        url,
        `qr-${a.id}.${p.qr_path?.split('.').pop() ?? 'png'}`,
      );
      setNotice('Đã gửi ảnh tới trình duyệt để tải xuống.');
    } catch (e) {
      setNotice(message(e));
    } finally {
      setDownloading(false);
    }
  }
  return (
    <div className="payment-sheet">
      <p className="payment-activity-title">{a.title}</p>
      <span className={`fee-badge ${a.fee_status}`}>
        {a.fee_status === 'finalized'
          ? 'Đã chốt phí'
          : 'Tạm tính · Số tiền có thể thay đổi'}
      </span>
      <label className="field">
        <span>Người đóng tiền</span>
        <select
          aria-label="Người đóng tiền"
          value={personId}
          onChange={(e) => {
            setPersonId(e.target.value);
            setNotice('');
          }}
        >
          <option value="">Chọn tên để xem số tiền</option>
          {people.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {!person ? (
        <p className="form-help">
          {people.length
            ? 'Chọn đúng tên của bạn để xem số tiền cần chuyển.'
            : 'Chưa có dữ liệu phân bổ cho thành viên. Người phụ trách cần bổ sung chi phí và người chịu phí.'}
        </p>
      ) : (
        <>
          <div className="payment-amount">
            <span>
              {balance != null && balance < 0
                ? a.fee_status === 'draft'
                  ? 'Tạm tính cần hoàn lại'
                  : 'Bạn cần được hoàn lại'
                : a.fee_status === 'draft'
                  ? 'Tạm tính còn phải đóng'
                  : 'Còn phải đóng'}
            </span>
            <strong>
              {!calculable ? 'Chưa xác định' : currency(Math.abs(balance ?? 0))}
            </strong>
            {amount != null && amount > 0 && (
              <CopyValue
                label="số tiền"
                value={String(amount)}
                onNotice={setNotice}
              />
            )}
          </div>
          <p className="form-help">
            {currency(person.due)}{' '}
            {a.fee_status === 'draft' ? 'tạm phân bổ' : 'phải đóng'} · Đã thu
            ròng theo ghi nhận: {currency(netPaid(a.ledger ?? [], person.id))}.
          </p>
          {person.organizer_paid && (
            <p className="payment-notice">
              Đã thanh toán mặc định vì bạn là người phụ trách đặt sân. Phần
              đóng của bạn được tính là đã đủ; đây không phải xác nhận giao dịch
              ngân hàng.
            </p>
          )}
          {!calculable && (
            <p className="alert">
              Chưa đủ chi phí hoặc phân bổ để xác định số tiền cần chuyển. Hãy
              liên hệ người phụ trách.
            </p>
          )}
          {calculable && balance != null && balance <= 0 && (
            <p className="alert">
              {balance < 0
                ? 'Bạn đang đóng dư; liên hệ người phụ trách để được hoàn lại, không chuyển thêm.'
                : 'Theo ghi nhận hiện tại bạn không còn khoản phải đóng cho hoạt động này.'}
            </p>
          )}
          {a.status === 'cancelled' && (
            <p className="alert">
              Hoạt động đã hủy. Hãy liên hệ người phụ trách đối chiếu trước khi
              chuyển tiền.
            </p>
          )}
        </>
      )}
      {url && url !== brokenUrl ? (
        <div className="payment-qr-display">
          <button
            type="button"
            className="payment-qr-zoom"
            aria-label="Phóng to ảnh QR"
            onClick={() => setZoom(true)}
          >
            <img
              src={url}
              alt="QR chuyển khoản của hoạt động"
              onError={() => setBrokenUrl(url)}
            />
            <span>
              <ZoomIn size={16} />
              Phóng to
            </span>
          </button>
          <div className="payment-inline-actions">
            <button
              type="button"
              className="btn"
              disabled={downloading || !club.online}
              onClick={() => void download()}
            >
              {downloading ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Download size={16} />
              )}
              Tải ảnh QR
            </button>
          </div>
        </div>
      ) : (
        <div className="payment-no-qr">
          <QrCode size={30} />
          <p>
            {url
              ? 'Chưa tải được ảnh QR. Bạn có thể dùng thông tin tài khoản bên dưới và thử lại.'
              : 'Chưa có ảnh QR. Người phụ trách cần bổ sung; bạn có thể dùng thông tin tài khoản nếu đã có.'}
          </p>
          {url && (
            <button
              type="button"
              className="text-btn"
              onClick={() => setBrokenUrl('')}
            >
              Thử tải lại QR
            </button>
          )}
        </div>
      )}
      <p className="payment-qr-caution">{caution}</p>
      <p className="form-help">
        Ảnh QR có thể chứa số tiền cố định. Sau khi quét, kiểm tra lại trong ứng
        dụng ngân hàng và nhập đúng số tiền của bạn.
      </p>
      <dl className="payment-bank-details">
        <div>
          <dt>Người nhận</dt>
          <dd>{p.receiver_name || 'Chưa bổ sung'}</dd>
        </div>
        {(p.bank_name || p.source !== 'member') && (
          <div>
            <dt>Ngân hàng</dt>
            <dd>{p.bank_name || 'Chưa bổ sung'}</dd>
          </div>
        )}
        {(p.account_number || p.source !== 'member') && (
          <div>
            <dt>Số tài khoản</dt>
            <dd>
              <strong>{p.account_number || 'Chưa bổ sung'}</strong>
              <CopyValue
                label="số tài khoản"
                value={p.account_number}
                onNotice={setNotice}
              />
            </dd>
          </div>
        )}
        <div>
          <dt>Nội dung chuyển khoản</dt>
          <dd>
            <span>{note || 'Chọn tên người đóng tiền trước'}</span>
            <CopyValue
              label="nội dung chuyển khoản"
              value={note}
              onNotice={setNotice}
            />
          </dd>
        </div>
      </dl>
      <p className="form-help">
        Người phụ trách đặt sân được ghi đã thanh toán mặc định. Các thành viên
        khác được xác nhận thủ công sau khi kiểm tra giao dịch. Xem hoặc tải QR
        không thay đổi trạng thái.
      </p>
      {notice && (
        <p className="payment-notice" role="status">
          {notice}
        </p>
      )}
      {zoom && (
        <Modal
          title="Ảnh QR chuyển khoản"
          wide
          protectUnsaved={false}
          onClose={() => {
            setZoom(false);
            setZoomScale(1);
          }}
        >
          <label className="field payment-zoom-level">
            <span>Mức phóng to QR</span>
            <select
              value={zoomScale}
              onChange={(event) => setZoomScale(Number(event.target.value))}
            >
              <option value={1}>100%</option>
              <option value={1.5}>150%</option>
              <option value={2}>200%</option>
              <option value={3}>300%</option>
            </select>
          </label>
          <div className="payment-zoom-image">
            <img
              src={url}
              alt="Ảnh QR phóng to"
              style={{ width: `${zoomScale * 100}%`, maxWidth: 'none' }}
            />
          </div>
          <p className="payment-qr-caution">{caution}</p>
          <button
            type="button"
            className="btn"
            disabled={downloading || !club.online}
            onClick={() => void download()}
          >
            <Download size={16} />
            Tải ảnh QR
          </button>
          {notice && <p role="status">{notice}</p>}
        </Modal>
      )}
    </div>
  );
}

export function ConfirmPayment({
  club,
  activity: a,
  person,
  close,
}: {
  club: Club;
  activity: ClubActivity;
  person: FeePerson;
  close: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const left = person.due - effectivePaid(a.ledger ?? [], person);
  useEffect(() => {
    setChecked(false);
  }, [left, person.id]);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!checked || saving || locked(club) || left <= 0) return;
        setSaving(true);
        setError('');
        const ok = await club.run(async () => {
          try {
            await club.bookingRpc('record_activity_payment', {
              p_activity: a.id,
              p_person: person.id,
              p_kind: 'settle',
              p_amount: null,
              p_operation: crypto.randomUUID(),
              p_note:
                'Người thu đã kiểm tra giao dịch và xác nhận thanh toán đủ',
            });
          } catch (e) {
            setError(message(e));
            throw e;
          }
        }, 'Đã xác nhận thanh toán');
        setSaving(false);
        if (ok) close();
      }}
    >
      <p>
        <strong>{person.name}</strong> · {a.title}
      </p>
      <p>
        Số còn phải thu: <strong>{currency(Math.max(0, left))}</strong>
      </p>
      <label className="payment-confirm-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={saving}
          required
        />
        Tôi đã kiểm tra và nhận đủ tiền trong tài khoản.
      </label>
      <p className="form-help">
        Nếu mới nhận một phần, dùng “Thu / hoàn” để ghi đúng số tiền.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          data-modal-close
          disabled={saving}
          onClick={close}
        >
          Hủy
        </button>
        <button
          type="submit"
          className="btn primary"
          disabled={!checked || saving || locked(club) || left <= 0}
        >
          {saving ? 'Đang xác nhận…' : 'Xác nhận đã thanh toán'}
        </button>
      </div>
    </form>
  );
}
