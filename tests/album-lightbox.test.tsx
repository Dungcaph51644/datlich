import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { AlbumPhoto } from '../src/albumTypes';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLDialogElement: dom.window.HTMLDialogElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
  });
}
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
const { render, screen, fireEvent, waitFor, cleanup, act } =
  await import('@testing-library/react');
const { AlbumLightbox } = await import('../src/AlbumLightbox');
// This resolver is a test transport dependency, never a production URL fallback.
const fixturePhotoUrl = (path: string) =>
  `https://album-fixture.supabase.co/storage/v1/object/public/team-album/${path}`;
const photo = (id: string): AlbumPhoto => ({
  id,
  album_id: 'album-a',
  original_path: `album-a/${id}.jpg`,
  thumbnail_path: `album-a/${id}-thumb.webp`,
  original_mime: 'image/jpeg',
  original_size: 1000,
  width: 1600,
  height: 1000,
  filename: `${id}.jpg`,
  caption: `Khoảnh khắc ${id}`,
  version: 1,
  deleted_at: null,
  created_at: '2026-11-11T10:00:00Z',
  updated_at: '2026-11-11T10:00:00Z',
});
const photos = [photo('one'), photo('two'), photo('three')];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  document.body.style.overflow = '';
  document.body.style.overscrollBehavior = '';
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('lightbox loads only the current original, navigates by keyboard and buttons, and preserves natural metadata', () => {
  const { container } = render(
    <AlbumLightbox
      photoUrl={fixturePhotoUrl}
      photos={photos}
      initialId="two"
      onClose={() => {}}
    />,
  );
  const dialog = screen.getByRole('dialog');
  assert.equal(
    screen.getByRole('heading', { name: 'two.jpg' }).textContent,
    'two.jpg',
  );
  assert.equal(container.querySelectorAll('.album-lightbox-image').length, 1);
  assert.equal(
    container.querySelectorAll('.album-lightbox-thumbnails img').length,
    3,
  );
  assert.match(
    container.querySelector('.album-lightbox-caption')!.textContent!,
    /Khoảnh khắc two/,
  );
  assert.match(
    container.querySelector('.album-lightbox-caption')!.textContent!,
    /11\/11\/2026/,
  );
  fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  assert.ok(screen.getByRole('heading', { name: 'three.jpg' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh sau' }));
  assert.ok(screen.getByRole('heading', { name: 'one.jpg' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh trước' }));
  assert.ok(screen.getByRole('heading', { name: 'three.jpg' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh 2' }));
  assert.ok(screen.getByRole('heading', { name: 'two.jpg' }));
});

test('zoom waits for the image, resets on navigation, and restores original scroll styles on close', () => {
  document.body.style.overflow = 'auto';
  document.body.style.overscrollBehavior = 'contain';
  const { container, unmount } = render(
    <AlbumLightbox
      photoUrl={fixturePhotoUrl}
      photos={photos}
      initialId="one"
      onClose={() => {}}
    />,
  );
  assert.equal(document.body.style.overflow, 'hidden');
  const zoomButton = screen.getByRole('button', {
    name: 'Phóng to',
    exact: true,
  }) as HTMLButtonElement;
  assert.equal(zoomButton.disabled, true);
  fireEvent.load(container.querySelector('.album-lightbox-image')!);
  fireEvent.click(zoomButton);
  assert.equal(screen.getByLabelText('Mức phóng to').textContent, '150%');
  fireEvent.click(screen.getByRole('button', { name: 'Ảnh sau' }));
  assert.equal(screen.getByLabelText('Mức phóng to').textContent, '100%');
  unmount();
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(document.body.style.overscrollBehavior, 'contain');
});

test('touch swipes navigate while pinch zoom and panning never accidentally switch photos', () => {
  const { container } = render(
    <AlbumLightbox
      photoUrl={fixturePhotoUrl}
      photos={photos}
      initialId="one"
      onClose={() => {}}
    />,
  );
  const stage = container.querySelector('.album-lightbox-stage')!;
  const pointer = (type: string, id: number, x: number, y: number) => {
    const event = new dom.window.Event(type, {
      bubbles: true,
      cancelable: true,
    });
    Object.assign(event, {
      pointerId: id,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      button: 0,
    });
    fireEvent(stage, event);
  };
  pointer('pointerdown', 1, 180, 100);
  pointer('pointermove', 1, 60, 105);
  pointer('pointerup', 1, 60, 105);
  assert.ok(screen.getByRole('heading', { name: 'two.jpg' }));
  fireEvent.load(container.querySelector('.album-lightbox-image')!);
  pointer('pointerdown', 1, 100, 100);
  pointer('pointerdown', 2, 200, 100);
  pointer('pointermove', 2, 300, 100);
  assert.equal(screen.getByLabelText('Mức phóng to').textContent, '200%');
  pointer('pointerup', 2, 300, 100);
  pointer('pointermove', 1, 10, 100);
  pointer('pointerup', 1, 10, 100);
  assert.ok(screen.getByRole('heading', { name: 'two.jpg' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đặt lại kích thước' }));
  pointer('pointerdown', 1, 180, 100);
  pointer('pointercancel', 1, 20, 100);
  assert.ok(screen.getByRole('heading', { name: 'two.jpg' }));
});

test('realtime deletion closes the current photo and never exposes trashed images', async () => {
  let closed = 0;
  const onClose = () => {
    closed += 1;
  };
  const { rerender, container } = render(
    <AlbumLightbox
      photoUrl={fixturePhotoUrl}
      photos={photos}
      initialId="two"
      onClose={onClose}
    />,
  );
  rerender(
    <AlbumLightbox
      photoUrl={fixturePhotoUrl}
      photos={photos.map((item) =>
        item.id === 'two'
          ? { ...item, deleted_at: '2026-11-11T12:00:00Z' }
          : item,
      )}
      initialId="two"
      onClose={onClose}
    />,
  );
  await waitFor(() => assert.equal(closed, 1));
  assert.equal(container.querySelector('.album-lightbox-image'), null);
});

test('a failed original download shows a real fallback link and offline management is disabled', async () => {
  globalThis.fetch = async () => {
    throw new Error('network unavailable');
  };
  const { rerender } = render(
    <AlbumLightbox
      photoUrl={fixturePhotoUrl}
      photos={photos}
      initialId="one"
      onClose={() => {}}
      onEdit={() => {}}
      onTrash={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh' }));
  await waitFor(() =>
    assert.match(
      screen.getByRole('alert').textContent!,
      /Không thể tải file trực tiếp/,
    ),
  );
  assert.ok(screen.getByRole('link', { name: 'Mở ảnh gốc' }));
  assert.equal(
    screen.getByRole('link', { name: 'Mở ảnh gốc' }).getAttribute('href'),
    fixturePhotoUrl(photos[0].original_path),
  );
  rerender(
    <AlbumLightbox
      photoUrl={fixturePhotoUrl}
      photos={photos}
      initialId="one"
      onClose={() => {}}
      onEdit={() => {}}
      onTrash={() => {}}
      online={false}
    />,
  );
  assert.equal(
    (screen.getByRole('button', { name: 'Tải ảnh' }) as HTMLButtonElement)
      .disabled,
    true,
  );
  assert.equal(
    (
      screen.getByRole('button', {
        name: 'Sửa chú thích ảnh',
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  assert.equal(
    (
      screen.getByRole('button', {
        name: 'Chuyển ảnh vào Thùng rác',
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
});

test('the download button waits for the actual server response and rejects a second click', async () => {
  let fetchCalls = 0;
  let rejectDownload: (reason: Error) => void = () => {};
  globalThis.fetch = () => {
    fetchCalls += 1;
    return new Promise((_resolve, reject) => {
      rejectDownload = reject;
    });
  };
  render(
    <AlbumLightbox
      photoUrl={fixturePhotoUrl}
      photos={photos}
      initialId="one"
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh' }));
  const pending = screen.getByRole('button', {
    name: 'Đang tải ảnh',
  }) as HTMLButtonElement;
  assert.equal(pending.disabled, true);
  fireEvent.click(pending);
  assert.equal(fetchCalls, 1);
  await act(async () => rejectDownload(new Error('failed')));
  await waitFor(() =>
    assert.equal(
      (screen.getByRole('button', { name: 'Tải ảnh' }) as HTMLButtonElement)
        .disabled,
      false,
    ),
  );
});

test('Escape/cancel and the visible close button both close the dialog', () => {
  let closed = 0;
  render(
    <AlbumLightbox
      photoUrl={fixturePhotoUrl}
      photos={photos}
      initialId="one"
      onClose={() => {
        closed += 1;
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Đóng ảnh lớn' }));
  fireEvent(
    screen.getByRole('dialog'),
    new dom.window.Event('cancel', { cancelable: true }),
  );
  assert.equal(closed, 2);
});
