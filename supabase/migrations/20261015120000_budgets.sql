-- KAOBASE — budgets mensuels par catégorie (utilisés par l'agent Finance et la vue d'ensemble).

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  monthly_limit numeric(14, 2) not null check (monthly_limit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);

alter table public.budgets enable row level security;
create policy budgets_own on public.budgets
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
