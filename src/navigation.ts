import { useSyncExternalStore } from 'react';

export type AppPage = 'schedule' | 'members' | 'history' | 'booking' | 'finance' | 'travel' | 'album' | 'tasks';
export interface AppRoute {
  page: AppPage;
  week?: string;
  day?: string;
  session?: string;
  activity?: string;
  album?: string;
  photo?: string;
}
const pages = new Set<AppPage>(['schedule', 'members', 'history', 'booking', 'finance', 'travel', 'album', 'tasks']);
const eventName = 'club-route-change';

export function validRouteDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function routeMonday(value: string) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function clean(route: AppRoute): AppRoute {
  const result: AppRoute = { page: pages.has(route.page) ? route.page : 'schedule' };
  if (result.page === 'schedule') {
    if (validRouteDate(route.week)) result.week = routeMonday(route.week);
    if (validRouteDate(route.day)) {
      result.day = route.day;
      result.week = routeMonday(route.day);
    }
    if (route.session) result.session = route.session.slice(0, 200);
  }
  if ((result.page === 'finance' || result.page === 'travel') && route.activity) result.activity = route.activity.slice(0, 200);
  if (result.page === 'album') {
    if (route.album) result.album = route.album.slice(0, 200);
    if (route.photo) result.photo = route.photo.slice(0, 200);
  }
  return result;
}
export function readRoute(hash = typeof window === 'undefined' ? '' : window.location.hash): AppRoute {
  const [rawPage, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  return clean({
    page: pages.has(rawPage as AppPage) ? rawPage as AppPage : 'schedule',
    week: params.get('week') ?? undefined,
    day: params.get('day') ?? undefined,
    session: params.get('session') ?? undefined,
    activity: params.get('activity') ?? undefined,
    album: params.get('album') ?? undefined,
    photo: params.get('photo') ?? undefined,
  });
}
export function routeHash(route: AppRoute) {
  const normalized = clean(route);
  const params = new URLSearchParams();
  for (const key of ['week', 'day', 'session', 'activity', 'album', 'photo'] as const) {
    const value = normalized[key];
    if (value) params.set(key, value);
  }
  return '#' + normalized.page + (params.size ? '?' + params.toString() : '');
}
export function routeUrl(route: AppRoute) {
  if (typeof window === 'undefined') return routeHash(route);
  const url = new URL(window.location.href);
  url.hash = routeHash(route);
  return url.href;
}
export function navigateRoute(patch: Partial<AppRoute>, options: { replace?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  const current = readRoute();
  const base = patch.page && patch.page !== current.page ? { page: patch.page } : current;
  const next = routeHash({ ...base, ...patch });
  if (window.location.hash === next) return;
  window.history[options.replace ? 'replaceState' : 'pushState'](null, '', next);
  window.dispatchEvent(new window.Event(eventName));
}
let cachedHash: string | undefined;
let cachedRoute: AppRoute = { page: 'schedule' };
function snapshot() {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = readRoute(hash);
  }
  return cachedRoute;
}
function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  window.addEventListener('popstate', callback);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener('hashchange', callback);
    window.removeEventListener('popstate', callback);
    window.removeEventListener(eventName, callback);
  };
}
const serverRoute: AppRoute = { page: 'schedule' };
export function useAppRoute(): [AppRoute, typeof navigateRoute] {
  return [useSyncExternalStore(subscribe, snapshot, () => serverRoute), navigateRoute];
}
