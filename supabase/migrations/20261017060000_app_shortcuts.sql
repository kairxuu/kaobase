-- Raccourcis d'applications et libellés de compte propres à chaque utilisateur.
-- Aucun mot de passe, jeton ou secret de connexion n'est conservé ici.
begin;

create table public.app_shortcuts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  account_label text not null default '',
  category text not null default 'other',
  space text not null default 'perso',
  pinned boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_shortcuts_name_check check (
    char_length(name) between 1 and 80
    and name = regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and name !~ '[[:cntrl:]]'
  ),
  constraint app_shortcuts_url_check check (
    char_length(url) between 1 and 2048
    -- L'application valide et normalise l'URL avec URL(). Cette défense
    -- supplémentaire empêche également les protocoles actifs et userinfo
    -- dans une écriture directe via l'API de données.
    and url ~* '^https?://[^/?#@[:space:]\\]+([/?#].*)?$'
    and url !~ '[[:space:][:cntrl:]]'
    and position(chr(92) in url) = 0
  ),
  constraint app_shortcuts_account_label_check check (
    char_length(account_label) <= 160
    and account_label = regexp_replace(account_label, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and account_label !~ '[[:cntrl:]]'
  ),
  constraint app_shortcuts_category_check check (
    category in ('banking', 'work', 'communication', 'shopping', 'entertainment', 'other')
  ),
  constraint app_shortcuts_space_check check (space in ('perso', 'pro')),
  constraint app_shortcuts_user_space_url_account_key unique (user_id, space, url, account_label)
);

create index app_shortcuts_user_space_pinned_idx
  on public.app_shortcuts (user_id, space, pinned, created_at desc);

create function public.touch_app_shortcut_updated_at()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger app_shortcuts_updated_at
before update on public.app_shortcuts
for each row execute function public.touch_app_shortcut_updated_at();

alter table public.app_shortcuts enable row level security;

create policy app_shortcuts_select_own on public.app_shortcuts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy app_shortcuts_insert_own on public.app_shortcuts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy app_shortcuts_update_own on public.app_shortcuts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy app_shortcuts_delete_own on public.app_shortcuts
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.app_shortcuts from public, anon, authenticated;
grant select, insert, update, delete on public.app_shortcuts to authenticated;
revoke all on function public.touch_app_shortcut_updated_at() from public, anon;

notify pgrst, 'reload schema';
commit;
