import type {
  ChatContext,
  ChatPlan,
  ChatQuestion,
  ChatSource,
} from './types.ts';
import type { ModelAnswer } from './model.ts';
import { normalize, resolvedQuestion } from './intent.ts';

type Row = Record<string, unknown>;
const attendanceLabels: Record<string, string> = {
  going: 'đã chọn Đi',
  not_going: 'đã chọn Không đi',
  unanswered: 'chưa trả lời',
};
const rows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter(
        (r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r),
      )
    : [];
const text = (value: unknown, fallback = 'chưa có thông tin', max = 110) =>
  typeof value === 'string' && value.trim()
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : fallback;
const number = (value: unknown): number | null => {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER
    ? n
    : null;
};
const money = (value: number) =>
  new Intl.NumberFormat('vi-VN').format(value) + 'đ';
const date = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return 'chưa có ngày';
  return `${value.slice(8)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
};
const time = (value: unknown) =>
  typeof value === 'string' && /^\d{2}:\d{2}/.test(value)
    ? value.slice(0, 5)
    : 'chưa có giờ';
const range = (plan: ChatPlan) =>
  plan.start === plan.end
    ? `ngày ${date(plan.start)}`
    : `từ ${date(plan.start)} đến ${date(plan.end)}`;
const peopleQuestion = (q: string) =>
  /\bai\b|danh sach|nguoi (di|tham gia|dang ky)|thanh vien/.test(q);
const feeReady = (a: Row) =>
  a.calculation_available === true &&
  a.has_expenses === true &&
  (!Array.isArray(a.warnings) || a.warnings.length === 0);
const activityLabel = (a: Row) => {
  const dates = Array.isArray(a.session_dates)
    ? a.session_dates.slice(0, 3).map(date).join(', ')
    : '';
  const when =
    a.kind === 'trip'
      ? `${date(a.start_date)}${a.end_date && a.end_date !== a.start_date ? ' – ' + date(a.end_date) : ''}`
      : dates || 'chưa có ngày buổi đánh';
  return `${text(a.title)} (${when}) · ${a.fee_status === 'finalized' ? 'ĐÃ CHỐT' : 'TẠM TÍNH'}${a.status === 'cancelled' ? ' · ĐÃ HỦY' : ''}`;
};

function guide(q: string): string {
  if (/thanh toan|chuyen khoan|\bqr\b/.test(q))
    return 'Bạn mở Tiền sân hoặc Du lịch → chọn hoạt động → Thanh toán để xem số tiền của tên đang chọn, QR và tài khoản nhận. Kiểm tra người nhận và nhập đúng số tiền trước khi chuyển. Người nhận tiền xác nhận thủ công sau khi kiểm tra giao dịch; xem QR không đánh dấu đã thanh toán.';
  if (/them.*(thanh vien|nguoi)/.test(q))
    return 'Chọn tên của bạn ở đầu website → Thành viên → Thêm thành viên. Trợ lý chỉ hướng dẫn; bạn nhập và lưu tại màn hình đó nhé.';
  if (/(them|tao).*buoi/.test(q))
    return 'Chọn tên của bạn → Lịch đánh cầu → Tạo buổi đánh, điền ngày, giờ và sân rồi lưu. Trợ lý không tự tạo buổi.';
  if (/sua|doi gio|huy buoi/.test(q))
    return 'Mở Lịch đánh cầu → chi tiết đúng buổi → Cập nhật đặt sân. Website sẽ kiểm tra quyền sửa của bạn. Trợ lý không tự đổi hoặc hủy lịch.';
  if (/dang ky/.test(q))
    return 'Chọn tên của bạn → Lịch đánh cầu → mở đúng buổi → Đi hoặc Không đi. Buổi đã hủy hoặc khóa đăng ký không nhận đăng ký mới. Trợ lý chưa ghi đăng ký cho bạn.';
  if (/\bma\b|xac minh|phan cong/.test(q))
    return 'Vào Phân công CS → Nhập mã cá nhân để xác minh. Quản trị viên cấp mã trong Vòng phân công. Chọn tên chỉ xác định người tra cứu; quyền thao tác vẫn theo tài khoản hoặc mã đã xác minh.';
  if (/chia|phi|chot/.test(q))
    return 'Mở Tiền sân → chọn bảng phí → xem từng khoản và người chịu phí. Tiền chia theo phạm vi của khoản chi, số suất và làm tròn đã cấu hình; không mặc định mọi người chia đều. Chỉ bảng ĐÃ CHỐT là khoản phải đóng chính thức; TẠM TÍNH có thể thay đổi.';
  if (/du lich|chuyen di/.test(q))
    return 'Mở Du lịch & sự kiện → chọn chuyến để xem lịch, đăng ký, chi phí và chuẩn bị. Chi tiết người tham gia và thanh toán cần xác minh theo quyền của nhóm.';
  return 'Mình tra cứu dữ liệu nhóm theo các mẫu câu. Bạn thử “Tuần này đánh hôm nào?”, “Ai đặt sân tuần sau?”, “Buổi thứ Ba còn mấy chỗ?”, “Tôi còn thiếu bao nhiêu?” hoặc “Hướng dẫn thanh toán”. Bạn ghi ngày cụ thể để mình chọn đúng buổi nhé.';
}

function schedule(context: ChatContext, plan: ChatPlan, q: string): string[] {
  const sessions = rows(context.sessions);
  const blocks: string[] = [];
  if (plan.scope === 'booking') {
    const assignments = rows(context.assignments);
    blocks.push(
      assignments.length
        ? assignments
            .map(
              (a) =>
                `Tuần ${date(a.week_start)} – ${date(a.week_end)}: ${text(a.organizer)} phụ trách đặt sân.`,
            )
            .join('\n')
        : `Chưa có phân công đặt sân ${range(plan)}.`,
    );
  }
  if (!sessions.length)
    blocks.push(
      `Chưa có buổi đánh được lưu ${range(plan)}. Đây là dữ liệu hiện có, chưa thể khẳng định nhóm không tổ chức đánh.`,
    );
  for (const s of sessions) {
    let line = `${date(s.date)} · ${time(s.start_time)}–${time(s.end_time)} · ${text(s.venue)} · ${text(s.court)}.`;
    if (s.booking_status === 'cancelled') {
      line += ' ĐÃ HỦY, không nhận đăng ký.';
    } else {
      if (s.booking_status === 'pending') line += ' Chưa xác nhận đặt sân.';
      else if (s.booking_status === 'booked') line += ' Đã đặt sân.';
      if (s.registration_closed === true) line += ' Đã khóa đăng ký.';
      const count = number(s.registered_count);
      if (count !== null && count >= 0) line += ` Đã đăng ký: ${count} người.`;
      if (s.registration_closed !== true) {
        const remaining = number(s.remaining_places);
        if (s.max_players == null) line += ' Chưa đặt giới hạn số người.';
        else if (remaining !== null && remaining >= 0)
          line += ` Còn ${remaining} chỗ.`;
        else line += ' Chưa có thông tin số chỗ còn lại.';
      }
    }
    if (plan.scope === 'booking')
      line += ` Phụ trách buổi: ${text(s.organizer)}. ${s.actual_booker ? 'Người thực tế đặt sân: ' + text(s.actual_booker) + '.' : 'Chưa ghi nhận người thực tế đặt sân.'}`;
    if (peopleQuestion(q)) {
      const names = Array.isArray(s.registered_names) ? s.registered_names : [];
      line += names.length
        ? ` Tên đăng ký: ${names
            .slice(0, 12)
            .map((n) => text(n, 'chưa có tên', 40))
            .join(
              ', ',
            )}${s.names_limited || names.length > 12 ? ' (danh sách chưa đầy đủ)' : ''}.`
        : ' Chưa có tên đăng ký trong dữ liệu nhận được.';
    }
    if (plan.personal)
      line += ` ${text(context.selected_member?.name)}: ${attendanceLabels[String(s.my_status)] ?? 'chưa có lựa chọn được ghi nhận'}.`;
    blocks.push(line);
  }
  return blocks;
}

function financialLines(a: Row, plan: ChatPlan, q: string): string[] {
  const lines: string[] = [];
  const ready = feeReady(a);
  const cost = number(a.total_cost);
  if (ready && cost !== null && cost >= 0)
    lines.push(
      `Tổng chi phí ${a.fee_status === 'finalized' ? 'đã chốt' : 'tạm tính'}: ${money(cost)}.`,
    );
  else
    lines.push(
      'Chưa đủ chi phí hoặc dữ liệu phân bổ; chưa thể xác nhận khoản phải đóng.',
    );
  if (/chia|tien san|tien cau|chi phi/.test(q)) {
    const expenses = rows(a.expenses);
    const scopes: Record<string, string> = {
      all: 'chung',
      group: 'theo ca/sân',
      selected: 'người được chọn',
    };
    for (const e of expenses.slice(0, 4)) {
      const actual = number(e.actual);
      lines.push(
        `${text(e.name, 'Khoản chi', 60)}: ${actual === null ? 'chưa có số tiền' : money(actual)} · ${scopes[String(e.scope)] ?? 'chưa rõ phạm vi'}${e.scope === 'group' && e.group ? ' ' + text(e.group, '', 40) : ''}.`,
      );
    }
    if (a.expenses_limited || expenses.length > 4)
      lines.push('Danh sách khoản chi ở đây chưa đầy đủ.');
  }
  if (plan.personal || peopleQuestion(q)) {
    const people = rows(a.people);
    if (!people.length)
      lines.push(
        'Chưa có dòng phân bổ/thanh toán phù hợp; chưa thể kết luận không nợ hoặc đã thanh toán.',
      );
    for (const p of people.slice(0, 6)) {
      const due = number(p.due),
        paid = number(p.net_paid),
        balance = number(p.balance);
      let line = `${text(p.name, 'Thành viên', 45)}: `;
      if (paid !== null) line += `thu ròng đã ghi nhận ${money(paid)}; `;
      if (p.organizer_paid === true)
        line +=
          'đã thanh toán mặc định phần của người phụ trách đặt sân (không phải xác nhận chuyển khoản); ';
      if (ready && due !== null && balance !== null) {
        const label =
          a.fee_status === 'finalized'
            ? 'theo ghi nhận'
            : 'TẠM TÍNH, chưa phải nợ đã chốt';
        line += `phần phải đóng ${money(due)}; ${balance < 0 ? 'cần hoàn' : 'còn thiếu'} ${money(Math.abs(balance))} (${label}).`;
      } else if (
        due === 0 &&
        balance !== null &&
        balance < 0 &&
        paid !== null
      ) {
        line += `cần hoàn theo ghi nhận ${money(-balance)}.`;
      } else line += 'chưa đủ dữ liệu để xác nhận số tiền còn thiếu.';
      lines.push(line);
    }
    if (a.people_limited || people.length > 6)
      lines.push('Danh sách phân bổ/thanh toán ở đây chưa đầy đủ.');
  }
  for (const warning of Array.isArray(a.warnings) ? a.warnings.slice(0, 2) : [])
    lines.push('Lưu ý phân bổ: ' + text(warning, 'chưa đủ dữ liệu', 120) + '.');
  return lines;
}

/** Read-only formatting of the current scoped RPC result. No network/model calls. */
export function answerLookup(
  question: ChatQuestion,
  plan: ChatPlan,
  context: ChatContext,
  sources: ChatSource[],
): ModelAnswer {
  const q = resolvedQuestion(question);
  const blocks: string[] = [];
  let footer = '';
  if (plan.scope === 'guide') blocks.push(guide(normalize(question.message)));
  else if (plan.scope === 'schedule' || plan.scope === 'booking') {
    if (
      !/lich|danh|san|buoi|\bai\b|cho|nguoi|thu\s*(hai|ba|tu|nam|sau|bay|[2-7])|chu nhat|tuan|hom nay|ngay mai|hom qua|\d[\/-]\d/.test(
        q,
      )
    )
      blocks.push(guide(''));
    else blocks.push(...schedule(context, plan, q));
  } else {
    const activities = rows(context.activities);
    if (!activities.length)
      blocks.push(
        `Chưa có ${plan.scope === 'travel' ? 'chuyến đi' : 'bảng phí'} phù hợp ${plan.allBalances ? 'với tên đang chọn trong dữ liệu đã lưu' : range(plan)}. Chưa thể kết luận không có khoản phải đóng.`,
      );
    for (const a of activities) {
      const lines = [activityLabel(a)];
      if (plan.scope === 'travel') {
        lines.push(
          `Địa điểm: ${text(a.location)}. Phụ trách: ${text(a.organizer)}.`,
        );
        const statuses: Record<string, string> = {
          planning: 'đang lên kế hoạch',
          open: 'đang mở',
          closed: 'đã đóng',
          completed: 'đã hoàn thành',
          cancelled: 'đã hủy',
        };
        lines.push(
          'Trạng thái: ' +
            (statuses[String(a.status)] ?? 'chưa có thông tin') +
            '.',
        );
        if (peopleQuestion(q)) {
          if (!context.finance_authorized)
            lines.push(
              'Danh sách người tham gia cần xác minh danh tính tại Phân công CS.',
            );
          else {
            const participants = rows(a.participants);
            const participantStatus: Record<string, string> = {
              going: 'Đi',
              not_going: 'Không đi',
              unanswered: 'chưa trả lời',
            };
            lines.push(
              participants.length
                ? 'Người tham gia: ' +
                    participants
                      .slice(0, 8)
                      .map(
                        (p) =>
                          `${text(p.name, 'chưa có tên', 40)} (${participantStatus[String(p.status)] ?? 'chưa rõ trạng thái'})`,
                      )
                      .join(', ') +
                    '.'
                : 'Chưa có thông tin người tham gia.',
            );
            if (a.participants_limited || participants.length > 8)
              lines.push('Danh sách người tham gia ở đây chưa đầy đủ.');
          }
        }
      }
      if (
        context.finance_authorized &&
        (plan.scope === 'finance' ||
          /tien|phi|thanh toan|con thieu|can dong/.test(q))
      ) {
        lines.push(...financialLines(a, plan, q));
        footer =
          'Số tiền theo ghi nhận trên website, không xác nhận giao dịch ngân hàng. Mở chi tiết để xem phân bổ hoặc thanh toán.';
      } else if (
        plan.scope === 'travel' &&
        /tien|phi|thanh toan|con thieu|can dong/.test(q)
      ) {
        lines.push(
          'Chi phí và thanh toán cần xác minh danh tính tại Phân công CS.',
        );
      }
      blocks.push(lines.join('\n'));
    }
    if (plan.personal && plan.allBalances && activities.length) {
      const complete =
        !context.limited &&
        activities.every(
          (a) =>
            feeReady(a) &&
            !a.people_limited &&
            rows(a.people).length > 0 &&
            rows(a.people).every(
              (p) =>
                number(p.balance) !== null &&
                number(p.due) !== null &&
                number(p.net_paid) !== null,
            ),
        );
      if (complete) {
        const balances = activities
          .filter((a) => a.fee_status === 'finalized')
          .flatMap((a) => rows(a.people).map((p) => number(p.balance)!));
        const outstanding = balances.reduce(
          (sum, n) => sum + Math.max(0, n),
          0,
        );
        const refund = balances.reduce((sum, n) => sum + Math.max(0, -n), 0);
        if (!balances.length)
          blocks.unshift(
            'Chưa có bảng ĐÃ CHỐT phù hợp trong kết quả tra cứu. Các khoản dưới đây là TẠM TÍNH; chưa thể kết luận tổng nợ chính thức.',
          );
        else if (
          Number.isSafeInteger(outstanding) &&
          Number.isSafeInteger(refund)
        )
          blocks.unshift(
            `Theo các bảng ĐÃ CHỐT đã tra cứu, ${text(context.selected_member?.name)} còn thiếu ${money(outstanding)}; cần hoàn ${money(refund)}. Khoản TẠM TÍNH không cộng vào tổng này.`,
          );
      } else
        blocks.unshift(
          'Chưa đủ dữ liệu để cộng tổng tiền còn thiếu. Xem từng khoản bên dưới; khoản TẠM TÍNH có thể thay đổi.',
        );
    }
    if (plan.scope === 'finance' && /chia/.test(q))
      footer +=
        ' Tiền chia theo phạm vi từng khoản, số suất và làm tròn trong bảng phí; không mặc định chia đều.';
  }
  // Keep complete blocks/amounts instead of cutting a sentence or monetary value.
  const visible: string[] = [];
  for (const block of blocks) {
    if ([...visible, block].join('\n\n').length > 3200) break;
    visible.push(block);
  }
  if (visible.length < blocks.length || context.limited)
    visible.push(
      'Kết quả ở đây chưa đầy đủ. Bạn hỏi ngày/buổi cụ thể hoặc mở trang chi tiết để xem tiếp.',
    );
  if (footer) visible.push(footer);
  return { answer: visible.join('\n\n'), source_ids: sources.map((s) => s.id) };
}
