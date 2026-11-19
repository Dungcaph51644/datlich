import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatHandler } from '../supabase/functions/_shared/chat/handler';
import { answerLookup } from '../supabase/functions/_shared/chat/lookup';
import {
  contextSources,
  planQuestion,
} from '../supabase/functions/_shared/chat/intent';
import { parseChatReply } from '../src/chatClient';
import type {
  ChatContext,
  ChatQuestion,
} from '../supabase/functions/_shared/chat/types';

const member = '10000000-0000-4000-8000-000000000001';
const now = new Date('2026-11-19T04:00:00Z');
const question = (message: string, history: string[] = []): ChatQuestion => ({
  message,
  history,
  memberId: member,
  bookingToken: null,
  sessionId: null,
  activityId: null,
});
const base: ChatContext = {
  version: 1,
  checked_at: now.toISOString(),
  scope: 'schedule',
  selected_member: { id: member, name: 'Yến', code: 'CL-1' },
  needs_member: false,
  finance_authorized: true,
  limited: false,
};
const session = {
  id: 'session',
  date: '2026-11-17',
  start_time: '18:00:00',
  end_time: '20:00:00',
  venue: 'Sân A',
  court: 'Ca 1',
  booking_status: 'booked',
  registration_closed: false,
  registered_count: 6,
  max_players: 8,
  remaining_places: 2,
  organizer: 'Yến',
  actual_booker: null,
  registered_names: ['Yến', 'Hiền'],
  my_status: 'going',
};
const activity = {
  id: 'activity',
  kind: 'badminton',
  title: 'Buổi thứ Ba',
  session_dates: ['2026-11-17'],
  status: 'open',
  fee_status: 'finalized',
  calculation_available: true,
  has_expenses: true,
  total_cost: 360000,
  warnings: [],
  people: [{ name: 'Yến', due: 180000, net_paid: 80000, balance: 100000 }],
  expenses: [
    { name: 'Tiền sân', actual: 300000, scope: 'group', group: 'Ca 1' },
    { name: 'Tiền cầu', actual: 60000, scope: 'all' },
  ],
};
const lookup = (
  message: string,
  facts: Partial<ChatContext>,
  history: string[] = [],
) => {
  const q = question(message, history);
  const plan = planQuestion(q, now);
  const context = { ...base, ...facts };
  return answerLookup(q, plan, context, contextSources(context, plan));
};
const env = {
  SUPABASE_URL: 'https://club.supabase.co',
  SUPABASE_ANON_KEY: 'public',
  SUPABASE_SERVICE_ROLE_KEY: 'private-server-key',
  CHAT_ALLOWED_ORIGINS: 'https://caulongteam.netlify.app',
};
const request = (body: unknown) =>
  new Request('https://club.supabase.co/functions/v1/club-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://caulongteam.netlify.app',
      Authorization: 'Bearer member.jwt.signature',
    },
    body: JSON.stringify(body),
  });

test('Free mode defaults to lookup, needs no API key, reads fresh facts and never calls a model even with an old key', async () => {
  for (const configured of [false, true]) {
    const calls: string[] = [];
    let venue = 'Sân A';
    const handler = createChatHandler(
      {
        ...env,
        ...(configured
          ? { AI_PROVIDER: 'lookup', OPENAI_API_KEY: 'unused-old-key' }
          : {}),
      },
      {
        now: () => now,
        model: {
          async answer() {
            assert.fail('Free mode must not call a model');
          },
        },
        fetch: async (url, options) => {
          const name = String(url).split('/').at(-1)!;
          calls.push(name);
          const headers = new Headers(options?.headers);
          if (name === 'get_chat_context') {
            assert.equal(headers.get('apikey'), 'public');
            assert.equal(
              headers.get('authorization'),
              'Bearer member.jwt.signature',
            );
            assert.equal(
              JSON.parse(String(options?.body)).p_token,
              'a'.repeat(64),
            );
            return Response.json({
              ...base,
              sessions: [{ ...session, venue }],
            });
          }
          assert.equal(
            name,
            'reserve_chat_request',
            'Only scoped database RPCs are allowed',
          );
          assert.equal(headers.get('apikey'), 'private-server-key');
          return Response.json({ allowed: true, retry_after: 0 });
        },
      },
    );
    const body = {
      message: 'Buổi thứ Ba còn mấy chỗ?',
      memberId: member,
      bookingToken: 'a'.repeat(64),
    };
    const first = parseChatReply(await (await handler(request(body))).json());
    assert.equal(first.mode, 'lookup');
    assert.match(first.answer, /Còn 2 chỗ/);
    assert.doesNotMatch(
      first.answer,
      /unused-old-key|private-server-key|member.jwt|aaaaa/,
    );
    venue = 'Sân mới';
    const updated = parseChatReply(await (await handler(request(body))).json());
    assert.match(updated.answer, /Sân mới/);
    assert.notEqual(updated.answer, first.answer);
    assert.deepEqual(calls, [
      'get_chat_context',
      'reserve_chat_request',
      'get_chat_context',
      'reserve_chat_request',
    ]);
    assert.ok(updated.sources[0].href.startsWith('#schedule?session='));
  }
});

