import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { BADGES, type MemberHub, type MemberStyle } from '../src/memberHonors';
import { EMPTY, type Member } from '../src/types';
import type { useClub } from '../src/useClub';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://test.invalid/',
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLDialogElement: dom.window.HTMLDialogElement,
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
const { render, screen, fireEvent, waitFor, cleanup, within } =
  await import('@testing-library/react');
const { MemberHubPanel, ProfileDialog, MemberHonorSummary } =
  await import('../src/MemberHonorsPanel');
const { MemberAvatar, MemberStyleProvider } =
  await import('../src/MemberAvatar');
afterEach(cleanup);
type Club = ReturnType<typeof useClub>;
const member: Member = {
  id: 'a',
  display_name: 'Yến',
  code: 'CL-A',
  note: '',
  active: true,
  version: 1,
};
const other: Member = {
  ...member,
  id: 'b',
  display_name: 'Khôi',
  code: 'CL-B',
};
function profile(id = 'a'): MemberStyle {
  return {
    member_id: id,
    avatar_key: '',
    featured_badge: '',
    version: 0,
    badges: BADGES.map((b) => ({
      key: b.key,
      progress: b.key === 'first_rally' ? 1 : 0,
      target: b.key === 'regular' ? 5 : b.key === 'veteran' ? 20 : 1,
      earned: b.key === 'first_rally',
      awarded_month: null,
    })),
  };
}
function hub(): MemberHub {
  return {
    version: 1,
    as_of: new Date().toISOString(),
    month: '2026-11',
    viewer_member_id: 'a',
    profiles: [profile(), profile('b')],
    votes: [],
    mine: [
      { category: 'comic', nominee_id: null, version: 0 },
      { category: 'teammate', nominee_id: null, version: 0 },
    ],
  };
}
function club(overrides: Partial<Club> = {}): Club {
  return {
    ...EMPTY,
    memberHub: hub(),
    memberHubError: '',
    members: [member, other],
    memberId: 'a',
    online: true,
    loading: false,
    error: '',
    booking: { verified_member_id: 'a' },
    saveState: 'idle',
    bookingRpc: async () => {},
    run: async (task: () => Promise<unknown>) => {
      try {
        await task();
        return true;
      } catch {
        return false;
      }
    },
    reload: async () => {},
    ...overrides,
  } as unknown as Club;
}

