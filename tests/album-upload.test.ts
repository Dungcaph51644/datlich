import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALBUM_IMAGE_MAX_BYTES,
  ALBUM_THUMBNAIL_MAX_BYTES,
  encodeAlbumThumbnail,
  reconcileAlbumUploadCaption,
  validateAlbumImageFile,
  uploadAlbumPhoto,
  xhrAlbumStorageUpload,
  type AlbumUploadDependencies,
  type AlbumUploadInput,
} from '../src/albumUpload';

const albumId = '123e4567-e89b-42d3-a456-426614174000';
const operationId = '123e4567-e89b-42d3-a456-426614174001';
const photoId = '123e4567-e89b-42d3-a456-426614174002';
const now = Date.parse('2026-11-11T06:00:00Z');
const photo = { id: photoId, album_id: albumId };
const originalPath = `photos/${photoId}/original.jpg`;
const thumbnailPath = `photos/${photoId}/thumbnail.webp`;
function issued(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: operationId,
    photo_id: photoId,
    bucket: 'team-album',
    original_path: originalPath,
    thumbnail_path: thumbnailPath,
    original_exists: false,
    thumbnail_exists: false,
    expires_at: new Date(now + 30 * 60_000).toISOString(),
    ...overrides,
  };
}
function fixture() {
  const input: AlbumUploadInput = {
    albumId,
    operationId,
    file: new File([new Uint8Array(100)], 'ky-niem.jpg', {
      type: 'image/jpeg',
    }),
    thumbnail: {
      blob: new Blob([new Uint8Array(10)], { type: 'image/webp' }),
      width: 1920,
      height: 1080,
    },
    caption: 'Những người bạn trên sân',
  };
  const prepared: unknown[] = [];
  const uploaded: { bucket: string; path: string; blob: Blob }[] = [];
  const finished: unknown[] = [];
  const progress: number[] = [];
  const phases: string[] = [];
  const dependencies: AlbumUploadDependencies<typeof photo> = {
    prepare: async (args) => {
      prepared.push(args);
      return issued();
    },
    upload: async (bucket, path, blob, options) => {
      uploaded.push({ bucket, path, blob });
      options.onProgress(blob.size / 2);
      options.onProgress(blob.size);
    },
    finish: async (args) => {
      finished.push(args);
      return photo;
    },
    now: () => now,
    onProgress: (loaded, total) => {
      assert.equal(total, 110);
      progress.push(loaded);
    },
    onPhase: (phase) => phases.push(phase),
  };
  return {
    input,
    dependencies,
    prepared,
    uploaded,
    finished,
    progress,
    phases,
  };
}

test('Album accepts supported image files through 15 MiB, with explicit empty/HEIC/SVG/size errors', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp'])
    assert.doesNotThrow(() =>
      validateAlbumImageFile(new File(['a'], 'image', { type: mime })),
    );
  assert.doesNotThrow(() =>
    validateAlbumImageFile(
      new File([new Uint8Array(ALBUM_IMAGE_MAX_BYTES)], 'large.jpg', {
        type: 'image/jpeg',
      }),
    ),
  );
  assert.throws(
    () =>
      validateAlbumImageFile(
        new File(['a'], 'iphone.HEIC', { type: 'image/jpeg' }),
      ),
    /HEIC\/HEIF/,
  );
  assert.throws(
    () =>
      validateAlbumImageFile(
        new File(['a'], 'script.svg', { type: 'image/svg\+xml' }),
      ),
    /JPG, PNG/,
  );
  assert.throws(
    () =>
      validateAlbumImageFile(new File([], 'empty.jpg', { type: 'image/jpeg' })),
    /trống/,
  );
  assert.throws(
    () =>
      validateAlbumImageFile(
        new File([new Uint8Array(ALBUM_IMAGE_MAX_BYTES + 1)], 'large.jpg', {
          type: 'image/jpeg',
        }),
      ),
    /15 MB/,
  );
});

