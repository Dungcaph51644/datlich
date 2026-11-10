import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { configured, message, rpc, selectAll, supabase } from './lib';
import { noteDrafts } from './drafts';
import type { BookingData } from './bookingTypes';
import type { ActivityData } from './activityTypes';
import {
  EMPTY,
  type Account,
  type Attendance,
  type Audit,
  type CourtSession,
  type Member,
  type Roster,
  type Snapshot,
  type QuickSnapshot,
  type SessionTemplate,
  type BulkResult,
} from './types';

const identityKey = 'badminton.selected-member';
const bookingIdentityKey = 'badminton.booking-token';
function rememberedBookingToken() {
  try {
    return localStorage.getItem(bookingIdentityKey);
  } catch {
    return null;
  }
}
function rememberedMember() {
  try {
    return localStorage.getItem(identityKey);
  } catch {
    return null;
  }
}

export function useClub() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(configured);
  const [online, setOnline] = useState(navigator.onLine);
  const [realtime, setRealtime] = useState(false);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'failed'
  >('idle');
  const [notice, setNotice] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(
    rememberedMember,
  );
  const [quickReady, setQuickReady] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [activityError, setActivityError] = useState('');
  const [bookingToken, setBookingToken] = useState<string | null>(
    rememberedBookingToken,
  );
  const bookingTokenRef = useRef(bookingToken);
  const bookingReady = data.booking !== null;
  const bookingRealtimeReady = data.booking?.realtime_enabled ?? true;
  const pendingWrites = useRef(0);
  const failedBatch = useRef(false);
  const sequence = useRef(0);
  const authIdentity = useRef<string | null>(null);

  // Network state is useful even before a backend has been configured.
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => {
      setOnline(false);
      setRealtime(false);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (noteDrafts.size) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    const identityChanged = (event: StorageEvent) => {
      if (event.key === bookingIdentityKey) {
        bookingTokenRef.current = event.newValue;
        setBookingToken(event.newValue);
      }
    };
    window.addEventListener('storage', identityChanged);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('storage', identityChanged);
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const receiveUser = (nextUser: User | null) => {
      if (authIdentity.current !== (nextUser?.id ?? null)) {
        sequence.current++;
        setLoading(true);
        setData(EMPTY);
      }
      authIdentity.current = nextUser?.id ?? null;
      setUser(nextUser);
    };
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setError(error.message);
      receiveUser(data.session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // Token refresh must not erase the loaded roster. Only changing
        // identity immediately clears private data.
        receiveUser(session?.user ?? null);
      },
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    if (!supabase || !navigator.onLine) {
      setLoading(false);
      return;
    }
    const seq = ++sequence.current;
    try {
      const quick = await supabase.rpc('get_quick_snapshot');
      if (quick.error && !['PGRST202', '42883'].includes(quick.error.code))
        throw quick.error;
      let snapshot = quick.error ? null : (quick.data as QuickSnapshot);
      let booking: BookingData | null = null;
      let bookingProblem = '';
      let activities: ActivityData | null = null;
      let activityProblem = '';
      if (snapshot && snapshot.version >= 2) {
        const result = await supabase.rpc('get_booking_snapshot', {
          p_token: bookingTokenRef.current,
        });
        if (result.error) bookingProblem = message(result.error);
        else {
          booking = result.data as BookingData;
          snapshot = booking.club;
        }
        if (booking && snapshot && snapshot.version >= 3) {
          const result = await supabase.rpc('get_activity_snapshot', {
            p_token: bookingTokenRef.current,
          });
          if (result.error) {
            if (!['PGRST202', '42883'].includes(result.error.code))
              activityProblem = message(result.error);
          } else {
            activities = result.data as ActivityData;
            // Roster and draft amounts originate from the same SQL snapshot.
            snapshot = activities.club ?? snapshot;
          }
        }
      }
      const sessions =
        snapshot?.sessions ??
        (await rpc<CourtSession[]>('get_public_schedule'));
      let account: Account | null = null;
      if (user) {
        const result = await supabase
          .from('account_links')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        if (result.error) throw result.error;
        account = result.data;
      }
      let members: Member[] = snapshot?.members ?? [],
        attendance: Attendance[] = snapshot?.attendance ?? [],
        audits: Audit[] = [],
        templates: SessionTemplate[] = [],
        roster: Roster[] = snapshot?.roster ?? [];
      if (account && !snapshot) {
        const results = await Promise.all([
          selectAll<Member>('members'),
          selectAll<Attendance>('attendance'),
          selectAll<Roster>('session_roster'),
          account.role === 'admin'
            ? supabase
                .from('audit_log')
                .select(
                  'id,actor_name,action,table_name,record_id,changed_fields,created_at',
                )
                .order('id', { ascending: false })
                .limit(80)
            : Promise.resolve({ data: [], error: null }),
        ]);
        for (const r of results) if (r.error) throw r.error;
        members = results[0].data as Member[];
        attendance = results[1].data as Attendance[];
        roster = results[2].data as Roster[];
        audits = results[3].data as Audit[];
        if (!members.some((m) => m.id === account?.member_id && m.active)) {
          account = null;
          members = [];
          attendance = [];
          audits = [];
          roster = [];
        }
      }
      if (snapshot && account?.role === 'admin') {
        const results = await Promise.all([
          supabase
            .from('audit_log')
            .select(
              'id,actor_name,action,table_name,record_id,changed_fields,created_at',
            )
            .order('id', { ascending: false })
            .limit(80),
          supabase.from('session_templates').select('*').order('name'),
        ]);
        for (const result of results) if (result.error) throw result.error;
        audits = results[0].data as Audit[];
        templates = results[1].data as SessionTemplate[];
      }
      if (
        account &&
        !members.some((m) => m.id === account?.member_id && m.active)
      )
        account = null;
      if (seq === sequence.current) {
        setData({
          sessions,
          account,
          members,
          attendance,
          audits,
          roster,
          templates,
          booking,
          activities,
        });
        setBookingError(bookingProblem);
        setActivityError(activityProblem);
        setQuickReady(!!snapshot);
        setError('');
      }
    } catch (err) {
      if (seq === sequence.current) setError(message(err));
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 120);
    };
    void reload();
    const channel = supabase.channel(`club-${user?.id ?? 'public'}`);
    const tables = ['sessions'];
    if (quickReady || user)
      tables.push('members', 'attendance', 'session_roster');
    if (user) {
      tables.push('account_links', 'audit_log');
      if (quickReady) tables.push('session_templates');
    }
    if (bookingReady) tables.push('booking_sync');
    for (const table of tables)
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        refresh,
      );
    channel.subscribe((status) => {
      setRealtime(status === 'SUBSCRIBED' && bookingRealtimeReady);
      if (status === 'SUBSCRIBED') refresh(); // full reconciliation after reconnect
    });
    const connected = () => {
      setOnline(true);
      setRealtime(
        supabase!.realtime.isConnected() &&
          channel.state === 'joined' &&
          bookingRealtimeReady,
      );
      void reload();
    };
    const disconnected = () => {
      setOnline(false);
      setRealtime(false);
    };
    const focused = () => {
      if (!document.hidden) void reload();
    };
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    window.addEventListener('focus', focused);
    document.addEventListener('visibilitychange', focused);
    const reconcile = setInterval(() => {
      if (!document.hidden) void reload();
    }, 30_000);
    return () => {
      sequence.current++;
      clearTimeout(timer);
      clearInterval(reconcile);
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
      window.removeEventListener('focus', focused);
      document.removeEventListener('visibilitychange', focused);
      void supabase!.removeChannel(channel);
    };
  }, [
    reload,
    user,
    quickReady,
    bookingReady,
    bookingToken,
    bookingRealtimeReady,
  ]);

  const memberId = selectedMemberId ?? data.account?.member_id ?? null;
  const me = data.members.find((m) => m.id === memberId && m.active) ?? null;
  useEffect(() => {
    if (!quickReady || loading || !selectedMemberId) return;
    if (!data.members.some((m) => m.id === selectedMemberId && m.active)) {
      setSelectedMemberId(null);
      try {
        localStorage.removeItem(identityKey);
      } catch {
        /* memory fallback */
      }
    }
  }, [quickReady, loading, selectedMemberId, data.members]);
  function chooseMember(id: string | null) {
    if (id && !data.members.some((m) => m.id === id && m.active)) return;
    setSelectedMemberId(id);
    try {
      if (id) localStorage.setItem(identityKey, id);
      else localStorage.removeItem(identityKey);
    } catch {
      /* Safari private mode: use this tab */
    }
  }

  async function run(
    task: () => Promise<unknown>,
    success = 'Đã lưu thay đổi',
    silent = false,
  ) {
    if (!online || !configured) {
      setSaveState('failed');
      setNotice(
        !online
          ? 'Đang mất mạng. Thay đổi chưa được lưu.'
          : 'Chưa cấu hình Supabase.',
      );
      return false;
    }
    if (pendingWrites.current++ === 0) failedBatch.current = false;
    setSaveState('saving');
    if (!silent) setNotice('');
    try {
      await task();
      if (!silent) setNotice(success);
      await reload();
      return true;
    } catch (err) {
      failedBatch.current = true;
      setNotice(message(err));
      // Bring the conflicting server value into the still-open form, keeping
      // its local draft intact so the user can explicitly resolve the conflict.
      await reload();
      return false;
    } finally {
      pendingWrites.current--;
      setSaveState(
        pendingWrites.current
          ? 'saving'
          : failedBatch.current
            ? 'failed'
            : 'saved',
      );
    }
  }
  async function saveAttendance(
    args: Record<string, unknown>,
    success = 'Đã lưu đăng ký',
    silent = false,
  ) {
    const name =
      data.account?.role === 'admin' || !quickReady
        ? 'set_attendance'
        : 'quick_set_attendance';
    return run(() => rpc(name, args), success, silent);
  }
  function bookingRpc<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
  ) {
    return rpc<T>(name, { ...args, p_token: bookingTokenRef.current });
  }
  async function verifyBookingIdentity(code: string) {
    return run(async () => {
      const identity = await rpc<{ token: string }>(
        'activate_booking_identity',
        { p_code: code },
      );
      bookingTokenRef.current = identity.token;
      setBookingToken(identity.token);
      try {
        localStorage.setItem(bookingIdentityKey, identity.token);
      } catch {
        /* keep the verified session in memory */
      }
    }, 'Đã xác minh danh tính cá nhân');
  }
  async function leaveBookingIdentity() {
    return run(async () => {
      await bookingRpc('end_booking_identity');
      bookingTokenRef.current = null;
      setBookingToken(null);
      try {
        localStorage.removeItem(bookingIdentityKey);
      } catch {
        /* memory fallback */
      }
    }, 'Đã đăng xuất danh tính cá nhân trên thiết bị này');
  }
  async function saveMany(
    sessionIds: string[],
    status: string,
  ): Promise<BulkResult[] | null> {
    if (!me) return null;
    let result: BulkResult[] | null = null;
    const ok = await run(
      async () => {
        result = await rpc<BulkResult[]>(
          data.account?.role === 'admin'
            ? 'set_many_attendance'
            : 'quick_set_many_attendance',
          {
            p_session_ids: sessionIds,
            p_member_id: me.id,
            p_status: status,
          },
        );
      },
      'Đã xử lý các ca/sân đã chọn',
      true,
    );
    const rows = result as BulkResult[] | null;
    if (ok && rows) {
      const failures = rows.filter((row) => !row.ok).length;
      if (failures) {
        failedBatch.current = true;
        setSaveState(pendingWrites.current ? 'saving' : 'failed');
        setNotice(
          `${rows.length - failures} ca đã lưu; ${failures} ca chưa lưu. Xem kết quả từng ca bên dưới.`,
        );
      } else setNotice(`Đã lưu ${rows.length} ca/sân.`);
    }
    return ok ? rows : null;
  }
  return {
    ...data,
    user,
    online,
    realtime,
    error,
    loading,
    saveState,
    notice,
    setNotice,
    reload,
    run,
    me,
    memberId: me?.id ?? null,
    quickReady,
    chooseMember,
    saveAttendance,
    saveMany,
    bookingReady,
    bookingError,
    activityError,
    bookingRpc,
    verifyBookingIdentity,
    leaveBookingIdentity,
  };
}
