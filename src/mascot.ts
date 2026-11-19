import type { AttendanceStatus, Snapshot } from './types';

export type MascotMood =
  | 'idle'
  | 'happy'
  | 'wave'
  | 'remind'
  | 'cheeky'
  | 'cool'
  | 'dizzy'
  | 'love'
  | 'angry';
export interface RegistrationMoment {
  id: number;
  createdAt: number;
  viewerId: string | null;
  memberId: string;
  sessionIds: string[];
  status: 'going' | 'not_going';
}
export interface MascotMessage {
  key: string;
  mood: MascotMood;
  title: string;
  text: string;
  detail: string;
  sessionId?: string;
}
export interface MascotPreferences {
  hidden: boolean;
  motion: boolean;
  autoTalk: boolean;
  smash: boolean;
}
export const MASCOT_PREFERENCES_KEY = 'club.mascot.preferences';
export const DEFAULT_MASCOT_PREFERENCES: MascotPreferences = {
  hidden: false,
  motion: true,
  autoTalk: true,
  smash: true,
};

const banter: ReadonlyArray<Pick<MascotMessage, 'mood' | 'title' | 'text'>> = [
  {
    mood: 'cheeky',
    title: 'Cầu Cầu, hệ gáy khét!',
    text: 'Trình cầu chưa biết tới đâu, chứ trình gáy của tôi đủ đánh giải quốc tế rồi nha.',
  },
  {
    mood: 'cool',
    title: 'Kính lên. Aura lên.',
    text: 'Đập cầu chưa chắc qua lưới, nhưng thần thái phải qua tận sân bên.',
  },
  {
    mood: 'dizzy',
    title: 'Ủa, cầu đâu rồi?',
    text: 'Vừa tung chiêu “đập cầu bằng niềm tin”. Niềm tin còn, cầu thì mất tiêu.',
  },
  {
    mood: 'love',
    title: 'Tim này trao đồng đội!',
    text: 'Cầu có thể rơi, phong độ có thể tụt, nhưng tình đồng đội phải căng hơn cước vợt.',
  },
  {
    mood: 'cheeky',
    title: 'Đừng đổ tại tôi nha!',
    text: 'Tôi là quả cầu, không phải cái cớ. Đánh ra ngoài rồi nhìn tôi làm gì, nhìn đường biên kìa!',
  },
  {
    mood: 'cool',
    title: 'Tuyển thủ hệ phong cách',
    text: 'Thở như máy cày, tạo dáng như tuyển thủ. Ảnh đăng lên vẫn phải thật ngầu.',
  },
  {
    mood: 'dizzy',
    title: 'Não đang tải chiến thuật…',
    text: 'Não bảo đập chéo. Tay bảo bỏ nhỏ. Chân bảo về nhà. Đồng đội bảo: “Ủa?”',
  },
  {
    mood: 'love',
    title: 'Thả tim, đừng thả kèo!',
    text: 'Thả thính có thể trượt, thả cầu có thể hụt. Thả một chiếc tim cho đồng đội thì bao trúng!',
  },
  {
    mood: 'cheeky',
    title: 'Bắt bài đối thủ rồi!',
    text: 'Chiến thuật mới: cười thật tươi để đối thủ tưởng mình có chiến thuật.',
  },
  {
    mood: 'cool',
    title: 'Chuyên gia đọc trận',
    text: 'Tôi đọc được mọi đường cầu. Trừ đường cầu đang bay thẳng vào chỗ tôi đứng.',
  },
  {
    mood: 'dizzy',
    title: 'Pin yếu, miệng vẫn khỏe',
    text: 'Chạy ba bước hết pin. Gáy ba hiệp chưa hết chuyện. Một cơ thể, hai hệ điều hành.',
  },
  {
    mood: 'love',
    title: 'Cứ lên sân là có hội!',
    text: 'Đánh hay thì được khen. Đánh hài thì được nhớ. Kiểu gì cũng có chỗ trong tim cả đội.',
  },
  {
    mood: 'cheeky',
    title: 'Bí kíp bất bại đây!',
    text: 'Muốn không thua thì đừng tính điểm. Muốn vui thì nhớ mang tôi lên sân!',
  },
  {
    mood: 'cool',
    title: 'Gáy có kiểm soát',
    text: 'Vợt căng cước, áo căng phong cách. Còn tỷ số thì… mình nói chuyện khác đi.',
  },
  {
    mood: 'dizzy',
    title: 'Xin một giây khởi động lại',
    text: 'Vừa múa bộ chân trong tưởng tượng. Ngoài đời vẫn đứng nhìn cầu rơi đầy nghệ thuật.',
  },
  {
    mood: 'love',
    title: 'Đồng đội ơi, nhận tim!',
    text: 'Một pha cứu cầu đẹp là kỹ năng. Cứu luôn tâm trạng đồng đội là đẳng cấp!',
  },
];

