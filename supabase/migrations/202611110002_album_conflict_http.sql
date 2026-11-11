-- Upgrade an already deployed team album without touching its data, privileges,
-- Storage bucket, publication or any other application's RPC definitions.
-- Business version conflicts are HTTP 409, NOT PostgreSQL serialization errors.
-- PostgREST 14 may infinitely retry a manually raised SQLSTATE 40001.
begin;
do $$
declare signature text; target oid; definition text; replacement text;
begin
  foreach signature in array array[
    'public.save_team_album(uuid,jsonb,integer)',
    'public.save_team_album_photo(uuid,jsonb,integer)',
    'public.set_team_album_deleted(uuid,boolean,integer)',
    'public.set_team_album_photo_deleted(uuid,boolean,integer)'
  ] loop
    target:=to_regprocedure(signature);
    if target is null then
      raise exception 'Thiếu API %. Hãy chạy migration Album đội 202611110001 trước.',signature;
    end if;
    definition:=pg_get_functiondef(target);
    replacement:=regexp_replace(definition,'\merrcode\s*=\s*''40001''','errcode=''PT409''','gi');
    if replacement<>definition then
      -- CREATE OR REPLACE preserves the current owner and existing grants.
      execute replacement;
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
