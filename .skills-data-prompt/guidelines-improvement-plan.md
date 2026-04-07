# Guidelines Feature — Plan d'amélioration complet

> **Date** : 2026-04-04
> **Statut** : Plan d'implémentation
> **Périmètre** : Fontra glyph editor — `src-js/views-editor/`
> **Comparaison** : RoboFont, Glyphs.app, FontForge

---

## 1. Audit de l'existant

### 1.1 Fichiers concernés

| Fichier | Rôle | Lignes clés |
|---------|------|-------------|
| `src/fontra/core/classes.py` | Dataclass `Guideline` | 116-122 |
| `src/fontra/backends/designspace.py` | Sérialisation UFO | 2274, 2362 |
| `src/fontra/core/instancer.py` | Interpolation guidelines | 708, 948-960 |
| `src-js/views-editor/src/visualization-layer-definitions.js` | Rendu canvas | 519-760, 1837-1885 |
| `src-js/views-editor/src/scene-model.js` | Sélection | 841-871 |
| `src-js/views-editor/src/editor.js` | CRUD, dialogs, context menu | 1336-1403, 2499-2650 |
| `src-js/views-editor/src/edit-behavior.js` | Drag & drop | 436-541, 627-636 |
| `src-js/views-editor/src/edit-tools-pointer.js` | Double-clic | 291-298 |
| `src-js/views-fontinfo/src/panel-sources.js` | Font-level UI | 816, 939 |
| `src-js/fontra-core/src/classes.json` | Schema JSON | Guideline type |

### 1.2 TODOs existants dans le code

```
editor.js:2523        // TODO: Font Guidelines locking
editor.js:2567        // TODO: Font Guidelines (ajout via canvas)
scene-model.js:873    // TODO: Font Guidelines fontGuidelineSelectionAtPoint()
visualization-layer-definitions.js:677  // TODO: Font Guidelines (rendering selected)
editor.js:2530        // TODO: code unifié anchors + guidelines
```

### 1.3 Ce qui fonctionne déjà

- ✅ Dataclass complète (name, x, y, angle, locked, customData)
- ✅ Glyph-level guidelines : CRUD complet
- ✅ Rendu visuel avec pointillés, marqueur, lock, nom
- ✅ Drag & drop (x, y, angle)
- ✅ Double-clic → dialog d'édition
- ✅ Menu contextuel (add, add-between-points, lock)
- ✅ Copy/paste/delete
- ✅ Font-level guidelines : lecture + interpolation
- ✅ Font-level guidelines : édition dans Font Info panel
- ✅ Compatibility UFO (RoboFont locked state)
- ✅ Line metrics (ascender, descender, x-height, cap-height)
- ✅ Overshoot zones visualization

### 1.4 Ce qui manque (vs RoboFont / Glyphs)

| Fonctionnalité | RoboFont | Glyphs | Fontra |
|---|---|---|---|
| Font guidelines éditables dans le canvas | ✅ | ✅ | ❌ |
| Lock font guidelines dans le canvas | ✅ | ✅ | ❌ |
| Snap de points aux guidelines | ✅ | ✅ | ❌ |
| Création par drag depuis les bords | ✅ | ✅ | ❌ |
| Contraintes d'angle (Shift = 0°/45°/90°) | ✅ | ✅ | ❌ |
| Couleurs personnalisables par guideline | ✅ | ✅ | ❌ |
| Sélection multiple de guidelines | ✅ | ✅ | ❌ |
| Distance affichée pendant le drag | ✅ | ✅ | ❌ |
| Smart guides temporaires | Partiel | ✅ | ❌ |
| Mesure entre 2 guidelines parallèles | ✅ | ✅ | ❌ |
| Guidelines magnétiques (auto-align) | ❌ | ✅ | ❌ |
| Raccourcis clavier dédiés | ✅ | ✅ | ❌ |

---

## 2. Phases d'implémentation

### Phase 1 — Compléter les TODOs existants (P0)

**Objectif** : Rendre les font-level guidelines pleinement fonctionnelles dans le canvas.

#### 1.1 Sélection de font guidelines dans le canvas

**Fichier** : `src-js/views-editor/src/scene-model.js`

Ajouter `fontGuidelineSelectionAtPoint()` (actuellement commenté ligne 873-875) :

