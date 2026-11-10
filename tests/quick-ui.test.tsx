import { test, beforeEach, afterEach } from 'node:test';
import React from 'react';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Attendance, CourtSession, Member } from '../src/types';
import type { useClub } from '../src/useClub';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}
const { render, screen, fireEvent, waitFor, cleanup, act } =
  await import('@testing-library/react');
const { AutoNote, MemberPicker, QuickRegistration } =
  await import('../src/QuickRegistration');
const { noteDrafts, resetNoteDrafts } = await import('../src/drafts');
type Club = ReturnType<typeof useClub>;
const member: Member = {
  id: 'member-a',
  code: 'CL-0001',
  display_name: 'Dũng',
  note: '',
  active: true,
  version: 1,
};
const session: CourtSession = {
  id: 'session-a',
  session_date: '2099-11-09',
  start_time: '18:00:00',
  end_time: '20:00:00',
  venue: 'Sân kiểm thử',
  court: 'Ca 1',
  address: '',
  maps_url: '',
  organizer_id: null,
  booking_status: 'booked',
  max_players: 4,
  note: '',
  deadline: null,
  version: 1,
};
const attendance = (note: string, version: number): Attendance => ({
  id: 'row-a',
  session_id: session.id,
  member_id: member.id,
  status: 'going',
  note,
  note_version: version,
  updated_at: '2099-11-01T00:00:00Z',
});
function club(overrides: Partial<Club> = {}): Club {
  return {
    me: member,
    memberId: member.id,
    members: [member],
    sessions: [session],
    attendance: [],
    roster: [{ session_id: session.id, member_id: member.id }],
    account: null,
    quickReady: true,
    online: true,
    saveState: 'idle',
    saveAttendance: async () => true,
    chooseMember: () => {},
    ...overrides,
  } as Club;
}
beforeEach(() => {
  resetNoteDrafts();
});
afterEach(() => {
  cleanup();
  resetNoteDrafts();
});

test('Name picker needs one click and uses member ID even when names match', () => {
  let picked: string | null = null,
    done = false;
  const c = club({
    memberId: null,
    me: null,
    members: [member, { ...member, id: 'member-b', code: 'CL-0002' }],
    chooseMember: (id) => {
      picked = id;
    },
  });
  render(
    <MemberPicker
      club={c}
      onDone={() => {
        done = true;
      }}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm tên của bạn' }), {
    target: { value: 'CL-0002' },
  });
  fireEvent.click(screen.getByRole('button', { name: /CL-0002/ }));
  assert.equal(picked, 'member-b');
  assert.equal(done, true);
  assert.equal(screen.queryByRole('textbox', { name: /email/i }), null);
});

test('Status remains unconfirmed while saving; note auto-save does not disable status buttons', async () => {
  let complete!: (value: boolean) => void;
  let args: Record<string, unknown> | null = null;
  const c = club({
    saveState: 'saving',
    saveAttendance: async (value) => {
      args = value;
      return new Promise<boolean>((resolve) => {
        complete = resolve;
      });
    },
  });
  render(
    <QuickRegistration
      session={session}
      club={c}
      onChoose={() => {}}
      compact
    />,
  );
  const going = screen.getByRole('button', {
    name: 'Đi',
    exact: true,
  }) as HTMLButtonElement;
  assert.equal(going.disabled, false);
  fireEvent.click(going);
  assert.equal(going.getAttribute('aria-pressed'), 'false');
  assert.equal(going.disabled, true);
  assert.ok(screen.getByText('Đang lưu…'));
  assert.equal((args as unknown as Record<string, unknown>).p_status, 'going');
  await act(async () => {
    complete(true);
  });
  assert.equal(going.disabled, false);
});

test('Note autosaves after pause and shows saved only after server confirmation', async () => {
  let complete!: (value: boolean) => void;
  const calls: Record<string, unknown>[] = [];
  const c = club({
    saveAttendance: async (args) => {
      calls.push(args);
      return new Promise<boolean>((resolve) => {
        complete = resolve;
      });
    },
  });
  render(<AutoNote session={session} memberId={member.id} club={c} />);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Đến muộn 15 phút' },
  });
  await waitFor(() => assert.equal(calls.length, 1), { timeout: 2000 });
  assert.ok(screen.getByText('Đang lưu…'));
  assert.equal(screen.queryByText('Đã lưu'), null);
  assert.equal(calls[0].p_status, null);
  assert.equal(calls[0].p_note, 'Đến muộn 15 phút');
  assert.equal(calls[0].p_expected_note_version, 0);
  await act(async () => {
    complete(true);
  });
  await waitFor(() => assert.ok(screen.getByText('Đã lưu')));
  assert.equal(noteDrafts.size, 0);
});

