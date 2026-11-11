import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  Move,
} from 'lucide-react';
import type { AlbumPhoto } from './albumTypes';
import { albumPhotoUrl } from './albumMedia';
import {
  createAlbumFlight,
  sampleAlbumFlight,
  sampleAlbumWorld,
  flightTransform,
  photoTransform,
  type AlbumFlightProfile,
} from './albumFlight';

type DeviceNavigator = Navigator & {
  connection?: EventTarget & { saveData?: boolean };
  deviceMemory?: number;
};
function lightDevice() {
  const device = navigator as DeviceNavigator;
  return (
    matchMedia('(max-width: 700px)').matches ||
    !!device.connection?.saveData ||
    (device.deviceMemory ?? 8) <= 4 ||
    (navigator.hardwareConcurrency || 8) <= 4
  );
}
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.2;
const RAD_TO_DEG = 180 / Math.PI;
type FlightNodes = { slot?: HTMLDivElement; photo?: HTMLButtonElement };
type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  yaw: number;
  pitch: number;
  photoId: string | null;
  dragging: boolean;
  scrolling: boolean;
};
type Pinch = { ids: [number, number]; distance: number; zoom: number };

/** The original universe's paths, camera drag, momentum and zoom, using shared album data. */
export function AlbumSpace({
  photos,
  enabled,
  onOpen,
  photoUrl = albumPhotoUrl,
}: {
  photos: AlbumPhoto[];
  enabled: boolean;
  onOpen: (id: string) => void;
  photoUrl?: (path: string) => string;
}) {
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [light, setLight] = useState(lightDevice);
  const [inView, setInView] = useState(true);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  const [opening, setOpening] = useState(false);
  // Static mode starts at the settled layout, rather than freezing the entrance.
  const skipEntrance = useRef(!enabled || reduced);
  const [expanded, setExpanded] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [offset, setOffset] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const perspective = useRef<HTMLDivElement>(null);
  const cameraNode = useRef<HTMLDivElement>(null);
  const worldNode = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const frame = useRef<number | null>(null);
  const running = useRef(false);
  const elapsed = useRef(0);
  const previousFrame = useRef<number | null>(null);
  const lastPaint = useRef<number | null>(null);
  const previousEnabled = useRef(enabled);
  const bounds = useRef({
    width: Math.max(260, Math.min(window.innerWidth - 40, 1340)),
    height: 600,
  });
  const nodes = useRef(new Map<string, FlightNodes>());
  const profiles = useRef(new Map<string, AlbumFlightProfile>());
  const angles = useRef({
    yaw: 0,
    pitch: 0,
    yawVelocity: 0,
    pitchVelocity: 0,
    zoom: 1,
  });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<Drag | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const suppressClick = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = light ? 9 : 8;
  const visible = useMemo(
    () =>
      Array.from(
        { length: Math.min(count, photos.length) },
        (_, i) => photos[(offset + i) % photos.length],
      ),
    [photos, count, offset],
  );
  const visibleKey = visible.map((photo) => photo.id).join(',');
  for (const photo of visible) {
    if (!profiles.current.has(photo.id))
      profiles.current.set(
        photo.id,
        createAlbumFlight(photo.id, profiles.current.size),
      );
  }
  const live = useRef({ visible, light, reduced, opening });
  live.current = { visible, light, reduced, opening };
  const moving =
    enabled &&
    !paused &&
    !hidden &&
    !reduced &&
    inView &&
    !focused &&
    !hovered &&
    !held &&
    !opening;

  const stop = useCallback(() => {
    running.current = false;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    previousFrame.current = null;
  }, []);

  const paintCamera = useCallback(() => {
    const world = sampleAlbumWorld(elapsed.current);
    const camera = angles.current;
    if (worldNode.current)
      worldNode.current.style.transform =
        'rotateX(' +
        (camera.pitch * RAD_TO_DEG).toFixed(3) +
        'deg) rotateY(' +
        (world.rotateY + camera.yaw * RAD_TO_DEG).toFixed(3) +
        'deg)';
    if (cameraNode.current)
      cameraNode.current.style.transform =
        'scale(' + camera.zoom.toFixed(3) + ')';
  }, []);

  const paint = useCallback(() => {
    paintCamera();
    const entrance =
      skipEntrance.current || live.current.reduced
        ? 1
        : Math.min(1, elapsed.current / 2.65);
    for (const photo of live.current.visible) {
      const elements = nodes.current.get(photo.id);
      const profile = profiles.current.get(photo.id);
      if (!elements || !profile) continue;
      const pose = sampleAlbumFlight(
        profile,
        elapsed.current,
        bounds.current,
        live.current.light,
        entrance,
      );
      if (elements.slot) elements.slot.style.transform = flightTransform(pose);
      if (elements.photo) elements.photo.style.transform = photoTransform(pose);
    }
  }, [paintCamera]);

  const updateZoom = useCallback(
    (value: number) => {
      if (!Number.isFinite(value)) return;
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
      angles.current.zoom = zoom;
      setZoomPercent(Math.round(zoom * 100));
      paintCamera();
    },
    [paintCamera],
  );

  useLayoutEffect(() => {
    const element = perspective.current;
    if (!element) return;
    const resize = () => {
      const rect = element.getBoundingClientRect();
      bounds.current = {
        width:
          element.clientWidth ||
          rect.width ||
          Math.max(260, Math.min(window.innerWidth - 40, 1340)),
        height: element.clientHeight || rect.height || 600,
      };
      paint();
    };
    resize();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(element);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [paint, expanded]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = matchMedia('(max-width: 700px)');
    const connection = (navigator as DeviceNavigator).connection;
    const clearGesture = () => {
      pointers.current.clear();
      drag.current = null;
      pinch.current = null;
      suppressClick.current = false;
      if (suppressTimer.current !== null) clearTimeout(suppressTimer.current);
      suppressTimer.current = null;
      angles.current.yawVelocity = 0;
      angles.current.pitchVelocity = 0;
      setHeld(false);
      setHovered(false);
    };
    const update = () => {
      if (media.matches) {
        stop();
        clearGesture();
      }
      setReduced(media.matches);
      setLight(lightDevice());
    };
    const visibility = () => {
      if (document.hidden) {
        stop();
        clearGesture();
      }
      setHidden(document.hidden);
    };
    media.addEventListener('change', update);
    mobile.addEventListener('change', update);
    connection?.addEventListener('change', update);
    document.addEventListener('visibilitychange', visibility);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              if (!entry) return;
              if (!entry.isIntersecting) stop();
              setInView(entry.isIntersecting);
            },
            { rootMargin: '120px' },
          );
    if (perspective.current) observer?.observe(perspective.current);
    return () => {
      media.removeEventListener('change', update);
      mobile.removeEventListener('change', update);
      connection?.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', visibility);
      observer?.disconnect();
    };
  }, [stop, expanded]);

  useEffect(() => {
    const element = perspective.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (live.current.opening) return;
      // The embedded universe must not trap ordinary page scrolling.
      if (!expanded && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      updateZoom(angles.current.zoom * Math.exp(-event.deltaY * 0.001));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [expanded, updateZoom]);

  useEffect(() => {
    if (enabled && !previousEnabled.current) {
      setOpening(false);
      setHovered(false);
      setHeld(false);
      setFocused(false);
    }
    previousEnabled.current = enabled;
  }, [enabled]);

  useLayoutEffect(() => {
    stop();
    paintCamera();
    if (!moving || !live.current.visible.length) return;
    running.current = true;
    lastPaint.current = null;
    const tick = (now: number) => {
      frame.current = null;
      if (!running.current) return;
      const delta =
        previousFrame.current === null
          ? 0
          : Math.max(0, Math.min(now - previousFrame.current, 50));
      previousFrame.current = now;
      elapsed.current += delta / 1000;
      const camera = angles.current;
      camera.yaw += camera.yawVelocity * delta;
      camera.pitch = Math.max(
        -0.42,
        Math.min(0.42, camera.pitch + camera.pitchVelocity * delta),
      );
      const friction = Math.exp(-delta / 950);
      camera.yawVelocity *= friction;
      camera.pitchVelocity *= friction;
      if (
        lastPaint.current === null ||
        !live.current.light ||
        now - lastPaint.current >= 1000 / 30
      ) {
        paint();
        lastPaint.current = now;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return stop;
  }, [moving, light, visibleKey, expanded, paint, stop]);

  useEffect(() => {
    if (!moving || photos.length <= count) return;
    let transition: ReturnType<typeof setTimeout> | undefined;
    // Keep a batch on screen long enough to explore it before introducing others.
    const rotation = setInterval(() => {
      setTransitioning(true);
      transition = setTimeout(() => {
        setOffset((value) => (value + count) % photos.length);
        setTransitioning(false);
      }, 450);
    }, 36_000);
    return () => {
      clearInterval(rotation);
      clearTimeout(transition);
      setTransitioning(false);
    };
  }, [moving, photos.length, count]);

  useEffect(() => {
    if (!expanded) return;
    // The photo viewer owns its body lock. Lock the viewport separately so
    // either overlay can unmount first after a realtime photo deletion.
    const scrollRoot = document.documentElement;
    const overflow = scrollRoot.style.overflow;
    scrollRoot.style.overflow = 'hidden';
    stage.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (live.current.opening) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setExpanded(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const targets = Array.from(
        stage.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ??
          [],
      );
      if (!targets.length) {
        event.preventDefault();
        stage.current?.focus();
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === stage.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === stage.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      scrollRoot.style.overflow = overflow;
      document.removeEventListener('keydown', keyboard);
      expandButton.current?.focus();
    };
  }, [expanded]);

  useEffect(
    () => () => {
      if (suppressTimer.current !== null) clearTimeout(suppressTimer.current);
    },
    [],
  );

  function register(
    id: string,
    key: keyof FlightNodes,
    node: HTMLDivElement | HTMLButtonElement | null,
  ) {
    const entry = nodes.current.get(id) ?? {};
    if (key === 'slot')
      entry.slot = node ? (node as HTMLDivElement) : undefined;
    else entry.photo = node ? (node as HTMLButtonElement) : undefined;
    if (!entry.slot && !entry.photo) nodes.current.delete(id);
    else nodes.current.set(id, entry);
  }
  function suppressPointerClick() {
    suppressClick.current = true;
    if (suppressTimer.current !== null) clearTimeout(suppressTimer.current);
    suppressTimer.current = setTimeout(() => {
      suppressClick.current = false;
      suppressTimer.current = null;
    }, 0);
  }
  function openPhoto(id: string) {
    stop();
    setOpening(true);
    setHeld(false);
    setHovered(false);
    angles.current.yawVelocity = 0;
    angles.current.pitchVelocity = 0;
    pointers.current.clear();
    drag.current = null;
    pinch.current = null;
    onOpen(id);
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      live.current.opening ||
      (event.pointerType === 'mouse' && event.button !== 0)
    )
      return;
    stop();
    setHeld(true);
    setHovered(false);
    setFocused(false);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    angles.current.yawVelocity = 0;
    angles.current.pitchVelocity = 0;
    if (pointers.current.size >= 2 && !expanded) {
      // Full gesture control is available in fullscreen; the embedded scene
      // leaves native vertical gestures to the surrounding page.
      if (drag.current) drag.current.scrolling = true;
      setHeld(false);
      return;
    }
    if (pointers.current.size >= 2) {
      const ids = Array.from(pointers.current.keys()).slice(0, 2) as [
        number,
        number,
      ];
      const a = pointers.current.get(ids[0])!;
      const b = pointers.current.get(ids[1])!;
      pinch.current = {
        ids,
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        zoom: angles.current.zoom,
      };
      drag.current = null;
      suppressClick.current = true;
      event.preventDefault();
    } else {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('[data-album-photo]')
          : null;
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: performance.now(),
        yaw: angles.current.yaw,
        pitch: angles.current.pitch,
        photoId: button?.dataset.albumPhoto ?? null,
        dragging: false,
        scrolling: false,
      };
    }
    if (!expanded && event.pointerType !== 'mouse') return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* Detached/canceled pointer. */
    }
  }
  function moveSpace(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = pointers.current.get(event.pointerId);
    if (pointer) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }
    const gesture = pinch.current;
    if (gesture) {
      const a = pointers.current.get(gesture.ids[0]);
      const b = pointers.current.get(gesture.ids[1]);
      if (a && b) {
        event.preventDefault();
        updateZoom(
          (gesture.zoom * Math.hypot(b.x - a.x, b.y - a.y)) / gesture.distance,
        );
      }
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.scrolling) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.dragging && Math.hypot(dx, dy) > 8) {
      if (!expanded && event.pointerType !== 'mouse' && Math.abs(dy) > Math.abs(dx)) {
        current.scrolling = true;
        current.photoId = null;
        setHeld(false);
        return;
      }
      current.dragging = true;
      suppressClick.current = true;
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        /* A native scrolling gesture may already have canceled the pointer. */
      }
    }
    if (!current.dragging) return;
    event.preventDefault();
    const now = performance.now();
    const duration = Math.max(1, now - current.lastTime);
    const camera = angles.current;
    camera.yaw = current.yaw + dx * 0.0054;
    camera.pitch = Math.max(-0.42, Math.min(0.42, current.pitch + dy * 0.0033));
    camera.yawVelocity = Math.max(
      -0.006,
      Math.min(0.006, ((event.clientX - current.lastX) * 0.0054) / duration),
    );
    camera.pitchVelocity = Math.max(
      -0.004,
      Math.min(0.004, ((event.clientY - current.lastY) * 0.0033) / duration),
    );
    current.lastX = event.clientX;
    current.lastY = event.clientY;
    current.lastTime = now;
    paintCamera();
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>, canceled = false) {
    pointers.current.delete(event.pointerId);
    const current = drag.current;
    const wasPinch = !!pinch.current;
    if (pinch.current?.ids.includes(event.pointerId)) {
      pinch.current = null;
      drag.current = null;
    }
    if (current?.pointerId === event.pointerId) {
      drag.current = null;
      if (
        !canceled &&
        !wasPinch &&
        !current.dragging &&
        !current.scrolling &&
        !suppressClick.current &&
        current.photoId
      )
        openPhoto(current.photoId);
    }
    if (!pointers.current.size) {
      setHeld(false);
      if (wasPinch || current?.dragging || canceled || suppressClick.current) {
        if (canceled) {
          angles.current.yawVelocity = 0;
          angles.current.pitchVelocity = 0;
        }
        suppressPointerClick();
      } else if (current?.photoId) suppressPointerClick();
    }
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* Pointer already released. */
    }
  }

  const view = (
    <div
      ref={stage}
      tabIndex={expanded ? -1 : undefined}
      className={[
        'album-float-stage',
        'album-space-stage',
        light && 'album-float-light',
        moving ? 'is-moving' : 'is-paused',
        transitioning && 'is-changing',
        expanded && 'is-expanded',
      ]
        .filter(Boolean)
        .join(' ')}
      role={expanded ? 'dialog' : 'region'}
      aria-modal={expanded ? true : undefined}
      aria-label={
        expanded ? 'Không gian ảnh toàn màn hình' : 'Không gian ảnh 3D của đội'
      }
    >
      <div className="album-space-nebula" aria-hidden="true" />
      <div className="album-space-stars" aria-hidden="true">
        {Array.from({ length: light ? 16 : 58 }, (_, index) => (
          <span
            key={index}
            className="album-space-star"
            style={{
              left: ((index * 37.71 + 11) % 100).toFixed(2) + '%',
              top: ((index * 61.37 + 7) % 100).toFixed(2) + '%',
              animationDelay: (index % 12) * -0.63 + 's',
              opacity: 0.25 + ((index * 5) % 8) / 10,
            }}
          />
        ))}
        <span className="album-space-streak album-space-streak-one" />
        <span className="album-space-streak album-space-streak-two" />
      </div>
      <div className="album-flight-intro">
        <span>CẦU LÔNG VÀ NHỮNG NGƯỜI BẠN</span>
        <strong>Vũ trụ của đội.</strong>
        <p>Mỗi khoảnh khắc, một vì sao.</p>
      </div>
      <div className="album-space-tools">
        <span className="album-flight-count">{photos.length} ảnh</span>
        <button
          ref={expandButton}
          type="button"
          onClick={() => {
            setHovered(false);
            setFocused(false);
            setExpanded((value) => !value);
          }}
          aria-label={expanded ? 'Thoát toàn màn hình' : 'Mở toàn màn hình'}
          title={expanded ? 'Thu gọn' : 'Khám phá toàn màn hình'}
        >
          {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>
      <div
        className="album-flight-perspective"
        ref={perspective}
        aria-label="Không gian ảnh 3D. Kéo để xoay, chụm hai ngón để thu phóng."
        onPointerDown={startDrag}
        onPointerMove={moveSpace}
        onPointerUp={(event) => endDrag(event)}
        onPointerCancel={(event) => endDrag(event, true)}
        onLostPointerCapture={(event) => {
          if (pointers.current.has(event.pointerId)) endDrag(event, true);
        }}
      >
        <div className="album-flight-camera" ref={cameraNode}>
          <div className="album-flight-world" ref={worldNode}>
            {visible.map((photo) => {
              const pose = sampleAlbumFlight(
                profiles.current.get(photo.id)!,
                elapsed.current,
                bounds.current,
                light,
                skipEntrance.current || reduced
                  ? 1
                  : Math.min(1, elapsed.current / 2.65),
              );
              return (
                <div
                  key={photo.id}
                  className="album-flight-slot"
                  ref={(node) => register(photo.id, 'slot', node)}
                  style={{ transform: flightTransform(pose) } as CSSProperties}
                >
                  <button
                    type="button"
                    className="album-flight-photo"
                    data-album-photo={photo.id}
                    ref={(node) => register(photo.id, 'photo', node)}
                    style={{ transform: photoTransform(pose) }}
                    aria-label={'Xem ảnh: ' + (photo.caption || photo.filename)}
                    onPointerEnter={(event) => {
                      if (
                        event.pointerType === 'mouse' &&
                        !pointers.current.size
                      ) {
                        stop();
                        setHovered(true);
                      }
                    }}
                    onPointerLeave={() => setHovered(false)}
                    onFocus={(event) => {
                      if (event.currentTarget.matches(':focus-visible')) {
                        stop();
                        setFocused(true);
                      }
                    }}
                    onBlur={() => setFocused(false)}
                    onClick={(event) => {
                      if (event.detail === 0 && !suppressClick.current)
                        openPhoto(photo.id);
                    }}
                  >
                    <span className="album-flight-face album-flight-front">
                      <img
                        src={photoUrl(photo.thumbnail_path)}
                        alt={photo.caption || photo.filename}
                        decoding="async"
                        draggable={false}
                      />
                      <span className="album-flight-caption">
                        {photo.caption || 'Khoảnh khắc của đội'}
                      </span>
                    </span>
                    <span
                      className="album-flight-face album-flight-front album-flight-back"
                      aria-hidden="true"
                    >
                      <img
                        src={photoUrl(photo.thumbnail_path)}
                        alt=""
                        decoding="async"
                        draggable={false}
                      />
                      <span className="album-flight-caption">
                        {photo.caption || 'Khoảnh khắc của đội'}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div
        className="album-space-zoom"
        role="group"
        aria-label="Thu phóng không gian ảnh"
      >
        <button
          type="button"
          aria-label="Thu nhỏ không gian ảnh"
          disabled={zoomPercent <= Math.round(MIN_ZOOM * 100)}
          onClick={() => updateZoom(angles.current.zoom - 0.15)}
        >
          <Minus size={18} />
        </button>
        <button
          type="button"
          aria-label="Đặt lại góc nhìn"
          title="Đặt lại góc nhìn"
          onClick={() => {
            angles.current.yaw = 0;
            angles.current.pitch = 0;
            angles.current.yawVelocity = 0;
            angles.current.pitchVelocity = 0;
            updateZoom(1);
          }}
        >
          <span aria-label="Mức thu phóng không gian ảnh">{zoomPercent}%</span>
        </button>
        <button
          type="button"
          aria-label="Phóng to không gian ảnh"
          disabled={zoomPercent >= Math.round(MAX_ZOOM * 100)}
          onClick={() => updateZoom(angles.current.zoom + 0.15)}
        >
          <Plus size={18} />
        </button>
      </div>
      <p className="album-space-hint">
        <Move size={14} aria-hidden="true" />
        <span>{expanded ? 'Kéo để xoay · Cuộn hoặc chụm để thu phóng · Chạm ảnh để xem' : 'Vuốt dọc để cuộn · Kéo ngang để xoay · Mở toàn màn hình để khám phá'}</span>
      </p>
      <div className="album-float-controls">
        <span>
          {hidden
            ? 'Tạm dừng khi ẩn tab'
            : reduced
              ? 'Chế độ giảm chuyển động'
              : !enabled || opening
                ? 'Đang tạm dừng chuyển động'
                : paused
                  ? 'Đã dừng chuyển động'
                  : focused || hovered || held
                    ? 'Đang khám phá không gian'
                    : !inView
                      ? 'Tạm dừng ngoài màn hình'
                      : visible.length +
                        ' ảnh · Không gian 3D / 360°' +
                        (light ? ' · Chế độ nhẹ' : '')}
        </span>
        <button
          type="button"
          onClick={() => {
            if (!paused) stop();
            setPaused((value) => !value);
          }}
          aria-pressed={paused}
          disabled={reduced || !enabled || opening}
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
          {paused ? 'Tiếp tục' : 'Dừng chuyển động'}
        </button>
      </div>
    </div>
  );
  return expanded ? createPortal(view, document.body) : view;
}
