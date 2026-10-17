# KAOBASE

Webapp multi-utilisateurs de gestion des finances, des abonnements récurrents et des tâches, pilotée par des **agents IA gratuits spécialisés par secteur** qui s'améliorent à l'usage grâce à la base de données KAOBASE.

## Démarrage

1. **Supabase** : crée un projet (gratuit) sur supabase.com, puis exécute `supabase/migrations/20261015000000_init.sql` dans *SQL Editor* (ou `supabase db push` avec la CLI).
2. **Clés IA gratuites** (au moins une) :
   - Groq : https://console.groq.com/keys (principal)
   - Gemini : https://aistudio.google.com/apikey (secours automatique)
3. `cp .env.example .env.local` et remplis les valeurs (URL + clé *anon* Supabase, clés IA).
4. `npm install && npm run dev` puis http://localhost:3000 : crée un compte et complète les trois étapes de configuration (préférences, premier compte, récapitulatif).
5. Page **Import** : importe `demo/releve-demo.csv` pour tester avec 6 mois de données réalistes.

> Confirmation d'email : dans Supabase > Authentication > Email Templates, fais pointer le lien vers
> `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`, ou désactive la confirmation en développement.

## Architecture

Les données métier peuvent être servies par **Neon Data API**, avec les sessions conservées dans **Supabase Auth**. `DATABASE_PROVIDER` choisit une base pour toutes les tables, vues et RPC ; aucune requête métier n'utilise la connexion administrateur. Voir [la migration vers Neon et la bascule de l'hébergement](docs/neon-migration.md).

La rubrique **Mes apps** propose un catalogue avec recherche, catégories et tri, puis les raccourcis des comptes enregistrés. Les apps épinglées apparaissent sur l'accueil. L'intégration facultative Nango fournit le catalogue en ligne et les connexions OAuth des services configurés ; sans clé serveur, un catalogue de démarrage reste disponible pour ajouter des liens. Voir [le fonctionnement et la configuration OAuth](docs/apps.md).

