// Read-only on the real backend. Replay public facts into temporary in-memory
// PostgreSQL to test the new migration without modifying any group data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';
import type { QuickSnapshot } from '../src/types';
import type { BookingData } from '../src/bookingTypes';
import { answerLookup } from '../supabase/functions/_shared/chat/lookup';
import {
  contextSources,
  planQuestion,
} from '../supabase/functions/_shared/chat/intent';
import type { ChatContext } from '../supabase/functions/_shared/chat/types';

function lookup(facts: ChatContext, message: string) {
  const q = {
    message,
    history: [],
    memberId: null,
    bookingToken: null,
    sessionId: null,
    activityId: null,
  };
  const plan = planQuestion(q);
  return answerLookup(q, plan, facts, contextSources(facts, plan));
}

const env = loadEnv('development', process.cwd(), 'VITE_');
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY)
  throw new Error('Cần cấu hình Supabase thật trong .env.');
const client = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const live = await client
  .rpc('get_quick_snapshot')
  .abortSignal(AbortSignal.timeout(20000));
if (live.error)
  throw new Error('Không đọc được dữ liệu thật: ' + live.error.message);
const source = live.data as QuickSnapshot;
const bookingResult = await client
  .rpc('get_booking_snapshot', { p_token: null })
  .abortSignal(AbortSignal.timeout(20000));
if (bookingResult.error)
  throw new Error(
    'Không đọc được phân công thật: ' + bookingResult.error.message,
  );
const booking = bookingResult.data as BookingData;
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  async function migrate(name: string) {
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
  await migrate('202611090001_initial.sql');
  await migrate('202611100001_quick_registration.sql');
  await db.exec('truncate public.members cascade');
  for (const member of source.members)
    await db.query(
      'insert into public.members(id,code,display_name,active,version) values($1,$2,$3,$4,$5)',
      [
        member.id,
        member.code,
        member.display_name,
        member.active,
        member.version,
      ],
    );
  await migrate('202611100002_booking_responsibility.sql');
  await db.exec(
    "select set_config('app.booking_system','true',false); truncate public.weekly_booking_assignments cascade;",
  );
  for (const a of booking.assignments)
    await db.query(
      'insert into public.weekly_booking_assignments(id,week_start,member_id,original_member_id,version) values($1,$2,$3,$4,$5)',
      [a.id, a.week_start, a.member_id, a.original_member_id, a.version],
    );
  for (const s of source.sessions)
    await db.query(
      `insert into public.sessions(id,session_date,start_time,end_time,venue,court,address,maps_url,organizer_id,organizer_mode,booking_status,max_players,deadline,booked_by_member_id,estimated_cost,version)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        s.id,
        s.session_date,
        s.start_time,
        s.end_time,
        s.venue,
        s.court,
        s.address,
        s.maps_url,
        s.organizer_id,
        s.organizer_mode ?? 'weekly',
        s.booking_status,
        s.max_players,
        s.deadline,
        s.booked_by_member_id ?? null,
        s.estimated_cost ?? null,
        s.version,
      ],
    );
  for (const a of source.attendance)
    await db.query(
      'insert into public.attendance(id,session_id,member_id,status) values($1,$2,$3,$4)',
      [a.id, a.session_id, a.member_id, a.status],
    );
  await db.exec("select set_config('app.booking_system','false',false)");
  for (const name of [
    '202611100003_finance_travel.sql',
    '202611100004_auto_fees_and_covers.sql',
    '202611190002_club_chat.sql',
  ])
    await migrate(name);
  async function context(
    sid: string | null = null,
    scope = 'schedule',
    start = '2026-11-19',
    end = start,
  ) {
    return (
      await db.query<{ r: any }>(
        'select public.get_chat_context($1,$2::date,$3::date,null,$4::uuid) r',
        [scope, start, end, sid],
      )
    ).rows[0].r;
  }
  const checks = source.sessions.slice(-30);
  for (const s of checks) {
    const result = await context(s.id);
    const fact = result.sessions[0];
    assert.equal(fact.id, s.id);
    assert.equal(fact.date, s.session_date);
    assert.equal(fact.start_time, s.start_time);
    assert.equal(fact.venue, s.venue);
    assert.equal(fact.booking_status, s.booking_status);
    const answer = lookup(result, 'Lịch buổi này?');
    assert.ok(answer.answer.includes(s.venue.slice(0, 110)));
    assert.ok(answer.source_ids.includes(s.id));
    assert.ok(answer.answer.length <= 4000);
    if (s.booking_status === 'cancelled') {
      assert.match(answer.answer, /ĐÃ HỦY/);
      assert.doesNotMatch(answer.answer, /Còn \d+ chỗ/);
    }
    const going = source.attendance.filter(
      (a) => a.session_id === s.id && a.status === 'going',
    ).length;
    assert.equal(fact.registered_count, going);
    assert.equal(
      fact.remaining_places,
      s.booking_status === 'cancelled' || s.max_players == null
        ? null
        : Math.max(0, s.max_players - going),
    );
  }
  if (checks[0]) {
    const s = checks[0];
    await db.query(
      "update public.sessions set venue='Sân đổi trong bản kiểm thử cục bộ' where id=$1",
      [s.id],
    );
    assert.equal(
      (await context(s.id)).sessions[0].venue,
      'Sân đổi trong bản kiểm thử cục bộ',
    );
  }
  const week = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const publicBooking = await context(null, 'booking', week, week);
  const actual = booking.assignments.filter(
    (a) => a.week_start <= week && a.week_end >= week,
  );
  assert.equal(publicBooking.assignments.length, actual.length);
  for (const a of actual)
    assert.equal(
      publicBooking.assignments.find((x: any) => x.week_start === a.week_start)
        .organizer,
      source.members.find((m) => m.id === a.member_id)?.display_name,
    );
  assert.equal(
    (await context('00000000-0000-4000-8000-000000000000')).total_matches,
    0,
  );
  console.log(
    `Đã đọc Supabase thật: ${source.members.length} thành viên, ${source.sessions.length} buổi, ${source.attendance.length} đăng ký.`,
  );
  console.log(
    `Đối chiếu đạt ${checks.length} buổi thật; ${checks.filter((s) => s.booking_status === 'cancelled').length} buổi đã hủy. Phân công tuần hiện tại khớp dữ liệu thật.`,
  );
  console.log(
    'Lịch thay đổi và bản ghi không tồn tại: đã kiểm tra trong bản sao PostgreSQL tạm; không ghi lên Supabase thật.',
  );
  const probe = await client
    .rpc('get_chat_context', {
      p_scope: 'schedule',
      p_start: week,
      p_end: week,
      p_personal: false,
      p_all_balances: false,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (probe.error?.code === 'PGRST202' || probe.error?.code === '42883')
    console.log(
      'Supabase thật CHƯA cài migration chatbot. Chưa nghiệm thu endpoint/model hoặc tài chính đã xác minh trên production.',
    );
  else if (probe.error)
    throw new Error('API chatbot thật lỗi: ' + probe.error.message);
  else {
    assert.equal(probe.data.version, 1);
    const reply = lookup(probe.data, 'Lịch hôm nay?');
    assert.ok(reply.answer.trim() && reply.answer.length <= 4000);
    console.log(
      'RPC chatbot thật và bộ trả lời miễn phí tra cứu công khai thành công; không gọi mô hình AI.',
    );
  }
} finally {
  await db.close();
}
