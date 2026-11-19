import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatHandler,
  validateQuestion,
} from '../supabase/functions/_shared/chat/handler';
import {
  planQuestion,
  contextSources,
} from '../supabase/functions/_shared/chat/intent';
import { createChatModel } from '../supabase/functions/_shared/chat/model';
import { parseChatReply, safeChatSource } from '../src/chatClient';
import type {
  ChatContext,
  ChatQuestion,
} from '../supabase/functions/_shared/chat/types';

const id = '10000000-0000-4000-8000-000000000001';
const now = new Date('2026-11-22T18:30:00Z'); // Monday in Vietnam, Sunday in UTC
const q = (message: string, history: string[] = []): ChatQuestion => ({
  message,
  history,
  memberId: null,
  bookingToken: null,
  sessionId: null,
  activityId: null,
});
const env = {
  AI_PROVIDER: 'openai',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
  OPENAI_API_KEY: 'model-only-key',
  CHAT_ALLOWED_ORIGINS: 'https://caulongteam.netlify.app',
};
const context: ChatContext = {
  version: 1,
  checked_at: now.toISOString(),
  scope: 'schedule',
  selected_member: null,
  needs_member: false,
  finance_authorized: false,
  limited: false,
  sessions: [
    {
      id,
      date: '2026-11-24',
      start_time: '18:00',
      end_time: '20:00',
      venue: 'Sân A',
      court: 'Ca 1',
      booking_status: 'cancelled',
      registered_names: ['Yến'],
    },
  ],
};
const req = (body: unknown, origin = 'https://caulongteam.netlify.app') =>
  new Request('https://test.supabase.co/functions/v1/club-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Authorization: 'Bearer header.payload.signature',
      'x-forwarded-for': '192.0.2.1',
    },
    body: JSON.stringify(body),
  });