```javascript
fontGuidelineSelectionAtPoint(point, size, parsedCurrentSelection) {
  if (!this.visualizationLayersSettings.model["fontra.guidelines"]) {
    return new Set();
  }
  if (!this.fontSourceInstance) return new Set();
  const guidelines = this.fontSourceInstance.guidelines;
  const indices = parsedCurrentSelection
    ? parsedCurrentSelection.fontGuideline || []
    : [...range(guidelines.length)];
  for (const i of reversed(indices)) {
    const guideline = guidelines[i];
    if (!guideline) continue;
    const angle = (guideline.angle * Math.PI) / 180;
    const distance = Math.abs(
      Math.cos(angle) * (guideline.y - point.y) - Math.sin(angle) * (guideline.x - point.x)
    );
    if (distance < size / 2) {
      return new Set([`fontGuideline/${i}`]);
    }
  }
  return new Set();
}
```

**Intégration** : Modifier `selectionAtPoint()` pour appeler cette méthode en fallback quand aucun glyph guideline n'est touché.

#### 1.2 Rendu des font guidelines sélectionnées

**Fichier** : `src-js/views-editor/src/visualization-layer-definitions.js` ligne 677

Remplacer `// TODO: Font Guidelines` par le rendu des font guidelines sélectionnées :

```javascript
// Font Guidelines — selected/hovered
if (model.fontSourceInstance) {
  const fontGuidelines = model.fontSourceInstance.guidelines;

  // Under layer
  context.fillStyle = parameters.underColor;
  for (const i of selectedFontGuidelineIndices || []) {
    const guideline = fontGuidelines[i];
    if (!guideline) continue;
    if (guideline.locked) {
      _drawLockIcon(context, guideline.x - parameters.iconSize / 2,
        guideline.y + parameters.iconSize / 2, parameters.strokeColor, parameters.iconSize);
    } else {
      fillRoundNode(context, guideline, smoothSize + parameters.underlayOffset);
    }
  }

  // Hovered
  context.strokeStyle = parameters.hoveredColor;
  for (const i of hoveredFontGuidelineIndices || []) {
    const guideline = fontGuidelines[i];
    if (!guideline) continue;
    if (guideline.locked) {
      _drawLockIcon(context, guideline.x - parameters.iconSize / 2,
        guideline.y + parameters.iconSize / 2, parameters.hoveredColorIcon, parameters.iconSize);
    } else {
      strokeRoundNode(context, guideline, smoothSize + parameters.hoverStrokeOffset);
    }
  }

  // Selected
  context.fillStyle = parameters.selectedColor;
  for (const i of selectedFontGuidelineIndices || []) {
    const guideline = fontGuidelines[i];
    if (!guideline) continue;
    if (guideline.locked) {
      _drawLockIcon(context, guideline.x - parameters.iconSize / 2,
        guideline.y + parameters.iconSize / 2, parameters.selectedColor, parameters.iconSize);
    } else {
      fillRoundNode(context, guideline, smoothSize);
    }
  }
}
```

#### 1.3 Lock des font guidelines

**Fichier** : `src-js/views-editor/src/editor.js` ligne 2523

Décommenter et implémenter le bloc de locking :

```javascript
async doLockGuideline(locking = false) {
  const {
    guideline: guidelineSelection,
    fontGuideline: fontGuidelineSelection,
  } = parseSelection(this.sceneController.selection);

  // Lock glyph guidelines
  if (guidelineSelection) {
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        for (const guidelineIndex of guidelineSelection) {
          const guideline = layerGlyph.guidelines[guidelineIndex];
          if (!guideline) continue;
          guideline.locked = locking;
        }
      }
      return translatePlural(
        locking ? "action.unlock-guideline" : "action.lock-guideline",
        guidelineSelection.length
      );
    });
  }

  // Lock font guidelines
  if (fontGuidelineSelection) {
    const fontSource = this.sceneController.sceneModel.fontSourceInstance;
    if (!fontSource) return;
    await this.sceneController.editDocumentAndRecordChanges(async (font) => {
      const source = await font.getSource(fontSource.identifier);
      if (!source) return;
      for (const i of fontGuidelineSelection) {
        if (source.guidelines[i]) {
          source.guidelines[i].locked = locking;
        }
      }
      return translatePlural(
        locking ? "action.unlock-guideline" : "action.lock-guideline",
        fontGuidelineSelection.length
      );
    });
  }
}
```

#### 1.4 Ajout de font guidelines via le canvas

**Fichier** : `src-js/views-editor/src/editor.js` ligne 2567

Compléter `doAddGuideline(global = true)` :

```javascript
if (global) {
  const fontSource = this.sceneController.sceneModel.fontSourceInstance;
  if (!fontSource) return;
  await this.sceneController.editDocumentAndRecordChanges(async (font) => {
    const source = await font.getSource(fontSource.identifier);
    if (!source) return;
    if (!source.guidelines) source.guidelines = [];
    source.guidelines.push({ ...newGuideline });
    return translate("action.add-guideline");
  });
}
```

#### 1.5 Drag des font guidelines

**Fichier** : `src-js/views-editor/src/edit-behavior.js`

