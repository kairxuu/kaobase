# Migration des données Supabase vers Neon

La base métier utilise Neon ; Supabase Auth conserve la connexion des utilisateurs, la confirmation des e-mails et la réinitialisation des mots de passe. Il ne faut donc pas supprimer le projet Supabase. Cette intervention migre la base métier, pas le fournisseur d'identité.

## Corrections

- La tentative initiale ne déplaçait que la lecture de devise vers un accès SQL administrateur ; toutes les autres lectures et mutations restaient sur Supabase. Le client serveur route maintenant `from`, `schema` et `rpc` vers un seul fournisseur choisi par `DATABASE_PROVIDER`. La devise suit le même parcours que les autres données.
- Neon Data API vérifie les JWT Supabase avec les clés publiques JWKS du projet et l'audience `authenticated`. Les requêtes métier portent le jeton de l'utilisateur ; elles n'utilisent pas `DATABASE_URL`, qui appartient aux outils d'administration.
- Les rôles, privilèges et quatre politiques de raccourcis manquants après `pg_restore --no-acl` sont restaurés par `database/neon/20261017080000_supabase_compatibility.sql`. Les vues restent en `security_invoker`. Les tables de quotas n'acceptent pas de modifications directes, et le schéma d'authentification reste privé.
- Les inscriptions futures initialisent leur profil Neon après vérification de la session. `ensure_app_user()` ne prend aucun identifiant en argument, reste idempotente et préserve les préférences existantes.
- Les tables et fonctions OAuth manquantes sont ajoutées avec la migration `20261017070000_app_oauth_connections.sql`.
- `TARGET_DB_URL` n'est plus utilisé ; les dépendances SQL directes inutilisées sont retirées. Les exports et diagnostics privés sont exclus de Git.
- Une branche avec expiration n'accepte actuellement pas Neon Data API. `neon.ts` décrit le fournisseur externe et des branches de validation sans expiration automatique. Les branches de validation doivent être supprimées après usage.

## Configuration applicative

Les variables nécessaires à la bascule sont :

```dotenv
DATABASE_PROVIDER=neon
NEON_DATA_API_URL=https://ep-floral-hat-b5x1b4ls.apirest.c-7.us-east-2.aws.neon.tech/neondb/rest/v1
NEXT_PUBLIC_SUPABASE_URL=<URL du projet Supabase existant>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<clé publique existante>
```

La clé Nango et les clés IA restent inchangées. Les URL PostgreSQL avec mot de passe restent privées : `DATABASE_URL_UNPOOLED` pour les migrations et sauvegardes ; `SUPABASE_DATABASE_URL` pour la source pendant la migration. Le service applicatif n'a besoin d'aucune clé Neon administrateur. Sans `NEON_DATA_API_URL`, choisir explicitement `neon` provoque une erreur de configuration ; aucune requête ne retombe silencieusement sur Supabase.

Le choix par défaut reste `supabase` pour les installations existantes qui n'ont pas encore effectué la bascule. La configuration locale de ce projet est passée à Neon après la vérification de la migration.

## Migration reproductible

Le script exige les outils PostgreSQL (`psql`, `pg_dump`, `pg_restore`) et les deux connexions dans les fichiers d'environnement ignorés. Il accepte le chemin Homebrew de `libpq` sur macOS. Une connexion Neon directe est obligatoire ; une URL `-pooler` est refusée.

```bash
# Contrôle de connexion, sans modification
python3 scripts/database/migrate_to_neon.py

# Branche isolée déjà créée et configurée : sauvegarde, transfert et vérification
python3 scripts/database/migrate_to_neon.py \
  --target-env-file .local/database-migrations/branch.env --apply

# Base principale : même procédure
python3 scripts/database/migrate_to_neon.py --apply

# Comparaison actuelle entre les deux bases, sans modifier les données
python3 scripts/database/migrate_to_neon.py --verify-only
```

Avant toute modification, le script crée un export Supabase cohérent et une sauvegarde Neon dans `.local/database-migrations/`. Les fichiers sont privés et ignorés par Git. Il répare les privilèges, transfère les identités nécessaires aux clés étrangères sans copier de nouvelles sessions ou mots de passe, puis fusionne les tables publiques dans une transaction suivant leurs dépendances. Il conserve les dates et les valeurs existantes du snapshot, y compris les champs générés et les vecteurs.

