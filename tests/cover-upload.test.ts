import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIP_COVER_MAX_BYTES,
  uploadTripCover,
  validateTripCoverFile,
  type TripCoverUploadDependencies,
} from '../src/coverUpload';

const path = 'covers/4269364e-c8fe-4f20-9e53-5ab5c9567cab.jpg';
const onlineUrl = `https://example.supabase.co/storage/v1/object/public/trip-covers/${path}`;
const now = Date.parse('2026-11-10T10:00:00Z');
function issued(overrides: Record<string, unknown> = {}) {
  return {
    bucket: 'trip-covers',
    path,
    expires_at: new Date(now + 15 * 60_000).toISOString(),
    ...overrides,
  };
}
function image(type = 'image/jpeg', size = 3, name = 'anh.jpg') {
  return new File([new Uint8Array(size)], name, { type });
}
function fixture() {
  const prepared: unknown[] = [];
  const uploaded: unknown[] = [];
  const publicPaths: string[] = [];
  const dependencies: TripCoverUploadDependencies = {
    now: () => now,
    prepare: async (args) => {
      prepared.push(args);
      return issued();
    },
    storage: {
      from: (bucket) => ({
        upload: async (key, file, options) => {
          uploaded.push({ bucket, key, file, options });
          return { data: { path: key }, error: null };
        },
        getPublicUrl: (key) => {
          publicPaths.push(key);
          return { data: { publicUrl: onlineUrl } };
        },
      }),
    },
  };
  return { dependencies, prepared, uploaded, publicPaths };
}

test('Cover files accept JPG/PNG/WebP up to 5 MB and reject empty, HEIC, SVG and oversized files', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp'])
    assert.doesNotThrow(() => validateTripCoverFile(image(type)));
  assert.doesNotThrow(() =>
    validateTripCoverFile(image('image/jpeg', TRIP_COVER_MAX_BYTES)),
  );
  assert.throws(() => validateTripCoverFile(image('image/heic')), /HEIC\/HEIF/);
  assert.throws(
    () => validateTripCoverFile(image('', 4, 'dien-thoai.HEIF')),
    /xuất ảnh sang JPG/,
  );
  assert.throws(
    () => validateTripCoverFile(image('image/svg+xml')),
    /JPG, PNG/,
  );
  assert.throws(() => validateTripCoverFile(image('image/jpeg', 0)), /trống/);
  assert.throws(
    () => validateTripCoverFile(image('image/jpeg', TRIP_COVER_MAX_BYTES + 1)),
    /vượt quá 5 MB/,
  );
});

test('Upload uses the verified permit, exact file, explicit MIME and no overwrite', async () => {
  const f = fixture();
  const file = image();
  assert.equal(
    await uploadTripCover(file, 'trip-id', f.dependencies),
    onlineUrl,
  );
  assert.deepEqual(f.prepared, [
    { p_activity: 'trip-id', p_mime: 'image/jpeg', p_size: 3 },
  ]);
  assert.deepEqual(f.uploaded, [
    {
      bucket: 'trip-covers',
      key: path,
      file,
      options: {
        contentType: 'image/jpeg',
        upsert: false,
        cacheControl: '31536000',
      },
    },
  ]);
  assert.deepEqual(f.publicPaths, [path]);
});

test('No online URL or successful result is produced before Storage acknowledgement', async () => {
  const f = fixture();
  let accept!: (value: { data: { path: string }; error: null }) => void;
  const originalFrom = f.dependencies.storage.from;
  f.dependencies.storage.from = (bucket) => ({
    ...originalFrom(bucket),
    upload: async () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  });
  let completed = false;
  const result = uploadTripCover(image(), null, f.dependencies).then((url) => {
    completed = true;
    return url;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  assert.deepEqual(f.publicPaths, []);
  assert.deepEqual(f.prepared, [
    { p_activity: null, p_mime: 'image/jpeg', p_size: 3 },
  ]);
  accept({ data: { path }, error: null });
  assert.equal(await result, onlineUrl);
});

test('Validation and denied permit errors prevent all Storage writes', async () => {
  const f = fixture();
  await assert.rejects(
    uploadTripCover(image('application/pdf'), null, f.dependencies),
    /JPG, PNG/,
  );
  assert.deepEqual(f.prepared, []);
  f.dependencies.prepare = async () => {
    throw new Error('Chỉ người phụ trách được tải ảnh.');
  };
  await assert.rejects(
    uploadTripCover(image(), undefined, f.dependencies),
    /Không thể cấp quyền tải ảnh: Chỉ người phụ trách/,
  );
  assert.deepEqual(f.uploaded, []);
});

test('An expired, malformed or unrelated upload destination is never used', async () => {
  for (const destination of [
    null,
    issued({ bucket: 'other-bucket' }),
    issued({ path: '../private/file.jpg' }),
    issued({ path: '/covers/file.jpg' }),
    issued({ path: 'covers//file.jpg' }),
    issued({ path: 'covers/%2e%2e/file.jpg' }),
    issued({ path: 'covers/file.svg' }),
    issued({ expires_at: new Date(now).toISOString() }),
    issued({ expires_at: 'invalid' }),
  ]) {
    const f = fixture();
    f.dependencies.prepare = async () => destination;
    await assert.rejects(uploadTripCover(image(), null, f.dependencies));
    assert.deepEqual(f.uploaded, []);
    assert.deepEqual(f.publicPaths, []);
  }
});

test('Failed uploads return no URL; retry requests a fresh permit and still never overwrites', async () => {
  const f = fixture();
  let attempts = 0;
  const originalFrom = f.dependencies.storage.from;
  f.dependencies.storage.from = (bucket) => {
    const original = originalFrom(bucket);
    return {
      ...original,
      upload: async (...args) => {
        attempts += 1;
        if (attempts === 1)
          return { data: null, error: { message: 'Mất kết nối Storage' } };
        return original.upload(...args);
      },
    };
  };
  await assert.rejects(
    uploadTripCover(image(), null, f.dependencies),
    /Tải ảnh thất bại: Mất kết nối Storage/,
  );
  assert.deepEqual(f.publicPaths, []);
  assert.equal(await uploadTripCover(image(), null, f.dependencies), onlineUrl);
  assert.equal(f.prepared.length, 2);
  assert.equal(attempts, 2);
});

test('Missing or mismatched server file acknowledgement is not reported as success', async () => {
  for (const data of [null, { path: 'covers/another.jpg' }]) {
    const f = fixture();
    const originalFrom = f.dependencies.storage.from;
    f.dependencies.storage.from = (bucket) => ({
      ...originalFrom(bucket),
      upload: async () => ({ data, error: null }),
    });
    await assert.rejects(
      uploadTripCover(image(), null, f.dependencies),
      /chưa xác nhận đúng file/,
    );
    assert.deepEqual(f.publicPaths, []);
  }
});

test('Only a matching HTTPS public Storage URL can be saved as a cover', async () => {
  for (const publicUrl of [
    onlineUrl.replace('https:', 'http:'),
    onlineUrl.replace('trip-covers', 'another-bucket'),
    onlineUrl.replace(path, 'covers/unrelated.jpg'),
    `data:image/jpeg;base64,AA==`,
    onlineUrl.replace('https://', 'https://user:secret@'),
  ]) {
    const f = fixture();
    const originalFrom = f.dependencies.storage.from;
    f.dependencies.storage.from = (bucket) => ({
      ...originalFrom(bucket),
      getPublicUrl: () => ({ data: { publicUrl } }),
    });
    await assert.rejects(
      uploadTripCover(image(), null, f.dependencies),
      /Tải ảnh thất bại/,
    );
  }
});