- Ajouter `unpackFontGuidelines()` (symétrique de `unpackGuidelines()`)
- Ajouter `makeFontGuidelineEditFunc()` dans `EditBehaviorFactory`
- Modifier `makeGuidelineChange()` pour supporter le préfixe `fontGuideline/`

**Fichier** : `src-js/views-editor/src/scene-controller.js`

Ajouter l'edit behavior pour font guidelines dans la factory, en modifiant la méthode qui construit les edit functions pour inclure les `fontGuideline` selections.

---

### Phase 2 — Snapping aux guidelines (P1)

**Objectif** : Quand un point est proche d'une guideline, il se snap dessus automatiquement.

#### 2.1 Module de snapping

**Nouveau fichier** : `src-js/views-editor/src/guideline-snapping.js`

```javascript
export class GuidelineSnappingEngine {
  constructor(sceneController) {
    this.sceneController = sceneController;
    this.enabled = true;
    this.snapDistance = 5; // pixels
    this.activeGuideline = null;
    this.snapOffset = null;
  }

  getActiveGuidelines() {
    const model = this.sceneController.sceneModel;
    const positionedGlyph = model.getSelectedPositionedGlyph();
    if (!positionedGlyph) return [];
    const guidelines = [...(positionedGlyph.glyph.guidelines || [])];
    if (model.fontSourceInstance) {
      guidelines.push(...(model.fontSourceInstance.guidelines || []));
    }
    return guidelines.filter(g => !g.locked);
  }

  snapPoint(point, currentSelection) {
    if (!this.enabled) return { point, guideline: null };

    const guidelines = this.getActiveGuidelines();
    const viewPort = this.sceneController.getViewBox();
    const snapPx = this.snapDistance;
    const worldSnapDist = snapPx / this.sceneController.canvasController.pixelRatio;

    let bestDist = Infinity;
    let bestSnapped = null;
    let bestGuideline = null;

    for (const guideline of guidelines) {
      const angle = (guideline.angle * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Project point onto guideline line
      const dx = point.x - guideline.x;
      const dy = point.y - guideline.y;
      const projDist = dx * cos + dy * sin;

      const snappedX = guideline.x + projDist * cos;
      const snappedY = guideline.y + projDist * sin;

      const dist = Math.sqrt((point.x - snappedX) ** 2 + (point.y - snappedY) ** 2);

      if (dist < bestDist && dist < worldSnapDist) {
        bestDist = dist;
        bestSnapped = { x: snappedX, y: snappedY };
        bestGuideline = guideline;
      }
    }

    if (bestSnapped) {
      this.activeGuideline = bestGuideline;
      this.snapOffset = {
        x: bestSnapped.x - point.x,
        y: bestSnapped.y - point.y,
      };
      return { point: bestSnapped, guideline: bestGuideline };
    }

    this.activeGuideline = null;
    this.snapOffset = null;
    return { point, guideline: null };
  }

  reset() {
    this.activeGuideline = null;
    this.snapOffset = null;
  }
}
```

#### 2.2 Intégration dans le drag de points

**Fichier** : `src-js/views-editor/src/edit-behavior.js`

Modifier `makePointEditFunc()` pour intégrer le snapping :

```javascript
// Dans la fonction d'édition de point, avant d'appliquer la position :
const snapped = snappingEngine.snapPoint(rawPoint, currentSelection);
const finalPoint = snapped.point;
if (snapped.guideline) {
  // Afficher un indicateur visuel de snap
  this.sceneController.canvasController.requestUpdate();
}
```

#### 2.3 Indicateur visuel de snap

**Fichier** : `src-js/views-editor/src/visualization-layer-definitions.js`

Ajouter une couche `fontra.snap-indicators` :

```javascript
registerVisualizationLayerDefinition({
  identifier: "fontra.snap-indicators",
  name: "Guideline snap indicators",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: false,
  zIndex: 700,
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const snappingEngine = controller.snappingEngine;
    if (!snappingEngine || !snappingEngine.activeGuideline) return;

    const guideline = snappingEngine.activeGuideline;
    const offset = snappingEngine.snapOffset;

    // Draw dashed connection line from original to snapped position
    context.save();
    context.strokeStyle = "#FF6B35";
    context.lineWidth = 1;
    context.setLineDash([3, 3]);

    const origX = /* point original */;
    const origY = /* point original */;
    const snapX = origX + offset.x;
    const snapY = origY + offset.y;

    context.beginPath();
    context.moveTo(origX, origY);
    context.lineTo(snapX, snapY);
    context.stroke();

    // Draw small circle at snap point
    context.fillStyle = "#FF6B35";
    context.beginPath();
    context.arc(snapX, snapY, 3, 0, Math.PI * 2);
    context.fill();

    // Draw guideline name
    if (guideline.name) {
      context.font = "10px fontra-ui-regular";
      context.fillStyle = "#FF6B35";
      context.fillText(guideline.name, snapX + 8, snapY - 8);
    }

    context.restore();
  },
});
```

