-- Références non secrètes aux autorisations conservées par Nango.
-- Les routes serveur vérifient le propriétaire de la connexion chez Nango
-- avant toute association ou suppression distante. Aucun jeton n'est stocké ici.
begin;

alter table public.app_shortcuts
  add constraint app_shortcuts_user_id_id_key unique (user_id, id);

create table public.app_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shortcut_id uuid not null unique,
  provider_id text not null,
  provider_name text not null,
  integration_id text not null,
  connection_id text not null,
  connected_at timestamptz not null default now(),
  constraint app_oauth_connections_shortcut_owner_fkey
    foreign key (user_id, shortcut_id) references public.app_shortcuts(user_id, id) on delete cascade,
  constraint app_oauth_connections_provider_id_check check (
    char_length(provider_id) between 1 and 128
    and provider_id = regexp_replace(provider_id, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and provider_id !~ '[[:cntrl:]]'
  ),
  constraint app_oauth_connections_provider_name_check check (
    char_length(provider_name) between 1 and 160
    and provider_name = regexp_replace(provider_name, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and provider_name !~ '[[:cntrl:]]'
  ),
  constraint app_oauth_connections_integration_id_check check (
    char_length(integration_id) between 1 and 255
    and integration_id = regexp_replace(integration_id, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and integration_id !~ '[[:cntrl:]]'
  ),
  constraint app_oauth_connections_connection_id_check check (
    char_length(connection_id) between 1 and 255
    and connection_id = regexp_replace(connection_id, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and connection_id !~ '[[:cntrl:]]'
  ),
  constraint app_oauth_connections_user_integration_connection_key
    unique (user_id, integration_id, connection_id)
);

create index app_oauth_connections_user_connected_idx
  on public.app_oauth_connections (user_id, connected_at desc, id);

alter table public.app_oauth_connections enable row level security;
create policy app_oauth_connections_select_own on public.app_oauth_connections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy app_oauth_connections_insert_own on public.app_oauth_connections
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy app_oauth_connections_update_own on public.app_oauth_connections
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy app_oauth_connections_delete_own on public.app_oauth_connections
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.app_oauth_connections from public, anon, authenticated;
grant select, insert, update, delete on public.app_oauth_connections to authenticated;

-- Le callback peut être reçu plusieurs fois. Le verrou sérialise les callbacks
-- d'un utilisateur, puis l'index unique garantit l'identité de l'association.
create function public.complete_app_oauth_connection(
  p_provider_id text,
  p_provider_name text,
  p_integration_id text,
  p_connection_id text,
  p_name text,
  p_url text,
  p_account_label text,
  p_category text,
  p_space text,
  p_pinned boolean
)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_shortcut_id uuid;
  v_provider_id text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentification requise.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_oauth_connections:' || v_user_id::text, 0));

  select shortcut_id, provider_id into v_shortcut_id, v_provider_id
    from public.app_oauth_connections
    where user_id = v_user_id and integration_id = p_integration_id and connection_id = p_connection_id
    for update;
  if found then
    if v_provider_id is distinct from p_provider_id then
      raise exception using errcode = '23514', message = 'Le service ne correspond pas à la connexion enregistrée.';
    end if;
    return v_shortcut_id;
  end if;

  insert into public.app_shortcuts (name, url, account_label, category, space, pinned)
    values (p_name, p_url, p_account_label, p_category, p_space, p_pinned)
    on conflict (user_id, space, url, account_label) do nothing
    returning id into v_shortcut_id;
  if v_shortcut_id is null then
    select id into v_shortcut_id from public.app_shortcuts
      where user_id = v_user_id and space = p_space and url = p_url and account_label = p_account_label
      for update;
  end if;

  if exists (select 1 from public.app_oauth_connections where shortcut_id = v_shortcut_id) then
    raise exception using errcode = '23505', message = 'Ce raccourci est déjà associé à une autre connexion.';
  end if;

  insert into public.app_oauth_connections
    (shortcut_id, provider_id, provider_name, integration_id, connection_id)
    values (v_shortcut_id, p_provider_id, p_provider_name, p_integration_id, p_connection_id);
  return v_shortcut_id;
end;
$$;

revoke all on function public.complete_app_oauth_connection(text, text, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.complete_app_oauth_connection(text, text, text, text, text, text, text, text, text, boolean) to authenticated;

-- Un quota serveur protège la création de sessions OAuth chez le fournisseur.
-- Les clients ne peuvent ni supprimer ni antidater les réservations.
create table public.app_connect_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index app_connect_requests_user_date_idx on public.app_connect_requests (user_id, created_at);
alter table public.app_connect_requests enable row level security;
revoke all on public.app_connect_requests from public, anon, authenticated;

create function public.reserve_app_connect_session()
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz;
  v_count integer;
  v_oldest timestamptz;
begin
  if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
    raise exception using errcode = '42501', message = 'Authentification requise.';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'Quota reservation requires READ COMMITTED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_connect_requests:' || v_user_id::text, 0));
  v_now := pg_catalog.clock_timestamp();
  delete from public.app_connect_requests where user_id = v_user_id and created_at <= v_now - interval '10 minutes';
  select count(*)::integer, min(created_at) into v_count, v_oldest
    from public.app_connect_requests where user_id = v_user_id;
  if v_count >= 10 then
    return query select false,
      greatest(1, ceil(extract(epoch from v_oldest + interval '10 minutes' - v_now))::integer);
  else
    insert into public.app_connect_requests (user_id, created_at) values (v_user_id, v_now);
    return query select true, 0;
  end if;
end;
$$;

revoke all on function public.reserve_app_connect_session() from public, anon, service_role;
grant execute on function public.reserve_app_connect_session() to authenticated;

notify pgrst, 'reload schema';
commit;
