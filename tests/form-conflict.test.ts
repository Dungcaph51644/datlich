import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mergeConflictFields, sessionFormValues } from '../src/VersionConflict';
import type { CourtSession } from '../src/types';

test('Explicit keep draft retains edited fields and adopts untouched fields from the newest version', () => {
  const dom = new JSDOM('<form><input name="display_name" value="Tên cũ"><textarea name="note">Ghi chú cũ</textarea><input name="active" type="checkbox" checked></form>');
  const form = dom.window.document.querySelector('form')!;
  (form.elements.namedItem('note') as HTMLTextAreaElement).value = 'Tôi đang nhập';
  const before = { display_name: 'Tên cũ', note: 'Ghi chú cũ', active: true };
  const latest = { display_name: 'Tên mới từ thiết bị B', note: 'B sửa ghi chú', active: false };
  const result = mergeConflictFields(form, before, latest, true);
  assert.deepEqual(result, { display_name: 'Tên mới từ thiết bị B', note: 'Tôi đang nhập', active: false });
  assert.equal((form.elements.namedItem('display_name') as HTMLInputElement).value, latest.display_name);
  assert.equal((form.elements.namedItem('note') as HTMLTextAreaElement).value, 'Tôi đang nhập');
  assert.equal((form.elements.namedItem('active') as HTMLInputElement).checked, false);
  const patch = Object.fromEntries(Object.entries(result).filter(([key, value]) => latest[key as keyof typeof latest] !== value));
  assert.deepEqual(patch, { note: 'Tôi đang nhập' });
});
test('Explicit use latest replaces both typed text and checkboxes', () => {
  const dom = new JSDOM('<form><input name="display_name" value="Tôi sửa"><input name="active" type="checkbox" checked></form>');
  const form = dom.window.document.querySelector('form')!;
  const result = mergeConflictFields(form, { display_name: 'Cũ', active: true }, { display_name: 'Bản B', active: false }, false);
  assert.deepEqual(result, { display_name: 'Bản B', active: false });
  assert.equal((form.elements.namedItem('display_name') as HTMLInputElement).value, 'Bản B');
  assert.equal((form.elements.namedItem('active') as HTMLInputElement).checked, false);
});
test('Session comparison normalizes time, nullable numbers and deadline to Vietnam input values', () => {
  const fields = sessionFormValues({ session_date: '2026-11-11', start_time: '18:00:00', end_time: '20:00:00', venue: 'A', court: '1', address: '', maps_url: '', organizer_id: null, booking_status: 'pending', max_players: null, note: '', deadline: '2026-11-11T05:00:00Z', estimated_cost: 250000 } as CourtSession);
  assert.equal(fields.start_time, '18:00');
  assert.equal(fields.max_players, '');
  assert.equal(fields.estimated_cost, '250000');
  assert.equal(fields.deadline, '2026-11-11T12:00');
  assert.equal(fields.organizer_mode, 'weekly');
});