#### 2.4 Toggle snapping dans les settings

**Fichier** : `src-js/views-editor/src/editor.js` ou settings panel

Ajouter un toggle "Snap to guidelines" dans les préférences utilisateur, avec la touche `S` comme raccourci.

---

### Phase 3 — Création par drag depuis les bords (P1)

**Objectif** : Permettre de créer une guideline en tirant depuis le bord du canvas, comme RoboFont.

#### 3.1 Détection du drag depuis les bords

**Fichier** : `src-js/views-editor/src/edit-tools-pointer.js`

Ajouter la logique de détection dans `handleDrag()` :

```javascript
// Dans handleDrag, avant la logique normale :
const RULER_MARGIN = 20; // pixels depuis le bord
const localPoint = this.sceneController.localPoint(event);
const viewBox = this.sceneController.getViewBox();

const isNearLeftEdge = localPoint.x < RULER_MARGIN;
const isNearTopEdge = localPoint.y > (viewBox[3] - RULER_MARGIN); // Y inversé en canvas

if (isNearLeftEdge || isNearTopEdge) {
  // Créer une guideline temporaire et suivre la souris
  await this.handleGuidelineCreationDrag(eventStream, initialEvent, isNearLeftEdge);
  return;
}
```

#### 3.2 Drag de création de guideline

**Nouvelle méthode** dans `edit-tools-pointer.js` :

```javascript
async handleGuidelineCreationDrag(eventStream, initialEvent, isHorizontal) {
  const sceneController = this.sceneController;
  const startPoint = sceneController.localPoint(initialEvent);

  // Guideline initiale
  const tempGuideline = {
    x: isHorizontal ? 0 : Math.round(startPoint.x),
    y: isHorizontal ? Math.round(startPoint.y) : 0,
    angle: isHorizontal ? 0 : 90,
    name: null,
    locked: false,
  };

  // Afficher la guideline temporaire pendant le drag
  for await (const event of eventStream) {
    const currentPoint = sceneController.localPoint(event);

    if (isHorizontal) {
      tempGuideline.y = Math.round(currentPoint.y);
      tempGuideline.angle = 0;
    } else {
      tempGuideline.x = Math.round(currentPoint.x);
      tempGuideline.angle = 90;
    }

    // Mettre à jour le display de la guideline temporaire
    sceneController.temporaryGuideline = tempGuideline;
    sceneController.canvasController.requestUpdate();
  }

  // Au relâchement, créer la guideline
  if (tempGuideline) {
    await sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        layerGlyph.guidelines.push({ ...tempGuideline });
      }
      return translate("action.add-guideline");
    });
    sceneController.temporaryGuideline = null;
  }
}
```

#### 3.3 Rendu de la guideline temporaire

**Fichier** : `src-js/views-editor/src/visualization-layer-definitions.js`

Ajouter une couche `fontra.temporary-guideline` :

```javascript
registerVisualizationLayerDefinition({
  identifier: "fontra.temporary-guideline",
  name: "Temporary guideline (drag creation)",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: false,
  zIndex: 600,
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const tempGuideline = controller.temporaryGuideline;
    if (!tempGuideline) return;

    context.save();
    context.strokeStyle = "#FF6B3580";
    context.lineWidth = 2;
    context.setLineDash([6, 4]);

    context.translate(tempGuideline.x, tempGuideline.y);
    context.rotate((tempGuideline.angle * Math.PI) / 180);

    const length = 3000;
    context.beginPath();
    context.moveTo(-length, 0);
    context.lineTo(length, 0);
    context.stroke();

    // Afficher la valeur
    const value = tempGuideline.angle === 0
      ? `y = ${tempGuideline.y}`
      : `x = ${tempGuideline.x}`;
    context.font = "12px fontra-ui-regular";
    context.fillStyle = "#FF6B35";
    context.fillText(value, 10, -10);

    context.restore();
  },
});
```

---

### Phase 4 — Contraintes d'angle et couleurs (P1)

#### 4.1 Contraintes d'angle avec Shift

**Fichier** : `src-js/views-editor/src/edit-behavior.js`

Modifier `makeGuidelineEditFunc()` pour supporter les contraintes :

