import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('Verified members register and write notes for others through existing attendance validation and audit', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const admin = randomUUID(),
    accountUser = randomUUID(),
    unlinked = randomUUID();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  for (const id of [admin, accountUser, unlinked])
    await db.query('insert into auth.users values($1,$2,now())', [
      id,
      `${id}@test.invalid`,
    ]);
  for (const name of [
    '202611090001_initial.sql',
    '202611100001_quick_registration.sql',
    '202611100002_booking_responsibility.sql',
    '202611100003_finance_travel.sql',
    '202611100004_auto_fees_and_covers.sql',
    '202611110003_practical_updates.sql',
    '202611180001_name_selected_creation.sql',
    '202611190004_verified_attendance.sql',
    '202611190004_verified_attendance.sql',
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
  await db.query(
    "insert into public.account_links values($1,$2,'admin'),($3,$4,'member')",
    [admin, ids.Dũng, accountUser, ids.Khôi],
  );
  async function asUser(uid: string | null) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid ?? '',
    ]);
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  }
  async function call(name: string, args: unknown[] = []): Promise<any> {
    return (
      await db.query<{ r: any }>(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`,
        args,
      )
    ).rows[0].r;
  }
  async function issue(mid: string) {
    await asUser(admin);
    const invite = await call('issue_booking_code', [mid, false]);
    await asUser(null);
    return (await call('activate_booking_identity', [invite.code]))
      .token as string;
  }
  async function createSession(patch: Record<string, unknown> = {}) {
    await asUser(admin);
    return (await call('save_session', [
      null,
      {
        session_date: '2099-05-21',
        start_time: '18:00',
        end_time: '20:00',
        venue: 'Sân kiểm thử',
        court: 'Ca 1',
        organizer_mode: 'override',
        organizer_id: ids.Dũng,
        booking_status: 'booked',
        max_players: 2,
        ...patch,
      },
      null,
    ])) as string;
  }
  const sid = await createSession();
  const token = await issue(ids.Yến);
  const row = async (mid = ids.Hiền) =>
    (await call('get_quick_snapshot')).attendance.find(
      (a: any) => a.session_id === sid && a.member_id === mid,
    );
  const write = (
    status: string | null,
    note: string | null = null,
    version: number | null = null,
    credential: string | null = token,
    mid = ids.Hiền,
    session = sid,
  ) =>
    call('set_verified_attendance', [
      session,
      mid,
      status,
      note,
      version,
      credential,
    ]);

  await t.test(
    'A chosen name or an unlinked account is insufficient for the verified write path',
    async () => {
      await asUser(null);
      await assert.rejects(write('going', null, null, null), /xác minh/);
      await assert.rejects(write('going', null, null, ids.Yến), /xác minh/);
      await asUser(unlinked);
      await assert.rejects(write('going', null, null, null), /xác minh/);
      assert.equal(await row(), undefined);
    },
  );
  await t.test(
    'A code-verified ordinary member can update another member; audit uses the actual actor',
    async () => {
      await asUser(null);
      const revision = (await call('get_booking_snapshot', [token])).revision;
      await write('going', 'Yến đăng ký hộ Hiền, đến muộn 15 phút', 0);
      const saved = await row();
      assert.equal(saved.status, 'going');
      assert.equal(saved.note_version, 1);
      assert.equal(saved.note, 'Yến đăng ký hộ Hiền, đến muộn 15 phút');
      assert.ok(
        (await call('get_booking_snapshot', [token])).revision > revision,
      );
      await db.exec('reset role');
      const audit = (
        await db.query<any>(
          "select * from public.audit_log where table_name='attendance' and record_id=$1 order by id desc limit 1",
          [saved.id],
        )
      ).rows[0];
      assert.equal(audit.actor_name, 'Yến · đã xác minh');
      assert.equal(audit.actor_id, null);
      assert.equal(audit.after_data.member_id, ids.Hiền);
      await asUser(null);
      assert.equal(
        (await row()).note,
        saved.note,
        'Another snapshot sees the saved data',
      );
    },
  );
  await t.test(
    'A linked non-admin account also writes for others and takes precedence over a supplied code',
    async () => {
      await asUser(accountUser);
      await write('not_going');
      assert.equal((await row()).status, 'not_going');
      await write(null, 'Khôi ghi chú hộ Hiền', 1);
      const saved = await row();
      assert.equal(saved.status, 'not_going');
      assert.equal(saved.note_version, 2);
      await db.exec('reset role');
      const audit = (
        await db.query<any>(
          "select actor_id,actor_name from public.audit_log where table_name='attendance' and record_id=$1 order by id desc limit 1",
          [saved.id],
        )
      ).rows[0];
      assert.equal(audit.actor_name, 'Khôi · đã xác minh');
      assert.equal(audit.actor_id, accountUser);
    },
  );
  await t.test(
    'Status updates preserve notes; stale note versions never overwrite another device',
    async () => {
      await asUser(null);
      await write('going');
      const saved = await row();
      assert.equal(saved.note, 'Khôi ghi chú hộ Hiền');
      assert.equal(saved.note_version, 2);
      await assert.rejects(
        write(null, 'Ghi đè cũ', 1),
        (e: any) => e.code === 'PT409',
      );
      assert.equal((await row()).note, saved.note);
      await write(null, '', 2);
      assert.equal((await row()).status, 'going');
      assert.equal((await row()).note, '');
    },
  );
  await t.test(
    'Capacity and input limits still apply to proxy registrations',
    async () => {
      await asUser(null);
      await write('going', null, null, token, ids.Yến);
      await assert.rejects(
        write('going', null, null, token, ids.Khôi),
        /đủ người/,
      );
      await write(null, 'Ghi chú vẫn lưu được khi sân đủ người', 3);
      assert.equal((await row()).note_version, 4);
      await assert.rejects(write('admin'), /Trạng thái/);
      await assert.rejects(
        write(null, 'x'.repeat(1001), 4),
        /check constraint/,
      );
      assert.equal((await row()).note_version, 4);
      await assert.rejects(write(null), /Chưa có thay đổi/);
      await assert.rejects(
        write('going', null, null, token, randomUUID()),
        /không tồn tại/,
      );
    },
  );
  await t.test(
    'Expired or revoked verification cannot update another person',
    async () => {
      const expired = await issue(ids.Hiền);
      await db.exec('reset role');
      await db.query(
        "update private.booking_devices set expires_at=now()-interval '1 second' where member_id=$1",
        [ids.Hiền],
      );
      await asUser(null);
      await assert.rejects(write('not_going', null, null, expired), /xác minh/);
      const revoked = await issue(ids.Hiền);
      await asUser(admin);
      await call('issue_booking_code', [ids.Hiền, true]);
      await asUser(null);
      await assert.rejects(write('not_going', null, null, revoked), /xác minh/);
      assert.equal((await row()).status, 'going');
    },
  );
  await t.test(
    'Verified members cannot bypass a deadline, cancellation or a finished session',
    async () => {
      const deadline = await createSession({
        deadline: '2020-01-01T00:00:00Z',
      });
      const cancelled = await createSession({ booking_status: 'cancelled' });
      const ended = await createSession({ session_date: '2020-01-01' });
      await asUser(null);
      await assert.rejects(
        write('going', null, null, token, ids.Hiền, deadline),
        /hết hạn/,
      );
      await assert.rejects(
        write(null, 'Ghi chú sau hạn', 0, token, ids.Hiền, deadline),
        /hết hạn/,
      );
      await assert.rejects(
        write('going', null, null, token, ids.Hiền, cancelled),
        /đã hủy/,
      );
      await assert.rejects(
        write('going', null, null, token, ids.Hiền, ended),
        /kết thúc/,
      );
      await asUser(admin);
      await write('going', null, null, null, ids.Hiền, deadline);
      await assert.rejects(
        write('going', null, null, null, ids.Hiền, cancelled),
        /đã hủy/,
      );
      await assert.rejects(
        write('going', null, null, null, ids.Hiền, ended),
        /kết thúc/,
      );
    },
  );
  await t.test(
    'Inactive targets and members outside the roster remain blocked; direct table writes stay forbidden',
    async () => {
      await db.exec('reset role');
      await db.query(
        'delete from public.session_roster where session_id=$1 and member_id=$2',
        [sid, ids.Khôi],
      );
      await asUser(null);
      await assert.rejects(
        write('going', null, null, token, ids.Khôi),
        /không thuộc danh sách/,
      );
      await db.exec('reset role');
      await db.query('update public.members set active=false where id=$1', [
        ids.Hiền,
      ]);
      await asUser(null);
      await assert.rejects(write('not_going'), /ngừng hoạt động/);
      await assert.rejects(
        db.query("update public.attendance set note='Bypass'"),
        /permission denied/,
      );
      await db.exec('reset role');
      await db.query('update public.members set active=false where id=$1', [
        ids.Yến,
      ]);
      await asUser(null);
      await assert.rejects(
        write('going', null, null, token, ids.Dũng),
        /xác minh/,
      );
    },
  );
});
