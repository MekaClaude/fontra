# Menu contextuel — Align, Distribute & Path Operations

**Projet :** `D:\DEVWEB\MINIMAX AGENT\fontra\fontra` (fork Fontra, branche `code-review-feedback-42427`)
**Date du rapport :** 2026-11-11, complété le 2026-11-12
**Commits :**

- `48633ea5c` — _Put align, distribute and the path operations in the context menu_
- `f10af1875` — _Rebuild the client bundle and the Windows artefact v2026.11.11.20_
- _Fix the point-level align and distribute actions_ — revue + correctif des variantes « points »
  (voir §2.2, §4, §5.3)

---

## 1. Résumé exécutif

Les 12 opérations de transformation de sélection (6 alignements, 2 distributions, 4 opérations
booléennes de chemin) n'étaient accessibles que depuis le panneau latéral **Selection Transformation**.
Chaque usage imposait un aller-retour vers la colonne de droite, alors que le geste naturel en
dessin de caractères est le clic droit sur la sélection.

Elles sont désormais à **un clic droit** du contour sélectionné, dans un groupe de menu dédié
(Align / Distribute / Path Operations), avec icônes et hints de raccourci clavier.

Le panneau latéral a été conservé et réécrit comme une fine couche d'interface au-dessus des mêmes
actions : **les deux points d'entrée pilotent le même code**, il n'y a pas de duplication de logique.

** seconde itération (2026-11-12) — variantes « points » :** une feature a été ajoutée sur ce menu
pour aligner/distribuer **les points eux-mêmes** plutôt que les objets entiers (contours,
composants…). La revue a mis au jour **un bug bloquant** : les points explicitement sélectionnés
n'étaient pas réellement alignés dès que l'un d'eux était une handle de son voisin. Le bug est
**corrigé**, couvert par **5 tests de régression** (nouvelle infra de test pour `views-editor`), et
vérifié dans le navigateur.

| Livrable                                                             | État                      |
| -------------------------------------------------------------------- | ------------------------- |
| Groupe de menu contextuel (12 actions, 3 sous-menus)                 | ✅ fait                   |
| États d'activation (actif / grisé) corrects                          | ✅ fait                   |
| Icônes par item + hints de raccourcis                                | ✅ fait                   |
| Raccourcis clavier `cmd+alt+<lettre>`                                | ✅ fait                   |
| Logique pure extraite dans `fontra-core` + 21 tests unitaires        | ✅ fait                   |
| 2 bugs bloquants corrigés (`splitSelection`, clic droit)             | ✅ fait                   |
| Vérification navigateur (Union + Align + Undo)                       | ✅ fait                   |
| Artefact Windows `v2026.11.12.08` construit + `test-export.py` 7/0   | ✅ fait                   |
| Variantes « points » (8 actions, align + distribute au niveau point) | ✅ fait                   |
| Bug « le point sélectionné n'était pas aligné » corrigé              | ✅ fait (§4, bug 4)       |
| Infra de test pour `views-editor` + 5 tests de régression            | ✅ fait (§5.2)            |
| Traductions des 8 nouvelles clés dans les 14 autres langues          | ❌ **non fait** (voir §7) |
| Tests end-to-end automatisés (Playwright / Cypress)                  | ❌ **non fait** (voir §7) |

---

## 2. Contexte et périmètre

**Demande initiale :** audit du repo, synchronisation, puis mise en place du nouveau menu contextuel
avec vérification que tout fonctionne.

**Audit et synchronisation :** le repo était déjà à jour — `origin` à 0/0, aucun nouveau commit sur
`upstream`. Aucun travail de réconciliation n'a été nécessaire.

**Périmètre du menu contextuel :**

