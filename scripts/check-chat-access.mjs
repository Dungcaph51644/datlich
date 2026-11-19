// Read-only diagnosis. The personal prompt without a selected member returns
// before model/data access, so this check does not spend AI tokens.
import { loadEnv } from 'vite';
const env = loadEnv('development', process.cwd(), 'VITE_');
const base = env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!base || !key) throw new Error('Chưa cấu hình Supabase cho website.');
const endpoint = `${base}/functions/v1/club-chat`;
const origins = [
  ...new Set([
    'https://caulongteam.netlify.app',
    process.argv[2] || 'http://127.0.0.1:5174',
  ]),
];
const results = await Promise.all(
  origins.map(async (origin) => {
    const response = await fetch(endpoint, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          'authorization,apikey,content-type,x-client-info',
      },
      signal: AbortSignal.timeout(15000),
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      /* OPTIONS success is empty. */
    }
    return {
      origin,
      status: response.status,
      allowedOrigin: response.headers.get('access-control-allow-origin'),
      code: body.code ?? null,
      error: body.error ?? body.message ?? null,
    };
  }),
);
for (const result of results) console.log(JSON.stringify(result));
const headers = {
  apikey: key,
  'Content-Type': 'application/json',
  Origin: origins[0],
};
if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
const response = await fetch(endpoint, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    message: 'Tôi còn thiếu bao nhiêu?',
    history: [],
    memberId: null,
    bookingToken: null,
  }),
  signal: AbortSignal.timeout(15000),
});
const body = await response.json().catch(() => ({}));
console.log(
  JSON.stringify({
    probe: 'identity_without_model',
    status: response.status,
    allowedOrigin: response.headers.get('access-control-allow-origin'),
    code: body.code ?? null,
    needsMember: body.needsMember === true,
    error: body.error ?? body.message ?? null,
  }),
);
const today = new Date().toISOString().slice(0, 10);
const contextResponse = await fetch(`${base}/rest/v1/rpc/get_chat_context`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    p_scope: 'schedule',
    p_start: today,
    p_end: today,
    p_personal: false,
    p_token: null,
  }),
  signal: AbortSignal.timeout(15000),
});
const context = await contextResponse.json().catch(() => ({}));
console.log(
  JSON.stringify({
    probe: 'database_context',
    status: contextResponse.status,
    version: context.version ?? null,
    code: context.code ?? null,
    error: contextResponse.ok ? null : (context.message ?? null),
  }),
);
if (
  results.some(
    (r) =>
      ![200, 204].includes(r.status) ||
      ![r.origin, '*'].includes(r.allowedOrigin),
  ) ||
  response.status !== 200 ||
  !body.needsMember ||
  !contextResponse.ok ||
  context.version !== 1
)
  process.exitCode = 1;
