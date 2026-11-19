import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChatClientError, invokeClubChat } from '../src/chatClient';
const body = {
  message: 'Lịch tuần này?',
  history: [],
  memberId: null,
  bookingToken: 'private-personal-token',
};
const endpoint = 'https://test.supabase.co/functions/v1/club-chat';
const client = (result: unknown) =>
  ({ functions: { invoke: async () => result } }) as unknown as SupabaseClient;
test('Preflight-blocked missing function is diagnosed by a credential-free GET without resending the question', async () => {
  let probes = 0;
  await assert.rejects(
    invokeClubChat(
      client({ data: null, error: new Error('Failed to send a request') }),
      body,
      undefined,
      {
        endpoint,
        fetch: async (url, options) => {
          probes++;
          assert.equal(url, endpoint);
          assert.equal(options?.method, 'GET');
          assert.equal(options?.credentials, 'omit');
          assert.equal(options?.body, undefined);
          assert.equal(options?.headers, undefined);
          assert.ok(!JSON.stringify(options).includes(body.bookingToken));
          return new Response('Requested function was not found', {
            status: 404,
          });
        },
      },
    ),
    /chưa được triển khai/,
  );
  assert.equal(probes, 1);
});
test('HTTP errors retain actionable missing-function, identity, backend and rate-limit messages without extra requests', async () => {
  for (const [status, json, expected] of [
    [
      404,
      { code: 'NOT_FOUND', message: 'Requested function was not found' },
      /chưa được triển khai/,
    ],
    [401, { message: 'Invalid JWT' }, /hết hạn/],
    [503, { error: 'Trợ lý chưa có key trên máy chủ.' }, /chưa có key/],
    [429, { error: 'Đạt giới hạn câu hỏi', retryAfter: 30 }, /giới hạn/],
  ] as const) {
    await assert.rejects(
      invokeClubChat(
        client({
          data: null,
          error: new Error('HTTP error'),
          response: Response.json(json, { status }),
        }),
        body,
        undefined,
        {
          endpoint,
          fetch: async () => {
            throw new Error('Must not probe an HTTP response');
          },
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof ChatClientError);
        assert.match(error.message, expected);
        assert.equal(error.retryAfter, status === 429 ? 30 : 0);
        return true;
      },
    );
  }
});
test('Unknown CORS/network failures do not fabricate a working backend; cancellation stays aborted', async () => {
  const failed = client({ data: null, error: new Error('Failed to fetch') });
  await assert.rejects(
    invokeClubChat(failed, body, undefined, {
      endpoint,
      fetch: async () => {
        throw new Error('CORS');
      },
    }),
    /máy chủ và địa chỉ website/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    invokeClubChat(failed, body, controller.signal, {
      endpoint,
      fetch: async () => {
        throw new Error('Must not probe');
      },
    }),
    (error: unknown) =>
      error instanceof DOMException && error.name === 'AbortError',
  );
});
test('Successful answers skip the diagnostic request and keep the existing validated response', async () => {
  const reply = {
    answer: 'Chưa có buổi phù hợp.',
    checkedAt: new Date().toISOString(),
    sources: [],
  };
  assert.deepEqual(
    await invokeClubChat(
      client({ data: reply, error: null }),
      body,
      undefined,
      {
        endpoint,
        fetch: async () => {
          throw new Error('Must not probe successful chat');
        },
      },
    ),
    reply,
  );
});