| Opération               | Identifiant d'action                                        | Raccourci   |
| ----------------------- | ----------------------------------------------------------- | ----------- |
| Align left              | `action.selection-transformation.align.left`                | `cmd+alt+L` |
| Align center            | `action.selection-transformation.align.center`              | `cmd+alt+C` |
| Align right             | `action.selection-transformation.align.right`               | `cmd+alt+R` |
| Align top               | `action.selection-transformation.align.top`                 | `cmd+alt+T` |
| Align middle            | `action.selection-transformation.align.middle`              | `cmd+alt+M` |
| Align bottom            | `action.selection-transformation.align.bottom`              | `cmd+alt+B` |
| Distribute horizontally | `action.selection-transformation.distribute.horizontally`   | `cmd+alt+H` |
| Distribute vertically   | `action.selection-transformation.distribute.vertically`     | `cmd+alt+V` |
| Union                   | `action.selection-transformation.path-operations.union`     | `cmd+alt+U` |
| Subtract                | `action.selection-transformation.path-operations.subtract`  | `cmd+alt+S` |
| Intersect               | `action.selection-transformation.path-operations.intersect` | `cmd+alt+I` |
| Exclude                 | `action.selection-transformation.path-operations.exclude`   | `cmd+alt+X` |

Le groupe n'apparaît que dans la branche **édition d'un glyphe** du menu contextuel
(`sceneSettings.selectedGlyph?.isEditing`), pas dans le menu de sélection de glyphe.

### 2.2 Les variantes « points » (seconde itération)

Une feature a été ajoutée le 2026-11-11 pour aligner/distribuer **les points sélectionnés** plutôt
que les objets entiers : 8 actions supplémentaires, listées sous les 6+2 actions d'objets, avec un
séparateur et le suffixe ` (points)`.

| Opération             | Identifiant d'action                                             | Raccourci         |
| --------------------- | ---------------------------------------------------------------- | ----------------- |
| Align left (points)   | `action.selection-transformation.align.left.points`              | `cmd+alt+shift+L` |
| Align center (points) | `action.selection-transformation.align.center.points`            | `cmd+alt+shift+C` |
| Align right (points)  | `action.selection-transformation.align.right.points`             | `cmd+alt+shift+R` |
| Align top (points)    | `action.selection-transformation.align.top.points`               | `cmd+alt+shift+T` |
| Align middle (points) | `action.selection-transformation.align.middle.points`            | `cmd+alt+shift+M` |
| Align bottom (points) | `action.selection-transformation.align.bottom.points`            | `cmd+alt+shift+B` |
| Distribute H (points) | `action.selection-transformation.distribute.horizontally.points` | `cmd+alt+shift+H` |
| Distribute V (points) | `action.selection-transformation.distribute.vertically.points`   | `cmd+alt+shift+V` |

L'option `pointLevel` a été threading jusqu'au cœur de la logique pure : en mode « points », chaque
point sélectionné devient **son propre** objet déplaçable, y compris à l'intérieur d'un contour
fermé (dont le comportement par défaut est de bouger d'un bloc).

Les raccourcis `cmd+alt+shift+<lettre>` sont **distincts** des raccourcis `cmd+alt+<lettre>` : le
moteur de raccourcis compare `metaKey/ctrlKey/shiftKey/altKey` un par un (`matchEventModifiers`),
il n'y a donc pas de collision.

---

## 3. Ce qui a été réalisé

### 3.1 Un module, deux points d'entrée

La logique de transformation vivait **entièrement dans le panneau latéral** (`panel-transformation.js`,
1093 lignes). Le menu contextuel n'y avait aucun accès : il aurait fallu dupliquer la logique.

La refactorisation sépare deux niveaux :

```
src-js/fontra-core/src/selection-transformations.js      ← logique pure, testable
  getSelectedContourIndices()   splitSelection()
  getMovableObjectSelections()  countMovableObjects()
  canAlignOrDistribute()        canDoPathOperation()

src-js/views-editor/src/selection-transformations.js     ← couche éditeur
  registerSelectionTransformationActions()   ← enregistrement des 12 actions
  getSelectionTransformationMenuItems()       ← descripteurs de menu
  moveObjects()  doPathOperations()  transformSelection()
  MovableObject  descripteurs align/distribute
```

`panel-transformation.js` est devenu une **fine couche UI** : il construit les contrôles, lit la
sélection, et appelle les mêmes actions enregistrées que le menu.

**Pourquoi `fontra-core` :** c'est la convention du repo pour la logique pure (testable sans
éditeur). Le module ne dépend que de `path-functions.js` et `utils.ts` — aucun DOM.

