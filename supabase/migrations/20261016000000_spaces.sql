-- KAOBASE — espaces perso/pro et fuseau horaire (ticket #1).
-- Les opérations héritent de l'espace de leur compte : aucune colonne sur transactions.

alter table public.accounts      add column if not exists space text not null default 'perso' check (space in ('perso', 'pro'));
alter table public.subscriptions add column if not exists space text not null default 'perso' check (space in ('perso', 'pro'));
alter table public.tasks         add column if not exists space text not null default 'perso' check (space in ('perso', 'pro'));
alter table public.profiles      add column if not exists timezone text not null default 'Europe/Paris';

create index if not exists accounts_user_space_idx on public.accounts (user_id, space);
create index if not exists tasks_user_space_idx on public.tasks (user_id, space, status);

-- Solde par compte, avec son espace (mêmes colonnes qu'avant + space).
drop view if exists public.account_balances;
create view public.account_balances
with (security_invoker = true) as
select a.id, a.name, a.kind, a.currency, a.space,
       a.opening_balance + coalesce(sum(t.amount), 0) as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

notify pgrst, 'reload schema';
