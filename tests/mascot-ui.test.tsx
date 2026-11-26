import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { JSDOM } from 'jsdom';
import {
  EMPTY,
  type Attendance,
  type CourtSession,
  type Snapshot,
} from '../src/types';
import { MASCOT_PREFERENCES_KEY, registrationMoment } from '../src/mascot';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://test.invalid/',
  pretendToBeVisual: true,
});
let systemReduced = false;
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  localStorage: dom.window.localStorage,
  sessionStorage: dom.window.sessionStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
dom.window.matchMedia = (() => ({
  get matches() {
    return systemReduced;
  },
  addEventListener() {},
  removeEventListener() {},
})) as typeof window.matchMedia;
const { render, screen, fireEvent, cleanup, act } =
  await import('@testing-library/react');
const { ClubMascot, useMascotPreferences } = await import('../src/ClubMascot');
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const session: CourtSession = {
  id: 's',
  session_date: today,
  start_time: '23:58',
  end_time: '23:59:59',
  venue: 'Sân thử',
  court: '1',
  address: '',
  maps_url: '',
  organizer_id: null,
  booking_status: 'booked',
  max_players: 4,
  note: '',
  deadline: null,
  version: 1,
};
const data: Snapshot = {
  ...EMPTY,
  members: [
    {
      id: 'a',
      display_name: 'Yến',
      code: 'A',
      active: true,
      note: '',
      version: 1,
    },
  ],
  sessions: [session],
  roster: [{ session_id: 's', member_id: 'a' }],
};
const after: Snapshot = {
  ...data,
  attendance: [
    {
      id: 'r',
      session_id: 's',
      member_id: 'a',
      status: 'going',
      note: '',
      note_version: 0,
      updated_at: new Date().toISOString(),
    } as Attendance,
  ],
};
const prefs = { hidden: false, motion: true, autoTalk: true, smash: false };
const props = {
  data,
  memberId: 'a',
  ready: true,
  motionEnabled: true,
  preferences: prefs,
  welcomePending: false,
  onPreferences: () => {},
  onOpenSession: () => {},
};
afterEach(() => {
  cleanup();
  mock.timers.reset();
  localStorage.clear();
  sessionStorage.clear();
  systemReduced = false;
  Reflect.deleteProperty(document, 'hidden');
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

test('A new acknowledged event celebrates, preserves keyboard focus and opens the exact session; old snapshots do not replay it', async () => {
  const opened: string[] = [];
  const ui = render(
    <>
      <input aria-label="Đang viết" />
      <ClubMascot {...props} onOpenSession={(id) => opened.push(id)} />
    </>,
  );
  await act(async () => screen.getByLabelText('Đang viết').focus());
  const event = registrationMoment(data, 'a', 'a', ['s'], 'going', 1)!;
  ui.rerender(
    <>
      <input aria-label="Đang viết" />
      <ClubMascot
        {...props}
        data={after}
        moment={event}
        onOpenSession={(id) => opened.push(id)}
      />
    </>,
  );
  assert.match(screen.getByRole('status').textContent ?? '', /Đã lưu/);
  assert.equal(document.activeElement, screen.getByLabelText('Đang viết'));
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'happy',
  );
  fireEvent.click(screen.getByRole('button', { name: /Mở buổi đánh/ }));
  assert.deepEqual(opened, ['s']);
  ui.rerender(
    <>
      <input aria-label="Đang viết" />
      <ClubMascot {...props} data={{ ...after }} moment={event} />
    </>,
  );
  assert.equal(screen.queryByRole('status'), null);
  const historical = render(
    <ClubMascot {...props} data={after} moment={event} />,
  );
  assert.equal(historical.container.querySelector('.mascot-bubble'), null);
});
test('Animation and hiding preferences persist, can be restored and respect both website and device reduced motion', async () => {
  function Harness() {
    const [preferences, update] = useMascotPreferences();
    const [globalMotion, setGlobal] = useState(true);
    return (
      <>
        <button onClick={() => update({ hidden: false })}>Hiện lại</button>
        <button onClick={() => setGlobal(false)}>Giảm hiệu ứng web</button>
        <ClubMascot
          {...props}
          preferences={preferences}
          onPreferences={update}
          motionEnabled={globalMotion}
        />
      </>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Tùy chỉnh linh vật' }));
  fireEvent.click(
    screen.getByRole('switch', { name: 'Chuyển động của Cầu Cầu' }),
  );
  assert.equal(
    document.querySelector('.club-mascot')?.getAttribute('data-animated'),
    'false',
  );
  assert.equal(
    JSON.parse(localStorage.getItem(MASCOT_PREFERENCES_KEY)!).motion,
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: /Ẩn linh vật/ }));
  assert.equal(
    screen.queryByRole('complementary', { name: 'Linh vật Cầu Cầu' }),
    null,
  );
  assert.equal(
    JSON.parse(localStorage.getItem(MASCOT_PREFERENCES_KEY)!).hidden,
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Hiện lại' }));
  fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Tùy chỉnh linh vật' }));
  fireEvent.click(
    screen.getByRole('switch', { name: 'Chuyển động của Cầu Cầu' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Giảm hiệu ứng web' }));
  assert.equal(
    (
      screen.getByRole('switch', {
        name: 'Chuyển động của Cầu Cầu',
      }) as HTMLInputElement
    ).disabled,
    true,
  );
  cleanup();
  systemReduced = true;
  render(<ClubMascot {...props} />);
  assert.equal(
    document.querySelector('.club-mascot')?.getAttribute('data-animated'),
    'false',
  );
});
test('Automatic reminders are bounded, cancelled or stale schedules clear them, and closing with Escape returns focus', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const ui = render(<ClubMascot {...props} />);
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => mock.timers.tick(1801));
  assert.match(screen.getByRole('status').textContent ?? '', /chưa phản hồi/);
  assert.match(screen.getByText(/23:58/).textContent ?? '', /Sân thử/);
  ui.rerender(
    <ClubMascot
      {...props}
      data={{
        ...data,
        sessions: [{ ...session, booking_status: 'cancelled' }],
      }}
    />,
  );
  assert.equal(screen.queryByRole('status'), null);
  ui.rerender(<ClubMascot {...props} ready={false} />);
  await act(async () => mock.timers.tick(10000));
  assert.equal(screen.queryByRole('button', { name: /Mở buổi đánh/ }), null);
  assert.equal(screen.queryByText(/Sân thử/), null);
  fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
  assert.match(screen.getByRole('heading').textContent ?? '', /Cầu Cầu/);
  fireEvent.keyDown(screen.getByRole('heading'), { key: 'Escape' });
  assert.equal(screen.queryByRole('heading'), null);
  assert.equal(
    document.activeElement,
    screen.getByRole('button', { name: /Mở lời nhắn/ }),
  );
});
test('Native and accessible modal dialogs take priority; pending celebrations resume only after closing them', async () => {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  document.body.append(dialog);
  const ui = render(<ClubMascot {...props} />);
  assert.equal(
    (document.querySelector('.club-mascot') as HTMLElement).hidden,
    true,
  );
  const event = registrationMoment(data, 'a', 'a', ['s'], 'going', 1)!;
  ui.rerender(<ClubMascot {...props} data={after} moment={event} />);
  assert.equal(document.querySelector('.mascot-bubble'), null);
  await act(async () => {
    dialog.remove();
  });
  assert.match(screen.getByRole('status').textContent ?? '', /Đã lưu/);
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  await act(async () => {
    document.body.append(modal);
  });
  assert.equal(
    (document.querySelector('.club-mascot') as HTMLElement).hidden,
    true,
  );
  await act(async () => {
    modal.remove();
  });
});

test('A second acknowledged status replaces the previous celebration instead of being cleared with it', () => {
  const ui = render(<ClubMascot {...props} />);
  const going = registrationMoment(data, 'a', 'a', ['s'], 'going', 1)!;
  ui.rerender(<ClubMascot {...props} data={after} moment={going} />);
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'happy',
  );
  const declined = {
    ...after,
    attendance: after.attendance.map((r) => ({
      ...r,
      status: 'not_going' as const,
    })),
  };
  const next = registrationMoment(after, 'a', 'a', ['s'], 'not_going', 2)!;
  ui.rerender(<ClubMascot {...props} data={declined} moment={next} />);
  assert.match(screen.getByRole('status').textContent ?? '', /Đã lưu Không đi/);
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'wave',
  );
});

test('Poking the mascot cycles faces and jokes, preserves button focus and works offline without creating a session action', () => {
  const opened: string[] = [];
  const ui = render(
    <ClubMascot
      {...props}
      ready={false}
      memberId={null}
      onOpenSession={(id) => opened.push(id)}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
  const first = screen.getByRole('status').textContent;
  const poke = screen.getByRole('button', { name: /Chọc Cầu Cầu/ });
  poke.focus();
  const texts = new Set([first]);
  const moods = new Set([
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
  ]);
  for (let i = 1; i < 16; i++) {
    fireEvent.click(poke);
    texts.add(screen.getByRole('status').textContent);
    moods.add(
      document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    );
    assert.equal(document.activeElement, poke);
    assert.equal(screen.queryByRole('button', { name: /Mở buổi đánh/ }), null);
  }
  assert.equal(texts.size, 16);
  assert.deepEqual(moods, new Set(['cheeky', 'cool', 'dizzy', 'love']));
  fireEvent.click(poke);
  assert.equal(screen.getByRole('status').textContent, first);
  ui.rerender(
    <ClubMascot
      {...props}
      ready={false}
      memberId={null}
      motionEnabled={false}
      onOpenSession={(id) => opened.push(id)}
    />,
  );
  assert.equal(
    document.querySelector('.club-mascot')?.getAttribute('data-animated'),
    'false',
  );
  assert.ok(document.querySelector('.shuttle-cheeky-face'));
  assert.deepEqual(opened, []);
});

test('A confirmed registration takes priority over banter and its session link disappears when the session is cancelled', () => {
  const ui = render(<ClubMascot {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
  fireEvent.click(screen.getByRole('button', { name: /Chọc Cầu Cầu/ }));
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'cool',
  );
  const event = registrationMoment(data, 'a', 'a', ['s'], 'going', 1)!;
  ui.rerender(<ClubMascot {...props} data={after} moment={event} />);
  assert.match(
    screen.getByRole('status').textContent ?? '',
    /Đã lưu đăng ký Đi/,
  );
  assert.ok(screen.getByRole('button', { name: /Mở buổi đánh/ }));
  ui.rerender(
    <ClubMascot
      {...props}
      data={{
        ...after,
        sessions: [{ ...session, booking_status: 'cancelled' }],
      }}
      moment={event}
    />,
  );
  assert.doesNotMatch(screen.queryByRole('status')?.textContent ?? '', /Đã lưu/);
  assert.equal(screen.queryByRole('button', { name: /Mở buổi đánh/ }), null);
});

test('A fresh registration notification still expires after an earlier manual conversation was pinned', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const ui = render(<ClubMascot {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
  fireEvent.click(screen.getByRole('button', { name: /Chọc Cầu Cầu/ }));
  const event = registrationMoment(data, 'a', 'a', ['s'], 'going', 1)!;
  ui.rerender(<ClubMascot {...props} data={after} moment={event} />);
  assert.match(
    screen.getByRole('status').textContent ?? '',
    /Đã lưu đăng ký Đi/,
  );
  await act(async () => mock.timers.tick(4799));
  assert.ok(screen.getByRole('status'));
  await act(async () => mock.timers.tick(1));
  assert.equal(screen.queryByRole('status'), null);
});

test('Restoring a hidden mascot does not replay old registrations, and visible toasts reserve space', async () => {
  const event = registrationMoment(data, 'a', 'a', ['s'], 'going', 9)!;
  const ui = render(
    <ClubMascot {...props} preferences={{ ...prefs, hidden: true }} />,
  );
  ui.rerender(
    <ClubMascot
      {...props}
      data={after}
      moment={event}
      preferences={{ ...prefs, hidden: true }}
    />,
  );
  ui.rerender(<ClubMascot {...props} data={after} moment={event} />);
  assert.equal(screen.queryByRole('status'), null);
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.getBoundingClientRect = () => ({ height: 60 }) as DOMRect;
  await act(async () => {
    document.body.append(toast);
  });
  assert.equal(
    (
      document.querySelector('.club-mascot') as HTMLElement
    ).style.getPropertyValue('--mascot-lift'),
    '74px',
  );
  await act(async () => {
    toast.remove();
  });
  assert.equal(
    (
      document.querySelector('.club-mascot') as HTMLElement
    ).style.getPropertyValue('--mascot-lift'),
    '0px',
  );
});

test('Automatic banter appears without clicks, closes on its own, changes idle faces and speaks a different line next time', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  render(
    <>
      <button>Đọc lịch</button>
      <ClubMascot {...props} ready={false} memberId={null} />
    </>,
  );
  const reading = screen.getByRole('button', { name: 'Đọc lịch' });
  reading.focus();
  await act(async () => mock.timers.tick(7999));
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => mock.timers.tick(1));
  const first = screen.getByRole('status').textContent;
  assert.equal(screen.getByRole('status').getAttribute('aria-live'), 'off');
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'cool',
  );
  assert.equal(document.activeElement, reading);
  await act(async () => mock.timers.tick(6500));
  assert.equal(screen.queryByRole('status'), null);
  const initialFace = document
    .querySelector('.mascot-stage')
    ?.getAttribute('data-mood');
  await act(async () => mock.timers.tick(9000));
  assert.notEqual(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    initialFace,
  );
  await act(async () => mock.timers.tick(19000));
  assert.notEqual(screen.getByRole('status').textContent, first);
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'dizzy',
  );
  assert.equal(document.activeElement, reading);
});

