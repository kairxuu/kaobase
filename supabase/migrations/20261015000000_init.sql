-- KAOBASE — schéma initial
-- Toutes les tables métier portent user_id + RLS : chaque utilisateur ne voit que ses données.
-- Les fonctions SQL sont en SECURITY INVOKER (sauf le trigger d'inscription) pour que la RLS s'applique.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Profils & référentiels
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  currency text not null default 'EUR',
  created_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'checking' check (kind in ('checking', 'savings', 'card', 'cash', 'other')),
  currency text not null default 'EUR',
  opening_balance numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'expense' check (kind in ('expense', 'income', 'transfer')),
  color text not null default '#64748b',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------------------
-- Finances
-- ---------------------------------------------------------------------------

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  filename text not null,
  format text not null check (format in ('csv', 'ofx')),
  mapping jsonb,
  rows_total int not null default 0,
  rows_imported int not null default 0,
  rows_duplicate int not null default 0,
  rows_invalid int not null default 0,
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  booked_at date not null,
  amount numeric(14, 2) not null, -- négatif = dépense, positif = revenu
  label_raw text not null,
  merchant text not null,          -- libellé normalisé (clé des règles et abonnements)
  category_id uuid references public.categories (id) on delete set null,
  categorized_by text check (categorized_by in ('rule', 'llm', 'user')),
  source text not null default 'manual' check (source in ('csv', 'ofx', 'manual')),
  import_id uuid references public.imports (id) on delete set null,
  dedupe_hash text not null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_hash)
);
create index transactions_user_date_idx on public.transactions (user_id, booked_at desc);
create index transactions_user_merchant_idx on public.transactions (user_id, merchant);

-- Règles apprises : marchand normalisé -> catégorie, avec compteurs pour la confiance.
create table public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  merchant text not null,
  category_id uuid not null references public.categories (id) on delete cascade,
  source text not null check (source in ('user', 'llm')),
  hits int not null default 0,
  misses int not null default 0,
  -- Lissage de Laplace : 0 observation = 0.5, chaque confirmation rapproche de 1.
  confidence numeric generated always as ((hits + 1)::numeric / (hits + misses + 2)) stored,
  updated_at timestamptz not null default now(),
  unique (user_id, merchant)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  merchant text not null,
  amount numeric(14, 2) not null, -- coût positif par période
  period text not null check (period in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due date,
  status text not null default 'active' check (status in ('suggested', 'active', 'rejected', 'cancelled')),
  confidence numeric not null default 1,
  category_id uuid references public.categories (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant)
);

-- ---------------------------------------------------------------------------
-- Tâches
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  transaction_id uuid references public.transactions (id) on delete set null,
  created_by text not null default 'user' check (created_by in ('user', 'agent')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index tasks_user_status_idx on public.tasks (user_id, status, due_date);

-- ---------------------------------------------------------------------------
-- IA : exécutions, messages, retours, mémoire, exemples
-- ---------------------------------------------------------------------------

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  agent text not null check (agent in ('orchestrator', 'finance', 'subscriptions', 'tasks', 'imports')),
  routed_by text check (routed_by in ('user', 'keywords', 'llm')),
  provider text,
  model text,
  input text not null,
  output text,
  latency_ms int,
  input_tokens int,
  output_tokens int,
  tool_calls int not null default 0,
  memories_used int not null default 0,
  examples_used int not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index agent_runs_user_agent_idx on public.agent_runs (user_id, agent, created_at desc);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null,
  agent text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  run_id uuid references public.agent_runs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index agent_messages_conv_idx on public.agent_messages (user_id, conversation_id, created_at);

create table public.agent_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  correction text,
  created_at timestamptz not null default now(),
  unique (user_id, run_id)
);

create table public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  agent text not null,
  kind text not null check (kind in ('exchange', 'correction', 'fact')),
  content text not null,
  embedding extensions.vector(384),
  importance real not null default 1,
  created_at timestamptz not null default now()
);
create index agent_memories_user_agent_idx on public.agent_memories (user_id, agent, created_at desc);
create index agent_memories_embedding_idx on public.agent_memories
  using hnsw (embedding extensions.vector_cosine_ops);

