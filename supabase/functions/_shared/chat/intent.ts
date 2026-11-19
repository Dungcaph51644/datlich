import {
  ChatError,
  type ChatPlan,
  type ChatQuestion,
  type ChatSource,
  type ChatContext,
} from './types.ts';

export const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const plus = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86400000);
export function resolvedQuestion(question: ChatQuestion): string {
  const current = normalize(question.message);
  const followup =
    /^(con |vay |the |buoi do|hom do|nguoi do|bao nhieu|ai di|da chot|tuan sau|tuan truoc)/.test(
      current,
    );
  return (
    (followup && question.history.length
      ? normalize(question.history.at(-1)!) + ' '
      : '') + current
  );
}
export function planQuestion(
  question: ChatQuestion,
  now = new Date(),
): ChatPlan {
  const current = normalize(question.message);
  // Re-read facts on every turn. Earlier questions only resolve short follow-ups;
  // previous assistant answers are never reused as evidence.
  const q = resolvedQuestion(question);
  const vn = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const today = new Date(vn + 'T12:00:00Z');
  let start = plus(today, -((today.getUTCDay() + 6) % 7));
  if (/tuan sau|tuan toi/.test(q)) start = plus(start, 7);
  else if (/tuan truoc/.test(q)) start = plus(start, -7);
  let end = plus(start, 6);
  if (/thang (nay|sau|toi|truoc)/.test(q)) {
    const offset = /thang (sau|toi)/.test(q)
      ? 1
      : /thang truoc/.test(q)
        ? -1
        : 0;
    start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1, 12),
    );
    end = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset + 1, 0, 12),
    );
  }
  const dateCount = [
    ...q.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?)\b/g),
  ].length;
  if (dateCount > 1)
    throw new ChatError(
      422,
      'narrow_dates',
      'Bạn hỏi từng ngày hoặc từng buổi giúp mình nhé, để tránh nhầm lịch và bảng phí.',
    );
  const explicitDate =
    q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) ??
    q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (explicitDate) {
    const iso =
      explicitDate[1].length === 4
        ? explicitDate[0]
        : `${explicitDate[3] ?? today.getUTCFullYear()}-${explicitDate[2].padStart(2, '0')}-${explicitDate[1].padStart(2, '0')}`;
    const parsed = new Date(iso + 'T12:00:00Z');
    if (!Number.isNaN(parsed.getTime()) && dateKey(parsed) === iso)
      start = end = parsed;
    else
      throw new ChatError(
        400,
        'date',
        'Ngày bạn nhập chưa hợp lệ. Bạn ghi ngày theo dạng ngày/tháng/năm nhé.',
      );
  } else if (/ngay mai|hom nay|hom qua/.test(q)) {
    start = end = plus(
      today,
      /ngay mai/.test(q) ? 1 : /hom qua/.test(q) ? -1 : 0,
    );
  } else {
    const weekday = q.match(
      /thu\s*(hai|ba|tu|nam|sau|bay|2|3|4|5|6|7)\b|chu nhat/,
    );
    if (weekday && /thang (nay|sau|toi|truoc)/.test(q))
      throw new ChatError(
        422,
        'narrow_dates',
        'Bạn cho mình ngày cụ thể hoặc thứ kèm tuần nhé, để chọn đúng buổi trong tháng.',
      );
    if (weekday) {
      const offset = weekday[0].includes('chu nhat')
        ? 6
        : (
            {
              hai: 0,
              ba: 1,
              tu: 2,
              nam: 3,
              sau: 4,
              bay: 5,
              '2': 0,
              '3': 1,
              '4': 2,
              '5': 3,
              '6': 4,
              '7': 5,
            } as Record<string, number>
          )[weekday[1]];
      start = end = plus(start, offset);
    }
  }
  const scope =
    /huong dan|lam sao|cach (dang ky|them|sua|chot|chia|thanh toan|cap ma)|su dung|chatbot.*(lam|giup)|^(?:hay |giup |vui long )?(?:dang ky|huy dang ky|them (?:buoi|thanh vien)|tao buoi|sua lich|doi gio|ghi nhan thanh toan|xac nhan.*thanh toan)/.test(
      current,
    )
      ? 'guide'
      : /du lich|chuyen di|di choi|homestay/.test(q)
        ? 'travel'
        : /tien|chi phi|con thieu|thieu bao nhieu|con no|can dong|dong bao nhieu|can nop|nop bao nhieu|da tra|da dong|da nop|thanh toan|chia phi|hoan|chot phi|ai (con )?(no|chua dong|chua nop)/.test(
              q,
            )
          ? 'finance'
          : /ai (dat|lo)|phu trach|phan cong|nguoi dat/.test(q)
            ? 'booking'
            : 'schedule';
  const personal =
    /\b(toi|minh|cua em|cua anh|cua chi|em con|anh con|chi con)\b/.test(q);
  const temporal =
    /tuan|thang|thu\s*(hai|ba|tu|nam|sau|bay|[2-7])|chu nhat|hom nay|ngay mai|hom qua|\d[\/-]\d/.test(
      q,
    );
  const allBalances =
    personal && scope === 'finance' && !temporal && !question.activityId;
  if ((scope === 'finance' || scope === 'travel') && !temporal) {
    start = plus(today, -90);
    end = plus(today, 180);
  }
  const referSession = /buoi nay|buoi do|ca nay|san nay/.test(q) && !temporal;
  const referActivity = /nay|do/.test(q) && !temporal;
  return {
    scope,
    start: dateKey(start),
    end: dateKey(end),
    personal,
    allBalances,
    sessionId: referSession ? question.sessionId : null,
    activityId: referActivity ? question.activityId : null,
  };
}

