import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Trip cover upload permits: verified roles, scoped INSERT-only paths and bucket restrictions', async (t) => {
  const db = new PGlite(),
    admin = '10000000-0000-4000-8000-000000000001';
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
    await db.exec('reset role');
    await db.exec(
      "select set_config('request.jwt.claim.sub','',false);set role anon;",
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
  const trip = await call('create_club_activity', [
    'trip',
    'Chuyến có ảnh',
    [],
    { organizer_id: ids.Yến },
    null,
  ]);
  const insert = async (path: string, bucket = 'trip-covers') =>
    db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
      bucket,
      path,
    ]);
  await t.test(
    'Only authenticated admin can upload before creating a trip; existing organizer may use a personal code',
    async () => {
      const staged = await call('prepare_trip_cover_upload', [
        null,
        'image/jpeg',
        100,
        null,
      ]);
      assert.equal(staged.bucket, 'trip-covers');
      assert.match(staged.path, /^covers\/[a-f0-9-]+\.jpg$/);
      await asGuest();
      for (const token of [null, ids.Yến])
        await assert.rejects(
          () =>
            call('prepare_trip_cover_upload', [trip, 'image/png', 100, token]),
          /xác minh/,
        );
      await assert.rejects(
        () => call('prepare_trip_cover_upload', [null, 'image/png', 100, yen]),
        /quản trị/,
      );
      await assert.rejects(
        () => call('prepare_trip_cover_upload', [trip, 'image/png', 100, hien]),
        /phụ trách/,
      );
      const permit = await call('prepare_trip_cover_upload', [
        trip,
        'image/png',
        100,
        yen,
      ]);
      assert.match(permit.path, /\.png$/);
      assert.ok(Date.parse(permit.expires_at) > Date.now());
      await asAdmin();
    },
  );
  await t.test(
    'Bucket allows only 5 MB JPG/PNG/WebP; RPC rejects unsupported MIME and invalid size',
    async () => {
      await db.exec('reset role');
      const row = (
        await db.query<any>(
          "select * from storage.buckets where id='trip-covers'",
        )
      ).rows[0];
      assert.equal(row.public, true);
      assert.equal(Number(row.file_size_limit), 5242880);
      assert.deepEqual(row.allowed_mime_types, [
        'image/jpeg',
        'image/png',
        'image/webp',
      ]);
      await asGuest();
      for (const [mime, size] of [
        ['image/svg+xml', 10],
        ['image/heic', 10],
        ['image/jpeg', 0],
        ['image/png', 5242881],
        ['image/webp', 1.5],
      ])
        await assert.rejects(
          () => call('prepare_trip_cover_upload', [trip, mime, size, yen]),
          /ảnh|dung lượng/,
        );
      await assert.rejects(
        () => db.query('select * from private.trip_cover_uploads'),
        /permission denied/,
      );
      await asAdmin();
    },
  );
  await t.test(
    'Exact fresh path permits one INSERT, rejects unknown/bucket changes, expired paths and overwrite',
    async () => {
      await asGuest();
      const p = await call('prepare_trip_cover_upload', [
        trip,
        'image/webp',
        100,
        yen,
      ]);
      assert.equal(await call('can_upload_trip_cover', [p.path]), true);
      await assert.rejects(
        () => insert('covers/unknown.webp'),
        /row-level security/,
      );
      await db.exec('reset role');
      await db.exec(
        "insert into storage.buckets(id,name,public) values('other','other',true)",
      );
      await asGuest();
      await assert.rejects(() => insert(p.path, 'other'), /row-level security/);
      await insert(p.path);
      assert.equal(await call('can_upload_trip_cover', [p.path]), false);
      await assert.rejects(
        () => insert(p.path),
        /row-level security|duplicate key/,
      );
      await assert.rejects(
        () =>
          db.query('update storage.objects set name=$1 where name=$2', [
            'changed.webp',
            p.path,
          ]),
        /permission denied/,
      );
      await assert.rejects(
        () => db.query('delete from storage.objects where name=$1', [p.path]),
        /permission denied/,
      );
      const expired = await call('prepare_trip_cover_upload', [
        trip,
        'image/png',
        100,
        yen,
      ]);
      await db.exec('reset role');
      await db.query(
        "update private.trip_cover_uploads set expires_at=now()-interval '1 second' where path=$1",
        [expired.path],
      );
      await asGuest();
      assert.equal(await call('can_upload_trip_cover', [expired.path]), false);
      await assert.rejects(() => insert(expired.path), /row-level security/);
      await asAdmin();
    },
  );
  await t.test(
    'Reassigning a trip invalidates a former organizer permit; acknowledged URL persists and emits realtime revision',
    async () => {
      await asGuest();
      const p = await call('prepare_trip_cover_upload', [
        trip,
        'image/jpeg',
        100,
        yen,
      ]);
      await asAdmin();
      let snapshot = await call('get_activity_snapshot', [null]);
      let a = snapshot.activities.find((x: any) => x.id === trip);
      await call('save_activity', [
        trip,
        { organizer_id: ids.Hiền },
        a.version,
        null,
      ]);
      await asGuest();
      assert.equal(await call('can_upload_trip_cover', [p.path]), false);
      await assert.rejects(() => insert(p.path), /row-level security/);
      const valid = await call('prepare_trip_cover_upload', [
        trip,
        'image/jpeg',
        100,
        hien,
      ]);
      await insert(valid.path);
      snapshot = await call('get_activity_snapshot', [hien]);
      a = snapshot.activities.find((x: any) => x.id === trip);
      const before = snapshot.revision;
      const url = `https://example.supabase.co/storage/v1/object/public/trip-covers/${valid.path}`;
      await call('save_activity', [
        trip,
        { details: { cover_url: url } },
        a.version,
        hien,
      ]);
      const receiver = await call('get_activity_snapshot', [yen]);
      assert.equal(
        receiver.activities.find((x: any) => x.id === trip).details.cover_url,
        url,
      );
      assert.ok(receiver.revision > before);
      assert.equal(
        (await call('get_activity_snapshot', [yen])).activities.find(
          (x: any) => x.id === trip,
        ).details.cover_url,
        url,
      );
    },
  );
  await db.close();
});