```javascript
function makeGuidelineEditFunc(guideline, guidelineIndex, roundFunc, constrainAngle = false) {
  const SNAP_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
  const SNAP_THRESHOLD = 5; // degrés

  const oldGuideline = { ...guideline };
  return [
    (transform) => {
      const editedGuideline = transform.constrained(oldGuideline);

      let finalAngle = editedGuideline.angle;
      if (constrainAngle) {
        // Snap to nearest standard angle
        let minDist = SNAP_THRESHOLD;
        for (const snapAngle of SNAP_ANGLES) {
          const dist = Math.abs(((finalAngle - snapAngle + 180) % 360) - 180);
          if (dist < minDist) {
            minDist = dist;
            finalAngle = snapAngle;
          }
        }
      }

      return makeGuidelineChange(
        guidelineIndex,
        editedGuideline.x,
        editedGuideline.y,
        finalAngle,
        roundFunc
      );
    },
    makeGuidelineChange(guidelineIndex, oldGuideline.x, oldGuideline.y, oldGuideline.angle, roundFunc),
  ];
}
```

**Fichier** : `src-js/views-editor/src/edit-tools-pointer.js`

Passer `constrainAngle` basé sur l'état de la touche Shift :

```javascript
const constrainAngle = event.shiftKey;
const [editFunc, rollbackChange] = makeGuidelineEditFunc(
  guideline, guidelineIndex, roundFunc, constrainAngle
);
```

#### 4.2 Couleurs personnalisables par guideline

**Fichier** : `src/fontra/core/classes.py`

Ajouter le champ `color` à la dataclass :

```python
@dataclass(kw_only=True)
class Guideline:
    name: Optional[str] = None
    x: float = 0
    y: float = 0
    angle: float = 0
    locked: bool = False
    color: Optional[str] = None  # Hex color, e.g. "#FF6B35"
    customData: CustomData = field(default_factory=dict)
```

**Fichier** : `src-js/fontra-core/src/classes.json`

Ajouter `"color": {"type": "str", "optional": true}` au type Guideline.

**Fichier** : `src-js/views-editor/src/visualization-layer-definitions.js`

Modifier `_drawGuideline()` pour utiliser la couleur personnalisée :

```javascript
function _drawGuideline(context, parameters, guideline, defaultStrokeColor) {
  const strokeColor = guideline.color || defaultStrokeColor;
  // ... reste du code existant avec strokeColor
}
```

**Fichier** : `src-js/views-editor/src/editor.js`

Ajouter un sélecteur de couleur dans le dialog `doAddEditGuidelineDialog()` :

```javascript
// Dans la construction du dialog, ajouter :
{
  type: "color",
  id: "guidelineColor",
  label: translate("dialog.guideline.color"),
  value: guideline?.color || null,
}
```

---

### Phase 5 — Sélection multiple (P2)

#### 5.1 Sélection Shift+click

**Fichier** : `src-js/views-editor/src/scene-model.js`

Modifier `guidelineSelectionAtPoint()` pour supporter l'ajout à la sélection :

```javascript
guidelineSelectionAtPoint(point, size, parsedCurrentSelection, addToSelection = false) {
  // ... logique existante pour trouver la guideline ...
  if (addToSelection && parsedCurrentSelection?.guideline) {
    const current = new Set(parsedCurrentSelection.guideline.map(i => `guideline/${i}`));
    if (current.has(`guideline/${i}`)) {
      current.delete(`guideline/${i}`); // toggle off
    } else {
      current.add(`guideline/${i}`);
    }
    return current;
  }
  return new Set([`guideline/${i}`]);
}
```

#### 5.2 Sélection par rectangle

**Fichier** : `src-js/views-editor/src/edit-tools-pointer.js`

Dans `handleRectSelect()`, ajouter la détection de guidelines dans le rectangle :

```javascript
// Après la détection de points dans le rectangle :
const guidelineIndices = [];
for (let i = 0; i < glyph.guidelines.length; i++) {
  const g = glyph.guidelines[i];
  // Vérifier si le point d'origine de la guideline est dans le rectangle
  if (g.x >= selRect.xMin && g.x <= selRect.xMax &&
      g.y >= selRect.yMin && g.y <= selRect.yMax) {
    guidelineIndices.push(i);
  }
}
if (guidelineIndices.length) {
  for (const i of guidelineIndices) {
    newSelection.add(`guideline/${i}`);
  }
}
```

---

### Phase 6 — Affichage de distance en temps réel (P2)

#### 6.1 Distance pendant le drag

**Fichier** : `src-js/views-editor/src/visualization-layer-definitions.js`

Ajouter à la couche `fontra.coordinates` (ligne ~1320) l'affichage de distance pour les guidelines en mouvement :

