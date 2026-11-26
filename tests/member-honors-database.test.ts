import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { parseMemberHub, type MemberHub } from '../src/memberHonors';

test('Member honors: verified ownership, factual criteria, private monthly votes and concurrent edits', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const admin = randomUUID(),
    account = randomUUID();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated; grant insert on storage.objects to anon,authenticated;`);
  for (const name of [
    '202611090001_initial.sql',
    '202611100001_quick_registration.sql',
    '202611100002_booking_responsibility.sql',
    '202611260001_member_honors.sql',
    '202611260001_member_honors.sql',
    '202611260002_member_avatar_upload.sql',
    '202611260002_member_avatar_upload.sql',
  ]) {
    const sql = await readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      'utf8',
    );
    await db.exec(sql.split('-- REALTIME:')[0].split('-- STORAGE:')[0]);
    if (/quick_registration|booking_responsibility/.test(name))
      await db.exec('commit');
  }
  const members = (
    await db.query<{ id: string; display_name: string }>(
      'select id,display_name from members order by code',
    )
  ).rows;
  const ids = Object.fromEntries(members.map((m) => [m.display_name, m.id]));
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [
    admin,
    'admin@test.invalid',
    account,
    'member@test.invalid',
  ]);
  await db.query(
    "insert into public.account_links values($1,$2,'admin'),($3,$4,'member')",
    [admin, ids.Dũng, account, ids.Khôi],
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
  const token = await issue(ids.Yến);
  const hub = async (credential: string | null = null): Promise<MemberHub> =>
    parseMemberHub(await call('get_member_hub', [credential]));
  const profile = async (mid = ids.Yến) =>
    (await hub()).profiles.find((p) => p.member_id === mid)!;
  const style = (
    avatar = 'smug-cat',
    badge = '',
    version = 0,
    credential: string | null = token,
  ) => call('save_member_style', [avatar, badge, version, credential]);
  const month = (await hub()).month;
  const vote = (
    nominee: string | null,
    version = 0,
    credential: string | null = token,
    category = 'comic',
    period = month,
  ) =>
    call('vote_member_honor', [category, nominee, period, version, credential]);

  await t.test(
    'Anonymous read is aggregate only; name selection and direct table access grant no write permission',
    async () => {
      const data = await hub();
      assert.equal(data.viewer_member_id, null);
      assert.deepEqual(data.mine, []);
      assert.equal(data.profiles.length, members.length);
      assert.equal(data.profiles[0].badges.length, 7);
      await assert.rejects(style('smug-cat', '', 0, null), /xác minh/);
      await assert.rejects(style('smug-cat', '', 0, ids.Yến), /xác minh/);
      await assert.rejects(vote(ids.Hiền, 0, null), /xác minh/);
      await assert.rejects(
        db.query('select * from private.member_honor_votes'),
        /permission denied/,
      );
      await assert.rejects(
        db.query('update private.member_styles set avatar_key=$1', [
          'cheeky-frog',
        ]),
        /permission denied/,
      );
      await assert.rejects(
        db.query('select private.member_honor_badges($1)', [ids.Yến]),
        /permission denied/,
      );
    },
  );
  await t.test(
    'Saved avatar is visible to a second reader, uses allowlist and rejects stale versions and unearned pins',
    async () => {
      const before = (await call('get_booking_snapshot', [token])).revision;
      await style();
      assert.equal((await profile()).avatar_key, 'smug-cat');
      assert.equal((await hub(token)).viewer_member_id, ids.Yến);
      assert.ok(
        (await call('get_booking_snapshot', [token])).revision > before,
      );
      await assert.rejects(style('cheeky-frog', '', 0), /thiết bị khác/);
      await assert.rejects(
        style('https://evil.invalid/avatar', '', 1),
        /Avatar/,
      );
      await assert.rejects(style('smug-cat', 'veteran', 1), /đủ điều kiện/);
      await style('side-eye-duck', '', 1);
      assert.equal((await profile()).version, 2);
      await asUser(account);
      await style('jerry-smirk', '', 0, token);
      assert.equal((await hub(token)).viewer_member_id, ids.Khôi);
      assert.equal((await profile(ids.Khôi)).avatar_key, 'jerry-smirk');
      assert.equal((await profile()).avatar_key, 'side-eye-duck');
      await asUser(null);
    },
  );
  await t.test(
    'Registration badges exclude future, cancelled, pending and declined sessions; count distinct days',
    async () => {
      await db.exec('reset role');
      // Clean only the isolated test member. This is never run against a live project.
      await db.query('delete from public.attendance where member_id=$1', [
        ids.Yến,
      ]);
      const make = async (
        date: string,
        status: string,
        attendance = 'going',
        court = 'Ca A',
        booker = ids.Dũng,
      ) => {
        const sid = (
          await db.query<{ id: string }>(
            `insert into public.sessions(session_date,start_time,end_time,venue,court,organizer_mode,organizer_id,booking_status,booked_by_member_id)
        values($1,'18:00','20:00','Sân kiểm thử',$2,'override',$3,$4,$5) returning id`,
            [date, court, ids.Dũng, status, booker],
          )
        ).rows[0].id;
        await db.query(
          `insert into attendance(session_id,member_id,status) values($1,$2,$3) on conflict(session_id,member_id) do update set status=excluded.status`,
          [sid, ids.Yến, attendance],
        );
        return sid;
      };
      await make('2099-01-01', 'booked');
      await make('2000-01-01', 'cancelled');
      await make('2000-01-02', 'pending');
      await make('2000-01-03', 'booked', 'not_going');
      await asUser(null);
      assert.equal(
        (await profile()).badges.find((b) => b.key === 'first_rally')?.progress,
        0,
      );
      await db.exec('reset role');
      const first = await make(
        '2000-01-04',
        'booked',
        'going',
        'Ca A',
        ids.Yến,
      );
      const duplicate = await make('2000-01-04', 'booked', 'going', 'Ca B');
      await asUser(null);
      assert.equal(
        (await profile()).badges.find((b) => b.key === 'first_rally')?.progress,
        1,
      );
      assert.equal(
        (await profile()).badges.find((b) => b.key === 'court_keeper')?.earned,
        true,
      );
      await style('smug-cat', 'first_rally', 2);
      await db.exec('reset role');
      await db.query(
        "update sessions set booking_status='cancelled' where id=any($1::uuid[])",
        [[first, duplicate]],
      );
      await asUser(null);
      assert.equal((await profile()).featured_badge, '');
      assert.equal(
        (await profile()).badges.find((b) => b.key === 'court_keeper')?.earned,
        false,
      );
      await db.exec('reset role');
      for (let day = 1; day <= 20; day++)
        await make(`2001-01-${String(day).padStart(2, '0')}`, 'booked');
      await db.query(
        `insert into weekly_booking_assignments(week_start,member_id,original_member_id,completed_member_id,completed_at) values('2000-01-03',$1,$1,$1,now())`,
        [ids.Yến],
      );
      await asUser(null);
      const badges = (await profile()).badges;
      for (const key of ['first_rally', 'regular', 'veteran', 'week_keeper'])
        assert.equal(badges.find((b) => b.key === key)?.earned, true, key);
      assert.equal(badges.find((b) => b.key === 'regular')?.progress, 20);
    },
  );
  await t.test(
    'One private vote per category/month, no self vote, stale or wrong-month submissions; withdraw preserves revision',
    async () => {
      await assert.rejects(vote(ids.Yến), /không tự bầu/);
      await assert.rejects(
        vote(ids.Hiền, 0, token, 'comic', '1900-01'),
        /tháng mới/,
      );
      await vote(ids.Hiền);
      let data = await hub(token);
      assert.equal(data.mine.find((v) => v.category === 'comic')?.version, 1);
      assert.equal(
        data.votes.find(
          (v) => v.member_id === ids.Hiền && v.category === 'comic',
        )?.votes,
        1,
      );
      assert.ok(!JSON.stringify(await hub()).includes('voter_id'));
      await assert.rejects(vote(ids.Dũng), /Phiếu đã thay đổi/);
      await vote(ids.Dũng, 1);
      await vote(null, 2);
      data = await hub(token);
      assert.equal(data.mine.find((v) => v.category === 'comic')?.version, 3);
      assert.equal(
        data.mine.find((v) => v.category === 'comic')?.nominee_id,
        null,
      );
      await assert.rejects(vote(ids.Hiền, 0), /Phiếu đã thay đổi/);
      await db.exec('reset role');
      await db.query('update members set active=false where id=$1', [ids.Hiền]);
      await asUser(null);
      await assert.rejects(vote(ids.Hiền, 3), /không còn hoạt động/);
      await db.exec('reset role');
      await db.query('update members set active=true where id=$1', [ids.Hiền]);
      await asUser(null);
    },
  );
  await t.test(
    'Monthly award closes only after month ends, minimum three, ties shared; lower totals never win',
    async () => {
      await db.exec('reset role');
      const voters = members.filter(
        (m) => ![ids.Yến, ids.Hiền, ids.Dũng].includes(m.id),
      );
      assert.ok(voters.length >= 6);
      for (const [index, nominee] of [ids.Yến, ids.Hiền].entries())
        for (let i = 0; i < 3; i++) {
          await db.query(
            `insert into private.member_honor_votes(voter_id,month,category,nominee_id) values($1,date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh'),'teammate',$2)`,
            [voters[index * 3 + i].id, nominee],
          );
        }
      await asUser(null);
      assert.equal(
        (await profile()).badges.find((b) => b.key === 'teammate')?.earned,
        false,
      );
      await db.exec('reset role');
      await db.exec(
        "update private.member_honor_votes set month=(month-interval '1 month')::date where category='teammate'",
      );
      for (let i = 0; i < 2; i++)
        await db.query(
          `insert into private.member_honor_votes(voter_id,month,category,nominee_id) values($1,(date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')-interval '1 month')::date,'comic',$2)`,
          [voters[i].id, ids.Dũng],
        );
      await asUser(null);
      for (const id of [ids.Yến, ids.Hiền])
        assert.equal(
          (await profile(id)).badges.find((b) => b.key === 'teammate')?.earned,
          true,
        );
      assert.equal(
        (await profile(ids.Dũng)).badges.find((b) => b.key === 'comic')?.earned,
        false,
      );
      await style('cheeky-frog', 'teammate', 3);
      assert.equal((await profile()).featured_badge, 'teammate');
      await db.exec('reset role');
      await db.query(
        `insert into private.member_honor_votes(voter_id,month,category,nominee_id) values($1,(date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh')-interval '1 month')::date,'teammate',$2)`,
        [ids.Dũng, ids.Hiền],
      );
      await asUser(null);
      assert.equal(
        (await profile()).badges.find((b) => b.key === 'teammate')?.earned,
        false,
      );
      assert.equal((await profile()).featured_badge, '');
      assert.equal(
        (await profile(ids.Hiền)).badges.find((b) => b.key === 'teammate')
          ?.earned,
        true,
      );
    },
  );
  await t.test(
    'Uploaded avatars require verified ownership, confirmed immutable Storage objects and the latest profile version',
    async () => {
      assert.equal((await hub()).custom_avatars, true);
      await assert.rejects(
        call('prepare_member_avatar_upload', ['image/webp', 42, null]),
        /xác minh/,
      );
      await assert.rejects(
        call('prepare_member_avatar_upload', ['image/svg+xml', 42, token]),
        /JPG/,
      );
      await assert.rejects(
        call('prepare_member_avatar_upload', ['image/webp', 1048577, token]),
        /1 MB/,
      );
      const permit = await call('prepare_member_avatar_upload', [
        'image/webp',
        42,
        token,
      ]);
      const version = (await profile()).version;
      const save = (path: string | null, expected = version, key = '') =>
        call('save_member_appearance', [key, path, '', expected, token]);
      await assert.rejects(save(permit.path), /đã tải và xác nhận/);
      await assert.rejects(
        db.query(
          "insert into storage.objects(bucket_id,name,metadata) values('member-avatars','avatars/guess.webp','{}')",
        ),
        /row-level security/,
      );
      await db.query(
        "insert into storage.objects(bucket_id,name,metadata) values('member-avatars',$1,$2)",
        [permit.path, { mimetype: 'image/webp', size: 42 }],
      );
      assert.equal((await profile()).avatar_path, null);
      await call('complete_member_avatar_upload', [permit.path, token]);
      await call('complete_member_avatar_upload', [permit.path, token]);
      await assert.rejects(
        db.query(
          "insert into storage.objects(bucket_id,name,metadata) values('member-avatars',$1,'{}')",
          [permit.path],
        ),
        /row-level security|duplicate/,
      );
      await asUser(account);
      await assert.rejects(
        call('complete_member_avatar_upload', [permit.path, null]),
        /không được/,
      );
      const accountVersion = (await profile(ids.Khôi)).version;
      await assert.rejects(
        call('save_member_appearance', [
          '',
          permit.path,
          '',
          accountVersion,
          null,
        ]),
        /chính bạn/,
      );
      await asUser(null);
      await save(permit.path);
      assert.equal((await profile()).avatar_path, permit.path);
      assert.equal((await profile()).avatar_key, '');
      await assert.rejects(save(null), /thiết bị khác/);
      await assert.rejects(
        save(permit.path, version + 1, 'smug-cat'),
        /chính bạn/,
      );
      await save(null, version + 1, 'jerry-smirk');
      assert.equal((await profile()).avatar_path, null);
      assert.equal((await profile()).avatar_key, 'jerry-smirk');
      const wrong = await call('prepare_member_avatar_upload', [
        'image/webp',
        42,
        token,
      ]);
      await db.query(
        "insert into storage.objects(bucket_id,name,metadata) values('member-avatars',$1,$2)",
        [wrong.path, { mimetype: 'image/jpeg', size: 42 }],
      );
      await assert.rejects(
        call('complete_member_avatar_upload', [wrong.path, token]),
        /chưa xác nhận/,
      );
      const expired = await call('prepare_member_avatar_upload', [
        'image/jpeg',
        42,
        token,
      ]);
      await db.exec('reset role');
      await db.query(
        "update private.member_avatar_uploads set expires_at=now()-interval '1 minute' where path=$1",
        [expired.path],
      );
      await asUser(null);
      await assert.rejects(
        db.query(
          "insert into storage.objects(bucket_id,name,metadata) values('member-avatars',$1,$2)",
          [expired.path, { mimetype: 'image/jpeg', size: 42 }],
        ),
        /row-level security/,
      );
      await assert.rejects(
        call('complete_member_avatar_upload', [expired.path, token]),
        /hết hạn/,
      );
      for (let i = 0; i < 8; i++)
        await call('prepare_member_avatar_upload', ['image/webp', 42, token]);
      await assert.rejects(
        call('prepare_member_avatar_upload', ['image/webp', 42, token]),
        /nhiều ảnh/,
      );
      await assert.rejects(
        db.query('update storage.objects set metadata=$1', ['{}']),
        /permission denied/,
      );
      await assert.rejects(
        db.query('delete from storage.objects'),
        /permission denied/,
      );
    },
  );
  await t.test(
    'Expired credentials and deactivated members cannot change style or vote',
    async () => {
      await db.exec('reset role');
      await db.query('update members set active=false where id=$1', [ids.Yến]);
      await asUser(null);
      await assert.rejects(style('smug-cat', '', 4), /xác minh/);
      await assert.rejects(vote(ids.Dũng, 3), /xác minh/);
      assert.equal((await hub(token)).viewer_member_id, null);
      await db.exec('reset role');
      await db.query('update members set active=true where id=$1', [ids.Yến]);
      await db.exec('reset role');
      await db.query(
        "update private.booking_devices set expires_at=now()-interval '1 second' where member_id=$1",
        [ids.Yến],
      );
      await asUser(null);
      await assert.rejects(style('smug-cat', '', 4), /xác minh/);
      await assert.rejects(vote(ids.Dũng, 3), /xác minh/);
      assert.equal((await hub(token)).viewer_member_id, null);
    },
  );
});
