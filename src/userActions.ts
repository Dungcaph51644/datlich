/** Explicit, user-triggered sharing; never sends a message to another service. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Older embedded browsers can still support the selection-based copy action.
  }
  const active = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : [];
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  Object.assign(input.style, { position: 'fixed', left: '0', top: '0', opacity: '0' });
  const dialogs = document.querySelectorAll('dialog[open]');
  (dialogs[dialogs.length - 1] ?? document.body).append(input);
  let copied = false;
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, text.length);
    copied = !!document.execCommand?.('copy');
  } finally {
    input.remove();
    active?.focus({ preventScroll: true });
    if (selection && ranges.length) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
  if (!copied) throw new Error('Trình duyệt chưa cho phép sao chép. Hãy thử mở trang bằng trình duyệt của điện thoại.');
}

/** UTF-8 CSV includes a BOM so spreadsheet apps preserve Vietnamese names. */
export function downloadText(text: string, filename: string, mime = 'text/csv;charset=utf-8'): void {
  const content = /csv/i.test(mime) && !text.startsWith('\uFEFF') ? '\uFEFF' + text : text;
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[\\/\u0000-\u001f]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
