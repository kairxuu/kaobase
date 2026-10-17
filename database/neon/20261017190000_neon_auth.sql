-- Preserve business UUIDs while moving identity to managed Neon Auth.
-- Password hashes and sessions are deliberately not copied.
begin;

do $$ begin
  if exists (select 1 from auth.users l join neon_auth.user n on lower(n.email)=lower(l.email) where n.id<>l.id) then
    raise exception 'Identity conflict: reconcile matching emails before migration';
  end if;
end $$;
insert into neon_auth.user (id,name,email,"emailVerified","createdAt","updatedAt")
select id,coalesce(nullif(raw_user_meta_data->>'display_name',''),split_part(email,'@',1)),lower(email),
  email_confirmed_at is not null,coalesce(created_at,now()),now()
from auth.users where email is not null and deleted_at is null and not coalesce(is_anonymous,false)
on conflict (id) do nothing;

alter table public.profiles add column if not exists last_name text not null default '';
alter table public.profiles add column if not exists avatar_color text not null default '#4433e0';
alter table public.profiles add column if not exists timezone_manual boolean not null default false;
update public.profiles p set
  last_name=coalesce(u.raw_user_meta_data->>'last_name',''),
  avatar_color=coalesce(u.raw_user_meta_data->>'avatar_color','#4433e0'),
  timezone_manual=coalesce((u.raw_user_meta_data->>'timezone_manual')::boolean,false)
from auth.users u where u.id=p.id;

create or replace function public.ensure_app_user()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid:=auth.uid(); v_user neon_auth.user%rowtype;
begin
  select * into v_user from neon_auth.user where id=v_id and "emailVerified"=true and not coalesce(banned,false);
  if not found then raise exception using errcode='42501',message='Verified Neon identity required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kaobase.identity:'||v_id::text,0));
  -- This local identity registry preserves existing foreign keys and seed triggers.
  -- It has no network connection, passwords or sessions for new users.
  insert into auth.users(id,email,raw_user_meta_data,created_at,updated_at)
  values(v_id,v_user.email,jsonb_build_object('display_name',v_user.name),now(),now()) on conflict(id) do nothing;
  insert into public.profiles(id,display_name) values(v_id,v_user.name) on conflict(id) do nothing;
  return true;
end $$;
revoke all on function public.ensure_app_user() from public,anon,anonymous,service_role;
grant execute on function public.ensure_app_user() to authenticated;

create or replace function public.current_identity()
returns table(email text,created_at timestamptz) language sql stable security definer set search_path='' as $$
  select u.email,u."createdAt" from neon_auth.user u where u.id=auth.uid() and u."emailVerified"=true and not coalesce(u.banned,false)
$$;
revoke all on function public.current_identity() from public,anon,anonymous,service_role;
grant execute on function public.current_identity() to authenticated;
notify pgrst,'reload schema';
commit;
