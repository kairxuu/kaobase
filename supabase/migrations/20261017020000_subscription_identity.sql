-- Un même marchand peut être suivi séparément dans les espaces perso et pro.
-- Cette migration doit précéder le déploiement du nouveau détecteur.
begin;

alter table public.subscriptions
  drop constraint subscriptions_user_id_merchant_key,
  add constraint subscriptions_user_id_space_merchant_key unique (user_id, space, merchant),
  add column detection_managed boolean not null default false,
  add column anchor_day smallint check (anchor_day between 1 and 31);

-- Préserver au minimum le jour actuellement connu. Une ancienne troncature ne
-- peut pas être reconstituée sans historique ou choix explicite de l'utilisateur.
update public.subscriptions set anchor_day = extract(day from next_due)::smallint
where next_due is not null;

-- Sans provenance fiable, les abonnements existants restent sous contrôle utilisateur.
-- Seules les nouvelles suggestions non modifiées seront rafraîchies automatiquement.
comment on column public.subscriptions.detection_managed is
  'True uniquement pour une suggestion créée par le détecteur et jamais modifiée par l’utilisateur.';
comment on column public.subscriptions.anchor_day is
  'Jour contractuel conservé après la troncature d’une échéance dans un mois court.';

notify pgrst, 'reload schema';
commit;
