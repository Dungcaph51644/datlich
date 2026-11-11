import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClubSnapshots, type AppSnapshotCapability, type SnapshotRpcClient } from '../src/clubTransport';

function club(version = 3) {
  return { version, sessions: [], members: [], attendance: [], roster: [] };
}
function booking() {
  return {
    revision: 9, initialized: true, realtime_enabled: true, identity_expired: false,
    verified_member_id: 'member-a', identity_source: 'code', setup_issues: [],
    assignments: [], rotation: [], requests: [], notifications: [], history: [], credential_status: [],
  };
}
function activities() {
  return { version: 1, revision: 9, automatic_fees: true, activities: [] };
}
function combined() {
  return { version: 1, practical_updates: true, club: club(), booking: booking(), activities: activities() };
}
const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find function' } };
const ok = (data: unknown) => ({ data, error: null });
function clientWith(responses: { data: unknown; error: { code?: string; message?: string } | null }[]) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const client: SnapshotRpcClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      assert.ok(responses.length > 0, `Unexpected request: ${name}`);
      return responses.shift()!;
    },
  };
  return { client, calls };
}

test('Installed combined snapshot uses one RPC, forwards identity and reconstructs one shared roster', async () => {
  const data = combined();
  const { client, calls } = clientWith([ok(data)]);
  const capability: AppSnapshotCapability = { current: null };
  const result = await loadClubSnapshots(client, 'opaque-device-token', capability);
  assert.deepEqual(calls, [{ name: 'get_app_snapshot', args: { p_token: 'opaque-device-token' } }]);
  assert.equal(capability.current, true);
  assert.equal(result.snapshot, data.club);
  assert.equal(result.booking!.club, result.snapshot);
  assert.equal(result.activities!.club, result.snapshot);
  assert.equal(result.booking!.verified_member_id, 'member-a');
  assert.equal(result.bookingProblem, '');
  assert.equal(result.activityProblem, '');
});

test('Missing combined RPC is probed once, then later refreshes use only the legacy chain', async () => {
  const replies = () => [ok(club()), ok({ ...booking(), club: club() }), ok({ ...activities(), club: club() })];
  const { client, calls } = clientWith([missing, ...replies(), ...replies()]);
  const capability: AppSnapshotCapability = { current: null };
  const first = await loadClubSnapshots(client, null, capability);
  const second = await loadClubSnapshots(client, 'next-token', capability);
  assert.equal(capability.current, false);
  assert.ok(first.activities);
  assert.ok(second.activities);
  assert.deepEqual(calls.map((call) => call.name), ['get_app_snapshot', 'get_quick_snapshot', 'get_booking_snapshot', 'get_activity_snapshot', 'get_quick_snapshot', 'get_booking_snapshot', 'get_activity_snapshot']);
  assert.deepEqual(calls[0].args, { p_token: null });
  assert.deepEqual(calls[2].args, { p_token: null });
  assert.deepEqual(calls[3].args, { p_token: null });
  assert.deepEqual(calls[5].args, { p_token: 'next-token' });
  assert.deepEqual(calls[6].args, { p_token: 'next-token' });
});

test('PostgreSQL undefined-function also activates compatibility mode', async () => {
  const { client, calls } = clientWith([{ data: null, error: { code: '42883', message: 'undefined function' } }, ok(club(1))]);
  const capability: AppSnapshotCapability = { current: true };
  const result = await loadClubSnapshots(client, null, capability);
  assert.equal(capability.current, false);
  assert.equal(calls.length, 2);
  assert.equal(result.snapshot!.version, 1);
  assert.equal(result.booking, null);
});

test('Permission, server and connection errors do not downgrade to a fake successful legacy read', async () => {
  for (const code of ['42501', '500', 'PGRST000']) {
    const error = { code, message: `Failure ${code}` };
    const { client, calls } = clientWith([{ data: null, error }]);
    const capability: AppSnapshotCapability = { current: null };
    await assert.rejects(loadClubSnapshots(client, null, capability), (thrown) => thrown === error);
    assert.equal(calls.length, 1);
    assert.equal(capability.current, null);
  }
});

