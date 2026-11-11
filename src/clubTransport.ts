import type { ActivityData } from './activityTypes';
import type { BookingData } from './bookingTypes';
import type { QuickSnapshot } from './types';

export interface SnapshotRpcError {
  code?: string;
  message?: string;
}
export interface SnapshotRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: SnapshotRpcError | null;
  }>;
}
export interface AppSnapshotCapability {
  current: boolean | null;
}
export interface ClubSnapshots {
  snapshot: QuickSnapshot | null;
  booking: BookingData | null;
  activities: ActivityData | null;
  bookingProblem: string;
  activityProblem: string;
}

const absent = (error: SnapshotRpcError) => error.code === 'PGRST202' || error.code === '42883';
const problem = (error: SnapshotRpcError) => error.message || 'Không thể tải dữ liệu mới nhất từ máy chủ.';
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

function quickSnapshot(value: unknown): QuickSnapshot {
  if (!record(value) || !integer(value.version, 1) || !['sessions', 'members', 'attendance', 'roster'].every((key) => Array.isArray(value[key]))) {
    throw new Error('Dữ liệu lịch mới nhất từ máy chủ không hợp lệ. Hãy tải lại hoặc cập nhật cơ sở dữ liệu.');
  }
  return value as unknown as QuickSnapshot;
}

function bookingSnapshot(value: unknown, club: QuickSnapshot): BookingData {
  if (!record(value) || !integer(value.revision) || typeof value.initialized !== 'boolean' || typeof value.realtime_enabled !== 'boolean' || typeof value.identity_expired !== 'boolean' || !(value.verified_member_id === null || typeof value.verified_member_id === 'string') || ![null, 'code', 'account'].includes(value.identity_source as null | string) || !['setup_issues', 'assignments', 'rotation', 'requests', 'notifications', 'history', 'credential_status'].every((key) => Array.isArray(value[key]))) {
    throw new Error('Dữ liệu phân công mới nhất từ máy chủ không hợp lệ. Hãy tải lại hoặc cập nhật cơ sở dữ liệu.');
  }
  return { ...value, club } as unknown as BookingData;
}

function activitySnapshot(value: unknown, club: QuickSnapshot): ActivityData {
  if (!record(value) || !integer(value.version, 1) || !integer(value.revision) || !Array.isArray(value.activities)) {
    throw new Error('Dữ liệu tài chính mới nhất từ máy chủ không hợp lệ. Hãy tải lại hoặc cập nhật cơ sở dữ liệu.');
  }
  return { ...value, club } as unknown as ActivityData;
}

/**
 * One request after the practical-updates migration. Older installations keep
 * their existing staged reads; a missing function is probed only once per app.
 * Permission, connection and malformed-response errors never pretend to be a
 * successfully loaded empty snapshot.
 */
export async function loadClubSnapshots(
  client: SnapshotRpcClient,
  token: string | null,
  capability: AppSnapshotCapability,
): Promise<ClubSnapshots> {
  if (capability.current !== false) {
    const result = await client.rpc('get_app_snapshot', { p_token: token });
    if (!result.error) {
      const data = result.data;
      if (!record(data) || data.version !== 1 || data.practical_updates !== true) {
        throw new Error('Phiên bản dữ liệu ứng dụng từ máy chủ không hợp lệ. Hãy tải lại hoặc cập nhật cơ sở dữ liệu.');
      }
      const snapshot = quickSnapshot(data.club);
      const booking = bookingSnapshot(data.booking, snapshot);
      const activities = activitySnapshot(data.activities, snapshot);
      capability.current = true;
      return { snapshot, booking, activities, bookingProblem: '', activityProblem: '' };
    }
    if (!absent(result.error)) throw result.error;
    capability.current = false;
  }

  const quick = await client.rpc('get_quick_snapshot');
  if (quick.error && !absent(quick.error)) throw quick.error;
  let snapshot = quick.error ? null : quickSnapshot(quick.data);
  let booking: BookingData | null = null;
  let activities: ActivityData | null = null;
  let bookingProblem = '';
  let activityProblem = '';
  if (snapshot && snapshot.version >= 2) {
    const result = await client.rpc('get_booking_snapshot', { p_token: token });
    if (result.error) bookingProblem = problem(result.error);
    else {
      try {
        if (!record(result.data)) throw new Error('Dữ liệu phân công mới nhất từ máy chủ không hợp lệ.');
        const newer = quickSnapshot(result.data.club);
        booking = bookingSnapshot(result.data, newer);
        snapshot = newer;
      } catch (error) {
        bookingProblem = error instanceof Error ? error.message : 'Không thể tải dữ liệu phân công mới nhất.';
      }
    }
    if (booking && snapshot.version >= 3) {
      const result = await client.rpc('get_activity_snapshot', { p_token: token });
      if (result.error) {
        if (!absent(result.error)) activityProblem = problem(result.error);
      } else {
        try {
          if (!record(result.data)) throw new Error('Dữ liệu tài chính mới nhất từ máy chủ không hợp lệ.');
          // The finance RPC reads its roster and draft amounts in one snapshot.
          const newer = result.data.club === undefined ? snapshot : quickSnapshot(result.data.club);
          activities = activitySnapshot(result.data, newer);
          snapshot = newer;
        } catch (error) {
          activityProblem = error instanceof Error ? error.message : 'Không thể tải dữ liệu tài chính mới nhất.';
        }
      }
    }
  }
  return { snapshot, booking, activities, bookingProblem, activityProblem };
}