### 3.2 États d'activation

Les 12 actions n'avaient **aucun prédicat d'activation**. Le menu les proposait inconditionnellement
et le clic ne produisait rien. Les prédicats ajoutés :

- **Align / Distribute** : au moins **2 objets déplaçables indépendamment**.
- **Union** : au moins 2 contours, ou une sélection de points.
- **Subtract / Intersect / Exclude** : au moins **un contour sélectionné** _et_ au moins **un contour
  non sélectionné** (ils combinent les deux ensembles).

> Les prédicats sont **strictement synchrones** : le menu les évalue de façon synchrone, donc une
> promesse serait toujours _truthy_ et tout serait activé en permanence.

### 3.3 Icônes et hints de raccourcis

`MenuPanel` (webcomponent) accepte désormais une **icône optionnelle par item** (`.item-icon` +
`.item-label`). Le comportement est **opt-in** : les menus existants sont restés pixel-identiques,
aucun risque de régression visuelle sur le reste de l'application.

Icônes utilisées : jeu Tabler (`vertical-align-left`, `layout-distribute-vertical`,
`layers-union`, `layers-subtract`, `layers-intersect-2`, `layers-difference`, …).

### 3.4 Chaînes de langue

8 clés ajoutées dans `src-js/fontra-core/assets/lang/en.js` :

```
menu.selection-transformations.align
menu.selection-transformations.distribute
menu.selection-transformations.path-operations
menu.selection-transformations.union
menu.selection-transformations.subtract
menu.selection-transformations.intersect
menu.selection-transformations.exclude
menu.selection-transformations.points
```

La clé `action-topics.selection-transformations` existait déjà dans les 15 fichiers de langue.

> `en.js` est la source éditée à la main dans ce fork ; les 14 autres fichiers sont **générés**
> (`scripts/rebuild_languages.py` à partir d'un Google Sheet) et ne sont pas modifiés ici. La
> nouvelle clé `points` a donc un repli anglais explicite dans le code, pour que les locales non
> mises à jour n'affichent pas la clé brute.

### 3.5 Align / distribute au niveau des points

En mode « points », la sélection est éclatée en **un objet par point sélectionné** (y compris à
l'intérieur d'un contour fermé). Les 8 actions correspondantes réutilisent exactement les mêmes
descripteurs de déplacement que les actions d'objets : seule la granularité de la sélection change.

La sélection explicite d'un point l'emporte toujours : voir le bug 4 et son correctif.

---

## 4. Bugs trouvés et corrigés

Trois bugs ont été découverts pendant la développement et la vérification. Les deux premiers
étaient **bloquants** — la fonctionnalité était inutilisable.

### Bug 1 — `splitSelection` : un contour fermé ne comptait pas comme objet

Un contour fermé n'était compté comme **un seul** objet déplaçable que si son **point de départ**
était sélectionné. Avec une sélection faite au lasso (qui ne sélectionne que les points _on-curve_,
et commence rarement au point de départ), le contour était découpé en points individuels →
`countMovableObjects` ≥ 2 → _Align_ s'activait à tort, et _Distribute_ calculait sur des fragments
de contour au lieu du contour entier.

Second bug dans la même fonction : `contourInfo` était indexé par l'**ordinal de la sélection**
au lieu du **vrai index de contour** → mauvais contours déplacés.

**Correction :** un contour fermé avec _n'importe quel_ point sélectionné est **un** objet
déplaçable ; indexation par le vrai index de contour.

### Bug 2 — le clic droit rétrécissait la sélection

`sceneController.updateContextMenuState()` remplaçait **toute** la sélection par l'élément cliqué
dès que celui-ci n'était pas déjà sélectionné. Combiné au fait que le lasso ne sélectionne que les
points _on-curve_ :

> clic droit sur un point **off-curve** d'un contour déjà sélectionné → la sélection multi-contours
> était détruite → **tout le menu devenait grisé**.

La fonctionnalité paraissait donc totalement morte, alors que le code était correct.

**Correction :** `updateContextMenuState()` conserve la sélection quand l'élément cliqué appartient à
un contour que la sélection touche déjà (helper `_clickedItemIsInSelectedContour()`), et utilise
l'élément cliqué comme contexte pour les opérations ponctuelles.

### Bug 3 — régression introduite pendant la refactorisation

Le déplacement de `range` vers `fontra-core` avait supprimé l'import `range` encore utilisé par
`doPathOperations` dans la couche éditeur → `ReferenceError: range is not defined` **au clic sur
Union**. Ce bug n'est apparu qu'en _exécutant_ l'opération (le menu s'affichait normalement) : il a
été trouvé en testant réellement l'opération dans le navigateur, pas à la lecture du code.