export function contextSources(
  context: ChatContext,
  plan: ChatPlan,
): ChatSource[] {
  const sources: ChatSource[] = [];
  for (const s of context.sessions ?? []) {
    sources.push({
      id: String(s.id),
      label: `${s.date} · ${String(s.start_time).slice(0, 5)} · ${s.venue} · ${s.court}`,
      href:
        '#schedule?session=' +
        encodeURIComponent(String(s.id)) +
        '&week=' +
        s.date,
    });
  }
  for (const a of context.activities ?? []) {
    sources.push({
      id: String(a.id),
      label: `${a.title} · ${a.fee_status === 'finalized' ? 'Đã chốt' : 'Tạm tính'}`,
      href: `#${a.kind === 'trip' ? 'travel' : 'finance'}?activity=${encodeURIComponent(String(a.id))}`,
    });
  }
  if (plan.scope === 'booking')
    sources.push({
      id: 'booking',
      label: 'Xem phân công đặt sân',
      href: '#booking',
    });
  return sources;
}

export const USER_GUIDE = [
  'Chọn tên: nút tên ở đầu trang. Chọn tên chỉ để tra cứu và đăng ký nhanh; không xác minh danh tính.',
  'Đăng ký: Lịch đánh cầu → chi tiết buổi → Đi / Không đi. Chatbot không ghi đăng ký.',
  'Thêm buổi: Lịch đánh cầu → Tạo buổi đánh. Thêm người: Thành viên → Thêm thành viên. Chọn tên trước.',
  'Sửa ngày giờ hoặc trạng thái sân: mở chi tiết buổi → Cập nhật đặt sân. Quyền do API hiện tại kiểm tra.',
  'Phân công CS: xem phụ trách tuần. Nhập mã cá nhân để xác minh; quản trị cấp mã trong Vòng phân công. Mã dùng một lần, hạn 60 ngày khi đã cài cập nhật.',
  'Tiền sân: mở bảng phí của hoạt động. Chỉ số liệu đã chốt mới là khoản phải đóng chính thức; nháp là tạm tính.',
  'Chia tiền: API tính theo người chịu phí, phạm vi từng khoản (chung/ca/sân/người được chọn), số suất, và làm tròn. Phải xem bảng phí cụ thể, không mặc định ai cũng chia đều.',
  'Thanh toán được người có quyền ghi nhận thủ công trong bảng phí. Chatbot không chuyển tiền hoặc xác nhận đã nhận tiền.',
  'Du lịch & sự kiện: mở chuyến để xem lịch, đăng ký, chi phí và chuẩn bị. Chatbot không tự thay đổi.',
].join('\n');
