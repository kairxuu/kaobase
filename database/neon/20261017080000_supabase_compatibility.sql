-- Repair the access controls omitted by pg_restore --no-acl.
-- Authentication stays with Supabase; Data API verifies its asymmetric JWTs.
begin;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'anonymous') then create role anonymous nologin nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin nobypassrls; end if;
end $$;

revoke create on schema public from public, authenticated, anon, anonymous;
revoke all on all tables in schema public from public, anon, anonymous, authenticated;
revoke all on all tables in schema auth from public, anon, anonymous, authenticated;
revoke all on all functions in schema public from public, anon, anonymous, authenticated;
grant usage on schema public, auth, extensions to authenticated;
grant execute on function auth.uid() to authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array['profiles','accounts','categories','transactions','imports','subscriptions','tasks',
    'budgets','categorization_rules','agent_runs','agent_messages','agent_memories','agent_examples','agent_feedback',
    'agent_deletion_requests','app_shortcuts'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_table);
  end loop;
end $$;

-- These four policies failed to restore because the authenticated role was missing.
drop policy if exists app_shortcuts_select_own on public.app_shortcuts;
drop policy if exists app_shortcuts_insert_own on public.app_shortcuts;
drop policy if exists app_shortcuts_update_own on public.app_shortcuts;
drop policy if exists app_shortcuts_delete_own on public.app_shortcuts;
create policy app_shortcuts_select_own on public.app_shortcuts for select to authenticated using ((select auth.uid()) = user_id);
create policy app_shortcuts_insert_own on public.app_shortcuts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy app_shortcuts_update_own on public.app_shortcuts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy app_shortcuts_delete_own on public.app_shortcuts for delete to authenticated using ((select auth.uid()) = user_id);

alter view public.account_balances set (security_invoker = true);
alter view public.agent_performance set (security_invoker = true);
grant select on public.account_balances, public.agent_performance, public.agent_request_reservations to authenticated;
grant execute on function public.complete_onboarding(text,text,text,uuid,text,text,numeric,text) to authenticated;
grant execute on function public.queue_agent_deletion(text,uuid,uuid,text) to authenticated;
grant execute on function public.confirm_agent_deletion(uuid,uuid) to authenticated;
grant execute on function public.reserve_agent_request() to authenticated;
grant execute on function public.match_memories(text,extensions.vector,integer,double precision) to authenticated;
grant execute on function public.match_examples(text,extensions.vector,integer,double precision) to authenticated;

do $$ begin
  if to_regclass('public.app_oauth_connections') is not null then
    grant select, insert, update, delete on public.app_oauth_connections to authenticated;
    grant execute on function public.complete_app_oauth_connection(text,text,text,text,text,text,text,text,text,boolean) to authenticated;
    grant execute on function public.reserve_app_connect_session() to authenticated;
  end if;
end $$;

-- A new Supabase identity is mirrored lazily after JWT verification. This RPC
-- cannot choose another identity or read/copy passwords, sessions or refresh tokens.
create or replace function public.ensure_app_user()
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := auth.uid();
  v_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  v_profile uuid;
begin
  if v_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kaobase.identity:' || v_id::text, 0));
  insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
    values (v_id, v_claims->>'email', coalesce(v_claims->'user_metadata', '{}'::jsonb), now(), now())
    on conflict (id) do nothing;
  -- The restored auth.users trigger normally creates these rows. This fallback
  -- also repairs an identity whose profile was missing from an interrupted restore.
  insert into public.profiles (id, display_name)
    values (v_id, coalesce(v_claims->'user_metadata'->>'display_name', split_part(v_claims->>'email', '@', 1), ''))
    on conflict (id) do nothing returning id into v_profile;
  if v_profile is not null then
    insert into public.accounts (user_id, name, kind)
      select v_id, 'Compte courant', 'checking'
      where not exists (select 1 from public.accounts where user_id = v_id);
    insert into public.categories (user_id,name,kind,color)
      select v_id,c.name,c.kind,c.color from (values
        ('Alimentation','expense','#16a34a'),('Restaurants','expense','#ea580c'),('Logement','expense','#2563eb'),
        ('Transport','expense','#0891b2'),('Abonnements','expense','#7c3aed'),('Santé','expense','#db2777'),
        ('Loisirs','expense','#ca8a04'),('Shopping','expense','#9333ea'),('Énergie & télécom','expense','#0d9488'),
        ('Impôts & taxes','expense','#64748b'),('Divers','expense','#94a3b8'),('Salaire','income','#15803d'),
        ('Autres revenus','income','#4d7c0f'),('Virements internes','transfer','#475569')
      ) as c(name,kind,color) on conflict (user_id, name) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.ensure_app_user() from public, anon, anonymous, service_role;
grant execute on function public.ensure_app_user() to authenticated;

notify pgrst, 'reload schema';
commit;
