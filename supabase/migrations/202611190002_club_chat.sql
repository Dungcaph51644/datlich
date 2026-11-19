-- Read-only, scoped chatbot context. Run after the existing finance upgrades.
begin;

create table if not exists private.chat_usage_windows (
  bucket text not null,
  window_start timestamptz not null,
  used integer not null check(used>=0),
  primary key(bucket,window_start)
);
revoke all on private.chat_usage_windows from public,anon,authenticated;

-- Only the Edge Function's server credential can reserve a model request.
-- Fixed windows: 6/min + 40/day per hashed client; 40/min + 300/day globally.
create or replace function public.reserve_chat_request(p_client_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare minute_start timestamptz:=date_trunc('minute',now()); day_start timestamptz:=date_trunc('day',now());
  b text; w timestamptz; lim integer; n integer; i integer;
begin
  if p_client_hash is null or p_client_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid client bucket'; end if;
  perform pg_advisory_xact_lock(hashtext('club-chat-budget'));
  delete from private.chat_usage_windows where window_start<day_start-interval '2 days';
  for i in 1..4 loop
    b:=case when i<=2 then p_client_hash else 'global' end||case when i in (1,3) then ':minute' else ':day' end;
    w:=case when i in (1,3) then minute_start else day_start end;
    lim:=case i when 1 then 6 when 2 then 40 when 3 then 40 else 300 end;
    select used into n from private.chat_usage_windows where bucket=b and window_start=w;
    if coalesce(n,0)>=lim then
      return jsonb_build_object('allowed',false,'retry_after',greatest(1,ceil(extract(epoch from w+case when i in (1,3) then interval '1 minute' else interval '1 day' end-now()))));
    end if;
  end loop;
  for i in 1..4 loop
    b:=case when i<=2 then p_client_hash else 'global' end||case when i in (1,3) then ':minute' else ':day' end;
    w:=case when i in (1,3) then minute_start else day_start end;
    insert into private.chat_usage_windows values(b,w,1)
    on conflict(bucket,window_start) do update set used=private.chat_usage_windows.used+1;
  end loop;
  return jsonb_build_object('allowed',true,'retry_after',0);
end; $$;
revoke all on function public.reserve_chat_request(text) from public,anon,authenticated;
grant execute on function public.reserve_chat_request(text) to service_role;

create or replace function public.get_chat_context(
  p_scope text,p_start date,p_end date,p_member_id uuid default null,
  p_session_id uuid default null,p_activity_id uuid default null,
  p_personal boolean default false,p_all_balances boolean default false,p_token text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; chosen jsonb; verified uuid:=private.booking_actor(p_token);
  sessions jsonb:='[]'; assignments jsonb:='[]'; activities jsonb:='[]'; item jsonb; calc jsonb;
  a public.club_activities; s record; total integer:=0; assignment_total integer:=0; returned integer:=0; people jsonb; expenses jsonb;
begin
  if p_scope not in ('schedule','booking','finance','travel','guide') or p_scope is null then raise exception 'Phạm vi tra cứu không hợp lệ.'; end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Khoảng ngày tra cứu không hợp lệ.'; end if;
  select jsonb_build_object('id',id,'name',display_name,'code',code) into chosen from public.members where id=p_member_id and active;
  result:=jsonb_build_object('version',1,'checked_at',now(),'today',private.vn_today(),'scope',p_scope,'start',p_start,'end',p_end,
    'selected_member',chosen,'needs_member',p_personal and chosen is null,'finance_authorized',verified is not null,'limited',false);
  if p_personal and chosen is null then return result; end if;
  if p_personal and p_scope in ('finance','travel') and verified is null then return result; end if;

  if p_scope in ('schedule','booking') then
    select count(*) into total from public.sessions where (p_session_id is null and session_date between p_start and p_end) or id=p_session_id;
    for s in
      select x.*,m.display_name organizer_name,b.display_name booked_by_name,
        (select count(*) from public.attendance t where t.session_id=x.id and t.status='going') registered
      from public.sessions x left join public.members m on m.id=x.organizer_id left join public.members b on b.id=x.booked_by_member_id
      where (p_session_id is null and x.session_date between p_start and p_end) or x.id=p_session_id
      order by x.session_date,x.start_time,x.id limit 8
    loop
      item:=jsonb_build_object('id',s.id,'date',s.session_date,'start_time',s.start_time,'end_time',s.end_time,
        'venue',left(s.venue,160),'court',left(s.court,80),'address',left(s.address,300),'booking_status',s.booking_status,
        'organizer',s.organizer_name,'actual_booker',s.booked_by_name,'registered_count',s.registered,'max_players',s.max_players,
        'remaining_places',case when s.booking_status='cancelled' then null when s.max_players is null then null else greatest(0,s.max_players-s.registered) end,
        'registration_closed',s.booking_status='cancelled' or (s.session_date+s.end_time) at time zone 'Asia/Ho_Chi_Minh'<=now() or coalesce(s.deadline<=now(),false),
        'deadline',s.deadline,'estimated_court_cost',s.estimated_cost,
        'my_status',case when p_personal then (select status from public.attendance where session_id=s.id and member_id=p_member_id) end,
        'registered_names',coalesce((select jsonb_agg(display_name order by display_name) from (
          select m.display_name from public.attendance t join public.members m on m.id=t.member_id where t.session_id=s.id and t.status='going' order by m.display_name limit 24
        ) names),'[]'),'names_limited',s.registered>24);
      sessions:=sessions||jsonb_build_array(item);
    end loop;
    result:=result||jsonb_build_object('sessions',sessions,'total_matches',total,'limited',total>8);
    if p_scope='booking' then
      select count(*) into assignment_total from public.weekly_booking_assignments where week_start<=p_end and week_end>=p_start;
      select coalesce(jsonb_agg(jsonb_build_object('week_start',w.week_start,'week_end',w.week_end,'organizer',m.display_name) order by w.week_start),'[]')
      into assignments from (select * from public.weekly_booking_assignments where week_start<=p_end and week_end>=p_start order by week_start limit 8) w
      join public.members m on m.id=w.member_id;
      result:=result||jsonb_build_object('assignments',assignments,'assignment_total',assignment_total,'limited',total>8 or assignment_total>8);
    end if;
  elsif p_scope in ('finance','travel') then
    -- Select activities before computing money; never return ledger rows,
    -- private notes, emails, credential hashes, or a complete club snapshot.
    for a in
      select x.* from public.club_activities x
      where x.merged_into_id is null
        and (p_activity_id is null or x.id=p_activity_id)
        and (p_scope<>'travel' or x.kind='trip')
        and (p_activity_id is not null or (p_all_balances and p_personal) or
          (x.kind='trip' and coalesce(nullif(x.details->>'end_date',''),nullif(x.details->>'start_date',''),'9999-12-31')>=p_start::text
            and coalesce(nullif(x.details->>'start_date',''),'0001-01-01')<=p_end::text) or
          exists(select 1 from public.activity_groups g join public.sessions t on t.id=g.session_id where g.activity_id=x.id and t.session_date between p_start and p_end))
      order by x.created_at desc,x.id
    loop
      -- Personal balances only include activities involving the selected member.
      if p_personal and not (
        exists(select 1 from public.activity_groups g join public.attendance t on t.session_id=g.session_id where g.activity_id=a.id and t.member_id=p_member_id)
        or exists(select 1 from public.activity_groups g join public.activity_billable b on b.group_id=g.id where g.activity_id=a.id and b.member_id=p_member_id)
        or exists(select 1 from public.trip_participants t where t.activity_id=a.id and t.member_id=p_member_id)
        or exists(select 1 from public.activity_ledger l where l.activity_id=a.id and (l.person_id=p_member_id or l.person_id in (select id from public.trip_participants where activity_id=a.id and member_id=p_member_id)))
      ) then continue; end if;
      total:=total+1;
      if returned>=8 then continue; end if;
      returned:=returned+1;
      item:=jsonb_build_object('id',a.id,'kind',a.kind,'title',left(a.title,180),'status',a.status,'fee_status',a.fee_status,
        'organizer',(select display_name from public.members where id=a.organizer_id),
        'start_date',a.details->>'start_date','end_date',a.details->>'end_date','location',left(a.details->>'location',200),
        'session_dates',coalesce((select jsonb_agg(distinct t.session_date) from public.activity_groups g join public.sessions t on t.id=g.session_id where g.activity_id=a.id),'[]'));
      if verified is not null then
        calc:=case when a.fee_status='finalized' then a.final_summary else private.finance_calculate(a.id) end;
        select coalesce(jsonb_agg(jsonb_build_object('name',e.name,'category',e.category,'estimated',e.estimated,'actual',e.actual,'scope',e.scope,'group',g.label)),'[]')
          into expenses from (select * from public.activity_expenses where activity_id=a.id and voided_at is null order by id limit 12) e left join public.activity_groups g on g.id=e.group_id;
        select coalesce(jsonb_agg(jsonb_build_object('name',p->>'name','due',(p->>'due')::numeric,'net_paid',paid,
          'balance',(p->>'due')::numeric-paid)),'[]') into people from (
          select p,coalesce((select sum(case when l.kind='refund' then -l.amount else l.amount end) from public.activity_ledger l
            where l.activity_id=a.id and l.person_id=(p->>'id')::uuid and l.voided_at is null and l.kind in ('collection','supplement','refund')),0) paid
          from jsonb_array_elements(coalesce(calc->'people','[]')) p
          where not p_personal or p->>'member_id'=p_member_id::text
          order by p->>'name' limit 24
        ) balances;
        item:=item||jsonb_build_object('calculation_available',calc is not null,'total_cost',calc->'total_cost','estimated',calc->'estimated','headcount',calc->'headcount','shares',calc->'shares',
          'warnings',calc->'warnings','expenses',expenses,'people',people,
          'people_limited',(select count(*) from jsonb_array_elements(coalesce(calc->'people','[]')) p where not p_personal or p->>'member_id'=p_member_id::text)>24,
          'expenses_limited',(select count(*) from public.activity_expenses where activity_id=a.id and voided_at is null)>12,
          'has_expenses',exists(select 1 from public.activity_expenses where activity_id=a.id and voided_at is null));
        -- A traveller who cancelled after paying still needs a refund line.
        if p_personal and a.kind='trip' then
          select coalesce(jsonb_agg(jsonb_build_object('name',chosen->>'name','due',0,'net_paid',paid,'balance',-paid)),'[]') into people
          from (select t.id,coalesce(sum(case when l.kind='refund' then -l.amount else l.amount end),0) paid
            from public.trip_participants t join public.activity_ledger l on l.person_id=t.id and l.activity_id=a.id and l.voided_at is null
            and l.kind in ('collection','supplement','refund') where t.activity_id=a.id and t.member_id=p_member_id
            and not exists(select 1 from jsonb_array_elements(coalesce(calc->'people','[]')) p where p->>'id'=t.id::text)
            group by t.id) refunds where paid<>0;
          item:=jsonb_set(item,'{people}',(item->'people')||people);
        end if;
        if p_scope='travel' then
          item:=item||jsonb_build_object('participants',coalesce((select jsonb_agg(jsonb_build_object('name',coalesce(m.display_name,t.guest_name),'status',t.status))
            from (select * from public.trip_participants where activity_id=a.id order by id limit 24) t left join public.members m on m.id=t.member_id),'[]'),
            'participants_limited',(select count(*) from public.trip_participants where activity_id=a.id)>24);
        end if;
      end if;
      activities:=activities||jsonb_build_array(item);
    end loop;
    result:=result||jsonb_build_object('activities',activities,'total_matches',total,'limited',total>8);
  end if;
  return result;
end; $$;
revoke all on function public.get_chat_context(text,date,date,uuid,uuid,uuid,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.get_chat_context(text,date,date,uuid,uuid,uuid,boolean,boolean,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