test('Thumbnail generation falls back from unsupported WebP encoding to bounded JPEG', async () => {
  const requested: string[] = [];
  let drawnJpegFallback = false;
  const canvas = {
    toBlob(
      callback: BlobCallback,
      type = 'image/png',
    ) {
      requested.push(type);
      callback(
        type === 'image/webp'
          ? new Blob(['Safari PNG fallback'], { type: 'image/png' })
          : new Blob(['JPEG thumbnail'], { type: 'image/jpeg' }),
      );
    },
  } as unknown as HTMLCanvasElement;
  const thumbnail = await encodeAlbumThumbnail(canvas, () => {
    drawnJpegFallback = true;
  });
  assert.equal(thumbnail.type, 'image/jpeg');
  assert.deepEqual(requested, ['image/webp', 'image/jpeg']);
  assert.equal(drawnJpegFallback, true);

  const webpCanvas = {
    toBlob(callback: BlobCallback, type = 'image/png') {
      callback(new Blob(['WebP thumbnail'], { type }));
    },
  } as unknown as HTMLCanvasElement;
  const webp = await encodeAlbumThumbnail(webpCanvas, () => {
    assert.fail('JPEG drawing is unnecessary when WebP is supported');
  });
  assert.equal(webp.type, 'image/webp');

  const oversizedCanvas = {
    toBlob(callback: BlobCallback, type = 'image/png') {
      callback(
        new Blob([
          new Uint8Array(
            type === 'image/webp' ? 1 : ALBUM_THUMBNAIL_MAX_BYTES + 1,
          ),
        ], { type: type === 'image/webp' ? 'image/png' : type }),
      );
    },
  } as unknown as HTMLCanvasElement;
  await assert.rejects(
    encodeAlbumThumbnail(oversizedCanvas, () => {}),
    /Không tạo được ảnh thu nhỏ tương thích/,
  );
});

test('Album prepares original metadata, uploads original plus thumbnail, and finishes only after both Storage acknowledgements', async () => {
  const f = fixture();
  assert.deepEqual(await uploadAlbumPhoto(f.input, f.dependencies), photo);
  assert.deepEqual(f.prepared, [
    {
      p_album_id: albumId,
      p_operation_id: operationId,
      p_original_mime: 'image/jpeg',
      p_original_size: 100,
      p_thumbnail_size: 10,
      p_width: 1920,
      p_height: 1080,
      p_filename: 'ky-niem.jpg',
      p_thumbnail_mime: 'image/webp',
    },
  ]);
  assert.deepEqual(
    f.uploaded.map((item) => [item.bucket, item.path]),
    [
      ['team-album', originalPath],
      ['team-album', thumbnailPath],
    ],
  );
  assert.equal(f.uploaded[0].blob, f.input.file);
  assert.equal(f.uploaded[1].blob, f.input.thumbnail.blob);
  assert.deepEqual(f.finished, [
    { p_operation_id: operationId, p_caption: f.input.caption },
  ]);
  assert.deepEqual(f.phases, ['preparing', 'uploading', 'saving']);
  assert.equal(f.progress.at(-1), 110);
  assert.ok(f.progress.includes(50));
});

test('Album upload sends Safari JPEG thumbnails with matching MIME and extension', async () => {
  const f = fixture();
  const jpegPath = `photos/${photoId}/thumbnail.jpg`;
  f.input.thumbnail.blob = new Blob([new Uint8Array(10)], {
    type: 'image/jpeg',
  });
  f.dependencies.prepare = async (args) => {
    f.prepared.push(args);
    return issued({ thumbnail_path: jpegPath });
  };
  await uploadAlbumPhoto(f.input, f.dependencies);
  assert.equal(
    (f.prepared[0] as { p_thumbnail_mime: string }).p_thumbnail_mime,
    'image/jpeg',
  );
  assert.deepEqual(
    f.uploaded.map((item) => [item.path, item.blob.type]),
    [
      [originalPath, 'image/jpeg'],
      [jpegPath, 'image/jpeg'],
    ],
  );
});

