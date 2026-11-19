import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { useClub } from '../src/useClub';
import type {
  ActivityPaymentSettings,
  ClubActivity,
} from '../src/activityTypes';
import { effectivePaid } from '../src/activityTypes';
import { buildActivityCsv, buildActivityMessage } from '../src/financeExport';
import { myTaskData } from '../src/MyTasks';
import { EMPTY } from '../src/types';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://test.invalid/',
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
dom.window.confirm = () => true;
let blobs = 0;
URL.createObjectURL = () => `blob:preview-${++blobs}`;
URL.revokeObjectURL = () => {};
const copies: string[] = [];
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: async (text: string) => {
      copies.push(text);
    },
  },
  configurable: true,
});
const { render, screen, fireEvent, waitFor, cleanup, act, within } =
  await import('@testing-library/react');
const { ActivityPayment, PaymentSettingsForm, PaymentSheet } =
  await import('../src/ActivityPayment');
const { MemberPaymentQr, MemberPaymentQrForm } =
  await import('../src/MemberPaymentQr');
type Club = ReturnType<typeof useClub>;
const first = 'qr/10000000-0000-4000-8000-000000000001.png',
  second = 'qr/10000000-0000-4000-8000-000000000002.png';
const payment: ActivityPaymentSettings = {
  version: 1,
  qr_path: first,
  receiver_name: 'NGUYEN THI YEN',
  bank_name: 'Ngân hàng thử',
  account_number: '00123456789',
  transfer_note: '',
};
const a: ClubActivity = {
  id: 'activity',
  kind: 'badminton',
  title: 'Buổi 21/05/2030',
  organizer_id: 'a',
  details: {},
  status: 'open',
  fee_status: 'finalized',
  rounding: 1,
  reserve: 0,
  version: 1,
  can_manage: true,
  payment,
  expenses: [],
  ledger: [],
  calculation: {
    total_cost: 80000,
    total_due: 80000,
    estimated: 80000,
    surplus: 0,
    headcount: 2,
    shares: 2,
    warnings: [],
    breakdown: [],
    people: [
      {
        id: 'a',
        member_id: 'a',
        name: 'Yến',
        units: 1000,
        groups: [],
        exact: 30000,
        due: 30000,
      },
      {
        id: 'b',
        member_id: 'b',
        name: 'Hiền',
        units: 1000,
        groups: [],
        exact: 50000,
        due: 50000,
      },
    ],
  },
};
function fixture(overrides: Partial<Club> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const club = {
    members: [],
    memberId: 'b',
    booking: { verified_member_id: 'a' },
    online: true,
    saveState: 'idle',
    paymentQrUrl: (p: string) => `https://storage.test/${p}`,
    uploadPaymentQr: async () => second,
    bookingRpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return [];
    },
    run: async (task: () => Promise<unknown>) => {
      try {
        await task();
        return true;
      } catch {
        return false;
      }
    },
    ...overrides,
  } as unknown as Club;
  return { club, calls };
}
afterEach(() => {
  cleanup();
  copies.length = 0;
});
test('Personal QR follows verified identity even when a different name is selected; saving requires only an image', async () => {
  let finishUpload!: (path: string) => void;
  let uploads = 0;
  const profile = { member_id: 'a', version: 0, qr_path: null };
  const { club, calls } = fixture({
    members: [
      { id: 'a', display_name: 'Yến', active: true },
    ] as Club['members'],
    activities: {
      version: 1,
      revision: 1,
      activities: [],
      personal_payment_qr: profile,
    },
    uploadMemberPaymentQr: async () => {
      uploads++;
      return new Promise<string>((resolve) => {
        finishUpload = resolve;
      });
    },
  });
  render(<MemberPaymentQr club={club} />);
  assert.match(screen.getByRole('heading').textContent ?? '', /Yến/);
  fireEvent.click(screen.getByRole('button', { name: 'Tải QR cá nhân' }));
  const file = new dom.window.File(['png'], 'my-qr.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Chọn ảnh QR cá nhân'), {
    target: { files: [file] },
  });
  assert.match(
    screen.getByAltText('QR cá nhân xem trước').getAttribute('src') ?? '',
    /^blob:/,
  );
  assert.equal(document.querySelector('[name="account_number"]'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Lưu QR cá nhân' }));
  await waitFor(() => assert.equal(uploads, 1));
  assert.equal(calls.length, 0);
  await act(async () => finishUpload(second));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0], {
    name: 'save_member_payment_qr',
    args: { p_path: second, p_expected_version: 0 },
  });
});
test('Personal QR replacement retries the confirmed upload; conflicting versions require review before deleting', async () => {
  let uploads = 0,
    attempts = 0;
  const { club, calls } = fixture({
    uploadMemberPaymentQr: async () => {
      uploads++;
      return second;
    },
    bookingRpc: async (name, args) => {
      attempts++;
      if (attempts === 1) throw new Error('Mạng gián đoạn');
      calls.push({ name, args });
      return null;
    },
  });
  let profile = { member_id: 'a', version: 1, qr_path: first };
  const ui = render(
    <MemberPaymentQrForm club={club} profile={profile} close={() => {}} />,
  );
  fireEvent.change(screen.getByLabelText('Chọn ảnh QR cá nhân'), {
    target: {
      files: [new dom.window.File(['png'], 'qr.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu QR cá nhân' }));
  await screen.findByText('Mạng gián đoạn');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu QR cá nhân' }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(uploads, 1);
  profile = { ...profile, version: 2, qr_path: second };
  ui.rerender(
    <MemberPaymentQrForm club={club} profile={profile} close={() => {}} />,
  );
  assert.equal(
    (
      screen.getByRole('button', {
        name: 'Lưu QR cá nhân',
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Dùng bản mới' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xóa QR' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu QR cá nhân' }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.deepEqual(calls[1].args, { p_path: null, p_expected_version: 2 });
});
test('Creating an activity override starts empty and retains the inherited version after a prior reset', async () => {
  const { club, calls } = fixture();
  render(
    <PaymentSettingsForm
      club={club}
      activity={{ ...a, payment: { ...payment, source: 'member', version: 7 } }}
      close={() => {}}
    />,
  );
  assert.equal(
    (document.querySelector('[name="receiver_name"]') as HTMLInputElement)
      .value,
    '',
  );
  fireEvent.change(screen.getByLabelText('Chọn ảnh QR từ thiết bị'), {
    target: {
      files: [new dom.window.File(['png'], 'other.png', { type: 'image/png' })],
    },
  });
  for (const [name, value] of Object.entries({
    receiver_name: 'Chủ tài khoản khác',
    bank_name: 'Ngân hàng khác',
    account_number: '12345',
  })) {
    fireEvent.change(document.querySelector(`[name="${name}"]`)!, {
      target: { value },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Lưu QR & tài khoản' }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].args.p_expected_version, 7);
  assert.equal(
    (calls[0].args.p_patch as Record<string, unknown>).qr_path,
    second,
  );
});
test('Inherited QR needs no bank fields, organizer owes zero, exports and reminders agree without creating cash', () => {
  const owner = { ...a.calculation!.people[0], organizer_paid: true };
  const activity = {
    ...a,
    calculation: {
      ...a.calculation!,
      people: [owner, a.calculation!.people[1]],
    },
    payment: {
      ...payment,
      source: 'member' as const,
      organizer_id: 'a',
      bank_name: '',
      account_number: '',
    },
  };
  const { club, calls } = fixture();
  render(<PaymentSheet club={club} activity={activity} initialPersonId="a" />);
  assert.match(
    screen.getByText(/Đã thanh toán mặc định vì/).textContent ?? '',
    /không phải xác nhận giao dịch/,
  );
  assert.equal(
    screen
      .getByRole('img', { name: 'QR chuyển khoản của hoạt động' })
      .getAttribute('src'),
    `https://storage.test/${first}`,
  );
  assert.equal(screen.queryByText('Ngân hàng'), null);
  assert.equal(
    screen.queryByRole('button', { name: 'Sao chép số tài khoản' }),
    null,
  );
  assert.equal(effectivePaid([], owner), 30000);
  assert.equal(calls.length, 0);
  assert.equal(activity.ledger.length, 0);
  assert.match(
    buildActivityMessage(activity, [], 'https://test.invalid'),
    /đã thanh toán mặc định \(người phụ trách đặt sân\) · đã đủ/,
  );
  assert.match(
    buildActivityCsv(activity, []),
    /Đã thanh toán \(mặc định · người phụ trách\)/,
  );
  const data = {
    ...EMPTY,
    activities: { version: 1, revision: 1, activities: [activity] },
  };
  assert.equal(myTaskData(data, 'a', 'a').balances.length, 0);
  assert.equal(myTaskData(data, 'b', 'a').balances[0].balance, 50000);
});
test('Downloading waits for the image response, permits retry on failure and never records payment', async () => {
  const originalFetch = globalThis.fetch;
  const originalClick = dom.window.HTMLAnchorElement.prototype.click;
  let reply!: (response: Response) => void;
  const downloads: string[] = [];
  dom.window.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.download);
  };
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      reply = resolve;
    });
  try {
    const f = fixture();
    render(<PaymentSheet club={f.club} activity={a} initialPersonId="b" />);
    fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh QR' }));
    assert.equal(
      (screen.getByRole('button', { name: 'Tải ảnh QR' }) as HTMLButtonElement)
        .disabled,
      true,
    );
    assert.deepEqual(downloads, []);
    await act(async () =>
      reply(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    await waitFor(() => assert.equal(downloads.length, 1));
    assert.equal(downloads[0], 'qr-activity.png');
    assert.equal(f.calls.length, 0);
    globalThis.fetch = async () => {
      throw new Error('Mất mạng khi tải QR');
    };
    fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh QR' }));
    await waitFor(() =>
      assert.match(screen.getByRole('status').textContent!, /Mất mạng/),
    );
    assert.equal(
      (screen.getByRole('button', { name: 'Tải ảnh QR' }) as HTMLButtonElement)
        .disabled,
      false,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    dom.window.HTMLAnchorElement.prototype.click = originalClick;
  }
});
const openPay = () =>
  fireEvent.click(
    screen.getByRole('button', { name: 'Thanh toán', exact: true }),
  );
test('Payment uses the selected name, exact integer copy and safe fixed-amount warning; opening/zoom/copy never records money', async () => {
  const f = fixture();
  render(
    <ActivityPayment club={f.club} activity={{ ...a, can_manage: false }} />,
  );
  openPay();
  assert.equal(
    (screen.getByLabelText('Người đóng tiền') as HTMLSelectElement).value,
    'b',
  );
  assert.ok(within(screen.getByRole('dialog')).getByText('50.000 ₫'));
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép số tiền' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Sao chép số tài khoản' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' }),
  );
  await waitFor(() =>
    assert.deepEqual(copies, [
      '50000',
      '00123456789',
      'Buổi 21/05/2030 - Hiền',
    ]),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Phóng to ảnh QR' }));
  assert.ok(screen.getByRole('img', { name: 'Ảnh QR phóng to' }));
  fireEvent.change(screen.getByLabelText('Mức phóng to QR'), {
    target: { value: '2' },
  });
  assert.equal(
    (screen.getByRole('img', { name: 'Ảnh QR phóng to' }) as HTMLImageElement)
      .style.width,
    '200%',
  );
  assert.ok(
    screen.getAllByText(
      'Kiểm tra người nhận và nhập đúng số tiền trước khi chuyển',
    ).length,
  );
  assert.ok(screen.getByText(/Ảnh QR có thể chứa số tiền cố định/));
  assert.equal(f.calls.length, 0);
});
test('Upload previews locally, waits for Storage before binding, and leaves the old QR on other devices until saved', async () => {
  let complete!: (path: string) => void;
  const pending = new Promise<string>((r) => {
    complete = r;
  });
  const f = fixture({ uploadPaymentQr: async () => pending });
  let closed = false;
  const editor = render(
    <PaymentSettingsForm
      club={f.club}
      activity={a}
      close={() => {
        closed = true;
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Chọn ảnh QR từ thiết bị'), {
    target: {
      files: [new dom.window.File(['png'], 'moi.png', { type: 'image/png' })],
    },
  });
  assert.match(
    (
      screen.getByRole('img', {
        name: 'Xem trước ảnh QR nhận tiền',
      }) as HTMLImageElement
    ).src,
    /blob:preview/,
  );
  assert.equal(f.calls.length, 0);
  fireEvent.submit(
    screen.getByRole('button', { name: 'Lưu QR & tài khoản' }).closest('form')!,
  );
  await waitFor(() =>
    assert.ok(screen.getByRole('button', { name: 'Đang tải ảnh QR…' })),
  );
  assert.equal(f.calls.length, 0);
  assert.equal(closed, false);
  await act(async () => complete(second));
  await waitFor(() => assert.equal(f.calls.length, 1));
  assert.deepEqual(f.calls[0], {
    name: 'save_activity_payment_settings',
    args: {
      p_activity: a.id,
      p_patch: { qr_path: second },
      p_expected_version: 1,
    },
  });
  assert.equal(closed, true);
  editor.unmount();
  const stored = { ...a, payment: { ...payment, version: 2, qr_path: second } };
  const receiver = render(
    <PaymentSheet club={f.club} activity={a} initialPersonId="b" />,
  );
  assert.match(
    (
      screen.getByRole('img', {
        name: 'QR chuyển khoản của hoạt động',
      }) as HTMLImageElement
    ).src,
    /000001\.png$/,
  );
  receiver.rerender(
    <PaymentSheet club={f.club} activity={stored} initialPersonId="b" />,
  );
  assert.match(
    (
      screen.getByRole('img', {
        name: 'QR chuyển khoản của hoạt động',
      }) as HTMLImageElement
    ).src,
    /000002\.png$/,
  );
  receiver.unmount();
  render(<PaymentSheet club={f.club} activity={stored} initialPersonId="b" />);
  assert.match(
    (
      screen.getByRole('img', {
        name: 'QR chuyển khoản của hoạt động',
      }) as HTMLImageElement
    ).src,
    /000002\.png$/,
  );
});
test('Realtime conflicts preserve drafts and require explicit review before saving only changed fields', async () => {
  const f = fixture();
  const view = render(
    <PaymentSettingsForm club={f.club} activity={a} close={() => {}} />,
  );
  fireEvent.change(screen.getByLabelText('Tên người nhận'), {
    target: { value: 'NGUOI NHAN MOI' },
  });
  const newer = {
    ...a,
    payment: {
      ...payment,
      version: 2,
      bank_name: 'Ngân hàng mới',
      qr_path: second,
    },
  };
  view.rerender(
    <PaymentSettingsForm club={f.club} activity={newer} close={() => {}} />,
  );
  assert.equal(
    (screen.getByLabelText('Tên người nhận') as HTMLInputElement).value,
    'NGUOI NHAN MOI',
  );
  assert.equal(
    (
      screen.getByRole('button', {
        name: 'Lưu QR & tài khoản',
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Giữ phần tôi sửa' }));
  assert.equal(
    (screen.getByLabelText('Ngân hàng') as HTMLInputElement).value,
    'Ngân hàng mới',
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Lưu QR & tài khoản' }).closest('form')!,
  );
  await waitFor(() => assert.equal(f.calls.length, 1));
  assert.deepEqual(f.calls[0].args, {
    p_activity: a.id,
    p_patch: { receiver_name: 'NGUOI NHAN MOI' },
    p_expected_version: 2,
  });
});
test('QR library reuses an existing image and receiver fields; detaching QR keeps bank details', async () => {
  const f = fixture({
    bookingRpc: async (name: string) =>
      name === 'get_payment_qr_library'
        ? [
            {
              path: second,
              label: 'NGUOI NHAN KHAC',
              bank_name: 'BANK B',
              account_number: '000099',
              created_at: new Date().toISOString(),
            },
          ]
        : null,
  } as any);
  const saved: unknown[] = [];
  f.club.bookingRpc = async (name: string, args: any) => {
    if (name === 'get_payment_qr_library')
      return [
        {
          path: second,
          label: 'NGUOI NHAN KHAC',
          bank_name: 'BANK B',
          account_number: '000099',
        },
      ] as any;
    saved.push(args);
    return null as any;
  };
  render(<PaymentSettingsForm club={f.club} activity={a} close={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dùng QR đã tải' }));
  await waitFor(() =>
    assert.ok(screen.getByRole('button', { name: /NGUOI NHAN KHAC/ })),
  );
  fireEvent.click(screen.getByRole('button', { name: /NGUOI NHAN KHAC/ }));
  assert.equal(
    (screen.getByLabelText('Số tài khoản') as HTMLInputElement).value,
    '000099',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xóa QR khỏi buổi' }));
  fireEvent.submit(
    screen.getByRole('button', { name: 'Lưu QR & tài khoản' }).closest('form')!,
  );
  await waitFor(() => assert.equal(saved.length, 1));
  assert.deepEqual(saved[0], {
    p_activity: a.id,
    p_patch: {
      qr_path: null,
      receiver_name: 'NGUOI NHAN KHAC',
      bank_name: 'BANK B',
      account_number: '000099',
    },
    p_expected_version: 1,
  });
});
test('No QR still shows account; draft/absent allocation and overpayment never invent a payable amount', () => {
  const f = fixture();
  const v = render(
    <PaymentSheet
      club={f.club}
      activity={{
        ...a,
        fee_status: 'draft',
        payment: { ...payment, qr_path: null },
      }}
      initialPersonId="b"
    />,
  );
  assert.ok(screen.getByText('Chưa xác định'));
  assert.ok(screen.getByText('00123456789'));
  assert.ok(screen.getByText(/Chưa có ảnh QR/));
  assert.equal(
    screen.queryByRole('button', { name: 'Sao chép số tiền' }),
    null,
  );
  v.rerender(
    <PaymentSheet
      club={f.club}
      activity={{
        ...a,
        ledger: [
          {
            person_id: 'b',
            amount: 60000,
            kind: 'collection',
            voided_at: null,
          } as any,
        ],
      }}
      initialPersonId="b"
    />,
  );
  assert.ok(screen.getByText('Bạn cần được hoàn lại'));
  assert.ok(screen.getByText(/không chuyển thêm/));
  assert.equal(
    screen.queryByRole('button', { name: 'Sao chép số tiền' }),
    null,
  );
});
test('Failed upload shows retryable error; a saved upload is reused after a later settings failure', async () => {
  let uploads = 0,
    saves = 0;
  const f = fixture({
    uploadPaymentQr: async () => {
      uploads++;
      if (uploads === 1) throw new Error('Storage mất mạng');
      return second;
    },
    bookingRpc: async () => {
      saves++;
      if (saves === 1) throw new Error('Chưa lưu tài khoản');
      return null as any;
    },
  });
  render(<PaymentSettingsForm club={f.club} activity={a} close={() => {}} />);
  fireEvent.change(screen.getByLabelText('Chọn ảnh QR từ thiết bị'), {
    target: {
      files: [new dom.window.File(['png'], 'moi.png', { type: 'image/png' })],
    },
  });
  const submit = () =>
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Lưu QR & tài khoản' })
        .closest('form')!,
    );
  submit();
  await waitFor(() => assert.ok(screen.getByRole('alert')));
  assert.match(screen.getByRole('alert').textContent!, /Storage mất mạng/);
  assert.equal(saves, 0);
  submit();
  await waitFor(() =>
    assert.match(screen.getByRole('alert').textContent!, /Chưa lưu tài khoản/),
  );
  assert.equal(uploads, 2);
  assert.equal(saves, 1);
  submit();
  await waitFor(() => assert.equal(saves, 2));
  assert.equal(uploads, 2);
});
