# Mes apps : catalogue, comptes et raccourcis

La rubrique `/apps` regroupe un catalogue de services et les comptes enregistrés. La recherche ignore les accents et la casse ; des filtres de catégorie et de connexion ainsi qu'un tri permettent de retrouver une app. Les comptes enregistrés gardent leur espace perso/pro, leur libellé facultatif (e-mail ou alias) et leur épinglage sur l'accueil. Plusieurs comptes d'un même service peuvent être enregistrés.

## Catalogue

Avec `NANGO_SECRET_KEY`, Kaobase lit côté serveur les API Nango `/providers` et `/integrations`. Le catalogue reflète les fournisseurs proposés par Nango, ainsi que quelques raccourcis locaux utiles. Il ne recense pas toutes les applications existantes. Les résultats publics sont nettoyés puis gardés en mémoire cinq minutes par instance serveur ; la configuration est relue avant chaque nouvelle connexion et chaque validation.

Sans clé, ou si Nango est indisponible, un catalogue de démarrage local est affiché avec une explication. Les liens et la gestion des raccourcis restent disponibles. Seuls les fournisseurs OAuth 1/2 qui possèdent une intégration configurée peuvent être connectés. Les fournisseurs nécessitant une clé API ou un autre mécanisme restent des raccourcis.

Nango ne fournit pas systématiquement l'adresse du site de connexion. Kaobase utilise quelques adresses connues ; pour les autres services, l'utilisateur indique son lien. Les adresses de documentation, d'API ou d'autorisation OAuth ne sont pas utilisées comme liens de site.

## Parcours OAuth

1. L'utilisateur choisit une app et son intégration, puis indique le lien d'accès, un alias de compte facultatif, l'espace et l'épinglage.
2. Le serveur exige une session Kaobase avec configuration terminée, valide les champs et l'origine de la requête, puis réserve une tentative. La limite est de dix ouvertures de connexion sur dix minutes par utilisateur, appliquée atomiquement en base.
3. Le serveur crée une session Nango limitée à l'intégration choisie, avec le tag `end_user_id` égal à l'utilisateur Kaobase authentifié. Seul le jeton temporaire de cette session est envoyé au navigateur.
4. Nango Connect ouvre l'autorisation du fournisseur. L'utilisateur se connecte et accepte les permissions sur le service concerné.
5. Au retour, Kaobase relit la connexion depuis Nango. Le tag propriétaire, les références d'intégration et de connexion, le fournisseur lorsqu'il est retourné, et le type OAuth sont vérifiés côté serveur. Un événement navigateur seul ne suffit pas à enregistrer la connexion.
6. Une transaction crée ou réutilise le raccourci et enregistre l'association. Les callbacks répétés sont idempotents. Un raccourci déjà lié à une autre connexion ne peut pas être remplacé silencieusement.

Nango conserve et gère les jetons OAuth. Kaobase enregistre seulement les références non secrètes, le nom du fournisseur, la date d'association et le raccourci. Aucun mot de passe ou jeton d'accès/rafraîchissement n'est stocké en base Kaobase, dans le navigateur ou renvoyé par les API de cette intégration. Le libellé de compte est saisi par l'utilisateur : il n'est pas présenté comme un e-mail vérifié par le service.

OAuth donne une autorisation d'API ; il ne crée pas une session de navigation universelle. Ouvrir un raccourci peut encore demander une connexion au site externe. Cette version mémorise l'autorisation mais ne synchronise pas les données métier des services. Le statut affiché indique une autorisation enregistrée ; il n'est pas une vérification en temps réel de sa validité, et les révocations externes ne sont pas synchronisées par webhook dans cette version.

## Déconnexion et suppression

La déconnexion retrouve l'association avec le client Supabase de l'utilisateur, vérifie à nouveau son propriétaire auprès de Nango, puis supprime la connexion Nango et l'association locale. Une panne Nango conserve l'association pour permettre une nouvelle tentative ; une connexion déjà absente peut être retirée localement. Le raccourci reste disponible. Il faut déconnecter une app avant de supprimer son raccourci depuis Kaobase.