test('Uploading all bytes does not report saved before metadata acknowledgement', async () => {
  const f = fixture();
  let accept!: (value: typeof photo) => void;
  f.dependencies.finish = () =>
    new Promise((resolve) => {
      accept = resolve;
    });
  let saved = false;
  const result = uploadAlbumPhoto(f.input, f.dependencies).then(() => {
    saved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.progress.at(-1), 110);
  assert.equal(saved, false);
  accept(photo);
  await result;
  assert.equal(saved, true);
});

test('A failed thumbnail upload never creates metadata; retry keeps operation and skips confirmed original', async () => {
  const f = fixture();
  const upload = f.dependencies.upload;
  f.dependencies.upload = async (...args) => {
    if (args[1] === thumbnailPath) throw new Error('Storage offline');
    return upload(...args);
  };
  await assert.rejects(
    uploadAlbumPhoto(f.input, f.dependencies),
    /Storage offline/,
  );
  assert.deepEqual(f.finished, []);
  f.uploaded.length = 0;
  f.dependencies.prepare = async (args) => {
    f.prepared.push(args);
    return issued({ original_exists: true });
  };
  f.dependencies.upload = upload;
  await uploadAlbumPhoto(f.input, f.dependencies);
  assert.deepEqual(
    f.uploaded.map((item) => item.path),
    [thumbnailPath],
  );
  assert.equal(
    (f.prepared[1] as { p_operation_id: string }).p_operation_id,
    operationId,
  );
});

test('Lost metadata acknowledgement is safely retried without uploading either stored blob again', async () => {
  const f = fixture();
  f.dependencies.prepare = async () =>
    issued({ original_exists: true, thumbnail_exists: true });
  await uploadAlbumPhoto(f.input, f.dependencies);
  assert.deepEqual(f.uploaded, []);
  assert.deepEqual(f.finished, [
    { p_operation_id: operationId, p_caption: f.input.caption },
  ]);
  assert.deepEqual(f.progress, [110]);
});

test('Lost ACK retry shows canonical caption and preserves a changed local draft without overwriting newer server text', async () => {
  const f = fixture();
  const canonical = {
    ...photo,
    caption: 'Chú thích đã được người khác cập nhật',
  };
  let committed = false;
  f.dependencies.finish = async () => {
    committed = true;
    throw new Error('Response lost after commit');
  };
  await assert.rejects(
    uploadAlbumPhoto(f.input, f.dependencies),
    /Response lost/,
  );
  assert.equal(committed, true);
  f.input.caption = 'Bản nháp vừa sửa khi đang chờ thử lại';
  f.dependencies.prepare = async () =>
    issued({ original_exists: true, thumbnail_exists: true });
  f.dependencies.finish = async () => canonical;
  f.uploaded.length = 0;
  const confirmed = await uploadAlbumPhoto(f.input, f.dependencies);
  const state = reconcileAlbumUploadCaption(
    f.input.caption,
    (confirmed as typeof canonical).caption,
  );
  assert.equal(state.caption, canonical.caption);
  assert.equal(state.unsavedCaption, f.input.caption);
  assert.match(state.captionWarning, /Bản nháp chưa lưu/);
  assert.match(state.captionWarning, /Sửa chú thích/);
  assert.equal(canonical.caption, 'Chú thích đã được người khác cập nhật');
  assert.deepEqual(f.uploaded, []);
  assert.deepEqual(
    reconcileAlbumUploadCaption(canonical.caption, canonical.caption),
    {
      caption: canonical.caption,
      unsavedCaption: undefined,
      captionWarning: '',
    },
  );
});

test('Expired or unrelated permits never write Storage or metadata', async () => {
  for (const permit of [
    null,
    issued({ bucket: 'trip-covers' }),
    issued({ operation_id: albumId }),
    issued({ photo_id: 'invalid' }),
    issued({ original_path: '../secret.jpg' }),
    issued({ thumbnail_path: '/photos/thumbnail.webp' }),
    issued({ thumbnail_path: originalPath }),
    issued({ original_exists: 'true' }),
    issued({ expires_at: new Date(now).toISOString() }),
  ]) {
    const f = fixture();
    f.dependencies.prepare = async () => permit;
    await assert.rejects(uploadAlbumPhoto(f.input, f.dependencies));
    assert.deepEqual(f.uploaded, []);
    assert.deepEqual(f.finished, []);
  }
});

test('Invalid local data and server errors never become a successful saved photo', async () => {
  const f = fixture();
  f.input.thumbnail.blob = new Blob(['not webp'], { type: 'image/png' });
  await assert.rejects(uploadAlbumPhoto(f.input, f.dependencies), /thu nhỏ/);
  assert.deepEqual(f.prepared, []);
  const g = fixture();
  g.dependencies.finish = async () => ({ id: albumId, album_id: albumId });
  await assert.rejects(
    uploadAlbumPhoto(g.input, g.dependencies),
    /chưa xác nhận đúng ảnh/,
  );
});

test('Abort before prepare or between original and thumbnail prevents later writes and finish', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.dependencies.signal = controller.signal;
  controller.abort();
  await assert.rejects(uploadAlbumPhoto(f.input, f.dependencies), {
    name: 'AbortError',
  });
  assert.deepEqual(f.prepared, []);
  const g = fixture();
  const second = new AbortController();
  g.dependencies.signal = second.signal;
  g.dependencies.upload = async (...args) => {
    g.uploaded.push({ bucket: args[0], path: args[1], blob: args[2] });
    second.abort();
  };
  await assert.rejects(uploadAlbumPhoto(g.input, g.dependencies), {
    name: 'AbortError',
  });
  assert.equal(g.uploaded.length, 1);
  assert.deepEqual(g.finished, []);
});