test('Typing suppresses automatic jokes, clears a joke already open and restarts the wait when input ends', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  render(
    <>
      <textarea aria-label="Ghi chú" />
      <ClubMascot {...props} ready={false} />
    </>,
  );
  const input = screen.getByRole('textbox', { name: 'Ghi chú' });
  await act(async () => input.focus());
  await act(async () => mock.timers.tick(60000));
  assert.equal(screen.queryByRole('status'), null);
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'idle',
  );
  await act(async () => input.blur());
  await act(async () => mock.timers.tick(8000));
  assert.ok(screen.getByRole('status'));
  await act(async () => input.focus());
  assert.equal(screen.queryByRole('status'), null);
  assert.equal(document.activeElement, input);
  await act(async () => mock.timers.tick(60000));
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => input.blur());
  await act(async () => mock.timers.tick(27999));
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => mock.timers.tick(1));
  assert.ok(screen.getByRole('status'));
});

test('Background tabs and modal dialogs cancel automatic jokes, and resume with a fresh delay rather than a burst', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  render(<ClubMascot {...props} ready={false} />);
  await act(async () => mock.timers.tick(8000));
  assert.ok(screen.getByRole('status'));
  await act(async () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
  });
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => mock.timers.tick(120000));
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
  });
  const modal = document.createElement('div');
  await act(async () => document.body.append(modal));
  await act(async () => {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
  });
  await act(async () => mock.timers.tick(120000));
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => modal.remove());
  await act(async () => mock.timers.tick(27999));
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => mock.timers.tick(1));
  assert.ok(screen.getByRole('status'));
});

