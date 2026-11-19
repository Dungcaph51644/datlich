import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uploadPaymentQr,
  validatePaymentQrFile,
  PAYMENT_QR_MAX_BYTES,
} from '../src/paymentQr';
const path = 'qr/10000000-0000-4000-8000-000000000001.png';
const image = () =>
  new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])],
    'qr.png',
    { type: 'image/png' },
  );
function fixture() {
  const calls: unknown[] = [];
  const deps = {
    prepare: async (args: unknown) => {
      calls.push(['prepare', args]);
      return {
        bucket: 'payment-qrs',
        path,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };
    },
    complete: async (p: string) => {
      calls.push(['complete', p]);
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (p: string, file: File, options: unknown) => {
          calls.push(['upload', bucket, p, file, options]);
          return {
            data: { path: p },
            error: null as { message: string } | null,
          };
        },
      }),
    },
  };
  return { calls, deps };
}
test('QR validation rejects unsafe/empty/oversized formats and forged image bytes before issuing a permit', async () => {
  for (const file of [
    new File(['x'], 'qr.svg', { type: 'image/svg+xml' }),
    new File(['x'], 'qr.HEIC', { type: 'image/heic' }),
    new File([], 'qr.png', { type: 'image/png' }),
    new File([new Uint8Array(PAYMENT_QR_MAX_BYTES + 1)], 'qr.png', {
      type: 'image/png',
    }),
  ])
    assert.throws(() => validatePaymentQrFile(file));
  const f = fixture();
  await assert.rejects(
    uploadPaymentQr(
      new File(['<html>fake</html>'], 'qr.png', { type: 'image/png' }),
      'activity',
      f.deps,
    ),
    /không đúng định dạng/,
  );
  assert.equal(f.calls.length, 0);
});
test('QR upload retains the exact original, never overwrites and completes only after matching Storage acknowledgement', async () => {
  const f = fixture(),
    file = image();
  assert.equal(await uploadPaymentQr(file, 'activity', f.deps), path);
  assert.deepEqual(f.calls, [
    [
      'prepare',
      { p_activity: 'activity', p_mime: 'image/png', p_size: file.size },
    ],
    [
      'upload',
      'payment-qrs',
      path,
      file,
      { contentType: 'image/png', upsert: false, cacheControl: '31536000' },
    ],
    ['complete', path],
  ]);
  for (const data of [null, { path: 'qr/wrong.png' }]) {
    const g = fixture();
    g.deps.storage.from = () =>
      ({ upload: async () => ({ data, error: null }) }) as any;
    await assert.rejects(
      uploadPaymentQr(image(), 'activity', g.deps),
      /chưa xác nhận/,
    );
    assert.equal(
      g.calls.some((c: any) => c[0] === 'complete'),
      false,
    );
  }
});
test('Expired, wrong MIME/bucket/path permits never reach Storage; upload or completion failures do not return a saved path', async () => {
  for (const patch of [
    { bucket: 'trip-covers' },
    { path: '../qr.png' },
    { path: path.replace('.png', '.jpg') },
    { expires_at: 'invalid' },
    { expires_at: new Date(0).toISOString() },
  ]) {
    const f = fixture();
    f.deps.prepare = async () => ({
      bucket: 'payment-qrs',
      path,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      ...patch,
    });
    await assert.rejects(
      uploadPaymentQr(image(), 'activity', f.deps),
      /Quyền tải QR/,
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.deps.storage.from = () =>
    ({
      upload: async () => ({ data: null, error: { message: 'Mất mạng' } }),
    }) as any;
  await assert.rejects(
    uploadPaymentQr(image(), 'activity', f.deps),
    /Mất mạng/,
  );
  assert.equal(
    f.calls.some((c: any) => c[0] === 'complete'),
    false,
  );
  const g = fixture();
  g.deps.complete = async () => {
    throw new Error('Không còn quyền');
  };
  await assert.rejects(
    uploadPaymentQr(image(), 'activity', g.deps),
    /Không còn quyền/,
  );
});
