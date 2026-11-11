import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://club.test/' });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
  navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement,
  Node: dom.window.Node, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
const { Modal } = await import('../src/Modal');
let confirmed = false;
let questions = 0;
beforeEach(() => { confirmed = false; questions = 0; dom.window.confirm = () => { questions++; return confirmed; }; });
afterEach(cleanup);

function Fixture({ close, locked = false, protect = true }: { close: () => void; locked?: boolean; protect?: boolean }) {
  return <Modal title="Chi phí" onClose={close} locked={locked} protectUnsaved={protect}>
    <form><label>Ghi chú<input name="note" defaultValue="Ban đầu" /></label>
      <button type="button" data-modal-close onClick={close}>Để sau</button>
    </form>
  </Modal>;
}

test('A dirty form keeps its input when closing is declined; Escape and explicit cancel use the same guard', () => {
  let closes = 0;
  render(<Fixture close={() => closes++} />);
  fireEvent.change(screen.getByLabelText('Ghi chú'), { target: { value: 'Nội dung mới chưa lưu' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đóng cửa sổ' }));
  assert.equal(closes, 0);
  assert.equal(questions, 1);
  assert.equal((screen.getByLabelText('Ghi chú') as HTMLInputElement).value, 'Nội dung mới chưa lưu');
  fireEvent(screen.getByRole('dialog'), new dom.window.Event('cancel', { cancelable: true }));
  assert.equal(closes, 0);
  assert.equal(questions, 2);
  confirmed = true;
  fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
  assert.equal(closes, 1, 'Cancel is guarded once and does not also run its old callback');
  assert.equal(questions, 3);
});

test('Dirty forms warn before a reload; reverting to the original value and unmount remove the warning', () => {
  const view = render(<Fixture close={() => {}} />);
  fireEvent.input(screen.getByLabelText('Ghi chú'), { target: { value: 'Chưa lưu' } });
  const leave = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leave);
  assert.equal(leave.defaultPrevented, true);
  fireEvent.input(screen.getByLabelText('Ghi chú'), { target: { value: 'Ban đầu' } });
  const clean = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(clean);
  assert.equal(clean.defaultPrevented, false);
  fireEvent.click(screen.getByRole('button', { name: 'Đóng cửa sổ' }));
  assert.equal(questions, 0, 'Reverting does not require a discard confirmation');
  view.unmount();
  const detached = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(detached);
  assert.equal(detached.defaultPrevented, false);
});

test('Locked writes cannot close, and upload dialogs can use their own queue guard without a second confirmation', () => {
  let closes = 0;
  const view = render(<Fixture close={() => closes++} locked />);
  fireEvent.input(screen.getByLabelText('Ghi chú'), { target: { value: 'Đang lưu' } });
  fireEvent(screen.getByRole('dialog'), new dom.window.Event('cancel', { cancelable: true }));
  assert.equal(closes, 0);
  assert.equal(questions, 0);
  view.rerender(<Fixture close={() => closes++} protect={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Đóng cửa sổ' }));
  assert.equal(closes, 1);
  assert.equal(questions, 0);
});