test('Fresh schedule reminders interrupt automatic jokes; interacting with a bubble pins it for reading', async () => {
  mock.timers.enable({
    apis: ['Date', 'setTimeout'],
    now: Date.parse(`${today}T12:00:00+07:00`),
  });
  const ui = render(<ClubMascot {...props} ready={false} />);
  await act(async () => mock.timers.tick(8000));
  assert.equal(screen.queryByRole('button', { name: /Mở buổi đánh/ }), null);
  ui.rerender(<ClubMascot {...props} />);
  await act(async () => mock.timers.tick(1800));
  assert.match(screen.getByRole('status').textContent ?? '', /chưa phản hồi/);
  const open = screen.getByRole('button', { name: /Mở buổi đánh/ });
  await act(async () => open.focus());
  await act(async () => mock.timers.tick(60000));
  assert.equal(document.activeElement, open);
  assert.match(screen.getByRole('status').textContent ?? '', /chưa phản hồi/);
});

test('Automatic banter can be disabled persistently without disabling manual jokes; reduced motion stops idle expression cycling', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  function Harness() {
    const [preferences, update] = useMascotPreferences();
    return (
      <ClubMascot
        {...props}
        ready={false}
        preferences={preferences}
        onPreferences={update}
      />
    );
  }
  const ui = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Tùy chỉnh linh vật' }));
  fireEvent.click(
    screen.getByRole('switch', { name: 'Tự động tấu hài của Cầu Cầu' }),
  );
  assert.equal(
    JSON.parse(localStorage.getItem(MASCOT_PREFERENCES_KEY)!).autoTalk,
    false,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Đóng lời nhắn của Cầu Cầu' }),
  );
  await act(async () => mock.timers.tick(120000));
  assert.equal(screen.queryByRole('status'), null);
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'idle',
  );
  ui.unmount();
  render(<Harness />);
  await act(async () => mock.timers.tick(120000));
  assert.equal(screen.queryByRole('status'), null);
  fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
  fireEvent.click(screen.getByRole('button', { name: /Chọc Cầu Cầu/ }));
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'cool',
  );
  cleanup();
  systemReduced = true;
  render(<ClubMascot {...props} ready={false} />);
  await act(async () => mock.timers.tick(8000));
  assert.ok(screen.getByRole('status'));
  assert.equal(
    document.querySelector('.club-mascot')?.getAttribute('data-animated'),
    'false',
  );
  await act(async () => mock.timers.tick(6500));
  await act(async () => mock.timers.tick(9000));
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'idle',
  );
});

