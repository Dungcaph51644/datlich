import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';

const env = loadEnv('development', process.cwd(), 'VITE_');
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || url.includes('YOUR_PROJECT') || key.includes('YOUR_')) {
  console.error(
    'Chưa có cấu hình thật trong .env. Vite không đọc .env.example.',
  );
  process.exit(1);
}
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error, status } = await client
  .rpc('get_quick_snapshot')
  .abortSignal(AbortSignal.timeout(15000));
if (error) {
  console.error(
    `Chưa bật đăng ký nhanh (HTTP ${status}, ${error.code || 'network'}).`,
  );
  if (['PGRST202', '42883'].includes(error.code))
    console.error(
      'Chạy supabase/migrations/202611100001_quick_registration.sql trong Supabase SQL Editor.',
    );
  else console.error(error.message);
  process.exitCode = 1;
} else {
  if (data.version >= 3) {
    const activities = await client
      .rpc('get_activity_snapshot', { p_token: null })
      .abortSignal(AbortSignal.timeout(15000));
    if (activities.error) {
      console.error('API tài chính / du lịch lỗi: ' + activities.error.message);
      process.exitCode = 1;
    } else {
      console.log(
        `Tài chính / du lịch đã bật: ${activities.data.activities.length} hoạt động. Chi tiết tiền cần danh tính đã xác minh.`,
      );
      if (activities.data.automatic_fees)
        console.log(
          'Đã bật tự tạo bảng phí khi tạo lịch. Bucket tải ảnh cần kiểm tra bằng tệp thật.',
        );
      else
        console.log(
          'Chưa bật tự tạo bảng phí & chọn ảnh từ thiết bị: chạy migration 202611100004_auto_fees_and_covers.sql.',
        );
    }
  } else {
    console.error(
      'Chưa bật tài chính / du lịch. Chạy supabase/migrations/202611100003_finance_travel.sql trong SQL Editor.',
    );
    process.exitCode = 1;
  }
  console.log(
    `Đã kết nối đăng ký nhanh: ${data.members.length} thành viên, ${data.sessions.length} ca/sân, ${data.attendance.length} đăng ký.`,
  );
  if (data.version < 2) {
    console.error('Phân công CS chưa được bật trong cơ sở dữ liệu.');
    console.error(
      'Chạy supabase/migrations/202611100002_booking_responsibility.sql trong Supabase SQL Editor.',
    );
    process.exitCode = 1;
  } else {
    const booking = await client
      .rpc('get_booking_snapshot', { p_token: null })
      .abortSignal(AbortSignal.timeout(15000));
    if (booking.error) {
      console.error(`Không tải được phân công CS: ${booking.error.message}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Phân công CS: ${booking.data.assignments.length} tuần, ${booking.data.rotation.length} người trong vòng.`,
      );
      if (!booking.data.initialized) {
        console.error(
          'Cần liên kết thành viên để khởi tạo lịch: ' +
            booking.data.setup_issues.map((i) => i.name).join(', '),
        );
        process.exitCode = 1;
      }
      if (!booking.data.realtime_enabled) {
        console.error(
          'Chưa bật publication Realtime cho booking_sync. Chạy đầy đủ phần REALTIME ở cuối migration.',
        );
        process.exitCode = 1;
      } else console.log('Đã bật publication Realtime cho phân công CS.');
    }
  }
  console.log(
    process.exitCode
      ? 'Kết nối được Supabase; còn tính năng cần cấu hình như thông báo trên.'
      : 'Kiểm tra API thành công; kiểm thử Realtime giữa hai phiên trình duyệt vẫn cần thực hiện riêng.',
  );
}
