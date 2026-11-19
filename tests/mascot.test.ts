import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mascotBanter,
  mascotReminder,
  momentMessage,
  parseMascotPreferences,
  registrationMoment,
} from '../src/mascot';
import {
  EMPTY,
  type Attendance,
  type CourtSession,
  type Member,
  type Snapshot,
} from '../src/types';

const now = new Date('2030-05-21T04:00:00Z');
const member: Member = {
  id: 'a',
  display_name: 'Yến',
  code: 'A',
  active: true,
  note: '',
  version: 1,
};
const session: CourtSession = {
  id: 's',
  session_date: '2030-05-21',
  start_time: '18:00',
  end_time: '20:00',
  venue: 'Sân thật',
  court: '1',
  address: '',
  maps_url: '',
  organizer_id: null,
  booking_status: 'booked',
  max_players: 4,
  note: '',
  deadline: null,
  version: 1,
};
const row = (status: Attendance['status'], id = 'a'): Attendance => ({
  id: id + '-row',
  session_id: 's',
  member_id: id,
  status,
  note: '',
  note_version: 0,
  updated_at: now.toISOString(),
});
const data = (patch: Partial<Snapshot> = {}): Snapshot => ({
  ...EMPTY,
  members: [member, { ...member, id: 'b', display_name: 'Hiền' }],
  sessions: [session],
  roster: [{ session_id: 's', member_id: 'a' }],
  ...patch,
});

test('Acknowledged moments exclude notes, unchanged responses, inactive names and cancelled/missing sessions', () => {
  for (const status of [null, undefined, 'unanswered', 'paid'])
    assert.equal(registrationMoment(data(), 'a', 'a', ['s'], status, 1), null);
  assert.equal(
    registrationMoment(
      data({ attendance: [row('going')] }),
      'a',
      'a',
      ['s'],
      'going',
      1,
    ),
    null,
  );
  assert.equal(
    registrationMoment(
      data({ members: [{ ...member, active: false }] }),
      'a',
      'a',
      ['s'],
      'going',
      1,
    ),
    null,
  );
  assert.equal(
    registrationMoment(
      data({ sessions: [{ ...session, booking_status: 'cancelled' }] }),
      'a',
      'a',
      ['s'],
      'going',
      1,
    ),
    null,
  );
  assert.equal(
    registrationMoment(data(), 'a', 'unknown', ['s'], 'going', 1),
    null,
  );
  const event = registrationMoment(
    data(),
    'a',
    'a',
    ['s', 's', 'missing'],
    'going',
    1,
  )!;
  assert.deepEqual(event.sessionIds, ['s']);
  assert.ok(event.createdAt <= Date.now());
});
test('Proxy registrations name the target, do not replay for a different selected identity and need matching fresh facts', () => {
  const event = registrationMoment(data(), 'a', 'b', ['s'], 'going', 2)!;
  assert.equal(momentMessage(event, data(), 'a'), null); // Snapshot has not acknowledged this status yet.
  const after = data({ attendance: [row('going', 'b')] });
  assert.match(momentMessage(event, after, 'a')!.text, /cho Hiền/);
  assert.equal(momentMessage(event, after, 'b'), null);
  assert.equal(
    momentMessage(
      event,
      data({ sessions: [{ ...session, booking_status: 'cancelled' }] }),
      'a',
    ),
    null,
  );
  assert.match(
    momentMessage({ ...event, viewerId: 'b' }, after, 'b')!.text,
    /Đã lưu/,
  );
});
test('Only server-confirmed attendance counts can announce a full team, and declining has a friendly wave', () => {
  const event = registrationMoment(data(), 'a', 'a', ['s'], 'going', 2)!;
  const full = data({
    sessions: [{ ...session, going_count: 4 }],
    attendance: [row('going')],
  });
  assert.equal(momentMessage(event, full, 'a')!.title, 'Đủ đội hình rồi!');
  const unlimited = data({
    sessions: [{ ...session, max_players: null, going_count: 20 }],
    attendance: [row('going')],
  });
  assert.doesNotMatch(momentMessage(event, unlimited, 'a')!.title, /Đủ/);
  const declined = registrationMoment(data(), 'a', 'a', ['s'], 'not_going', 3)!;
  assert.equal(
    momentMessage(declined, data({ attendance: [row('not_going')] }), 'a')!
      .mood,
    'wave',
  );
});
test('Reminder uses Vietnam dates, sorts sessions, opens the exact session and distinguishes a booking still pending', () => {
  const lateUtc = new Date('2030-05-20T18:00:00Z'); // 01:00 on 21/05 in Vietnam.
  const d = data({ attendance: [row('going')] });
  const reminder = mascotReminder(d, 'a', lateUtc)!;
  assert.match(reminder.title, /Hôm nay/);
  assert.match(reminder.detail, /21\/05 · 18:00–20:00 · Sân thật · 1/);
  assert.equal(reminder.sessionId, 's');
  assert.match(
    mascotReminder(
      { ...d, sessions: [{ ...session, booking_status: 'pending' }] },
      'a',
      now,
    )!.text,
    /chờ đặt/,
  );
  assert.match(
    mascotReminder(d, 'a', new Date('2030-05-21T12:00:00Z'))!.text,
    /đang diễn ra/,
  );
  assert.equal(mascotReminder(d, 'a', new Date('2030-05-21T13:01:00Z')), null);
});
test('Unanswered reminders exclude closed, full, distant, cancelled and non-roster sessions; no fabricated places or dates', () => {
  assert.match(mascotReminder(data(), 'a', now)!.text, /chưa phản hồi/);
  assert.equal(mascotReminder(data(), null, now), null);
  assert.equal(mascotReminder(data(), 'b', now), null);
  assert.equal(
    mascotReminder(data({ attendance: [row('not_going')] }), 'a', now),
    null,
  );
  for (const patch of [
    { deadline: '2030-05-21T03:59:00Z' },
    { booking_status: 'cancelled' as const },
    { going_count: 4 },
    { session_date: '2030-06-21' },
    { session_date: '2030-05-20' },
  ])
    assert.equal(
      mascotReminder(data({ sessions: [{ ...session, ...patch }] }), 'a', now),
      null,
    );
  const before = mascotReminder(data(), 'a', now)!;
  const after = mascotReminder(
    data({ sessions: [{ ...session, start_time: '19:00', venue: 'Sân mới' }] }),
    'a',
    now,
  )!;
  assert.notEqual(before.key, after.key);
  assert.match(after.detail, /19:00–20:00 · Sân mới/);
});
test('Preference defaults tolerate missing/corrupt data; hiding and disabling animation are independent', () => {
  for (const value of [null, '', '{bad', 'null', '42'])
    assert.deepEqual(parseMascotPreferences(value), {
      hidden: false,
      motion: true,
      autoTalk: true,
      smash: true,
    });
  assert.deepEqual(parseMascotPreferences('{"hidden":true,"motion":false}'), {
    hidden: true,
    motion: false,
    autoTalk: true,
    smash: true,
  });
  assert.deepEqual(
    parseMascotPreferences('{"hidden":"true","motion":"false"}'),
    { hidden: false, motion: true, autoTalk: true, smash: true },
  );
  assert.equal(parseMascotPreferences('{"autoTalk":false}').autoTalk, false);
  assert.equal(parseMascotPreferences('{"smash":false}').smash, false);
});