La transaction vérifie chaque ligne transférée et le nombre de lignes. Des lignes supplémentaires inattendues dans Neon provoquent un arrêt pour examen ; le script ne les supprime pas silencieusement. La vérification finale compare également les empreintes de toutes les lignes des tables publiques avec un fuseau UTC commun. Les rapports contiennent les compteurs et chemins de sauvegarde, sans mots de passe ni données personnelles.

Le script s'appuie sur le schéma déjà restauré pour ce projet. Ce n'est pas un installateur de base vide : les 87 contraintes de la source ont été contrôlées sur la cible avant la bascule. Les nouvelles migrations de schéma doivent ensuite être exécutées contre Neon.

## Bascule du site hébergé

Le transfert de la base ne modifie pas automatiquement la configuration de Vercel ou d'un autre hébergeur. Pour basculer le site, ajouter les deux variables `DATABASE_PROVIDER=neon` et `NEON_DATA_API_URL` ci-dessus à l'environnement concerné, puis déployer les correctifs. Conserver les variables Supabase Auth.

Avant ce déploiement, arrêter temporairement les écritures vers l'ancienne application et refaire le transfert si Supabase a reçu de nouvelles données depuis le snapshot. Après la bascule, traiter Neon comme la source métier principale. Ne pas relancer une fusion Supabase vers Neon après de nouvelles écritures métier sur Neon : il faut alors réconcilier explicitement les différences.

La configuration des clés et du fournisseur Data API est déclarée dans `neon.ts`. Pour provisionner manuellement l'API sur une copie existante, utiliser une authentification externe Supabase, son URL `/auth/v1/.well-known/jwks.json`, l'audience `authenticated`, le schéma exposé `public`, et désactiver les droits automatiques. Les rôles et droits de ce projet sont définis par les migrations. Après une migration, rafraîchir le cache avec `neon data-api refresh-schema --branch production --database neondb`.

## Vérifications

- Comparaison du snapshot puis des données actuelles : 17 tables métier, 236 lignes, cinq identités au moment de la migration. Les tables OAuth supplémentaires sont ajoutées sur Neon.
- Tests HTTP avec une vraie session : profil, onze tables, vues privées, RPC vectorielle, schéma d'authentification inaccessible, requêtes anonymes et JWT modifiés refusés.
- Parcours navigateur sur la branche isolée : connexion et neuf pages principales, sans erreur d'application.
- Tests PostgreSQL locaux : isolation, privilèges, quotas, initialisation idempotente des nouveaux utilisateurs et réparation d'un profil manquant sans doublon.

Validation de cette intervention : 626 tests, TypeScript, ESLint et build Next.js réussis ; six tests publics sur le serveur de production local et le parcours connecté des neuf pages sur la branche isolée réussis. La branche temporaire a été supprimée après les contrôles. Les correctifs restent locaux : aucun push ni déploiement du site hébergé n'a été exécuté.

Pour répéter le contrôle HTTP, utiliser le compte de test déjà configuré dans `.env.test.local` :

```bash
node scripts/database/verify_neon.mjs
```

Les tests de pages peuvent utiliser `KAOBASE_NEXT_DIST_DIR=.next-neon-validation` pour éviter le cache du serveur de développement déjà ouvert. Next ajoute automatiquement ses types générés dans la configuration TypeScript lors d'un changement de dossier de build ; retirer ces ajouts temporaires après le contrôle.

## Retour arrière

Supabase n'a pas été supprimé ni vidé. Avant toute nouvelle écriture sur Neon, un retour à `DATABASE_PROVIDER=supabase` restaure le parcours précédent. Après de nouvelles écritures sur Neon, sauvegarder et réconcilier les données avant un retour : changer seulement le fournisseur ferait perdre leur visibilité.

Les exports `neon-before-*.dump` et `supabase-*.dump`, ainsi que les rapports horodatés, se trouvent dans le dossier privé `.local/database-migrations/`. Pour examiner ou restaurer un export, utiliser d'abord une branche Neon isolée, jamais un écrasement aveugle de la base principale.

Références officielles : [migration Supabase](https://neon.com/docs/import/migrate-from-supabase), [Neon Data API](https://neon.com/docs/data-api/overview), [droits et RLS](https://neon.com/docs/data-api/access-control), [configuration du service](https://neon.com/docs/cli/data-api), [connexions Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