/** A local joke deck: no AI, invented schedule facts, or immediate repeats. */
export function mascotBanter(turn: number): MascotMessage {
  const index = Number.isFinite(turn)
    ? Math.max(0, Math.floor(turn)) % banter.length
    : 0;
  return {
    ...banter[index],
    key: `banter:${index}`,
    detail: 'CẦU CẦU TẤU HÀI · ĐỪNG LẤY LÀM CHIẾN THUẬT',
  };
}

function lineFor(seed: string, lines: readonly string[]) {
  const hash = Array.from(seed).reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
    0,
  );
  return lines[hash % lines.length];
}

export function parseMascotPreferences(
  value: string | null,
): MascotPreferences {
  try {
    const p = JSON.parse(value ?? 'null');
    return {
      hidden: p?.hidden === true,
      motion: p?.motion !== false,
      autoTalk: p?.autoTalk !== false,
      smash: p?.smash !== false,
    };
  } catch {
    return { ...DEFAULT_MASCOT_PREFERENCES };
  }
}

/** Called only AFTER the attendance RPC acknowledges the write, never on snapshot changes. */
export function registrationMoment(
  data: Snapshot,
  viewerId: string | null,
  memberId: unknown,
  sessionIds: string[],
  status: unknown,
  id: number,
): RegistrationMoment | null {
  if (status !== 'going' && status !== 'not_going') return null;
  if (
    typeof memberId !== 'string' ||
    !data.members.some((m) => m.id === memberId && m.active)
  )
    return null;
  const changed = [...new Set(sessionIds)].filter(
    (sid) =>
      data.sessions.some(
        (s) => s.id === sid && s.booking_status !== 'cancelled',
      ) &&
      (data.attendance.find(
        (a) => a.session_id === sid && a.member_id === memberId,
      )?.status ?? 'unanswered') !== status,
  );
  return changed.length
    ? {
        id,
        createdAt: Date.now(),
        viewerId,
        memberId,
        sessionIds: changed,
        status,
      }
    : null;
}

const dayInVietnam = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
const sessionTime = (date: string, time: string) =>
  new Date(`${date}T${time}+07:00`).getTime();
const detail = (session: Snapshot['sessions'][number]) =>
  `${session.session_date.slice(8)}/${session.session_date.slice(5, 7)} · ${session.start_time.slice(0, 5)}–${session.end_time.slice(0, 5)} · ${session.venue}${session.court ? ` · ${session.court}` : ''}`;

export function momentMessage(
  moment: RegistrationMoment,
  data: Snapshot,
  viewerId: string | null,
): MascotMessage | null {
  if (moment.viewerId !== viewerId) return null;
  const member = data.members.find((m) => m.id === moment.memberId && m.active);
  const session = data.sessions.find(
    (s) =>
      s.id === moment.sessionIds[0] &&
      s.booking_status !== 'cancelled' &&
      data.attendance.some(
        (a) =>
          a.session_id === s.id &&
          a.member_id === moment.memberId &&
          a.status === moment.status,
      ),
  );
  if (!member || !session) return null;
  const own = member.id === viewerId;
  const going = moment.status === 'going';
  const full =
    session.max_players != null &&
    session.max_players > 0 &&
    (session.going_count ??
      data.attendance.filter(
        (a) => a.session_id === session.id && a.status === 'going',
      ).length) >= session.max_players;
  return {
    key: `saved:${moment.id}`,
    mood: going ? 'happy' : 'wave',
    title: going
      ? full
        ? 'Đủ đội hình rồi!'
        : 'Chốt kèo, lên sân thôi!'
      : 'Hẹn một chiếc kèo sau!',
    text: own
      ? going
        ? [
            'Đã lưu đăng ký Đi. Mang vợt nha, đừng mang mỗi cái miệng gáy!',
            'Đã lưu đăng ký Đi. Lên sân chạy bằng chân, đừng chạy bằng văn mẫu nha!',
            'Đã lưu đăng ký Đi. Cước vợt đã căng, giờ tới lượt tinh thần!',
            'Đã lưu đăng ký Đi. Hôm nay cầu rơi thì nhặt, liêm sỉ rơi thì… tính sau!',
            'Đã lưu đăng ký Đi. Chuẩn bị những pha cầu khiến cả đội phải hỏi: “Ủa?”',
          ][moment.id % 5]
        : `Đã lưu Không đi. ${
            [
              'Vắng một tay vợt, còn nguyên một cây hài. Hẹn bạn kèo sau!',
              'Cho cây vợt nghỉ phép, cái miệng gáy giữ phong độ nha. Hẹn buổi sau!',
              'Buổi này nghỉ, buổi sau tái xuất như nhân vật chính nha!',
              'Dưỡng sức đi, sân cầu vẫn cần những pha xử lý khó hiểu của bạn!',
            ][moment.id % 4]
          }`
      : `Đã lưu ${going ? 'Đi' : 'Không đi'} cho ${member.display_name}. ${
          going
            ? 'Thêm một tay vợt, thêm một ứng viên đổ tại gió!'
            : 'Cho bạn ấy nghỉ một kèo, giữ slot cây hài trong tim cả đội!'
        }`,
    detail:
      moment.sessionIds.length > 1
        ? `${moment.sessionIds.length} ca/sân đã lưu · ${detail(session)}`
        : detail(session),
    sessionId: session.id,
  };
}

