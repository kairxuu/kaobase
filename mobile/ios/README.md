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

Le script écrit uniquement l’adresse publique du site dans `Config.local.plist`, ignoré par Git. Aucune clé de fournisseur ni aucun secret serveur n’est embarqué.

## Sur son propre iPhone

Brancher l’iPhone au Mac, activer le mode développeur si Xcode le demande et sélectionner l’appareil dans Xcode. Dans **Kaobase → Signing & Capabilities**, choisir son équipe Apple et, si nécessaire, un identifiant d’app disponible à la place de `com.kaobase.ios`. Lancer avec ⌘R. La signature personnelle permet les essais locaux selon les limites d’Apple ; TestFlight et la distribution App Store passent par Apple Developer et App Store Connect.

## Fonctions de cette première version

- Connexion et inscription via Neon Auth, confirmation par code, renvoi du code et récupération du mot de passe directement dans l’app. Les comptes historiques définissent leur nouveau mot de passe avec « Mot de passe oublié ».
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

`APIClient` effectue les appels HTTPS avec `URLSession` vers Kaobase. Le serveur communique avec Neon Auth et vérifie chaque JWT avec ses clés JWKS. Les données restent protégées par la RLS Neon. Aucune connexion PostgreSQL propriétaire n’est embarquée.

Le trousseau iOS conserve uniquement la session (jetons et expiration), avec l’accessibilité `WhenUnlockedThisDeviceOnly`. Les mots de passe ne sont pas persistés. Les requêtes utilisent une session réseau éphémère sans cache/cookies et refusent les redirections. Les renouvellements concurrents partagent un seul renouvellement de session ; une panne temporaire ne supprime pas la session. La déconnexion efface le trousseau et demande la révocation de cette session à Neon.

`PrivacyInfo.xcprivacy` décrit les données utilisées pour le fonctionnement. Avant une soumission App Store, compléter les informations légales et de confidentialité réelles dans App Store Connect, prévoir le parcours de suppression du compte, puis vérifier les parcours et l’accessibilité sur un iPhone physique. Cette version n’est ni signée pour la distribution ni publiée.

Références : [SwiftUI et navigation](https://developer.apple.com/documentation/swiftui/understanding-the-navigation-stack), [authentification Neon](https://neon.com/docs/auth/overview), [autorisation Neon Data API](https://neon.com/docs/data-api/overview).

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
