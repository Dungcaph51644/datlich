// Negative authorization checks against the configured REAL Supabase.
// Uses nonexistent mutation targets: this script never changes a real assignment.
import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';

const env = loadEnv('development', process.cwd(), 'VITE_');
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Cấu hình hai biến VITE_SUPABASE_* trong .env trước.');
}
const client = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const snapshot = await client
  .rpc('get_booking_snapshot', { p_token: null })
  .abortSignal(AbortSignal.timeout(15000));
if (snapshot.error)
  throw new Error('Chưa có API CS: ' + snapshot.error.message);
assert.equal(snapshot.data.verified_member_id, null);
assert.deepEqual(snapshot.data.requests, []);
assert.deepEqual(snapshot.data.notifications, []);
assert.deepEqual(snapshot.data.history, []);
assert.deepEqual(snapshot.data.credential_status, []);
console.log(
  'Khách chỉ thấy lịch công khai; không nhận yêu cầu, thông báo, lịch sử hoặc dữ liệu cấp mã.',
);

for (const table of [
  'booking_swap_requests',
  'booking_notifications',
  'booking_history',
]) {
  const result = await client
    .from(table)
    .select('id')
    .limit(1)
    .abortSignal(AbortSignal.timeout(15000));
  assert.ok(
    result.error,
    `Bảng riêng ${table} không được đọc trực tiếp bởi khách.`,
  );
  assert.equal(result.error.code, '42501');
  console.log(`Đã chặn đọc trực tiếp: ${table}.`);
}
const fakeToken =
  snapshot.data.club.members[0]?.id ?? '00000000-0000-4000-8000-000000000000';
const missingId = '00000000-0000-4000-8000-000000000000';
for (const [name, args] of [
  [
    'request_booking_swap',
    {
      p_assignment_id: missingId,
      p_reason: 'Kiểm tra quyền',
      p_token: fakeToken,
    },
  ],
  [
    'respond_booking_swap',
    { p_request_id: missingId, p_decision: 'accept', p_token: fakeToken },
  ],
  [
    'update_booking_session',
    { p_id: missingId, p_patch: {}, p_expected_version: 0, p_token: fakeToken },
  ],
]) {
  const result = await client
    .rpc(name, args)
    .abortSignal(AbortSignal.timeout(15000));
  assert.ok(result.error, `${name} phải từ chối member ID giả làm token.`);
  assert.equal(result.error.code, '42501');
  assert.match(result.error.message, /xác minh/);
  console.log(`Đã chặn dùng member ID làm danh tính: ${name}.`);
}
console.log(
  'Kiểm tra quyền trực tuyến đạt; không thay đổi phân công hoặc dữ liệu sân. Luồng hai người đã xác minh cần nghiệm thu riêng.',
);