/** Fresh schedule facts only: no reminders for cancelled, ended, declined or full sessions. */
export function mascotReminder(
  data: Snapshot,
  memberId: string | null,
  now = new Date(),
): MascotMessage | null {
  if (!memberId || !data.members.some((m) => m.id === memberId && m.active))
    return null;
  const today = dayInVietnam(now);
  const upcoming = data.sessions
    .filter(
      (s) =>
        s.booking_status !== 'cancelled' &&
        sessionTime(s.session_date, s.end_time) > now.getTime(),
    )
    .sort(
      (a, b) =>
        sessionTime(a.session_date, a.start_time) -
        sessionTime(b.session_date, b.start_time),
    );
  for (const s of upcoming) {
    const status: AttendanceStatus =
      data.attendance.find(
        (a) => a.session_id === s.id && a.member_id === memberId,
      )?.status ?? 'unanswered';
    const eligible = data.roster.some(
      (r) => r.member_id === memberId && r.session_id === s.id,
    );
    if (!eligible || status === 'not_going') continue;
    const key = `${today}:${memberId}:${s.id}:${s.session_date}:${s.start_time}:${s.venue}:${s.booking_status}`;
    if (s.session_date === today && status === 'going')
      return {
        key: `today:${key}`,
        mood: 'wave',
        title: 'Hôm nay mình có hẹn!',
        text:
          s.booking_status === 'pending'
            ? 'Bạn đã chọn Đi. Sân vẫn đang chờ đặt, xem lại tình hình trước khi lên đường nha.'
            : sessionTime(s.session_date, s.start_time) <= now.getTime()
              ? 'Buổi đánh bạn chọn đang diễn ra. Chúc cả đội có những pha cầu thật vui!'
              : lineFor(key, [
                  'Bạn đã chọn Đi. Hôm nay có hẹn với sân, đừng để cây vợt đi còn chủ ở nhà nha!',
                  'Bạn đã chọn Đi. Mang vợt, mang nước, mang cả tinh thần gáy có trách nhiệm nha!',
                  'Bạn đã chọn Đi. Đến sân khởi động chân trước, khởi động miệng gáy sau nha!',
                ]),
        detail: detail(s),
        sessionId: s.id,
      };
  }
  for (const s of upcoming) {
    const status =
      data.attendance.find(
        (a) => a.session_id === s.id && a.member_id === memberId,
      )?.status ?? 'unanswered';
    const count =
      s.going_count ??
      data.attendance.filter(
        (a) => a.session_id === s.id && a.status === 'going',
      ).length;
    if (
      status !== 'unanswered' ||
      !data.roster.some(
        (r) => r.member_id === memberId && r.session_id === s.id,
      ) ||
      sessionTime(s.session_date, s.start_time) <= now.getTime() ||
      sessionTime(s.session_date, s.start_time) - now.getTime() >
        7 * 86400000 ||
      (s.deadline && Date.parse(s.deadline) <= now.getTime()) ||
      (s.max_players != null && count >= s.max_players)
    )
      continue;
    return {
      key: `reply:${today}:${memberId}:${s.id}:${s.session_date}:${s.start_time}:${s.venue}:${s.booking_status}`,
      mood: 'remind',
      title: 'Đồng đội đang chờ một cái gật!',
      text: `Bạn chưa phản hồi buổi này. ${lineFor(
        `${s.id}:${today}:${memberId}`,
        [
          'Ngón tay còn khỏe thì chốt Đi hay Không đi cho đồng đội đỡ bói nha!',
          'Đi hay nghỉ, bấm một cái nha. Cầu Cầu biết bay chứ chưa biết đọc suy nghĩ!',
          'Chốt Đi hay Không đi nha, đừng để đồng đội phải trải bài tìm bạn!',
        ],
      )}${s.booking_status === 'pending' ? ' Sân hiện vẫn đang chờ đặt.' : ''}`,
      detail: detail(s),
      sessionId: s.id,
    };
  }
  return null;
}