class RequestDouble {
  headers = new Map<string, string>();
  upload = {
    onprogress: null as
      null | ((event: { lengthComputable: boolean; loaded: number }) => void),
  };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  status = 200;
  responseText = '{}';
  timeout = 0;
  method = '';
  url = '';
  sent: Blob | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers.set(key.toLowerCase(), value);
  }
  send(blob: Blob) {
    this.sent = blob;
  }
  abort() {
    this.onabort?.();
  }
}
function xhrFixture(publicKey = 'sb_publishable_test_public') {
  const request = new RequestDouble();
  const progress: number[] = [];
  const connection = {
    url: 'https://example.supabase.co',
    publicKey,
    xhr: () => request as unknown as XMLHttpRequest,
  };
  const options = { onProgress: (bytes: number) => progress.push(bytes) };
  return { request, connection, options, progress };
}

test('XHR uses apikey-only for modern public keys, immutable raw blob upload, and actual progress', async () => {
  const f = xhrFixture();
  const blob = new Blob(['bytes'], { type: 'image/webp' });
  const result = xhrAlbumStorageUpload(
    f.connection,
    'team-album',
    thumbnailPath,
    blob,
    f.options,
  );
  assert.equal(f.request.method, 'POST');
  assert.equal(
    f.request.url,
    `https://example.supabase.co/storage/v1/object/team-album/${thumbnailPath}`,
  );
  assert.equal(f.request.headers.get('apikey'), f.connection.publicKey);
  assert.equal(f.request.headers.has('authorization'), false);
  assert.equal(f.request.headers.get('x-upsert'), 'false');
  assert.equal(f.request.headers.get('content-type'), 'image/webp');
  assert.equal(f.request.sent, blob);
  f.request.upload.onprogress?.({ lengthComputable: true, loaded: 2 });
  assert.deepEqual(f.progress, [2]);
  f.request.onload?.();
  await result;
  assert.deepEqual(f.progress, [2, 5]);
});

test('XHR sends existing user JWT or legacy anon JWT while storage errors and abort reject', async () => {
  for (const accessToken of [null, 'eyJsession.token.signature']) {
    const f = xhrFixture('eyJlegacy.anon.signature');
    const result = xhrAlbumStorageUpload(
      { ...f.connection, accessToken },
      'team-album',
      originalPath,
      new Blob(['x']),
      f.options,
    );
    assert.equal(
      f.request.headers.get('authorization'),
      `Bearer ${accessToken || f.connection.publicKey}`,
    );
    f.request.status = 403;
    f.request.responseText = JSON.stringify({ message: 'Permission denied' });
    f.request.onload?.();
    await assert.rejects(result, /403.*Permission denied/);
  }
  const f = xhrFixture();
  const controller = new AbortController();
  const result = xhrAlbumStorageUpload(
    f.connection,
    'team-album',
    originalPath,
    new Blob(['x']),
    { ...f.options, signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});
