import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myTaskData } from '../src/MyTasks';
import { EMPTY, type CourtSession, type Snapshot } from '../src/types';
import type { ClubActivity, LedgerEntry } from '../src/activityTypes';

const now = new Date('2026-11-11T05:00:00Z');
const session = (id: string, patch: Partial<CourtSession> = {}): CourtSession => ({ id, session_date: '2026-11-12', start_time: '18:00:00', end_time: '20:00:00', venue: 'Sân A', court: 'Ca 1', address: '', maps_url: '', organizer_id: null, booking_status: 'pending', max_players: null, note: '', deadline: null, version: 1, ...patch });
test('My tasks contains only unanswered, upcoming, eligible and open sessions', () => {
  const sessions = [session('pending'), session('answered'), session('cancelled', { booking_status: 'cancelled' }), session('closed', { deadline: '2026-11-10T12:00:00Z' }), session('past', { session_date: '2026-11-10' }), session('other')];
  const data = { ...EMPTY, sessions, roster: sessions.filter((s) => s.id !== 'other').map((s) => ({ session_id: s.id, member_id: 'me' })), attendance: [{ session_id: 'answered', member_id: 'me', status: 'not_going' }] } as Snapshot;
  assert.deepEqual(myTaskData(data, 'me', null, now).pending.map((s) => s.id), ['pending']);
  assert.equal(myTaskData(data, null, null, now).pending.length, 0);
});
test('Money tasks use finalized server amounts and net collection/refund records, skip cancelled, merged and draft fees', () => {
  const activity = (id: string, patch: Partial<ClubActivity> = {}): ClubActivity => ({ id, kind: 'badminton', title: id, organizer_id: null, details: {}, status: 'open', fee_status: 'finalized', rounding: 1, reserve: 0, version: 1, calculation: { people: [{ id: 'person', member_id: 'me', due: 39500 }] }, ledger: [{ id: 'l1', person_id: 'person', kind: 'collection', amount: 20000, voided_at: null }, { id: 'l2', person_id: 'person', kind: 'refund', amount: 5000, voided_at: null }, { id: 'l3', person_id: 'person', kind: 'collection', amount: 999999, voided_at: '2026-11-01' }] as LedgerEntry[], ...patch } as ClubActivity);
  const data = { ...EMPTY, activities: { version: 1, revision: 1, activities: [activity('owe'), activity('draft', { fee_status: 'draft' }), activity('cancelled', { status: 'cancelled' }), activity('merged', { merged_into_id: 'owe' }), activity('refund', { ledger: [{ person_id: 'person', amount: 45000, kind: 'collection', voided_at: null }] as LedgerEntry[] })] } };
  assert.deepEqual(myTaskData(data, 'me', null, now).balances.map((row) => [row.activity.id, row.balance]), [['owe', 24500], ['refund', -5500]]);
});
test('Trips require a current open registration and hide responses already submitted', () => {
  const trip = (id: string, patch: Partial<ClubActivity> = {}): ClubActivity => ({ id, kind: 'trip', title: id, details: { end_date: '2026-11-20' }, status: 'open', fee_status: 'draft', participants: [], ...patch } as ClubActivity);
  const data = { ...EMPTY, activities: { version: 1, revision: 1, activities: [trip('pending'), trip('done', { participants: [{ member_id: 'me', status: 'going' }] as ClubActivity['participants'] }), trip('old', { details: { end_date: '2026-11-10' } }), trip('closed', { status: 'closed' }), trip('deadline', { details: { deadline: '2026-11-10T12:00:00Z' } })] } };
  assert.deepEqual(myTaskData(data, 'me', null, now).trips.map((a) => a.id), ['pending']);
});
