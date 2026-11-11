import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { AlbumPhoto } from '../src/albumTypes';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://album.test/',
  pretendToBeVisual: true,
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });

let hidden = false;
Object.defineProperty(document, 'hidden', {
  configurable: true,
  get: () => hidden,
});
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => (hidden ? 'hidden' : 'visible'),
});
Object.defineProperty(navigator, 'hardwareConcurrency', {
  configurable: true,
  value: 8,
});
Object.defineProperty(navigator, 'deviceMemory', {
  configurable: true,
  value: 8,
});

class MediaQueryDouble extends dom.window.EventTarget {
  matches = false;
  media: string;
  onchange: ((event: MediaQueryListEvent) => void) | null = null;
  listeners = new Set<EventListenerOrEventListenerObject>();
  constructor(media: string) {
    super();
    this.media = media;
  }
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type === 'change' && listener) this.listeners.add(listener);
    super.addEventListener(type, listener as EventListener, options);
  }
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (type === 'change' && listener) this.listeners.delete(listener);
    super.removeEventListener(type, listener as EventListener, options);
  }
  addListener(listener: EventListener) {
    this.addEventListener('change', listener);
  }
  removeListener(listener: EventListener) {
    this.removeEventListener('change', listener);
  }
  set(value: boolean) {
    this.matches = value;
    const event = new dom.window.Event('change');
    Object.defineProperties(event, {
      matches: { value },
      media: { value: this.media },
    });
    this.dispatchEvent(event);
  }
}
const mediaQueries = new Map<string, MediaQueryDouble>();
function media(query: string) {
  if (!mediaQueries.has(query))
    mediaQueries.set(query, new MediaQueryDouble(query));
  return mediaQueries.get(query)!;
}
const matchMedia = (query: string) => media(query) as unknown as MediaQueryList;
Object.defineProperty(globalThis, 'matchMedia', {
  value: matchMedia,
  configurable: true,
});
Object.defineProperty(dom.window, 'matchMedia', {
  value: matchMedia,
  configurable: true,
});

let frameId = 0;
let requested = 0;
let cancelled = 0;
const frames = new Map<number, FrameRequestCallback>();
function requestFrame(callback: FrameRequestCallback) {
  requested++;
  frames.set(++frameId, callback);
  return frameId;
}
function cancelFrame(id: number) {
  if (frames.delete(id)) cancelled++;
}
for (const target of [globalThis, dom.window]) {
  Object.defineProperty(target, 'requestAnimationFrame', {
    value: requestFrame,
    configurable: true,
  });
  Object.defineProperty(target, 'cancelAnimationFrame', {
    value: cancelFrame,
    configurable: true,
  });
}
const bounds = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 1000,
  bottom: 640,
  width: 1000,
  height: 640,
  toJSON: () => ({}),
};
dom.window.HTMLElement.prototype.getBoundingClientRect = () => bounds;
const resizeObservers: ResizeDouble[] = [];
class ResizeDouble {
  disconnected = false;
  constructor(private callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: bounds } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}
const intersectionObservers: IntersectionDouble[] = [];
class IntersectionDouble {
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback) {
    intersectionObservers.push(this);
  }
  observe(target: Element) {
    this.callback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: bounds,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}
for (const target of [globalThis, dom.window]) {
  Object.defineProperty(target, 'ResizeObserver', {
    value: ResizeDouble,
    configurable: true,
  });
  Object.defineProperty(target, 'IntersectionObserver', {
    value: IntersectionDouble,
    configurable: true,
  });
}
const { render, screen, fireEvent, cleanup, act } =
  await import('@testing-library/react');
const { AlbumSpace } = await import('../src/AlbumSpace');

