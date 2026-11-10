import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { useClub } from '../src/useClub';
import type { BookingData, BookingSwap } from '../src/bookingTypes';
import type { CourtSession, Member } from '../src/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLDialogElement: dom.window.HTMLDialogElement,
  FormData: dom.window.FormData,
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
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
const { render, screen, fireEvent, waitFor, cleanup, act } =
  await import('@testing-library/react');
const {
  BookingHome,
  BookingPage,
  BookingIdentityForm,
  BookingSessionEditor,
  CSBadge,
  SessionResponsibility,
} = await import('../src/BookingFeatures');
const { dateKey, monday } = await import('../src/lib');
const { bookingWeekEnd, bookingWeekStart } =
  await import('../src/bookingUtils');
type Club = ReturnType<typeof useClub>;
const members: Member[] = [
  {
    id: 'a',
    code: 'CL-0007',
    display_name: 'Nguyên',
    active: true,
    note: '',
    version: 1,
  },
  {
    id: 'b',
    code: 'CL-0009',
    display_name: 'Newbie Long',
    active: true,
    note: '',
    version: 1,
  },
  {
    id: 'c',
    code: 'CL-0012',
    display_name: 'Huệ',
    active: true,
    note: '',
    version: 1,
  },
];
const start = dateKey(monday()),
  next = dateKey(monday(1));
const session: CourtSession = {
  id: 'court',
  session_date: start,
  start_time: '18:00:00',
  end_time: '20:00:00',
  venue: 'Sân kiểm thử',
  court: 'Sân 1',
  address: 'Địa chỉ',
  maps_url: '',
  organizer_id: 'a',
  organizer_mode: 'weekly',
  organizer_name: 'Nguyên',
  booking_status: 'booked',
  booked_by_member_id: 'b',
  booked_by_name: 'Newbie Long',
  estimated_cost: null,
  booking_contact_note: '',
  deposit_note: '',
  max_players: null,
  note: '',
  deadline: null,
  version: 1,
};
const request: BookingSwap = {
  id: 'r',
  from_assignment_id: 'wa',
  to_assignment_id: 'wb',
  from_member_id: 'a',
  to_member_id: 'b',
  from_version: 1,
  to_version: 1,
  from_week_start: start,
  from_week_end: bookingWeekEnd(start),
  to_week_start: next,
  to_week_end: bookingWeekEnd(next),
  reason: 'Đã trao đổi trước',
  status: 'pending',
  created_at: new Date().toISOString(),
  responded_at: null,
  resolved_by_member_id: null,
  resolution_reason: '',
};
function fixture(
  overrides: Partial<Club> = {},
  dataOverrides: Partial<BookingData> = {},
): Club {
  const clubSnapshot = {
    version: 2,
    members,
    sessions: [session],
    attendance: [],
    roster: [],
  };
  const booking: BookingData = {
    revision: 1,
    realtime_enabled: true,
    initialized: true,
    setup_issues: [],
    verified_member_id: 'a',
    identity_source: 'code',
    identity_expired: false,
    club: clubSnapshot,
    assignments: [
      {
        id: 'wa',
        week_start: start,
        week_end: bookingWeekEnd(start),
        member_id: 'a',
        original_member_id: 'a',
        completed_member_id: null,
        completed_at: null,
        version: 1,
        pending_swap_count: 0,
      },
      {
        id: 'wb',
        week_start: next,
        week_end: bookingWeekEnd(next),
        member_id: 'b',
        original_member_id: 'b',
        completed_member_id: null,
        completed_at: null,
        version: 1,
        pending_swap_count: 0,
      },
    ],
    rotation: [],
    requests: [],
    notifications: [],
    history: [],
    credential_status: [],
    ...dataOverrides,
  };
  return {
    ...clubSnapshot,
    booking,
    account: null,
    bookingReady: true,
    bookingError: '',
    memberId: 'b',
    me: members[1],
    online: true,
    loading: false,
    saveState: 'idle',
    notice: '',
    bookingRpc: async () => 'accepted',
    verifyBookingIdentity: async () => true,
    leaveBookingIdentity: async () => true,
    setNotice: () => {},
    reload: async () => {},
    run: async (task) => {
      await task();
      return true;
    },
    ...overrides,
  } as Club;
}
beforeEach(() => {});
afterEach(() => cleanup());

