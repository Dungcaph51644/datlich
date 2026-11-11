import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  LoaderCircle,
  Link2,
  Pencil,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AlbumPhoto } from './albumTypes';
import { albumPhotoUrl } from './albumMedia';

type Point = { x: number; y: number };
type View = { zoom: number; pan: Point };
type Gesture = {
  start: Point;
  pan: Point;
  distance: number;
  zoom: number;
  pinched: boolean;
};
const normalView = (): View => ({ zoom: 1, pan: { x: 0, y: 0 } });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Originals are requested only for the photo currently open in this dialog. */
export function AlbumLightbox({
  photos,
  initialId,
  onClose,
  onEdit,
  onTrash,
  onPhotoChange,
  onShare,
  online = true,
  photoUrl = albumPhotoUrl,
}: {
  photos: AlbumPhoto[];
  initialId: string;
  onClose: () => void;
  onEdit?: (photo: AlbumPhoto) => void;
  onTrash?: (photo: AlbumPhoto) => void;
  onPhotoChange?: (id: string) => void;
  onShare?: (photo: AlbumPhoto) => Promise<void>;
  online?: boolean;
  photoUrl?: (path: string) => string;
}) {
  const livePhotos = photos.filter((photo) => !photo.deleted_at);
  const [currentId, setCurrentId] = useState(() =>
    livePhotos.some((photo) => photo.id === initialId)
      ? initialId
      : (livePhotos[0]?.id ?? initialId),
  );
  const index = livePhotos.findIndex((photo) => photo.id === currentId);
  const photo = livePhotos[index];
  const [view, setView] = useState<View>(normalView);
  const viewRef = useRef(view);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const headingId = useId();
  const hintId = useId();
  const [loaded, setLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  const downloadController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const previousInitialId = useRef(initialId);

  useEffect(() => {
    mounted.current = true;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    dialogRef.current?.showModal();
    return () => {
      mounted.current = false;
      downloadController.current?.abort();
      dialogRef.current?.close();
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  useEffect(() => {
    // Browser Back/Forward may select another photo without closing the viewer.
    // Handle that before interpreting a changed photo collection as a deletion.
    if (previousInitialId.current !== initialId) {
      previousInitialId.current = initialId;
      setCurrentId(initialId);
      return;
    }
    if (!photo) closeRef.current();
  }, [initialId, photo]);

  const changeView = useCallback((zoom: number, pan: Point) => {
    const nextZoom = Math.min(4, Math.max(1, zoom));
    const stage = stageRef.current;
    const image = imageRef.current;
    const maxX = Math.max(
      0,
      ((image?.clientWidth ?? 0) * nextZoom - (stage?.clientWidth ?? 0)) / 2,
    );
    const maxY = Math.max(
      0,
      ((image?.clientHeight ?? 0) * nextZoom - (stage?.clientHeight ?? 0)) / 2,
    );
    const next = {
      zoom: nextZoom,
      pan: {
        x: nextZoom === 1 ? 0 : Math.max(-maxX, Math.min(maxX, pan.x)),
        y: nextZoom === 1 ? 0 : Math.max(-maxY, Math.min(maxY, pan.y)),
      },
    };
    viewRef.current = next;
    setView(next);
  }, []);

  const navigate = useCallback(
    (direction: number) => {
      if (livePhotos.length < 2) return;
      const nextIndex =
        (index + direction + livePhotos.length) % livePhotos.length;
      const id = livePhotos[nextIndex].id;
      setCurrentId(id);
      onPhotoChange?.(id);
    },
    [index, livePhotos, onPhotoChange],
  );

  useEffect(() => {
    const next = normalView();
    viewRef.current = next;
    setView(next);
    setLoaded(false);
    setImageError(false);
    setDownloadError('');
    setShareNotice('');
    pointers.current.clear();
    gesture.current = null;
  }, [currentId, photo?.original_path]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.deltaY) return;
      const current = viewRef.current;
      changeView(current.zoom * Math.exp(-event.deltaY * 0.002), current.pan);
    };
    const onResize = () => {
      const current = viewRef.current;
      changeView(current.zoom, current.pan);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    };
  }, [changeView]);

  const beginPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const current = viewRef.current;
    if (pointers.current.size === 1) {
      gesture.current = {
        start: point,
        pan: current.pan,
        zoom: current.zoom,
        distance: 0,
        pinched: false,
      };
    } else if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.distance = distance(a, b);
      gesture.current.zoom = current.zoom;
      gesture.current.pinched = true;
    }
  };

  const movePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    const activeGesture = gesture.current;
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      if (activeGesture.distance > 0)
        changeView(
          activeGesture.zoom * (distance(a, b) / activeGesture.distance),
          viewRef.current.pan,
        );
    } else if (viewRef.current.zoom > 1) {
      changeView(viewRef.current.zoom, {
        x: activeGesture.pan.x + point.x - activeGesture.start.x,
        y: activeGesture.pan.y + point.y - activeGesture.start.y,
      });
    }
  };

  const endPointer = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    const activeGesture = gesture.current;
    if (pointers.current.size === 1 && activeGesture) {
      const remaining = [...pointers.current.values()][0];
      activeGesture.start = remaining;
      activeGesture.pan = viewRef.current.pan;
      activeGesture.zoom = viewRef.current.zoom;
      activeGesture.pinched = true;
    } else if (pointers.current.size === 0) {
      if (
        activeGesture &&
        !cancelled &&
        !activeGesture.pinched &&
        viewRef.current.zoom === 1
      ) {
        const dx = event.clientX - activeGesture.start.x;
        const dy = event.clientY - activeGesture.start.y;
        if (Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.25)
          navigate(dx < 0 ? 1 : -1);
      }
      gesture.current = null;
    }
  };

  const download = async () => {
    if (!photo || !online || downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setDownloadError('');
    try {
      const response = await fetch(photoUrl(photo.original_path), {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('download');
      const blob = await response.blob();
      if (!blob.size) throw new Error('empty');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download =
        photo.filename.replace(/[\\/\u0000-\u001f]/g, '_') || 'anh-doi';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (!controller.signal.aborted && mounted.current)
        setDownloadError(
          'Không thể tải file trực tiếp. Bạn có thể mở ảnh gốc để lưu từ trình duyệt.',
        );
    } finally {
      downloadController.current = null;
      if (mounted.current) setDownloading(false);
    }
  };

  const originalUrl = photo ? photoUrl(photo.original_path) : '';
  const thumbStart = Math.max(0, Math.min(index - 3, livePhotos.length - 7));
  const visibleThumbnails = livePhotos.slice(thumbStart, thumbStart + 7);
  const photoDate = photo?.created_at
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(photo.created_at))
    : '';

  return (
    <dialog
      ref={dialogRef}
      className="album-lightbox"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          navigate(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          navigate(1);
        } else if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          changeView(viewRef.current.zoom + 0.5, viewRef.current.pan);
        } else if (event.key === '-') {
          event.preventDefault();
          changeView(viewRef.current.zoom - 0.5, viewRef.current.pan);
        } else if (event.key === '0') {
          changeView(1, { x: 0, y: 0 });
        }
      }}
    >
      <header className="album-lightbox-top">
        <div className="album-lightbox-heading">
          <span>ALBUM ĐỘI</span>
          <h2 id={headingId}>{photo?.filename || 'Xem ảnh'}</h2>
        </div>
        <span className="album-lightbox-count" aria-live="polite">
          {photo ? index + 1 : 0} / {livePhotos.length}
        </span>
        <button
          type="button"
          className="album-lightbox-icon album-lightbox-close"
          onClick={onClose}
          aria-label="Đóng ảnh lớn"
          autoFocus
        >
          <X size={24} />
        </button>
      </header>

      <div className="album-lightbox-viewport">
        <div
          ref={stageRef}
          className={`album-lightbox-stage${view.zoom > 1 ? ' is-zoomed' : ''}`}
          role="group"
          aria-label="Ảnh lớn; vuốt ngang để chuyển ảnh, chụm hai ngón để phóng to"
          aria-describedby={hintId}
          onPointerDown={beginPointer}
          onPointerMove={movePointer}
          onPointerUp={(event) => endPointer(event)}
          onPointerCancel={(event) => endPointer(event, true)}
          onDoubleClick={() =>
            changeView(view.zoom > 1 ? 1 : 2, { x: 0, y: 0 })
          }
        >
          {photo && !imageError && (
            <img
              ref={imageRef}
              key={`${photo.id}:${photo.original_path}:${retry}`}
              className={`album-lightbox-image${loaded ? ' is-loaded' : ''}`}
              src={originalUrl}
              alt={photo.caption || photo.filename}
              draggable={false}
              decoding="async"
              fetchPriority="high"
              onLoad={() => {
                setLoaded(true);
                const current = viewRef.current;
                changeView(current.zoom, current.pan);
              }}
              onError={() => {
                setImageError(true);
                setLoaded(false);
              }}
              style={{
                transform: `translate3d(${view.pan.x}px, ${view.pan.y}px, 0) scale(${view.zoom})`,
              }}
            />
          )}
          {!loaded && !imageError && photo && (
            <span className="album-lightbox-loading" role="status">
              <LoaderCircle size={25} aria-hidden="true" /> Đang tải ảnh gốc…
            </span>
          )}
          {imageError && (
            <div className="album-lightbox-image-error" role="alert">
              <p>
                {online
                  ? 'Chưa tải được ảnh gốc.'
                  : 'Bạn đang mất mạng. Kết nối lại để xem ảnh gốc.'}
              </p>
              <button
                type="button"
                disabled={!online}
                onClick={() => {
                  setImageError(false);
                  setRetry((value) => value + 1);
                }}
              >
                <RotateCcw size={16} /> Thử tải lại
              </button>
            </div>
          )}
        </div>
        {livePhotos.length > 1 && (
          <>
            <button
              type="button"
              className="album-lightbox-icon album-lightbox-prev"
              aria-label="Ảnh trước"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft size={27} />
            </button>
            <button
              type="button"
              className="album-lightbox-icon album-lightbox-next"
              aria-label="Ảnh sau"
              onClick={() => navigate(1)}
            >
              <ChevronRight size={27} />
            </button>
          </>
        )}
      </div>

      <div className="album-lightbox-controls">
        <div
          className="album-lightbox-zoom"
          role="group"
          aria-label="Phóng to ảnh"
        >
          <button
            type="button"
            className="album-lightbox-icon"
            disabled={view.zoom <= 1 || !loaded}
            onClick={() => changeView(view.zoom - 0.5, view.pan)}
            aria-label="Thu nhỏ"
          >
            <ZoomOut size={19} />
          </button>
          <output aria-live="polite" aria-label="Mức phóng to">
            {Math.round(view.zoom * 100)}%
          </output>
          <button
            type="button"
            className="album-lightbox-icon"
            disabled={view.zoom >= 4 || !loaded}
            onClick={() => changeView(view.zoom + 0.5, view.pan)}
            aria-label="Phóng to"
          >
            <ZoomIn size={19} />
          </button>
          <button
            type="button"
            className="album-lightbox-icon"
            disabled={view.zoom === 1}
            onClick={() => changeView(1, { x: 0, y: 0 })}
            aria-label="Đặt lại kích thước"
          >
            <RotateCcw size={17} />
          </button>
        </div>
        <div className="album-lightbox-actions">
          {photo && onShare && (
            <button
              type="button"
              className="album-lightbox-icon"
              aria-label="Sao chép liên kết ảnh"
              title="Sao chép liên kết ảnh"
              disabled={sharing}
              onClick={async () => {
                setSharing(true);
                setShareNotice('');
                try {
                  await onShare(photo);
                  if (mounted.current) setShareNotice('Đã sao chép liên kết ảnh. Có thể gửi vào nhóm Zalo.');
                } catch {
                  if (mounted.current) setShareNotice('Chưa sao chép được. Hãy sao chép địa chỉ trên trình duyệt để chia sẻ ảnh.');
                } finally {
                  if (mounted.current) setSharing(false);
                }
              }}
            >
              <Link2 size={18} />
            </button>
          )}
          {photo && onEdit && (
            <button
              type="button"
              className="album-lightbox-icon"
              aria-label="Sửa chú thích ảnh"
              title="Sửa chú thích ảnh"
              disabled={!online}
              onClick={() => onEdit(photo)}
            >
              <Pencil size={18} />
            </button>
          )}
          {photo && onTrash && (
            <button
              type="button"
              className="album-lightbox-icon"
              aria-label="Chuyển ảnh vào Thùng rác"
              title="Chuyển ảnh vào Thùng rác"
              disabled={!online}
              onClick={() => onTrash(photo)}
            >
              <Trash2 size={18} />
            </button>
          )}
          <button
            type="button"
            className="album-lightbox-download"
            aria-label={downloading ? 'Đang tải ảnh' : 'Tải ảnh'}
            disabled={!photo || !online || downloading}
            onClick={download}
          >
            {downloading ? (
              <LoaderCircle size={17} className="album-lightbox-spin" />
            ) : (
              <Download size={17} />
            )}
            <span>{downloading ? 'Đang tải…' : 'Tải ảnh'}</span>
          </button>
        </div>
      </div>

      <footer className="album-lightbox-footer">
        {shareNotice && <p className="album-lightbox-share-notice" role="status">{shareNotice}</p>}
        {downloadError && (
          <p className="album-lightbox-download-error" role="alert">
            {downloadError}{' '}
            <a href={originalUrl} target="_blank" rel="noopener noreferrer">
              Mở ảnh gốc <ExternalLink size={12} />
            </a>
          </p>
        )}
        <div className="album-lightbox-caption">
          <p>{photo?.caption || 'Chưa có chú thích'}</p>
          <span>Đăng ngày {photoDate}</span>
        </div>
        {livePhotos.length > 1 && (
          <nav
            className="album-lightbox-thumbnails"
            aria-label="Chọn ảnh trong album"
          >
            {visibleThumbnails.map((item, itemIndex) => (
              <button
                type="button"
                key={item.id}
                aria-label={`Xem ảnh ${thumbStart + itemIndex + 1}`}
                aria-current={item.id === currentId ? 'true' : undefined}
                onClick={() => {
                  setCurrentId(item.id);
                  onPhotoChange?.(item.id);
                }}
              >
                <img
                  src={photoUrl(item.thumbnail_path)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </button>
            ))}
          </nav>
        )}
        <p id={hintId} className="album-lightbox-hint">
          Vuốt ngang hoặc dùng phím ← → để chuyển ảnh · Chụm hai ngón hoặc bấm +
          để phóng to
        </p>
      </footer>
    </dialog>
  );
}

export default AlbumLightbox;
