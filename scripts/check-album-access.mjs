// Read-only; no test albums, file uploads or metadata changes are made.
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
const env = loadEnv('development', process.cwd(), 'VITE_');
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Cần cấu hình URL và publishable key của Supabase.');
}
const client = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const { data, error } = await client
  .rpc('get_team_album_snapshot')
  .abortSignal(AbortSignal.timeout(15_000));
if (error) {
  console.error('Album đội chưa sẵn sàng: ' + error.message);
  console.error(
    'Chạy supabase/migrations/202611110001_team_album.sql trong Supabase SQL Editor rồi thử lại. Không cần thêm secret key.',
  );
  process.exitCode = 1;
} else {
  console.log(
    `Album đội: ${data.albums.filter((a) => !a.deleted_at).length} album, ${data.photos.filter((p) => !p.deleted_at).length} ảnh chưa xóa.`,
  );
  console.log(
    data.realtime_enabled
      ? 'Đã bật publication Realtime cho Album đội.'
      : 'CHƯA bật Realtime cho team_album_sync.',
  );
  console.log(
    'Đây là kiểm tra chỉ đọc. Upload và đồng bộ hai trình duyệt cần nghiệm thu riêng.',
  );
}
