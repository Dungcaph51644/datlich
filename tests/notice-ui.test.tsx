import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { JSDOM } from 'jsdom';
import { useTransientNotice } from '../src/useTransientNotice';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
const { render, screen, fireEvent, cleanup, act } =
  await import('@testing-library/react');
afterEach(() => {
  cleanup();
  mock.timers.reset();
});

function Harness({ refresh = 0 }: { refresh?: number }) {
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'failed'>(
    'idle',
  );
  const { notice, setNotice } = useTransientNotice(phase);
  return (
    <>
      <span>{refresh}</span>
      <span aria-label="Trạng thái lưu">{phase}</span>
      <button onClick={() => setNotice('Đã lưu QR')}>Báo thành công</button>
      <button onClick={() => setNotice('Đã sao chép')}>Sao chép</button>
      <button
        onClick={() => {
          setPhase('failed');
          setNotice('Chưa lưu được, hãy thử lại');
        }}
      >
        Báo lỗi
      </button>
      <button onClick={() => setPhase('saving')}>Bắt đầu lưu</button>
      <button onClick={() => setPhase('saved')}>Lưu xong</button>
      <button onClick={() => setNotice('')}>Đóng</button>
      {notice && <p role={phase === 'failed' ? 'alert' : 'status'}>{notice}</p>}
    </>
  );
}

test('Success notices expire after four seconds despite snapshot rerenders; the same message restarts its lifetime', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const ui = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Báo thành công' }));
  await act(async () => mock.timers.tick(3000));
  ui.rerender(<Harness refresh={1} />);
  await act(async () => mock.timers.tick(999));
  assert.match(screen.getByRole('status').textContent ?? '', /Đã lưu QR/);
  await act(async () => mock.timers.tick(1));
  assert.equal(screen.queryByRole('status'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Báo thành công' }));
  await act(async () => mock.timers.tick(3000));
  fireEvent.click(screen.getByRole('button', { name: 'Báo thành công' }));
  await act(async () => mock.timers.tick(3999));
  assert.ok(screen.getByRole('status'));
  await act(async () => mock.timers.tick(1));
  assert.equal(screen.queryByRole('status'), null);
});

test('An old timeout cannot clear a newer notice; manual dismissal and unmount clear scheduled work', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const ui = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Báo thành công' }));
  await act(async () => mock.timers.tick(3500));
  fireEvent.click(screen.getByRole('button', { name: 'Sao chép' }));
  await act(async () => mock.timers.tick(500));
  assert.match(screen.getByRole('status').textContent ?? '', /Đã sao chép/);
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  assert.equal(screen.queryByRole('status'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Báo thành công' }));
  ui.unmount();
  render(<Harness />);
  await act(async () => mock.timers.tick(10000));
  assert.equal(screen.queryByRole('status'), null);
});

test('Toast dismissal does not change saving or failed states; errors have eight seconds to be read', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu lưu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Báo thành công' }));
  await act(async () => mock.timers.tick(4000));
  assert.equal(screen.queryByRole('status'), null);
  assert.equal(screen.getByLabelText('Trạng thái lưu').textContent, 'saving');
  fireEvent.click(screen.getByRole('button', { name: 'Lưu xong' }));
  fireEvent.click(screen.getByRole('button', { name: 'Báo lỗi' }));
  await act(async () => mock.timers.tick(7999));
  assert.match(screen.getByRole('alert').textContent ?? '', /Chưa lưu được/);
  await act(async () => mock.timers.tick(1));
  assert.equal(screen.queryByRole('alert'), null);
  assert.equal(screen.getByLabelText('Trạng thái lưu').textContent, 'failed');
});
