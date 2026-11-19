// Legacy contract used by the retained backend regression tests. The website
// no longer imports this module or invokes the retired chatbot endpoint.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatReply,
  ChatSource,
} from '../supabase/functions/_shared/chat/types';
export type { ChatReply, ChatSource };

export class ChatClientError extends Error {
  constructor(
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
const notDeployed =
  'Trợ lý chưa được triển khai trên máy chủ. Người phụ trách cần triển khai chức năng trợ lý trước khi sử dụng.';

/** Missing functions return 404 to OPTIONS, blocking the POST in browsers.
 * A simple GET can diagnose this without preflight, credentials, chat content
 * or a billable model request. */
async function diagnoseConnection(
  endpoint: string | undefined,
  request: typeof fetch,
  signal?: AbortSignal,
) {
  if (!endpoint) return;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 4000);
  try {
    const response = await request(endpoint, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (response.status === 404) return notDeployed;
    if (response.status === 401)
      return 'Máy chủ chưa cho phép truy cập trợ lý. Người phụ trách cần kiểm tra cấu hình quyền truy cập.';
  } catch {
    // A disallowed origin or unavailable network can hide every HTTP status.
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}
export function safeChatSource(value: unknown): value is ChatSource {
  if (!value || typeof value !== 'object') return false;
  const s = value as ChatSource;
  return (
    typeof s.id === 'string' &&
    typeof s.label === 'string' &&
    s.label.length <= 400 &&
    typeof s.href === 'string' &&
    /^#(?:schedule|booking|finance|travel|members|tasks)(?:\?[a-zA-Z0-9_=%&.\-]+)?$/.test(
      s.href,
    )
  );
}
export function parseChatReply(value: unknown): ChatReply {
  const data = value as ChatReply;
  if (
    !data ||
    typeof data.answer !== 'string' ||
    !data.answer.trim() ||
    data.answer.length > 4000 ||
    typeof data.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(data.checkedAt)) ||
    !Array.isArray(data.sources) ||
    (data.mode != null && data.mode !== 'lookup' && data.mode !== 'ai') ||
    data.sources.length > 20 ||
    !data.sources.every(safeChatSource)
  )
    throw new ChatClientError('Câu trả lời chưa hợp lệ. Bạn thử lại nhé.');
  return data;
}
export async function invokeClubChat(
  client: SupabaseClient,
  body: {
    message: string;
    history: string[];
    memberId: string | null;
    bookingToken: string | null;
    sessionId?: string;
    activityId?: string;
  },
  signal?: AbortSignal,
  diagnostics: { endpoint?: string; fetch?: typeof fetch } = {},
): Promise<ChatReply> {
  // Vietnamese text can use several UTF-8 bytes per character. Drop older
  // questions before the request byte cap; keep the current question intact.
  const payload = { ...body, history: [...body.history] };
  while (
    new TextEncoder().encode(JSON.stringify(payload)).length > 9500 &&
    payload.history.length
  )
    payload.history.shift();
  const {
    data,
    error,
    response: invocationResponse,
  } = await client.functions.invoke('club-chat', {
    body: payload,
    signal,
  });
  if (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response =
      invocationResponse ??
      ('context' in error && error.context instanceof Response
        ? error.context
        : null);
    if (response) {
      let info: { error?: string; retryAfter?: number } = {};
      try {
        info = await response.clone().json();
      } catch {
        /* Gateway errors may not be JSON. */
      }
      if (response.status === 404) throw new ChatClientError(notDeployed);
      if (typeof info.error === 'string' && info.error)
        throw new ChatClientError(
          info.error,
          Math.min(86400, Math.max(0, Number(info.retryAfter) || 0)),
        );
      if (response.status === 401)
        throw new ChatClientError(
          'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử nhé.',
        );
    }
    const base = import.meta.env?.VITE_SUPABASE_URL?.replace(/\/$/, '');
    const diagnosis = !response
      ? await diagnoseConnection(
          diagnostics.endpoint ??
            (base ? `${base}/functions/v1/club-chat` : undefined),
          diagnostics.fetch ?? fetch,
          signal,
        )
      : undefined;
    if (diagnosis) throw new ChatClientError(diagnosis);
    throw new ChatClientError(
      'Chưa gọi được máy chủ trợ lý. Hãy thử lại; nếu vẫn lỗi, người phụ trách cần kiểm tra máy chủ và địa chỉ website được phép truy cập.',
    );
  }
  return parseChatReply(data);
}
