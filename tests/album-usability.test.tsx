import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { TeamAlbum, AlbumPhoto, TeamAlbumSnapshot } from '../src/albumTypes';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://album.test/#album',
  pretendToBeVisual: true,
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLDialogElement: dom.window.HTMLDialogElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  Event: dom.window.Event,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const matchMedia = (query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  addEventListener() {},
  removeEventListener() {},
});
Object.defineProperty(globalThis, 'matchMedia', { value: matchMedia, configurable: true });
Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true });
let copied = '';
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (text: string) => { copied = text; } },
});
const { render, screen, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const { TeamAlbumContent } = await import('../src/TeamAlbumPage');
const { AlbumUploadDialog } = await import('../src/AlbumUploadDialog');
const { navigateRoute, readRoute } = await import('../src/navigation');

const album: TeamAlbum = {
  id: 'album-one', title: 'Đà Nẵng cùng đội', description: 'Những kỷ niệm trên sân',
  event_date: '2026-11-11', kind: 'badminton', cover_photo_id: null,
  version: 1, deleted_at: null, created_at: '2026-11-11T00:00:00Z', updated_at: '2026-11-11T00:00:00Z',
};
const photo: AlbumPhoto = {
  id: 'photo-one', album_id: album.id, original_path: 'one.jpg', thumbnail_path: 'one.webp',
  original_mime: 'image/jpeg', original_size: 1000, width: 1600, height: 1000,
  filename: 'ky-niem.jpg', caption: 'Kỷ niệm sân cầu', version: 1, deleted_at: null,
  created_at: '2026-11-11T00:00:00Z', updated_at: '2026-11-11T00:00:00Z',
};
const snapshot: TeamAlbumSnapshot = {
  version: 1, revision: 1, realtime_enabled: true, albums: [album], photos: [photo, {
    ...photo, id: 'photo-two', original_path: 'two.jpg', thumbnail_path: 'two.webp', filename: 'hai.jpg',
  }],
};
function store(overrides: Record<string, unknown> = {}) {
  return {
    data: snapshot, loading: false, online: true, connected: true, error: '', notice: '',
    saveState: 'idle' as const, write: async () => true, reload: async () => {}, available: true,
    ...overrides,
  } as React.ComponentProps<typeof TeamAlbumContent>['store'];
}
const photoUrl = (path: string) => 'https://media.test/' + path;
function renderAlbum(value = store()) {
  return render(<TeamAlbumContent store={value} motionEnabled={false} photoUrl={photoUrl} />);
}
beforeEach(() => {
  copied = '';
  window.history.replaceState(null, '', '#album');
});
afterEach(() => { cleanup(); });

test('A direct photo link waits for the snapshot, retains the URL, then opens the intended album and photo', () => {
  window.history.replaceState(null, '', '#album?album=album-one&photo=photo-two');
  const originalHash = window.location.hash;
  const view = renderAlbum(store({ data: null, loading: true, available: false }));
  assert.equal(window.location.hash, originalHash);
  assert.equal(screen.queryByRole('dialog'), null);
  assert.equal(screen.queryByText(/trong liên kết không tồn tại/), null);
  view.rerender(<TeamAlbumContent store={store()} motionEnabled={false} photoUrl={photoUrl} />);
  assert.ok(screen.getByRole('heading', { name: album.title }));
  assert.ok(screen.getByRole('heading', { name: 'hai.jpg' }));
  assert.equal(window.location.hash, originalHash);
  fireEvent.click(screen.getByRole('button', { name: 'Đóng ảnh lớn' }));
  assert.deepEqual(readRoute(), { page: 'album', album: album.id });
});

test('Missing links remain visible with a recovery action instead of silently changing the URL', () => {
  window.history.replaceState(null, '', '#album?album=missing&photo=missing');
  renderAlbum();
  assert.match(screen.getByRole('alert').textContent!, /Album trong liên kết không tồn tại/);
  assert.equal(window.location.hash, '#album?album=missing&photo=missing');
  assert.equal(screen.queryByRole('dialog'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Về tất cả album' }));
  assert.deepEqual(readRoute(), { page: 'album' });
});

test('Following a photo link to another album replaces the viewer collection without closing the new route', async () => {
  const otherAlbum = { ...album, id: 'album-two', title: 'Du lịch cùng đội' };
  const otherPhoto = { ...photo, id: 'photo-three', album_id: otherAlbum.id, filename: 'du-lich.jpg' };
  window.history.replaceState(null, '', '#album?album=album-one&photo=photo-one');
  renderAlbum(store({ data: { ...snapshot, albums: [album, otherAlbum], photos: [...snapshot.photos, otherPhoto] } }));
  await act(async () => navigateRoute({ album: otherAlbum.id, photo: otherPhoto.id }));
  assert.ok(screen.getByRole('heading', { name: otherPhoto.filename }));
  assert.equal(readRoute().photo, otherPhoto.id);
  assert.equal(readRoute().album, otherAlbum.id);
});

test('Vietnamese album search matches accents, Đ and case without excluding the correct album', () => {
  renderAlbum();
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm album' }), { target: { value: 'DA NANG' } });
  assert.ok(screen.getByRole('heading', { name: album.title }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm album' }), { target: { value: 'khong co album' } });
  assert.equal(screen.queryByRole('heading', { name: album.title }), null);
});

test('Photo navigation replaces the photo parameter; browser route changes select the corresponding photo without stale content', async () => {
  window.history.replaceState(null, '', '#album?album=album-one&photo=photo-one');
  renderAlbum();
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh sau' }));
  assert.equal(readRoute().photo, 'photo-two');
  assert.ok(screen.getByRole('heading', { name: 'hai.jpg' }));
  await act(async () => navigateRoute({ photo: 'photo-one' }, { replace: true }));
  assert.ok(screen.getByRole('heading', { name: 'ky-niem.jpg' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết ảnh' }));
  await waitFor(() => assert.match(copied, /#album\?album=album-one&photo=photo-one$/));
  await waitFor(() => assert.ok(screen.getByText('Đã sao chép liên kết ảnh. Có thể gửi vào nhóm Zalo.')));
});

test('A reload warns about a selected upload queue and removing the last unsaved file clears that guard', () => {
  const view = render(<AlbumUploadDialog albumId={album.id} albums={[album]} online onClose={() => {}} onUploaded={() => {}} write={async () => true} />);
  const emptyEvent = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(emptyEvent);
  assert.equal(emptyEvent.defaultPrevented, false);
  const file = new File([new Uint8Array([1, 2, 3])], 'anh.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText('Chọn nhiều ảnh từ thiết bị'), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText('Chú thích anh.jpg'), { target: { value: 'Chú thích chưa lưu' } });
  const dirtyEvent = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(dirtyEvent);
  assert.equal(dirtyEvent.defaultPrevented, true);
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ anh.jpg khỏi danh sách tải' }));
  const cleanEvent = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleanEvent);
  assert.equal(cleanEvent.defaultPrevented, false);
  view.unmount();
  const afterUnmount = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(afterUnmount);
  assert.equal(afterUnmount.defaultPrevented, false);
});
