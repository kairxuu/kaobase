# TODOS

## Compte et données

### SMTP de production Neon

Le parcours par code utilise actuellement le fournisseur partagé Neon. Pour un usage public plus large, configurer un SMTP dédié dans Neon et vérifier la délivrabilité du domaine d’envoi.

### Export des données et suppression du compte (RGPD)

**What:** Export CSV/JSON de toutes les données d'un utilisateur et suppression de son compte depuis Réglages.

**Why:** Kaobase est multi-utilisateurs et stocke des relevés bancaires : le RGPD impose le droit d'accès et le droit à l'effacement avant d'ouvrir l'app à d'autres personnes.

**Context:** Laissé de côté à la revue du 2026-10-15 (F10 non retenu en D3, noté en D14). La suppression demande une fonction SQL `security definer` qui supprime uniquement `auth.users` où `id = auth.uid()` (les tables métier suivent par `on delete cascade`). L'export peut lire chaque table sous la RLS existante.

**Effort:** M
**Priority:** P2
**Depends on:** None

## Completed
