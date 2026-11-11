import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { useClub } from '../src/useClub';
import type { ClubActivity } from '../src/activityTypes';
import { buildActivityCsv, buildActivityMessage } from '../src/financeExport';
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
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
const { render, screen, fireEvent, waitFor, cleanup, within, act } =
  await import('@testing-library/react');
const { ActivitiesPage } = await import('../src/ActivityFeatures');
type Club = ReturnType<typeof useClub>;
const members = [
  {
    id: 'a',
    code: 'CL-0001',
    display_name: 'Yến',
    note: '',
    active: true,
    version: 1,
  },
  {
    id: 'b',
    code: 'CL-0002',
    display_name: 'Dũng',
    note: '',
    active: true,
    version: 1,
  },
];
function activity(overrides: Partial<ClubActivity> = {}): ClubActivity {
  return {
    id: 'activity',
    kind: 'badminton',
    title: 'Buổi kiểm thử',
    organizer_id: null,
    details: {},
    status: 'planning',
    fee_status: 'finalized',
    rounding: 1,
    reserve: 0,
    cost_note: '',
    version: 1,
    can_manage: true,
    groups: [
      {
        id: 'g',
        activity_id: 'activity',
        session_id: 's',
        label: 'Ca 1',
        basis: 'shift',
        sort_order: 0,
      },
    ],
    billable: [],
    participants: [],
    expenses: [
      {
        id: 'expense',
        activity_id: 'activity',
        name: 'Sân + cầu',
        category: 'shuttle',
        estimated: 395000,
        actual: 395000,
        scope: 'all',
        group_id: null,
        person_ids: [],
        paid_from: 'unpaid',
        payer_member_id: null,
        note: 'Ghi chú gốc',
        version: 1,
        voided_at: null,
      },
    ],
    ledger: [],
    checklist: [],
    history: [],
    finalizations: [],
    calculation: {
      total_cost: 395000,
      estimated: 395000,
      total_due: 395000,
      surplus: 0,
      headcount: 10,
      shares: 10,
      warnings: [],
      people: [
        {
          id: 'a',
          member_id: 'a',
          name: 'Yến',
          units: 1000,
          groups: ['g'],
          exact: 39500,
          due: 39500,
        },
      ],
      breakdown: [
        {
          expense_id: 'expense',
          name: 'Sân + cầu',
          amount: 395000,
          scope: 'all',
          group_id: null,
          heads: 10,
          units: 10000,
          allocations: [{ person_id: 'a', amount: 39500 }],
        },
      ],
    },
    ...overrides,
  };
}
const calls: { name: string; args: Record<string, unknown> }[] = [];
function fixture(a = activity(), overrides: Partial<Club> = {}): Club {
  return {
    members,
    sessions: [
      {
        id: 's',
        session_date: '2030-05-21',
        start_time: '18:00',
        end_time: '20:00',
        venue: 'Sân thử',
        court: 'Ca 1',
        organizer_id: 'a',
        booking_status: 'booked',
        version: 1,
      },
    ],
    attendance: [],
    account: { role: 'admin', member_id: 'a' },
    booking: { verified_member_id: 'a' },
    activities: { version: 1, revision: 10, activities: [a] },
    online: true,
    saveState: 'idle',
    loading: false,
    notice: '',
    bookingRpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
    },
    run: async (task: () => Promise<unknown>) => {
      await task();
      return true;
    },
    ...overrides,
  } as unknown as Club;
}
beforeEach(() => {
  calls.length = 0;
  window.history.replaceState({}, '', '/');
});
afterEach(() => cleanup());
function openActivity(club: Club, kind: 'badminton' | 'trip' = 'badminton') {
  const view = render(<ActivitiesPage club={club} kind={kind} />);
  fireEvent.click(screen.getByRole('button', { name: /Buổi kiểm thử/ }));
  return view;
}
test('Unconfigured finance states setup honestly and has no fake balances', () => {
  render(
    <ActivitiesPage
      club={fixture(activity(), { activities: null })}
      kind="badminton"
    />,
  );
  assert.ok(screen.getByText('Cần cập nhật cơ sở dữ liệu'));
  assert.equal(screen.queryByText('39.500 ₫'), null);
  assert.equal(screen.queryByRole('button', { name: 'Tạo bảng phí' }), null);
});
test('Server allocation and formula are visible; members cannot confirm receipts', () => {
  openActivity(fixture(activity({ can_manage: false })));
  assert.ok(screen.getAllByText(/39.500/).length);
  assert.ok(screen.getByText('Công thức & từng khoản được chia'));
  assert.equal(screen.queryByRole('button', { name: 'Đã thu đủ' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Chốt tiền' }), null);
});
test('Settle sends one server operation, never a browser-computed amount', async () => {
  openActivity(fixture());
  fireEvent.click(screen.getByRole('button', { name: 'Đã thu đủ' }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].name, 'record_activity_payment');
  assert.equal(calls[0].args.p_kind, 'settle');
  assert.equal(calls[0].args.p_amount, null);
  assert.equal(calls[0].args.p_person, 'a');
  assert.match(String(calls[0].args.p_operation), /^[0-9a-f-]{36}$/);
});
test('Expense form patches only changed cost, retains original version after realtime updates, waits for acknowledgement', async () => {
  const a = activity({ fee_status: 'draft' });
  let resolve: () => void = () => {};
  const pending = new Promise<void>((r) => (resolve = r));
  const club = fixture(a, {
    run: async (task) => {
      await task();
      await pending;
      return true;
    },
  });
  const view = openActivity(club);
  fireEvent.click(screen.getByRole('tab', { name: 'Khoản chi' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sửa Sân + cầu' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Thực tế (đ)'), {
    target: { value: '400000' },
  });
  const newer = activity({
    fee_status: 'draft',
    expenses: [{ ...a.expenses![0], version: 2, note: 'Người khác đã sửa' }],
  });
  view.rerender(
    <ActivitiesPage
      club={{
        ...club,
        activities: { version: 1, revision: 11, activities: [newer] },
      }}
      kind="badminton"
    />,
  );
  fireEvent.submit(
    within(dialog)
      .getByRole('button', { name: 'Lưu khoản chi' })
      .closest('form')!,
  );
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0].args.p_patch, { actual: 400000 });
  assert.equal(calls[0].args.p_expected_version, 1);
  assert.ok(screen.getByRole('dialog'));
  await act(async () => {
    resolve();
    await pending;
  });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
});
test('Failed expense save keeps entered money and the form open', async () => {
  const club = fixture(activity({ fee_status: 'draft' }), {
    run: async () => false,
    saveState: 'failed',
    notice: 'Máy chủ chưa xác nhận',
  });
  openActivity(club);
  fireEvent.click(screen.getByRole('tab', { name: 'Khoản chi' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sửa Sân + cầu' }));
  const d = screen.getByRole('dialog');
  const input = within(d).getByLabelText('Thực tế (đ)') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '500000' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => assert.ok(screen.getByRole('dialog')));
  assert.equal(input.value, '500000');
  assert.ok(within(d).getByRole('alert'));
});
test('Travel shows guests, share units and refunds rather than negative debt', () => {
  const a = activity({
    kind: 'trip',
    organizer_id: 'a',
    can_manage: false,
    participants: [
      {
        id: 'guest',
        activity_id: 'activity',
        member_id: null,
        invited_by: 'a',
        guest_name: 'Bé Long',
        status: 'going',
        note: '',
        billable: true,
        share_units: 500,
        share_reason: 'Trẻ em',
        version: 1,
        updated_at: '2030-01-01T00:00:00Z',
      },
    ],
    ledger: [
      {
        id: 'l',
        activity_id: 'activity',
        operation_id: 'o',
        kind: 'collection',
        person_id: 'guest',
        payee_member_id: null,
        amount: 555000,
        note: 'Thu trước',
        confirmed_by: 'a',
        created_at: '2030-01-01T00:00:00Z',
        voided_at: null,
        voided_by: null,
        void_reason: '',
      },
    ],
    calculation: {
      ...activity().calculation!,
      people: [
        {
          id: 'guest',
          member_id: null,
          name: 'Bé Long',
          units: 500,
          groups: [],
          exact: 500000,
          due: 500000,
        },
      ],
      headcount: 1,
      shares: 0.5,
      total_cost: 500000,
      total_due: 500000,
    },
  });
  openActivity(fixture(a), 'trip');
  assert.ok(screen.getByText('Bé Long'));
  assert.ok(screen.getByText('0.5 suất'));
  assert.ok(screen.getByText('Cần hoàn lại'));
  assert.ok(screen.getAllByText(/55.000/).length);
  assert.equal(screen.queryByText(/-55.000/), null);
  fireEvent.click(screen.getByRole('button', { name: /Danh sách đăng ký/ }));
  assert.ok(screen.getByText(/Khách của Yến/));
});
test('Money form reuses operation ID on retry; receipt adjustment requires reason', async () => {
  const club = fixture(activity(), {
    run: async (task) => {
      await task();
      return false;
    },
  });
  openActivity(club);
  fireEvent.click(screen.getByRole('tab', { name: 'Thu & hoàn' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận khoản tiền' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Người đóng / nhận hoàn'), {
    target: { value: 'a' },
  });
  const form = within(dialog)
    .getByRole('button', { name: 'Xác nhận đã thu tiền' })
    .closest('form')!;
  fireEvent.submit(form);
  await waitFor(() => assert.equal(calls.length, 1));
  fireEvent.submit(form);
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[0].args.p_operation, calls[1].args.p_operation);
});
test('Conflicting expense notes require explicit review and retain only the locally changed field', async () => {
  const a = activity({ fee_status: 'draft' }),
    club = fixture(a),
    view = openActivity(club);
  fireEvent.click(screen.getByRole('tab', { name: 'Khoản chi' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sửa Sân + cầu' }));
  const d = screen.getByRole('dialog');
  fireEvent.change(within(d).getByLabelText('Ghi chú khoản chi'), {
    target: { value: 'Bản đang nhập' },
  });
  const latest = {
    ...a,
    expenses: [
      {
        ...a.expenses![0],
        version: 2,
        note: 'Ghi chú trên thiết bị B',
        actual: 450000,
      },
    ],
  };
  view.rerender(
    <ActivitiesPage
      club={{
        ...club,
        activities: { version: 1, revision: 12, activities: [latest] },
      }}
      kind="badminton"
    />,
  );
  assert.ok(within(d).getByText(/Ghi chú trên thiết bị B/));
  assert.equal(
    (within(d).getByLabelText('Ghi chú khoản chi') as HTMLTextAreaElement)
      .value,
    'Bản đang nhập',
  );
  fireEvent.click(
    within(d).getByRole('button', {
      name: 'Đã đối chiếu, giữ các trường tôi vừa sửa',
    }),
  );
  fireEvent.submit(
    within(d).getByRole('button', { name: 'Lưu khoản chi' }).closest('form')!,
  );
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0].args.p_patch, { note: 'Bản đang nhập' });
  assert.equal(calls[0].args.p_expected_version, 2);
});

function cancelledTrip(): ClubActivity {
  return activity({
    kind: 'trip',
    organizer_id: 'a',
    fee_status: 'draft',
    participants: [{
      id: 'traveller', activity_id: 'activity', member_id: 'a', invited_by: null,
      guest_name: '', status: 'not_going', note: 'Bận, xin hoàn tiền', billable: true,
      share_units: 1000, share_reason: '', version: 2, updated_at: '2030-01-01T00:00:00Z',
    }],
    ledger: [{
      id: 'advance', activity_id: 'activity', operation_id: 'first-payment', kind: 'collection',
      person_id: 'traveller', payee_member_id: null, amount: 555000, note: 'Thu trước',
      confirmed_by: 'a', created_at: '2030-01-01T00:00:00Z', voided_at: null, voided_by: null, void_reason: '',
    }],
    calculation: { ...activity().calculation!, people: [], total_cost: 0, total_due: 0, headcount: 0, shares: 0, breakdown: [] },
  });
}

test('A cancelled traveller who prepaid 555000 opens an explicit 555000 refund, never a collection', async () => {
  openActivity(fixture(cancelledTrip()), 'trip');
  fireEvent.click(screen.getByRole('button', { name: 'Hoàn tiền' }));
  const dialog = screen.getByRole('dialog');
  assert.equal((within(dialog).getByLabelText('Loại ghi nhận') as HTMLSelectElement).value, 'refund');
  assert.equal((within(dialog).getByLabelText('Số tiền thực nhận / hoàn (đ)') as HTMLInputElement).value, '555000');
  assert.ok(within(dialog).getByText(/Bạn đang ghi nhận hoàn tiền đã đóng/));
  fireEvent.submit(within(dialog).getByRole('button', { name: 'Xác nhận hoàn tiền đóng' }).closest('form')!);
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].args.p_kind, 'refund');
  assert.equal(calls[0].args.p_amount, 555000);
  assert.equal(calls[0].args.p_person, 'traveller');
});

test('Finalization retains the reviewed total and note until the new revision is explicitly acknowledged', async () => {
  const a = activity({ fee_status: 'draft' });
  const club = fixture(a);
  const view = openActivity(club);
  fireEvent.click(screen.getByRole('button', { name: 'Chốt tiền' }));
  const dialog = screen.getByRole('dialog');
  const note = within(dialog).getByLabelText('Ghi chú xác nhận') as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: 'Đã kiểm đủ mọi người' } });
  const newer = { ...a, calculation: { ...a.calculation!, total_due: 400000, total_cost: 400000 } };
  view.rerender(<ActivitiesPage club={{ ...club, activities: { version: 1, revision: 11, activities: [newer] } }} kind="badminton" />);
  assert.ok(within(dialog).getByText(/Dữ liệu đã thay đổi từ khi mở/));
  assert.match(dialog.querySelector('.fee-confirm-total')!.textContent!, /395.000/);
  assert.equal(note.value, 'Đã kiểm đủ mọi người');
  const submit = within(dialog).getByRole('button', { name: 'Xác nhận chốt tiền' }) as HTMLButtonElement;
  assert.equal(submit.disabled, true);
  fireEvent.submit(submit.closest('form')!);
  assert.equal(calls.length, 0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đã đối chiếu, dùng bảng phí mới nhất' }));
  assert.match(dialog.querySelector('.fee-confirm-total')!.textContent!, /400.000/);
  assert.equal(note.value, 'Đã kiểm đủ mọi người');
  assert.equal(submit.disabled, false);
  fireEvent.submit(submit.closest('form')!);
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].args.p_expected_revision, 11);
  assert.equal(calls[0].args.p_reason, 'Đã kiểm đủ mọi người');
});

