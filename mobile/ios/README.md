# Kaobase iOS — SwiftUI

Application native pour iPhone et iPad, à partir d’iOS 18. Les écrans sont écrits en SwiftUI, les graphiques utilisent Swift Charts. Aucune WebView et aucune dépendance Swift externe.

## Ouvrir et lancer

Depuis la racine du dépôt :

```sh
python3 mobile/ios/configure.py --website https://kaobase.vercel.app
xcodegen generate --spec mobile/ios/project.yml
open mobile/ios/Kaobase.xcodeproj
```

XcodeGen est nécessaire seulement pour régénérer le projet (`brew install xcodegen` s’il manque). Le projet Xcode généré est également versionné. Dans Xcode, choisir le schéma **Kaobase**, un simulateur iPhone, puis **Run** (⌘R).

**Déployer d’abord les nouveaux fichiers serveur sur Vercel** : l’app appelle les routes `/api/mobile/*`, ajoutées avec cette version. Le site public utilisé par défaut est `https://kaobase.vercel.app`. Le changer avec `--website` si le domaine de production change. Une URL de preview HTTPS fonctionne aussi ; elle doit être accessible sans la protection d’accès Vercel.

Le script lit uniquement `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` dans `.env.local`. Il génère `Kaobase/Config.local.plist`, ignoré par Git, avec ces valeurs publiques et l’adresse du site. Il refuse les clés secrètes ou `service_role`. Il ne copie ni mot de passe PostgreSQL, ni clé Nango, ni clé d’IA. Le fichier d’exemple décrit les trois valeurs nécessaires pour une configuration manuelle.

## Sur son propre iPhone

Brancher l’iPhone au Mac, activer le mode développeur si Xcode le demande et sélectionner l’appareil dans Xcode. Dans **Kaobase → Signing & Capabilities**, choisir son équipe Apple et, si nécessaire, un identifiant d’app disponible à la place de `com.kaobase.ios`. Lancer avec ⌘R. La signature personnelle permet les essais locaux selon les limites d’Apple ; TestFlight et la distribution App Store passent par Apple Developer et App Store Connect.

## Fonctions de cette première version

- Connexion et inscription avec les mêmes comptes Supabase Auth que sur le web ; confirmation par e-mail si activée dans le projet. Le lien de récupération du mot de passe ouvre le parcours web existant.
- Configuration obligatoire au premier accès : profil, devise, fuseau, premier compte, solde initial et espace.
- Accueil avec soldes par devise, entrées/sorties du mois, répartition des dépenses, budgets et raccourcis épinglés.
- Opérations : recherche serveur, pagination, ajout, catégorisation avec les règles existantes et suppression confirmée.
- Abonnements : liste, coût mensuel, ajout, confirmation/rejet des suggestions et suppression.
- Tâches : liste, création avec échéance/priorité, terminer/rouvrir et suppression.
- Comptes : liste et ajout. Budgets : suivi, définition et suppression. Profil : nom, devise et fuseau.
- Apps : catalogue serveur, recherche, catégorie, tri, ajout de raccourcis et épingles. Les associations OAuth existantes sont visibles ; leur création et leur révocation restent dans le parcours web Nango.
- Assistant : questions et actions via les agents existants, quota partagé avec le web, confirmation explicite des suppressions proposées.
- Thème clair/sombre, tailles de texte système, actualisation au retour dans l’app et masquage des données dans l’aperçu multitâche.

Les imports CSV/OFX, l’édition détaillée des abonnements/comptes/catégories et l’historique/performance des agents restent disponibles sur le web. L’assistant natif conserve son fil tant que cet écran est ouvert ; la reprise d’un historique de conversation n’est pas encore proposée dans l’interface iOS. L’app nécessite une connexion réseau ; elle ne simule pas un enregistrement hors ligne.

## Architecture et sécurité

`APIClient` effectue les appels HTTPS avec `URLSession`. L’authentification se fait auprès de Supabase ; le serveur Kaobase valide ensuite chaque JWT avec `getUser(token)` et applique la même RLS sur Neon que le site. Aucune connexion PostgreSQL propriétaire n’est embarquée. Les écritures réutilisent les fonctions métier web et sont validées côté serveur. Les routes mobiles ignorent les cookies et exigent un jeton Bearer vérifié. Les réponses privées sont `no-store` et varient par autorisation.

Le trousseau iOS conserve uniquement la session (jetons et expiration), avec l’accessibilité `WhenUnlockedThisDeviceOnly`. Les mots de passe ne sont pas persistés. Les requêtes utilisent une session réseau éphémère sans cache/cookies et refusent les redirections. Les renouvellements concurrents partagent une seule rotation du refresh token ; une panne temporaire ne supprime pas la session. La déconnexion efface le trousseau et demande la révocation de cette session à Supabase.

`PrivacyInfo.xcprivacy` décrit les données utilisées pour le fonctionnement. Avant une soumission App Store, compléter les informations légales et de confidentialité réelles dans App Store Connect, prévoir le parcours de suppression du compte, puis vérifier les parcours et l’accessibilité sur un iPhone physique. Cette version n’est ni signée pour la distribution ni publiée.

Références : [SwiftUI et navigation](https://developer.apple.com/documentation/swiftui/understanding-the-navigation-stack), [sessions Supabase](https://supabase.com/docs/guides/auth/sessions), [autorisation Neon Data API](https://neon.com/docs/data-api/overview).

## Tests

```sh
# Depuis la racine du dépôt :
npm test -- --maxWorkers=2
npm run typecheck
npm run lint
npm run build

# Adapter le nom du simulateur à ceux installés dans Xcode :
xcodebuild -project mobile/ios/Kaobase.xcodeproj -scheme Kaobase \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=latest' \
  -parallel-testing-enabled NO \
  -derivedDataPath /tmp/kaobase-ios-build test
```

Les tests Swift couvrent les montants décimaux, les dates/fuseaux, le décodage des réponses, les liens autorisés, les soldes par devise et les renouvellements de session. Les tests UI vérifient navigation, recherche et formulaires. L’argument de lancement **`--demo`**, uniquement dans une compilation Debug, ouvre un aperçu clairement identifié avec des données fictives ; aucune écriture ou requête IA n’y est autorisée. Retirer cet argument pour se connecter réellement. Les builds Release ne contiennent pas les données de démonstration.

Conserver la signature locale du simulateur : `CODE_SIGNING_ALLOWED=NO` empêche le test du trousseau sur certaines versions d’iOS. Le projet prévoit une signature ad hoc sur simulateur, sans équipe Apple ; la signature sur iPhone se configure avec l’équipe de l’utilisateur.

Les produits de compilation restent hors du dépôt (`/tmp` dans l’exemple, DerivedData par défaut dans Xcode), pour éviter les attributs ajoutés par iCloud/FileProvider qui peuvent empêcher la signature des bundles.

L’icône est une version vectorielle du motif Kaobase. Pour la régénérer : `swift mobile/ios/generate-icon.swift`, puis régénérer le projet Xcode si des ressources ont été ajoutées.
