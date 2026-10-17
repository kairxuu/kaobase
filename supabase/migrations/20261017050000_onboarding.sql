-- Configuration initiale : une seule validation, atomique et liée à auth.uid().
-- Les utilisateurs existants restent en attente au prochain login.
begin;

alter table public.profiles add column onboarding_completed_at timestamptz;

create function public.complete_onboarding(
  p_display_name text,
  p_currency text,
  p_timezone text,
  p_account_id uuid,
  p_account_name text,
  p_account_kind text,
  p_opening_balance numeric,
  p_space text
)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_account public.accounts%rowtype;
  v_has_transactions boolean;
  v_display_name text := regexp_replace(p_display_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_account_name text := regexp_replace(p_account_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if v_user_id is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;

  -- Sérialise les soumissions répétées, y compris depuis plusieurs onglets.
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Votre profil est introuvable.' using errcode = '42501';
  end if;
  if v_profile.onboarding_completed_at is not null then
    return true;
  end if;

  if v_display_name is null or char_length(v_display_name) not between 1 and 60 then
    raise exception 'Le nom affiché doit contenir entre 1 et 60 caractères.' using errcode = '22023';
  end if;
  if p_currency is null or p_currency not in ('EUR', 'USD', 'GBP', 'CHF', 'CAD', 'MAD', 'XOF', 'XAF', 'TND', 'DZD') then
    raise exception 'Sélectionnez une devise prise en charge.' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Sélectionnez un fuseau horaire valide.' using errcode = '22023';
  end if;
  if v_account_name is null or char_length(v_account_name) not between 1 and 60 then
    raise exception 'Le nom du compte doit contenir entre 1 et 60 caractères.' using errcode = '22023';
  end if;
  if p_account_kind is null or p_account_kind not in ('checking', 'savings', 'card', 'cash', 'other') then
    raise exception 'Sélectionnez un type de compte valide.' using errcode = '22023';
  end if;
  if p_opening_balance is null
    or p_opening_balance::text in ('NaN', 'Infinity', '-Infinity')
    or abs(p_opening_balance) > 999999999999.99
    or p_opening_balance <> trunc(p_opening_balance, 2) then
    raise exception 'Le solde doit être un montant valide avec au maximum deux décimales, compris entre -999999999999,99 et 999999999999,99.' using errcode = '22023';
  end if;
  if p_space is null or p_space not in ('perso', 'pro') then
    raise exception 'Sélectionnez un espace personnel ou professionnel.' using errcode = '22023';
  end if;

  if p_account_id is not null then
    select * into v_account from public.accounts
      where id = p_account_id and user_id = v_user_id for update;
    if not found then
      raise exception 'Ce compte est introuvable.' using errcode = '42501';
    end if;
  else
    -- Le trigger d'inscription crée déjà un compte : le réutiliser sans doublon.
    select * into v_account from public.accounts where user_id = v_user_id
      order by created_at, id limit 1 for update;
    if not found then
      insert into public.accounts (user_id, name, kind, currency, opening_balance, space)
        values (v_user_id, v_account_name, p_account_kind, p_currency, p_opening_balance, p_space)
        returning * into v_account;
    end if;
  end if;

  -- FOR UPDATE sur le compte bloque également les nouvelles références FK
  -- pendant cette vérification. Une configuration ne réécrit pas l'historique.
  select exists (select 1 from public.transactions
    where user_id = v_user_id and account_id = v_account.id) into v_has_transactions;
  if v_has_transactions and (
    p_opening_balance is distinct from v_account.opening_balance
    or p_space is distinct from v_account.space
  ) then
    raise exception 'Ce compte contient déjà des opérations. Son solde d’ouverture et son espace doivent rester inchangés pendant la configuration.' using errcode = '22023';
  end if;

  update public.accounts set
    name = v_account_name,
    kind = p_account_kind,
    currency = case when v_has_transactions then currency else p_currency end,
    opening_balance = p_opening_balance,
    space = p_space
  where id = v_account.id and user_id = v_user_id;

  -- Dernière écriture : aucun profil n'est marqué terminé en cas d'échec.
  update public.profiles set
    display_name = v_display_name,
    currency = p_currency,
    timezone = p_timezone,
    onboarding_completed_at = clock_timestamp()
  where id = v_user_id;

  return true;
end;
$$;

revoke all on function public.complete_onboarding(text, text, text, uuid, text, text, numeric, text)
  from public, anon, service_role;
grant execute on function public.complete_onboarding(text, text, text, uuid, text, text, numeric, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
