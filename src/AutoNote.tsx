import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import {
  getNoteState,
  noteRequests,
  subscribeNote,
  updateNote,
  type NoteState,
} from './drafts';
import { registrationClosed } from './lib';
import type { Attendance, CourtSession } from './types';
import type { useClub } from './useClub';

export function AutoNote({
  session,
  memberId,
  row,
  club,
  disabled = false,
}: {
  session: CourtSession;
  memberId: string;
  row?: Attendance;
  club: ReturnType<typeof useClub>;
  disabled?: boolean;
}) {
  const key = `${session.id}:${memberId}`;
  const initial = {
    text: row?.note ?? '',
    baseText: row?.note ?? '',
    baseVersion: row?.note_version ?? 0,
  };
  const draft = useSyncExternalStore(
    (notify) => subscribeNote(key, notify),
    () => getNoteState(key, initial),
  );
  const current = () => getNoteState(key, initial);
  const incoming = useRef(row);
  incoming.current = row;
  const flushRef = useRef<(retry?: boolean) => Promise<boolean>>(
    async () => true,
  );
  const dirty = draft.text !== draft.baseText;
  const pending = draft.status === 'saving';
  const conflict = !pending && (row?.note_version ?? 0) > draft.baseVersion;

  flushRef.current = async (retry = false) => {
    const existing = noteRequests.get(key);
    if (existing) return existing;
    const start = current();
    if (start.text === start.baseText) return true;
    if (
      (start.status === 'failed' && !retry) ||
      disabled ||
      registrationClosed(session, club.account?.role === 'admin') ||
      (incoming.current?.note_version ?? 0) > start.baseVersion
    )
      return false;
    updateNote(key, { ...start, status: 'saving' });
    const operation = (async () => {
      const ok = await club.saveAttendance(
        {
          p_session_id: session.id,
          p_member_id: memberId,
          p_status: null,
          p_note: start.text,
          p_expected_note_version: start.baseVersion,
        },
        '',
        true,
      );
      const latest = current();
      if (ok) {
        const next = {
          ...latest,
          baseText: start.text,
          baseVersion: start.baseVersion + 1,
        };
        updateNote(key, {
          ...next,
          status: next.text === next.baseText ? 'saved' : 'idle',
        });
      } else updateNote(key, { ...latest, status: 'failed' });
      return ok;
    })().finally(() => noteRequests.delete(key));
    noteRequests.set(key, operation);
    return operation;
  };
  useEffect(() => {
    const now = current(),
      version = row?.note_version ?? 0,
      text = row?.note ?? '';
    if (now.status === 'saving' || version < now.baseVersion) return;
    // An identical server value confirms the draft even if another mounted
    // editor or another device submitted it. Different content remains a conflict.
    if (text === now.text) {
      if (now.baseVersion !== version || now.baseText !== text)
        updateNote(key, {
          text,
          baseText: text,
          baseVersion: version,
          status: 'saved',
        });
    } else if (now.text === now.baseText) {
      updateNote(key, {
        text,
        baseText: text,
        baseVersion: version,
        status: 'idle',
      });
    }
  }, [key, row?.note, row?.note_version, pending]);
  useEffect(() => {
    if (!dirty || conflict || disabled || pending || draft.status === 'failed')
      return;
    const timer = setTimeout(() => void flushRef.current(), 700);
    return () => clearTimeout(timer);
  }, [
    draft.text,
    draft.baseVersion,
    draft.status,
    dirty,
    conflict,
    disabled,
    pending,
  ]);
  useEffect(
    () => () => {
      if (current().text !== current().baseText) void flushRef.current();
    },
    [key],
  );

  function edit(patch: Partial<NoteState>) {
    updateNote(key, { ...current(), ...patch });
  }
  return (
    <div className="auto-note">
      <label>
        <span>
          Ghi chú <small>tự lưu</small>
        </span>
        <textarea
          rows={2}
          maxLength={1000}
          disabled={disabled}
          value={draft.text}
          placeholder="Đến muộn, mang cầu…"
          onChange={(e) =>
            edit({ text: e.target.value, status: pending ? 'saving' : 'idle' })
          }
          onBlur={() => void flushRef.current()}
        />
      </label>
      <div className={`note-save-state ${draft.status}`} role="status">
        {pending ? (
          <>
            <LoaderCircle size={12} className="spin" />
            Đang lưu…
          </>
        ) : disabled && dirty ? (
          'Mất mạng · ghi chú chưa được lưu'
        ) : conflict ? (
          'Có bản mới trên thiết bị khác'
        ) : draft.status === 'failed' ? (
          <>
            Chưa lưu, bản nháp vẫn được giữ.{' '}
            <button onClick={() => void flushRef.current(true)}>Thử lại</button>
          </>
        ) : draft.status === 'saved' && !dirty ? (
          <>
            <CircleCheck size={12} />
            Đã lưu
          </>
        ) : dirty ? (
          'Đang chờ lưu…'
        ) : (
          'Ghi chú được lưu trực tiếp lên nhóm'
        )}
      </div>
      {conflict && (
        <div className="conflict-box">
          <strong>Ghi chú vừa thay đổi</strong>
          <blockquote>{row?.note || '(Trống)'}</blockquote>
          <p>Bản bạn nhập vẫn được giữ. Chọn nội dung muốn dùng:</p>
          <div className="conflict-actions">
            <button
              className="btn btn-soft"
              onClick={() =>
                edit({
                  text: row?.note ?? '',
                  baseText: row?.note ?? '',
                  baseVersion: row?.note_version ?? 0,
                  status: 'saved',
                })
              }
            >
              Dùng bản mới
            </button>
            <button
              className="btn btn-outline"
              onClick={() =>
                edit({
                  baseText: row?.note ?? '',
                  baseVersion: row?.note_version ?? 0,
                  status: 'idle',
                })
              }
            >
              Giữ bản của tôi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