const photos: AlbumPhoto[] = Array.from({ length: 12 }, (_, i) => ({
  id: `photo-${i}`,
  album_id: 'album-1',
  caption: `Kỷ niệm ${i + 1}`,
  original_path: `photos/photo-${i}/original.jpg`,
  thumbnail_path: `photos/photo-${i}/thumbnail.webp`,
  filename: `ky-niem-${i + 1}.jpg`,
  original_mime: 'image/jpeg',
  original_size: 5_000_000,
  width: 3000,
  height: 2000,
  version: 1,
  deleted_at: null,
  created_at: '2026-11-11T00:00:00Z',
  updated_at: '2026-11-11T00:00:00Z',
}));
function props(
  overrides: Partial<React.ComponentProps<typeof AlbumSpace>> = {},
) {
  return {
    photos,
    enabled: true,
    onOpen: () => {},
    photoUrl: (path: string) => `https://media.test/${path}`,
    ...overrides,
  };
}
async function step(timestamp: number) {
  await act(async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(timestamp);
  });
}
async function setHidden(value: boolean) {
  await act(async () => {
    hidden = value;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
  });
}
async function setMedia(query: string, value: boolean) {
  await act(async () => media(query).set(value));
}
function pointer(
  type: string,
  target: Element,
  id: number,
  x: number,
  y: number,
) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: id,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
  });
  fireEvent(target, event);
  return event;
}
function readZoom() {
  return parseInt(
    screen.getByLabelText('Mức thu phóng không gian ảnh').textContent!,
    10,
  );
}
function assertCameraScale(camera: HTMLElement, expected: number) {
  const match = camera.style.transform.match(/scale\(([^)]+)\)/);
  assert.ok(match, 'The camera has an actual scale transform');
  const scale = parseFloat(match[1]);
  assert.ok(
    Number.isFinite(scale) && Math.abs(scale - expected) < 0.00001,
    `Expected camera scale ${expected}, received ${scale}`,
  );
}
beforeEach(() => {
  hidden = false;
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  document.body.style.overscrollBehavior = '';
  frameId = requested = cancelled = 0;
  frames.clear();
  resizeObservers.length = intersectionObservers.length = 0;
  for (const query of mediaQueries.values()) query.matches = false;
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    configurable: true,
    value: 8,
  });
  Object.defineProperty(navigator, 'deviceMemory', {
    configurable: true,
    value: 8,
  });
});
afterEach(() => {
  cleanup();
  assert.equal(frames.size, 0, 'Unmount cancels every animation frame');
  for (const observer of [...resizeObservers, ...intersectionObservers])
    assert.equal(
      observer.disconnected,
      true,
      'Unmount disconnects each scene observer',
    );
  for (const query of mediaQueries.values())
    assert.equal(
      query.listeners.size,
      0,
      'Unmount removes media-change listeners',
    );
});

