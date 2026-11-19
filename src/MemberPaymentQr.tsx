import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, LoaderCircle, QrCode, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { message } from './lib';
import { validatePaymentQrFile } from './paymentQr';
import type { MemberPaymentQr as Profile } from './activityTypes';
import type { useClub } from './useClub';

type Club = ReturnType<typeof useClub>;

export function MemberPaymentQr({ club }: { club: Club }) {
  const [editing, setEditing] = useState(false);
  const memberId = club.booking?.verified_member_id;
  const profile = club.activities?.personal_payment_qr;
  if (!memberId) return null;
  const name =
    club.members.find((m) => m.id === memberId)?.display_name ?? 'Bạn';
  const available = profile?.member_id === memberId;
  return (
    <section className="activity-payment" aria-label="QR cá nhân">
      <span className="payment-qr-icon">
        <QrCode size={24} />
      </span>
      <div className="payment-card-copy">
        <h3>QR nhận tiền của {name}</h3>
        <p>
          Chỉ tải một lần. Bảng thanh toán tự dùng QR này khi bạn phụ trách đặt
          sân, không cần nhập lại tài khoản.
        </p>
        <small>
          {available
            ? profile.qr_path
              ? 'Đã lưu QR cá nhân'
              : 'Chưa có QR cá nhân'
            : 'Cần cập nhật dữ liệu QR cá nhân trên Supabase.'}
        </small>
      </div>
      <button
        className="btn"
        disabled={!available || !club.online || club.saveState === 'saving'}
        onClick={() => setEditing(true)}
      >
        <ImagePlus size={16} />
        {profile?.qr_path ? 'Xem / thay QR' : 'Tải QR cá nhân'}
      </button>
      {editing && available && (
        <Modal
          title={`QR nhận tiền của ${name}`}
          locked={club.saveState === 'saving'}
          onClose={() => setEditing(false)}
        >
          <MemberPaymentQrForm
            key={memberId}
            club={club}
            profile={profile}
            close={() => setEditing(false)}
          />
        </Modal>
      )}
    </section>
  );
}

export function MemberPaymentQrForm({
  club,
  profile,
  close,
}: {
  club: Club;
  profile: Profile;
  close: () => void;
}) {
  const [base, setBase] = useState(profile);
  const [path, setPath] = useState(profile.qr_path);
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const conflict =
    profile.version !== base.version || profile.member_id !== base.member_id;
  const disabled = saving || !club.online || club.saveState === 'saving';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const resetFile = () => {
    setFile(null);
    setUploaded(null);
    setPreview('');
    if (input.current) input.current.value = '';
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || conflict) return;
    setSaving(true);
    setError('');
    const ok = await club.run(async () => {
      try {
        const next = file
          ? (uploaded ?? (await club.uploadMemberPaymentQr(file)))
          : path;
        if (!mounted.current)
          throw new Error(
            'Danh tính hoặc cửa sổ đã thay đổi. QR chưa được lưu.',
          );
        if (file) setUploaded(next);
        await club.bookingRpc('save_member_payment_qr', {
          p_path: next,
          p_expected_version: base.version,
        });
      } catch (e) {
        if (mounted.current) setError(message(e));
        throw e;
      }
    }, 'Đã lưu QR cá nhân. Các bảng phí dùng QR tự động đã được cập nhật.');
    if (!mounted.current) return;
    setSaving(false);
    if (ok) close();
  }
  const url = preview || (path ? club.paymentQrUrl(path) : '');
  return (
    <form className="payment-settings-form" onSubmit={save}>
      <p className="form-help">
        Một QR đang dùng cho mỗi người. Thay ảnh sẽ cập nhật các bảng phí dùng
        QR cá nhân của bạn. QR riêng đã thiết lập cho một buổi vẫn được giữ.
      </p>
      {url && (
        <figure className="payment-qr-preview">
          <img src={url} alt="QR cá nhân xem trước" />
          <figcaption>
            {file ? 'Ảnh xem trước, chưa lưu' : 'QR đã lưu trực tuyến'}
          </figcaption>
        </figure>
      )}
      <input
        ref={input}
        className="payment-file-input"
        type="file"
        name="personal_qr_file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Chọn ảnh QR cá nhân"
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.files?.[0];
          if (!next) return;
          try {
            validatePaymentQrFile(next);
            setFile(next);
            setUploaded(null);
            setPreview(URL.createObjectURL(next));
            setError('');
          } catch (e) {
            setError(message(e));
          }
        }}
      />
      <input
        type="hidden"
        name="qr_path"
        value={file ? 'pending-upload' : (path ?? '')}
      />
      <div className="payment-inline-actions">
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={16} />
          {url ? 'Chọn ảnh khác' : 'Chọn ảnh QR'}
        </button>
        {(path || file) && (
          <button
            type="button"
            className="text-btn"
            disabled={disabled}
            onClick={() => {
              resetFile();
              setPath(null);
            }}
          >
            <Trash2 size={15} />
            Xóa QR
          </button>
        )}
      </div>
      <p className="form-help">
        JPG, PNG hoặc WebP, tối đa 5 MB. Không cần nhập ngân hàng hay số tài
        khoản; người chuyển kiểm tra thông tin trong ứng dụng ngân hàng.
      </p>
      <p className="payment-qr-caution">
        Kiểm tra người nhận và nhập đúng số tiền trước khi chuyển. QR có thể
        chứa số tiền cố định.
      </p>
      {conflict && (
        <div className="alert" role="alert">
          QR đã thay đổi trên thiết bị khác.{' '}
          <button
            type="button"
            className="text-btn"
            disabled={disabled}
            onClick={() => {
              setBase(profile);
              setPath(profile.qr_path);
              resetFile();
              setError('');
            }}
          >
            Dùng bản mới
          </button>
        </div>
      )}
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
          disabled={disabled || conflict || (!file && path === base.qr_path)}
        >
          {saving && <LoaderCircle size={16} className="spin" />}
          {saving ? 'Đang lưu QR…' : 'Lưu QR cá nhân'}
        </button>
      </div>
    </form>
  );
}