test('Banter cycles without immediate repeats, contains no session claims and does not need member data', () => {
  const messages = Array.from({ length: 16 }, (_, i) => mascotBanter(i));
  assert.equal(new Set(messages.map((m) => m.text)).size, 16);
  assert.deepEqual(
    new Set(messages.map((m) => m.mood)),
    new Set(['cheeky', 'cool', 'dizzy', 'love']),
  );
  assert.ok(
    messages.every(
      (m) =>
        !m.sessionId && !/Đã lưu|đã thanh toán|\d{1,2}:\d{2}/i.test(m.text),
    ),
  );
  assert.deepEqual(mascotBanter(16), messages[0]);
  for (const turn of [NaN, Infinity, -1])
    assert.deepEqual(mascotBanter(turn), messages[0]);
});

test('Playful registration variants keep the saved status, target, date and exact session; reminder wording is stable for fresh copies', () => {
  const going = new Set<string>();
  const declined = new Set<string>();
  for (let id = 1; id <= 20; id++) {
    for (const status of ['going', 'not_going'] as const) {
      const event = registrationMoment(data(), 'a', 'a', ['s'], status, id)!;
      const message = momentMessage(
        event,
        data({ attendance: [row(status)] }),
        'a',
      )!;
      assert.match(
        message.text,
        status === 'going' ? /^Đã lưu đăng ký Đi\./ : /^Đã lưu Không đi\./,
      );
      assert.match(message.detail, /21\/05 · 18:00–20:00 · Sân thật/);
      assert.equal(message.sessionId, 's');
      (status === 'going' ? going : declined).add(message.text);
    }
  }
  assert.equal(going.size, 5);
  assert.equal(declined.size, 4);
  assert.deepEqual(
    mascotReminder(data(), 'a', now),
    mascotReminder(structuredClone(data()), 'a', now),
  );
});