test('Another device finalizing blocks the old form without silently changing its action to reopen', () => {
  const a = activity({ fee_status: 'draft' });
  const club = fixture(a);
  const view = openActivity(club);
  fireEvent.click(screen.getByRole('button', { name: 'Chốt tiền' }));
  view.rerender(<ActivitiesPage club={{ ...club, activities: { version: 1, revision: 11, activities: [{ ...a, fee_status: 'finalized' }] } }} kind="badminton" />);
  const dialog = screen.getByRole('dialog');
  assert.ok(within(dialog).getByText(/Thiết bị khác đã chốt bảng phí/));
  assert.equal(within(dialog).queryByRole('button', { name: 'Đã đối chiếu, dùng bảng phí mới nhất' }), null);
  const submit = within(dialog).getByRole('button', { name: 'Xác nhận chốt tiền' }) as HTMLButtonElement;
  assert.equal(submit.disabled, true);
  fireEvent.submit(submit.closest('form')!);
  assert.equal(calls.length, 0);
});

test('Checklist status can be changed inline and patches only status with the displayed version', async () => {
  const a = activity({ kind: 'trip', checklist: [{ id: 'item', name: 'Than nướng', quantity: 2, unit: 'kg', responsible_id: 'a', status: 'todo', note: 'Giữ ghi chú', expense_id: null, version: 7, voided_at: null }] });
  openActivity(fixture(a), 'trip');
  fireEvent.click(screen.getByRole('tab', { name: 'Chuẩn bị' }));
  fireEvent.change(screen.getByLabelText('Trạng thái chuẩn bị Than nướng'), { target: { value: 'done' } });
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(screen.queryByRole('dialog'), null);
  assert.equal(calls[0].name, 'save_trip_checklist');
  assert.deepEqual(calls[0].args, { p_activity: 'activity', p_id: 'item', p_patch: { status: 'done' }, p_expected_version: 7 });
  assert.ok(screen.getByText('Giữ ghi chú'));
});

