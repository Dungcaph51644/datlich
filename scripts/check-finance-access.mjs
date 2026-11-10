// Read-only + nonexistent targets. No real expense, receipt or trip is changed.
import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
const env = loadEnv('development', process.cwd(), 'VITE_');
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY)
  throw new Error('Cần cấu hình Supabase trong .env.');
const client = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const snapshot = await client
  .rpc('get_activity_snapshot', { p_token: null })
  .abortSignal(AbortSignal.timeout(15000));
if (snapshot.error)
  throw new Error(
    'Cần chạy migration tài chính / du lịch: ' + snapshot.error.message,
  );
for (const a of snapshot.data.activities) {
  assert.equal(a.calculation, undefined);
  assert.equal(a.ledger, undefined);
  assert.equal(a.history, undefined);
  assert.equal(a.participants, undefined);
}
console.log(
  'Khách không nhận chi tiết tài chính, khoản thu, ghi chú hoặc danh sách khách du lịch.',
);
for (const table of [
  'club_activities',
  'activity_groups',
  'activity_billable',
  'activity_expenses',
  'activity_ledger',
  'activity_finalizations',
  'trip_participants',
  'trip_checklist',
  'finance_history',
]) {
  const r = await client
    .from(table)
    .select('*')
    .limit(1)
    .abortSignal(AbortSignal.timeout(15000));
  assert.equal(r.error?.code, '42501', `${table} phải chặn đọc trực tiếp.`);
  console.log(`Đã chặn đọc trực tiếp: ${table}.`);
}
const missing = '00000000-0000-4000-8000-000000000000';
for (const [name, args] of [
  [
    'save_activity_expense',
    {
      p_activity: missing,
      p_id: null,
      p_patch: { name: 'Kiểm tra quyền', actual: 1 },
    },
  ],
  [
    'record_activity_payment',
    {
      p_activity: missing,
      p_person: missing,
      p_kind: 'collection',
      p_amount: 1,
      p_operation: missing,
    },
  ],
  [
    'save_trip_participant',
    {
      p_activity: missing,
      p_id: null,
      p_patch: { member_id: missing, status: 'going' },
    },
  ],
  [
    'set_activity_fee_state',
    { p_id: missing, p_action: 'finalize', p_expected_revision: 0 },
  ],
]) {
  const r = await client
    .rpc(name, { ...args, p_token: missing })
    .abortSignal(AbortSignal.timeout(15000));
  assert.equal(r.error?.code, '42501');
  assert.match(r.error.message, /xác minh/);
  console.log(`Đã chặn giả member ID cho ${name}.`);
}
console.log(
  'Kiểm tra quyền tài chính đạt; không thay đổi dữ liệu thật. Đồng bộ hai người đã xác minh cần nghiệm thu riêng.',
);
