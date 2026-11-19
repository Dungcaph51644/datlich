import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import type { useClub } from '../src/useClub';
import type { Attendance, CourtSession, Member } from '../src/types';
import {
  attendanceWriteRequest,
  verifiedAttendanceMember,
} from '../src/attendanceAccess';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://club.test/',
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
const { render, screen, fireEvent, cleanup, waitFor } =
  await import('@testing-library/react');
const { AttendanceMemberRow } = await import('../src/AttendanceMemberRow');
const { AutoNote } = await import('../src/AutoNote');
const { resetNoteDrafts } = await import('../src/drafts');
type Club = ReturnType<typeof useClub>;
const actor: Member = {
  id: 'actor',
  display_name: 'Yến',
  code: 'CL-1',
  note: '',
  active: true,
  version: 1,
};
const target: Member = {
  ...actor,
  id: 'target',
  display_name: 'Hiền',
  code: 'CL-2',
};
const session: CourtSession = {
  id: 'session',
  session_date: '2099-05-21',
  start_time: '18:00:00',
  end_time: '20:00:00',
  venue: 'Sân A',
  court: 'Ca 1',
  address: '',
  maps_url: '',
  organizer_id: actor.id,
  booking_status: 'booked',
  max_players: 2,
  deadline: null,
  note: '',
  version: 1,
};
const attendance: Attendance = {
  id: 'row',
  session_id: session.id,
  member_id: target.id,
  status: 'not_going',
  note: 'Bận',
  note_version: 3,
  updated_at: '2099-05-20T03:00:00Z',
};
const club = (patch: Partial<Club> = {}) =>
  ({
    account: null,
    booking: null,
    me: actor,
    memberId: actor.id,
    members: [actor, target],
    online: true,
    saveState: 'idle',
    saveAttendance: async () => true,
    ...patch,
  }) as Club;
afterEach(() => {
  cleanup();
  resetNoteDrafts();
});

test('Every verified member can change another person’s status and open their note without selecting that name', async () => {
  for (const identity of [
    { booking: { verified_member_id: actor.id } },
    { account: { user_id: 'account', member_id: actor.id, role: 'member' } },
  ]) {
    const writes: Record<string, unknown>[] = [];
    let noteTarget: Member | null = null;
    const c = club({
      ...identity,
      saveAttendance: async (args) => {
        writes.push(args);
        return true;
      },
    } as Partial<Club>);
    render(
      <AttendanceMemberRow
        session={session}
        member={target}
        row={attendance}
        club={c}
        locked={false}
        onNote={(m) => {
          noteTarget = m;
        }}
      />,
    );
    const going = screen.getByRole('button', {
      name: 'Đi',
      exact: true,
    }) as HTMLButtonElement;
    assert.equal(going.disabled, false);
    fireEvent.click(going);
    await waitFor(() => assert.equal(writes.length, 1));
    assert.equal(writes[0].p_member_id, target.id);
    assert.equal(writes[0].p_status, 'going');
    assert.equal(writes[0].p_note, null);
    fireEvent.click(screen.getByRole('button', { name: 'Bận' }));
    assert.equal(noteTarget?.id, target.id);
    assert.equal(c.memberId, actor.id);
    cleanup();
  }
});

test('Chosen-name users keep their own controls; verification loss, inactive members, locked sessions and offline state disable proxy controls', () => {
  const c = club();
  const view = render(
    <AttendanceMemberRow
      session={session}
      member={target}
      row={attendance}
      club={c}
      locked={false}
      onNote={() => {}}
    />,
  );
  const allDisabled = () =>
    assert.ok(
      screen
        .getAllByRole('button')
        .every((b) => (b as HTMLButtonElement).disabled),
    );
  allDisabled();
  view.rerender(
    <AttendanceMemberRow
      session={session}
      member={actor}
      club={c}
      locked={false}
      onNote={() => {}}
    />,
  );
  assert.equal(
    (
      screen.getByRole('button', {
        name: 'Đi',
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
    false,
  );
  const verified = club({
    booking: { verified_member_id: actor.id },
  } as Partial<Club>);
  for (const [state, person, locked] of [
    [{ ...verified, online: false }, target, false],
    [verified, target, true],
    [verified, { ...target, active: false }, false],
    [{ ...verified, booking: { verified_member_id: null } }, target, false],
    [
      { ...verified, members: [{ ...actor, active: false }, target] },
      target,
      false,
    ],
  ] as const) {
    view.rerender(
      <AttendanceMemberRow
        session={session}
        member={person}
        row={attendance}
        club={state as Club}
        locked={locked}
        onNote={() => {}}
      />,
    );
    allDisabled();
  }
});

test('Verified writes forward the current token and the target, never a caller-supplied actor or token', () => {
  const code = club({
    booking: { verified_member_id: actor.id },
    memberId: target.id,
  } as Partial<Club>);
  for (const status of ['going', 'not_going', 'unanswered', null]) {
    const request = attendanceWriteRequest(
      {
        p_session_id: session.id,
        p_member_id: target.id,
        p_status: status,
        p_note: status === null ? 'Đến muộn' : null,
        p_expected_note_version: 3,
        p_token: 'spoofed-token',
        p_actor_id: target.id,
      },
      code,
      true,
      'current-verified-token',
    );
    assert.equal(request.name, 'set_verified_attendance');
    assert.equal(request.args.p_member_id, target.id);
    assert.equal(request.args.p_status, status);
    assert.equal(request.args.p_token, 'current-verified-token');
    assert.equal('p_actor_id' in request.args, false);
  }
  const account = club({
    account: { user_id: 'account', member_id: actor.id, role: 'member' },
  });
  assert.equal(
    attendanceWriteRequest(
      { p_member_id: target.id, p_status: 'going' },
      account,
      true,
      null,
    ).name,
    'set_verified_attendance',
  );
  assert.equal(
    attendanceWriteRequest({ p_member_id: actor.id }, club(), true, null).name,
    'quick_set_attendance',
  );
  assert.equal(verifiedAttendanceMember(club()), null);
});

test('Autosaving a proxy note targets that member and keeps status untouched', async () => {
  const writes: ReturnType<typeof attendanceWriteRequest>[] = [];
  const c = club({
    booking: { verified_member_id: actor.id },
  } as Partial<Club>);
  c.saveAttendance = async (args) => {
    writes.push(attendanceWriteRequest(args, c, true, 'token'));
    return true;
  };
  render(
    <AutoNote
      session={session}
      memberId={target.id}
      row={attendance}
      club={c}
    />,
  );
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Yến note hộ Hiền đến muộn' } });
  fireEvent.blur(input);
  await waitFor(() => assert.ok(screen.getByText('Đã lưu')));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, 'set_verified_attendance');
  assert.equal(writes[0].args.p_member_id, target.id);
  assert.equal(writes[0].args.p_status, null);
  assert.equal(writes[0].args.p_expected_note_version, 3);
  assert.equal(writes[0].args.p_note, 'Yến note hộ Hiền đến muộn');
});
