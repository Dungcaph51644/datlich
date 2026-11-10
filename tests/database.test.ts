import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Actual PostgreSQL (PGlite/WASM), not mocked RPC responses. Supabase Auth's
// auth.uid() is represented by the same JWT session claim for policy tests.
test('PostgreSQL: permissions, history, capacity, conflicts, copy and public data', async (t) => {
  const db = new PGlite();
  const admin = '00000000-0000-4000-8000-000000000001';
  const userA = '00000000-0000-4000-8000-000000000002';
  const userB = '00000000-0000-4000-8000-000000000003';
  const outsider = '00000000-0000-4000-8000-000000000004';
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users values
      ('${admin}','admin@test.invalid',now()),('${userA}','a@test.invalid',now()),
      ('${userB}','b@test.invalid',now()),('${outsider}','unlinked@test.invalid',now());
  `);
  const migration = (
    await readFile(
      new URL(
        '../supabase/migrations/202611090001_initial.sql',
        import.meta.url,
      ),
      'utf8',
    )
  ).split('-- REALTIME:')[0];
  await db.exec(migration);
  const members = (
    await db.query<{ id: string; code: string }>(
      'select id,code from public.members order by code',
    )
  ).rows;
  assert.equal(members.length, 11);
  assert.equal(new Set(members.map((m) => m.code)).size, 11);
  const [mAdmin, mA, mB] = members.map((m) => m.id);
  await db.query("insert into public.account_links values ($1,$2,'admin')", [
    admin,
    mAdmin,
  ]);
  async function as(uid: string | null) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid ?? '',
    ]);
    await db.exec(uid ? 'set role authenticated' : 'set role anon');
  }
  async function call<T = unknown>(name: string, args: unknown[]) {
    const params = args.map((_, i) => `$${i + 1}`).join(',');
    return (
      await db.query<{ result: T }>(
        `select public.${name}(${params}) as result`,
        args,
      )
    ).rows[0].result;
  }
  const patch = {
    session_date: '2099-11-09',
    start_time: '18:00',
    end_time: '20:00',
    venue: 'Sân kiểm thử',
    court: 'Sân 1',
    address: 'Địa chỉ kiểm thử',
    maps_url: 'https://maps.app.goo.gl/test',
    organizer_id: mAdmin,
    booking_status: 'booked',
    max_players: 1,
    note: 'Mang vợt',
    deadline: '2099-11-09T10:00:00Z',
  };
  let session: string;
  await t.test(
    'Guest and unlinked user cannot mutate; private tables cannot be read publicly',
    async () => {
      await as(null);
      await assert.rejects(
        call('save_member', [null, { display_name: 'Không hợp lệ' }, null]),
        /permission denied/,
      );
      await assert.rejects(
        db.query('select * from public.members'),
        /permission denied/,
      );
      await assert.rejects(
        db.query('select * from public.attendance'),
        /permission denied/,
      );
      await as(outsider);
      await assert.rejects(
        call('save_member', [null, { display_name: 'Không hợp lệ' }, null]),
        /quyền quản trị/,
      );
      assert.equal(
        (await db.query('select * from public.members')).rows.length,
        0,
      );
      await assert.rejects(
        db.query("insert into public.members(display_name) values('Bypass')"),
        /permission denied/,
      );
    },
  );
  await t.test(
    'Admin links verified emails to unique members and creates a court/shift',
    async () => {
      await as(admin);
      await call('link_account', ['a@test.invalid', mA]);
      await call('link_account', ['b@test.invalid', mB]);
      await assert.rejects(
        call('link_account', ['a@test.invalid', mB]),
        /unique constraint/,
      );
      session = await call<string>('save_session', [null, patch, null]);
      assert.ok(session);
      await assert.rejects(
        call('save_session', [session, { id: userA }, 1]),
        /không hợp lệ/,
      );
    },
  );
  await t.test(
    'Member edits only their own registration; field patches retain other fields',
    async () => {
      await as(userA);
      await call('set_attendance', [session, mA, 'going', null, null]);
      await call('set_attendance', [session, mA, null, 'Đến muộn 15 phút', 0]);
      await assert.rejects(
        call('set_attendance', [session, mB, 'going', null, null]),
        /chính mình/,
      );
      await assert.rejects(
        db.query("update public.attendance set note='Bypass'"),
        /permission denied/,
      );
      await assert.rejects(
        call('save_session', [session, { venue: 'Bypass' }, 1]),
        /quyền quản trị/,
      );
      await assert.rejects(
        call('link_account', ['unlinked@test.invalid', members[3].id]),
        /quyền quản trị/,
      );
      await call('set_attendance', [session, mA, 'unanswered', null, null]);
      let row = (
        await db.query<{ status: string; note: string; note_version: number }>(
          'select * from public.attendance where session_id=$1 and member_id=$2',
          [session, mA],
        )
      ).rows[0];
      assert.equal(row.note, 'Đến muộn 15 phút');
      assert.equal(row.note_version, 1);
      await call('set_attendance', [session, mA, 'going', null, null]);
      await assert.rejects(
        call('set_attendance', [session, mA, null, 'Ghi đè mất dữ liệu', 0]),
        /thiết bị khác/,
      );
      row = (
        await db.query<typeof row>(
          'select * from public.attendance where session_id=$1 and member_id=$2',
          [session, mA],
        )
      ).rows[0];
      assert.equal(row.note, 'Đến muộn 15 phút');
      assert.equal(row.status, 'going');
      assert.equal(
        (
          await db.query(
            'select * from public.attendance where session_id=$1 and member_id=$2',
            [session, mA],
          )
        ).rows.length,
        1,
      );
    },
  );
  await t.test(
    'Capacity enforced on server; updates from another identity see same persisted data',
    async () => {
      await as(userB);
      await assert.rejects(
        call('set_attendance', [session, mB, 'going', null, null]),
        /đủ người/,
      );
      const row = (
        await db.query<{ status: string; note: string }>(
          'select * from public.attendance where session_id=$1 and member_id=$2',
          [session, mA],
        )
      ).rows[0];
      assert.equal(row.status, 'going');
      assert.equal(row.note, 'Đến muộn 15 phút');
      await call('set_attendance', [session, mB, 'not_going', 'Bận', 0]);
      await as(admin);
      await assert.rejects(
        call('save_session', [session, { max_players: 0 }, 1]),
        /Giới hạn mới/,
      );
      await call('set_attendance', [session, mB, 'unanswered', null, null]);
      await as(null);
      const publicRows = await call<Record<string, unknown>[]>(
        'get_public_schedule',
        [],
      );
      assert.equal(publicRows[0].going_count, 1);
      assert.equal(publicRows[0].organizer_name, 'Dũng');
      assert.ok(!JSON.stringify(publicRows).includes('test.invalid'));
      assert.ok(!JSON.stringify(publicRows).includes('Đến muộn'));
    },
  );
  await t.test(
    'Copy week resets booking and creates no attendance; repeated copy is idempotent',
    async () => {
      await as(admin);
      // 2099-11-09 is Monday.
      assert.equal(await call('copy_week', ['2099-11-09']), 1);
      assert.equal(await call('copy_week', ['2099-11-09']), 0);
      const copied = (
        await db.query<{
          id: string;
          booking_status: string;
          going_count: number;
          session_date: string;
        }>('select * from public.sessions where copied_from=$1', [session])
      ).rows[0];
      assert.equal(copied.booking_status, 'pending');
      assert.equal(copied.going_count, 0);
      assert.equal(
        (
          await db.query(
            'select * from public.attendance where session_id=$1',
            [copied.id],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (await db.query('select * from public.members where active')).rows
          .length,
        11,
      );
    },
  );
  await t.test(
    'Edits detect stale version; cancellation and deadlines block registration',
    async () => {
      await as(admin);
      await call('save_session', [session, { booking_status: 'cancelled' }, 1]);
      await assert.rejects(
        call('save_session', [session, { note: 'Stale' }, 1]),
        /thiết bị khác/,
      );
      await as(userA);
      await assert.rejects(
        call('set_attendance', [session, mA, 'not_going', null, null]),
        /đã hủy/,
      );
      await as(admin);
      const expired = await call<string>('save_session', [
        null,
        { ...patch, deadline: '2020-01-01T00:00:00Z' },
        null,
      ]);
      await as(userB);
      await assert.rejects(
        call('set_attendance', [expired, mB, 'going', null, null]),
        /hết hạn/,
      );
      await as(admin);
      await call('set_attendance', [expired, mB, 'going', null, null]);
    },
  );
  await t.test(
    'History survives rename/deactivation; deletion only for members without history',
    async () => {
      await as(admin);
      await call('save_member', [
        mA,
        { display_name: 'Trường mới', active: false },
        1,
      ]);
      await assert.rejects(
        call('save_member', [mA, { note: 'Stale' }, 1]),
        /đã thay đổi/,
      );
      await assert.rejects(call('delete_member', [mA, 2]), /lịch sử/);
      await assert.rejects(
        call('save_member', [mAdmin, { active: false }, 1]),
        /chính bạn/,
      );
      const temp = await call<string>('save_member', [
        null,
        { display_name: 'Dũng' },
        null,
      ]);
      await call('delete_member', [temp, 1]);
      assert.equal(
        (
          await db.query('select * from public.attendance where member_id=$1', [
            mA,
          ])
        ).rows.length,
        1,
      );
      assert.ok(
        (
          await db.query('select * from public.audit_log where table_name=$1', [
            'attendance',
          ])
        ).rows.length > 0,
      );
      await as(userA);
      assert.equal(
        (await db.query('select * from public.attendance')).rows.length,
        0,
      );
      await assert.rejects(
        call('set_attendance', [session, mA, 'going', null, null]),
        /chính mình/,
      );
      await as(userB);
      assert.equal(
        (await db.query('select * from public.audit_log')).rows.length,
        0,
      );
      await assert.rejects(
        db.query('select * from auth.users'),
        /permission denied/,
      );
    },
  );
  await t.test(
    'Renaming organizer emits a session update without corrupting count',
    async () => {
      await as(admin);
      await call('save_member', [mAdmin, { display_name: 'Dũng quản trị' }, 1]);
      await as(null);
      const publicRows = await call<Record<string, unknown>[]>(
        'get_public_schedule',
        [],
      );
      assert.equal(publicRows[0].organizer_name, 'Dũng quản trị');
      assert.equal(publicRows[0].going_count, 1);
    },
  );
  await t.test(
    'New members join upcoming rosters without changing historical unanswered counts',
    async () => {
      await as(admin);
      const past = await call<string>('save_session', [
        null,
        { ...patch, session_date: '2020-01-01', deadline: null },
        null,
      ]);
      const initial = (
        await db.query(
          'select * from public.session_roster where session_id=$1',
          [past],
        )
      ).rows.length;
      const future = (
        await db.query<{ id: string }>(
          'select id from public.sessions where copied_from=$1',
          [session],
        )
      ).rows[0].id;
      const added = await call<string>('save_member', [
        null,
        { display_name: 'Người mới' },
        null,
      ]);
      assert.equal(
        (
          await db.query(
            'select * from public.session_roster where session_id=$1',
            [past],
          )
        ).rows.length,
        initial,
      );
      assert.equal(
        (
          await db.query(
            'select * from public.session_roster where session_id=$1 and member_id=$2',
            [future, added],
          )
        ).rows.length,
        1,
      );
      await call('save_member', [added, { active: false }, 1]);
      assert.equal(
        (
          await db.query(
            'select * from public.session_roster where session_id=$1 and member_id=$2',
            [future, added],
          )
        ).rows.length,
        1,
      );
      await assert.rejects(
        db.query('delete from public.session_roster'),
        /permission denied/,
      );
    },
  );
  // Upgrade an already-used database, preserving its members and history.
  await db.exec('reset role');
  const upgrade =
    (
      await readFile(
        new URL(
          '../supabase/migrations/202611100001_quick_registration.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).split('-- REALTIME:')[0] + '\ncommit;';
  await db.exec(upgrade);
  await t.test(
    'Upgrade preserves existing history; anonymous quick snapshot contains no Auth data',
    async () => {
      await as(null);
      const snapshot = await call<{
        version: number;
        members: { id: string; active: boolean }[];
        attendance: unknown[];
        sessions: unknown[];
      }>('get_quick_snapshot', []);
      assert.equal(snapshot.version, 1);
      assert.ok(snapshot.members.some((m) => m.id === mA && !m.active));
      assert.ok(snapshot.attendance.length >= 2);
      assert.ok(!JSON.stringify(snapshot).includes('test.invalid'));
      await assert.rejects(
        db.query('select * from public.account_links'),
        /permission denied/,
      );
      await assert.rejects(
        db.query('select * from public.audit_log'),
        /permission denied/,
      );
      await assert.rejects(
        call('save_session', [null, patch, null]),
        /permission denied/,
      );
    },
  );
  let quickSession: string,
    batchOpen: string,
    batchFull: string,
    batchCancelled: string,
    batchExpired: string;
  await t.test(
    'Choosing a name requires no email; writes still enforce capacity, note versions and activity',
    async () => {
      await as(admin);
      quickSession = await call<string>('save_session', [
        null,
        { ...patch, court: 'Nhanh' },
        null,
      ]);
      await as(null);
      await call('quick_set_attendance', [
        quickSession,
        mB,
        'going',
        null,
        null,
      ]);
      await call('quick_set_attendance', [
        quickSession,
        mB,
        null,
        'Đến muộn 10 phút',
        0,
      ]);
      await call('quick_set_attendance', [
        quickSession,
        mB,
        'not_going',
        null,
        null,
      ]);
      let row = (
        await db.query<{ status: string; note: string; note_version: number }>(
          'select * from public.attendance where session_id=$1 and member_id=$2',
          [quickSession, mB],
        )
      ).rows[0];
      assert.equal(row.status, 'not_going');
      assert.equal(row.note, 'Đến muộn 10 phút');
      assert.equal(row.note_version, 1);
      await assert.rejects(
        call('quick_set_attendance', [quickSession, mB, null, 'Ghi đè cũ', 0]),
        /thiết bị khác/,
      );
      await call('quick_set_attendance', [
        quickSession,
        mB,
        null,
        'Đến muộn 10 phút',
        1,
      ]);
      row = (
        await db.query<typeof row>(
          'select * from public.attendance where session_id=$1 and member_id=$2',
          [quickSession, mB],
        )
      ).rows[0];
      assert.equal(
        row.note_version,
        1,
        'Saving identical note must not generate a new version',
      );
      await call('quick_set_attendance', [
        quickSession,
        mB,
        'going',
        null,
        null,
      ]);
      await assert.rejects(
        call('quick_set_attendance', [
          quickSession,
          mAdmin,
          'going',
          null,
          null,
        ]),
        /đủ người/,
      );
      await assert.rejects(
        call('quick_set_attendance', [quickSession, mA, 'going', null, null]),
        /ngừng hoạt động/,
      );
      await assert.rejects(
        db.query("update public.attendance set status='going'"),
        /permission denied/,
      );
      await as(admin);
      const audit = (
        await db.query<{ actor_name: string }>(
          'select actor_name from public.audit_log where record_id=(select id from public.attendance where session_id=$1 and member_id=$2) order by id desc limit 1',
          [quickSession, mB],
        )
      ).rows[0];
      assert.match(audit.actor_name, /chọn tên/);
    },
  );
  await t.test(
    'Multi-court registration saves available courts, reports each failure, and preserves notes',
    async () => {
      await as(admin);
      batchOpen = await call<string>('save_session', [
        null,
        { ...patch, court: 'Còn chỗ', max_players: 4 },
        null,
      ]);
      batchFull = await call<string>('save_session', [
        null,
        { ...patch, court: 'Đủ chỗ' },
        null,
      ]);
      batchCancelled = await call<string>('save_session', [
        null,
        { ...patch, court: 'Đã hủy', booking_status: 'cancelled' },
        null,
      ]);
      batchExpired = await call<string>('save_session', [
        null,
        { ...patch, court: 'Hết hạn', deadline: '2020-01-01T00:00:00Z' },
        null,
      ]);
      await call('set_attendance', [batchFull, mAdmin, 'going', null, null]);
      await as(null);
      await call('quick_set_attendance', [
        batchOpen,
        mB,
        null,
        'Chỉ mang một vợt',
        0,
      ]);
      const results = await call<
        { session_id: string; ok: boolean; message?: string }[]
      >('quick_set_many_attendance', [
        [batchFull, batchOpen, batchCancelled, batchExpired, batchOpen],
        mB,
        'going',
      ]);
      assert.equal(results.length, 4);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.ok(results.find((r) => r.session_id === batchOpen)?.ok);
      assert.match(
        results.find((r) => r.session_id === batchFull)?.message ?? '',
        /đủ người/,
      );
      assert.match(
        results.find((r) => r.session_id === batchCancelled)?.message ?? '',
        /đã hủy/,
      );
      assert.match(
        results.find((r) => r.session_id === batchExpired)?.message ?? '',
        /hết hạn/,
      );
      const row = (
        await db.query<{ note: string; status: string }>(
          'select * from public.attendance where session_id=$1 and member_id=$2',
          [batchOpen, mB],
        )
      ).rows[0];
      assert.equal(row.status, 'going');
      assert.equal(row.note, 'Chỉ mang một vợt');
      await assert.rejects(
        call('quick_set_many_attendance', [[], mB, 'going']),
        /1 đến 60/,
      );
      await assert.rejects(
        call('quick_set_many_attendance', [[batchOpen], mB, null]),
        /không hợp lệ/,
      );
      await as(admin);
      const adminResults = await call<{ ok: boolean }[]>(
        'set_many_attendance',
        [[batchExpired], mAdmin, 'going'],
      );
      assert.ok(adminResults[0].ok, 'Admin retains deadline override');
    },
  );
  await t.test(
    'Quick API rejects cancelled/past sessions and cannot grant administration',
    async () => {
      await as(null);
      await assert.rejects(
        call('quick_set_attendance', [batchCancelled, mB, 'going', null, null]),
        /đã hủy/,
      );
      await assert.rejects(
        call('quick_set_attendance', [batchExpired, mB, 'going', null, null]),
        /hết hạn/,
      );
      await assert.rejects(
        call('quick_set_attendance', [quickSession, mB, 'admin', null, null]),
        /không hợp lệ/,
      );
      await assert.rejects(
        call('copy_week', ['2099-11-09']),
        /permission denied/,
      );
      await assert.rejects(
        call('save_member', [null, { display_name: 'Không được' }, null]),
        /permission denied/,
      );
      await assert.rejects(
        db.query('select private.write_attendance($1,$2,$3,$4,$5,$6)', [
          quickSession,
          mB,
          'going',
          null,
          null,
          true,
        ]),
        /permission denied/,
      );
      await as(userB);
      await assert.rejects(
        call('save_session', [null, patch, null]),
        /quyền quản trị/,
      );
      await assert.rejects(
        call('save_session_template', [
          'Không được',
          { venue: 'Sân', court: '1', start_time: '18:00', end_time: '20:00' },
        ]),
        /quyền quản trị/,
      );
    },
  );
  await t.test(
    'Admin templates fill only court defaults; new sessions reset booking and responses',
    async () => {
      await as(admin);
      const { session_date, booking_status, deadline, ...template } = patch;
      const id = await call<string>('save_session_template', [
        'Thứ Ba · Sân 1',
        template,
      ]);
      assert.ok(id);
      assert.equal(
        await call('save_session_template', [
          'Thứ Ba · Sân 1',
          { ...template, court: 'Sân 2' },
        ]),
        id,
      );
      const saved = (
        await db.query<{ template: Record<string, unknown> }>(
          'select * from public.session_templates where id=$1',
          [id],
        )
      ).rows[0].template;
      const created = await call<string>('save_session', [
        null,
        {
          ...saved,
          session_date: '2099-11-23',
          booking_status: 'pending',
          deadline: null,
        },
        null,
      ]);
      const newRow = (
        await db.query<{ booking_status: string; going_count: number }>(
          'select * from public.sessions where id=$1',
          [created],
        )
      ).rows[0];
      assert.equal(newRow.booking_status, 'pending');
      assert.equal(newRow.going_count, 0);
      assert.equal(
        (
          await db.query(
            'select * from public.attendance where session_id=$1',
            [created],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        call('save_session_template', [
          'Sai',
          { ...template, booking_status: 'booked' },
        ]),
        /không hợp lệ/,
      );
      await assert.rejects(
        call('save_session_template', [
          'Sai giờ',
          { ...template, end_time: '17:00' },
        ]),
        /kết thúc/,
      );
      await as(null);
      await assert.rejects(
        call('save_session_template', ['Không được', template]),
        /permission denied/,
      );
      await assert.rejects(
        db.query('select * from public.session_templates'),
        /permission denied/,
      );
    },
  );
  await db.close();
});
