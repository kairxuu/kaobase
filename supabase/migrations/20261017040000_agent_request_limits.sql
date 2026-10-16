-- Réserver le quota avant tout appel IA ; les messages éditables ne font plus foi.
begin;

create table public.agent_request_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index agent_request_reservations_user_date_idx
  on public.agent_request_reservations (user_id, created_at);

alter table public.agent_request_reservations enable row level security;
create policy agent_request_reservations_read_own on public.agent_request_reservations
  for select using (user_id = (select auth.uid()));
-- Supabase peut accorder des droits par défaut aux nouveaux objets : les retirer
-- explicitement empêche de vider, antidater ou fabriquer ses réservations via REST.
revoke all on public.agent_request_reservations from public, anon, authenticated;
grant select on public.agent_request_reservations to authenticated;

-- Conserver l'usage connu de la fenêtre en cours au moment du changement.
insert into public.agent_request_reservations (user_id, created_at)
  select user_id, created_at from public.agent_messages
  where role = 'user' and created_at > now() - interval '24 hours' and created_at <= now();

create function public.reserve_agent_request()
returns table (allowed boolean, retry_after_seconds integer, limit_reason text, minute_count integer, day_count integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_minute integer;
  v_day integer;
  v_oldest_minute timestamptz;
  v_oldest_day timestamptz;
begin
  if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- Les SELECT suivants doivent voir les commits des demandes qui attendaient
  -- le même verrou. Refuser un instantané figé évite un contournement du quota.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Quota reservation requires READ COMMITTED' using errcode = '25000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kaobase.agent_requests:' || v_user_id::text, 0));
  v_now := pg_catalog.clock_timestamp();
  delete from public.agent_request_reservations
    where user_id = v_user_id and created_at <= v_now - interval '24 hours';
  select count(*) filter (where created_at > v_now - interval '1 minute')::integer,
         count(*)::integer,
         min(created_at) filter (where created_at > v_now - interval '1 minute'), min(created_at)
    into v_minute, v_day, v_oldest_minute, v_oldest_day
    from public.agent_request_reservations where user_id = v_user_id;

  if v_day >= 150 then
    return query select false,
      greatest(1, ceil(extract(epoch from v_oldest_day + interval '24 hours' - v_now))::integer),
      'day'::text, v_minute, v_day;
  elsif v_minute >= 6 then
    return query select false,
      greatest(1, ceil(extract(epoch from v_oldest_minute + interval '1 minute' - v_now))::integer),
      'minute'::text, v_minute, v_day;
  else
    insert into public.agent_request_reservations (user_id, created_at) values (v_user_id, v_now);
    return query select true, 0, null::text, v_minute + 1, v_day + 1;
  end if;
end;
$$;

revoke all on function public.reserve_agent_request() from public, anon, service_role;
grant execute on function public.reserve_agent_request() to authenticated;

notify pgrst, 'reload schema';
commit;
