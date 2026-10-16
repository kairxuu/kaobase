-- Les UUID seuls ne garantissent pas qu'une référence appartient au même user.
-- Les FK composites font respecter cette invariance même hors RLS et lors des
-- changements de propriétaire. PostgreSQL >= 15 permet SET NULL (reference)
-- sans effacer user_id. Les noms des relations PostgREST restent identiques.
--
-- Aucun lien existant n'est détaché et aucune ligne n'est supprimée ici : si
-- l'ancien schéma a accepté un lien interutilisateurs, tout est annulé et les
-- colonnes concernées sont indiquées pour une réparation explicite préalable.
do $$
declare
  relation record;
  parent_table text;
  invalid_count bigint;
  violations text[] := array[]::text[];
begin
  -- Le bloc est atomique et les écritures attendent la fin de sa validation.
  lock table public.accounts, public.agent_examples, public.agent_feedback,
    public.agent_messages, public.agent_runs, public.budgets,
    public.categorization_rules, public.categories, public.imports,
    public.subscriptions, public.tasks, public.transactions
    in share row exclusive mode;

  for relation in
    select * from (values
      ('imports', 'account_id', 'accounts'),
      ('transactions', 'account_id', 'accounts'),
      ('transactions', 'category_id', 'categories'),
      ('transactions', 'import_id', 'imports'),
      ('categorization_rules', 'category_id', 'categories'),
      ('subscriptions', 'category_id', 'categories'),
      ('tasks', 'subscription_id', 'subscriptions'),
      ('tasks', 'transaction_id', 'transactions'),
      ('agent_messages', 'run_id', 'agent_runs'),
      ('agent_feedback', 'run_id', 'agent_runs'),
      ('agent_examples', 'run_id', 'agent_runs'),
      ('budgets', 'category_id', 'categories')
    ) as refs(child_table, reference_column, parent_table)
  loop
    execute format(
      'select count(*) from public.%I child where child.%I is not null and not exists (
        select 1 from public.%I parent where parent.id = child.%I and parent.user_id = child.user_id
      )',
      relation.child_table, relation.reference_column,
      relation.parent_table, relation.reference_column
    ) into invalid_count;
    if invalid_count > 0 then
      violations := array_append(violations, format('%s.%s: %s',
        relation.child_table, relation.reference_column, invalid_count));
    end if;
  end loop;

  if cardinality(violations) > 0 then
    raise exception using
      errcode = '23514',
      message = 'Ownership migration stopped: existing references belong to another user.',
      detail = array_to_string(violations, ', '),
      hint = 'Review and explicitly repair these references before retrying. No rows have been changed.';
  end if;

  foreach parent_table in array array[
    'accounts', 'categories', 'imports', 'subscriptions', 'transactions', 'agent_runs'
  ] loop
    execute format('alter table public.%I add constraint %I unique (user_id, id)',
      parent_table, parent_table || '_user_id_id_key');
  end loop;

  for relation in
    select * from (values
      ('imports', 'account_id', 'accounts', false),
      ('transactions', 'account_id', 'accounts', false),
      ('transactions', 'category_id', 'categories', false),
      ('transactions', 'import_id', 'imports', false),
      ('categorization_rules', 'category_id', 'categories', true),
      ('subscriptions', 'category_id', 'categories', false),
      ('tasks', 'subscription_id', 'subscriptions', false),
      ('tasks', 'transaction_id', 'transactions', false),
      ('agent_messages', 'run_id', 'agent_runs', false),
      ('agent_feedback', 'run_id', 'agent_runs', true),
      ('agent_examples', 'run_id', 'agent_runs', false),
      ('budgets', 'category_id', 'categories', true)
    ) as refs(child_table, reference_column, parent_table, cascade_delete)
  loop
    execute format(
      'alter table public.%I drop constraint %I, add constraint %I
        foreign key (user_id, %I) references public.%I (user_id, id) on delete %s',
      relation.child_table,
      relation.child_table || '_' || relation.reference_column || '_fkey',
      relation.child_table || '_' || relation.reference_column || '_fkey',
      relation.reference_column,
      relation.parent_table,
      case when relation.cascade_delete then 'cascade'
        else format('set null (%I)', relation.reference_column) end
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