test('Free lookup retains name selection, verified financial permissions, query failures and request limits', async () => {
  let kind = 'denied',
    calls = 0;
  const handler = createChatHandler(env, {
    now: () => now,
    fetch: async (url) => {
      calls++;
      if (kind === 'failure')
        return new Response('private SQL text', { status: 500 });
      if (String(url).endsWith('reserve_chat_request'))
        return Response.json({ allowed: false, retry_after: 20 });
      return Response.json({
        ...base,
        finance_authorized: kind !== 'denied',
        activities: [activity],
      });
    },
  });
  const missing = await (
    await handler(request({ message: 'Tôi còn thiếu bao nhiêu?' }))
  ).json();
  assert.equal(missing.needsMember, true);
  assert.equal(calls, 0);
  const denied = await (
    await handler(
      request({ message: 'Tôi còn thiếu bao nhiêu?', memberId: member }),
    )
  ).json();
  assert.equal(denied.needsVerification, true);
  assert.doesNotMatch(denied.answer, /100\.000|180\.000/);
  assert.equal(calls, 1);
  kind = 'failure';
  const failure = await handler(request({ message: 'Lịch tuần này?' }));
  assert.equal(failure.status, 502);
  assert.doesNotMatch(JSON.stringify(await failure.json()), /private SQL text/);
  kind = 'limited';
  const limited = await handler(request({ message: 'Lịch tuần này?' }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '20');
  const unknownProvider = createChatHandler(
    { ...env, AI_PROVIDER: 'lookpu' },
    {
      fetch: async () => {
        assert.fail('Invalid configuration must not call external services');
      },
    },
  );
  assert.equal(
    (await unknownProvider(request({ message: 'Lịch?' }))).status,
    503,
  );
});

test('Cancelled, closed, unlimited and missing sessions never invent available places or a real booker', () => {
  const cancelled = lookup('Buổi thứ Ba còn mấy chỗ?', {
    sessions: [
      { ...session, booking_status: 'cancelled', remaining_places: null },
    ],
  });
  assert.match(cancelled.answer, /17\/11\/2026.*ĐÃ HỦY/s);
  assert.doesNotMatch(cancelled.answer, /Còn \d+ chỗ/);
  const closed = lookup('Buổi thứ Ba còn mấy chỗ?', {
    sessions: [{ ...session, registration_closed: true }],
  });
  assert.match(closed.answer, /Đã khóa/);
  assert.doesNotMatch(closed.answer, /Còn \d+ chỗ/);
  const unlimited = lookup('Buổi thứ Ba còn mấy chỗ?', {
    sessions: [{ ...session, max_players: null, remaining_places: null }],
  });
  assert.match(unlimited.answer, /Chưa đặt giới hạn/);
  const booking = lookup('Ai đặt sân tuần sau?', {
    sessions: [session],
    assignments: [
      { week_start: '2026-11-23', week_end: '2026-11-29', organizer: 'Hiền' },
    ],
  });
  assert.match(booking.answer, /Hiền phụ trách/);
  assert.match(booking.answer, /Chưa ghi nhận người thực tế đặt sân/);
  const empty = lookup('Lịch tuần này?', { sessions: [] });
  assert.match(empty.answer, /Chưa có buổi đánh được lưu/);
  assert.doesNotMatch(empty.answer, /18:00|Sân A/);
});

test('Personal money uses finalized net receipts and refunds, excludes draft amounts from totals and never claims bank confirmation', () => {
  const result = lookup('Tôi còn thiếu bao nhiêu?', {
    activities: [
      activity,
      {
        ...activity,
        id: 'draft',
        fee_status: 'draft',
        people: [{ name: 'Yến', due: 60000, net_paid: 0, balance: 60000 }],
      },
    ],
  });
  assert.match(result.answer, /còn thiếu 100\.000đ; cần hoàn 0đ/);
  assert.match(result.answer, /thu ròng đã ghi nhận 80\.000đ/);
  assert.match(result.answer, /60\.000đ \(TẠM TÍNH, chưa phải nợ đã chốt\)/);
  assert.match(result.answer, /không xác nhận giao dịch ngân hàng/);
  const refund = lookup('Tôi còn thiếu bao nhiêu?', {
    activities: [
      {
        ...activity,
        people: [
          { name: 'Yến', due: 180000, net_paid: 200000, balance: -20000 },
        ],
      },
    ],
  });
  assert.match(refund.answer, /còn thiếu 0đ; cần hoàn 20\.000đ/);
  assert.ok(result.source_ids.includes('activity'));
});

test('Incomplete, limited or draft-only fees never become zero debt; expense scope is explained without dividing again', () => {
  for (const facts of [
    { activities: [{ ...activity, has_expenses: false }] },
    { activities: [{ ...activity, calculation_available: false }] },
    { activities: [{ ...activity, people_limited: true }] },
    { activities: [{ ...activity, people: [] }] },
    { activities: [activity], limited: true },
  ]) {
    const answer = lookup('Tôi còn thiếu bao nhiêu?', facts).answer;
    assert.match(answer, /Chưa đủ dữ liệu để cộng tổng/);
    assert.doesNotMatch(answer, /Theo các bảng ĐÃ CHỐT/);
  }
  const draft = lookup('Tôi còn thiếu bao nhiêu?', {
    activities: [{ ...activity, fee_status: 'draft' }],
  });
  assert.match(draft.answer, /Chưa có bảng ĐÃ CHỐT phù hợp/);
  const split = lookup('Tiền sân và tiền cầu chia thế nào?', {
    activities: [activity],
  });
  assert.match(split.answer, /Tiền sân: 300\.000đ · theo ca\/sân Ca 1/);
  assert.match(split.answer, /không mặc định chia đều/);
});

test('Travel respects public versus verified details, cancellation and missing information', () => {
  const trip = {
    ...activity,
    id: 'trip',
    kind: 'trip',
    title: 'Đà Lạt',
    status: 'cancelled',
    start_date: '2026-11-21',
    end_date: '2026-11-22',
    location: 'Đà Lạt',
    participants: [{ name: 'Tên riêng', status: 'going' }],
  };
  const publicReply = lookup('Ai tham gia du lịch tuần này?', {
    finance_authorized: false,
    activities: [trip],
  });
  assert.match(publicReply.answer, /21\/11\/2026.*ĐÃ HỦY/s);
  assert.match(publicReply.answer, /cần xác minh/);
  assert.doesNotMatch(publicReply.answer, /Tên riêng|360\.000|180\.000/);
  const verified = lookup('Ai tham gia du lịch tuần này?', {
    activities: [trip],
  });
  assert.match(verified.answer, /Tên riêng \(Đi\)/);
  assert.equal(verified.source_ids[0], 'trip');
});

test('Guidance never performs writes; follow-ups retain the question topic and long results stay bounded', () => {
  assert.match(
    lookup('Đăng ký giúp tôi', {}).answer,
    /Trợ lý chưa ghi đăng ký/,
  );
  assert.match(
    lookup('Hướng dẫn thanh toán', {}).answer,
    /xem QR không đánh dấu đã thanh toán/,
  );
  assert.match(
    lookup('Nấu phở như thế nào?', { sessions: [session] }).answer,
    /theo các mẫu câu/,
  );
  const followup = lookup(
    'Còn tuần sau?',
    { sessions: [session], assignments: [] },
    ['Ai đặt sân tuần này?'],
  );
  assert.match(followup.answer, /Chưa có phân công đặt sân/);
  const large = lookup('Ai còn thiếu tiền?', {
    activities: Array.from({ length: 8 }, (_, i) => ({
      ...activity,
      id: `activity-${i}`,
      title: 'Bảng phí '.repeat(30),
      people: Array.from({ length: 24 }, () => ({
        name: 'Thành viên rất dài '.repeat(5),
        due: 180000,
        net_paid: 80000,
        balance: 100000,
      })),
    })),
  });
  assert.ok(large.answer.length <= 4000);
  assert.match(large.answer, /chưa đầy đủ/);
});