La suppression de la connexion Nango ne supprime pas le compte externe et ne garantit pas la révocation du consentement chez le fournisseur. Pour retirer toutes les permissions, utiliser également les réglages du compte externe. Les suppressions directes hors de ce parcours (administration SQL, suppression complète d'un utilisateur) peuvent laisser des connexions dans Nango : l'administrateur doit alors les retirer dans Nango.

## Widget d'accueil

Le widget affiche jusqu'à huit raccourcis épinglés, triés par nom puis identifiant, selon l'espace actif. Les liens ouvrent un nouvel onglet et le libellé du compte distingue plusieurs accès à un service. « Gérer mes apps » mène à la liste complète. Les icônes utilisent des initiales locales.

## Configuration nécessaire

1. Appliquer dans Supabase les migrations précédentes, puis `20261017060000_app_shortcuts.sql` et `20261017070000_app_oauth_connections.sql`, dans cet ordre. La seconde crée les associations, les protections propriétaire, la transaction de validation et le quota.
2. Créer un compte et un environnement sur [Nango](https://app.nango.dev). Récupérer la clé API de cet environnement et la placer dans `.env.local` pour le développement et dans les variables serveur de l'hébergement pour la production : `NANGO_SECRET_KEY=...`. Ne jamais utiliser de préfixe `NEXT_PUBLIC_`, ni partager cette clé dans le chat ou la commiter.
3. Pour chaque service souhaité, créer une intégration dans le tableau de bord Nango. Choisir un fournisseur OAuth, configurer les permissions strictement nécessaires et les identifiants de son application OAuth. Utiliser les identifiants partagés de développement uniquement lorsque le service et Nango les proposent ; prévoir son propre client OAuth pour la production.
4. Dans le portail développeur du fournisseur, enregistrer l'URL de retour indiquée par Nango. Pour Nango Cloud, l'URL standard est `https://api.nango.dev/oauth/callback`. Ce retour OAuth se fait chez Nango ; les routes `/api/apps/connect/*` de Kaobase démarrent et valident le parcours.
5. Vérifier que la clé Nango permet de lire les fournisseurs et intégrations, créer des sessions Connect, lire et supprimer les connexions. La lecture de connexion doit fournir `credentials.type` pour le contrôle OAuth (`environment:connections:read_credentials` si les permissions de clé sont restreintes). Kaobase élimine les autres champs de credentials sans les journaliser.
6. Redémarrer le serveur local ou redéployer après ajout de la variable. Dans Mes apps, vérifier la source « Nango », choisir une intégration configurée, autoriser un compte de test, constater l'association puis tester la déconnexion. Tester également avec un deuxième utilisateur pour vérifier l'isolation.

Aucune clé publique Nango, clé Supabase service-role ou liste d'intégrations à maintenir dans le code n'est nécessaire. Les clients OAuth et secrets des fournisseurs se configurent dans Nango. Une connexion de test créée manuellement dans Nango n'a pas forcément le tag propriétaire Kaobase et ne sera pas acceptée par ce parcours ; démarrer la connexion depuis Mes apps.

## Validation et limites actuelles

Les tests locaux couvrent les URL, les formulaires, la recherche de comptes, les actions, la pagination, l'authentification des API, la vérification propriétaire Nango, l'élimination des données sensibles, l'idempotence et l'atomicité SQL, la RLS et les quotas. Les réponses Nango y sont simulées ; PostgreSQL est exécuté localement avec PGlite. Les tests E2E publics ne contactent aucun compte Nango.

L'autorisation réelle et les réponses de ton environnement Nango restent à vérifier après configuration, puisqu'aucun compte ni clé n'a été fourni. Aucune migration distante, publication ou mise en production n'est effectuée par cette préparation.

Références officielles vérifiées : [catalogue des fournisseurs](https://nango.dev/docs/reference/backend/http-api/providers/list), [intégrations configurées](https://nango.dev/docs/reference/backend/http-api/integration/list), [sessions Connect](https://nango.dev/docs/reference/backend/http-api/connect/sessions/create), [lecture d'une connexion](https://nango.dev/docs/reference/backend/http-api/connections/get), [suppression d'une connexion](https://nango.dev/docs/reference/backend/http-api/connections/delete), [clients OAuth et URL de retour](https://nango.dev/blog/how-to-build-a-google-sheets-api-integration-with-nango-and-codex/).
