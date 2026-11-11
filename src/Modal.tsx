import React, { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({
  title,
  children,
  onClose,
  wide,
  locked,
  protectUnsaved = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  locked?: boolean;
  protectUnsaved?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const baseline = useRef(new Map<HTMLFormElement, string>());
  const dirty = useRef(false);
  function fingerprint(form: HTMLFormElement) {
    const Form = form.ownerDocument.defaultView!.FormData;
    return JSON.stringify(Array.from(new Form(form).entries(), ([key, value]) => [
      key,
      typeof value === 'string' ? value : [value.name, value.size, value.lastModified],
    ]));
  }
  useLayoutEffect(() => {
    for (const form of ref.current?.querySelectorAll('form') ?? []) {
      if (!baseline.current.has(form) || !dirty.current) baseline.current.set(form, fingerprint(form));
    }
  });
  function updateDirty() {
    if (!protectUnsaved) return;
    dirty.current = Array.from(ref.current?.querySelectorAll('form') ?? []).some((form) =>
      baseline.current.has(form) && baseline.current.get(form) !== fingerprint(form),
    );
  }
  function requestClose() {
    if (locked) return;
    updateDirty();
    if (protectUnsaved && dirty.current && !window.confirm('Bạn có thay đổi chưa lưu. Bỏ các thay đổi và đóng cửa sổ?')) return;
    onClose();
  }
  useEffect(() => {
    if (!protectUnsaved) return;
    const leaving = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, [protectUnsaved]);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      className={`modal ${wide ? 'wide' : ''}`}
      onInputCapture={updateDirty}
      onChangeCapture={updateDirty}
      onClickCapture={(event) => {
        const target = event.target;
        const ElementClass = event.currentTarget.ownerDocument.defaultView!.Element;
        if (target instanceof ElementClass && target.closest('button[data-modal-close]')) {
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (e.target !== ref.current || locked) return;
        const r = ref.current.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          requestClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={headingId}>{title}</h2>
        <button
          className="icon-btn"
          aria-label="Đóng cửa sổ"
          disabled={locked}
          onClick={requestClose}
        >
          <X size={21} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