test('Opening the website greets once before banter; identity remounts do not replay it, but a fresh page does', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  function Page() {
    const [welcomed, setWelcomed] = useState(false);
    const [identity, setIdentity] = useState('a');
    return (
      <>
        <button onClick={() => setIdentity('b')}>Đổi tên</button>
        <ClubMascot
          {...props}
          key={identity}
          memberId={identity}
          ready={false}
          welcomePending={!welcomed}
          onWelcome={() => setWelcomed(true)}
        />
      </>
    );
  }
  const ui = render(<Page />);
  const change = screen.getByRole('button', { name: 'Đổi tên' });
  change.focus();
  await act(async () => mock.timers.tick(699));
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => mock.timers.tick(1));
  assert.match(
    screen.getByRole('status').textContent ?? '',
    /Xin chào, đồng đội!/,
  );
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'wave',
  );
  assert.equal(document.activeElement, change);
  assert.equal(screen.queryByRole('button', { name: /Mở buổi đánh/ }), null);
  await act(async () => mock.timers.tick(6500));
  assert.equal(screen.queryByRole('status'), null);
  fireEvent.click(change);
  await act(async () => mock.timers.tick(700));
  assert.equal(screen.queryByRole('status'), null);
  ui.unmount();
  render(<Page />);
  await act(async () => mock.timers.tick(700));
  assert.match(
    screen.getByRole('status').textContent ?? '',
    /Xin chào, đồng đội!/,
  );
});