```javascript
// Dans la couche fontra.coordinates, après le rendu des coordonnées de points :
const activeGuideline = controller.snappingEngine?.activeGuideline;
if (activeGuideline) {
  const offset = controller.snappingEngine.snapOffset;
  const distance = Math.sqrt(offset.x ** 2 + offset.y ** 2).toFixed(1);

  context.save();
  context.font = "11px fontra-ui-regular";
  context.fillStyle = "#FF6B35";
  context.textAlign = "left";

  const labelX = activeGuideline.x + 15;
  const labelY = activeGuideline.y - 20;
  context.fillText(`Δ ${distance}`, labelX, labelY);
  context.restore();
}
```

#### 6.2 Mesure entre deux guidelines parallèles

**Nouveau fichier** : `src-js/views-editor/src/guideline-measurement.js`

```javascript
export function measureParallelGuidelines(guidelines) {
  const measurements = [];
  for (let i = 0; i < guidelines.length; i++) {
    for (let j = i + 1; j < guidelines.length; j++) {
      const a = guidelines[i];
      const b = guidelines[j];

      // Vérifier si parallèles (mêmes angles)
      const angleDiff = Math.abs(((a.angle - b.angle + 180) % 360) - 180);
      if (angleDiff < 0.1 || angleDiff > 179.9) {
        // Distance perpendiculaire
        const angle = (a.angle * Math.PI) / 180;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.abs(Math.cos(angle) * dy - Math.sin(angle) * dx);

        measurements.push({
          guidelineA: i,
          guidelineB: j,
          distance: Math.round(distance * 100) / 100,
          nameA: a.name || `#${i}`,
          nameB: b.name || `#${j}`,
        });
      }
    }
  }
  return measurements;
}
```

Intégrer l'affichage dans une couche `fontra.guideline-measurements` activable dans les settings.

---

### Phase 7 — Smart guides temporaires (P3)

**Objectif** : Guidelines éphémères qui apparaissent quand des points s'alignent.

#### 7.1 Détection d'alignement

**Nouveau fichier** : `src-js/views-editor/src/smart-guides.js`

```javascript
export class SmartGuidesEngine {
  constructor(sceneController) {
    this.sceneController = sceneController;
    this.enabled = true;
    this.tolerance = 3; // pixels
    this.activeGuides = [];
  }

  detectAlignment(point, allPoints, existingGuidelines) {
    if (!this.enabled) return [];
    const guides = [];
    const tol = this.tolerance / this.sceneController.canvasController.pixelRatio;

    // Horizontal alignment
    for (const other of allPoints) {
      if (other === point) continue;
      if (Math.abs(point.y - other.y) < tol) {
        guides.push({
          type: "horizontal",
          value: other.y,
          snapped: { x: point.x, y: other.y },
          label: `y = ${Math.round(other.y)}`,
        });
      }
    }

    // Vertical alignment
    for (const other of allPoints) {
      if (other === point) continue;
      if (Math.abs(point.x - other.x) < tol) {
        guides.push({
          type: "vertical",
          value: other.x,
          snapped: { x: other.x, y: point.y },
          label: `x = ${Math.round(other.x)}`,
        });
      }
    }

    // Alignment with existing guidelines
    for (const guideline of existingGuidelines) {
      const angle = (guideline.angle * Math.PI) / 180;
      const dist = Math.abs(
        Math.cos(angle) * (guideline.y - point.y) - Math.sin(angle) * (guideline.x - point.x)
      );
      if (dist < tol) {
        guides.push({
          type: "guideline",
          guideline: guideline,
          snapped: this._projectOnGuideline(point, guideline),
          label: guideline.name || guideline.type,
        });
      }
    }

    return guides;
  }

