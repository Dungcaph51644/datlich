import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { message, supabase } from './lib';
import { uploadTripCover, validateTripCoverFile } from './coverUpload';
import type { useClub } from './useClub';

type Club = ReturnType<typeof useClub>;

export function TripCoverPicker({
  club,
  activityId,
  value,
  onChange,
  onBlockedChange,
}: {
  club: Club;
  activityId: string | null;
  value: string;
  onChange: (url: string) => void;
  onBlockedChange: (blocked: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const initialCover = useRef(value);
  const mounted = useRef(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
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

  function discard() {
    setPendingFile(null);
    setPreview('');
    setError('');
    onBlockedChange(false);
    if (input.current) input.current.value = '';
  }
  async function upload(file: File) {
    try {
      validateTripCoverFile(file);
    } catch (cause) {
      setError(message(cause));
      return;
    }
    if (!club.online) {
      setError('Đang mất mạng. Hãy kết nối lại rồi chọn ảnh.');
      return;
    }
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));
    setError('');
    setUploading(true);
    onBlockedChange(true);
    let failure = '';
    const ok = await club.run(async () => {
      try {
        if (!supabase) throw new Error('Chưa kết nối Supabase để tải ảnh.');
        const url = await uploadTripCover(file, activityId, {
          prepare: (args) => club.bookingRpc('prepare_trip_cover_upload', args),
          storage: supabase.storage,
        });
        if (mounted.current) onChange(url);
      } catch (cause) {
        failure = message(cause);
        if (
          /prepare_trip_cover_upload|schema cache|function.*not.*found/i.test(
            failure,
          )
        )
          failure =
            'Cần chạy bản cập nhật tự tạo bảng phí & tải ảnh trên Supabase trước khi dùng nút chọn tệp.';
        throw new Error(failure);
      }
    }, 'Đã tải ảnh lên. Bấm Lưu thông tin để cập nhật ảnh của chuyến đi.');
    if (!mounted.current) return;
    setUploading(false);
    if (ok) {
      setPendingFile(null);
      setPreview('');
      onBlockedChange(false);
    } else
      setError(
        failure ||
          'Ảnh chưa được tải lên. Kiểm tra kết nối rồi thử lại hoặc bỏ ảnh vừa chọn.',
      );
  }
  const locked = uploading || club.saveState === 'saving';
  return (
    <div className="trip-cover-picker">
      <strong>Ảnh bìa chuyến đi</strong>
      {(preview || value) && (
        <div className="cover-picker-preview">
          <img src={preview || value} alt="Ảnh bìa đã chọn" />
          {pendingFile && (
            <span>{uploading ? 'Đang tải ảnh…' : 'Ảnh chưa được lưu'}</span>
          )}
          {!pendingFile && value && value !== initialCover.current && <span>Ảnh đã chọn · Chưa lưu vào chuyến đi</span>}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Chọn ảnh bìa từ thiết bị"
        disabled={locked || !club.online}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }}
      />
      <div className="cover-picker-actions">
        <button
          type="button"
          className="btn"
          disabled={locked || !club.online}
          onClick={() => input.current?.click()}
        >
          {uploading ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <ImagePlus size={17} />
          )}
          {uploading
            ? 'Đang tải ảnh…'
            : value
              ? 'Đổi ảnh từ thiết bị'
              : 'Chọn ảnh từ thiết bị'}
        </button>
        {pendingFile && !uploading && (
          <>
            <button
              type="button"
              className="text-btn"
              disabled={locked || !club.online}
              onClick={() => void upload(pendingFile)}
            >
              <RefreshCw size={15} />
              Thử tải lại
            </button>
            <button
              type="button"
              className="text-btn"
              disabled={locked}
              onClick={discard}
            >
              Bỏ ảnh vừa chọn
            </button>
          </>
        )}
        {value && !pendingFile && (
          <button
            type="button"
            className="text-btn"
            disabled={locked}
            onClick={() => {
              discard();
              onChange('');
            }}
          >
            <Trash2 size={15} />
            Bỏ ảnh bìa
          </button>
        )}
      </div>
      <p className="form-help">
        Chọn ảnh trên điện thoại hoặc máy tính. Hỗ trợ JPG, PNG, WebP tối đa 5
        MB. Ảnh được lưu trực tuyến sau khi máy chủ xác nhận.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <details className="cover-link-option">
        <summary>Hoặc dùng liên kết ảnh có sẵn</summary>
        <label className="field">
          <span>Liên kết ảnh https</span>
          <input
            type="url"
            pattern="https://.*"
            value={value}
            disabled={locked || !!pendingFile}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://…"
          />
        </label>
      </details>
    </div>
  );
}
