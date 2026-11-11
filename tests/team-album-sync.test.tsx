import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type {
  AlbumPhoto,
  TeamAlbum,
  TeamAlbumSnapshot,
} from '../src/albumTypes';
import type { AlbumTransport } from '../src/useTeamAlbum';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
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
const { renderHook, waitFor, cleanup, act } =
  await import('@testing-library/react');
const { useTeamAlbum } = await import('../src/useTeamAlbum');

const album: TeamAlbum = {
  id: 'album',
  title: 'Lên sân cùng đội',
  description: 'Ảnh từ thiết bị khác',
  event_date: '2026-11-11',
  kind: 'badminton',
  cover_photo_id: null,
  version: 1,
  deleted_at: null,
  created_at: '2026-11-11T10:00:00Z',
  updated_at: '2026-11-11T10:00:00Z',
};
const photo: AlbumPhoto = {
  id: 'photo',
  album_id: album.id,
  original_path: 'album/photo.jpg',
  thumbnail_path: 'album/photo-thumb.webp',
  original_mime: 'image/jpeg',
  original_size: 1000,
  width: 1600,
  height: 1000,
  filename: 'cung-nhau.jpg',
  caption: 'Lần đầu lên sân',
  version: 1,
  deleted_at: null,
  created_at: '2026-11-11T10:00:00Z',
  updated_at: '2026-11-11T10:00:00Z',
};
const snapshot = (
  revision = 1,
  overrides: Partial<TeamAlbumSnapshot> = {},
): TeamAlbumSnapshot => ({
  version: 1,
  revision,
  realtime_enabled: true,
  albums: [],
  photos: [],
  ...overrides,
});
const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function transport(initial = snapshot()) {
  let current = initial;
  let change = () => {};
  let status = (_value: boolean) => {};
  let loads = 0;
  let unsubscribed = 0;
  const api: AlbumTransport = {
    configured: true,
    load: async () => {
      loads += 1;
      return current;
    },
    subscribe(onChange, onStatus) {
      change = onChange;
      status = onStatus;
      onStatus(true);
      return () => {
        unsubscribed += 1;
      };
    },
  };
  return {
    api,
    set: (next: TeamAlbumSnapshot) => {
      current = next;
    },
    change: () => change(),
    status: (value: boolean) => status(value),
    loads: () => loads,
    unsubscribed: () => unsubscribed,
  };
}
function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value,
  });
}
beforeEach(() => setOnline(true));
afterEach(() => {
  cleanup();
  setOnline(true);
});

test('album writes show saving until the server acknowledges, then fetch the canonical snapshot', async () => {
  const server = transport();
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.available, true));
  const acknowledgement = deferred<void>();
  let write!: Promise<boolean>;
  act(() => {
    write = result.current.write(() => acknowledgement.promise, 'Đã tạo album');
  });
  assert.equal(result.current.saveState, 'saving');
  assert.equal(result.current.notice, '');
  assert.equal(result.current.data?.albums.length, 0);
  server.set(snapshot(2, { albums: [album] }));
  await act(async () => {
    acknowledgement.resolve();
    assert.equal(await write, true);
  });
  assert.equal(result.current.saveState, 'saved');
  assert.equal(result.current.notice, 'Đã tạo album');
  assert.equal(result.current.data?.revision, 2);
  assert.equal(result.current.data?.albums[0].id, album.id);
  assert.equal(server.loads(), 2);
});

test('failed writes report failure and keep the canonical records instead of claiming a local save', async () => {
  const server = transport(snapshot(1, { albums: [album], photos: [photo] }));
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.available, true));
  const acknowledgement = deferred<void>();
  let write!: Promise<boolean>;
  act(() => {
    write = result.current.write(() => acknowledgement.promise, 'Đã sửa ảnh');
  });
  assert.equal(result.current.saveState, 'saving');
  await act(async () => {
    acknowledgement.reject(
      new Error('Chú thích đã được sửa trên thiết bị khác.'),
    );
    assert.equal(await write, false);
  });
  assert.equal(result.current.saveState, 'error');
  assert.match(result.current.notice, /thiết bị khác/);
  assert.equal(result.current.data?.photos[0].caption, photo.caption);
  assert.equal(result.current.data?.revision, 1);
  assert.equal(server.loads(), 2);
});