### Bug 4 — aligner des points ne les alignait pas (trouvé dans la revue du 2026-11-12)

Le plus subtil des quatre, et le plus grave pour la feature « points » : **les points
explicitement sélectionnés n'étaient pas alignés** dès que l'un d'eux était une _handle_ de son
voisin.

**Mécanisme.** Dans Fontra, déplacer un point _on-curve_ **entraîne sa handle voisine** (règle
`defaultRules` de `edit-behavior.js` : `Unselected free off-curve point, move with on-curve
neighbor`). Or `moveObjects()` appliquait le changement de chaque objet **au fur et à mesure**, sur
le glyphe déjà modifié :

1. objet 1 = l'ancrage, delta `+127` → l'ancrage bouge, **et sa handle est entraînée** ;
2. objet 2 = la handle, delta `0` → son changement était calculé à partir de la position **déjà
   déplacée**, donc elle ne revenait pas à sa position cible.

Résultat mesuré : les deux points selected restaient **à 30 unités d'écart** (voir §5.2).

**Correction (deux parties) :**

1. les changements de tous les objets sont désormais **calculés avant** d'être appliqués : chaque
   objet se déplace donc par rapport à la **même géométrie d'origine** ;
2. les positions cibles des points explicitement sélectionnés sont calculées par une nouvelle
   fonction pure `getExplicitPointTargets()` (`fontra-core`), puis **écrites en dernier** : la
   sélection explicite l'emporte toujours sur l'entraînement des handles.

Les handles **non** sélectionnées continuent de suivre leur ancrage — le modèle d'édition de
Fontra est préservé.

---

## 5. Vérification

### 5.1 Tests unitaires (`fontra-core`)

21 tests dans `src-js/fontra-core/tests/test-selection-transformations.js` :

- `getSelectedContourIndices` : contours contenant des points sélectionnés ; liste vide sans sélection.
- `splitSelection` : contour fermé = 1 unité ; contour fermé partiellement sélectionné = 1 unité ;
  points d'un contour ouvert séparés ; pas de mélange entre contours ; composants / ancres / images
  de fond signalés.
- `getMovableObjectSelections` / `countMovableObjects` : 1 objet par contour fermé ; 1 contour
  sélectionné = 1 objet.
- `canAlignOrDistribute` : ≥ 2 objets ; false sans chemin.
- `canDoPathOperation` : union avec > 1 contour ; union désactivée sur un contour unique sans
  sélection ; autres opérations : 1 contour sélectionné + 1 non sélectionné ; false sans chemin.
- **mode « points »** : un contour fermé est éclaté en points individuels ; chaque point sélectionné
  compte pour un objet ; il faut au moins 2 points.
- **`getExplicitPointTargets()`** (nouveau) : position cible d'un point sélectionné ; index hors
  bornes ignoré ; map vide sans chemin.

```
fontra-core : 1272 tests passés (aucun échec)
```

### 5.2 Tests de régression (`views-editor`) — nouvelle infra

`src-js/views-editor` n'avait **aucune** infra de test (`"test": "echo No test specified"`). Elle a
été créée : script `mocha` dans `src-js/views-editor/package.json`, `chai` + `mocha` en
devDependencies, et `src-js/views-editor/tests/test-selection-transformations.js`.

