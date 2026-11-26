import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avatarCrop,
  memberAvatarUrl,
  uploadMemberAvatar,
  validateAvatarHeader,
  validateAvatarInput,
  type AvatarUploadAttempt,
  type AvatarUploadDependencies,
} from '../src/memberAvatarUpload';
const path = 'avatars/10000000-0000-4000-8000-000000000001.webp';
const file = () =>
  new File(['RIFFxxxxWEBPmore pixels'], 'avatar.webp', { type: 'image/webp' });
function dependencies() {
  const calls: string[] = [];
  const deps: AvatarUploadDependencies = {
    now: () => 1000,
    prepare: async () => {
      calls.push('prepare');
      return {
        bucket: 'member-avatars',
        path,
        expires_at: new Date(5000).toISOString(),
      };
    },
    storage: {
      from: (bucket) => {
        assert.equal(bucket, 'member-avatars');
        return {
          upload: async (p, f, options) => {
            calls.push('upload');
            assert.equal(p, path);
            assert.equal(f.type, 'image/webp');
            assert.equal(options.upsert, false);
            return { data: { path: p }, error: null };
          },
        };
      },
    },
    complete: async (p) => {
      calls.push('complete');
      assert.equal(p, path);
    },
  };
  return { deps, calls };
}
test('Avatar validation rejects unsupported, empty, oversized, malformed files; crop is bounded and centered', async () => {
  for (const f of [
    new File(['a'], 'x.svg', { type: 'image/svg+xml' }),
    new File([], 'x.png', { type: 'image/png' }),
    new File(['a'], 'x.heic', { type: 'image/heic' }),
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'x.jpg', {
      type: 'image/jpeg',
    }),
  ])
    assert.throws(() => validateAvatarInput(f));
  await assert.rejects(
    validateAvatarHeader(new File(['not png'], 'x.png', { type: 'image/png' })),
    /định dạng/,
  );
  await validateAvatarHeader(file());
  assert.deepEqual(avatarCrop(1200, 800), { x: 200, y: 0, side: 800 });
  assert.deepEqual(avatarCrop(800, 1200), { x: 0, y: 200, side: 800 });
  assert.throws(() => avatarCrop(40000, 40000));
  assert.throws(() => avatarCrop(0, 10));
});
test('Custom avatar URLs accept only the dedicated bucket path and configured secure host', () => {
  assert.equal(
    memberAvatarUrl(path, 'https://project.supabase.co'),
    `https://project.supabase.co/storage/v1/object/public/member-avatars/${path}`,
  );
  for (const value of [
    'https://evil.invalid/a.webp',
    'avatars/../secret.webp',
    'qr/10000000-0000-4000-8000-000000000001.webp',
    path + '?x=1',
  ])
    assert.equal(memberAvatarUrl(value, 'https://project.supabase.co'), '');
  assert.equal(memberAvatarUrl(path, 'javascript:alert(1)'), '');
  assert.equal(memberAvatarUrl(path, 'http://evil.invalid'), '');
});
test('Upload waits for Storage and confirmation, then retries a failed profile save without another upload', async () => {
  const { deps, calls } = dependencies();
  const attempt: AvatarUploadAttempt = { file: file() };
  assert.equal(await uploadMemberAvatar(attempt, deps), path);
  assert.deepEqual(calls, ['prepare', 'upload', 'complete']);
  assert.equal(await uploadMemberAvatar(attempt, deps), path);
  assert.equal(calls.length, 3);
});
test('A failed confirmation is retried against the same object; invalid permits never upload', async () => {
  const { deps, calls } = dependencies();
  let fail = true;
  deps.complete = async () => {
    calls.push('complete');
    if (fail) throw new Error('Mất kết nối');
  };
  const attempt: AvatarUploadAttempt = { file: file() };
  await assert.rejects(uploadMemberAvatar(attempt, deps), /Mất kết nối/);
  fail = false;
  await uploadMemberAvatar(attempt, deps);
  assert.deepEqual(calls, ['prepare', 'upload', 'complete', 'complete']);
  for (const bad of [
    { bucket: 'other', path, expires_at: new Date(5000).toISOString() },
    {
      bucket: 'member-avatars',
      path: 'https://evil.invalid',
      expires_at: new Date(5000).toISOString(),
    },
    { bucket: 'member-avatars', path, expires_at: new Date(500).toISOString() },
  ]) {
    const d = dependencies();
    d.deps.prepare = async () => bad;
    await assert.rejects(
      uploadMemberAvatar({ file: file() }, d.deps),
      /không hợp lệ/,
    );
    assert.deepEqual(d.calls, []);
  }
});

test('Lost upload acknowledgements recover only through exact backend confirmation', async () => {
  const { deps, calls } = dependencies();
  deps.storage.from = () => ({
    upload: async () => {
      calls.push('upload');
      throw new Error('Network disconnected');
    },
  });
  const attempt: AvatarUploadAttempt = { file: file() };
  assert.equal(await uploadMemberAvatar(attempt, deps), path);
  assert.equal(attempt.complete, true);
  assert.deepEqual(calls, ['prepare', 'upload', 'complete']);
  const fail = dependencies();
  fail.deps.storage.from = () => ({
    upload: async () => ({ data: null, error: { message: 'Upload denied' } }),
  });
  fail.deps.complete = async () => {
    throw new Error('Không có ảnh');
  };
  await assert.rejects(
    uploadMemberAvatar({ file: file() }, fail.deps),
    /Upload denied/,
  );
});
