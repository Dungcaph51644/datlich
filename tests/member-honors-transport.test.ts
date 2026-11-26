import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGES, loadMemberHub, parseMemberHub } from '../src/memberHonors';
const valid = () => ({
  version: 1,
  month: '2026-11',
  as_of: new Date().toISOString(),
  viewer_member_id: null,
  profiles: [
    {
      member_id: 'a',
      avatar_key: '',
      featured_badge: '',
      version: 0,
      badges: BADGES.map((b) => ({
        key: b.key,
        progress: 0,
        target: 1,
        earned: false,
        awarded_month: null,
      })),
    },
  ],
  votes: [],
  mine: [],
});
test('Member hub preserves verified token and validates server DTO', async () => {
  const calls: unknown[] = [];
  const result = await loadMemberHub(
    {
      rpc: async (...args) => {
        calls.push(args);
        return { data: valid(), error: null };
      },
    },
    'verified-token',
  );
  assert.deepEqual(calls, [['get_member_hub', { p_token: 'verified-token' }]]);
  assert.equal(result.memberHubError, '');
  assert.equal(result.memberHub?.profiles.length, 1);
});
test('Missing migration, query failure and malformed responses remain explicit and recoverable', async () => {
  for (const data of [
    null,
    {},
    { ...valid(), profiles: [null] },
    { ...valid(), profiles: [{ ...valid().profiles[0], badges: [] }] },
  ])
    assert.throws(() => parseMemberHub(data), /không hợp lệ/);
  const missing = await loadMemberHub(
    { rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) },
    null,
  );
  assert.equal(missing.memberHub, null);
  assert.match(missing.memberHubError, /chưa được bật/);
  const failure = await loadMemberHub(
    {
      rpc: async () => {
        throw new Error('Mất kết nối');
      },
    },
    null,
  );
  assert.equal(failure.memberHub, null);
  assert.match(failure.memberHubError, /Mất kết nối/);
  const recovered = await loadMemberHub(
    { rpc: async () => ({ data: valid(), error: null }) },
    null,
  );
  assert.ok(recovered.memberHub);
});
