import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Automatic fee sheets: atomic schedule creation, pristine grouping, audit and permissions', async (t) => {
  const db = new PGlite();
  const admin = '10000000-0000-4000-8000-000000000001';
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${admin}','admin@test.invalid',now());`);
  async function migrate(name: string) {
    await db.exec('reset role');
    const sql = await readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      'utf8',
    );
    await db.exec(sql.split('-- REALTIME:')[0].split('-- STORAGE:')[0]);
    if (
      name.includes('quick_registration') ||
      name.includes('booking_responsibility') ||
      sql.includes('-- STORAGE:')
    )
      await db.exec('commit');
  }
  for (const name of [
    '202611090001_initial.sql',
    '202611100001_quick_registration.sql',
    '202611100002_booking_responsibility.sql',
    '202611100003_finance_travel.sql',
  ])
    await migrate(name);
  const ids = Object.fromEntries(
    (
      await db.query<{ id: string; display_name: string }>(
        'select id,display_name from public.members',
      )
    ).rows.map((m) => [m.display_name, m.id]),
  );
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
  async function ownerQuery<T = any>(sql: string, args: unknown[] = []) {
    await db.exec('reset role');
    try {
      return (await db.query<T>(sql, args)).rows;
    } finally {
      await asAdmin();
    }
  }
  async function session(
    court: string,
    date = '2030-05-21',
    extra: Record<string, unknown> = {},
  ) {
    return call<string>('save_session', [
      null,
      {
        session_date: date,
        start_time: '18:00',
        end_time: '19:30',
        venue: 'Sân thử',
        court,
        organizer_mode: 'override',
        organizer_id: ids.Yến,
        booking_status: 'pending',
        estimated_cost: 250000,
        ...extra,
      },
      null,
    ]);
  }
  async function snap(token: string | null = null) {
    return call('get_activity_snapshot', [token]);
  }
  async function sheet(sid: string, token: string | null = null) {
    return (await snap(token)).activities.find((a: any) =>
      a.groups?.some((g: any) => g.session_id === sid),
    );
  }
  async function combine(sids: string[], token: string | null = null) {
    return call<string>('create_club_activity', [
      'badminton',
      'Hai ca chung một buổi',
      sids.map((session_id, i) => ({
        session_id,
        label: `Ca ${i + 1}`,
        basis: sids.length === 1 ? 'single' : 'shift',
      })),
      {},
      token,
    ]);
  }
  async function expense(
    aid: string,
    amount = 100,
    token: string | null = null,
  ) {
    const a = (await snap(token)).activities.find((x: any) => x.id === aid);
    return call<string>('save_activity_expense', [
      aid,
      null,
      {
        name: 'Tiền sân',
        category: 'court',
        actual: amount,
        scope: 'group',
        group_id: a.groups?.[0]?.id,
      },
      null,
      '',
      token,
    ]);
  }
  await asAdmin();
  const legacyEmpty = await session('Lịch cũ chưa có bảng phí');
  const legacyLinked = await session('Lịch cũ đã có bảng phí');
  const legacyFee = await combine([legacyLinked]);
  const migration = '202611100004_auto_fees_and_covers.sql';
  await migrate(migration);
  await asAdmin();
  const yenCode = await call('issue_booking_code', [ids.Yến, false]);
  const hienCode = await call('issue_booking_code', [ids.Hiền, false]);
  await asGuest();
  const yen = (await call('activate_booking_identity', [yenCode.code])).token;
  const hien = (await call('activate_booking_identity', [hienCode.code])).token;
  await asAdmin();

  await t.test(
    'Migration leaves old schedules and existing financial data untouched and is rerunnable',
    async () => {
      const before = await snap();
      assert.equal(before.automatic_fees, true);
      assert.equal(before.club.version, 3);
      assert.equal(before.activities.length, 1);
      assert.equal((await sheet(legacyLinked)).id, legacyFee);
      assert.equal((await sheet(legacyLinked)).auto_created, false);
      assert.equal(await sheet(legacyEmpty), undefined);
      await migrate(migration);
      await asAdmin();
      assert.deepEqual((await snap()).activities, before.activities);
    },
  );

  let firstId: string;
  await t.test(
    'Creating one schedule atomically adds one empty draft, verified audit and realtime revision',
    async () => {
      const before = await snap();
      firstId = await session('Sân tự tạo');
      const s = await snap(),
        a = await sheet(firstId);
      assert.ok(s.revision > before.revision);
      assert.equal(s.activities.length, before.activities.length + 1);
      assert.equal(a.auto_created, true);
      assert.equal(a.can_regroup, true);
      assert.equal(a.organizer_id, null);
      assert.equal(a.fee_status, 'draft');
      assert.equal(a.groups.length, 1);
      assert.equal(a.groups[0].basis, 'single');
      assert.equal(a.expenses.length, 0);
      assert.equal(a.ledger.length, 0);
      assert.equal(a.calculation.total_cost, 0);
      assert.equal(a.history[0].actor_member_id, ids.Dũng);
      const scheduled = s.club.sessions.find((x: any) => x.id === firstId);
      await call('save_session', [
        firstId,
        { note: 'Chỉnh lịch' },
        scheduled.version,
      ]);
      assert.equal((await sheet(firstId)).id, a.id);
      assert.equal((await snap()).activities.length, s.activities.length);
    },
  );

  await t.test(
    'Two automatic singles combine explicitly, preserving group IDs, source history and immutable archives',
    async () => {
      const second = await session('Ca 2');
      const a = await sheet(firstId),
        b = await sheet(second);
      const combined = await combine([firstId, second]);
      const s = await snap(),
        current = await sheet(firstId);
      assert.equal(current.id, combined);
      assert.equal(current.groups.length, 2);
      assert.deepEqual(
        new Set(current.groups.map((g: any) => g.id)),
        new Set([a.groups[0].id, b.groups[0].id]),
      );
      assert.ok(current.groups.every((g: any) => g.basis === 'shift'));
      assert.equal(current.auto_created, false);
      assert.equal(current.can_regroup, false);
      assert.ok(!s.activities.some((x: any) => x.id === a.id || x.id === b.id));
      const archived = await ownerQuery(
        'select id,merged_into_id from public.club_activities where id=any($1::uuid[])',
        [[a.id, b.id]],
      );
      assert.ok(archived.every((x: any) => x.merged_into_id === combined));
      assert.ok(
        current.history.some(
          (h: any) => h.activity_id === a.id && h.action === 'INSERT',
        ),
      );
      assert.ok(
        current.history.some(
          (h: any) =>
            h.table_name === 'activity_groups' &&
            h.before_data.activity_id === b.id &&
            h.after_data.activity_id === combined,
        ),
      );
      await assert.rejects(
        () => call('save_activity', [a.id, { title: 'Sai bảng' }, 2, null]),
        /đã được ghép/,
      );
      await assert.rejects(() => combine([firstId]), /Chỉ ghép/);
    },
  );

  await t.test(
    'Grouping rejects edited, billable-overridden and even voided-expense sheets before changing any source',
    async () => {
      const dirty = await session('Có chi phí'),
        clean = await session('Chưa có chi phí');
      const a = await sheet(dirty),
        b = await sheet(clean);
      const e = await expense(a.id);
      await call('save_activity_expense', [
        a.id,
        e,
        { void: true },
        1,
        'Hủy kiểm thử',
        null,
      ]);
      assert.equal((await sheet(dirty)).can_regroup, false);
      await assert.rejects(() => combine([clean, dirty]), /Chỉ ghép/);
      assert.equal((await sheet(clean)).id, b.id);
      assert.equal((await sheet(clean)).can_regroup, true);
      const edited = await session('Đổi tên bảng'),
        editedFee = await sheet(edited);
      await call('save_activity', [
        editedFee.id,
        { title: 'Tên riêng' },
        1,
        null,
      ]);
      await assert.rejects(() => combine([edited]), /Chỉ ghép/);
      const overridden = await session('Xác nhận người chịu phí'),
        c = await sheet(overridden);
      await call('set_activity_billable', [
        c.groups[0].id,
        ids.Dũng,
        true,
        (await snap()).revision,
        null,
      ]);
      assert.equal((await sheet(overridden)).can_regroup, false);
      await assert.rejects(() => combine([overridden]), /Chỉ ghép/);
      await assert.rejects(() => combine([clean, clean]), /một lần/);
    },
  );

  await t.test(
    'Existing manual and unlinked historical schedules remain usable with original explicit grouping',
    async () => {
      await assert.rejects(() => combine([legacyLinked]), /Chỉ ghép/);
      const fresh = await session('Ghép cùng lịch cũ');
      const aid = await combine([legacyEmpty, fresh]);
      assert.equal((await sheet(legacyEmpty)).id, aid);
      assert.equal((await sheet(legacyEmpty)).groups.length, 2);
      assert.equal((await sheet(legacyLinked)).id, legacyFee);
    },
  );

  await t.test(
    'Permissions derive from verified live organizer, never selected names; reassignment transfers inherited rights',
    async () => {
      const sid = await session('Quyền phụ trách'),
        a = await sheet(sid);
      await asGuest();
      for (const token of [null, ids.Yến, hien])
        await assert.rejects(
          () => expense(a.id, 1, token),
          /xác minh|phụ trách/,
        );
      assert.equal((await sheet(sid, yen)).can_manage, true);
      assert.equal((await sheet(sid, hien)).can_manage, false);
      await assert.rejects(
        () => call('save_session', [null, {}, null]),
        /permission denied|quản trị/,
      );
      await assert.rejects(
        () =>
          db.query(
            "insert into public.club_activities(kind,title) values('badminton','Giả')",
          ),
        /permission denied/,
      );
      await asAdmin();
      const scheduled = (await snap()).club.sessions.find(
        (s: any) => s.id === sid,
      );
      await call('save_session', [
        sid,
        { organizer_id: ids.Hiền, organizer_mode: 'override' },
        scheduled.version,
      ]);
      await asGuest();
      assert.equal((await sheet(sid, yen)).can_manage, false);
      assert.equal((await sheet(sid, hien)).can_manage, true);
      await expense(a.id, 1, hien);
      await asAdmin();
    },
  );

  await t.test(
    'Finalized fees and receipts survive schedule edits; copying starts a fresh empty draft exactly once',
    async () => {
      const sid = await session('Tuần sao chép', '2030-06-03'),
        a = await sheet(sid);
      await call('set_attendance', [sid, ids.Yến, 'going', null, null]);
      await expense(a.id, 250000);
      await call('set_activity_fee_state', [
        a.id,
        'finalize',
        (await snap()).revision,
        'Đối chiếu',
        null,
      ]);
      await call('record_activity_payment', [
        a.id,
        ids.Yến,
        'collection',
        250000,
        '30000000-0000-4000-8000-000000000001',
        '',
        null,
      ]);
      const frozen = await sheet(sid);
      const scheduled = (await snap()).club.sessions.find(
        (s: any) => s.id === sid,
      );
      await call('save_session', [
        sid,
        { estimated_cost: 999000, note: 'Đổi thông tin sân' },
        scheduled.version,
      ]);
      await call('set_attendance', [sid, ids.Yến, 'not_going', null, null]);
      assert.deepEqual((await sheet(sid)).calculation, frozen.calculation);
      assert.deepEqual((await sheet(sid)).ledger, frozen.ledger);
      assert.equal(await call('copy_week', ['2030-06-03']), 1);
      const s = await snap(),
        copied = s.club.sessions.find((x: any) => x.copied_from === sid);
      const newFee = await sheet(copied.id);
      assert.notEqual(newFee.id, a.id);
      assert.equal(newFee.fee_status, 'draft');
      assert.equal(newFee.auto_created, true);
      assert.equal(newFee.can_regroup, true);
      assert.equal(newFee.expenses.length, 0);
      assert.equal(newFee.ledger.length, 0);
      assert.equal(newFee.calculation.headcount, 0);
      assert.equal(newFee.history[0].actor_member_id, ids.Dũng);
      assert.equal(await call('copy_week', ['2030-06-03']), 0);
      assert.equal((await snap()).activities.length, s.activities.length);
      await assert.rejects(() => combine([sid]), /Chỉ ghép/);
    },
  );

  await t.test(
    'Failure while creating a fee group rolls back the new session and sheet together',
    async () => {
      const before = await snap();
      await db.exec('reset role');
      await db.exec(`create function private.fail_auto_group_test() returns trigger language plpgsql as $$begin if new.label like 'Rollback test%' then raise exception 'forced group failure'; end if; return new; end$$;
      create trigger fail_auto_group_test before insert on public.activity_groups for each row execute function private.fail_auto_group_test();`);
      await asAdmin();
      await assert.rejects(
        () => session('Rollback test'),
        /forced group failure/,
      );
      const after = await snap();
      assert.equal(after.activities.length, before.activities.length);
      assert.equal(after.club.sessions.length, before.club.sessions.length);
      assert.equal(after.revision, before.revision);
    },
  );

  await db.close();
});