  _projectOnGuideline(point, guideline) {
    const angle = (guideline.angle * Math.PI) / 180;
    const dx = point.x - guideline.x;
    const dy = point.y - guideline.y;
    const projDist = dx * Math.cos(angle) + dy * Math.sin(angle);
    return {
      x: guideline.x + projDist * Math.cos(angle),
      y: guideline.y + projDist * Math.sin(angle),
    };
  }
}
```

#### 7.2 Rendu des smart guides

**Fichier** : `src-js/views-editor/src/visualization-layer-definitions.js`

```javascript
registerVisualizationLayerDefinition({
  identifier: "fontra.smart-guides",
  name: "Smart alignment guides",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 650,
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const engine = controller.smartGuidesEngine;
    if (!engine || engine.activeGuides.length === 0) return;

    context.save();
    context.strokeStyle = "#FF3333";
    context.lineWidth = 1;
    context.setLineDash([4, 4]);

    for (const guide of engine.activeGuides) {
      context.beginPath();
      if (guide.type === "horizontal") {
        context.moveTo(0, guide.value);
        context.lineTo(positionedGlyph.glyph.xAdvance || 1000, guide.value);
      } else if (guide.type === "vertical") {
        context.moveTo(guide.value, -500);
        context.lineTo(guide.value, 1000);
      } else if (guide.type === "guideline") {
        const g = guide.guideline;
        context.translate(g.x, g.y);
        context.rotate((g.angle * Math.PI) / 180);
        context.moveTo(-2000, 0);
        context.lineTo(2000, 0);
      }
      context.stroke();
      context.setTransform(1, 0, 0, 1, 0, 0); // reset

      // Label
      if (guide.label) {
        context.font = "10px fontra-ui-regular";
        context.fillStyle = "#FF3333";
        const lx = guide.snapped?.x + 5 || 10;
        const ly = guide.snapped?.y - 5 || guide.value - 5;
        context.fillText(guide.label, lx, ly);
      }
    }

    context.restore();
  },
});
```

---

### Phase 8 — Raccourcis clavier et UX (P2)

#### 8.1 Raccourcis clavier

**Fichier** : `src-js/views-editor/src/editor.js`

Ajouter dans l'initialisation des raccourcis :

| Raccourci | Action |
|---|---|
| `G` | Toggle visibility des guidelines |
| `Shift+G` | Ajouter guideline à la position de la souris |
| `Alt+G` | Ajouter guideline horizontale (y=0) |
| `Ctrl+Shift+G` | Ajouter guideline verticale (x=0) |
| `S` | Toggle snap to guidelines |
| `Shift` (pendant drag) | Contraindre l'angle à 0°/45°/90° |

```javascript
// Dans setupKeyboardShortcuts() ou équivalent :
this.keyShortcuts = {
  ...this.keyShortcuts,
  "KeyG": (event) => {
    if (!event.shiftKey && !event.ctrlKey && !event.altKey) {
      const settings = this.visualizationLayersSettings;
      settings.model["fontra.guidelines"] = !settings.model["fontra.guidelines"];
      this.canvasController.requestUpdate();
    }
  },
  "KeyS": (event) => {
    if (!event.ctrlKey && !event.shiftKey) {
      const engine = this.sceneController.snappingEngine;
      if (engine) {
        engine.enabled = !engine.enabled;
        // Afficher un toast/notification
      }
    }
  },
};
```

#### 8.2 Code unifié anchors + guidelines

**Fichier** : `src-js/views-editor/src/editor.js` ligne 2530

Créer une classe de base `SceneItemEditor` :

```javascript
class SceneItemEditor {
  constructor(sceneController, itemType) {
    this.sceneController = sceneController;
    this.itemType = itemType; // "anchor" | "guideline"
  }

  async addItem(item, global = false) {
    // Logique commune
  }

  async editItem(item, index) {
    // Logique commune
  }

  async deleteItem(index) {
    // Logique commune
  }
}

class GuidelineEditor extends SceneItemEditor {
  constructor(sceneController) {
    super(sceneController, "guideline");
  }

  async addItem(guideline, global = false) {
    // Implémentation spécifique guidelines
  }
}

class AnchorEditor extends SceneItemEditor {
  constructor(sceneController) {
    super(sceneController, "anchor");
  }
}
```

---

## 3. Ordre d'exécution recommandé

```
Phase 1 (P0) — TODOs existants
├── 1.1 Sélection font guidelines    → 2h
├── 1.2 Rendu font guidelines sel.   → 1h
├── 1.3 Lock font guidelines         → 2h
├── 1.4 Ajout font guidelines canvas → 2h
├── 1.5 Drag font guidelines         → 3h
└── Total Phase 1                    → ~10h

Phase 2 (P1) — Snapping
├── 2.1 GuidelineSnappingEngine      → 3h
├── 2.2 Intégration drag points      → 2h
├── 2.3 Indicateur visuel snap       → 2h
├── 2.4 Toggle settings              → 1h
└── Total Phase 2                    → ~8h

Phase 3 (P1) — Création par drag
├── 3.1 Détection bord canvas        → 2h
├── 3.2 Drag de création             → 3h
├── 3.3 Rendu temporaire             → 1h
└── Total Phase 3                    → ~6h

Phase 4 (P1) — Contraintes + couleurs
├── 4.1 Contraintes d'angle Shift    → 2h
├── 4.2 Champ color dataclass        → 1h
├── 4.3 Rendu couleur custom         → 1h
├── 4.4 Dialog color picker          → 2h
└── Total Phase 4                    → ~6h

Phase 5 (P2) — Sélection multiple
├── 5.1 Shift+click                  → 2h
├── 5.2 Rectangle selection          → 2h
└── Total Phase 5                    → ~4h

Phase 6 (P2) — Mesures
├── 6.1 Distance temps réel          → 2h
├── 6.2 Mesure entre guidelines      → 3h
└── Total Phase 6                    → ~5h

