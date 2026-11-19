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
): Promise<ChatReply> {
  // Vietnamese text can use several UTF-8 bytes per character. Drop older
  // questions before the request byte cap; keep the current question intact.
  const payload = { ...body, history: [...body.history] };
  while (
    new TextEncoder().encode(JSON.stringify(payload)).length > 9500 &&
    payload.history.length
  )
    payload.history.shift();
  const { data, error } = await client.functions.invoke('club-chat', {
    body: payload,
    signal,
  });
  if (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response =
      'context' in error && error.context instanceof Response
        ? error.context
        : null;
    if (response) {
      let info: { error?: string; retryAfter?: number } = {};
      try {
        info = await response.clone().json();
      } catch {
        /* Gateway errors may not be JSON. */
      }
      if (info.error)
        throw new ChatClientError(
          info.error,
          Math.min(86400, Math.max(0, Number(info.retryAfter) || 0)),
        );
      if (response.status === 404)
        throw new ChatClientError(
          'Trợ lý AI chưa được triển khai trên máy chủ. Bạn vẫn có thể xem trực tiếp các trang chức năng.',
        );
      if (response.status === 401)
        throw new ChatClientError(
          'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử nhé.',
        );
    }
    throw new ChatClientError(
      'Chưa kết nối được trợ lý. Kiểm tra mạng rồi thử lại nhé.',
    );
  }
  return parseChatReply(data);
}
