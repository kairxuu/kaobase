-- Managed Neon identity, with an explicit mapping for accounts recreated before cutover.
-- Preserve business UUIDs; never copy password hashes or sessions.
begin;
create table if not exists public.identity_mapping (
  neon_user_id uuid primary key references neon_auth.user(id) on delete cascade,
  app_user_id uuid not null unique references auth.users(id) on delete cascade
);
alter table public.identity_mapping enable row level security;
revoke all on public.identity_mapping from public,anon,anonymous,authenticated,service_role;

-- An existing Neon account is linked to a legacy email only after Neon verifies
-- ownership of that address. auth.uid() enforces this on every database request.
insert into public.identity_mapping(neon_user_id,app_user_id)
select n.id,l.id from auth.users l join neon_auth.user n on lower(n.email)=lower(l.email)
where n.id<>l.id and l.deleted_at is null
on conflict(neon_user_id) do nothing;
insert into neon_auth.user(id,name,email,"emailVerified","createdAt","updatedAt")
select l.id,coalesce(nullif(l.raw_user_meta_data->>'display_name',''),split_part(l.email,'@',1)),lower(l.email),
  l.email_confirmed_at is not null,coalesce(l.created_at,now()),now()
from auth.users l where l.email is not null and l.deleted_at is null and not coalesce(l.is_anonymous,false)
  and not exists(select 1 from neon_auth.user n where lower(n.email)=lower(l.email))
on conflict(id) do nothing;

alter table public.profiles add column if not exists last_name text not null default '';
alter table public.profiles add column if not exists avatar_color text not null default '#4433e0';
alter table public.profiles add column if not exists timezone_manual boolean not null default false;
-- Only import preferences once; rerunning the migration preserves later edits.
create table if not exists public.identity_migration_state(version text primary key);
revoke all on public.identity_migration_state from public,anon,anonymous,authenticated,service_role;
alter table public.identity_migration_state enable row level security;
do $$ begin
 if not exists(select 1 from public.identity_migration_state where version='neon-auth-v1') then
  update public.profiles p set last_name=coalesce(u.raw_user_meta_data->>'last_name',''),
    avatar_color=coalesce(u.raw_user_meta_data->>'avatar_color','#4433e0'),
    timezone_manual=coalesce(u.raw_user_meta_data->>'timezone_manual','false')='true'
  from auth.users u where u.id=p.id;
  insert into public.identity_migration_state values('neon-auth-v1');
 end if;
end $$;

create or replace function auth.uid()
returns uuid language sql stable security definer set search_path='' as $$
 select coalesce(m.app_user_id,u.id) from neon_auth.user u
 left join public.identity_mapping m on m.neon_user_id=u.id
 where u.id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
   and u."emailVerified"=true and not coalesce(u.banned,false)
$$;
revoke all on function auth.uid() from public,anon,anonymous;
grant execute on function auth.uid() to authenticated;

create or replace function public.ensure_app_user()
returns boolean language plpgsql security definer set search_path='' as $$
declare v_id uuid:=auth.uid(); v_user neon_auth.user%rowtype; v_profile uuid;
begin
 if v_id is null then raise exception using errcode='42501',message='Verified Neon identity required'; end if;
 select u.* into v_user from neon_auth.user u left join public.identity_mapping m on m.neon_user_id=u.id
 where coalesce(m.app_user_id,u.id)=v_id and u."emailVerified"=true and not coalesce(u.banned,false);
 if not found then raise exception using errcode='42501',message='Verified Neon identity required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kaobase.identity:'||v_id::text,0));
 -- Local registry retained for existing foreign keys and seed triggers; no external service.
 insert into auth.users(id,email,raw_user_meta_data,created_at,updated_at)
 values(v_id,v_user.email,jsonb_build_object('display_name',v_user.name),now(),now()) on conflict(id) do nothing;
 insert into public.profiles(id,display_name) values(v_id,v_user.name) on conflict(id) do nothing returning id into v_profile;
 if v_profile is not null then
  insert into public.accounts(user_id,name,kind) select v_id,'Compte courant','checking'
   where not exists(select 1 from public.accounts where user_id=v_id);
  insert into public.categories(user_id,name,kind,color)
   select v_id,c.name,c.kind,c.color from (values
    ('Alimentation','expense','#16a34a'),('Restaurants','expense','#ea580c'),('Logement','expense','#2563eb'),
    ('Transport','expense','#0891b2'),('Abonnements','expense','#7c3aed'),('Santé','expense','#db2777'),
    ('Loisirs','expense','#ca8a04'),('Shopping','expense','#9333ea'),('Énergie & télécom','expense','#0d9488'),
    ('Impôts & taxes','expense','#64748b'),('Divers','expense','#94a3b8'),('Salaire','income','#15803d'),
    ('Autres revenus','income','#4d7c0f'),('Virements internes','transfer','#475569')
   )as c(name,kind,color) on conflict(user_id,name)do nothing;
 end if;
 return true;
end $$;
revoke all on function public.ensure_app_user() from public,anon,anonymous,service_role;
grant execute on function public.ensure_app_user() to authenticated;

-- Drop only our previous isolated-branch signature when upgrading this migration.
drop function if exists public.current_identity();
create function public.current_identity()
returns table(app_user_id uuid,email text,created_at timestamptz) language sql stable security definer set search_path='' as $$
 select auth.uid(),u.email,u."createdAt" from neon_auth.user u
 left join public.identity_mapping m on m.neon_user_id=u.id
 where coalesce(m.app_user_id,u.id)=auth.uid() and u."emailVerified"=true and not coalesce(u.banned,false)
$$;
revoke all on function public.current_identity() from public,anon,anonymous,service_role;
grant execute on function public.current_identity() to authenticated;
notify pgrst,'reload schema';
commit;