Le module éditeur importe le web component du menu contextuel (besoin d'un DOM) : le fichier de
test fournit le minimum nécessaire (`HTMLElement`, `customElements`, `window`, `localStorage`) puis
importe le module dynamiquement. Les tests exercising le **vrai** `moveObjects()`, avec le **vrai**
`EditBehaviorFactory` et un `sceneController` simulé.

5 tests :

- aligne deux points _on-curve_ ;
- aligne un point _on-curve_ et la handle **qui le suit** ;
- aligne un point _on-curve_ et la handle **qui le précède** ;
- la handle **non sélectionnée** suit bien son ancrage ;
- aligne des contours entiers (mode objet).

**Ces tests échouent sans le correctif** (écart de 30 unités) et passent avec — vérifié en
revertissant temporairement le correctif.

### 5.3 Vérification navigateur (menu contextuel, Align / Union)

Protocole : serveur Fontra local sur une **copie** du projet de test
(`D:\DESIGN\FONT MAKING\oo test.fontra`, glyphe `o`, 2 contours / 24 points), jamais sur le fichier
de l'utilisateur.

Résultats observés :

| Contrôle                                                                   | Résultat |
| -------------------------------------------------------------------------- | -------- |
| Menu rendu avec icônes + hints de raccourcis                               | ✅       |
| 2 contours sélectionnés → Align / Distribute / Union **actifs**            | ✅       |
| Subtract / Intersect / Exclude **grisés** (pas de contour non sélectionné) | ✅       |
| **Union** exécutée → le `o` devient plein, écriture sur disque confirmée   | ✅       |
| **Align left** exécutée → le contour intérieur calé à gauche               | ✅       |
| `Ctrl+Z` → restauration complète de la géométrie                           | ✅       |
| Copie finale **identique octet pour octet** à l'original                   | ✅       |
| Erreurs console                                                            | **0**    |
| Panneau latéral _Selection Transformation_ toujours fonctionnel            | ✅       |

### 5.4 Vérification navigateur (variantes « points »)

Même protocole, copie du projet dans le workspace, serveur sur le port 8125.

| Contrôle                                                                               | Résultat                |
| -------------------------------------------------------------------------------------- | ----------------------- |
| Sous-menu **Align** : les 6 actions d'objets + les 6 actions « (points) » + séparateur | ✅ (captures)           |
| Icônes présentes sur les 12 items                                                      | ✅                      |
| 2 points _on-curve_ sélectionnés (lasso) → **Align right (points)** actif              | ✅                      |
| **Align right (points)** exécutée → le point interne passe de x=354 à x=435            | ✅ (fichier sur disque) |
| La handle non sélectionnée **suit** son ancrage (x=353 → 434)                          | ✅ (modèle Fontra)      |
| `Ctrl+Z` → le fichier est **identique** à l'original (x et y)                          | ✅                      |
| Erreurs console                                                                        | **0**                   |

---

## 6. Challenges rencontrés

1. **Le clic droit comme destroyer de sélection.** Le comportement par défaut de Fontra (remplacer la
   sélection par l'élément cliqué) est correct pour un clic sur un élément _non_ sélectionné, mais
   destructeur quand le lasso ne sélectionne que les points _on-curve_. Corriger la sémantique du
   clic droit dans `scene-controller.js` a été nécessaire — c'est un changement de comportement
   **partagé** avec tous les autres éléments du menu contextuel, pas seulement avec le nôtre.

2. **Espaces de coordonnées.** `path.getPoint()` / `iterPointsInRect()` donnent des index de points
   **absolus** (tous contours confondus), tandis que `getSelectionByContour()` renvoie une Map
   `contourIndex → index *relatifs au contour*`. Mélanger les deux espaces est la source classique
   de bugs « mauvais contour » — c'est exactement le bug 1.

3. **Le panneau n'était pas un module.** `panel-transformation.js` mélangeait logique, UI et accès au
   `sceneController`. Pour que le menu atteigne les opérations, il a fallu _extraire_ la logique —
   pas la copier. D'où le découpage en deux fichiers de niveau différent.

4. **Détecter les bugs au bon moment.** Deux bugs (3 et 2) ne sont pas visibles à la lecture du code
   ni dans les tests unitaires : ils n'apparaissent qu'**en exécutant** l'opération dans un vrai
   navigateur, avec un vraiUndo. La vérification manuelle n'a pas été un luxe, elle était nécessaire.

5. **Cache HTTP du serveur de dev.** Le serveur statique peut servir un `editor.html` en `304`
   (le `Last-Modified` de webpack n'est pas rafraîchi) et le navigateur continue d'exécuter un bundle
   supprimé. Procédure retenue : URL avec un paramètre `cb=<n>` **jamais réutilisé**, puis contrôle
   du hash du bundle dans la console.

6. **`MenuPanel` est dans un shadow root.** Les états actif / inactif ne sont pas lisibles par
   selector DOM ; ils se vérifient **visuellement** (blanc = actif, gris = désactivé).

7. **Windows / suppression.** La corbeille du runtime refuse les suppressions **hors du workspace** :
   la copie de test `%TEMP%\fontra-verify` n'a pas pu être supprimée. Aucun contournement n'a été
   tenté — c'est signalé en §7.

---

## 7. Ce qui reste à faire / non réalisé

### À faire (par ordre de priorité)

1. **Traduire les 7 nouvelles clés dans les 14 autres langues.**
   Seule `en.js` a été mis à jour. Les fichiers `de.js`, `es-419.js`, `es-ES.js`, `fr.js`, `it.js`,
   `ja.js`, `nb.js`, `nl.js`, `pt-BR.js`, `pt-PT.js`, `ru.js`, `tl.js`, `zh-CN.js`, `zh-TW.js` n'ont
   pas les clés `menu.selection-transformations.*` → **l'interface affiche ces libellés en anglais
   dans les 14 autres locales**, y compris le français.
   _Non fait ici :_ 14 traductions à écrire et à re-bundler — hors du périmètre demandé pour ce tour.

2. **Tester les autres opérations booléennes.** Seule **Union** a été exécutée dans le navigateur.
   Subtract / Intersect / Exclude ont été validés au niveau des _prédicats d'activation_ (correctement
   grisés sans second contour) mais **pas exécutés** : ils exigent un contour sélectionné _et_ un
   contour non sélectionné dans le même glyphe. Un test manuel reste à faire.

3. **Tester les 6 alignements et les 2 distributions.** Seul _Align left_ a été exécuté. Les autres
   partagent le même code (descripteurs `MoveObjectsDescriptor`), donc le risque est faible, mais
   la couverture n'est pas complète.

4. **Vérifier le comportement multi-maître / glyphe variable.** Le code est agnostique (il travaille
   sur `sceneController.getSelectedEditablePath()`), mais la validation n'a porté que sur un glyphe
   statique.

### Non fait (arbitré)

5. **Phase 2 d'UX (champ de recherche + barre d'icônes dans le menu).** Explicitement écartée : non
   idiomatique Fontra, et hors du besoin fonctionnel demandé. Le menu reste un menu contextuel
   classique.

6. **Tests end-to-end automatisés.** La vérification navigateur a été **manuelle**. Un test
   Playwright qui ouvre l'éditeur, sélectionne deux contours et clique sur _Union_ aurait évité la
   découverte manuelle du bug 3. Non fait : l'infrastructure de tests E2E n'existe pas dans ce fork.

### Résiduel

7. **Copie de test non supprimée.** `%TEMP%\fontra-verify` (3 fichiers) est toujours sur le disque :
   la corbeille du runtime refuse les suppressions hors du workspace, et aucun contournement n'a été
   utilisé. Suppression manuelle possible par l'utilisateur.

---

## 8. Artefact Windows et commit

### 8.1 Build

Commande :

```powershell
$env:PATH="<repo>\venv\Scripts;$env:PATH"
Set-Location "<repo>\fontra-pak"
& "<repo>\venv\Scripts\python.exe" build-timestamped.py
```

`venv\Scripts` **doit** être sur le PATH, sinon les sous-processus `sr-aef` et `ttx` échouent en
`FileNotFoundError` (ce qui casse aussi `test-py/test_backends_opentype.py`).

Déroulé du script :

1. `pip install -r requirements.txt`
2. `pip install -r requirements-dev.txt`
3. `pip install -e ..` (régénère `src/fontra/_version.py` via vcs-versioning)
4. `npm install` (cwd = racine du repo)
5. `npm run bundle` (cwd = racine du repo) → régénère `src/fontra/client/**`
6. estampillage de `src/fontra/_version.py` → `YYYY.MM.DD.HH` (Europe/Paris)
7. vérification que `fontra.__version__` correspond bien à la version estampée
8. `PyInstaller FontraPak.spec --clean`
9. copie dans `dist/Fontra-Pak-v{VERSION}/Fontra Pak.exe`

> **Ordre imposé par le fork :** _bundle d'abord, commit ensuite, ne plus re-bundler après le commit_.
> Le bundle webpack n'est pas reproductible bit-à-bit : deux builds du même code source produisent
> des hashes de chunks différents. Re-bundler après le commit ferait diverger le bundle du repo et
> l'exe embarqué.

**Résultat du build (12/11/2026, avec le correctif « points ») :**

|                                           |                                                            |
| ----------------------------------------- | ---------------------------------------------------------- |
| Version estampée                          | `2026.11.12.08`                                            |
| Exe                                       | `fontra-pak/dist/Fontra-Pak-v2026.11.12.08/Fontra Pak.exe` |
| Taille                                    | 73 714 455 octets (70,3 Mo)                                |
| `FileVersion` / `ProductVersion` de l'exe | `2026.11.12.08` ✅                                         |
| `test-export.py`                          | **Passed: 7, Failed: 0** ✅                                |
| Log                                       | `fontra-pak/build-2026-11-12.log`                          |

Bundle régénéré (nouveaux hashes) :

```
fontra-core.ecda7167.js  →  fontra-core.99a2c5a0.js
start.1.496c6888.js      →  start.1.496c6888.js   (inchangé)
start.2.69661c6d.js      →  start.2.2b1a0753.js
start.3.1838fca4.js      →  start.3.dbb08782.js
start.4.8d0ead14.js      →  start.4.8d0ead14.js   (inchangé)
start.a28ba457.js        →  start.a28ba457.js     (inchangé)
views-editor.93eaa9d9.js →  views-editor.d64f4dd9.js
```

Cette fois `views-editor` **change** de hash : c'est le signe attendu, puisque le correctif du
bug 4 vit dans ce module. `fontra-core` change aussi, puisque `getExplicitPointTargets()` y est
exportée.

#### Cohérence exe ↔ bundle commité

Vérification sans lancer l'application, en lisant le TOC de PyInstaller
(`fontra-pak/build/FontraPak/PKG-00.toc`), qui liste les fichiers client réellement embarqués :

```
fontra\client\editor.html
fontra\client\js\fontra-core.99a2c5a0.js
fontra\client\js\views-editor.d64f4dd9.js
fontra\client\lang\en.js
```

Ces noms correspondent exactement aux fichiers de `src/fontra/client/**` dans l'arbre de travail.

#### Le correctif est bien dans le bundle

Vérifié dans le bundle minifié lui-même :

- `fontra-core.99a2c5a0.js` contient `getExplicitPointTargets()`, minifiée en `a` :
  `o.set(e,{x:Math.round(s.x+n.x),y:Math.round(s.y+n.y)})` ;
- `views-editor.d64f4dd9.js` contient la structure corrigée de `moveObjects()` : les changements de
  tous les objets sont **poussés dans un tableau** (`b.push({editChange:i,rollbackChange:s})`), puis
  **appliqués dans une seconde boucle**, et enfin les cibles des points explicitement sélectionnés
  sont **écrites en dernier** via `{f:"=xy",a:[t,n,o]}`.

#### Note sur `src/fontra/client/lang/en.js`

Le fichier client est produit par `CopyPlugin` **puis minifié par Terser**. Le reformattage
d'indentation appliqué à la source `src-js/fontra-core/assets/lang/en.js` par Prettier ne change donc
rien au résultat : les deux versions ont été comparées **clé par clé** (670 clés, **0 différence de
valeur**, clé `menu.selection-transformations.points` présente dans les deux). Le churn de
reformatage a donc été **retiré de la source** avant le commit, sans invalider le bundle ni l'exe.

### 8.2 Commit

Le commit contient :

- le **correctif du bug 4** (`moveObjects()` : calcul avant application + cibles explicites
  écrites en dernier) et la nouvelle fonction pure `getExplicitPointTargets()` ;
- les **tests de régression** (`src-js/views-editor/tests/`) et l'infra de test qui les héberge ;
- la clé de langue `menu.selection-transformations.points` ;
- le bundle client régénéré (`src/fontra/client/**`, hashes mis à jour) ;
- la version estampée `src/fontra/_version.py` → `2026.11.12.08` (ce fichier **est** suivi par git
  dans ce fork, contrairement à ce que dit son en-tête généré) ;
- ce rapport.

`package-lock.json` est modifié : il enregistre les `devDependencies` (`chai`, `mocha`) ajoutées à
`src-js/views-editor/package.json` pour l'infra de test.

`fontra-pak/` est un **sous-module** git : le log de build et le dossier `dist/` y vivent, ils ne
font pas partie du commit du repo principal. **L'exe n'est pas versionné** — il se distribue par le
dossier `dist/Fontra-Pak-v{VERSION}/`.

---

## 9. Annexes

### Fichiers ajoutés

| Fichier                                                       | Contenu                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `src-js/fontra-core/src/selection-transformations.js`         | logique pure (168 lignes)                                       |
| `src-js/fontra-core/tests/test-selection-transformations.js`  | 21 tests mocha                                                  |
| `src-js/views-editor/src/selection-transformations.js`        | module partagé éditeur (792 lignes)                             |
| `src-js/views-editor/tests/test-selection-transformations.js` | **itération 2** — 5 tests de régression « points » (194 lignes) |
| `src-js/views-editor/package.json`                            | **itération 2** — script `npm test` + devDeps `chai` / `mocha`  |
| `CONTEXT_MENU_TRANSFORMATIONS_REPORT.md`                      | ce rapport                                                      |

### Fichiers modifiés

| Fichier                                                      | Modification                                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `src-js/views-editor/src/editor.js`                          | enregistrement des actions + insertion du groupe de menu                                                       |
| `src-js/views-editor/src/panel-transformation.js`            | réécrit en fine couche UI (1093 → 561 lignes)                                                                  |
| `src-js/views-editor/src/scene-controller.js`                | `updateContextMenuState()` corrigé + helper `_clickedItemIsInSelectedContour()`                                |
| `src-js/views-editor/src/edit-tools-pointer.js`              | import `getPinPoint` re-pointé                                                                                 |
| `src-js/fontra-webcomponents/src/menu-panel.js`              | icônes opt-in par item                                                                                         |
| `src-js/fontra-core/src/selection-transformations.js`        | **itération 2** — option `pointLevel` + nouvelle fonction pure `getExplicitPointTargets()`                     |
| `src-js/fontra-core/tests/test-selection-transformations.js` | **itération 2** — 6 tests ajoutés (3 `pointLevel`, 3 `getExplicitPointTargets`)                                |
| `src-js/views-editor/src/selection-transformations.js`       | **itération 2** — 8 actions « (points) », correctif `moveObjects()`, descripteurs exportés, `getPointsLabel()` |
| `src-js/fontra-core/assets/lang/en.js`                       | 7 clés de menu + **itération 2** : clé `menu.selection-transformations.points`                                 |
| `package-lock.json`                                          | **itération 2** — `devDependencies` de `views-editor`                                                          |
| `src/fontra/_version.py`                                     | version estampée (`2026.11.12.08`)                                                                             |
| `src/fontra/client/**`                                       | bundle régénéré                                                                                                |

### Commandes utiles

```powershell
# tests du nouveau module
& "<repo>\node_modules\.bin\mocha.cmd" tests/test-selection-transformations.js --reporter spec

# suite complète fontra-core
& "<repo>\node_modules\.bin\mocha.cmd" tests --extension js --extension ts --reporter dot

# formatage
& "<repo>\node_modules\.bin\prettier.cmd" --write <fichiers>

# bundle client
Set-Location "<repo>"; npm run bundle

# serveur de dev (le sous-commande "filesystem" est obligatoire)
& "<repo>\venv\Scripts\fontra.exe" --http-port 8123 filesystem "D:\DESIGN"
```