test('one failed concurrent write keeps its error notice when another write succeeds later', async () => {
  const server = transport();
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.available, true));
  const failedAcknowledgement = deferred<void>();
  const savedAcknowledgement = deferred<void>();
  let failedWrite!: Promise<boolean>;
  let savedWrite!: Promise<boolean>;
  act(() => {
    failedWrite = result.current.write(
      () => failedAcknowledgement.promise,
      'Đã sửa ảnh A',
    );
    savedWrite = result.current.write(
      () => savedAcknowledgement.promise,
      'Đã sửa ảnh B',
    );
  });
  assert.equal(result.current.saveState, 'saving');
  await act(async () => {
    failedAcknowledgement.reject(new Error('Ảnh A chưa được lưu vì xung đột.'));
    assert.equal(await failedWrite, false);
  });
  assert.equal(result.current.saveState, 'saving');
  assert.match(result.current.notice, /Ảnh A chưa được lưu/);
  await act(async () => {
    savedAcknowledgement.resolve();
    assert.equal(await savedWrite, true);
  });
  assert.equal(result.current.saveState, 'error');
  assert.match(result.current.notice, /Ảnh A chưa được lưu/);
  assert.doesNotMatch(result.current.notice, /Đã sửa ảnh B/);
});

test('realtime invalidations debounce and load inserts, edited captions, and trash state from the server', async () => {
  const server = transport();
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.connected, true));
  server.set(snapshot(2, { albums: [album], photos: [photo] }));
  act(() => {
    server.change();
    server.change();
    server.change();
  });
  await waitFor(() => assert.equal(result.current.data?.revision, 2));
  assert.equal(result.current.data?.photos[0].filename, photo.filename);
  assert.equal(server.loads(), 2);
  server.set(
    snapshot(3, {
      albums: [album],
      photos: [
        { ...photo, caption: 'Chú thích mới từ thiết bị B', version: 2 },
      ],
    }),
  );
  act(() => server.change());
  await waitFor(() =>
    assert.equal(
      result.current.data?.photos[0].caption,
      'Chú thích mới từ thiết bị B',
    ),
  );
  server.set(
    snapshot(4, {
      albums: [album],
      photos: [{ ...photo, deleted_at: '2026-11-11T11:00:00Z', version: 3 }],
    }),
  );
  act(() => server.change());
  await waitFor(() => assert.equal(result.current.data?.revision, 4));
  assert.equal(
    result.current.data?.photos[0].deleted_at,
    '2026-11-11T11:00:00Z',
  );
  assert.equal(result.current.saveState, 'idle');
  assert.equal(result.current.notice, '');
});

test('reconnecting fetches missed changes even without a realtime message and offline writes never execute', async () => {
  const server = transport(snapshot(1, { albums: [album] }));
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.connected, true));
  setOnline(false);
  act(() => window.dispatchEvent(new dom.window.Event('offline')));
  assert.equal(result.current.online, false);
  assert.equal(result.current.connected, false);
  let called = false;
  await act(async () => {
    assert.equal(
      await result.current.write(async () => {
        called = true;
      }),
      false,
    );
  });
  assert.equal(called, false);
  assert.equal(result.current.saveState, 'error');
  assert.match(result.current.notice, /Mất kết nối mạng/);
  server.set(
    snapshot(2, {
      albums: [{ ...album, title: 'Thay đổi lúc mất mạng', version: 2 }],
    }),
  );
  setOnline(true);
  act(() => window.dispatchEvent(new dom.window.Event('online')));
  await waitFor(() => assert.equal(result.current.data?.revision, 2));
  assert.equal(result.current.online, true);
  assert.equal(result.current.data?.albums[0].title, 'Thay đổi lúc mất mạng');
  act(() => server.status(true));
  assert.equal(result.current.connected, true);
});

test('unmount unsubscribes and clears queued refreshes and connectivity listeners', async () => {
  const server = transport();
  const { result, unmount } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.available, true));
  const initialLoads = server.loads();
  act(() => server.change());
  unmount();
  window.dispatchEvent(new dom.window.Event('online'));
  window.dispatchEvent(new dom.window.Event('focus'));
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(server.unsubscribed(), 1);
  assert.equal(server.loads(), initialLoads);
});