test('The welcome waits for the name dialog, and a saved registration replaces it without replay', async () => {
  mock.timers.enable({
    apis: ['Date', 'setTimeout'],
    now: Date.parse(`${today}T12:00:00+07:00`),
  });
  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  document.body.append(dialog);
  const ui = render(<ClubMascot {...props} welcomePending />);
  await act(async () => mock.timers.tick(2000));
  assert.equal(screen.queryByRole('status'), null);
  await act(async () => dialog.remove());
  await act(async () => mock.timers.tick(700));
  assert.match(screen.getByRole('status').textContent ?? '', /Xin chào/);
  const event = registrationMoment(data, 'a', 'a', ['s'], 'going', 1)!;
  ui.rerender(
    <ClubMascot {...props} data={after} moment={event} welcomePending />,
  );
  assert.match(
    screen.getByRole('status').textContent ?? '',
    /Đã lưu đăng ký Đi/,
  );
  assert.equal(
    document.querySelector('.mascot-stage')?.getAttribute('data-mood'),
    'happy',
  );
  await act(async () => mock.timers.tick(4800));
  await act(async () => mock.timers.tick(700));
  assert.equal(screen.queryByRole('status'), null);
});

test('Welcome respects disabling automatic speech and reduced motion', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  let consumed = 0;
  const ui = render(
    <ClubMascot
      {...props}
      ready={false}
      welcomePending
      preferences={{ ...prefs, autoTalk: false }}
      onWelcome={() => consumed++}
    />,
  );
  await act(async () => mock.timers.tick(700));
  assert.equal(screen.queryByRole('status'), null);
  assert.equal(consumed, 1);
  ui.unmount();
  systemReduced = true;
  render(<ClubMascot {...props} ready={false} welcomePending />);
  await act(async () => mock.timers.tick(700));
  assert.match(screen.getByRole('status').textContent ?? '', /Xin chào/);
  assert.equal(
    document.querySelector('.club-mascot')?.getAttribute('data-animated'),
    'false',
  );
});