test('Failed auto-save retains draft through unmount and explicit retry', async () => {
  let succeed = false,
    calls = 0;
  const c = club({
    saveAttendance: async () => {
      calls++;
      return succeed;
    },
  });
  const first = render(
    <AutoNote session={session} memberId={member.id} club={c} />,
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Bản nháp không được mất' },
  });
  fireEvent.blur(screen.getByRole('textbox'));
  await waitFor(() =>
    assert.ok(screen.getByRole('button', { name: 'Thử lại' })),
  );
  assert.equal(
    noteDrafts.get(`${session.id}:${member.id}`)?.text,
    'Bản nháp không được mất',
  );
  first.unmount();
  render(<AutoNote session={session} memberId={member.id} club={c} />);
  assert.equal(
    (screen.getByRole('textbox') as HTMLTextAreaElement).value,
    'Bản nháp không được mất',
  );
  succeed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => assert.ok(screen.getByText('Đã lưu')));
  assert.ok(calls >= 2);
  assert.equal(noteDrafts.size, 0);
});

test('Incoming conflicting note preserves local draft and requires explicit choice', async () => {
  const calls: Record<string, unknown>[] = [];
  const c = club({
    saveAttendance: async (args) => {
      calls.push(args);
      return true;
    },
  });
  const ui = render(
    <AutoNote
      session={session}
      memberId={member.id}
      row={attendance('Ban đầu', 1)}
      club={c}
    />,
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Bản tôi đang gõ' },
  });
  ui.rerender(
    <AutoNote
      session={session}
      memberId={member.id}
      row={attendance('Bản từ thiết bị khác', 2)}
      club={c}
    />,
  );
  assert.equal(
    (screen.getByRole('textbox') as HTMLTextAreaElement).value,
    'Bản tôi đang gõ',
  );
  assert.ok(screen.getByText('Bản từ thiết bị khác'));
  assert.equal(calls.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Giữ bản của tôi' }));
  await waitFor(() => assert.equal(calls.length, 1), { timeout: 2000 });
  assert.equal(calls[0].p_note, 'Bản tôi đang gõ');
  assert.equal(calls[0].p_expected_note_version, 2);
});

test('Offline draft is not sent; reconnect resumes pending note', async () => {
  const calls: Record<string, unknown>[] = [];
  const c = club({
    saveAttendance: async (args) => {
      calls.push(args);
      return true;
    },
  });
  const ui = render(
    <AutoNote session={session} memberId={member.id} club={c} />,
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Chờ có mạng' },
  });
  ui.rerender(
    <AutoNote session={session} memberId={member.id} club={c} disabled />,
  );
  assert.ok(screen.getByText('Mất mạng · ghi chú chưa được lưu'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 800));
  });
  assert.equal(calls.length, 0);
  ui.rerender(<AutoNote session={session} memberId={member.id} club={c} />);
  await waitFor(() => assert.equal(calls.length, 1), { timeout: 2000 });
  assert.equal(calls[0].p_note, 'Chờ có mạng');
});

test('Clean note follows server changes without generating another write', () => {
  let calls = 0;
  const c = club({
    saveAttendance: async () => {
      calls++;
      return true;
    },
  });
  const ui = render(
    <AutoNote
      session={session}
      memberId={member.id}
      row={attendance('Cũ', 1)}
      club={c}
    />,
  );
  ui.rerender(
    <AutoNote
      session={session}
      memberId={member.id}
      row={attendance('Mới', 2)}
      club={c}
    />,
  );
  assert.equal(
    (screen.getByRole('textbox') as HTMLTextAreaElement).value,
    'Mới',
  );
  assert.equal(calls, 0);
});

test('Two mounted editors share a draft and serialize saves when one editor unmounts', async () => {
  const calls: Record<string, unknown>[] = [];
  const resolvers: ((value: boolean) => void)[] = [];
  const c = club({
    saveAttendance: async (args) => {
      calls.push(args);
      return new Promise<boolean>((resolve) => resolvers.push(resolve));
    },
  });
  const ui = render(
    <>
      <AutoNote key="one" session={session} memberId={member.id} club={c} />
      <AutoNote key="two" session={session} memberId={member.id} club={c} />
    </>,
  );
  fireEvent.change(screen.getAllByRole('textbox')[0], {
    target: { value: 'Bản đầu' },
  });
  assert.equal(
    (screen.getAllByRole('textbox')[1] as HTMLTextAreaElement).value,
    'Bản đầu',
  );
  await waitFor(() => assert.equal(calls.length, 1), { timeout: 2000 });
  fireEvent.change(screen.getAllByRole('textbox')[1], {
    target: { value: 'Bản sau' },
  });
  ui.rerender(
    <>
      <AutoNote key="two" session={session} memberId={member.id} club={c} />
    </>,
  );
  await act(async () => resolvers[0](true));
  await waitFor(() => assert.equal(calls.length, 2), { timeout: 2000 });
  assert.equal(calls[1].p_note, 'Bản sau');
  assert.equal(calls[1].p_expected_note_version, 1);
  await act(async () => resolvers[1](true));
  await waitFor(() => assert.ok(screen.getByText('Đã lưu')));
  assert.equal(noteDrafts.size, 0);
});