create table public.agent_examples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  agent text not null,
  input text not null,
  output text not null,
  embedding extensions.vector(384),
  run_id uuid references public.agent_runs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index agent_examples_embedding_idx on public.agent_examples
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- RLS : propriétaire uniquement, sur toutes les tables
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
create policy "profiles_own" on public.profiles
  for all using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'categories', 'imports', 'transactions', 'categorization_rules',
    'subscriptions', 'tasks', 'agent_runs', 'agent_messages', 'agent_feedback',
    'agent_memories', 'agent_examples'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Recherche vectorielle (SECURITY INVOKER => RLS appliquée)
-- ---------------------------------------------------------------------------

create or replace function public.match_memories(
  p_agent text,
  p_embedding extensions.vector(384),
  p_count int default 5,
  p_min_similarity float default 0.35
)
returns table (id uuid, kind text, content text, similarity float, created_at timestamptz)
language sql stable security invoker set search_path = public, extensions
as $$
  select m.id, m.kind, m.content,
         1 - (m.embedding <=> p_embedding) as similarity,
         m.created_at
  from public.agent_memories m
  where m.agent in (p_agent, 'shared')
    and m.embedding is not null
    and 1 - (m.embedding <=> p_embedding) >= p_min_similarity
  -- Les corrections et faits pèsent plus qu'un simple échange.
  order by (1 - (m.embedding <=> p_embedding)) * m.importance desc
  limit p_count;
$$;

create or replace function public.match_examples(
  p_agent text,
  p_embedding extensions.vector(384),
  p_count int default 3,
  p_min_similarity float default 0.45
)
returns table (id uuid, input text, output text, similarity float)
language sql stable security invoker set search_path = public, extensions
as $$
  select e.id, e.input, e.output, 1 - (e.embedding <=> p_embedding) as similarity
  from public.agent_examples e
  where e.agent = p_agent
    and e.embedding is not null
    and 1 - (e.embedding <=> p_embedding) >= p_min_similarity
  order by e.embedding <=> p_embedding
  limit p_count;
$$;

-- Statistiques par agent pour la page « Performance IA ».
create or replace view public.agent_performance
with (security_invoker = true) as
select
  r.agent,
  count(*)::int as runs,
  count(*) filter (where r.error is not null)::int as errors,
  round(avg(r.latency_ms))::int as avg_latency_ms,
  coalesce(sum(r.input_tokens + r.output_tokens), 0)::int as tokens,
  count(f.id) filter (where f.rating = 1)::int as thumbs_up,
  count(f.id) filter (where f.rating = -1)::int as thumbs_down,
  round(avg(r.memories_used)::numeric, 2) as avg_memories,
  round(avg(r.examples_used)::numeric, 2) as avg_examples,
  max(r.created_at) as last_run_at
from public.agent_runs r
left join public.agent_feedback f on f.run_id = r.id
group by r.agent;

-- ---------------------------------------------------------------------------
-- Inscription : profil + compte courant + catégories par défaut
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));

  insert into public.accounts (user_id, name, kind) values (new.id, 'Compte courant', 'checking');

  insert into public.categories (user_id, name, kind, color)
  select new.id, c.name, c.kind, c.color
  from (values
    ('Alimentation', 'expense', '#16a34a'),
    ('Restaurants', 'expense', '#ea580c'),
    ('Logement', 'expense', '#2563eb'),
    ('Transport', 'expense', '#0891b2'),
    ('Abonnements', 'expense', '#7c3aed'),
    ('Santé', 'expense', '#db2777'),
    ('Loisirs', 'expense', '#ca8a04'),
    ('Shopping', 'expense', '#9333ea'),
    ('Énergie & télécom', 'expense', '#0d9488'),
    ('Impôts & taxes', 'expense', '#64748b'),
    ('Divers', 'expense', '#94a3b8'),
    ('Salaire', 'income', '#15803d'),
    ('Autres revenus', 'income', '#4d7c0f'),
    ('Virements internes', 'transfer', '#475569')
  ) as c(name, kind, color);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Solde courant par compte (solde d'ouverture + mouvements).
create or replace view public.account_balances
with (security_invoker = true) as
select a.id, a.name, a.kind, a.currency,
       a.opening_balance + coalesce(sum(t.amount), 0) as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;
