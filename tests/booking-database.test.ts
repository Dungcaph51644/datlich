import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL: weekly responsibility, verified identities, atomic swaps and fair planning', async (t) => {
  const db = new PGlite();
  const admin = '10000000-0000-4000-8000-000000000001';
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${admin}','admin@test.invalid',now());
  `);
  async function migrate(name: string) {
    await db.exec('reset role');
    const sql = await readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      'utf8',
    );
    await db.exec(sql.split('-- REALTIME:')[0]);
    if (
      sql.trimStart().startsWith('-- Run after') ||
      name.includes('quick_registration')
    )
      await db.exec('commit');
  }
  await migrate('202611090001_initial.sql');
  await migrate('202611100001_quick_registration.sql');
  const members = (
    await db.query<{ id: string; display_name: string }>(
      'select id,display_name from public.members order by code',
    )
  ).rows;
  const ids = Object.fromEntries(members.map((m) => [m.display_name, m.id]));
  await db.query("insert into public.account_links values($1,$2,'admin')", [
    admin,
    ids.Dũng,
  ]);
  const migration = '202611100002_booking_responsibility.sql';
  await migrate(migration);
  async function asAdmin() {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    await db.exec('set role authenticated');
  }
  async function asGuest() {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec('set role anon');
  }
  async function call<T = any>(name: string, args: unknown[] = []): Promise<T> {
    return (
      await db.query<{ result: T }>(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`,
        args,
      )
    ).rows[0].result;
  }
  async function snapshot(token?: string) {
    return call('get_booking_snapshot', [token ?? null]);
  }
  async function issue(name: string) {
    await asAdmin();
    const invite = await call('issue_booking_code', [ids[name], false]);
    await asGuest();
    const identity = await call('activate_booking_identity', [invite.code]);
    return { ...identity, code: invite.code };
  }
  async function assign(week: string, name: string, completed = false) {
    await asAdmin();
    const existing = (await snapshot()).assignments.find(
      (a: any) => a.week_start === week,
    );
    return call<string>('save_booking_assignment', [
      week,
      ids[name],
      existing?.version ?? null,
      'Thiết lập kiểm thử',
      completed,
    ]);
  }
  const a = await issue('Nguyên');
  const b = await issue('Newbie Long');
  const c = await issue('Hiền');
  let wa: string, wb: string, sid: string, override: string;

  await t.test(
    'Seeds the agreed seven weeks once, uses IDs, and excludes newly added members from rotation',
    async () => {
      await asAdmin();
      let s = await snapshot();
      assert.equal(s.assignments.length, 7);
      assert.equal(
        s.assignments.find((x: any) => x.week_start === '2026-11-16').member_id,
        ids.Nguyên,
      );
      assert.equal(
        s.assignments.find((x: any) => x.week_start === '2026-11-23').member_id,
        ids['Newbie Long'],
      );
      assert.equal(s.rotation.length, 11);
      assert.ok(s.rotation.every((x: any) => x.history_status === 'unknown'));
      const unchanged = s.assignments.map((x: any) => [
        x.id,
        x.member_id,
        x.version,
      ]);
      await migrate(migration);
      await asAdmin();
      s = await snapshot();
      assert.deepEqual(
        s.assignments.map((x: any) => [x.id, x.member_id, x.version]),
        unchanged,
      );
      const newcomer = await call<string>('save_member', [
        null,
        { display_name: 'Huệ' },
        null,
      ]);
      assert.ok(
        !(await snapshot()).rotation.some((x: any) => x.member_id === newcomer),
      );
    },
  );
  await t.test(
    'Names/member IDs alone grant no booking rights; one-time codes and private tokens are not exposed',
    async () => {
      await asGuest();
      await assert.rejects(
        call('activate_booking_identity', [a.code]),
        /Mã không hợp lệ/,
      );
      assert.equal((await snapshot(ids.Nguyên)).verified_member_id, null);
      assert.equal((await snapshot(a.token)).verified_member_id, ids.Nguyên);
      for (const table of [
        'booking_swap_requests',
        'booking_notifications',
        'booking_history',
      ])
        await assert.rejects(
          db.query(`select * from public.${table}`),
          /permission denied/,
        );
      await assert.rejects(
        db.query('select * from private.booking_devices'),
        /permission denied/,
      );
      const publicData = JSON.stringify(await snapshot());
      assert.ok(!publicData.includes(a.token));
      assert.ok(!publicData.includes(a.code));
      assert.ok(!publicData.includes('admin@test.invalid'));
      await assert.rejects(
        call('save_booking_assignment', [
          '2099-11-09',
          ids.Nguyên,
          null,
          'Fake admin',
          false,
        ]),
        /permission denied/,
      );
      await assert.rejects(
        db.query('update public.weekly_booking_assignments set member_id=$1', [
          ids.Hiền,
        ]),
        /permission denied/,
      );
    },
  );
  await t.test(
    'Weekly inheritance is separate from overrides, attendance and actual booked-by history',
    async () => {
      wa = await assign('2099-11-09', 'Nguyên');
      wb = await assign('2099-11-16', 'Newbie Long');
      await asAdmin();
      const data = {
        session_date: '2099-11-10',
        start_time: '18:00',
        end_time: '20:00',
        venue: 'Sân kiểm thử',
        court: 'Sân 1',
        organizer_mode: 'weekly',
        booking_status: 'booked',
        booked_by_member_id: ids.Nguyên,
      };
      sid = await call('save_session', [null, data, null]);
      override = await call('save_session', [
        null,
        {
          ...data,
          court: 'Sân 2',
          organizer_mode: 'override',
          organizer_id: ids.Yến,
          booked_by_member_id: ids.Yến,
        },
        null,
      ]);
      await asGuest();
      await call('quick_set_attendance', [
        sid,
        ids.Nguyên,
        'not_going',
        'Giữ ghi chú',
        0,
      ]);
      const session = (await snapshot()).club.sessions.find(
        (x: any) => x.id === sid,
      );
      assert.equal(session.organizer_id, ids.Nguyên);
      assert.equal(session.booked_by_member_id, ids.Nguyên);
      assert.equal(session.booking_status, 'booked');
    },
  );
  await t.test(
    'Copying a week inherits the next owner, retains only explicit overrides and clears booking confirmations',
    async () => {
      await asAdmin();
      assert.equal(await call('copy_week', ['2099-11-09']), 2);
      const s = await snapshot();
      const copied = s.club.sessions.filter(
        (x: any) => x.copied_from === sid || x.copied_from === override,
      );
      assert.equal(
        copied.find((x: any) => x.copied_from === sid).organizer_id,
        ids['Newbie Long'],
      );
      assert.equal(
        copied.find((x: any) => x.copied_from === override).organizer_id,
        ids.Yến,
      );
      assert.ok(
        copied.every(
          (x: any) =>
            x.booking_status === 'pending' && x.booked_by_member_id === null,
        ),
      );
      assert.ok(
        !s.club.attendance.some((x: any) =>
          copied.some((c: any) => c.id === x.session_id),
        ),
      );
    },
  );
  let accepted: string;
  await t.test(
    'Sending a request does not change assignments; overlapping requests and forged confirmations fail',
    async () => {
      await asGuest();
      await assert.rejects(
        call('request_booking_swap', [wa, '', ids.Nguyên]),
        /xác minh/,
      );
      await assert.rejects(
        call('request_booking_swap', [wa, '', c.token]),
        /mình phụ trách/,
      );
      accepted = await call('request_booking_swap', [
        wa,
        'Đã trao đổi trước',
        a.token,
      ]);
      let s = await snapshot(a.token);
      assert.equal(
        s.assignments.find((x: any) => x.id === wa).member_id,
        ids.Nguyên,
      );
      assert.equal(
        s.requests.find((x: any) => x.id === accepted).status,
        'pending',
      );
      assert.ok(
        (await snapshot(b.token)).notifications.some(
          (x: any) => x.request_id === accepted && x.kind === 'pending',
        ),
      );
      await assert.rejects(
        call('request_booking_swap', [wa, 'Yêu cầu trùng', a.token]),
        /đang có yêu cầu/,
      );
      await assert.rejects(
        call('respond_booking_swap', [accepted, 'accept', a.token]),
        /đúng người nhận/,
      );
      await assert.rejects(
        call('respond_booking_swap', [accepted, 'accept', c.token]),
        /đúng người nhận/,
      );
      await assert.rejects(
        call('mark_booking_notifications', [
          [(await snapshot(b.token)).notifications[0].id],
          a.token,
        ]),
        /của mình/,
      );
    },
  );
  await t.test(
    'Recipient acceptance atomically swaps both weeks, refreshes inherited sessions and preserves every registration and booking',
    async () => {
      const before = await snapshot(a.token);
      assert.equal(
        await call('respond_booking_swap', [accepted, 'accept', b.token]),
        'accepted',
      );
      const s = await snapshot(a.token);
      assert.equal(
        s.assignments.find((x: any) => x.id === wa).member_id,
        ids['Newbie Long'],
      );
      assert.equal(
        s.assignments.find((x: any) => x.id === wb).member_id,
        ids.Nguyên,
      );
      assert.equal(
        s.club.sessions.find((x: any) => x.id === sid).organizer_id,
        ids['Newbie Long'],
      );
      assert.equal(
        s.club.sessions.find((x: any) => x.id === override).organizer_id,
        ids.Yến,
      );
      assert.equal(
        s.club.sessions.find((x: any) => x.id === sid).booked_by_member_id,
        ids.Nguyên,
      );
      assert.equal(
        s.club.sessions.find((x: any) => x.id === sid).venue,
        'Sân kiểm thử',
      );
      assert.equal(
        s.club.sessions.find((x: any) => x.id === sid).booking_status,
        'booked',
      );
      assert.deepEqual(s.club.attendance, before.club.attendance);
      assert.ok(s.revision > before.revision);
      const h = s.history.find(
        (x: any) =>
          x.event_type === 'swap_accepted' && x.request_id === accepted,
      );
      assert.equal(h.requested_by_member_id, ids.Nguyên);
      assert.equal(h.confirmed_by_member_id, ids['Newbie Long']);
      assert.equal(h.changes.length, 2);
      assert.ok(h.created_at);
      await assert.rejects(
        call('respond_booking_swap', [accepted, 'accept', b.token]),
        /đã được xử lý/,
      );
    },
  );
  await t.test(
    'Rejecting and cancelling leave both weeks unchanged and release overlapping slots',
    async () => {
      const r = await call('request_booking_swap', [wa, 'Xin đổi', b.token]);
      assert.equal(
        await call('respond_booking_swap', [r, 'reject', a.token]),
        'rejected',
      );
      const cancelled = await call('request_booking_swap', [
        wa,
        'Xin đổi lần khác',
        b.token,
      ]);
      await assert.rejects(
        call('cancel_booking_swap', [cancelled, a.token]),
        /do mình gửi/,
      );
      await call('cancel_booking_swap', [cancelled, b.token]);
      const s = await snapshot(a.token);
      assert.equal(
        s.assignments.find((x: any) => x.id === wa).member_id,
        ids['Newbie Long'],
      );
      assert.equal(
        s.assignments.find((x: any) => x.id === wb).member_id,
        ids.Nguyên,
      );
      assert.equal(
        s.requests.find((x: any) => x.id === cancelled).status,
        'cancelled',
      );
    },
  );
  await t.test(
    'Administrative changes invalidate pending requests, require a reason and never rewrite original assignment',
    async () => {
      const r = await call('request_booking_swap', [wa, 'Xin đổi', b.token]);
      await asAdmin();
      const s = await snapshot();
      const row = s.assignments.find((x: any) => x.id === wa);
      await assert.rejects(
        call('save_booking_assignment', [
          row.week_start,
          ids.Chi,
          row.version,
          '',
          false,
        ]),
        /lý do/,
      );
      await call('save_booking_assignment', [
        row.week_start,
        ids.Chi,
        row.version,
        'Điều phối lại theo trao đổi',
        false,
      ]);
      await asGuest();
      const changed = await snapshot(a.token);
      assert.equal(
        changed.requests.find((x: any) => x.id === r).status,
        'invalid',
      );
      assert.equal(
        changed.assignments.find((x: any) => x.id === wa).original_member_id,
        ids.Nguyên,
      );
      await assert.rejects(
        call('respond_booking_swap', [r, 'accept', a.token]),
        /đã được xử lý/,
      );
      assert.equal(
        changed.club.sessions.find((x: any) => x.id === sid)
          .booked_by_member_id,
        ids.Nguyên,
      );
    },
  );
  await t.test(
    'A failure on the second week rolls back the first week, accepted status, history and notifications',
    async () => {
      await assign('2099-11-09', 'Nguyên');
      await assign('2099-11-16', 'Newbie Long');
      await asGuest();
      const r = await call('request_booking_swap', [
        wa,
        'Kiểm tra giao dịch',
        a.token,
      ]);
      const before = await snapshot(a.token);
      await db.exec('reset role');
      await db.exec(
        `create function private.test_reject_second_week() returns trigger language plpgsql as $$ begin if new.week_start='2099-11-16' then raise exception 'forced second-week failure'; end if; return new; end $$; create trigger test_atomic before update on public.weekly_booking_assignments for each row execute function private.test_reject_second_week();`,
      );
      await asGuest();
      await assert.rejects(
        call('respond_booking_swap', [r, 'accept', b.token]),
        /forced second-week failure/,
      );
      const after = await snapshot(a.token);
      assert.deepEqual(after.assignments, before.assignments);
      assert.deepEqual(after.history, before.history);
      assert.deepEqual(after.notifications, before.notifications);
      assert.equal(
        after.requests.find((x: any) => x.id === r).status,
        'pending',
      );
      await db.exec('reset role');
      await db.exec(
        'drop trigger test_atomic on public.weekly_booking_assignments; drop function private.test_reject_second_week()',
      );
      await asGuest();
      await call('cancel_booking_swap', [r, a.token]);
    },
  );
  await t.test(
    'Verified responsibility permits field patches, rejects impersonation and preserves attendance and actual booker',
    async () => {
      await asGuest();
      let session = (await snapshot()).club.sessions.find(
        (x: any) => x.id === sid,
      );
      await assert.rejects(
        call('update_booking_session', [
          sid,
          { venue: 'Mạo danh' },
          session.version,
          c.token,
        ]),
        /mình phụ trách/,
      );
      await assert.rejects(
        call('update_booking_session', [
          sid,
          { organizer_id: ids.Hiền },
          session.version,
          a.token,
        ]),
        /thay phân công/,
      );
      await call('update_booking_session', [
        sid,
        {
          estimated_cost: 250000,
          booking_contact_note: 'Đã gọi chủ sân',
          deposit_note: 'Cọc 100k',
        },
        session.version,
        a.token,
      ]);
      const s = await snapshot(a.token);
      session = s.club.sessions.find((x: any) => x.id === sid);
      assert.equal(session.estimated_cost, 250000);
      assert.equal(session.booking_contact_note, 'Đã gọi chủ sân');
      assert.equal(session.booked_by_member_id, ids.Nguyên);
      assert.equal(
        s.club.attendance.find(
          (x: any) => x.session_id === sid && x.member_id === ids.Nguyên,
        ).note,
        'Giữ ghi chú',
      );
      await assert.rejects(
        call('update_booking_session', [
          sid,
          { venue: 'Ghi đè' },
          session.version - 1,
          a.token,
        ]),
        /thiết bị khác/,
      );
    },
  );
  await t.test(
    'Past weeks cannot swap; completing a week with two courts counts once and baseline overlap is not counted twice',
    async () => {
      const past = await assign('2020-01-06', 'Hiền');
      await assign('2020-01-13', 'Newbie Long');
      await asGuest();
      await assert.rejects(
        call('request_booking_swap', [past, '', c.token]),
        /đã kết thúc/,
      );
      const row = (await snapshot(c.token)).assignments.find(
        (x: any) => x.id === past,
      );
      await call('complete_booking_week', [past, row.version, c.token]);
      const complete = (await snapshot(c.token)).assignments.find(
        (x: any) => x.id === past,
      );
      await assert.rejects(
        call('complete_booking_week', [past, complete.version, c.token]),
        /một lượt/,
      );
      await asAdmin();
      for (const rotation of (await snapshot()).rotation)
        await call('save_booking_rotation', [
          rotation.member_id,
          {
            history_status: 'confirmed',
            initial_completed_count: 0,
            baseline_through: '2019-12-29',
          },
          rotation.version,
        ]);
      let s = await snapshot();
      assert.equal(
        s.rotation.find((x: any) => x.member_id === ids.Hiền).completed_count,
        1,
      );
      let rr = s.rotation.find((x: any) => x.member_id === ids.Hiền);
      await call('save_booking_rotation', [
        ids.Hiền,
        {
          initial_completed_count: 3,
          baseline_through: '2026-11-08',
          initial_last_week: '2020-01-06',
        },
        rr.version,
      ]);
      s = await snapshot();
      assert.equal(
        s.rotation.find((x: any) => x.member_id === ids.Hiền).completed_count,
        3,
      );
      assert.equal(
        s.assignments.find((x: any) => x.id === past).completed_member_id,
        ids.Hiền,
      );
    },
  );
  await t.test(
    'Fair proposals are deterministic, include future assignments, avoid consecutive names, and require reviewed atomic application',
    async () => {
      await asAdmin();
      const first = await call('propose_booking_assignments', [
        '2099-12-07',
        8,
      ]);
      const second = await call('propose_booking_assignments', [
        '2099-12-07',
        8,
      ]);
      assert.deepEqual(first, second);
      assert.equal(first.rows[0].member_id, ids.Dũng);
      for (let i = 1; i < first.rows.length; i++)
        assert.notEqual(first.rows[i].member_id, first.rows[i - 1].member_id);
      assert.ok(first.rows.every((x: any) => x.reason.length > 20));
      assert.equal(
        (await snapshot()).assignments.some(
          (x: any) => x.week_start === '2099-12-07',
        ),
        false,
      );
      assert.equal(
        await call('apply_booking_proposal', [
          first.rows,
          first.revision,
          'Đã xem và duyệt',
        ]),
        8,
      );
      await assert.rejects(
        call('apply_booking_proposal', [first.rows, first.revision, 'Lặp lại']),
        /đã thay đổi/,
      );
      const existing = await call('propose_booking_assignments', [
        '2099-12-07',
        2,
      ]);
      assert.ok(existing.rows.every((x: any) => x.existing));
      const r = (await snapshot()).rotation[0];
      await call('save_booking_rotation', [
        r.member_id,
        {
          history_status: 'unknown',
          initial_completed_count: 0,
          initial_last_week: null,
        },
        r.version,
      ]);
      await assert.rejects(
        call('propose_booking_assignments', ['2100-03-01', 3]),
        /Chưa có lịch sử ghi nhận/,
      );
    },
  );
  await t.test(
    'Administrative direct swap requires both current versions and records a two-week reasoned change',
    async () => {
      await asAdmin();
      const before = await snapshot();
      const aa = before.assignments.find((x: any) => x.id === wa),
        bb = before.assignments.find((x: any) => x.id === wb);
      await assert.rejects(
        call('admin_swap_booking_weeks', [
          wa,
          'Điều phối ngoại lệ',
          aa.version - 1,
          bb.version,
        ]),
        /đã thay đổi/,
      );
      await assert.rejects(
        call('admin_swap_booking_weeks', [wa, '', aa.version, bb.version]),
        /lý do/,
      );
      await call('admin_swap_booking_weeks', [
        wa,
        'Hai người đã trao đổi, quản trị xác nhận',
        aa.version,
        bb.version,
      ]);
      const after = await snapshot();
      assert.equal(
        after.assignments.find((x: any) => x.id === wa).member_id,
        bb.member_id,
      );
      assert.equal(
        after.assignments.find((x: any) => x.id === wb).member_id,
        aa.member_id,
      );
      assert.equal(
        after.club.sessions.find((x: any) => x.id === sid).booked_by_member_id,
        ids.Nguyên,
      );
      assert.ok(
        after.history.some(
          (h: any) =>
            h.event_type === 'admin_swap' &&
            h.changes.length === 2 &&
            h.reason === 'Hai người đã trao đổi, quản trị xác nhận',
        ),
      );
    },
  );
  await t.test(
    'Missing and duplicate seed names are reported without creating identities or overwriting assignments',
    async () => {
      await db.exec('reset role');
      await db.exec(
        'update public.booking_sync set initialized=false where id=1',
      );
      await asAdmin();
      await call('save_member', [null, { display_name: 'Yến' }, null]);
      const original = (await snapshot()).club.members.find(
        (m: any) => m.id === ids.Dũng,
      );
      await call('save_member', [
        ids.Dũng,
        { display_name: 'Dũng đã đổi tên' },
        original.version,
      ]);
      const before = await snapshot();
      const result = await call('initialize_booking_schedule', [{}]);
      assert.equal(result.initialized, false);
      assert.ok(
        result.issues.some(
          (i: any) => i.name === 'Dũng' && i.kind === 'missing',
        ),
      );
      assert.ok(
        result.issues.some(
          (i: any) => i.name === 'Yến' && i.kind === 'ambiguous',
        ),
      );
      assert.deepEqual((await snapshot()).assignments, before.assignments);
      assert.equal(
        (await snapshot()).club.members.length,
        before.club.members.length,
      );
      assert.equal(
        (
          await call('initialize_booking_schedule', [
            { Dũng: ids.Dũng, Yến: ids.Yến },
          ])
        ).initialized,
        true,
      );
      assert.deepEqual((await snapshot()).assignments, before.assignments);
    },
  );
  await t.test(
    'Deactivation retains assignment history, revokes verified devices and does not automatically reshuffle closed schedules',
    async () => {
      await asAdmin();
      const before = (await snapshot()).assignments;
      const member = (await snapshot()).club.members.find(
        (x: any) => x.id === ids.Nguyên,
      );
      await assert.rejects(
        call('delete_member', [member.id, member.version]),
        /Ngừng hoạt động/,
      );
      await call('save_member', [member.id, { active: false }, member.version]);
      await asGuest();
      const s = await snapshot(a.token);
      assert.equal(s.verified_member_id, null);
      assert.equal(s.identity_expired, true);
      assert.deepEqual(s.assignments, before);
    },
  );
  await db.close();
});
