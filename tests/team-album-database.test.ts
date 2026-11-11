import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Team album: two anonymous clients, real PostgreSQL validation, Storage capabilities and reversible trash', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
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
    '202611110001_team_album.sql',
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
  const beforeLegacy = (
    await db.query<{
      members: number;
      sessions: number;
      histories: number;
      activities: number;
    }>(
      'select (select count(*)::integer from public.members) members,(select count(*)::integer from public.sessions) sessions,(select count(*)::integer from public.booking_history) histories,(select count(*)::integer from public.club_activities) activities',
    )
  ).rows[0];
  async function guest(client: 'A' | 'B' = 'A') {
    await db.exec('reset role');
    await db.query(
      "select set_config('request.jwt.claim.sub','',false),set_config('test.album_client',$1,false)",
      [client],
    );
    await db.exec('set role anon');
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
      await guest();
    }
  }
  function uploadArgs(
    album: string,
    operation = randomUUID(),
    changes: Record<string, unknown> = {},
  ) {
    const p = {
      album,
      operation,
      mime: 'image/jpeg',
      size: 123,
      thumbSize: 45,
      width: 1000,
      height: 750,
      filename: 'trận cầu.jpg',
      ...changes,
    };
    return [
      p.album,
      p.operation,
      p.mime,
      p.size,
      p.thumbSize,
      p.width,
      p.height,
      p.filename,
    ];
  }
  async function uploadObject(
    path: string,
    mime = 'image/jpeg',
    size = 123,
    bucket = 'team-album',
  ) {
    await db.query(
      'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',
      [bucket, path, { mimetype: mime, size }],
    );
  }
  async function photo(album: string, caption = 'Cả đội lên sân!') {
    const args = uploadArgs(album);
    const p = await call('prepare_team_album_upload', args);
    await uploadObject(p.original_path);
    await uploadObject(p.thumbnail_path, 'image/webp', 45);
    return call('finish_team_album_upload', [p.operation_id, caption]);
  }
  await guest();
  let album: any, another: any, first: any, second: any;

  await t.test(
    'A creates an album; B sees the persisted server result and metadata revision without login',
    async () => {
      const empty = await call('get_team_album_snapshot');
      assert.deepEqual(empty.albums, []);
      assert.deepEqual(empty.photos, []);
      assert.equal(empty.version, 1);
      assert.equal(empty.realtime_enabled, false); // PGlite has no Supabase publication.
      album = await call('save_team_album', [
        null,
        {
          title: '  Cầu lông tháng 11  ',
          description: 'Ảnh thật của cả đội',
          kind: 'badminton',
          event_date: '2026-11-11',
        },
        null,
      ]);
      assert.equal(album.title, 'Cầu lông tháng 11');
      assert.equal(album.version, 1);
      await guest('B');
      const b = await call('get_team_album_snapshot');
      assert.equal(b.albums[0].id, album.id);
      assert.equal(b.albums[0].event_date, '2026-11-11');
      assert.ok(b.revision > empty.revision);
      another = await call('save_team_album', [
        null,
        { title: 'Chuyến đi', kind: 'travel' },
        null,
      ]);
    },
  );

  await t.test(
    'Metadata patches validate field types, reject forged paths and preserve concurrent fields',
    async () => {
      for (const patch of [
        { title: '' },
        { title: 42 },
        { kind: 'space' },
        { description: null },
        { original_path: 'forged.jpg' },
        { title: 'x'.repeat(121) },
      ]) {
        await assert.rejects(() =>
          call('save_team_album', [album.id, patch, album.version]),
        );
      }
      await guest('A');
      const aEdit = await call('save_team_album', [
        album.id,
        { description: 'A bổ sung mô tả' },
        album.version,
      ]);
      await guest('B');
      await assert.rejects(
        () =>
          call('save_team_album', [
            album.id,
            { title: 'Sửa từ bản cũ' },
            album.version,
          ]),
        { code: 'PT409', message: /vừa được người khác sửa/ },
      );
      await assert.rejects(
        () =>
          call('save_team_album', [
            album.id,
            { title: 'Không gửi phiên bản' },
            null,
          ]),
        { code: 'PT409', message: /vừa được người khác sửa/ },
      );
      album = await call('save_team_album', [
        album.id,
        { title: 'Cầu lông và những người bạn' },
        aEdit.version,
      ]);
      assert.equal(album.description, 'A bổ sung mô tả');
      assert.equal(album.event_date, '2026-11-11');
    },
  );

  await t.test(
    'Bucket and upload preparation reject unsupported MIME, negative/fractional/oversized bytes and invalid dimensions',
    async () => {
      const [bucket] = await ownerQuery(
        "select * from storage.buckets where id='team-album'",
      );
      assert.equal(bucket.public, true);
      assert.equal(Number(bucket.file_size_limit), 15728640);
      assert.deepEqual(bucket.allowed_mime_types, [
        'image/jpeg',
        'image/png',
        'image/webp',
      ]);
      for (const changes of [
        { mime: 'image/svg+xml' },
        { mime: 'image/heic' },
        { size: 0 },
        { size: -1 },
        { size: 1.1 },
        { size: 15728641 },
        { thumbSize: 1048577 },
        { thumbSize: 0 },
        { width: 0 },
        { height: 50001 },
        { filename: '' },
        { filename: 'a'.repeat(256) },
      ])
        await assert.rejects(() =>
          call(
            'prepare_team_album_upload',
            uploadArgs(album.id, randomUUID(), changes),
          ),
        );
      await assert.rejects(
        () => call('prepare_team_album_upload', uploadArgs(randomUUID())),
        /không tồn tại/,
      );
    },
  );

  await t.test(
    'Each permit authorizes two exact INSERT-only paths; unknown paths, overwrite and cross-bucket upload fail',
    async () => {
      const p = await call('prepare_team_album_upload', uploadArgs(album.id));
      assert.equal(p.bucket, 'team-album');
      assert.match(p.original_path, /^originals\/[a-f0-9-]+\.jpg$/);
      assert.match(p.thumbnail_path, /^thumbnails\/[a-f0-9-]+\.webp$/);
      assert.equal(p.original_exists, false);
      assert.equal(p.thumbnail_exists, false);
      assert.ok(Date.parse(p.expires_at) > Date.now());
      assert.equal(
        await call('can_upload_team_album', [p.original_path]),
        true,
      );
      await assert.rejects(
        () => uploadObject('originals/no-permit.jpg'),
        /row-level security/,
      );
      await assert.rejects(
        () => uploadObject(p.original_path, 'image/jpeg', 123, 'trip-covers'),
        /row-level security/,
      );
      await uploadObject(p.original_path);
      assert.equal(
        await call('can_upload_team_album', [p.original_path]),
        false,
      );
      await assert.rejects(
        () => uploadObject(p.original_path),
        /row-level security|duplicate key/,
      );
      await assert.rejects(
        () =>
          db.query('update storage.objects set metadata=$1 where name=$2', [
            { size: 3 },
            p.original_path,
          ]),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query('delete from storage.objects where name=$1', [
            p.original_path,
          ]),
        /permission denied/,
      );
      await assert.rejects(
        () => db.query('select * from private.team_album_uploads'),
        /permission denied/,
      );
      await assert.rejects(
        () => db.query('select * from private.team_album_history'),
        /permission denied/,
      );
    },
  );

  await t.test(
    'Interrupted upload retries reuse paths and refresh expiry; finish requires both acknowledged files and is idempotent',
    async () => {
      const args = uploadArgs(album.id);
      const p = await call('prepare_team_album_upload', args);
      await assert.rejects(
        () => call('finish_team_album_upload', [p.operation_id, 'chưa tải']),
        /chưa tải xong/,
      );
      await uploadObject(p.original_path);
      await assert.rejects(
        () =>
          call('finish_team_album_upload', [p.operation_id, 'mới có ảnh gốc']),
        /chưa tải xong/,
      );
      await ownerQuery(
        "update private.team_album_uploads set expires_at=now()-interval '1 second' where operation_id=$1",
        [p.operation_id],
      );
      assert.equal(
        await call('can_upload_team_album', [p.thumbnail_path]),
        false,
      );
      await assert.rejects(
        () => uploadObject(p.thumbnail_path, 'image/webp', 45),
        /row-level security/,
      );
      const resumed = await call('prepare_team_album_upload', args);
      assert.equal(resumed.original_path, p.original_path);
      assert.equal(resumed.thumbnail_path, p.thumbnail_path);
      assert.equal(resumed.original_exists, true);
      assert.equal(resumed.thumbnail_exists, false);
      await uploadObject(p.thumbnail_path, 'image/webp', 45);
      const before = await call('get_team_album_snapshot');
      first = await call('finish_team_album_upload', [
        p.operation_id,
        'Cả đội vui hết mình',
      ]);
      await guest('B');
      const repeated = await call('finish_team_album_upload', [
        p.operation_id,
        'Không được ghi đè khi thử lại',
      ]);
      const after = await call('get_team_album_snapshot');
      assert.equal(first.id, p.photo_id);
      assert.equal(repeated.id, first.id);
      assert.equal(repeated.caption, 'Cả đội vui hết mình');
      assert.equal(
        after.photos.filter((x: any) => x.id === first.id).length,
        1,
      );
      assert.equal(after.revision, before.revision + 1);
      await ownerQuery(
        "update private.team_album_uploads set expires_at=now()-interval '1 second' where operation_id=$1",
        [p.operation_id],
      );
      const finishedPermit = await call('prepare_team_album_upload', args);
      assert.equal(finishedPermit.original_exists, true);
      assert.equal(finishedPermit.thumbnail_exists, true);
      assert.ok(Date.parse(finishedPermit.expires_at) > Date.now());
      await assert.rejects(
        () =>
          call(
            'prepare_team_album_upload',
            uploadArgs(album.id, p.operation_id, { filename: 'ảnh-khác.jpg' }),
          ),
        /ảnh khác/,
      );
    },
  );

  await t.test(
    'Finishing checks actual Storage metadata; stale, missing or mismatched files never become published photo rows',
    async () => {
      for (const [mime, size] of [
        ['image/png', 123],
        ['image/jpeg', 124],
      ] as const) {
        const p = await call('prepare_team_album_upload', uploadArgs(album.id));
        await uploadObject(p.original_path, mime, size);
        await uploadObject(p.thumbnail_path, 'image/webp', 45);
        await assert.rejects(
          () =>
            call('finish_team_album_upload', [p.operation_id, 'không hợp lệ']),
          /không khớp/,
        );
        assert.equal(
          (await call('get_team_album_snapshot')).photos.some(
            (x: any) => x.id === p.photo_id,
          ),
          false,
        );
      }
      const p = await call('prepare_team_album_upload', uploadArgs(album.id));
      await uploadObject(p.original_path);
      await uploadObject(p.thumbnail_path, 'image/png', 45);
      await assert.rejects(
        () =>
          call('finish_team_album_upload', [p.operation_id, 'thumbnail sai']),
        /không khớp/,
      );
    },
  );

  await t.test(
    'B edits a caption; A sees it after a fresh read, stale editors get a conflict, original paths remain immutable',
    async () => {
      await guest('B');
      const edited = await call('save_team_album_photo', [
        first.id,
        { caption: 'B cập nhật: trận đôi cuối buổi' },
        first.version,
      ]);
      await guest('A');
      await assert.rejects(
        () =>
          call('save_team_album_photo', [
            first.id,
            { caption: 'Ghi đè từ bản cũ' },
            first.version,
          ]),
        { code: 'PT409', message: /vừa được người khác sửa/ },
      );
      await assert.rejects(
        () =>
          call('save_team_album_photo', [
            first.id,
            { caption: 42 },
            edited.version,
          ]),
        /Chỉ được sửa/,
      );
      await assert.rejects(() =>
        call('save_team_album_photo', [
          first.id,
          { caption: 'x'.repeat(2001) },
          edited.version,
        ]),
      );
      await assert.rejects(
        () =>
          call('save_team_album_photo', [
            first.id,
            { original_path: 'forged.jpg' },
            edited.version,
          ]),
        /Chỉ được sửa/,
      );
      const view = (await call('get_team_album_snapshot')).photos.find(
        (x: any) => x.id === first.id,
      );
      assert.equal(view.caption, edited.caption);
      assert.equal(view.original_path, first.original_path);
      first = view;
    },
  );

  await t.test(
    'Cover selection validates ownership and active state; trashing a cover clears it and leaves originals untouched',
    async () => {
      second = await photo(album.id, 'Ảnh thứ hai');
      const foreign = await photo(another.id, 'Ảnh chuyến đi');
      await assert.rejects(
        () =>
          call('save_team_album', [
            album.id,
            { cover_photo_id: foreign.id },
            album.version,
          ]),
        /chính album/,
      );
      album = await call('save_team_album', [
        album.id,
        { cover_photo_id: second.id },
        album.version,
      ]);
      assert.equal(album.cover_photo_id, second.id);
      const before = await call('get_team_album_snapshot');
      second = await call('set_team_album_photo_deleted', [
        second.id,
        true,
        second.version,
      ]);
      const after = await call('get_team_album_snapshot');
      album = after.albums.find((x: any) => x.id === album.id);
      assert.equal(album.cover_photo_id, null);
      assert.ok(second.deleted_at);
      assert.equal(after.revision, before.revision + 2);
      await assert.rejects(
        () =>
          call('save_team_album', [
            album.id,
            { cover_photo_id: second.id },
            album.version,
          ]),
        /còn hoạt động/,
      );
      const [objects] = await ownerQuery(
        'select count(*)::integer total from storage.objects where name in ($1,$2)',
        [second.original_path, second.thumbnail_path],
      );
      assert.equal(objects.total, 2);
    },
  );

  await t.test(
    'Album trash prevents edits/new uploads; restore preserves individually trashed photos and metadata',
    async () => {
      const staged = await call(
        'prepare_team_album_upload',
        uploadArgs(album.id),
      );
      await uploadObject(staged.original_path);
      await uploadObject(staged.thumbnail_path, 'image/webp', 45);
      const oldVersion = album.version;
      await guest('B');
      album = await call('set_team_album_deleted', [
        album.id,
        true,
        album.version,
      ]);
      await guest('A');
      assert.ok(
        (await call('get_team_album_snapshot')).albums.find(
          (x: any) => x.id === album.id,
        ).deleted_at,
      );
      await assert.rejects(
        () => call('set_team_album_deleted', [album.id, false, oldVersion]),
        { code: 'PT409', message: /vừa thay đổi/ },
      );
      await assert.rejects(
        () => call('prepare_team_album_upload', uploadArgs(album.id)),
        /Thùng rác/,
      );
      assert.equal(
        await call('can_upload_team_album', [staged.thumbnail_path]),
        false,
      );
      await assert.rejects(
        () =>
          call('finish_team_album_upload', [
            staged.operation_id,
            'album đang xóa',
          ]),
        /Thùng rác/,
      );
      await assert.rejects(
        () =>
          call('save_team_album', [
            album.id,
            { title: 'Sửa trong thùng rác' },
            album.version,
          ]),
        /Thùng rác/,
      );
      await assert.rejects(
        () =>
          call('save_team_album_photo', [
            first.id,
            { caption: 'Sửa trong thùng rác' },
            first.version,
          ]),
        /Thùng rác/,
      );
      await assert.rejects(
        () =>
          call('set_team_album_photo_deleted', [
            second.id,
            false,
            second.version,
          ]),
        /khôi phục album/,
      );
      album = await call('set_team_album_deleted', [
        album.id,
        false,
        album.version,
      ]);
      const restored = await call('get_team_album_snapshot');
      assert.equal(
        restored.photos.find((x: any) => x.id === first.id).deleted_at,
        null,
      );
      assert.ok(
        restored.photos.find((x: any) => x.id === second.id).deleted_at,
      );
      assert.equal(
        restored.photos.find((x: any) => x.id === first.id).caption,
        first.caption,
      );
      second = await call('set_team_album_photo_deleted', [
        second.id,
        false,
        second.version,
      ]);
      assert.equal(second.deleted_at, null);
      const before = await call('get_team_album_snapshot');
      await call('set_team_album_photo_deleted', [
        second.id,
        false,
        second.version,
      ]);
      assert.equal(
        (await call('get_team_album_snapshot')).revision,
        before.revision,
      );
      await call('finish_team_album_upload', [
        staged.operation_id,
        'Tiếp tục sau khôi phục',
      ]);
    },
  );

  await t.test(
    'Guest openness stays confined to album RPCs; raw writes, finance/member rights and audit tampering remain denied',
    async () => {
      await assert.rejects(
        () =>
          db.query("insert into public.team_albums(title) values('bypass')"),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query(
            'update public.team_album_photos set caption=$1 where id=$2',
            ['bypass', first.id],
          ),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query('delete from public.team_albums where id=$1', [album.id]),
        /permission denied/,
      );
      await assert.rejects(
        () => db.query('update public.team_album_sync set revision=0'),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          call('save_member', [
            null,
            { display_name: 'Không được thêm' },
            null,
          ]),
        /permission denied|quản trị/,
      );
      await assert.rejects(
        () =>
          call('record_activity_payment', [
            randomUUID(),
            randomUUID(),
            'contribution',
            123,
            randomUUID(),
            '',
            null,
          ]),
        /xác minh/,
      );
      const [after] = await ownerQuery(
        'select (select count(*)::integer from public.members) members,(select count(*)::integer from public.sessions) sessions,(select count(*)::integer from public.booking_history) histories,(select count(*)::integer from public.club_activities) activities',
      );
      assert.deepEqual(after, beforeLegacy);
      const rows = await ownerQuery(
        'select action,before_data,after_data from private.team_album_history where record_id=$1 order by id',
        [second.id],
      );
      assert.deepEqual(
        rows.map((x: any) => x.action),
        ['created', 'trashed', 'restored'],
      );
      assert.equal(rows[1].before_data.deleted_at, null);
      assert.ok(rows[1].after_data.deleted_at);
      assert.equal(rows[2].after_data.deleted_at, null);
    },
  );

  await t.test(
    'All exposed business conflict RPCs return PT409, never serialization SQLSTATE 40001',
    async () => {
      const current = await call('get_team_album_snapshot');
      const a = current.albums.find((row: any) => row.id === album.id);
      const p = current.photos.find((row: any) => row.id === first.id);
      for (const [name, args] of [
        ['save_team_album', [a.id, { title: 'Phiên bản cũ' }, a.version - 1]],
        [
          'save_team_album_photo',
          [p.id, { caption: 'Phiên bản cũ' }, p.version - 1],
        ],
        ['set_team_album_deleted', [a.id, true, a.version - 1]],
        ['set_team_album_photo_deleted', [p.id, true, p.version - 1]],
      ] as [string, unknown[]][]) {
        await assert.rejects(() => call(name, args), { code: 'PT409' });
      }
      const definitions = await ownerQuery<{ name: string; source: string }>(
        "select proname name,pg_get_functiondef(oid) source from pg_proc where pronamespace='public'::regnamespace and proname in ('save_team_album','save_team_album_photo','set_team_album_deleted','set_team_album_photo_deleted')",
      );
      assert.equal(definitions.length, 4);
      for (const definition of definitions) {
        assert.equal(
          definition.source.includes('40001'),
          false,
          definition.name,
        );
        assert.ok(definition.source.includes('PT409'), definition.name);
      }
      assert.deepEqual(await call('get_team_album_snapshot'), current);
    },
  );

  await t.test(
    'Conflict hotfix upgrades only four album RPC definitions, preserves grants/data and is idempotent',
    async () => {
      const before = await call('get_team_album_snapshot');
      const [legacyBefore] = await ownerQuery<{ source: string }>(
        "select pg_get_functiondef('public.save_session(uuid,jsonb,integer)'::regprocedure) source",
      );
      const definitions = await ownerQuery<{ source: string }>(
        "select pg_get_functiondef(oid) source from pg_proc where pronamespace='public'::regnamespace and proname in ('save_team_album','save_team_album_photo','set_team_album_deleted','set_team_album_photo_deleted')",
      );
      await db.exec('reset role');
      // Reproduce the already-deployed version without ever invoking a stale
      // 40001 request through an HTTP server that could retry indefinitely.
      for (const definition of definitions)
        await db.exec(definition.source.replaceAll('PT409', '40001'));
      const upgrade = await readFile(
        new URL(
          '../supabase/migrations/202611110002_album_conflict_http.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await db.exec(upgrade);
      await db.exec(upgrade);
      const after = await db.query<{
        source: string;
        guest: boolean;
        authenticated: boolean;
      }>(
        "select pg_get_functiondef(oid) source,has_function_privilege('anon',oid,'EXECUTE') guest,has_function_privilege('authenticated',oid,'EXECUTE') authenticated from pg_proc where pronamespace='public'::regnamespace and proname in ('save_team_album','save_team_album_photo','set_team_album_deleted','set_team_album_photo_deleted')",
      );
      assert.equal(after.rows.length, 4);
      for (const row of after.rows) {
        assert.equal(row.source.includes('40001'), false);
        assert.ok(row.source.includes('PT409'));
        assert.equal(row.guest, true);
        assert.equal(row.authenticated, true);
      }
      const legacyAfter = (
        await db.query<{ source: string }>(
          "select pg_get_functiondef('public.save_session(uuid,jsonb,integer)'::regprocedure) source",
        )
      ).rows[0];
      assert.equal(legacyAfter.source, legacyBefore.source);
      await guest('B');
      assert.deepEqual(await call('get_team_album_snapshot'), before);
      const a = before.albums.find((row: any) => row.id === album.id);
      await assert.rejects(
        () =>
          call('save_team_album', [
            a.id,
            { title: 'Sửa từ bản cũ' },
            a.version - 1,
          ]),
        { code: 'PT409' },
      );
    },
  );

  await t.test(
    'Authenticated visitors have exactly the same album access; migration rerun preserves existing content and revision',
    async () => {
      await db.exec('reset role;set role authenticated');
      const before = await call('get_team_album_snapshot');
      await db.exec('reset role');
      const sql = await readFile(
        new URL(
          '../supabase/migrations/202611110001_team_album.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await db.exec(sql.split('-- REALTIME:')[0]);
      await guest('B');
      const after = await call('get_team_album_snapshot');
      assert.deepEqual(after, before);
      assert.ok(after.photos.length >= 4);
    },
  );
});