test('Name selection does not authorize style changes or voting; verified identity controls own editor', () => {
  let verified = 0;
  const c = club({ booking: null });
  render(<MemberHubPanel club={c} onVerify={() => verified++} />);
  fireEvent.click(
    screen.getByRole('button', { name: /Xác minh để chọn avatar/ }),
  );
  assert.equal(verified, 1);
  assert.equal(screen.queryByRole('combobox'), null);
  cleanup();
  render(
    <ProfileDialog
      member={other}
      profile={profile('b')}
      club={club()}
      close={() => {}}
      onVerify={() => {}}
    />,
  );
  assert.equal(screen.queryByRole('button', { name: 'Lưu diện mạo' }), null);
  assert.equal(screen.queryByRole('radio'), null);
});
test('Avatar preview stays local until save, sends only own style and earned badge, closes on success', async () => {
  let closed = 0;
  const calls: unknown[] = [];
  const c = club({
    bookingRpc: async (...args: unknown[]) => {
      calls.push(args);
      return undefined;
    },
  } as Partial<Club>);
  render(
    <MemberStyleProvider hub={c.memberHub!}>
      <MemberAvatar id="a" name="Yến" />
      <ProfileDialog
        member={member}
        profile={profile()}
        club={c}
        close={() => closed++}
        onVerify={() => {}}
      />
    </MemberStyleProvider>,
  );
  fireEvent.click(screen.getByRole('radio', { name: /Ếch gáy khét/ }));
  assert.match(
    screen.getByAltText('Avatar xem trước').getAttribute('src')!,
    /cheeky-frog.webp$/,
  );
  assert.equal(document.querySelector('.honor-avatar img'), null);
  fireEvent.click(screen.getByRole('tab', { name: /Huy hiệu/ }));
  const select = screen.getByRole('combobox', {
    name: 'Huy hiệu ghim cạnh tên',
  });
  assert.equal(
    within(select).queryByRole('option', { name: /Lão làng/ }),
    null,
  );
  fireEvent.change(select, { target: { value: 'first_rally' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu diện mạo' }));
  await waitFor(() => assert.equal(closed, 1));
  assert.deepEqual(calls, [
    [
      'save_member_style',
      {
        p_avatar_key: 'cheeky-frog',
        p_featured_badge: 'first_rally',
        p_expected_version: 0,
      },
    ],
  ]);
});
test('Failed save preserves choices for retry; stale server version blocks overwrite until explicit reset', async () => {
  let fail = true;
  const c = club({
    bookingRpc: async () => {
      if (fail) throw new Error('Mạng bị gián đoạn');
    },
  } as Partial<Club>);
  let closed = 0;
  const props = {
    member,
    profile: profile(),
    club: c,
    close: () => closed++,
    onVerify: () => {},
  };
  const view = render(<ProfileDialog {...props} />);
  fireEvent.click(screen.getByRole('radio', { name: /Vịt liếc xéo/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu diện mạo' }));
  await screen.findByRole('alert');
  assert.match(screen.getByRole('alert').textContent!, /Mạng bị gián đoạn/);
  assert.equal(
    (screen.getByRole('radio', { name: /Vịt liếc xéo/ }) as HTMLInputElement)
      .checked,
    true,
  );
  assert.equal(closed, 0);
  view.rerender(
    <ProfileDialog
      {...props}
      profile={{ ...profile(), version: 2, avatar_key: 'smug-cat' }}
    />,
  );
  assert.equal(
    (screen.getByRole('button', { name: 'Thử lưu lại' }) as HTMLButtonElement)
      .disabled,
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Dùng bản mới' }));
  assert.equal(
    (screen.getByRole('radio', { name: /Mèo mặt tỉnh/ }) as HTMLInputElement)
      .checked,
    true,
  );
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Lưu diện mạo' }));
  await waitFor(() => assert.equal(closed, 1));
});
test('Missing server migration offers retry instead of fabricated badge counts or vote form', () => {
  let retries = 0;
  render(
    <MemberHubPanel
      club={club({
        memberHub: null,
        memberHubError: 'Cần cập nhật hệ thống',
        reload: async () => {
          retries++;
        },
      })}
      onVerify={() => {}}
    />,
  );
  assert.match(
    screen.getByRole('status').textContent!,
    /Cần cập nhật hệ thống/,
  );
  assert.equal(screen.queryByRole('combobox'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
  assert.equal(retries, 1);
});
test('Votes exclude self and inactive members, retain failed draft, use month and version, and do not grant provisional badges', async () => {
  const c = club();
  c.memberHub!.votes = [{ category: 'comic', member_id: 'b', votes: 9 }];
  const calls: unknown[] = [];
  let fail = true;
  c.bookingRpc = (async (...args: unknown[]) => {
    calls.push(args);
    if (fail) throw new Error('Không gửi được phiếu');
  }) as Club['bookingRpc'];
  c.members.push({
    ...other,
    id: 'c',
    display_name: 'Ngừng hoạt động',
    active: false,
  });
  const view = render(<MemberHubPanel club={c} onVerify={() => {}} />);
  const card = screen
    .getByRole('heading', { name: 'Cây hài của tháng' })
    .closest('article')!;
  const ui = within(card);
  const select = ui.getByRole('combobox');
  assert.equal(within(select).queryByRole('option', { name: /Yến/ }), null);
  assert.equal(
    within(select).queryByRole('option', { name: /Ngừng hoạt động/ }),
    null,
  );
  assert.match(card.textContent!, /CHƯA TRAO HUY HIỆU/);
  fireEvent.change(select, { target: { value: 'b' } });
  fireEvent.click(ui.getByRole('button', { name: 'Gửi phiếu' }));
  await ui.findByRole('alert');
  assert.equal((select as HTMLSelectElement).value, 'b');
  fail = false;
  fireEvent.click(ui.getByRole('button', { name: 'Gửi phiếu' }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.deepEqual(calls[0], [
    'vote_member_honor',
    {
      p_category: 'comic',
      p_nominee: 'b',
      p_month: '2026-11',
      p_expected_version: 0,
    },
  ]);
  const next = {
    ...c,
    memberHub: { ...c.memberHub!, month: '2026-12', mine: [] },
  };
  view.rerender(<MemberHubPanel club={next} onVerify={() => {}} />);
  await waitFor(() =>
    assert.equal(
      (ui.getByRole('button', { name: 'Gửi phiếu' }) as HTMLButtonElement)
        .disabled,
      true,
    ),
  );
  fireEvent.click(ui.getByRole('button', { name: 'Dùng bản mới' }));
  assert.equal((ui.getByRole('combobox') as HTMLSelectElement).value, '');
});
test('Shared avatar allowlist renders stored image; unknown paths cannot load external content', () => {
  const data = hub();
  data.profiles[0].avatar_key = 'jerry-smirk';
  const view = render(
    <MemberStyleProvider hub={data}>
      <MemberAvatar id="a" name="Yến" />
    </MemberStyleProvider>,
  );
  assert.equal(
    document.querySelector('img')?.getAttribute('src'),
    '/avatars/jerry-smirk.webp',
  );
  view.rerender(
    <MemberStyleProvider
      hub={{
        ...data,
        profiles: [{ ...profile(), avatar_key: 'https://evil.invalid/x' }],
      }}
    >
      <MemberAvatar id="a" name="Yến" />
    </MemberStyleProvider>,
  );
  assert.equal(document.querySelector('img'), null);
  assert.match(document.body.textContent!, /Y/);
});
test('Member card opens actual earned collection and shows locked criteria', () => {
  render(
    <MemberHonorSummary member={member} club={club()} onVerify={() => {}} />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Xem huy hiệu và avatar/ }),
  );
  assert.ok(screen.getByRole('dialog'));
  fireEvent.click(screen.getByRole('tab', { name: /Huy hiệu/ }));
  assert.ok(screen.getByRole('heading', { name: 'Lão làng chốt kèo' }));
  assert.match(
    screen.getByRole('dialog').textContent!,
    /chưa phải điểm danh|chưa phải/,
  );
});

test('Revoked pin needs an explicit refresh and read-only avatar follows incoming server changes', () => {
  const p = { ...profile(), featured_badge: 'first_rally' };
  const props = {
    member,
    profile: p,
    club: club(),
    close: () => {},
    onVerify: () => {},
  };
  const view = render(<ProfileDialog {...props} />);
  const changed = {
    ...p,
    featured_badge: '',
    badges: p.badges.map((b) => ({ ...b, earned: false, progress: 0 })),
  };
  view.rerender(<ProfileDialog {...props} profile={changed} />);
  assert.match(
    screen.getByRole('alert').textContent!,
    /không còn đủ điều kiện/,
  );
  assert.equal(
    (screen.getByRole('button', { name: 'Lưu diện mạo' }) as HTMLButtonElement)
      .disabled,
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Dùng bản mới' }));
  fireEvent.click(screen.getByRole('tab', { name: /Huy hiệu/ }));
  assert.equal((screen.getByRole('combobox') as HTMLSelectElement).value, '');
  cleanup();
  const readonly = render(
    <ProfileDialog {...props} member={other} profile={profile('b')} />,
  );
  readonly.rerender(
    <ProfileDialog
      {...props}
      member={other}
      profile={{ ...profile('b'), avatar_key: 'cheeky-frog', version: 1 }}
    />,
  );
  assert.match(
    screen.getByAltText('Avatar xem trước').getAttribute('src')!,
    /cheeky-frog/,
  );
});

test('Verified member previews a device image locally, keeps it on failed save, then publishes their own avatar', async () => {
  const originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.createObjectURL = () => 'blob:local-avatar';
  URL.revokeObjectURL = (value) => {
    revoked.push(value);
  };
  try {
    let closed = 0,
      fail = true;
    const writes: unknown[] = [];
    const attempts: unknown[] = [];
    const c = club({ memberId: 'b' });
    c.memberHub = { ...hub(), custom_avatars: true };
    c.prepareMemberAvatar = async (file) =>
      new File(['processed pixels'], file.name, { type: 'image/webp' });
    c.memberAvatarUrl = (path) =>
      path ? 'https://project.supabase.co/storage/' + path : '';
    c.uploadMemberAvatar = async (attempt) => {
      attempts.push(attempt);
      return 'avatars/10000000-0000-4000-8000-000000000001.webp';
    };
    c.bookingRpc = (async (...args: unknown[]) => {
      writes.push(args);
      if (fail) throw new Error('Lưu chưa thành công');
    }) as Club['bookingRpc'];
    render(
      <ProfileDialog
        member={member}
        profile={profile()}
        club={c}
        close={() => closed++}
        onVerify={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Chọn ảnh từ thiết bị'), {
      target: {
        files: [
          new File(['original bytes'], 'my-photo.jpg', { type: 'image/jpeg' }),
        ],
      },
    });
    await waitFor(() =>
      assert.equal(
        screen.getByAltText('Avatar xem trước').getAttribute('src'),
        'blob:local-avatar',
      ),
    );
    assert.equal(attempts.length, 0);
    assert.equal(writes.length, 0);
    assert.equal(c.memberHub.profiles[0].avatar_path, undefined);
    fireEvent.click(screen.getByRole('tab', { name: /Huy hiệu/ }));
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'first_rally' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Diện mạo' }));
    assert.equal(
      screen.getByAltText('Avatar xem trước').getAttribute('src'),
      'blob:local-avatar',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lưu diện mạo' }));
    await screen.findByRole('alert');
    assert.equal(closed, 0);
    assert.equal(
      screen.getByAltText('Avatar xem trước').getAttribute('src'),
      'blob:local-avatar',
    );
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lưu lại' }));
    await waitFor(() => assert.equal(closed, 1));
    assert.equal(attempts[0], attempts[1]);
    assert.deepEqual(writes[1], [
      'save_member_appearance',
      {
        p_avatar_key: '',
        p_avatar_path: 'avatars/10000000-0000-4000-8000-000000000001.webp',
        p_featured_badge: 'first_rally',
        p_expected_version: 0,
      },
    ]);
    cleanup();
    assert.deepEqual(revoked, ['blob:local-avatar']);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
test('Changing only a pinned badge keeps the saved personal photo; removing it explicitly clears the server path', async () => {
  const path = 'avatars/10000000-0000-4000-8000-000000000001.webp';
  const p = { ...profile(), avatar_path: path };
  const c = club();
  c.memberHub = { ...hub(), custom_avatars: true };
  c.memberAvatarUrl = (path) =>
    path ? 'https://project.supabase.co/' + path : '';
  const calls: unknown[] = [];
  c.bookingRpc = (async (...args: unknown[]) => {
    calls.push(args);
  }) as Club['bookingRpc'];
  const props = {
    member,
    profile: p,
    club: c,
    close: () => {},
    onVerify: () => {},
  };
  render(<ProfileDialog {...props} />);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Diện mạo' }), {
    key: 'ArrowRight',
  });
  assert.equal(
    screen.getByRole('tab', { name: /Huy hiệu/ }).getAttribute('aria-selected'),
    'true',
  );
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'first_rally' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu diện mạo' }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal((calls[0] as any[])[1].p_avatar_path, path);
  cleanup();
  render(<ProfileDialog {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ ảnh cá nhân' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu diện mạo' }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal((calls[1] as any[])[1].p_avatar_path, null);
});
test('Unverified or read-only profiles never show an uploader; invalid file processing keeps the previous avatar', async () => {
  const c = club();
  c.memberHub = { ...hub(), custom_avatars: true };
  render(
    <ProfileDialog
      member={other}
      profile={profile('b')}
      club={c}
      close={() => {}}
      onVerify={() => {}}
    />,
  );
  assert.equal(screen.queryByLabelText('Chọn ảnh từ thiết bị'), null);
  cleanup();
  c.prepareMemberAvatar = async () => {
    throw new Error('Ảnh vượt quá 8 MB');
  };
  render(
    <ProfileDialog
      member={member}
      profile={{ ...profile(), avatar_key: 'smug-cat' }}
      club={c}
      close={() => {}}
      onVerify={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Chọn ảnh từ thiết bị'), {
    target: { files: [new File(['x'], 'bad.jpg', { type: 'image/jpeg' })] },
  });
  await screen.findByRole('alert');
  assert.match(screen.getByRole('alert').textContent!, /8 MB/);
  assert.match(
    screen.getByAltText('Avatar xem trước').getAttribute('src')!,
    /smug-cat/,
  );
});
