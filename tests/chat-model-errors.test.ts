import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatModel } from '../supabase/functions/_shared/chat/model';
import { createChatHandler } from '../supabase/functions/_shared/chat/handler';
import {
  ChatError,
  type ChatContext,
  type ChatQuestion,
} from '../supabase/functions/_shared/chat/types';

const config = {
  provider: 'openai',
  apiKey: 'private-model-key',
  model: 'gpt-6-luna',
  baseUrl: 'https://api.openai.com/v1',
  maxOutputTokens: 800,
};
const question: ChatQuestion = {
  message: 'Tuần này đánh hôm nào?',
  history: [],
  memberId: null,
  bookingToken: null,
  sessionId: null,
  activityId: null,
};
const context: ChatContext = {
  version: 1,
  checked_at: '2026-11-19T04:00:00Z',
  scope: 'schedule',
  selected_member: null,
  needs_member: false,
  finance_authorized: false,
  limited: false,
  sessions: [],
};
const providerResponse = (
  code: unknown,
  type: unknown = 'insufficient_quota',
  status = 429,
  headers?: HeadersInit,
) =>
  Response.json(
    {
      error: {
        code,
        type,
        message: 'DO NOT EXPOSE private-model-key org-private-id',
      },
    },
    { status, headers },
  );

async function failure(response: Response) {
  let calls = 0;
  const model = createChatModel(config, async () => {
    calls++;
    return response;
  });
  try {
    await model.answer(question, context, []);
    assert.fail('Provider failure must not produce an answer');
  } catch (error) {
    assert.ok(error instanceof ChatError);
    assert.equal(calls, 1, 'Do not automatically retry a failed paid request');
    assert.doesNotMatch(
      error.message,
      /DO NOT EXPOSE|private-model-key|org-private-id/,
    );
    return error;
  }
}

test('Provider billing errors identify the required action without a fake one-minute cooldown', async (t) => {
  const cases = [
    ['credit_balance_exhausted', 'model_credits_exhausted', /hết tín dụng/],
    ['project_spend_limit_exceeded', 'model_spend_limit', /hạn mức chi tiêu/],
    [
      'organization_spend_limit_exceeded',
      'model_spend_limit',
      /hạn mức chi tiêu/,
    ],
    ['api_key_spend_limit_exceeded', 'model_spend_limit', /hạn mức chi tiêu/],
    [
      'organization_usage_limit_exceeded',
      'model_usage_limit',
      /hạn mức sử dụng/,
    ],
    ['usage_limit_exceeded', 'model_usage_limit', /hạn mức sử dụng/],
    ['insufficient_quota', 'model_quota', /Billing và Limits/],
    ['billing_not_active', 'model_billing_inactive', /chưa được kích hoạt/],
  ] as const;
  for (const [code, expected, message] of cases)
    await t.test(code, async () => {
      const error = await failure(
        providerResponse(code, 'insufficient_quota', 429, {
          'Retry-After': '60',
        }),
      );
      assert.equal(error.code, expected);
      assert.equal(error.retryAfter, 0);
      assert.match(error.message, message);
    });
  assert.equal(
    (await failure(providerResponse(null))).code,
    'model_quota',
    'Legacy insufficient_quota type is still recognized',
  );
});

test('Actual request limits respect Retry-After, with a bounded fallback', async () => {
  for (const [code, type] of [
    ['rate_limit_exceeded', 'tokens'],
    ['slow_down', 'rate_limit_error'],
    [null, 'rate_limit_error'],
  ]) {
    const error = await failure(
      providerResponse(code, type, 429, { 'Retry-After': '12.2' }),
    );
    assert.equal(error.code, 'model_rate_limit');
    assert.equal(error.retryAfter, 13);
    assert.equal(error.status, 429);
  }
  const dated = await failure(
    providerResponse('rate_limit_exceeded', 'tokens', 429, {
      'Retry-After': new Date(Date.now() + 120000).toUTCString(),
    }),
  );
  assert.ok(dated.retryAfter >= 119 && dated.retryAfter <= 120);
  for (const [header, expected] of [
    ['bad', 60],
    ['-3', 60],
    ['0', 60],
    ['999999999', 86400],
  ] as const) {
    assert.equal(
      (
        await failure(
          providerResponse('rate_limit_exceeded', 'tokens', 429, {
            'Retry-After': header,
          }),
        )
      ).retryAfter,
      expected,
    );
  }
});

test('Unknown, authentication and malformed provider errors remain safe and do not guess billing', async () => {
  const unknown = await failure(providerResponse('unrecognized', 'unknown'));
  assert.equal(unknown.code, 'model_limit_unknown');
  assert.equal(unknown.retryAfter, 0);
  assert.match(unknown.message, /chưa xác định được/);
  assert.equal(
    (await failure(providerResponse('invalid_api_key', null, 401))).code,
    'model_authentication',
  );
  assert.equal(
    (await failure(providerResponse('model_not_found', null, 404))).code,
    'model_access',
  );
  assert.equal(
    (await failure(providerResponse(null, null, 403))).code,
    'model_access',
  );
  for (const body of [
    null,
    [],
    'DO NOT EXPOSE private-model-key',
    { error: null },
  ]) {
    const error = await failure(Response.json(body, { status: 500 }));
    assert.equal(error.code, 'model_unavailable');
  }
  assert.equal(
    (
      await failure(
        new Response('<h1>DO NOT EXPOSE private-model-key</h1>', {
          status: 502,
        }),
      )
    ).code,
    'model_unavailable',
  );
});

test('HTTP handler preserves billing versus rate-limit messages and sends Retry-After only for a temporary rate limit', async () => {
  let temporary = false;
  const handler = createChatHandler(
    {
      SUPABASE_URL: 'https://club.supabase.co',
      SUPABASE_ANON_KEY: 'public-key',
      SUPABASE_SERVICE_ROLE_KEY: 'private-database-key',
      OPENAI_API_KEY: config.apiKey,
      AI_PROVIDER: 'openai',
      CHAT_ALLOWED_ORIGINS: 'https://caulongteam.netlify.app',
    },
    {
      fetch: async (url) => {
        if (String(url).endsWith('get_chat_context'))
          return Response.json(context);
        if (String(url).endsWith('reserve_chat_request'))
          return Response.json({ allowed: true, retry_after: 0 });
        return temporary
          ? providerResponse('rate_limit_exceeded', 'tokens', 429, {
              'Retry-After': '25',
            })
          : providerResponse('credit_balance_exhausted');
      },
    },
  );
  const request = () =>
    new Request('https://club.supabase.co/functions/v1/club-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://caulongteam.netlify.app',
      },
      body: JSON.stringify({ message: question.message }),
    });
  const billing = await handler(request());
  assert.equal(billing.status, 429);
  assert.equal(billing.headers.get('Retry-After'), null);
  assert.deepEqual(await billing.json(), {
    error:
      'Tài khoản API của trợ lý đã hết tín dụng. Người phụ trách cần bổ sung tín dụng trong OpenAI Billing trước khi thử lại.',
    code: 'model_credits_exhausted',
    retryAfter: 0,
  });
  temporary = true;
  const limited = await handler(request());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '25');
  assert.equal((await limited.json()).code, 'model_rate_limit');
});