test('CS label follows member ID, survives a not-going response, and remains separate from actual booker', () => {
  const { rerender } = render(<CSBadge session={session} memberId="a" />);
  assert.ok(screen.getByText('CS · Phụ trách đặt sân'));
  rerender(<CSBadge session={session} memberId="b" />);
  assert.equal(screen.queryByText('CS · Phụ trách đặt sân'), null);
  rerender(<SessionResponsibility session={session} />);
  assert.ok(screen.getByText('Nguyên'));
  assert.ok(screen.getByText('Newbie Long'));
  assert.ok(screen.getByText('Theo tuần'));
});
test('Calendar dates always use Monday to Sunday including a month and year boundary', () => {
  assert.equal(bookingWeekStart('2026-12-06'), '2026-11-30');
  assert.equal(bookingWeekEnd('2026-11-30'), '2026-12-06');
  assert.equal(bookingWeekStart('2027-01-03'), '2026-12-28');
});
test('Home uses the verified person for swap rights even when the quick-registration name is somebody else', () => {
  render(<BookingHome club={fixture()} onManage={() => {}} />);
  assert.ok(screen.getByText('Phụ trách tuần này'));
  assert.ok(screen.getByText('Phụ trách tuần sau'));
  assert.equal(
    screen.getAllByRole('button', { name: 'Đề nghị đổi lượt' }).length,
    1,
  );
  assert.ok(screen.getByText('Đã xác minh: Nguyên'));
});
test('Unverified name selection cannot reveal confirmation controls or private requests', () => {
  render(
    <BookingHome
      club={fixture(
        {},
        { verified_member_id: null, identity_source: null, requests: [] },
      )}
      onManage={() => {}}
    />,
  );
  assert.equal(
    screen.queryByRole('button', { name: 'Đề nghị đổi lượt' }),
    null,
  );
  assert.equal(screen.queryByRole('button', { name: 'Đồng ý đổi lượt' }), null);
  assert.ok(screen.getByRole('button', { name: 'Nhập mã' }));
});
test('Only the verified recipient sees accept/reject; clicking waits for the server and sends no member ID', async () => {
  let release!: () => void;
  let called: Record<string, unknown> | undefined;
  let resolved = false;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const c = fixture(
    {
      bookingRpc: (async (_name, args) => {
        called = args;
        await gate;
        resolved = true;
        return 'accepted';
      }) as Club['bookingRpc'],
    },
    { verified_member_id: 'b', requests: [request] },
  );
  const before = JSON.stringify(c.booking?.assignments);
  render(<BookingHome club={c} onManage={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Đồng ý đổi lượt' }));
  assert.equal(resolved, false);
  assert.equal(JSON.stringify(c.booking?.assignments), before);
  assert.deepEqual(called, { p_request_id: 'r', p_decision: 'accept' });
  await act(async () => {
    release();
    await gate;
  });
  assert.equal(resolved, true);
});
test('Failed identity verification keeps the form open; success alone closes it', async () => {
  let accepted = false,
    closed = 0,
    received = '';
  const c = fixture({
    verifyBookingIdentity: async (code) => {
      received = code;
      return accepted;
    },
  });
  render(
    <BookingIdentityForm
      club={c}
      close={() => {
        closed++;
      }}
    />,
  );
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Mã xác minh cá nhân' }),
    { target: { value: '  personal-code  ' } },
  );
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Xác minh và ghi nhớ thiết bị' })
      .closest('form')!,
  );
  await waitFor(() => assert.equal(received, 'personal-code'));
  assert.equal(closed, 0);
  accepted = true;
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Xác minh và ghi nhớ thiết bị' })
      .closest('form')!,
  );
  await waitFor(() => assert.equal(closed, 1));
});
test('Responsible person patches only the booking field just edited', async () => {
  let args: Record<string, unknown> | undefined,
    closed = false;
  const c = fixture({
    bookingRpc: (async (_name, received) => {
      args = received;
      return 'court';
    }) as Club['bookingRpc'],
  });
  render(
    <BookingSessionEditor
      session={session}
      club={c}
      close={() => {
        closed = true;
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Ghi chú liên hệ đặt sân'), {
    target: { value: 'Đã gọi chủ sân' },
  });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Lưu thông tin sân' }).closest('form')!,
  );
  await waitFor(() => assert.equal(closed, true));
  assert.deepEqual(args, {
    p_id: 'court',
    p_patch: { booking_contact_note: 'Đã gọi chủ sân' },
    p_expected_version: 1,
  });
});
test('Proposal clearly distinguishes unknown history from confirmed zero and cannot start with unknown active eligible people', () => {
  const c = fixture(
    { account: { user_id: 'admin', member_id: 'a', role: 'admin' } },
    {
      rotation: [
        {
          member_id: 'a',
          eligible: true,
          sort_order: 1,
          history_status: 'unknown',
          initial_completed_count: 0,
          baseline_through: '2026-11-08',
          initial_last_week: null,
          version: 1,
          completed_count: 0,
          planned_count: 0,
          last_week: null,
        },
      ],
    },
  );
  render(<BookingPage club={c} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Đề xuất lịch phân công' }),
  );
  assert.ok(screen.getByText('Cần xác nhận lịch sử trước khi đề xuất'));
  assert.equal(
    (
      screen.getByRole('button', {
        name: 'Lập bản đề xuất',
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
});