test('The scene keeps exactly one RAF chain under StrictMode and changes world, XYZ placement and X/Y rotation over time', async () => {
  let commits = 0;
  const { container } = render(
    <React.StrictMode>
      <React.Profiler id="album-motion" onRender={() => commits++}>
        <AlbumSpace {...props()} />
      </React.Profiler>
    </React.StrictMode>,
  );
  assert.equal(frames.size, 1);
  const world = container.querySelector<HTMLElement>('.album-flight-world')!;
  const slot = container.querySelector<HTMLElement>('.album-flight-slot')!;
  const card = container.querySelector<HTMLElement>('.album-flight-photo')!;
  assert.ok(
    world && slot && card,
    'The perspective scene exposes separate world, position and photo transforms',
  );
  await step(1000);
  const initial = [
    world.style.transform,
    slot.style.transform,
    card.style.transform,
  ];
  const initialCommits = commits;
  for (let i = 1; i <= 180; i++) {
    await step(1000 + i * 16);
    assert.equal(frames.size, 1, 'Each frame schedules one successor');
  }
  const moved = [
    world.style.transform,
    slot.style.transform,
    card.style.transform,
  ];
  for (let i = 0; i < initial.length; i++)
    assert.notEqual(moved[i], initial[i]);
  assert.match(moved[1], /translate3d\(/);
  const xyz = (transform: string) =>
    transform
      .match(/translate3d\(([^)]+)\)/)![1]
      .split(',')
      .map(parseFloat);
  const initialPosition = xyz(initial[1]);
  const movedPosition = xyz(moved[1]);
  for (let coordinate = 0; coordinate < 3; coordinate++) {
    assert.ok(Number.isFinite(movedPosition[coordinate]));
    assert.notEqual(
      movedPosition[coordinate],
      initialPosition[coordinate],
      `Coordinate ${['X', 'Y', 'Z'][coordinate]} advances`,
    );
  }
  assert.match(moved[2], /rotateX\(/);
  assert.match(moved[2], /rotateY\(/);
  assert.ok(requested >= 181);
  assert.equal(
    commits,
    initialCommits,
    'Animation frames mutate transforms without React rendering every frame',
  );
});

test('Manual pause immediately cancels the frame and resume excludes elapsed wall time while paused', async () => {
  const { container } = render(<AlbumSpace {...props()} />);
  await step(1000);
  await step(1016);
  const world = container.querySelector<HTMLElement>('.album-flight-world')!;
  const card = container.querySelector<HTMLElement>('.album-flight-photo')!;
  const before = [world.style.transform, card.style.transform];
  fireEvent.click(screen.getByRole('button', { name: /Dừng chuyển động/ }));
  assert.equal(frames.size, 0);
  assert.ok(cancelled > 0);
  await step(500_000);
  assert.deepEqual([world.style.transform, card.style.transform], before);
  fireEvent.click(screen.getByRole('button', { name: /Tiếp tục/ }));
  assert.equal(frames.size, 1);
  await step(1_000_000);
  assert.deepEqual(
    [world.style.transform, card.style.transform],
    before,
    'The first resumed frame establishes a fresh timestamp',
  );
  await step(1_000_016);
  assert.notEqual(card.style.transform, before[1]);
});

test('Hidden tabs, reduced motion and enabled=false stop the same RAF chain and resume without duplicates', async () => {
  const view = render(<AlbumSpace {...props()} />);
  await step(1000);
  assert.equal(frames.size, 1);
  await setHidden(true);
  assert.equal(frames.size, 0);
  await setHidden(false);
  assert.equal(frames.size, 1);
  await setMedia('(prefers-reduced-motion: reduce)', true);
  assert.equal(frames.size, 0);
  await setMedia('(prefers-reduced-motion: reduce)', false);
  assert.equal(frames.size, 1);
  view.rerender(<AlbumSpace {...props({ enabled: false })} />);
  assert.equal(frames.size, 0);
  view.rerender(<AlbumSpace {...props()} />);
  assert.equal(frames.size, 1);
  await step(100_000);
  assert.equal(frames.size, 1);
});

test('Opening a photo freezes frames before onOpen; only closing the external viewer resumes movement', async () => {
  let opened = '';
  let pendingAtOpen = -1;
  const options = props({
    onOpen: (id) => {
      opened = id;
      pendingAtOpen = frames.size;
    },
  });
  const view = render(<AlbumSpace {...options} />);
  await step(1000);
  const card = view.container.querySelector<HTMLButtonElement>(
    '.album-flight-photo',
  )!;
  fireEvent.click(card);
  assert.ok(opened.startsWith('photo-'));
  assert.equal(
    pendingAtOpen,
    0,
    'Motion stops synchronously before opening the viewer',
  );
  assert.equal(frames.size, 0);
  view.rerender(<AlbumSpace {...options} enabled={false} />);
  assert.equal(frames.size, 0);
  view.rerender(<AlbumSpace {...options} enabled />);
  assert.equal(frames.size, 1);
});

test('Desktop renders eight double-sided cards; mobile renders nine before rotating larger albums', async () => {
  const requestedPaths: string[] = [];
  const photoUrl = (path: string) => {
    requestedPaths.push(path);
    return `https://media.test/${path}`;
  };
  const view = render(<AlbumSpace {...props({ photoUrl })} />);
  assert.equal(
    view.container.querySelectorAll('.album-flight-photo').length,
    8,
  );
  assert.equal(
    view.container.querySelectorAll('.album-flight-face').length,
    16,
  );
  assert.ok(requestedPaths.length > 0);
  assert.ok(requestedPaths.every((path) => path.endsWith('/thumbnail.webp')));
  await setMedia('(max-width: 700px)', true);
  assert.equal(
    view.container.querySelectorAll('.album-flight-photo').length,
    9,
  );
  assert.equal(view.container.querySelectorAll('.album-flight-face').length, 18);
  assert.ok(requestedPaths.every((path) => path.endsWith('/thumbnail.webp')));
  assert.equal(frames.size, 1);
  view.rerender(<AlbumSpace {...props({ photos: photos.slice(0, 9), photoUrl })} />);
  assert.deepEqual(
    Array.from(
      view.container.querySelectorAll<HTMLButtonElement>('.album-flight-photo'),
      (photo) => photo.dataset.albumPhoto,
    ),
    photos.slice(0, 9).map((photo) => photo.id),
  );
});

test('Keyboard focus freezes moving photo targets until focus leaves the scene', async () => {
  const { container } = render(<AlbumSpace {...props()} />);
  const card = container.querySelector<HTMLButtonElement>(
    '.album-flight-photo',
  )!;
  fireEvent.keyDown(document, { key: 'Tab' });
  await act(async () => card.focus());
  assert.equal(document.activeElement, card);
  assert.equal(frames.size, 0);
  await act(async () => card.blur());
  assert.equal(frames.size, 1);
});

test('Unmount cancels pending work and later visibility/media/resize events cannot restart a detached scene', async () => {
  const view = render(<AlbumSpace {...props()} />);
  assert.equal(frames.size, 1);
  view.unmount();
  assert.equal(frames.size, 0);
  const before = requested;
  await setHidden(true);
  await setHidden(false);
  await setMedia('(prefers-reduced-motion: reduce)', true);
  await setMedia('(prefers-reduced-motion: reduce)', false);
  fireEvent.resize(window);
  await step(100_000);
  assert.equal(requested, before);
  assert.equal(frames.size, 0);
});

test('Dragging a photo rotates the world with momentum and suppresses its click; a later tap opens the photo exactly once', async () => {
  const opened: string[] = [];
  const { container } = render(
    <AlbumSpace {...props({ onOpen: (id) => opened.push(id) })} />,
  );
  const scene = container.querySelector<HTMLElement>(
    '.album-flight-perspective',
  )!;
  const world = container.querySelector<HTMLElement>('.album-flight-world')!;
  const card =
    container.querySelector<HTMLButtonElement>('[data-album-photo]')!;
  const initial = world.style.transform;
  pointer('pointerdown', card, 1, 100, 100);
  assert.equal(
    frames.size,
    0,
    'The scene stops autonomous motion during a gesture',
  );
  pointer('pointermove', scene, 1, 240, 175);
  const dragged = world.style.transform;
  assert.notEqual(
    dragged,
    initial,
    'Pointer movement changes the actual world transform',
  );
  pointer('pointerup', scene, 1, 240, 175);
  fireEvent.click(card, { detail: 1 });
  assert.deepEqual(
    opened,
    [],
    'The synthetic click following a drag does not open the card',
  );
  assert.equal(frames.size, 1);
  await step(1000);
  await step(1016);
  assert.notEqual(
    world.style.transform,
    dragged,
    'Camera momentum advances after release',
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  pointer('pointerdown', card, 2, 200, 200);
  pointer('pointerup', card, 2, 202, 201);
  fireEvent.click(card, { detail: 1 });
  assert.deepEqual(opened, [card.dataset.albumPhoto]);
  assert.equal(frames.size, 0, 'Opening the photo freezes the world');
});

test('Zoom buttons and wheel clamp to 65–220%, change the camera scale, and reset the view', () => {
  const { container } = render(<AlbumSpace {...props()} />);
  const scene = container.querySelector<HTMLElement>(
    '.album-flight-perspective',
  )!;
  const camera = container.querySelector<HTMLElement>('.album-flight-camera')!;
  const world = container.querySelector<HTMLElement>('.album-flight-world')!;
  const zoomIn = screen.getByRole('button', {
    name: 'Phóng to không gian ảnh',
  }) as HTMLButtonElement;
  const zoomOut = screen.getByRole('button', {
    name: 'Thu nhỏ không gian ảnh',
  }) as HTMLButtonElement;
  const reset = screen.getByRole('button', { name: 'Đặt lại góc nhìn' });
  assert.equal(readZoom(), 100);
  for (let i = 0; i < 20; i++) fireEvent.click(zoomIn);
  assert.equal(readZoom(), 220);
  assertCameraScale(camera, 2.2);
  assert.equal(zoomIn.disabled, true);
  for (let i = 0; i < 20; i++) fireEvent.click(zoomOut);
  assert.equal(readZoom(), 65);
  assertCameraScale(camera, 0.65);
  assert.equal(zoomOut.disabled, true);
  fireEvent.click(reset);
  assert.equal(readZoom(), 100);
  const normal = world.style.transform;
  pointer('pointerdown', scene, 1, 100, 100);
  pointer('pointermove', scene, 1, 250, 160);
  pointer('pointerup', scene, 1, 250, 160);
  assert.notEqual(world.style.transform, normal);
  const wheelUp = new dom.window.WheelEvent('wheel', {
    deltaY: -10000,
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
  });
  fireEvent(scene, wheelUp);
  assert.equal(
    wheelUp.defaultPrevented,
    true,
    'Modified wheel gestures explicitly zoom the embedded scene',
  );
  assert.equal(readZoom(), 220);
  fireEvent.wheel(scene, { deltaY: 10000, metaKey: true });
  assert.equal(readZoom(), 65);
  fireEvent.click(reset);
  assert.equal(readZoom(), 100);
  assert.equal(
    world.style.transform,
    normal,
    'Reset clears dragged yaw/pitch and restores the default camera orientation',
  );
  assertCameraScale(camera, 1);
});

test('Embedded vertical gestures and ordinary wheel leave page scrolling available without opening or rotating a photo', () => {
  const opened: string[] = [];
  const { container } = render(<AlbumSpace {...props({ onOpen: (id) => opened.push(id) })} />);
  const scene = container.querySelector<HTMLElement>('.album-flight-perspective')!;
  const world = container.querySelector<HTMLElement>('.album-flight-world')!;
  const card = container.querySelector<HTMLButtonElement>('[data-album-photo]')!;
  const original = world.style.transform;
  const wheel = new dom.window.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  fireEvent(scene, wheel);
  assert.equal(wheel.defaultPrevented, false);
  assert.equal(readZoom(), 100);
  const down = pointer('pointerdown', card, 1, 100, 100);
  assert.equal(down.defaultPrevented, false);
  const pending = pointer('pointermove', scene, 1, 102, 104);
  assert.equal(pending.defaultPrevented, false, 'A small motion has not chosen a gesture yet');
  const scroll = pointer('pointermove', scene, 1, 106, 210);
  assert.equal(scroll.defaultPrevented, false, 'A vertical drag remains a native scroll');
  assert.equal(world.style.transform, original);
  pointer('pointerup', scene, 1, 106, 210);
  fireEvent.click(card, { detail: 1 });
  assert.deepEqual(opened, []);
  assert.equal(frames.size, 1);
});

test('Two-pointer pinch updates zoom without opening photos, clamps at both limits and allows later taps', async () => {
  const opened: string[] = [];
  const { container } = render(
    <AlbumSpace {...props({ onOpen: (id) => opened.push(id) })} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở toàn màn hình' }));
  const scene = document.querySelector<HTMLElement>(
    '.album-flight-perspective',
  )!;
  const card =
    document.querySelector<HTMLButtonElement>('[data-album-photo]')!;
  pointer('pointerdown', card, 1, 100, 200);
  pointer('pointerdown', scene, 2, 200, 200);
  pointer('pointermove', scene, 2, 260, 200);
  assert.equal(readZoom(), 160);
  pointer('pointermove', scene, 2, 500, 200);
  assert.equal(readZoom(), 220);
  pointer('pointermove', scene, 2, 130, 200);
  assert.equal(readZoom(), 65);
  pointer('pointerup', scene, 2, 130, 200);
  pointer('pointerup', card, 1, 100, 200);
  fireEvent.click(card, { detail: 1 });
  assert.deepEqual(opened, []);
  assert.equal(
    frames.size,
    1,
    'Motion resumes after both pinch pointers are released',
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  pointer('pointerdown', card, 3, 200, 200);
  pointer('pointerup', card, 3, 200, 200);
  fireEvent.click(card, { detail: 1 });
  assert.deepEqual(
    opened,
    [card.dataset.albumPhoto],
    'A completed pinch does not leave future photo taps blocked',
  );
});

test('Hiding the tab during pinch clears interrupted pointers and click suppression so returning permits a normal tap', async () => {
  const opened: string[] = [];
  const { container } = render(
    <AlbumSpace {...props({ onOpen: (id) => opened.push(id) })} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở toàn màn hình' }));
  const scene = document.querySelector<HTMLElement>(
    '.album-flight-perspective',
  )!;
  const card =
    document.querySelector<HTMLButtonElement>('[data-album-photo]')!;
  pointer('pointerdown', card, 1, 100, 200);
  pointer('pointerdown', scene, 2, 200, 200);
  pointer('pointermove', scene, 2, 260, 200);
  assert.equal(readZoom(), 160);
  assert.equal(frames.size, 0);
  await setHidden(true);
  assert.equal(frames.size, 0);
  await step(100_000);
  await setHidden(false);
  assert.equal(frames.size, 1, 'Returning creates one autonomous frame chain');
  await step(200_000);
  assert.equal(frames.size, 1);
  assert.deepEqual(opened, []);
  // The OS may never deliver pointerup for either finger from the interrupted pinch.
  pointer('pointerdown', card, 3, 200, 200);
  pointer('pointerup', card, 3, 201, 201);
  fireEvent.click(card, { detail: 1 });
  assert.deepEqual(
    opened,
    [card.dataset.albumPhoto],
    'A new tap opens once despite the two missing pointerup events',
  );
  assert.equal(frames.size, 0, 'Opening the viewer stops the resumed chain');
});

test('Fullscreen uses a body portal, traps focus, restores the viewport lock on Escape and leaves body styles untouched', () => {
  document.documentElement.style.overflow = 'scroll';
  document.body.style.overflow = 'auto';
  document.body.style.overscrollBehavior = 'contain';
  const view = render(<AlbumSpace {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mở toàn màn hình' }));
  const dialog = screen.getByRole('dialog', {
    name: 'Không gian ảnh toàn màn hình',
  });
  assert.equal(
    dialog.parentElement,
    document.body,
    'The expanded scene escapes constrained layout ancestors',
  );
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(view.container.contains(dialog), false);
  assert.equal(document.documentElement.style.overflow, 'hidden');
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(document.body.style.overscrollBehavior, 'contain');
  const scene = dialog.querySelector<HTMLElement>('.album-flight-perspective')!;
  const wheel = new dom.window.WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
  fireEvent(scene, wheel);
  assert.equal(wheel.defaultPrevented, true, 'Fullscreen retains ordinary wheel zoom');
  assert.ok(readZoom() > 100);
  assert.ok(dialog.querySelector('.album-flight-world'));
  assert.equal(frames.size, 1);
  const targets = [
    ...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
  ];
  assert.equal(document.activeElement, dialog);
  fireEvent.keyDown(document, { key: 'Tab' });
  assert.equal(document.activeElement, targets[0]);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  assert.equal(document.activeElement, targets.at(-1));
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(
    screen.queryByRole('dialog', { name: 'Không gian ảnh toàn màn hình' }),
    null,
  );
  assert.equal(document.documentElement.style.overflow, 'scroll');
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(document.body.style.overscrollBehavior, 'contain');
  fireEvent.click(screen.getByRole('button', { name: 'Mở toàn màn hình' }));
  assert.equal(document.documentElement.style.overflow, 'hidden');
  assert.equal(document.body.style.overflow, 'auto');
  view.unmount();
  assert.equal(document.documentElement.style.overflow, 'scroll');
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(screen.queryByRole('dialog'), null);
  assert.equal(frames.size, 0);
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(frames.size, 0);
});

test('Fullscreen and photo-viewer scroll locks restore correctly when the scene unmounts before the viewer closes', () => {
  document.documentElement.style.overflow = 'scroll';
  document.body.style.overflow = 'auto';
  document.body.style.overscrollBehavior = 'contain';
  const view = render(<AlbumSpace {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mở toàn màn hình' }));
  assert.equal(document.documentElement.style.overflow, 'hidden');
  const previousBody = {
    overflow: document.body.style.overflow,
    overscrollBehavior: document.body.style.overscrollBehavior,
  };
  // Simulate the separate photo viewer taking its own body lock after fullscreen.
  document.body.style.overflow = 'hidden';
  document.body.style.overscrollBehavior = 'none';
  view.unmount();
  assert.equal(document.documentElement.style.overflow, 'scroll');
  assert.equal(
    document.body.style.overflow,
    'hidden',
    'The scene leaves the remaining viewer lock intact',
  );
  assert.equal(document.body.style.overscrollBehavior, 'none');
  // A realtime deletion can unmount the scene first; the viewer then restores what it saved.
  document.body.style.overflow = previousBody.overflow;
  document.body.style.overscrollBehavior = previousBody.overscrollBehavior;
  assert.equal(document.documentElement.style.overflow, 'scroll');
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(document.body.style.overscrollBehavior, 'contain');
  assert.equal(frames.size, 0);
});

test('Initially disabled motion shows settled photo depth and enabling it starts one chain without replaying the distant entrance', async () => {
  const options = props({ enabled: false });
  const view = render(<AlbumSpace {...options} />);
  assert.equal(frames.size, 0);
  assert.equal(requested, 0);
  const slot = view.container.querySelector<HTMLElement>('.album-flight-slot')!;
  const settled = slot.style.transform;
  const readDepth = () =>
    parseFloat(
      slot.style.transform.match(/translate3d\(([^)]+)\)/)![1].split(',')[2],
    );
  const settledDepth = readDepth();
  assert.ok(
    Number.isFinite(settledDepth) && settledDepth > -1000,
    'Static photos are shown at their settled depth instead of the distant -1250px entrance offset',
  );
  view.rerender(<AlbumSpace {...options} enabled />);
  assert.equal(frames.size, 1);
  assert.equal(slot.style.transform, settled);
  await step(500_000);
  assert.equal(
    slot.style.transform,
    settled,
    'The first enabled frame preserves the already-visible layout',
  );
  assert.equal(frames.size, 1);
  await step(500_016);
  assert.ok(
    Math.abs(readDepth() - settledDepth) < 10,
    'Autonomous motion starts smoothly without a new entrance jump',
  );
  assert.equal(frames.size, 1);
});