test('Vietnamese question routing respects Vietnam dates, weekdays and follow-ups', () => {
  assert.deepEqual(
    [
      planQuestion(q('Tuần này đánh hôm nào?'), now).start,
      planQuestion(q('Tuần này đánh hôm nào?'), now).end,
    ],
    ['2026-11-23', '2026-11-29'],
  );
  assert.equal(planQuestion(q('Ai đặt sân tuần sau?'), now).scope, 'booking');
  assert.equal(
    planQuestion(q('Ai đặt sân tuần sau?'), now).start,
    '2026-11-30',
  );
  assert.equal(
    planQuestion(q('Buổi thứ Ba còn mấy chỗ?'), now).start,
    '2026-11-24',
  );
  assert.equal(
    planQuestion(q('Tôi còn thiếu bao nhiêu?'), now).allBalances,
    true,
  );
  assert.equal(
    planQuestion(q('Mình cần đóng bao nhiêu?'), now).scope,
    'finance',
  );
  assert.equal(
    planQuestion(q('Tiền sân và tiền cầu chia thế nào?'), now).scope,
    'finance',
  );
  assert.equal(
    planQuestion(q('Còn tuần sau?', ['Buổi thứ Ba còn mấy chỗ?']), now).start,
    '2026-12-01',
  );
  assert.equal(
    planQuestion(q('Ngày 2/12/2026 đánh lúc mấy giờ?'), now).start,
    '2026-12-02',
  );
  assert.equal(planQuestion(q('Du lịch tháng sau?'), now).end, '2026-12-31');
  assert.throws(
    () => planQuestion(q('Lịch 31/02/2026?'), now),
    /Ngày bạn nhập/,
  );
});
test('Input and rendered sources reject excess payloads, HTML links and external navigation', () => {
  assert.throws(() => validateQuestion({ message: 'a'.repeat(801) }));
  assert.throws(() =>
    validateQuestion({ message: 'hello', history: ['x'.repeat(801)] }),
  );
  assert.throws(() => validateQuestion({ message: 'hello', bookingToken: id }));
  assert.equal(
    safeChatSource({ id, label: 'evil', href: 'javascript:alert(1)' }),
    false,
  );
  assert.equal(
    safeChatSource({ id, label: 'evil', href: 'https://example.com' }),
    false,
  );
  assert.throws(() =>
    parseChatReply({
      answer: 'fake',
      checkedAt: now.toISOString(),
      sources: [{ id, label: 'x', href: '//evil.test' }],
    }),
  );
  assert.ok(
    contextSources(context, planQuestion(q('Lịch?'), now))[0].href.includes(id),
  );
});
test('Handler re-queries facts per turn, forwards user credentials only to scoped RPC, and never uses admin credentials for facts', async () => {
  const seen: { name: string; body: any; headers: Headers }[] = [];
  let venue = 'Sân mới';
  const fetcher: typeof fetch = async (url, options) => {
    const name = String(url).split('/').at(-1)!;
    const body = JSON.parse(String(options?.body));
    const headers = new Headers(options?.headers);
    seen.push({ name, body, headers });
    if (name === 'get_chat_context')
      return Response.json({
        ...context,
        selected_member: { id, name: 'Yến', code: 'CL-1' },
        sessions: [{ ...context.sessions![0], venue }],
      });
    if (name === 'reserve_chat_request')
      return Response.json({ allowed: true, retry_after: 0 });
    throw new Error('Unexpected network request');
  };
  const handler = createChatHandler(env, {
    fetch: fetcher,
    now: () => now,
    model: {
      async answer(question, facts) {
        assert.equal(question.bookingToken, null);
        assert.equal(question.memberId, null);
        assert.equal(facts.selected_member, null);
        assert.equal(facts.sessions![0].registered_names, undefined);
        assert.ok(!JSON.stringify(facts).includes('server-only-key'));
        return {
          answer: `${facts.sessions![0].venue} đã hủy.`,
          source_ids: [id],
        };
      },
    },
  });
  const first = await (
    await handler(
      req({
        message: 'Buổi thứ Ba?',
        memberId: id,
        bookingToken: 'a'.repeat(64),
      }),
    )
  ).json();
  venue = 'Sân vừa thay đổi';
  const second = await (await handler(req({ message: 'Buổi thứ Ba?' }))).json();
  assert.notEqual(first.answer, second.answer);
  assert.equal(seen.filter((x) => x.name === 'get_chat_context').length, 2);
  assert.equal(seen[0].headers.get('apikey'), 'public-key');
  assert.equal(
    seen[0].headers.get('authorization'),
    'Bearer header.payload.signature',
  );
  assert.equal(seen[1].headers.get('apikey'), 'server-only-key');
  assert.match(seen[1].body.p_client_hash, /^[0-9a-f]{64}$/);
  assert.equal(first.sources[0].href.startsWith('#schedule?'), true);
});
test('Missing identity, protected money, query failures, budgets and unconfigured AI are explicit and do not call a model', async () => {
  let modelCalls = 0;
  let mode = 'finance';
  const handler = createChatHandler(env, {
    now: () => now,
    model: {
      async answer() {
        modelCalls++;
        return { answer: 'unexpected', source_ids: [] };
      },
    },
    fetch: async (url) => {
      if (mode === 'failure')
        return new Response('private SQL error', { status: 500 });
      if (String(url).endsWith('reserve_chat_request'))
        return Response.json({ allowed: false, retry_after: 30 });
      return Response.json({
        ...context,
        scope: mode === 'finance' ? 'finance' : 'schedule',
      });
    },
  });
  const needName = await (
    await handler(req({ message: 'Tôi còn thiếu bao nhiêu?' }))
  ).json();
  assert.equal(needName.needsMember, true);
  const denied = await (
    await handler(req({ message: 'Tiền sân?', memberId: id }))
  ).json();
  assert.equal(denied.needsVerification, true);
  mode = 'failure';
  assert.equal((await handler(req({ message: 'Lịch tuần này?' }))).status, 502);
  mode = 'budget';
  const limited = await handler(req({ message: 'Lịch tuần này?' }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '30');
  assert.equal(modelCalls, 0);
  assert.equal(
    (await createChatHandler({})(req({ message: 'Lịch?' }))).status,
    503,
  );
  assert.equal(
    (await handler(req({ message: 'Lịch?' }, 'https://evil.test'))).status,
    403,
  );
});
test('Provider uses bounded stateless structured output; rejects refusal, incomplete and invented sources', async () => {
  let mode = 'good';
  const model = createChatModel(
    {
      provider: 'openai',
      apiKey: 'secret',
      model: 'gpt-6-luna',
      baseUrl: 'https://api.openai.com/v1',
      maxOutputTokens: 800,
    },
    async (url, options) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses');
      const body = JSON.parse(String(options?.body));
      assert.equal(body.store, false);
      assert.equal(body.model, 'gpt-6-luna');
      assert.equal(body.max_output_tokens, 800);
      assert.deepEqual(body.reasoning, { effort: 'none' });
      assert.equal(body.text.format.strict, true);
      assert.ok(
        body.instructions.includes('ĐÃ HỦY') &&
          body.instructions.includes('TẠM TÍNH'),
      );
      return Response.json({
        status: mode === 'incomplete' ? 'incomplete' : 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  answer: 'Buổi 24/11/2026 đã hủy.',
                  source_ids: mode === 'invent' ? ['fake'] : [id],
                }),
              },
            ],
          },
        ],
      });
    },
  );
  const sources = contextSources(context, planQuestion(q('Lịch?'), now));
  assert.ok(
    (await model.answer(q('Lịch?'), context, sources)).answer.includes(
      'đã hủy',
    ),
  );
  mode = 'invent';
  await assert.rejects(model.answer(q('Lịch?'), context, sources), /đối chiếu/);
  mode = 'incomplete';
  await assert.rejects(
    model.answer(q('Lịch?'), context, sources),
    /chưa hoàn tất/,
  );
});