test('An activity URL opens the exact fee sheet and back clears its activity parameter', () => {
  window.history.replaceState({}, '', '/#finance?activity=activity');
  render(<ActivitiesPage club={fixture()} kind="badminton" />);
  assert.ok(screen.getByRole('heading', { name: 'Buổi kiểm thử' }));
  fireEvent.click(screen.getByRole('button', { name: /Tất cả bảng phí/ }));
  assert.equal(new URLSearchParams(window.location.hash.split('?')[1]).has('activity'), false);
  assert.ok(screen.getByRole('button', { name: /Buổi kiểm thử/ }));
});

test('Financial message and CSV retain the cancelled-traveller refund and escape names, quotes and newlines', () => {
  const a = cancelledTrip();
  const message = buildActivityMessage(a, members, 'https://club.example/#travel?activity=activity');
  assert.match(message, /TẠM TÍNH/);
  assert.match(message, /Yến: phải đóng 0/);
  assert.match(message, /cần hoàn 555.000/);
  assert.match(message, /#travel\?activity=activity/);
  const csv = buildActivityCsv({ ...a, title: '=SUM(A1:A2)', participants: [{ ...a.participants![0], note: 'Ghi chú "mới"\nDòng 2' }] }, members);
  assert.ok(csv.includes('"\'=SUM(A1:A2)"'));
  assert.ok(csv.includes('0,555000,0,555000'));
  assert.ok(csv.includes('"Ghi chú ""mới""\nDòng 2"'));
  assert.equal(csv.startsWith('\ufeff'), false);
});
