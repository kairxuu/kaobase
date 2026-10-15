# TODOS

## Compte et données

### Envoi d'emails réel (SMTP) pour la confirmation et le mot de passe oublié

**What:** Brancher Resend ou Brevo dans Supabase > Authentication > Emails > SMTP Settings.

**Why:** Le service d'email intégré de Supabase n'envoie qu'aux membres de l'équipe du projet, quelques fois par heure : les autres utilisateurs ne reçoivent ni la confirmation d'inscription ni le lien de réinitialisation du mot de passe.

**Context:** Constaté le 2026-10-15 (email de confirmation jamais reçu). Le parcours « mot de passe oublié » (F6, revue d'ingénierie du 2026-10-15) en dépend. Créer un compte Resend ou Brevo, vérifier un domaine d'envoi, coller les identifiants SMTP dans Supabase, puis faire pointer les modèles d'email vers https://kaobase.vercel.app/auth/confirm. Aucun code à changer.

**Effort:** S
**Priority:** P1
**Depends on:** F6 (mot de passe oublié)

### Export des données et suppression du compte (RGPD)

**What:** Export CSV/JSON de toutes les données d'un utilisateur et suppression de son compte depuis Réglages.

**Why:** Kaobase est multi-utilisateurs et stocke des relevés bancaires : le RGPD impose le droit d'accès et le droit à l'effacement avant d'ouvrir l'app à d'autres personnes.

**Context:** Laissé de côté à la revue du 2026-10-15 (F10 non retenu en D3, noté en D14). La suppression demande une fonction SQL `security definer` qui supprime uniquement `auth.users` où `id = auth.uid()` (les tables métier suivent par `on delete cascade`). L'export peut lire chaque table sous la RLS existante.

**Effort:** M
**Priority:** P2
**Depends on:** None

## Completed
