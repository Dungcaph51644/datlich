import {
  ChatError,
  type ChatContext,
  type ChatQuestion,
  type ChatReply,
} from './types.ts';
import { contextSources, planQuestion, normalize } from './intent.ts';
import { createChatModel, type ChatModel } from './model.ts';
import { answerLookup } from './lookup.ts';

export type ChatEnvironment = Record<string, string | undefined>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
function optionalId(value: unknown) {
  if (value == null) return null;
  if (typeof value !== 'string' || !uuid.test(value))
    throw new ChatError(
      400,
      'input',
      'Tên thành viên hoặc trang chi tiết chưa hợp lệ. Hãy tải lại trang.',
    );
  return value;
}
export function validateQuestion(body: unknown): ChatQuestion {
  if (
    !record(body) ||
    typeof body.message !== 'string' ||
    !body.message.trim() ||
    body.message.length > 800
  )
    throw new ChatError(
      400,
      'input',
      'Bạn hãy nhập câu hỏi từ 1 đến 800 ký tự.',
    );
  if (
    body.history != null &&
    (!Array.isArray(body.history) ||
      body.history.length > 4 ||
      !body.history.every((x) => typeof x === 'string' && x.length <= 800))
  )
    throw new ChatError(
      400,
      'input',
      'Cuộc trò chuyện quá dài. Hãy xóa và bắt đầu lại.',
    );
  if (
    body.bookingToken != null &&
    (typeof body.bookingToken !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(body.bookingToken))
  )
    throw new ChatError(
      400,
      'input',
      'Phiên xác minh không hợp lệ. Hãy nhập lại mã cá nhân.',
    );
  return {
    message: body.message.trim(),
    history: (body.history ?? []) as string[],
    memberId: optionalId(body.memberId),
    bookingToken: (body.bookingToken as string) || null,
    sessionId: optionalId(body.sessionId),
    activityId: optionalId(body.activityId),
  };
}

