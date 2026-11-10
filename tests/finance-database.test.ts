import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL finance and travel: exact allocation, immutable settlement, receipts and verified permissions', async (t) => {
  const db = new PGlite();
  const admin = '10000000-0000-4000-8000-000000000001';
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${admin}','admin@test.invalid',now());`);
  for (const name of [
    '202611090001_initial.sql',
    '202611100001_quick_registration.sql',
    '202611100002_booking_responsibility.sql',
    '202611100003_finance_travel.sql',
  ]) {
    const sql = await readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      'utf8',
    );
    await db.exec(sql.split('-- REALTIME:')[0]);
    if (
      name.includes('quick_registration') ||
      name.includes('booking_responsibility')
    )
      await db.exec('commit');
  }
  const members = (
    await db.query<{ id: string; display_name: string }>(
      'select id,display_name from public.members order by id',
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
    await db.exec('reset role');
    await db.exec(
      "select set_config('request.jwt.claim.sub','',false); set role anon;",
    );
  }
  async function call<T = any>(name: string, args: unknown[] = []): Promise<T> {
    return (
      await db.query<{ r: T }>(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`,
        args,
      )
    ).rows[0].r;
  }
  async function snap(token: string | null = null) {
    return call('get_activity_snapshot', [token]);
  }
  async function activity(id: string, token: string | null = null) {
    return (await snap(token)).activities.find((a: any) => a.id === id);
  }
  async function rev() {
    return (await snap()).revision;
  }
  async function verified(name: string) {
    await asAdmin();
    const code = await call('issue_booking_code', [ids[name], false]);
    await asGuest();
    return (await call('activate_booking_identity', [code.code]))
      .token as string;
  }
  const yen = await verified('Yến'),
    other = await verified('Hiền');
  await asAdmin();
  async function session(court: string, start = '18:00', end = '19:30') {
    return call<string>('save_session', [
      null,
      {
        session_date: '2030-05-21',
        start_time: start,
        end_time: end,
        venue: 'Sân thử',
        court,
        organizer_mode: 'override',
        organizer_id: ids.Yến,
        booking_status: 'booked',
        max_players: null,
      },
      null,
    ]);
  }
  const s1 = await session('Ca 1'),
    s2 = await session('Ca 2', '19:30', '21:00');
  const people = members.slice(0, 10);
  for (const p of people)
    await call('set_attendance', [s1, p.id, 'going', null, null]);
  const aid = await call<string>('create_club_activity', [
    'badminton',
    'Buổi 1',
    [{ session_id: s1, label: 'Ca 1', basis: 'single' }],
    {},
    null,
  ]);
  const first = await activity(aid);
  const g1 = first.groups[0].id;
  async function expense(
    a: string,
    name: string,
    amount: number,
    scope = 'all',
    group: string | null = null,
    extra: Record<string, unknown> = {},
  ) {
    return call<string>('save_activity_expense', [
      a,
      null,
      {
        name,
        actual: amount,
        estimated: amount,
        category: 'other',
        scope,
        group_id: group,
        ...extra,
      },
      null,
      '',
      null,
    ]);
  }
  await expense(aid, 'Tiền sân', 250000, 'group', g1, { category: 'court' });
  await expense(aid, 'Tiền cầu', 145000, 'all', null, { category: 'shuttle' });

  await t.test(
    'One group: 250000 + 145000 / 10 = 39500 with server formula',
    async () => {
      const a = await activity(aid);
      assert.equal(a.calculation.total_cost, 395000);
      assert.equal(a.calculation.headcount, 10);
      assert.ok(a.calculation.people.every((p: any) => p.due === 39500));
      assert.equal(a.calculation.warnings.length, 0);
      assert.equal(
        a.calculation.people.reduce((n: number, p: any) => n + p.due, 0),
        395000,
      );
    },
  );
  await t.test(
    'No selected name or forged token grants financial write access; another verified member cannot manage',
    async () => {
      await asGuest();
      for (const token of [null, ids.Yến, other])
        await assert.rejects(
          () =>
            call('save_activity_expense', [
              aid,
              null,
              { name: 'Fake', actual: 1 },
              null,
              '',
              token,
            ]),
          /xác minh|phụ trách/,
        );
      for (const table of [
        'club_activities',
        'activity_ledger',
        'finance_history',
        'trip_participants',
      ])
        await assert.rejects(
          () => db.query(`select * from public.${table}`),
          /permission denied/,
        );
      assert.ok(!(await activity(aid)).calculation);
      await call('save_activity_expense', [
        aid,
        null,
        { name: 'Phí thêm', category: 'other', actual: 0 },
        null,
        '',
        yen,
      ]);
      await asAdmin();
    },
  );
  await t.test(
    'Finalization detects stale revision, freezes costs/roster, and reopens with reason preserving history',
    async () => {
      const stale = await rev();
      await call('set_attendance', [s1, people[0].id, 'not_going', null, null]);
      await assert.rejects(
        () =>
          call('set_activity_fee_state', [aid, 'finalize', stale, '', null]),
        /vừa thay đổi/,
      );
      await call('set_attendance', [s1, people[0].id, 'going', null, null]);
      await call('set_activity_fee_state', [
        aid,
        'finalize',
        await rev(),
        'Đã đối chiếu',
        null,
      ]);
      await call('set_attendance', [s1, people[0].id, 'not_going', null, null]);
      assert.equal((await activity(aid)).calculation.headcount, 10);
      await assert.rejects(() => expense(aid, 'Sai', 1), /đã chốt/);
      await assert.rejects(
        async () =>
          call('set_activity_fee_state', [
            aid,
            'reopen',
            await rev(),
            '',
            null,
          ]),
        /lý do/,
      );
      assert.equal((await activity(aid)).finalizations.length, 1);
    },
  );
  await t.test(
    'Partial, full, overpayment and refund; settle is idempotent even with a new operation id',
    async () => {
      const person = people[0].id;
      const op = randomUUID();
      const lid = await call('record_activity_payment', [
        aid,
        person,
        'collection',
        10000,
        op,
        'Đợt 1',
        null,
      ]);
      assert.equal(
        await call('record_activity_payment', [
          aid,
          person,
          'collection',
          10000,
          op,
          'Đợt 1',
          null,
        ]),
        lid,
      );
      await call('record_activity_payment', [
        aid,
        person,
        'settle',
        null,
        randomUUID(),
        '',
        null,
      ]);
      assert.equal(
        await call('record_activity_payment', [
          aid,
          person,
          'settle',
          null,
          randomUUID(),
          '',
          null,
        ]),
        null,
      );
      let rows = (await activity(aid)).ledger.filter(
        (l: any) => l.person_id === person,
      );
      assert.equal(rows.length, 2);
      assert.equal(
        rows.reduce((n: number, l: any) => n + l.amount, 0),
        39500,
      );
      const extra = await call('record_activity_payment', [
        aid,
        person,
        'supplement',
        5000,
        randomUUID(),
        'Nộp dư',
        null,
      ]);
      await call('record_activity_payment', [
        aid,
        person,
        'refund',
        5000,
        randomUUID(),
        'Hoàn dư',
        null,
      ]);
      await assert.rejects(
        () =>
          call('record_activity_payment', [
            aid,
            person,
            'refund',
            40000,
            randomUUID(),
            '',
            null,
          ]),
        /vượt/,
      );
      await call('void_activity_payment', [extra, 'Nhập sai khoản dư', null]);
      assert.ok(
        (await activity(aid)).ledger.find((l: any) => l.id === extra).voided_at,
      );
      await assert.rejects(
        () =>
          call('record_activity_payment', [
            aid,
            person,
            'collection',
            1.5,
            randomUUID(),
            '',
            null,
          ]),
        /đồng nguyên/,
      );
      await asGuest();
      await assert.rejects(
        () => call('void_activity_payment', [lid, 'Sai', other]),
        /phụ trách/,
      );
      await asAdmin();
    },
  );
  let multi: string;
  await t.test(
    'Two shifts: own court costs, shuttle on shift 1, shared unique people, stable integer remainder',
    async () => {
      const ss1 = await session('Nhóm 1'),
        ss2 = await session('Nhóm 2');
      for (const p of people.slice(0, 3))
        await call('set_attendance', [ss1, p.id, 'going', null, null]);
      for (const p of people.slice(1, 4))
        await call('set_attendance', [ss2, p.id, 'going', null, null]);
      multi = await call('create_club_activity', [
        'badminton',
        'Hai ca',
        [
          { session_id: ss1, label: 'Ca 1', basis: 'shift' },
          { session_id: ss2, label: 'Ca 2', basis: 'shift' },
        ],
        {},
        null,
      ]);
      let a = await activity(multi);
      const [x, y] = a.groups;
      await expense(multi, 'Sân 1', 100, 'group', x.id, { category: 'court' });
      await expense(multi, 'Cầu vào ca 1', 20, 'group', x.id, {
        category: 'shuttle',
      });
      await expense(multi, 'Sân 2', 90, 'group', y.id, { category: 'court' });
      await expense(multi, 'Chung', 13);
      a = await activity(multi);
      assert.equal(a.calculation.headcount, 4);
      assert.equal(a.calculation.total_due, 223);
      assert.equal(a.calculation.surplus, 0);
      const list = a.calculation.people;
      assert.equal(list.find((p: any) => p.id === people[0].id).due, 45);
      assert.equal(list.find((p: any) => p.id === people[1].id).due, 73);
      assert.equal(list.find((p: any) => p.id === people[3].id).due, 33);
      await call('save_activity', [multi, { rounding: 1000 }, a.version, null]);
      a = await activity(multi);
      assert.equal(a.calculation.total_due, 4000);
      assert.equal(a.calculation.surplus, 3777);
    },
  );
  await t.test(
    'Unallocated costs and zero people block finalization, negative inputs fail, billable overrides survive attendance',
    async () => {
      const ss = await session('Không ai');
      const empty = await call('create_club_activity', [
        'badminton',
        'Trống',
        [{ session_id: ss, label: 'Sân 1', basis: 'court' }],
        {},
        null,
      ]);
      const g = (await activity(empty)).groups[0].id;
      await expense(empty, 'Sân', 100, 'group', g, { category: 'court' });
      assert.equal((await activity(empty)).calculation.warnings.length, 2);
      await assert.rejects(
        async () =>
          call('set_activity_fee_state', [
            empty,
            'finalize',
            await rev(),
            '',
            null,
          ]),
        /Chưa đủ/,
      );
      await assert.rejects(() => expense(empty, 'Âm', -1), /check constraint/);
      await call('set_activity_billable', [
        g,
        people[0].id,
        true,
        await rev(),
        null,
      ]);
      assert.equal((await activity(empty)).calculation.total_due, 100);
    },
  );
  let trip: string, participants: any[];
  await t.test(
    'Travel: 8907000 / 12 = 742250; prepaid 555000 leaves 187250; reserve excluded from actual',
    async () => {
      trip = await call('create_club_activity', [
        'trip',
        'Chuyến đi thử',
        [],
        {
          organizer_id: ids.Yến,
          start_date: '2030-06-01',
          end_date: '2030-06-02',
        },
        null,
      ]);
      assert.equal((await activity(trip)).details.start_date, '2030-06-01');
      for (const m of members)
        await call('save_trip_participant', [
          trip,
          null,
          { member_id: m.id, status: 'going' },
          null,
          null,
        ]);
      const guest = await call('save_trip_participant', [
        trip,
        null,
        { guest_name: 'Khách thử', invited_by: ids.Yến, status: 'going' },
        null,
        null,
      ]);
      participants = (await activity(trip)).participants;
      assert.equal(participants.length, 12);
      await expense(trip, 'Chi thực tế', 8907000, 'all', null, {
        estimated: 8000000,
      });
      let a = await activity(trip);
      await call('save_activity', [trip, { reserve: 500000 }, a.version, null]);
      a = await activity(trip);
      assert.equal(a.calculation.total_cost, 8907000);
      assert.ok(a.calculation.people.every((p: any) => p.due === 742250));
      for (const p of participants)
        await call('record_activity_payment', [
          trip,
          p.id,
          'collection',
          555000,
          randomUUID(),
          'Thu trước',
          null,
        ]);
      a = await activity(trip);
      assert.equal(a.calculation.people[0].due - 555000, 187250);
      assert.equal(a.calculation.total_due, 8907000);
      await assert.rejects(
        () =>
          call('save_trip_participant', [
            trip,
            null,
            { guest_name: 'Khách thử', invited_by: ids.Yến },
            null,
            null,
          ]),
        /unique constraint/,
      );
    },
  );
  await t.test(
    'Verified travel member edits only own row/guest, detects stale notes, only admin changes shares',
    async () => {
      let a = await activity(trip);
      await call('save_activity', [trip, { status: 'open' }, a.version, null]);
      const p = participants.find((p) => p.member_id === ids.Yến),
        o = participants.find((p) => p.member_id === ids.Hiền);
      await asGuest();
      await call('save_trip_participant', [
        trip,
        p.id,
        { note: 'Đi cùng gia đình' },
        p.version,
        yen,
      ]);
      await assert.rejects(
        () =>
          call('save_trip_participant', [
            trip,
            p.id,
            { note: 'Bản cũ' },
            p.version,
            yen,
          ]),
        /vừa thay đổi/,
      );
      // Yen is organizer, so use ordinary Hien to attempt another person's row.
      await assert.rejects(
        () =>
          call('save_trip_participant', [
            trip,
            p.id,
            { status: 'not_going' },
            p.version + 1,
            other,
          ]),
        /chỉ được sửa/,
      );
      await assert.rejects(
        () =>
          call('save_trip_participant', [
            trip,
            o.id,
            { share_units: 500, share_reason: 'Trẻ em' },
            o.version,
            other,
          ]),
        /quản trị viên|người phụ trách/,
      );
      await asAdmin();
    },
  );
  await t.test(
    'Weighted guests and selected expenses allocate only intended users; advances are distinct from contributions',
    async () => {
      const p = (await activity(trip)).participants.find(
        (p: any) => !p.member_id,
      );
      await call('save_trip_participant', [
        trip,
        p.id,
        { share_units: 500, share_reason: 'Trẻ em' },
        p.version,
        null,
      ]);
      let a = await activity(trip);
      assert.equal(a.calculation.headcount, 12);
      assert.equal(a.calculation.shares, 11.5);
      assert.equal(a.calculation.total_due, 8907000);
      await expense(trip, 'Vé khách', 10001, 'selected', null, {
        person_ids: [p.id],
        paid_from: 'personal',
        payer_member_id: ids.Yến,
      });
      a = await activity(trip);
      const before = a.ledger
        .filter((l: any) => l.person_id === p.id)
        .reduce((n: number, l: any) => n + l.amount, 0);
      assert.equal(before, 555000);
      await call('record_activity_payment', [
        trip,
        ids.Yến,
        'reimbursement',
        10001,
        randomUUID(),
        'Hoàn ứng vé',
        null,
      ]);
      a = await activity(trip);
      assert.equal(a.calculation.total_cost, 8917001);
      assert.equal(
        a.ledger
          .filter((l: any) => l.person_id === p.id)
          .reduce((n: number, l: any) => n + l.amount, 0),
        555000,
      );
      await assert.rejects(
        () =>
          call('record_activity_payment', [
            trip,
            ids.Yến,
            'reimbursement',
            1,
            randomUUID(),
            '',
            null,
          ]),
        /vượt/,
      );
      const cost = a.calculation.total_cost;
      const item = await call('save_trip_checklist', [
        trip,
        null,
        {
          name: 'Thịt nướng',
          quantity: 2.5,
          unit: 'kg',
          responsible_id: ids.Yến,
        },
        null,
        null,
      ]);
      assert.equal((await activity(trip)).calculation.total_cost, cost);
      await call('save_trip_checklist', [
        trip,
        item,
        { status: 'done' },
        1,
        null,
      ]);
      const h = (await activity(trip)).history;
      assert.ok(h.every((x: any) => x.actor_member_id && x.created_at));
      assert.ok(h.some((x: any) => x.before_data && x.after_data));
    },
  );
  await t.test(
    'Receipt corrections are atomic, require reasons, keep originals and reject replay conflicts',
    async () => {
      const person = participants[0].id;
      const entry = await call('record_activity_payment', [
        trip,
        person,
        'supplement',
        1000,
        randomUUID(),
        'Bản ban đầu',
        null,
      ]);
      const before = (await activity(trip)).ledger.length;
      await assert.rejects(
        () =>
          call('replace_activity_payment', [
            entry,
            -1,
            'Sai tiền',
            'Sửa thử',
            randomUUID(),
            null,
          ]),
        /đồng nguyên/,
      );
      let a = await activity(trip);
      assert.equal(a.ledger.length, before);
      assert.equal(a.ledger.find((l: any) => l.id === entry).voided_at, null);
      const op = randomUUID();
      const replacement = await call('replace_activity_payment', [
        entry,
        2000,
        'Đúng số tiền',
        'Đối chiếu tiền mặt',
        op,
        null,
      ]);
      assert.equal(
        await call('replace_activity_payment', [
          entry,
          2000,
          'Đúng số tiền',
          'Đối chiếu tiền mặt',
          op,
          null,
        ]),
        replacement,
      );
      a = await activity(trip);
      assert.equal(a.ledger.length, before + 1);
      assert.ok(a.ledger.find((l: any) => l.id === entry).voided_at);
      assert.equal(
        a.ledger.find((l: any) => l.id === replacement).amount,
        2000,
      );
      await assert.rejects(
        () =>
          call('replace_activity_payment', [
            entry,
            3000,
            '',
            'Sửa tiếp',
            randomUUID(),
            null,
          ]),
        /thiết bị khác/,
      );
    },
  );
  await t.test(
    'Reopening and finalizing preserves receipts, versions and historical snapshots; every mutation emits a revision',
    async () => {
      const before = await activity(aid),
        count = before.ledger.length;
      let revision = await rev();
      await call('set_activity_fee_state', [
        aid,
        'reopen',
        revision,
        'Đổi người thực tế',
        null,
      ]);
      assert.ok((await rev()) > revision);
      let a = await activity(aid);
      assert.equal(a.calculation.headcount, 9);
      assert.equal(a.ledger.length, count);
      await call('set_activity_fee_state', [
        aid,
        'finalize',
        await rev(),
        'Chốt lại người thực tế',
        null,
      ]);
      a = await activity(aid);
      assert.equal(a.finalizations.length, 2);
      assert.equal(
        a.finalizations.find((f: any) => f.summary.headcount === 10).summary
          .total_due,
        395000,
      );
      assert.equal(a.calculation.headcount, 9);
      assert.equal(a.ledger.length, count);
      revision = await rev();
      const p = (await activity(trip)).participants.find(
        (p: any) => p.member_id === ids.Hiền,
      );
      await asGuest();
      await call('save_trip_participant', [
        trip,
        p.id,
        { note: 'Thiết bị B nhìn thấy ghi chú mới' },
        p.version,
        other,
      ]);
      const receiver = await activity(trip, yen);
      assert.equal(
        receiver.participants.find((x: any) => x.id === p.id).note,
        'Thiết bị B nhìn thấy ghi chú mới',
      );
      assert.ok((await snap(yen)).revision > revision);
      await asAdmin();
      const financial = (await activity(trip)).ledger.length;
      const sql = await readFile(
        new URL(
          '../supabase/migrations/202611100003_finance_travel.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await db.exec('reset role');
      await db.exec(sql);
      await asAdmin();
      assert.equal((await activity(trip)).ledger.length, financial);
      assert.equal((await activity(aid)).finalizations.length, 2);
    },
  );
  await t.test(
    'Trips reject malformed schedules and fees, preserve financial member history, and retain refund lines after reopening',
    async () => {
      let a = await activity(trip);
      await assert.rejects(
        () =>
          call('save_activity', [
            trip,
            { details: { itinerary: 'invalid' } },
            a.version,
            null,
          ]),
        /Lịch trình/,
      );
      await assert.rejects(
        () =>
          call('save_activity', [
            trip,
            { details: { start_date: 'not-a-date' } },
            a.version,
            null,
          ]),
        /date/,
      );
      await assert.rejects(
        () =>
          call('save_activity', [
            trip,
            { details: { budget_per_person: 12.5 } },
            a.version,
            null,
          ]),
        /đồng nguyên/,
      );
      const unpaid = (await activity(aid)).calculation.people.find(
        (p: any) => p.id === people[0].id,
      );
      assert.equal(unpaid.due, 0);
      assert.ok(
        (await activity(aid)).ledger.some(
          (l: any) => l.person_id === unpaid.id,
        ),
      );
      // A financial reference remains protected even when ordinary participation has no history.
      const newMember = await call('save_member', [
        null,
        { display_name: 'Người có ứng phí', note: '' },
        null,
      ]);
      await expense(trip, 'Ứng phí có lịch sử', 10, 'all', null, {
        paid_from: 'personal',
        payer_member_id: newMember,
      });
      await assert.rejects(
        () => call('delete_member', [newMember, 1]),
        /Ngừng hoạt động/,
      );
      const before = await activity(trip);
      await call('save_member', [newMember, { active: false }, 1]);
      assert.equal(
        (await activity(trip)).calculation.total_due,
        before.calculation.total_due,
      );
    },
  );
  await db.close();
});
