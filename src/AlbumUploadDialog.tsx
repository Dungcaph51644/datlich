import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  UploadCloud,
  X,
} from 'lucide-react';
import { Modal } from './Modal';
import { message, rpc, supabase } from './lib';
import type { AlbumPhoto, TeamAlbum } from './albumTypes';
import {
  createAlbumThumbnail,
  reconcileAlbumUploadCaption,
  uploadAlbumPhoto,
  validateAlbumImageFile,
  xhrAlbumStorageUpload,
  type AlbumThumbnail,
} from './albumUpload';

type QueueState =
  'ready' | 'preparing' | 'uploading' | 'saving' | 'done' | 'error';
interface QueuePhoto {
  id: string;
  albumId: string;
  file: File;
  preview: string;
  caption: string;
  state: QueueState;
  loaded: number;
  total: number;
  error: string;
  unsavedCaption?: string;
  captionWarning?: string;
  thumbnail?: AlbumThumbnail;
}
const stateLabels: Record<QueueState, string> = {
  ready: 'Chờ tải lên',
  preparing: 'Đang chuẩn bị ảnh…',
  uploading: 'Đang tải ảnh…',
  saving: 'Đang lưu chú thích…',
  done: 'Đã lưu trực tuyến',
  error: 'Chưa lưu · Cần thử lại',
};
const activeStates: QueueState[] = ['preparing', 'uploading', 'saving'];
function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AlbumUploadDialog({
  albumId,
  albums,
  online,
  onClose,
  onUploaded,
  write,
}: {
  albumId: string;
  albums: TeamAlbum[];
  online: boolean;
  onClose: () => void;
  onUploaded: () => void;
  write: (task: () => Promise<unknown>, success?: string) => Promise<boolean>;
}) {
  const [selectedAlbumId, setSelectedAlbumId] = useState(albumId);
  const [photos, setPhotos] = useState<QueuePhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<QueuePhoto[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const running = useRef(false);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controllers.current.values()) controller.abort();
      for (const photo of queue.current)
        if (photo.preview) URL.revokeObjectURL(photo.preview);
    };
  }, []);
  useEffect(() => {
    if (!online)
      for (const controller of controllers.current.values()) controller.abort();
  }, [online]);

  function update(id: string, patch: Partial<QueuePhoto>) {
    queue.current = queue.current.map((photo) =>
      photo.id === id ? { ...photo, ...patch } : photo,
    );
    if (mounted.current) setPhotos(queue.current);
  }
  function add(files: File[]) {
    if (!selectedAlbumId) {
      setSelectionError('Hãy chọn album trước khi thêm ảnh.');
      return;
    }
    const available = Math.max(0, 50 - queue.current.length);
    setSelectionError(
      files.length > available
        ? 'Mỗi lượt chọn tối đa 50 ảnh. Hãy tải xong rồi mở lượt mới để thêm ảnh còn lại.'
        : '',
    );
    const added = files.slice(0, available).map((file): QueuePhoto => {
      let error = '';
      try {
        validateAlbumImageFile(file);
      } catch (cause) {
        error = message(cause);
      }
      return {
        id: crypto.randomUUID(),
        albumId: selectedAlbumId,
        file,
        preview: error ? '' : URL.createObjectURL(file),
        caption: '',
        state: error ? 'error' : 'ready',
        loaded: 0,
        total: file.size,
        error,
      };
    });
    queue.current = [...queue.current, ...added];
    setPhotos(queue.current);
  }
  function remove(id: string) {
    const photo = queue.current.find((item) => item.id === id);
    if (!photo || activeStates.includes(photo.state)) return;
    if (photo.preview) URL.revokeObjectURL(photo.preview);
    queue.current = queue.current.filter((item) => item.id !== id);
    setPhotos(queue.current);
  }
  async function uploadOne(id: string) {
    const photo = queue.current.find((item) => item.id === id);
    if (!photo || !onlineRef.current || !mounted.current) return;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    update(id, { state: 'preparing', loaded: 0, error: '' });
    let failure = '';
    const confirmed: { photo?: AlbumPhoto } = {};
    try {
      await write(async () => {
        try {
          if (!supabase) throw new Error('Chưa kết nối Supabase để tải ảnh.');
          const thumbnail =
            photo.thumbnail ??
            (await createAlbumThumbnail(photo.file, controller.signal));
          if (!mounted.current)
            throw new DOMException('Đã dừng tải ảnh.', 'AbortError');
          if (!photo.thumbnail) {
            const previousPreview = queue.current.find(
              (item) => item.id === id,
            )?.preview;
            const thumbnailPreview = URL.createObjectURL(thumbnail.blob);
            update(id, {
              thumbnail,
              preview: thumbnailPreview,
              total: photo.file.size + thumbnail.blob.size,
            });
            if (previousPreview) URL.revokeObjectURL(previousPreview);
          } else
            update(id, {
              thumbnail,
              total: photo.file.size + thumbnail.blob.size,
            });
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          confirmed.photo = await uploadAlbumPhoto<AlbumPhoto>(
            {
              albumId: photo.albumId,
              operationId: photo.id,
              file: photo.file,
              caption: photo.caption,
              thumbnail,
            },
            {
              prepare: (args) => rpc('prepare_team_album_upload', args),
              upload: (bucket, path, blob, options) =>
                xhrAlbumStorageUpload(
                  {
                    url: import.meta.env.VITE_SUPABASE_URL,
                    publicKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                    accessToken: data.session?.access_token,
                  },
                  bucket,
                  path,
                  blob,
                  options,
                ),
              finish: (args) =>
                rpc<AlbumPhoto>('finish_team_album_upload', args),
              signal: controller.signal,
              onProgress: (loaded, total) => update(id, { loaded, total }),
              onPhase: (state) => update(id, { state }),
            },
          );
        } catch (cause) {
          failure = controller.signal.aborted
            ? onlineRef.current
              ? 'Đã dừng tải ảnh. Bấm thử lại để tiếp tục.'
              : 'Đang mất mạng. Ảnh chưa được lưu; kết nối lại rồi bấm thử lại.'
            : message(cause);
          if (
            /prepare_team_album_upload|finish_team_album_upload|schema cache|function.*not.*found/i.test(
              failure,
            )
          )
            failure =
              'Backend Album đội chưa được cấu hình. Cần chạy migration album trên Supabase trước khi tải ảnh.';
          throw new Error(failure);
        }
      }, 'Đã xác nhận ảnh lưu trực tuyến.');
      if (!mounted.current) return;
      if (confirmed.photo) {
        update(id, {
          state: 'done',
          error: '',
          ...reconcileAlbumUploadCaption(
            photo.caption,
            confirmed.photo.caption,
          ),
        });
        onUploaded();
      } else
        update(id, {
          state: 'error',
          error: failure || 'Máy chủ chưa xác nhận đã lưu ảnh. Hãy thử lại.',
        });
    } catch (cause) {
      if (mounted.current)
        update(id, { state: 'error', error: failure || message(cause) });
    } finally {
      controllers.current.delete(id);
    }
  }
  async function start(ids: string[]) {
    if (running.current || !onlineRef.current || !ids.length) return;
    running.current = true;
    setBusy(true);
    let next = 0;
    async function worker() {
      while (mounted.current && onlineRef.current && next < ids.length) {
        const id = ids[next++];
        await uploadOne(id);
      }
    }
    await Promise.all([worker(), worker()]);
    running.current = false;
    if (mounted.current) setBusy(false);
  }
  const unfinished = photos.filter((photo) => photo.state !== 'done');
  const readyIds = photos
    .filter((photo) => photo.state === 'ready')
    .map((photo) => photo.id);
  const failedIds = photos
    .filter((photo) => photo.state === 'error' && !!photo.preview)
    .map((photo) => photo.id);
  const complete = photos.length - unfinished.length;
  const liveAlbums = albums.filter((album) => !album.deleted_at);
  const hasUnsavedWork = unfinished.length > 0 ||
    photos.some((photo) => photo.unsavedCaption !== undefined);
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasUnsavedWork]);
  function close() {
    if (
      busy &&
      !window.confirm(
        'Dừng các ảnh đang tải và đóng cửa sổ? Những ảnh chưa được máy chủ xác nhận sẽ chưa xuất hiện trong album.',
      )
    )
      return;
    if (
      !busy &&
      unfinished.length &&
      !window.confirm('Đóng và bỏ các ảnh chưa tải xong trong danh sách này?')
    )
      return;
    if (
      !busy &&
      photos.some((photo) => photo.unsavedCaption !== undefined) &&
      !window.confirm(
        'Có bản nháp chú thích chưa được lưu. Hãy sao chép bản nháp rồi mở ảnh → Sửa chú thích để cập nhật. Vẫn đóng cửa sổ này?',
      )
    )
      return;
    onClose();
  }
  return (
    <Modal title="Thêm ảnh vào album" onClose={close} protectUnsaved={false} wide>
      <div className="album-upload-dialog">
        <label className="field">
          <span>Album nhận ảnh</span>
          <select
            value={selectedAlbumId}
            disabled={busy || photos.length > 0}
            onChange={(event) => setSelectedAlbumId(event.target.value)}
          >
            <option value="">Chọn album</option>
            {liveAlbums.map((album) => (
              <option key={album.id} value={album.id}>
                {album.title}
              </option>
            ))}
          </select>
        </label>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          aria-label="Chọn nhiều ảnh từ thiết bị"
          className="album-upload-input"
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <div
          className={`album-upload-drop ${dragging ? 'dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            add(Array.from(event.dataTransfer.files));
          }}
        >
          <UploadCloud size={35} />
          <strong>Mang những khoảnh khắc vào đây</strong>
          <p>Kéo thả ảnh hoặc chọn nhiều ảnh từ điện thoại, máy tính.</p>
          <button
            className="btn primary"
            type="button"
            disabled={!selectedAlbumId || photos.length >= 50}
            onClick={() => input.current?.click()}
          >
            <ImagePlus size={17} />
            Chọn ảnh từ thiết bị
          </button>
          <small>
            JPG, PNG, WebP · Tối đa 15 MB mỗi ảnh · Màu ảnh được giữ tự nhiên
          </small>
        </div>
        {!online && (
          <p className="form-error" role="status">
            Đang mất mạng. Bạn vẫn có thể chọn và viết chú thích; kết nối lại để
            tải ảnh lên.
          </p>
        )}
        {selectionError && (
          <p className="form-error" role="alert">
            {selectionError}
          </p>
        )}
        {photos.length > 0 && (
          <>
            <div className="album-upload-summary" aria-live="polite">
              <strong>
                {complete}/{photos.length} ảnh đã lưu
              </strong>
              <span>
                {busy
                  ? 'Đang tải tối đa 2 ảnh cùng lúc'
                  : 'Thêm chú thích trước khi bấm tải lên'}
              </span>
            </div>
            <div className="album-upload-queue">
              {photos.map((photo) => {
                const active = activeStates.includes(photo.state);
                const percentage = photo.total
                  ? Math.min(
                      100,
                      Math.round((photo.loaded / photo.total) * 100),
                    )
                  : 0;
                return (
                  <article
                    key={photo.id}
                    className={`album-upload-item ${photo.state}`}
                  >
                    <div className="album-upload-preview">
                      {photo.preview ? (
                        <img
                          src={photo.preview}
                          alt={`Xem trước ${photo.file.name}`}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <ImagePlus size={28} />
                      )}
                    </div>
                    <div className="album-upload-detail">
                      <div className="album-upload-file">
                        <strong title={photo.file.name}>
                          {photo.file.name}
                        </strong>
                        <small>{fileSize(photo.file.size)}</small>
                      </div>
                      <label className="field">
                        <span>Chú thích</span>
                        <input
                          maxLength={2000}
                          value={photo.caption}
                          placeholder="Kỷ niệm của bức ảnh này…"
                          disabled={active || photo.state === 'done'}
                          aria-label={`Chú thích ${photo.file.name}`}
                          onChange={(event) =>
                            update(photo.id, { caption: event.target.value })
                          }
                        />
                      </label>
                      <div className="album-upload-status" role="status">
                        {photo.state === 'done' ? (
                          <Check size={15} />
                        ) : active ? (
                          <LoaderCircle size={15} className="spin" />
                        ) : null}
                        <span>
                          {stateLabels[photo.state]}
                          {photo.state === 'uploading' ? ` ${percentage}%` : ''}
                        </span>
                      </div>
                      {active && (
                        <progress
                          max={100}
                          value={
                            photo.state === 'preparing' ? undefined : percentage
                          }
                          aria-label={`Tiến trình tải ${photo.file.name}`}
                        />
                      )}
                      {photo.error && (
                        <p className="form-error" role="alert">
                          {photo.error}
                        </p>
                      )}
                      {photo.captionWarning && (
                        <div
                          className="album-upload-caption-warning"
                          role="alert"
                        >
                          <p className="form-help">{photo.captionWarning}</p>
                          <label className="field">
                            <span>
                              Bản nháp chú thích chưa lưu · có thể sao chép
                            </span>
                            <textarea
                              readOnly
                              value={photo.unsavedCaption ?? ''}
                              aria-label={`Bản nháp chú thích chưa lưu của ${photo.file.name}`}
                            />
                          </label>
                        </div>
                      )}
                      {photo.state === 'error' && photo.preview && (
                        <button
                          className="text-btn"
                          type="button"
                          disabled={busy || !online}
                          onClick={() => void start([photo.id])}
                        >
                          <RefreshCw size={14} />
                          Thử lại ảnh này
                        </button>
                      )}
                    </div>
                    {!active && (
                      <button
                        className="icon-btn album-upload-remove"
                        type="button"
                        aria-label={`Bỏ ${photo.file.name} khỏi danh sách tải`}
                        onClick={() => remove(photo.id)}
                      >
                        <X size={17} />
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
            <p className="form-help">
              Ảnh chỉ xuất hiện trong album sau khi máy chủ xác nhận cả ảnh gốc,
              ảnh thu nhỏ và chú thích. Khi thử lại, file đã tải thành công sẽ
              được giữ lại.
            </p>
            <div className="album-upload-actions">
              {failedIds.length > 0 && (
                <button
                  className="btn"
                  type="button"
                  disabled={busy || !online}
                  onClick={() => void start(failedIds)}
                >
                  <RefreshCw size={16} />
                  Thử lại {failedIds.length} ảnh lỗi
                </button>
              )}
              {readyIds.length > 0 && (
                <button
                  className="btn primary"
                  type="button"
                  disabled={busy || !online}
                  onClick={() => void start(readyIds)}
                >
                  <UploadCloud size={17} />
                  Tải lên {readyIds.length} ảnh
                </button>
              )}
              {!unfinished.length && (
                <button className="btn primary" type="button" onClick={close}>
                  <Check size={17} />
                  Hoàn tất
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
