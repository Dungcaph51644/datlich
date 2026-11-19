import { createChatHandler } from '../_shared/chat/handler.ts';

const names = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CHAT_SUPABASE_PUBLISHABLE_KEY',
  'OPENAI_API_KEY',
  'AI_PROVIDER',
  'AI_BASE_URL',
  'AI_MODEL',
  'AI_MAX_OUTPUT_TOKENS',
  'CHAT_ALLOWED_ORIGINS',
];
Deno.serve(
  createChatHandler(
    Object.fromEntries(names.map((name) => [name, Deno.env.get(name)])),
  ),
);
