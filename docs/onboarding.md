# Configuration initiale

La page `/setup` accueille les nouvelles inscriptions et les comptes qui ne se sont encore jamais configurés. Elle propose trois étapes : préférences (nom d'affichage, devise, fuseau horaire), compte de départ, puis récapitulatif.

L'inscription avec une session immédiate, la confirmation d'email et la première connexion dirigent vers cette page. Les écrans et actions privés renvoient également vers `/setup` tant que la configuration reste incomplète. Après validation, les connexions suivantes et une visite de `/setup` conduisent directement au tableau de bord. La récupération du mot de passe conserve son parcours dédié.

## Données et reprise

Les informations existantes sont préremplies. Le compte créé automatiquement à l'inscription est réutilisé. Si aucun compte n'existe, il est créé uniquement lors de la validation finale. Un compte contenant des opérations garde son solde d'ouverture, son espace et sa devise de compte ; son nom et son type restent configurables. La préférence de devise change l'affichage des montants, sans conversion.

L'enregistrement passe par `complete_onboarding`, lié à la session utilisateur. Le profil et le compte sont enregistrés dans une même transaction, avec des verrous et une validation côté base. `profiles.onboarding_completed_at` n'est renseigné qu'après succès. Une soumission répétée ne crée aucun doublon et ne réécrit pas une configuration terminée. Le fuseau confirmé n'est plus remplacé par la détection automatique du navigateur.

## Mise en service

Appliquer `supabase/migrations/20261017050000_onboarding.sql` après les migrations précédentes, puis déployer le code. Cette migration n'a pas été appliquée à une base distante pendant l'implémentation. Les comptes existants passent une seule fois par la configuration à leur prochaine visite ; aucune opération existante n'est supprimée.

Si la migration ou le profil n'est pas accessible, la page affiche une indisponibilité et permet de réessayer ou de se déconnecter. Elle ne charge pas le tableau de bord tant que l'état du profil n'est pas vérifiable.

## Validation

- 103 tests ajoutés : transitions d'authentification, validation et enregistrement serveur, et exécution de la migration sur PostgreSQL local avec vérification de la séparation des utilisateurs et de la protection des données existantes.
- Suite complète : 315 tests réussis. TypeScript, ESLint et build Next.js vérifiés.
- Vérification navigateur isolée avec React et Playwright : navigation au clavier, saisie et validation, conservation des champs, erreur serveur, double clic et soumission unique, compte existant verrouillé et affichage mobile/ordinateur.
- Les cinq tests E2E publics passent sur le build local, notamment la redirection de `/setup` vers la connexion pour les visiteurs sans session.
- Les parcours E2E connectés au compte Supabase distant n'ont pas été exécutés. Leur préparation sait désormais compléter la configuration lorsqu'un compte de test n'a pas encore validé cette étape.

Les changements restent locaux jusqu'au commit, push et déploiement.
