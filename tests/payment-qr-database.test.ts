import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('Payment QR: storage capabilities, scoped manager writes, independent snapshots and unchanged receipts', async (t) => {
  const db = new PGlite();
  const admin = '10000000-0000-4000-8000-000000000001';
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${admin}','admin@test.invalid',now());
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant insert on storage.objects to anon,authenticated;`);
  for (const name of [
    '202611090001_initial.sql',
    '202611100001_quick_registration.sql',
    '202611100002_booking_responsibility.sql',
    '202611100003_finance_travel.sql',
    '202611100004_auto_fees_and_covers.sql',
    '202611110003_practical_updates.sql',
    '202611190003_activity_payment_qr.sql',
  ]) {
    const sql = await readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      'utf8',
    );
    await db.exec(sql.split('-- REALTIME:')[0]);
    if (/quick_registration|booking_responsibility/.test(name))
      await db.exec('commit');
  }
  const ids = Object.fromEntries(
    (
      await db.query<{ id: string; display_name: string }>(
        'select id,display_name from public.members',
      )
    ).rows.map((x) => [x.display_name, x.id]),
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
    await db.exec(
      "reset role;select set_config('request.jwt.claim.sub','',false);set role anon;",
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
  async function snap(token: string | null) {
    return call('get_activity_snapshot', [token]);
  }
  async function activity(id: string, token: string | null) {
    return (await snap(token)).activities.find((a: any) => a.id === id);
  }
  async function identity(name: string) {
    await asAdmin();
    const issued = await call('issue_booking_code', [ids[name], false]);
    await asGuest();
    return (await call('activate_booking_identity', [issued.code]))
      .token as string;
  }
  const yen = await identity('Yến'),
    hien = await identity('Hiền');
  await asAdmin();
  const sid = await call('save_session', [
    null,
    {
      session_date: '2030-05-21',
      start_time: '18:00',
      end_time: '20:00',
      venue: 'Sân thử QR',
      court: '1',
      organizer_mode: 'override',
      organizer_id: ids.Yến,
      booking_status: 'booked',
    },
    null,
  ]);
  await call('set_attendance', [sid, ids.Yến, 'going', null, null]);
  const badminton = (await snap(null)).activities.find((a: any) =>
    a.groups.some((g: any) => g.session_id === sid),
  ).id;
  const trip = await call('create_club_activity', [
    'trip',
    'Chuyến thử QR',
    [],
    { organizer_id: ids.Yến },
    null,
  ]);
  const account = {
    receiver_name: 'NGUYEN THI YEN',
    bank_name: 'Ngân hàng thử',
    account_number: '00123456789',
    transfer_note: '',
  };
  await asGuest();
  async function insert(
    p: any,
    metadata = { mimetype: 'image/png', size: 100 },
  ) {
    await db.query(
      'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',
      [p.bucket, p.path, metadata],
    );
  }
  async function upload(id = badminton) {
    const p = await call('prepare_payment_qr_upload', [
      id,
      'image/png',
      100,
      yen,
    ]);
    await insert(p);
    await call('complete_payment_qr_upload', [p.path, yen]);
    return p.path as string;
  }
  let firstPath = '';
  await t.test(
    'Guests and unrelated verified members cannot configure or upload; direct writes are denied',
    async () => {
      for (const token of [null, ids.Yến, hien]) {
        await assert.rejects(
          () =>
            call('prepare_payment_qr_upload', [
              badminton,
              'image/png',
              100,
              token,
            ]),
          /xác minh|phụ trách/,
        );
        await assert.rejects(
          () =>
            call('save_activity_payment_settings', [
              badminton,
              account,
              0,
              token,
            ]),
          /xác minh|phụ trách/,
        );
        await assert.rejects(
          () => call('get_payment_qr_library', [badminton, token]),
          /xác minh|phụ trách/,
        );
      }
      await assert.rejects(
        () => db.query('select * from public.activity_payment_settings'),
        /permission denied/,
      );
      await assert.rejects(
        () => db.query('select * from private.payment_qr_uploads'),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query(
            'insert into public.activity_payment_settings(activity_id) values($1)',
            [badminton],
          ),
        /permission denied/,
      );
    },
  );
  await t.test(
    'MIME, size and one-time exact upload path are enforced with no overwrite or arbitrary bucket',
    async () => {
      for (const [mime, size] of [
        ['image/svg+xml', 100],
        ['image/heic', 100],
        ['image/png', 0],
        ['image/png', 5242881],
        ['image/png', 1.5],
      ])
        await assert.rejects(
          () => call('prepare_payment_qr_upload', [badminton, mime, size, yen]),
          /ảnh|dung lượng/,
        );
      const p = await call('prepare_payment_qr_upload', [
        badminton,
        'image/png',
        100,
        yen,
      ]);
      assert.equal(p.bucket, 'payment-qrs');
      assert.match(p.path, /^qr\/[a-f0-9-]{36}\.png$/);
      await assert.rejects(
        () => insert({ ...p, path: 'qr/unknown.png' }),
        /row-level security/,
      );
      await assert.rejects(
        () => insert({ ...p, bucket: 'trip-covers' }),
        /row-level security/,
      );
      await assert.rejects(
        () => call('complete_payment_qr_upload', [p.path, yen]),
        /chưa xác nhận/,
      );
      await insert(p);
      await assert.rejects(() => insert(p), /row-level security|duplicate/);
      await assert.rejects(
        () => call('complete_payment_qr_upload', [p.path, hien]),
        /không được/,
      );
      await call('complete_payment_qr_upload', [p.path, yen]);
      firstPath = p.path;
      await assert.rejects(
        () =>
          db.query('update storage.objects set name=$1 where name=$2', [
            'qr/replaced.png',
            p.path,
          ]),
        /permission denied/,
      );
      await assert.rejects(
        () => db.query('delete from storage.objects where name=$1', [p.path]),
        /permission denied/,
      );
    },
  );
  await t.test(
    'Incomplete uploads and spoofed metadata cannot be assigned; account-only setup works',
    async () => {
      const missing = await call('prepare_payment_qr_upload', [
        badminton,
        'image/png',
        100,
        yen,
      ]);
      await assert.rejects(
        () =>
          call('save_activity_payment_settings', [
            badminton,
            { ...account, qr_path: missing.path },
            0,
            yen,
          ]),
        /chưa được tải/,
      );
      const wrong = await call('prepare_payment_qr_upload', [
        badminton,
        'image/png',
        100,
        yen,
      ]);
      await insert(wrong, { mimetype: 'image/jpeg', size: 100 });
      await assert.rejects(
        () => call('complete_payment_qr_upload', [wrong.path, yen]),
        /chưa xác nhận/,
      );
      await assert.rejects(
        () =>
          call('save_activity_payment_settings', [
            badminton,
            { qr_path: firstPath },
            0,
            yen,
          ]),
        /Nhập đủ/,
      );
      await assert.rejects(
        () =>
          call('save_activity_payment_settings', [
            badminton,
            { ...account, amount: 50000 },
            0,
            yen,
          ]),
        /không hợp lệ/,
      );
      await call('save_activity_payment_settings', [trip, account, 0, yen]);
      assert.equal((await activity(trip, hien)).payment.qr_path, null);
      assert.equal(
        (await activity(trip, hien)).payment.account_number,
        account.account_number,
      );
    },
  );
  await t.test(
    'Two verified identities see the same saved QR after fresh reads; guests receive no receiving account',
    async () => {
      const before = await snap(hien);
      await call('save_activity_payment_settings', [
        badminton,
        { ...account, qr_path: firstPath },
        0,
        yen,
      ]);
      const receiver = await activity(badminton, hien),
        reload = await activity(badminton, hien);
      assert.deepEqual(receiver.payment, reload.payment);
      assert.equal(receiver.payment.qr_path, firstPath);
      assert.equal(receiver.payment.account_number, '00123456789');
      assert.equal(receiver.can_regroup, false);
      assert.ok((await snap(hien)).revision > before.revision);
      const guest = await activity(badminton, null);
      assert.equal(guest.payment, undefined);
      assert.equal(guest.ledger, undefined);
      const app = await call('get_app_snapshot', [hien]);
      assert.equal(
        app.activities.activities.find((a: any) => a.id === badminton).payment
          .qr_path,
        firstPath,
      );
    },
  );
  await t.test(
    'Replacement is immutable; reuse across badminton/trip and detach do not change the other event or receipts',
    async () => {
      const second = await upload();
      await call('save_activity_payment_settings', [
        badminton,
        { qr_path: second },
        1,
        yen,
      ]);
      assert.equal((await activity(badminton, hien)).payment.qr_path, second);
      await call('save_activity_payment_settings', [
        trip,
        { qr_path: firstPath },
        1,
        yen,
      ]);
      assert.equal((await activity(trip, hien)).payment.qr_path, firstPath);
      await call('save_activity_payment_settings', [
        badminton,
        { qr_path: null },
        2,
        yen,
      ]);
      assert.equal((await activity(badminton, hien)).payment.qr_path, null);
      assert.equal((await activity(trip, hien)).payment.qr_path, firstPath);
      const library = await call('get_payment_qr_library', [badminton, yen]);
      assert.equal(library.length, 2);
      assert.ok(library.some((q: any) => q.path === second));
      assert.equal((await activity(badminton, hien)).ledger.length, 0);
      assert.equal((await activity(trip, hien)).ledger.length, 0);
    },
  );
  await t.test(
    'Stale versions reject with 409; revoked organizers and expired capabilities cannot finish uploads',
    async () => {
      await assert.rejects(
        () =>
          call('save_activity_payment_settings', [
            trip,
            { bank_name: 'Stale bank' },
            0,
            yen,
          ]),
        (e: any) => e.code === 'PT409',
      );
      const pending = await call('prepare_payment_qr_upload', [
        trip,
        'image/png',
        100,
        yen,
      ]);
      await asAdmin();
      const a = await activity(trip, null);
      await call('save_activity', [
        trip,
        { organizer_id: ids.Hiền },
        a.version,
        null,
      ]);
      await asGuest();
      assert.equal(await call('can_upload_payment_qr', [pending.path]), false);
      await assert.rejects(() => insert(pending), /row-level security/);
      await assert.rejects(
        () =>
          call('save_activity_payment_settings', [
            trip,
            { qr_path: null },
            2,
            yen,
          ]),
        /phụ trách/,
      );
      await call('save_activity_payment_settings', [
        trip,
        { qr_path: null },
        2,
        hien,
      ]);
      const expired = await call('prepare_payment_qr_upload', [
        badminton,
        'image/png',
        100,
        yen,
      ]);
      await db.exec('reset role');
      await db.query(
        "update private.payment_qr_uploads set expires_at=now()-interval '1 second' where path=$1",
        [expired.path],
      );
      await asGuest();
      await assert.rejects(() => insert(expired), /row-level security/);
    },
  );
  await t.test(
    'QR updates after finalization preserve frozen amounts; only an authorized explicit receipt marks payment',
    async () => {
      await call('save_activity_expense', [
        badminton,
        null,
        {
          name: 'Tiền sân',
          category: 'court',
          scope: 'group',
          group_id: (await activity(badminton, yen)).groups[0].id,
          actual: 80000,
          estimated: 80000,
        },
        null,
        '',
        yen,
      ]);
      await call('set_activity_fee_state', [
        badminton,
        'finalize',
        (await snap(yen)).revision,
        '',
        yen,
      ]);
      const before = await activity(badminton, hien);
      await call('save_activity_payment_settings', [
        badminton,
        { qr_path: firstPath },
        3,
        yen,
      ]);
      let after = await activity(badminton, hien);
      assert.deepEqual(after.calculation, before.calculation);
      assert.equal(after.fee_status, 'finalized');
      assert.equal(after.ledger.length, 0);
      await call('get_payment_qr_library', [badminton, yen]);
      await snap(hien);
      after = await activity(badminton, hien);
      assert.equal(after.ledger.length, 0);
      await assert.rejects(
        () =>
          call('record_activity_payment', [
            badminton,
            ids.Yến,
            'settle',
            null,
            randomUUID(),
            '',
            hien,
          ]),
        /phụ trách/,
      );
      await call('record_activity_payment', [
        badminton,
        ids.Yến,
        'settle',
        null,
        randomUUID(),
        'Đã kiểm tra giao dịch',
        yen,
      ]);
      await call('record_activity_payment', [
        badminton,
        ids.Yến,
        'settle',
        null,
        randomUUID(),
        'Bấm lại',
        yen,
      ]);
      after = await activity(badminton, hien);
      assert.equal(after.ledger.length, 1);
      assert.equal(after.ledger[0].amount, 80000);
    },
  );
  await t.test(
    'Migration rerun preserves uploaded images, saved payment settings and practical snapshot compatibility',
    async () => {
      const before = await activity(badminton, hien);
      await db.exec('reset role');
      await db.exec(
        await readFile(
          new URL(
            '../supabase/migrations/202611190003_activity_payment_qr.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await asGuest();
      const after = await activity(badminton, hien);
      assert.deepEqual(after.payment, before.payment);
      assert.deepEqual(after.ledger, before.ledger);
      assert.equal(typeof after.can_manage, 'boolean');
    },
  );
  await db.close();
});
