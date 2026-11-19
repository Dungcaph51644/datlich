import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { ClubChatProps } from '../src/ClubChat';

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
  matchMedia: () => ({ matches: false }),
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
const { render, screen, fireEvent, waitFor, cleanup, act } =
  await import('@testing-library/react');
const { default: ClubChat } = await import('../src/ClubChat');
const reply = {
  answer: 'Buổi 24/11/2026 lúc 18:00 đã hủy.',
  sources: [
    {
      id: 's',
      label: 'Xem buổi 24/11/2026',
      href: '#schedule?session=s&week=2026-11-23',
    },
  ],
  checkedAt: '2026-11-19T03:00:00Z',
};
const props = (more: Partial<ClubChatProps> = {}): ClubChatProps => ({
  memberName: 'Yến',
  identityKey: 'yen',
  online: true,
  onChoose: () => {},
  ask: async () => reply,
  ...more,
});
afterEach(cleanup);
function open() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Mở trợ lý AI cầu lông' }),
  );
}
function ask(text: string) {
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Câu hỏi cho trợ lý' }),
    { target: { value: text } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
}

test('Chat supports opening, pending state, safe text, detail navigation, minimize, close and explicit clear', async () => {
  let resolve!: (value: typeof reply) => void;
  render(
    <ClubChat
      {...props({
        ask: () =>
          new Promise((r) => {
            resolve = r;
          }),
      })}
    />,
  );
  open();
  ask('Buổi thứ Ba?');
  assert.ok(screen.getByRole('status'));
  assert.equal(
    (screen.getByRole('button', { name: 'Gửi câu hỏi' }) as HTMLButtonElement)
      .disabled,
    true,
  );
  await act(async () =>
    resolve({ ...reply, answer: '<img src=x onerror=alert(1)> Buổi đã hủy.' }),
  );
  assert.ok(screen.getByText(/<img src=x/));
  assert.equal(document.querySelector('img[src=x]'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Thu nhỏ trò chuyện' }));
  assert.equal(screen.queryByRole('dialog'), null);
  open();
  assert.ok(screen.getByText(/Buổi đã hủy/));
  fireEvent.click(screen.getByRole('link', { name: 'Xem buổi 24/11/2026' }));
  assert.ok(dom.window.location.hash.includes('session=s'));
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng trò chuyện' }));
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa cuộc trò chuyện' }));
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Xóa cuộc trò chuyện' }).at(-1)!,
  );
  assert.equal(screen.queryByText(/<img src=x/), null);
});
test('Changing selected identity clears private replies and ignores an old pending response', async () => {
  let resolve!: (value: typeof reply) => void;
  const p = props({
    ask: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const { rerender } = render(<ClubChat {...p} />);
  open();
  ask('Tôi còn thiếu bao nhiêu?');
  rerender(<ClubChat {...p} memberName="Hiền" identityKey="hien" />);
  await act(async () =>
    resolve({ ...reply, answer: 'Thông tin riêng của Yến' }),
  );
  assert.equal(screen.queryByText('Thông tin riêng của Yến'), null);
  assert.equal(
    screen.queryByText('Tôi còn thiếu bao nhiêu?', { selector: 'p' }),
    null,
  );
  assert.ok(screen.getByText('Đang tra cứu cho Hiền'));
});
test('Offline chat disables sends, personal prompts request name selection, and length is bounded', async () => {
  let chosen = false;
  const p = props({
    online: false,
    memberName: null,
    onChoose: () => {
      chosen = true;
    },
    ask: async () => ({
      ...reply,
      answer: 'Chọn tên trước nhé.',
      needsMember: true,
      sources: [],
    }),
  });
  const { rerender } = render(<ClubChat {...p} />);
  open();
  ask('Tôi còn thiếu bao nhiêu?');
  assert.equal(
    (screen.getByRole('button', { name: 'Gửi câu hỏi' }) as HTMLButtonElement)
      .disabled,
    true,
  );
  assert.equal(screen.getByRole('textbox').getAttribute('maxlength'), '800');
  rerender(<ClubChat {...p} online />);
  fireEvent.click(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
  await waitFor(() =>
    assert.ok(screen.getByRole('button', { name: 'Chọn tên của tôi' })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Chọn tên của tôi' }));
  assert.equal(chosen, true);
});
test('Failed request shows retry without claiming success', async () => {
  render(
    <ClubChat
      {...props({
        ask: async () => {
          throw new Error('Chưa đọc được lịch mới nhất.');
        },
      })}
    />,
  );
  open();
  ask('Lịch tuần này?');
  await waitFor(() => assert.ok(screen.getByRole('alert')));
  assert.ok(screen.getByText('Chưa đọc được lịch mới nhất.'));
  assert.ok(screen.getByRole('button', { name: 'Thử lại' }));
  assert.equal(screen.queryByText(reply.answer), null);
});
