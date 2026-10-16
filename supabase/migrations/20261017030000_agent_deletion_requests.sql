-- Une suppression IA exige un clic utilisateur sur un objet précis, vérifié de nouveau en base.
begin;

create table public.agent_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  kind text not null check (kind in ('transaction', 'task', 'budget')),
  target_id uuid not null,
  snapshot jsonb not null,
  description text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  constraint agent_deletion_requests_target_key unique (user_id, conversation_id, kind, target_id)
);
alter table public.agent_deletion_requests enable row level security;
create policy agent_deletion_requests_own on public.agent_deletion_requests
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.agent_deletion_requests to authenticated;

create function public.queue_agent_deletion(p_kind text, p_target_id uuid, p_conversation_id uuid, p_space text default 'all')
returns table (id uuid, kind text, description text, expires_at timestamptz)
language plpgsql security invoker set search_path = public
as $$
declare v_snapshot jsonb; v_description text; v_currency text;
begin
  if auth.uid() is null or p_space not in ('all', 'perso', 'pro') then
    raise exception 'Requête invalide' using errcode = '42501';
  end if;
  select currency into v_currency from public.profiles where profiles.id = auth.uid();
  if p_kind = 'transaction' then
    select to_jsonb(t), t.booked_at::text || ' — ' || t.label_raw || ' (' || t.amount::text || ' ' || coalesce(v_currency, 'EUR') || ') — '
      || coalesce((select a.name || ' · ' || a.space from public.accounts a where a.id = t.account_id), 'Sans compte')
      into v_snapshot, v_description from public.transactions t
      where t.id = p_target_id and t.user_id = auth.uid()
        and (p_space = 'all' or exists (select 1 from public.accounts a where a.id = t.account_id and a.space = p_space));
  elsif p_kind = 'task' then
    select to_jsonb(t), t.title || ' — ' || t.space || coalesce(' — échéance ' || t.due_date::text, ' — sans échéance')
      || case when nullif(t.description, '') is not null then ' — ' || left(t.description, 180) else '' end
      into v_snapshot, v_description from public.tasks t
      where t.id = p_target_id and t.user_id = auth.uid() and (p_space = 'all' or t.space = p_space);
  elsif p_kind = 'budget' then
    select to_jsonb(b), 'Budget ' || c.name || ' (' || b.monthly_limit::text || ' ' || coalesce(v_currency, 'EUR') || '/mois)'
      into v_snapshot, v_description from public.budgets b join public.categories c on c.id = b.category_id
      where b.category_id = p_target_id and b.user_id = auth.uid();
  else
    raise exception 'Type de suppression invalide' using errcode = '22023';
  end if;
  if v_snapshot is null then raise exception 'Élément introuvable' using errcode = 'P0002'; end if;
  delete from public.agent_deletion_requests r where r.expires_at <= now();
  return query insert into public.agent_deletion_requests as r (conversation_id, kind, target_id, snapshot, description)
    values (p_conversation_id, p_kind, p_target_id, v_snapshot, v_description)
    on conflict on constraint agent_deletion_requests_target_key do update
      set id = case when r.snapshot = excluded.snapshot and r.description = excluded.description then r.id else gen_random_uuid() end,
          snapshot = excluded.snapshot, description = excluded.description, expires_at = now() + interval '10 minutes'
    returning r.id, r.kind, r.description, r.expires_at;
end;
$$;

create function public.confirm_agent_deletion(p_request_id uuid, p_conversation_id uuid)
returns table (kind text, description text)
language plpgsql security invoker set search_path = public
as $$
declare r public.agent_deletion_requests%rowtype; v_snapshot jsonb;
begin
  select * into r from public.agent_deletion_requests d
    where d.id = p_request_id and d.conversation_id = p_conversation_id and d.user_id = auth.uid() for update;
  if not found or r.expires_at <= now() then
    raise exception 'Confirmation expirée ou introuvable. Redemande la suppression.' using errcode = 'P0002';
  end if;
  if r.kind = 'transaction' then
    select to_jsonb(t) into v_snapshot from public.transactions t where t.id = r.target_id and t.user_id = auth.uid() for update;
  elsif r.kind = 'task' then
    select to_jsonb(t) into v_snapshot from public.tasks t where t.id = r.target_id and t.user_id = auth.uid() for update;
  elsif r.kind = 'budget' then
    select to_jsonb(b) into v_snapshot from public.budgets b where b.category_id = r.target_id and b.user_id = auth.uid() for update;
  end if;
  if v_snapshot is null or v_snapshot is distinct from r.snapshot then
    raise exception 'Cet élément a changé. Redemande sa suppression pour vérifier son état actuel.' using errcode = 'P0002';
  end if;
  if r.kind = 'transaction' then delete from public.transactions where transactions.id = r.target_id and user_id = auth.uid();
  elsif r.kind = 'task' then delete from public.tasks where tasks.id = r.target_id and user_id = auth.uid();
  elsif r.kind = 'budget' then delete from public.budgets where category_id = r.target_id and user_id = auth.uid();
  end if;
  delete from public.agent_deletion_requests where agent_deletion_requests.id = r.id;
  -- Le reçu et la suppression sont atomiques ; aucun fournisseur IA n'intervient.
  insert into public.agent_messages (conversation_id, agent, role, content)
    values (p_conversation_id, case when r.kind = 'task' then 'tasks' else 'finance' end, 'assistant', 'Suppression confirmée : ' || r.description);
  return query select r.kind, r.description;
end;
$$;

revoke all on function public.queue_agent_deletion(text, uuid, uuid, text) from public, anon;
revoke all on function public.confirm_agent_deletion(uuid, uuid) from public, anon;
grant execute on function public.queue_agent_deletion(text, uuid, uuid, text) to authenticated;
grant execute on function public.confirm_agent_deletion(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
