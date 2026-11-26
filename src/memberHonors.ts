import type { SnapshotRpcClient } from './clubTransport';
import { isMemberAvatarPath } from './memberAvatarUpload';

export const AVATARS = [
  {
    key: 'jerry-smirk',
    name: 'Chuột biết tuốt',
    line: 'Biết hết, chỉ không đỡ được cầu.',
  },
  {
    key: 'smug-cat',
    name: 'Mèo mặt tỉnh',
    line: 'Cầu ra ngoài, thần thái vẫn ở trong.',
  },
  {
    key: 'side-eye-duck',
    name: 'Vịt liếc xéo',
    line: 'Không hụt cầu. Đang nhường thôi.',
  },
  {
    key: 'cheeky-frog',
    name: 'Ếch gáy khét',
    line: 'Trình chưa tới, nụ cười tới trước.',
  },
] as const;
export const BADGES = [
  {
    key: 'first_rally',
    name: 'Kèo đầu đời',
    emoji: '🌱',
    color: 'green',
    criterion: 'Đăng ký Đi ít nhất 1 ngày có buổi đã kết thúc và đã đặt sân.',
    joke: 'Bước vào hội, bước ra có chuyện để gáy.',
    unit: 'ngày đăng ký',
  },
  {
    key: 'regular',
    name: 'Siêng chốt kèo',
    emoji: '🔥',
    color: 'orange',
    criterion: 'Đăng ký Đi 5 ngày khác nhau có buổi đã kết thúc và đã đặt sân.',
    joke: 'Lịch cầu dày hơn lịch hẹn hò.',
    unit: 'ngày đăng ký',
  },
  {
    key: 'veteran',
    name: 'Lão làng chốt kèo',
    emoji: '👑',
    color: 'gold',
    criterion:
      'Đăng ký Đi 20 ngày khác nhau có buổi đã kết thúc và đã đặt sân.',
    joke: 'Cây vợt chưa chắc nhớ, nút Đi chắc chắn nhớ.',
    unit: 'ngày đăng ký',
  },
  {
    key: 'court_keeper',
    name: 'Người giữ sân',
    emoji: '🏸',
    color: 'blue',
    criterion:
      'Được ghi nhận là người thực tế đã đặt ít nhất 1 ca/sân hiện chưa hủy.',
    joke: 'Có bạn giữ sân, cả hội mới có chỗ gáy.',
    unit: 'ca đã đặt',
  },
  {
    key: 'week_keeper',
    name: 'Trụ cột giữ kèo',
    emoji: '🛡️',
    color: 'purple',
    criterion: 'Được xác nhận hoàn thành ít nhất 1 tuần phụ trách đặt sân.',
    joke: 'Gánh kèo chắc tay hơn gánh cầu.',
    unit: 'tuần hoàn thành',
  },
  {
    key: 'comic',
    name: 'Cây hài của tháng',
    emoji: '🎭',
    color: 'pink',
    criterion:
      'Kết thúc tháng, có ít nhất 3 phiếu và đồng hạng cao nhất ở mục Cây hài.',
    joke: 'Đánh hay thì được khen. Đánh hài thì được nhớ.',
    unit: 'tháng được vinh danh',
  },
  {
    key: 'teammate',
    name: 'Đồng đội quốc dân',
    emoji: '💚',
    color: 'green',
    criterion:
      'Kết thúc tháng, có ít nhất 3 phiếu và đồng hạng cao nhất ở mục Đồng đội dễ thương.',
    joke: 'Cầu có thể rơi, đồng đội thì không bỏ.',
    unit: 'tháng được vinh danh',
  },
] as const;
export type BadgeKey = (typeof BADGES)[number]['key'];
export type HonorCategory = 'comic' | 'teammate';
export interface BadgeProgress {
  key: BadgeKey;
  progress: number;
  target: number;
  earned: boolean;
  awarded_month: string | null;
}
export interface MemberStyle {
  member_id: string;
  avatar_key: string;
  avatar_path?: string | null;
  featured_badge: string;
  version: number;
  badges: BadgeProgress[];
}
export interface MemberHub {
  version: 1;
  custom_avatars?: boolean;
  month: string;
  as_of: string;
  viewer_member_id: string | null;
  profiles: MemberStyle[];
  votes: { category: HonorCategory; member_id: string; votes: number }[];
  mine: {
    category: HonorCategory;
    nominee_id: string | null;
    version: number;
  }[];
}
export const avatarPath = (key: string) =>
  AVATARS.some((a) => a.key === key) ? `/avatars/${key}.webp` : '';
export const badgeInfo = (key: string) => BADGES.find((b) => b.key === key);

export function parseMemberHub(value: unknown): MemberHub {
  const v = value as MemberHub | null;
  const integer = (n: unknown) =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (
    !v ||
    v.version !== 1 ||
    (v.custom_avatars !== undefined && typeof v.custom_avatars !== 'boolean') ||
    typeof v.month !== 'string' ||
    !/^\d{4}-\d{2}$/.test(v.month) ||
    typeof v.as_of !== 'string' ||
    !Number.isFinite(Date.parse(v.as_of)) ||
    !(v.viewer_member_id === null || typeof v.viewer_member_id === 'string') ||
    !Array.isArray(v.profiles) ||
    !Array.isArray(v.votes) ||
    !Array.isArray(v.mine) ||
    !v.profiles.every(
      (p) =>
        p &&
        typeof p.member_id === 'string' &&
        typeof p.avatar_key === 'string' &&
        (p.avatar_path == null || isMemberAvatarPath(p.avatar_path)) &&
        typeof p.featured_badge === 'string' &&
        integer(p.version) &&
        Array.isArray(p.badges) &&
        p.badges.length === BADGES.length &&
        new Set(p.badges.map((b) => b?.key)).size === BADGES.length &&
        p.badges.every(
          (b) =>
            b &&
            !!badgeInfo(b.key) &&
            integer(b.progress) &&
            integer(b.target) &&
            b.target > 0 &&
            typeof b.earned === 'boolean' &&
            (b.awarded_month === null ||
              /^\d{4}-\d{2}-01$/.test(b.awarded_month)),
        ),
    ) ||
    !v.votes.every(
      (r) =>
        r &&
        ['comic', 'teammate'].includes(r.category) &&
        typeof r.member_id === 'string' &&
        integer(r.votes),
    ) ||
    !v.mine.every(
      (r) =>
        r &&
        ['comic', 'teammate'].includes(r.category) &&
        (r.nominee_id === null || typeof r.nominee_id === 'string') &&
        integer(r.version),
    )
  )
    throw new Error('Dữ liệu huy hiệu mới nhất không hợp lệ. Hãy tải lại.');
  return v;
}
export async function loadMemberHub(
  client: SnapshotRpcClient,
  token: string | null,
): Promise<{ memberHub: MemberHub | null; memberHubError: string }> {
  try {
    const result = await client.rpc('get_member_hub', { p_token: token });
    if (result.error) {
      if (['PGRST202', '42883'].includes(result.error.code ?? ''))
        throw new Error(
          'Huy hiệu và avatar chưa được bật trên máy chủ. Người quản lý cần cập nhật hệ thống.',
        );
      throw new Error(
        result.error.message || 'Không tải được huy hiệu. Hãy thử lại.',
      );
    }
    return { memberHub: parseMemberHub(result.data), memberHubError: '' };
  } catch (error) {
    return {
      memberHub: null,
      memberHubError:
        error instanceof Error
          ? error.message
          : 'Không tải được huy hiệu. Hãy thử lại.',
    };
  }
}