export function createChatHandler(
  env: ChatEnvironment,
  dependencies: {
    fetch?: typeof fetch;
    model?: ChatModel;
    now?: () => Date;
  } = {},
) {
  const request = dependencies.fetch ?? fetch;
  const provider = env.AI_PROVIDER ?? 'lookup';
  const mode = provider === 'lookup' ? 'lookup' : 'ai';
  const allowedOrigins = (
    env.CHAT_ALLOWED_ORIGINS ?? 'https://caulongteam.netlify.app'
  )
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin') ?? '';
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Headers':
        'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'X-Content-Type-Options': 'nosniff',
    });
    const respond = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowedOrigins.includes(origin))
      return respond(
        {
          error: 'Website này chưa được phép dùng trợ lý nhóm.',
          code: 'origin',
        },
        403,
      );
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers });
    if (req.method !== 'POST')
      return respond(
        { error: 'Chỉ chấp nhận câu hỏi gửi bằng POST.', code: 'method' },
        405,
      );
    try {
      if (!(req.headers.get('content-type') ?? '').includes('application/json'))
        throw new ChatError(
          415,
          'input',
          'Câu hỏi cần được gửi dưới dạng JSON.',
        );
      if (Number(req.headers.get('content-length') ?? 0) > 10000)
        throw new ChatError(413, 'input', 'Nội dung gửi quá dài.');
      // Bound actual bytes too; Content-Length is optional/untrusted.
      const reader = req.body?.getReader();
      if (!reader) throw new ChatError(400, 'input', 'Chưa nhận được câu hỏi.');
      const parts: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 10000) {
          await reader.cancel();
          throw new ChatError(413, 'input', 'Nội dung gửi quá dài.');
        }
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new ChatError(400, 'input', 'Câu hỏi gửi lên chưa hợp lệ.');
      }
      const question = validateQuestion(body);
      const plan = planQuestion(question, dependencies.now?.());
      const checkedAt = (dependencies.now?.() ?? new Date()).toISOString();
      if (plan.personal && !question.memberId)
        return respond({
          answer:
            'Bạn chọn tên của mình trên website trước nhé, để mình tra cứu đúng người.',
          sources: [],
          checkedAt,
          needsMember: true,
          mode,
        } satisfies ChatReply);
      const url = env.SUPABASE_URL?.replace(/\/$/, '');
      const publicKey =
        env.CHAT_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY;
      const serverKey = env.SUPABASE_SERVICE_ROLE_KEY;
      if (
        !url ||
        !publicKey ||
        !serverKey ||
        (provider !== 'lookup' && provider !== 'openai') ||
        (provider === 'openai' && !env.OPENAI_API_KEY && !dependencies.model)
      )
        throw new ChatError(
          503,
          'configuration',
          'Trợ lý chưa được cấu hình đúng trên máy chủ. Bạn vẫn có thể xem trực tiếp các mục Lịch đánh, Tiền sân và Du lịch.',
        );
      const bearer =
        req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      // A user JWT is forwarded to PostgREST for its real signature/expiry check.
      // Never downgrade an invalid user JWT into a service-role data read.
      const jwt = bearer.split('.').length === 3 ? bearer : null;
      if (bearer.startsWith('sb_secret_') || bearer === serverKey)
        throw new ChatError(
          403,
          'credentials',
          'Thông tin xác thực không hợp lệ.',
        );
      const rpc = async (
        name: string,
        args: Record<string, unknown>,
        privileged = false,
      ): Promise<unknown> => {
        const h: Record<string, string> = {
          apikey: privileged ? serverKey : publicKey,
          'Content-Type': 'application/json',
        };
        if (privileged) {
          if (serverKey.split('.').length === 3)
            h.Authorization = `Bearer ${serverKey}`;
        } else if (jwt) h.Authorization = `Bearer ${jwt}`;
        else if (publicKey.split('.').length === 3)
          h.Authorization = `Bearer ${publicKey}`;
        const response = await request(`${url}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403)
            throw new ChatError(
              401,
              'identity',
              'Phiên đăng nhập hết hạn hoặc chưa đủ quyền. Hãy đăng nhập hoặc xác minh lại ở Phân công CS.',
            );
          if (response.status === 404)
            throw new ChatError(
              503,
              'migration',
              'Máy chủ chưa có phần tra cứu cho chatbot. Cần hoàn tất cập nhật hệ thống.',
            );
          throw new ChatError(
            502,
            'data_unavailable',
            'Chưa đọc được dữ liệu mới nhất từ máy chủ. Mình chưa thể xác nhận lịch hoặc số tiền. Bạn thử lại nhé.',
          );
        }
        return response.json();
      };
      const context = (await rpc('get_chat_context', {
        p_scope: plan.scope,
        p_start: plan.start,
        p_end: plan.end,
        p_member_id: question.memberId,
        p_session_id: plan.sessionId,
        p_activity_id: plan.activityId,
        p_personal: plan.personal,
        p_all_balances: plan.allBalances,
        p_token: question.bookingToken,
      })) as ChatContext;
      if (
        !record(context) ||
        context.version !== 1 ||
        typeof context.checked_at !== 'string' ||
        typeof context.finance_authorized !== 'boolean' ||
        typeof context.needs_member !== 'boolean' ||
        (context.sessions != null && !Array.isArray(context.sessions)) ||
        (context.activities != null && !Array.isArray(context.activities))
      )
        throw new ChatError(
          502,
          'data_invalid',
          'Dữ liệu trả về chưa hợp lệ. Mình chưa thể xác nhận thông tin.',
        );
      if (context.needs_member)
        return respond({
          answer: 'Tên đang chọn không còn hoạt động. Bạn chọn lại tên nhé.',
          sources: [],
          checkedAt: context.checked_at,
          needsMember: true,
          mode,
        } satisfies ChatReply);
      if (
        (plan.scope === 'finance' ||
          (plan.scope === 'travel' && plan.personal)) &&
        !context.finance_authorized
      ) {
        return respond({
          answer: `${plan.scope === 'finance' ? 'Chi tiết chi phí và thanh toán' : 'Chi tiết chuyến đi'} cần danh tính đã xác minh theo quyền hiện tại của nhóm. Bạn vào Phân công CS → Nhập mã cá nhân hoặc đăng nhập tài khoản đã liên kết rồi hỏi lại nhé. Chọn tên chỉ giúp xác định người cần tra cứu.`,
          sources: [
            {
              id: 'verify',
              label: 'Mở Phân công CS để xác minh',
              href: '#booking',
            },
            {
              id: 'activity',
              label: plan.scope === 'finance' ? 'Mở Tiền sân' : 'Mở Du lịch',
              href: plan.scope === 'finance' ? '#finance' : '#travel',
            },
          ],
          checkedAt: context.checked_at,
          needsVerification: true,
          mode,
        } satisfies ChatReply);
      }
      const sources = contextSources(context, plan);
      if (plan.scope === 'guide')
        sources.push(
          { id: 'schedule', label: 'Mở lịch đánh', href: '#schedule' },
          { id: 'finance', label: 'Mở Tiền sân', href: '#finance' },
          { id: 'travel', label: 'Mở Du lịch', href: '#travel' },
          { id: 'members', label: 'Mở thành viên', href: '#members' },
          { id: 'booking', label: 'Mở Phân công CS', href: '#booking' },
        );
      if (!sources.length)
        sources.push({
          id: plan.scope,
          label:
            plan.scope === 'travel'
              ? 'Mở Du lịch'
              : plan.scope === 'finance'
                ? 'Mở Tiền sân'
                : 'Mở lịch đánh',
          href:
            plan.scope === 'travel'
              ? '#travel'
              : plan.scope === 'finance'
                ? '#finance'
                : '#schedule',
        });
      const ip =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'unknown';
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(serverKey + ':' + ip),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const budget = (await rpc(
        'reserve_chat_request',
        { p_client_hash: hash },
        true,
      )) as { allowed: boolean; retry_after: number };
      if (typeof budget?.allowed !== 'boolean')
        throw new ChatError(
          503,
          'budget',
          'Chưa kiểm tra được giới hạn trợ lý. Bạn thử lại sau nhé.',
        );
      if (!budget.allowed)
        throw new ChatError(
          429,
          'rate_limit',
          'Đã đạt giới hạn câu hỏi. Bạn nghỉ một chút rồi thử lại, hoặc mở trực tiếp trang chức năng nhé.',
          budget.retry_after,
        );
      if (provider === 'lookup') {
        const answer = answerLookup(question, plan, context, sources);
        return respond({
          answer: answer.answer,
          sources: sources.filter((s) => answer.source_ids.includes(s.id)),
          checkedAt: context.checked_at,
          mode,
        } satisfies ChatReply);
      }
      // Remove credential/member identifiers before any provider receives context.
      const modelContext = {
        ...context,
        sessions: context.sessions?.map((session) => {
          if (
            /\bai\b|danh sach|nguoi (di|tham gia|dang ky)|thanh vien/.test(
              normalize(question.message),
            )
          )
            return session;
          const {
            registered_names: _names,
            names_limited: _limited,
            ...scheduleFacts
          } = session;
          return scheduleFacts;
        }),
        selected_member:
          plan.personal && context.selected_member
            ? { ...context.selected_member, id: '', code: '' }
            : null,
      };
      const model =
        dependencies.model ??
        createChatModel(
          {
            provider,
            apiKey: env.OPENAI_API_KEY!,
            baseUrl: env.AI_BASE_URL ?? 'https://api.openai.com/v1',
            model: env.AI_MODEL ?? 'gpt-6-luna',
            maxOutputTokens: Math.floor(
              Math.min(
                2000,
                Math.max(600, Number(env.AI_MAX_OUTPUT_TOKENS) || 800),
              ),
            ),
          },
          request,
        );
      // Credentials are only used for database queries, never passed to a model.
      const answer = await model.answer(
        {
          ...question,
          bookingToken: null,
          memberId: null,
          sessionId: null,
          activityId: null,
        },
        modelContext,
        sources,
      );
      const cited = sources.filter((s) => answer.source_ids.includes(s.id));
      return respond({
        answer: answer.answer,
        sources: cited.length ? cited : sources,
        checkedAt: context.checked_at,
        mode,
      } satisfies ChatReply);
    } catch (error) {
      const failure =
        error instanceof ChatError
          ? error
          : new ChatError(
              502,
              'unavailable',
              'Kết nối trợ lý bị gián đoạn. Mình chưa thể xác nhận dữ liệu; bạn thử lại nhé.',
            );
      if (failure.retryAfter)
        headers.set('Retry-After', String(failure.retryAfter));
      return respond(
        {
          error: failure.message,
          code: failure.code,
          retryAfter: failure.retryAfter,
        },
        failure.status,
      );
    }
  };
}
