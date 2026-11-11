import { useCallback, useEffect, useRef, useState } from 'react';
import { configured, message, supabase } from './lib';
import type { TeamAlbumSnapshot } from './albumTypes';

export interface AlbumTransport {
  configured: boolean;
  load: () => Promise<TeamAlbumSnapshot>;
  subscribe: (
    change: () => void,
    status: (connected: boolean) => void,
  ) => () => void;
}
const transport: AlbumTransport = {
  configured,
  load: async () => {
    const { data, error } = await supabase!
      .rpc('get_team_album_snapshot')
      .abortSignal(AbortSignal.timeout(15_000));
    if (error) throw error;
    return data as TeamAlbumSnapshot;
  },
  subscribe(change, status) {
    if (!supabase) return () => {};
    const channel = supabase
      .channel(`team-album-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_album_sync' },
        change,
      )
      .subscribe((state) => {
        status(state === 'SUBSCRIBED');
        if (state === 'SUBSCRIBED') change();
      });
    return () => {
      void supabase!.removeChannel(channel);
    };
  },
};

export function useTeamAlbum(api: AlbumTransport = transport) {
  const [data, setData] = useState<TeamAlbumSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const mounted = useRef(false);
  const generation = useRef(0);
  const pending = useRef(0);
  const failed = useRef(false);
  const ready = useRef(false);
  const revision = useRef(-1);
  const reload = useCallback(async () => {
    const sequence = ++generation.current;
    if (!api.configured) {
      if (mounted.current) {
        setLoading(false);
        setError('Chưa cấu hình kết nối Supabase.');
      }
      return;
    }
    if (!navigator.onLine) {
      if (mounted.current) setLoading(false);
      return;
    }
    try {
      const snapshot = await api.load();
      if (
        !snapshot ||
        snapshot.version !== 1 ||
        !Array.isArray(snapshot.albums) ||
        !Array.isArray(snapshot.photos)
      ) {
        throw new Error('Máy chủ trả về dữ liệu album không hợp lệ.');
      }
      if (mounted.current && sequence === generation.current) {
        if (snapshot.revision < revision.current) return;
        revision.current = snapshot.revision;
        ready.current = true;
        setData(snapshot);
        setError('');
      }
    } catch (cause) {
      if (mounted.current && sequence === generation.current) {
        const detail = message(cause);
        setError(
          /get_team_album_snapshot|schema cache|does not exist/i.test(detail)
            ? 'Backend chưa có chức năng Album đội. Cần chạy migration album trên Supabase rồi bấm Thử kết nối lại.'
            : detail,
        );
      }
    } finally {
      if (mounted.current && sequence === generation.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void reload();
      }, 100);
    };
    const reconnect = () => {
      setOnline(true);
      void reload();
    };
    const offline = () => {
      setOnline(false);
    };
    const visible = () => {
      if (!document.hidden) void reload();
    };
    const focus = () => {
      if (ready.current) refreshSoon();
    };
    void reload();
    const unsubscribe = api.subscribe(refreshSoon, (value) => {
      if (mounted.current) setConnected(value);
    });
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    const reconciliation = setInterval(() => {
      if (ready.current && !document.hidden && navigator.onLine) void reload();
    }, 30_000);
    return () => {
      mounted.current = false;
      ++generation.current;
      clearTimeout(timer);
      clearInterval(reconciliation);
      unsubscribe();
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [api, reload]);

  const write = useCallback(
    async (task: () => Promise<unknown>, success = 'Đã lưu thay đổi') => {
      if (!api.configured || !navigator.onLine) {
        setNotice(
          !api.configured
            ? 'Chưa cấu hình Supabase. Dữ liệu chưa được lưu.'
            : 'Mất kết nối mạng. Dữ liệu chưa được lưu.',
        );
        setSaveState('error');
        return false;
      }
      if (pending.current === 0) failed.current = false;
      ++pending.current;
      setSaveState('saving');
      setNotice('');
      try {
        await task();
        if (mounted.current && !failed.current) setNotice(success);
        await reload();
        return true;
      } catch (cause) {
        failed.current = true;
        if (mounted.current) setNotice(message(cause));
        await reload();
        return false;
      } finally {
        --pending.current;
        if (mounted.current)
          setSaveState(
            pending.current ? 'saving' : failed.current ? 'error' : 'saved',
          );
      }
    },
    [api, reload],
  );
  return {
    data,
    loading,
    online,
    connected: online && connected && !!data?.realtime_enabled,
    error,
    notice,
    saveState,
    write,
    reload,
    available: api.configured && !!data,
  };
}