Phase 7 (P3) — Smart guides
├── 7.1 Détection alignement         → 4h
├── 7.2 Rendu smart guides           → 2h
└── Total Phase 7                    → ~6h

Phase 8 (P2) — Raccourcis + refactor
├── 8.1 Raccourcis clavier           → 2h
├── 8.2 Code unifié                  → 4h
└── Total Phase 8                    → ~6h

TOTAL ESTIMÉ : ~51h
```

---

## 4. Tests à ajouter

### 4.1 Tests Python

**Fichier** : `test-py/test_backends_designspace.py`

```python
def test_guideline_color_roundtrip(tmpdir):
    """Test that guideline color is preserved in UFO round-trip."""
    # Créer un glyph avec guideline colorée
    # Écrire en UFO
    # Relire
    # Vérifier que la couleur est préservée

def test_font_guideline_interpolation_with_colors():
    """Test interpolation of font guidelines with different colors."""
    # Vérifier que les couleurs sont interpolées ou conservées
```

### 4.2 Tests JavaScript

**Fichier** : `src-js/views-editor/tests/test-guideline-snapping.js`

```javascript
describe("GuidelineSnappingEngine", () => {
  it("snaps point to horizontal guideline", () => {
    // ...
  });
  it("snaps point to angled guideline", () => {
    // ...
  });
  it("respects snap distance threshold", () => {
    // ...
  });
  it("ignores locked guidelines", () => {
    // ...
  });
});
```

**Fichier** : `src-js/views-editor/tests/test-guideline-measurement.js`

```javascript
describe("measureParallelGuidelines", () => {
  it("measures distance between parallel horizontal guidelines", () => {
    // ...
  });
  it("returns empty for non-parallel guidelines", () => {
    // ...
  });
});
```

---

## 5. Checklist de validation finale

- [ ] Font guidelines sélectionnables dans le canvas
- [ ] Font guidelines draggable dans le canvas
- [ ] Font guidelines lockable dans le canvas
- [ ] Font guidelines ajoutables via le canvas
- [ ] Snapping aux guidelines actif et configurable
- [ ] Indicateur visuel de snap visible
- [ ] Création par drag depuis les bords du canvas
- [ ] Guideline temporaire visible pendant le drag
- [ ] Shift contraint les angles à 0°/45°/90°
- [ ] Couleurs personnalisables par guideline
- [ ] Sélection multiple (Shift+click + rectangle)
- [ ] Distance affichée pendant le drag
- [ ] Mesure entre guidelines parallèles
- [ ] Smart guides détectent les alignements
- [ ] Raccourci G toggle visibility
- [ ] Raccourci S toggle snapping
- [ ] Tests Python passants
- [ ] Tests JS passants
- [ ] Pas de régression sur les tests existants
- [ ] Compatibility UFO vérifiée (round-trip)
- [ ] Documentation mise à jour

---

## 6. Notes techniques

### 6.1 Convention de nommage des selections

Le système de sélection utilise des strings préfixées :

```
guideline/0        → glyph guideline index 0
guideline/1        → glyph guideline index 1
fontGuideline/0    → font guideline index 0
fontGuideline/1    → font guideline index 1
```

La fonction `parseSelection()` dans `selection.js` parse ces strings.

### 6.2 Architecture des couches de visualisation

Chaque couche est enregistrée via `registerVisualizationLayerDefinition()` et a :

- `identifier` : string unique
- `selectionFunc` : filtre de visibilité
- `zIndex` : ordre de rendu
- `draw(context, positionedGlyph, parameters, model, controller)` : fonction de rendu

Le `controller` permet d'accéder à l'état global (snapping engine, smart guides, etc.).

### 6.3 Système de changements

Les modifications sont enregistrées via `editLayersAndRecordChanges()` qui prend une callback recevant toutes les couches du glyph. Pour les font guidelines, utiliser `editDocumentAndRecordChanges()`.

### 6.4 Performance

- Les guidelines sont peu nombreuses (< 50 par glyph typiquement)
- Le snapping est O(n) par point draggué — acceptable
- Les smart guides sont O(n²) sur les points — à optimiser si > 500 points
- Le rendu des guidelines est déjà optimisé avec des lignes uniques

---

## 7. Ressources de référence

- **RoboFont Guidelines** : https://robofont.com/documentation/guides/guidelines/
- **Glyphs Smart Guides** : https://glyphsapp.com/learn/smart-guides
- **UFO Guidelines Spec** : https://unifiedfontobject.org/versions/ufo3/glyphs/glif/#guideline
- **Fontra GitHub** : https://github.com/googlefonts/fontra
