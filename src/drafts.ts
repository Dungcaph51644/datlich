// Only unsaved drafts live in memory. The database remains the source of truth.
// Keeping drafts across card/tab unmounts prevents losing a failed autosave.
export interface NoteDraft {
  text: string;
  baseText: string;
  baseVersion: number;
}
export const noteDrafts = new Map<string, NoteDraft>();

export interface NoteState extends NoteDraft {
  status: 'idle' | 'saving' | 'saved' | 'failed';
}
const states = new Map<string, NoteState>();
const listeners = new Map<string, Set<() => void>>();
export const noteRequests = new Map<string, Promise<boolean>>();
export function getNoteState(key: string, initial: NoteDraft): NoteState {
  let value = states.get(key);
  if (!value) {
    value = { ...initial, status: 'idle' };
    states.set(key, value);
  }
  return value;
}
export function updateNote(key: string, value: NoteState) {
  states.set(key, value);
  if (value.text !== value.baseText) noteDrafts.set(key, value);
  else noteDrafts.delete(key);
  listeners.get(key)?.forEach((notify) => notify());
}
export function subscribeNote(key: string, notify: () => void) {
  const group = listeners.get(key) ?? new Set();
  listeners.set(key, group);
  group.add(notify);
  return () => {
    group.delete(notify);
    if (!group.size) listeners.delete(key);
  };
}
export function resetNoteDrafts() {
  states.clear();
  noteDrafts.clear();
  noteRequests.clear();
}
