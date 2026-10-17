# Neon : données et authentification

Kaobase utilise Neon Auth (Managed Better Auth) et Neon Data API. Aucun appel actif à Supabase n’est nécessaire. Le dossier `supabase/migrations` conserve les migrations SQL historiques ; ce nom de dossier ne désigne pas une connexion distante.

## Configuration

Variables serveur : `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (32 caractères aléatoires minimum), `NEON_DATA_API_URL`, `APP_ORIGIN`. `NEON_AUTH_JWKS_URL` est facultatif et peut être dérivé de l’URL Auth. Les URL PostgreSQL restent réservées aux sauvegardes et migrations.

`neon.ts` active Auth et sélectionne le fournisseur Neon pour Data API. Supprimer l’ancien fournisseur JWKS externe du projet après la bascule et les variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_DATABASE_URL` des environnements actifs. `DATABASE_PROVIDER` n’est plus utilisé.

## Comptes existants

La migration `database/neon/20261017190000_neon_auth.sql` conserve les identifiants métier, les comptes et leurs opérations. Elle importe les identités sans mots de passe ni sessions. Un utilisateur historique choisit « Mot de passe oublié » pour créer son nouveau mot de passe avec un code reçu par email.

Si un compte a déjà été recréé dans Neon avec un autre identifiant, une association privée le relie à ses anciennes données. Aucun accès n’est accordé avant vérification de son adresse par Neon. `auth.uid()` vérifie l’identité Neon et résout cette association à chaque requête ; les identifiants envoyés par le navigateur ne font pas autorité.

`auth.users` est conservée localement dans Neon pour les anciennes clés étrangères et les déclencheurs de création du premier compte. Elle n’est plus un fournisseur de connexion. Les préférences de profil résident dans `public.profiles`.

## Emails

Sur la branche utilisée, activer : email/mot de passe, vérification par code, vérification obligatoire, envoi à l’inscription et à la connexion d’une adresse non vérifiée, connexion automatique après confirmation. Ces paramètres appartiennent à Neon et sont communs au web et à iOS. Le code ne demande pas un second envoi après une inscription réussie.

Le fournisseur partagé Neon envoie les codes de vérification et de récupération. Pour un usage de production plus large, configurer son propre SMTP dans Neon : [recommandations Neon](https://neon.com/docs/auth/production-checklist).

## Validation et sauvegarde

Tester sur une branche isolée avant toute modification distante. Sauvegarder la base et les variables de déploiement. La migration est transactionnelle ; une réapplication préserve les préférences modifiées.

Vérifications : inscription, code incorrect/expiré, renvoi de code, confirmation, connexion, restauration et renouvellement de session, déconnexion, réinitialisation du mot de passe, accès aux anciennes données et isolation entre comptes. Les tests SQL locaux couvrent notamment le compte recréé avec un autre identifiant et le refus d’accès avant vérification.

Le contrôle manuel `node scripts/database/verify_neon.mjs` utilise un compte Neon dédié dans `.env.test.local`. Ne pas lui fournir d’anciens mots de passe Supabase. Les exports privés précédents restent dans `.local/database-migrations` ; restaurer un export sur une branche isolée avant toute intervention sur la production.

## Vérifications du 17 octobre 2026

644 tests et 13 tests iOS réussis ; TypeScript, ESLint, installation propre des dépendances et build validés. Sur le site public : connexion web et native, renouvellement, neuf pages, association d’un identifiant Neon différent à son profil historique, isolation des lignes et révocation de la session de renouvellement vérifiés avec une identité synthétique supprimée après contrôle. Inscription, confirmation et réinitialisation d’un compte sans mot de passe importé vérifiées sur la branche isolée. Réception d’un code Neon confirmée par le propriétaire.

Les cinq profils historiques sont conservés. Le fournisseur JWKS Supabase et les variables Supabase des trois environnements Vercel ont été retirés. Le projet Supabase distant n’a pas été supprimé.
