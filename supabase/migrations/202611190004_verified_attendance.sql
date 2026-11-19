-- Run after booking, finance and the current registration upgrades.
-- Verified active members may register and write notes for the session roster.
-- Reuse the existing registration lock, deadlines, version checks and audit.
begin;

create or replace function public.set_verified_attendance(
  p_session_id uuid,
  p_member_id uuid,
  p_status text default null,
  p_note text default null,
  p_expected_note_version integer default null,
  p_token text default null
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.booking_lock();
  perform private.require_booking_actor(p_token);
  -- Clear selected-name attribution so audit records the verified actor, not
  -- the member whose note is being edited. Never accept an actor ID from UI.
  perform set_config('app.quick_member_id','',true);
  perform private.write_attendance(
    p_session_id,p_member_id,p_status,p_note,p_expected_note_version,public.is_admin()
  );
end; $$;
revoke all on function public.set_verified_attendance(uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.set_verified_attendance(uuid,uuid,text,text,integer,text) to anon,authenticated;

notify pgrst,'reload schema';
commit;