test('missing Supabase configuration does not invent data or execute a save', async () => {
  const server = transport();
  server.api.configured = false;
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.loading, false));
  assert.equal(result.current.data, null);
  assert.equal(result.current.available, false);
  assert.equal(result.current.connected, false);
  assert.match(result.current.error, /Chưa cấu hình kết nối Supabase/);
  assert.equal(server.loads(), 0);
  let called = false;
  await act(async () => {
    assert.equal(
      await result.current.write(async () => {
        called = true;
      }),
      false,
    );
  });
  assert.equal(called, false);
  assert.equal(result.current.saveState, 'error');
  assert.match(result.current.notice, /chưa được lưu/);
});

test('missing album migration reports setup truth and can recover after the backend is configured', async () => {
  const server = transport();
  const load = server.api.load;
  let missing = true;
  server.api.load = async () => {
    if (missing)
      throw new Error(
        'Could not find get_team_album_snapshot in the schema cache',
      );
    return load();
  };
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.loading, false));
  assert.equal(result.current.data, null);
  assert.equal(result.current.available, false);
  assert.match(result.current.error, /Cần chạy migration album/);
  missing = false;
  await act(async () => {
    await result.current.reload();
  });
  assert.equal(result.current.available, true);
  assert.equal(result.current.error, '');
  assert.deepEqual(result.current.data?.albums, []);
  assert.deepEqual(result.current.data?.photos, []);
});

test('a slow earlier load cannot overwrite a newer realtime snapshot', async () => {
  const first = deferred<TeamAlbumSnapshot>();
  const second = deferred<TeamAlbumSnapshot>();
  let loads = 0;
  const server = transport();
  server.api.load = () => (++loads === 1 ? first.promise : second.promise);
  const { result } = renderHook(() => useTeamAlbum(server.api));
  assert.equal(loads, 1);
  let refresh!: Promise<void>;
  act(() => {
    refresh = result.current.reload();
  });
  await act(async () => {
    second.resolve(snapshot(2, { albums: [album] }));
    await refresh;
  });
  assert.equal(result.current.data?.revision, 2);
  await act(async () => {
    first.resolve(snapshot(1));
    await first.promise;
  });
  assert.equal(result.current.data?.revision, 2);
  assert.equal(result.current.data?.albums[0].id, album.id);
});

test('a later response with a lower revision cannot roll back already displayed records', async () => {
  const server = transport(
    snapshot(5, {
      albums: [album],
      photos: [{ ...photo, caption: 'Bản mới nhất', version: 3 }],
    }),
  );
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.data?.revision, 5));
  server.set(
    snapshot(4, {
      albums: [album],
      photos: [{ ...photo, caption: 'Nội dung cũ', version: 2 }],
    }),
  );
  await act(async () => {
    await result.current.reload();
  });
  assert.equal(result.current.data?.revision, 5);
  assert.equal(result.current.data?.photos[0].caption, 'Bản mới nhất');
  assert.equal(result.current.error, '');
});

test('a connected socket alone does not claim realtime is enabled in the database', async () => {
  const server = transport(snapshot(1, { realtime_enabled: false }));
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.available, true));
  assert.equal(result.current.connected, false);
  server.set(snapshot(2, { realtime_enabled: true }));
  await act(async () => {
    await result.current.reload();
  });
  assert.equal(result.current.connected, true);
  act(() => server.status(false));
  assert.equal(result.current.connected, false);
});

test('malformed backend responses are rejected rather than becoming an empty working album', async () => {
  const server = transport();
  server.api.load = async () =>
    ({ version: 999, albums: [], photos: [] }) as unknown as TeamAlbumSnapshot;
  const { result } = renderHook(() => useTeamAlbum(server.api));
  await waitFor(() => assert.equal(result.current.loading, false));
  assert.equal(result.current.data, null);
  assert.equal(result.current.available, false);
  assert.match(result.current.error, /dữ liệu album không hợp lệ/);
});
