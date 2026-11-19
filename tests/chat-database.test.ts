import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { answerLookup } from '../supabase/functions/_shared/chat/lookup';
import {
  contextSources,
  planQuestion,
} from '../supabase/functions/_shared/chat/intent';

test('Chat context uses live scoped PostgreSQL facts, existing permissions, exact fees and durable quotas', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const admin = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  await db.query('insert into auth.users values($1,$2,now())', [
    admin,
    'admin@test.invalid',
  ]);
  for (const name of [
    '202611090001_initial.sql',
    '202611100001_quick_registration.sql',
    '202611100002_booking_responsibility.sql',
    '202611100003_finance_travel.sql',
    '202611100004_auto_fees_and_covers.sql',
    '202611190002_club_chat.sql',
    '202611190002_club_chat.sql',
  ]) {
    const sql = await readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      'utf8',
    );
    await db.exec(sql.split('-- REALTIME:')[0].split('-- STORAGE:')[0]);
    if (
      name.includes('quick_registration') ||
      name.includes('booking_responsibility') ||
      name.includes('auto_fees')
    )
      await db.exec('commit');
  }
  const members = (
    await db.query<{ id: string; display_name: string }>(
      'select id,display_name from public.members',
    )
  ).rows;
  const ids = Object.fromEntries(members.map((m) => [m.display_name, m.id]));
  await db.query("insert into public.account_links values($1,$2,'admin')", [
    admin,
    ids.Dũng,
  ]);
  async function asAdmin() {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await db.exec('set role authenticated');
  }
  async function asGuest() {
    await db.exec(
      "reset role; select set_config('request.jwt.claim.sub','',false); set role anon;",
    );
  }
  async function call(name: string, args: unknown[] = []): Promise<any> {
    return (
      await db.query<{ r: any }>(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`,
        args,
      )
    ).rows[0].r;
  }
  const context = (
    scope: string,
    opts: {
      member?: string | null;
      personal?: boolean;
      token?: string | null;
      activity?: string | null;
      session?: string | null;
      all?: boolean;
    } = {},
  ) =>
    call('get_chat_context', [
      scope,
      '2030-05-20',
      '2030-06-03',
      opts.member ?? null,
      opts.session ?? null,
      opts.activity ?? null,
      opts.personal ?? false,
      opts.all ?? false,
      opts.token ?? null,
    ]);
  function lookup(facts: any, message: string) {
    const q = {
      message,
      history: [],
      memberId: ids.Yến,
      bookingToken: null,
      sessionId: null,
      activityId: null,
    };
    const plan = planQuestion(q, new Date('2030-05-21T04:00:00Z'));
    return answerLookup(q, plan, facts, contextSources(facts, plan));
  }
  await asAdmin();
  const sid = await call('save_session', [
    null,
    {
      session_date: '2030-05-21',
      start_time: '18:00',
      end_time: '20:00',
      venue: 'Sân thử',
      court: 'Ca 1',
      organizer_mode: 'override',
      organizer_id: ids.Yến,
      max_players: 2,
      booking_status: 'booked',
    },
    null,
  ]);
  const cancelled = await call('save_session', [
    null,
    {
      session_date: '2030-05-22',
      start_time: '18:00',
      end_time: '20:00',
      venue: 'Sân hủy',
      court: 'Ca 2',
      booking_status: 'cancelled',
    },
    null,
  ]);
  await call('set_attendance', [sid, ids.Yến, 'going', null, null]);
  await call('set_attendance', [sid, ids.Hiền, 'going', null, null]);
  const snapshot = await call('get_activity_snapshot', [null]);
  const sheet = snapshot.activities.find((a: any) =>
    a.groups?.some((g: any) => g.session_id === sid),
  );
  const aid = sheet.id;
  for (const [name, category, actual] of [
    ['Tiền sân', 'court', 300000],
    ['Tiền cầu', 'shuttle', 60000],
  ])
    await call('save_activity_expense', [
      aid,
      null,
      {
        name,
        category,
        actual,
        estimated: actual,
        scope: category === 'court' ? 'group' : 'all',
        group_id: category === 'court' ? sheet.groups[0].id : null,
      },
      null,
      '',
      null,
    ]);
  const invite = await call('issue_booking_code', [ids.Yến, false]);
  await asGuest();
  const token = (await call('activate_booking_identity', [invite.code])).token;

  await t.test(
    'Fresh queries reflect changes and cancellations without writing registrations',
    async () => {
      const first = await context('schedule');
      assert.equal(
        first.sessions.find((s: any) => s.id === sid).remaining_places,
        0,
      );
      assert.equal(
        first.sessions.find((s: any) => s.id === cancelled).remaining_places,
        null,
      );
      assert.equal(
        first.sessions.find((s: any) => s.id === cancelled).registration_closed,
        true,
      );
      assert.equal(
        first.sessions.find((s: any) => s.id === sid).registered_names.length,
        2,
      );
      const encoded = JSON.stringify(first);
      assert.ok(
        !encoded.includes('admin@test.invalid') &&
          !encoded.includes(token) &&
          !encoded.includes('booking_contact_note'),
      );
      await asAdmin();
      await call('save_session', [
        sid,
        { venue: 'Sân đã đổi', start_time: '19:00' },
        1,
      ]);
      await asGuest();
      const second = await context('schedule');
      assert.equal(
        second.sessions.find((s: any) => s.id === sid).venue,
        'Sân đã đổi',
      );
      assert.equal(
        second.sessions.find((s: any) => s.id === sid).start_time,
        '19:00:00',
      );
      assert.equal(
        second.sessions.find((s: any) => s.id === sid).registered_count,
        2,
      );
      const answer = lookup(second, 'Lịch tuần này?').answer;
      assert.match(answer, /Sân đã đổi/);
      assert.match(answer, /19:00/);
      assert.match(answer, /Sân hủy.*ĐÃ HỦY/);
      assert.equal(
        (
          await call('get_chat_context', [
            'schedule',
            '2020-01-01',
            '2020-01-02',
            null,
            sid,
          ])
        ).sessions[0].id,
        sid,
      );
    },
  );
  await t.test(
    'Selected name is lookup only; private money needs the existing verified identity',
    async () => {
      const denied = await context('finance', {
        member: ids.Yến,
        personal: true,
      });
      assert.equal(denied.finance_authorized, false);
      assert.equal(denied.activities, undefined);
      const missing = await context('finance', { personal: true });
      assert.equal(missing.needs_member, true);
      const fake = await context('finance', {
        member: ids.Yến,
        personal: true,
        token: ids.Yến,
      });
      assert.equal(fake.activities, undefined);
      const draft = await context('finance', {
        member: ids.Yến,
        personal: true,
        token,
      });
      const activity = draft.activities.find((a: any) => a.id === aid);
      assert.equal(activity.fee_status, 'draft');
      assert.equal(activity.total_cost, 360000);
      assert.deepEqual(activity.people, [
        { name: 'Yến', due: 180000, net_paid: 0, balance: 180000 },
      ]);
      assert.equal(activity.expenses.length, 2);
      assert.equal(activity.ledger, undefined);
      const answer = lookup(draft, 'Tôi còn thiếu bao nhiêu?').answer;
      assert.match(answer, /180\.000đ \(TẠM TÍNH, chưa phải nợ đã chốt\)/);
      assert.match(answer, /Chưa có bảng ĐÃ CHỐT phù hợp/);
      const other = await context('finance', {
        member: ids.Hiền,
        personal: true,
        token,
      });
      assert.equal(
        other.activities.find((a: any) => a.id === aid).people[0].name,
        'Hiền',
      );
    },
  );
  await t.test(
    'Finalized amount uses the immutable snapshot; refunds use net recorded receipts',
    async () => {
      await asAdmin();
      await call('set_activity_fee_state', [
        aid,
        'finalize',
        (await call('get_activity_snapshot', [null])).revision,
        'Chốt kiểm thử',
        null,
      ]);
      await call('record_activity_payment', [
        aid,
        ids.Yến,
        'collection',
        100000,
        randomUUID(),
        '',
        null,
      ]);
      await call('set_attendance', [sid, ids.Hiền, 'not_going', null, null]);
      await call('record_activity_payment', [
        aid,
        ids.Yến,
        'refund',
        20000,
        randomUUID(),
        '',
        null,
      ]);
      await asGuest();
      const frozen = (
        await context('finance', { member: ids.Yến, personal: true, token })
      ).activities.find((a: any) => a.id === aid);
      assert.equal(frozen.fee_status, 'finalized');
      assert.equal(frozen.people[0].due, 180000);
      assert.equal(frozen.people[0].net_paid, 80000);
      assert.equal(frozen.people[0].balance, 100000);
      const facts = await context('finance', {
        member: ids.Yến,
        personal: true,
        token,
      });
      const answer = lookup(facts, 'Tôi còn thiếu bao nhiêu?').answer;
      assert.match(answer, /thu ròng đã ghi nhận 80\.000đ/);
      assert.match(answer, /còn thiếu 100\.000đ/);
    },
  );
  await t.test(
    'Missing records stay missing, and query ranges are bounded',
    async () => {
      const empty = await context('finance', { activity: randomUUID(), token });
      assert.equal(empty.total_matches, 0);
      assert.deepEqual(empty.activities, []);
      await assert.rejects(
        call('get_chat_context', ['schedule', '2020-01-01', '2030-01-01']),
        /Khoảng ngày/,
      );
      assert.equal((await context('booking')).assignments.length, 0);
    },
  );
  await t.test(
    'Public travel summaries omit private participants and financial information',
    async () => {
      await asAdmin();
      const trip = await call('create_club_activity', [
        'trip',
        'Chuyến đi thử',
        [],
        {
          start_date: '2030-06-01',
          end_date: '2030-06-02',
          location: 'Đà Lạt',
        },
        null,
      ]);
      await call('save_trip_participant', [
        trip,
        null,
        { member_id: ids.Yến, status: 'going' },
        null,
        null,
      ]);
      await asGuest();
      const publicTrip = (await context('travel')).activities.find(
        (a: any) => a.id === trip,
      );
      assert.equal(publicTrip.location, 'Đà Lạt');
      assert.equal(publicTrip.people, undefined);
      assert.equal(publicTrip.participants, undefined);
      assert.equal(
        (await context('travel', { token })).activities.find(
          (a: any) => a.id === trip,
        ).participants[0].name,
        'Yến',
      );
    },
  );
  await t.test(
    'Request budgets are private, atomic across calls, and enforce client and global limits',
    async () => {
      await assert.rejects(
        call('reserve_chat_request', ['a'.repeat(64)]),
        /permission denied/,
      );
      await db.exec('reset role; set role service_role');
      for (let i = 0; i < 6; i++)
        assert.equal(
          (await call('reserve_chat_request', ['a'.repeat(64)])).allowed,
          true,
        );
      const limited = await call('reserve_chat_request', ['a'.repeat(64)]);
      assert.equal(limited.allowed, false);
      assert.ok(limited.retry_after > 0 && limited.retry_after <= 60);
      for (let i = 0; i < 34; i++)
        assert.equal(
          (
            await call('reserve_chat_request', [
              i.toString(16).padStart(64, '0'),
            ])
          ).allowed,
          true,
        );
      assert.equal(
        (await call('reserve_chat_request', ['b'.repeat(64)])).allowed,
        false,
      );
    },
  );
});
