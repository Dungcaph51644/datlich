import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { navigateRoute, readRoute, routeHash, routeMonday, routeUrl, validRouteDate } from '../src/navigation';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://club.example/group/' });
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
beforeEach(() => dom.window.history.replaceState(null, '', '/group/#schedule'));

test('Every navigation destination survives reading the current URL on refresh', () => {
  for (const page of ['schedule', 'members', 'history', 'booking', 'finance', 'travel', 'album', 'tasks'] as const) {
    navigateRoute({ page });
    assert.equal(readRoute().page, page);
    assert.equal(readRoute(dom.window.location.hash).page, page);
  }
  assert.deepEqual(readRoute('#unknown?session=x'), { page: 'schedule', session: 'x' });
});
test('Dated week/day/session links preserve the intended Monday and detail ID', () => {
  const route = readRoute('#schedule?week=2026-11-12&day=2026-11-14&session=buoi-1');
  assert.deepEqual(route, { page: 'schedule', week: '2026-11-09', day: '2026-11-14', session: 'buoi-1' });
  assert.equal(routeMonday('2026-11-15'), '2026-11-09');
  assert.equal(routeMonday('2026-11-16'), '2026-11-16');
  assert.equal(validRouteDate('2026-02-30'), false);
  assert.deepEqual(readRoute('#schedule?week=bad&day=2026-02-30'), { page: 'schedule' });
});
test('Changing page clears stale parameters while patches on the same page merge', () => {
  navigateRoute({ page: 'schedule', week: '2026-11-09', session: 's' });
  navigateRoute({ page: 'finance', activity: 'fee-1' });
  assert.deepEqual(readRoute(), { page: 'finance', activity: 'fee-1' });
  navigateRoute({ activity: 'fee-2' });
  assert.deepEqual(readRoute(), { page: 'finance', activity: 'fee-2' });
  navigateRoute({ activity: undefined });
  assert.deepEqual(readRoute(), { page: 'finance' });
  navigateRoute({ page: 'album', album: 'a', photo: 'p' });
  assert.deepEqual(readRoute(), { page: 'album', album: 'a', photo: 'p' });
  navigateRoute({ photo: undefined });
  assert.deepEqual(readRoute(), { page: 'album', album: 'a' });
});
test('Internal routing notifies subscribers with a browser-realm event and replace does not add history', () => {
  let events = 0;
  const notify = () => events++;
  dom.window.addEventListener('club-route-change', notify);
  const initial = dom.window.history.length;
  navigateRoute({ page: 'tasks' });
  assert.equal(dom.window.history.length, initial + 1);
  navigateRoute({ page: 'members' }, { replace: true });
  assert.equal(dom.window.history.length, initial + 1);
  assert.equal(events, 2);
  dom.window.removeEventListener('club-route-change', notify);
});
test('Back and Forward restore the previous page and selected activity', async () => {
  navigateRoute({ page: 'finance', activity: 'fee-a' });
  navigateRoute({ page: 'travel', activity: 'trip-b' });
  const back = new Promise<void>((resolve) => dom.window.addEventListener('popstate', () => resolve(), { once: true }));
  dom.window.history.back();
  await back;
  assert.deepEqual(readRoute(), { page: 'finance', activity: 'fee-a' });
  const forward = new Promise<void>((resolve) => dom.window.addEventListener('popstate', () => resolve(), { once: true }));
  dom.window.history.forward();
  await forward;
  assert.deepEqual(readRoute(), { page: 'travel', activity: 'trip-b' });
});
test('Shared URLs retain the deployment subdirectory and encode album/photo parameters', () => {
  const url = routeUrl({ page: 'album', album: 'a b', photo: 'p&1' });
  assert.equal(url, 'https://club.example/group/#album?album=a+b&photo=p%261');
  assert.deepEqual(readRoute(new URL(url).hash), { page: 'album', album: 'a b', photo: 'p&1' });
  assert.equal(routeHash({ page: 'booking', activity: 'stale', session: 'stale' }), '#booking');
});