test('The second automatic joke performs the smash, and it repeats only after four more automatic jokes', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  render(
    <ClubMascot
      {...props}
      ready={false}
      preferences={{ ...prefs, smash: true }}
    />,
  );
  for (let turn = 1; turn <= 6; turn++) {
    await act(async () => mock.timers.tick(turn === 1 ? 8000 : 28000));
    const overlay = document.querySelector('.mascot-smash');
    if (turn === 2 || turn === 6) {
      assert.ok(overlay);
      assert.equal(overlay.parentElement, document.body);
      assert.equal(overlay.getAttribute('aria-hidden'), 'true');
      assert.ok(overlay.querySelector('.shuttle-angry-face'));
      assert.ok(overlay.querySelector('.mascot-smash-glass'));
      assert.equal(
        document.querySelector('.club-mascot')?.hasAttribute('hidden'),
        true,
      );
      await act(async () => mock.timers.tick(4799));
      assert.ok(document.querySelector('.mascot-smash'));
      await act(async () => mock.timers.tick(1));
      assert.equal(document.querySelector('.mascot-smash'), null);
      assert.match(
        screen.getByRole('status').textContent ?? '',
        /Cầu Cầu nổi quạu/,
      );
    } else {
      assert.equal(overlay, null);
      assert.ok(screen.getByRole('status'));
    }
    await act(async () => mock.timers.tick(6500));
    assert.equal(screen.queryByRole('status'), null);
  }
});

test('The preview expires or dismisses on user input without stopping the underlying action or changing attendance', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  let clicks = 0;
  const before = structuredClone(data);
  render(
    <>
      <button onClick={() => clicks++}>Xem lịch</button>
      <ClubMascot
        {...props}
        ready={false}
        preferences={{ ...prefs, smash: true }}
      />
    </>,
  );
  function preview() {
    fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tùy chỉnh linh vật' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xem cú đập' }));
  }
  preview();
  assert.ok(document.querySelector('.mascot-smash'));
  await act(async () => mock.timers.tick(4800));
  assert.equal(document.querySelector('.mascot-smash'), null);
  preview();
  const button = screen.getByRole('button', { name: 'Xem lịch' });
  fireEvent.pointerDown(button);
  fireEvent.click(button);
  assert.equal(document.querySelector('.mascot-smash'), null);
  assert.equal(clicks, 1);
  assert.deepEqual(data, before);
  preview();
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(document.querySelector('.mascot-smash'), null);
});

test('A running smash stops for a modal, typing, background tabs, motion changes and verified registration feedback', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const enabled = { ...prefs, smash: true };
  for (const reason of [
    'modal',
    'typing',
    'background',
    'motion',
    'saved',
  ] as const) {
    const ui = render(
      <>
        <textarea aria-label="Nội dung" />
        <ClubMascot {...props} ready={false} preferences={enabled} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Mở lời nhắn/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tùy chỉnh linh vật' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xem cú đập' }));
    assert.ok(document.querySelector('.mascot-smash'), reason);
    const modal = document.createElement('dialog');
    if (reason === 'modal')
      await act(async () => {
        modal.setAttribute('open', '');
        document.body.append(modal);
      });
    if (reason === 'typing')
      await act(async () => screen.getByRole('textbox').focus());
    if (reason === 'background')
      await act(async () => {
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new dom.window.Event('visibilitychange'));
      });
    if (reason === 'motion')
      ui.rerender(
        <>
          <textarea aria-label="Nội dung" />
          <ClubMascot
            {...props}
            ready={false}
            motionEnabled={false}
            preferences={enabled}
          />
        </>,
      );
    if (reason === 'saved') {
      const event = registrationMoment(data, 'a', 'a', ['s'], 'going', 1)!;
      ui.rerender(
        <>
          <textarea aria-label="Nội dung" />
          <ClubMascot
            {...props}
            data={after}
            moment={event}
            preferences={enabled}
          />
        </>,
      );
      assert.match(screen.getByRole('status').textContent ?? '', /Đã lưu/);
    }
    assert.equal(document.querySelector('.mascot-smash'), null, reason);
    ui.unmount();
    await act(async () => modal.remove());
    Reflect.deleteProperty(document, 'hidden');
  }
});

test('Reduced motion and individual effect settings prevent automatic fullscreen effects', async () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  for (const reason of [
    'system',
    'website',
    'motion',
    'smash',
    'talk',
    'hidden',
  ] as const) {
    systemReduced = reason === 'system';
    const ui = render(
      <ClubMascot
        {...props}
        ready={false}
        motionEnabled={reason !== 'website'}
        preferences={{
          ...prefs,
          smash: reason !== 'smash',
          motion: reason !== 'motion',
          autoTalk: reason !== 'talk',
          hidden: reason === 'hidden',
        }}
      />,
    );
    await act(async () => mock.timers.tick(8000));
    await act(async () => mock.timers.tick(6500));
    await act(async () => mock.timers.tick(28000));
    assert.equal(document.querySelector('.mascot-smash'), null, reason);
    ui.unmount();
  }
});