Tous les agents peuvent **agir** : enregistrer des opérations dictées (« 12 € de pain hier et 40 € d'essence »), chercher, corriger ou préparer la suppression d'une opération, créer des tâches et mémoriser une préférence. Les suppressions d'opérations, de tâches et de budgets exigent un clic sur **Confirmer la suppression** dans le chat : l'élément précis est présenté, la demande expire après 10 minutes et une modification de l'élément invalide la confirmation. Un simple « oui » écrit au modèle n'exécute aucune suppression. Chacun ajoute ensuite ses compétences :

| Secteur | Agent | Compétences propres |
|---|---|---|
| Finance | `finance` | résumé du mois, comparaison de deux mois, top commerçants, catégorisation, catégories, comptes, soldes, prévision, budgets |
| Abonnements | `subscriptions` | liste, coûts, pistes d'économies, détection, ajout, confirmation/résiliation |
| Tâches | `tasks` | liste, mise à jour, suppression, rappels de prélèvements |
| Imports | `imports` | historique, contrôle qualité, catégorisation en masse, détection d'abonnements |

Les budgets demandent la 2e migration : `supabase/migrations/20261015120000_budgets.sql`.

L'**orchestrateur** (`lib/agents/orchestrator.ts`) route chaque question : mots-clés d'abord (gratuit), petit modèle rapide si c'est ambigu.

Fournisseurs : Groq (`openai/gpt-oss-120b`, puis `openai/gpt-oss-20b` qui a son propre quota gratuit), puis bascule automatique sur Gemini en cas de quota ou d'erreur (`lib/ai/provider.ts`). Les modèles se changent dans `.env.local`.

## Comment l'IA s'améliore (sans fine-tuning)

Tout est stocké dans la base KAOBASE et réinjecté dans les prompts :

1. **Règles apprises** (`categorization_rules`) : chaque correction de catégorie crée ou renforce une règle marchand → catégorie, avec une confiance lissée. Les règles passent *avant* le LLM, qui ne traite que les marchands inconnus.
2. **Mémoire RAG** (`agent_memories`, pgvector) : échanges, faits mémorisés et corrections, retrouvés par similarité (embeddings locaux gratuits all-MiniLM-L6-v2). Les corrections pèsent deux fois plus.
3. **Few-shot dynamique** (`agent_examples`) : les réponses 👍 ou corrigées deviennent des exemples réutilisés sur les questions proches.
4. **Détection d'abonnements** : algorithme déterministe (périodicité + stabilité des montants + récence) ; un rejet est mémorisé définitivement.
5. **Métriques** (`agent_runs`, `agent_feedback`) : page *Performance IA* (satisfaction, latence, part résolue sans IA).

## Scripts

- `npm run dev` / `npm run build`
- `npm test` : tests unitaires (parsers CSV/OFX, normalisation, détection d'abonnements, règles, prévision, routage, relevé de démo)
- `npm run typecheck`, `npm run lint`

Les tests de sécurité SQL utilisent PostgreSQL local en WebAssembly (PGlite), avec les vraies migrations et une simulation locale de l'authentification Supabase. Ils ne contactent aucun projet distant. Les évaluations IA et les parcours E2E connectés utilisent, eux, les services configurés et restent des commandes distinctes.

## Déploiement

Pour la configuration Neon migrée, définir `DATABASE_PROVIDER=neon` et `NEON_DATA_API_URL` sur l'hébergement, garder les deux variables publiques Supabase pour l'authentification, puis déployer les correctifs. Le guide [Neon](docs/neon-migration.md) décrit les sauvegardes, la vérification et le retour arrière. Les migrations historiques ci-dessous restent nécessaires sur la base métier choisie ; ne pas les appliquer uniquement à l'ancienne base après la bascule.

La rubrique Mes apps et les raccourcis de l'accueil demandent la migration `20261017060000_app_shortcuts.sql`, à appliquer après les migrations précédentes et avant le déploiement. L'accueil continue de fonctionner si cette fonctionnalité n'est pas encore activée.

Les connexions OAuth demandent ensuite `20261017070000_app_oauth_connections.sql` et la variable serveur `NANGO_SECRET_KEY`. Les identifiants des connexions sont associés à l'utilisateur ; les jetons restent chez Nango. Configurer chaque service dans Nango avant de permettre sa connexion. OAuth autorise l'accès à une API et ne garantit pas l'ouverture du site sans reconnexion.

La configuration après inscription/première connexion demande aussi la migration `20261017050000_onboarding.sql`, à appliquer avant de déployer ce parcours. Une fois les préférences et le premier compte validés, l'utilisateur accède directement au tableau de bord aux connexions suivantes. Les comptes existants passent une seule fois par cette configuration ; les opérations et les comptes existants sont conservés. Un compte contenant déjà des opérations garde son solde d'ouverture et son espace pendant ce parcours.

Avant de déployer les correctifs du 17 octobre 2026, appliquer **dans l'ordre** les quatre migrations `20261017010000_ownership_integrity.sql`, `20261017020000_subscription_identity.sql`, `20261017030000_agent_deletion_requests.sql` et `20261017040000_agent_request_limits.sql` (ou `supabase db push` sur le projet lié). La première s'arrête sans modifier les données si elle trouve des références entre utilisateurs à examiner. Les nouvelles suppressions et les appels IA restent bloqués tant que leurs migrations manquent. Voir [le rapport d'audit](docs/audit-2026-10-17.md) pour la portée et les limites des vérifications.

Compatible Vercel (free tier). Les embeddings locaux téléchargent un modèle d'environ 25 Mo au premier appel : en serverless, le premier appel est plus lent ; si le modèle ne peut pas être chargé, la mémoire retombe sur les souvenirs récents sans casser les agents.
