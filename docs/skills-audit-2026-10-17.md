# Audit des compétences — 17 octobre 2026

Invocation explicite de `audit-skills`, mode audit. Projet : KAOBASE. Aucun fichier de compétence globale déplacé, supprimé ou modifié.

Couverture A : 24 fichiers de transcriptions, 67 enregistrements correspondants ; horodatages observés du 12 octobre 2026 à 22:41:32 UTC au 16 octobre 2026 à 22:58:22 UTC. Inventaire du script : 19 compétences globales dans `~/.agents/skills`, aucune compétence locale dans `.agents/skills`. Ce périmètre ne prétend pas inventorier tous les plugins fournis par l’application.

Les lectures de manifeste sont des indices heuristiques, pas une preuve d’exécution par le modèle. L’invocation native Codex/Cursor n’est pas instrumentée ; les stores Cursor ACP sont opaques. `UNOBSERVED` signifie seulement absence d’observation dans la couverture A. La présente conversation apporte en plus la preuve utilisateur directe pour `audit-skills`.

| Compétence | Portée | Couverture | Classe principale | Preuve / recommandation |
|---|---|---|---|---|
| [agents-manager](/Users/alex/.agents/skills/agents-manager/SKILL.md) | global | A | INVOCATION_MISMATCH | SKILL.md : disable-model-invocation=true; agents/openai.yaml : allow_implicit_invocation=false absent. Recommandation : aligner le contrôle manquant sur la décision explicite existante. |
| [apex](/Users/alex/.agents/skills/apex/SKILL.md) | global | A | EXPLICIT_ONLY | Contrôles explicites présents pour Claude et Codex. Lectures de manifeste observées : 1. Conserver. |
| [app-icon](/Users/alex/.agents/skills/app-icon/SKILL.md) | global | A | EXPLICIT_ONLY | Contrôles explicites présents pour Claude et Codex. Lectures de manifeste observées : 0. Conserver. |
| [appstore-connect](/Users/alex/.agents/skills/appstore-connect/SKILL.md) | global | A | EXPLICIT_ONLY | Contrôles explicites présents pour Claude et Codex. Lectures de manifeste observées : 0. Conserver. |
| [arena](/Users/alex/.agents/skills/arena/SKILL.md) | global | A | INVOCATION_MISMATCH | SKILL.md : disable-model-invocation=false; agents/openai.yaml : allow_implicit_invocation=false présent. Recommandation : aligner le contrôle manquant sur la décision explicite existante. |
| [audit-memories](/Users/alex/.agents/skills/audit-memories/SKILL.md) | global | A | EXPLICIT_ONLY | Contrôles explicites présents pour Claude et Codex. Lectures de manifeste observées : 0. Conserver. |
| [audit-skills](/Users/alex/.agents/skills/audit-skills/SKILL.md) | global | A | OBSERVED_USER | Appel explicite dans la conversation active ; contrôles explicites présents pour Claude et Codex. |
| [environments-manager](/Users/alex/.agents/skills/environments-manager/SKILL.md) | global | A | INVOCATION_MISMATCH | SKILL.md : disable-model-invocation=true; agents/openai.yaml : allow_implicit_invocation=false absent. Recommandation : aligner le contrôle manquant sur la décision explicite existante. |
| [find-skills](/Users/alex/.agents/skills/find-skills/SKILL.md) | global | A | UNOBSERVED | Aucun appel utilisateur ou natif observé dans A ; lectures de manifeste : 0. Conserver ; cet échantillon ne justifie aucun retrait. |
| [grill-me](/Users/alex/.agents/skills/grill-me/SKILL.md) | global | A | EXPLICIT_ONLY | Contrôles explicites présents pour Claude et Codex. Lectures de manifeste observées : 0. Conserver. |
| [hooks-manager](/Users/alex/.agents/skills/hooks-manager/SKILL.md) | global | A | EXPLICIT_ONLY | Contrôles explicites présents pour Claude et Codex. Lectures de manifeste observées : 0. Conserver. |
| [limite](/Users/alex/.agents/skills/limite/SKILL.md) | global | A | EXPLICIT_ONLY | Contrôles explicites présents pour Claude et Codex. Lectures de manifeste observées : 0. Conserver. |
| [onboarding](/Users/alex/.agents/skills/onboarding/SKILL.md) | global | A | UNOBSERVED | Aucun appel utilisateur ou natif observé dans A ; lectures de manifeste : 0. Conserver ; cet échantillon ne justifie aucun retrait. |
| [resume-tailor](/Users/alex/.agents/skills/resume-tailor/SKILL.md) | global | A | UNOBSERVED | Aucun appel utilisateur ou natif observé dans A ; lectures de manifeste : 0. Conserver ; cet échantillon ne justifie aucun retrait. |
| [reverse-engineer-anything](/Users/alex/.agents/skills/reverse-engineer-anything/SKILL.md) | global | A | UNOBSERVED | Aucun appel utilisateur ou natif observé dans A ; lectures de manifeste : 0. Conserver ; cet échantillon ne justifie aucun retrait. |
| [rules-manager](/Users/alex/.agents/skills/rules-manager/SKILL.md) | global | A | INVOCATION_MISMATCH | SKILL.md : disable-model-invocation=true; agents/openai.yaml : allow_implicit_invocation=false absent. Recommandation : aligner le contrôle manquant sur la décision explicite existante. |
| [skill-manager](/Users/alex/.agents/skills/skill-manager/SKILL.md) | global | A | UNOBSERVED | Aucun appel utilisateur ou natif observé dans A ; lectures de manifeste : 0. Conserver ; cet échantillon ne justifie aucun retrait. |
| [test-audit](/Users/alex/.agents/skills/test-audit/SKILL.md) | global | A | UNOBSERVED | Aucun appel utilisateur ou natif observé dans A ; lectures de manifeste : 0. Conserver ; cet échantillon ne justifie aucun retrait. |
| [use-style](/Users/alex/.agents/skills/use-style/SKILL.md) | global | A | INVOCATION_MISMATCH | SKILL.md : disable-model-invocation=true; agents/openai.yaml : allow_implicit_invocation=false absent. Recommandation : aligner le contrôle manquant sur la décision explicite existante. |

Cinq écarts de contrôle sont documentés ci-dessus, sans collision de nom ni candidat à déplacement local. Les compétences de sécurité, récupération, incident et migration ne doivent pas être élaguées sur le seul critère d’usage. Le correctif du projet et le présent audit ne changent pas les préférences globales de découverte des compétences.