test('Malformed combined version, shared arrays and module arrays fail without caching success', async () => {
  const base = combined();
  for (const data of [null, { ...base, version: 2 }, { ...base, practical_updates: false }, { ...base, club: { ...club(), attendance: null } }, { ...base, booking: { ...booking(), assignments: {} } }, { ...base, activities: { ...activities(), activities: null } }, { ...base, activities: { ...activities(), revision: -1 } }]) {
    const { client, calls } = clientWith([ok(data)]);
    const capability: AppSnapshotCapability = { current: null };
    await assert.rejects(loadClubSnapshots(client, null, capability), /không hợp lệ/);
    assert.equal(calls.length, 1);
    assert.equal(capability.current, null);
  }
});

test('A rejected transport read propagates its original error', async () => {
  const failure = new Error('Connection interrupted');
  const client: SnapshotRpcClient = { rpc: async () => { throw failure; } };
  const capability: AppSnapshotCapability = { current: true };
  await assert.rejects(loadClubSnapshots(client, null, capability), (error) => error === failure);
  assert.equal(capability.current, true);
});

test('Missing quick RPC returns null so the existing public-schedule fallback can run', async () => {
  const { client, calls } = clientWith([missing]);
  const result = await loadClubSnapshots(client, null, { current: false });
  assert.deepEqual(result, { snapshot: null, booking: null, activities: null, bookingProblem: '', activityProblem: '' });
  assert.deepEqual(calls.map((call) => call.name), ['get_quick_snapshot']);
});

test('Malformed or failed core legacy data never becomes an empty roster', async () => {
  const bad = { ...club(), sessions: undefined };
  await assert.rejects(loadClubSnapshots(clientWith([ok(bad)]).client, null, { current: false }), /không hợp lệ/);
  const error = { code: '42501', message: 'Read failed' };
  await assert.rejects(loadClubSnapshots(clientWith([{ data: null, error }]).client, null, { current: false }), (thrown) => thrown === error);
});

test('A booking-module error retains the useful quick snapshot and does not request finance', async () => {
  const quick = club();
  const { client, calls } = clientWith([ok(quick), { data: null, error: { code: 'PT409', message: 'Booking read failed' } }]);
  const result = await loadClubSnapshots(client, null, { current: false });
  assert.equal(result.snapshot, quick);
  assert.equal(result.booking, null);
  assert.equal(result.activities, null);
  assert.equal(result.bookingProblem, 'Booking read failed');
  assert.equal(calls.length, 2);
});

test('Malformed legacy booking data is isolated to its module', async () => {
  const quick = club();
  const { client } = clientWith([ok(quick), ok({ ...booking(), requests: null, club: club() })]);
  const result = await loadClubSnapshots(client, null, { current: false });
  assert.equal(result.snapshot, quick);
  assert.equal(result.booking, null);
  assert.match(result.bookingProblem, /không hợp lệ/);
});

test('Finance-module errors retain booking and the roster from its successful read', async () => {
  const bookingClub = club();
  const { client } = clientWith([ok(club()), ok({ ...booking(), club: bookingClub }), { data: null, error: { code: '500', message: 'Finance read failed' } }]);
  const result = await loadClubSnapshots(client, null, { current: false });
  assert.equal(result.snapshot, bookingClub);
  assert.ok(result.booking);
  assert.equal(result.activities, null);
  assert.equal(result.activityProblem, 'Finance read failed');
});

test('Malformed legacy finance data is isolated and an uninstalled finance module stays a setup state', async () => {
  for (const [reply, expectedProblem] of [[ok({ ...activities(), activities: null }), /không hợp lệ/], [missing, /^$/]] as const) {
    const { client } = clientWith([ok(club()), ok({ ...booking(), club: club() }), reply]);
    const result = await loadClubSnapshots(client, null, { current: false });
    assert.ok(result.snapshot);
    assert.ok(result.booking);
    assert.equal(result.activities, null);
    assert.match(result.activityProblem, expectedProblem);
  }
});

test('Legacy finance uses its own shared roster, preserving consistency with its draft calculations', async () => {
  const finalClub = { ...club(), members: [{ id: 'fresh-member' }] };
  const { client } = clientWith([ok(club()), ok({ ...booking(), club: club() }), ok({ ...activities(), club: finalClub })]);
  const result = await loadClubSnapshots(client, null, { current: false });
  assert.equal(result.snapshot, finalClub);
  assert.equal(result.activities!.club, finalClub);
});
