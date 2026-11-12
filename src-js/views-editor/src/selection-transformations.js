import { registerAction } from "@fontra/core/actions.js";
import { Backend } from "@fontra/core/backend-api.js";
import {
  ChangeCollector,
  applyChange,
  consolidateChanges,
} from "@fontra/core/changes.js";
import { translate } from "@fontra/core/localization.js";
import { getSelectionByContour } from "@fontra/core/path-functions.js";
import { rectCenter, rectSize } from "@fontra/core/rectangle.ts";
import { Transform } from "@fontra/core/transform.js";
import {
  mapObjectValuesAsync,
  parseSelection,
  range,
  reversed,
  zip,
} from "@fontra/core/utils.ts";
import { VarPackedPath } from "@fontra/core/var-path.js";
import {
  canAlignOrDistribute as canAlignOrDistributeForPath,
  canDoPathOperation as canDoPathOperationForPath,
  countMovableObjects as countMovableObjectsForPath,
  getExplicitPointTargets,
  getMovableObjectSelections,
  getSelectedContourIndices,
  splitSelection,
} from "@fontra/core/selection-transformations.js";
import { MenuItemDivider } from "@fontra/web-components/menu-panel.js";
import { EditBehaviorFactory } from "./edit-behavior.js";

export { getSelectedContourIndices, splitSelection };

const ACTION_TOPIC = "0070-action-topics.selection-transformations";

// The label of the point-level variants, eg. "Align left (points)". The
// translation may be missing in languages that have not been updated yet, in
// which case we fall back to English.
function getPointsLabel(keyPart) {
  const title = translate(`sidebar.selection-transformation.${keyPart}`);
  const pointsKey = "menu.selection-transformations.points";
  const points = translate(pointsKey);
  return `${title} (${points === pointsKey ? "points" : points})`;
}

export const pathOperations = {
  unionPath: Backend.unionPath.bind(Backend),
  subtractPath: Backend.subtractPath.bind(Backend),
  intersectPath: Backend.intersectPath.bind(Backend),
  excludePath: Backend.excludePath.bind(Backend),
};

// Transformation parameters are shared between the sidebar panel and the
// context menu, so both operate on the same values.
export const transformationParameters = {
  scaleX: 100,
  scaleY: undefined,
  rotation: 0,
  moveX: 0,
  moveY: 0,
  originX: "center",
  originY: "middle",
  originXButton: undefined,
  originYButton: undefined,
  skewX: 0,
  skewY: 0,
  customDistributionSpacing: null,
  dimensionWidth: null,
  dimensionHeight: null,
};

// Return the path of the glyph that is being edited, or null if there is no
// glyph being edited, or if it cannot be edited.
export function getSelectedEditablePath(sceneController) {
  if (!sceneController.sceneSettings.selectedGlyph?.isEditing) {
    return null;
  }
  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();
  if (!positionedGlyph) {
    return null;
  }
  const glyphController = positionedGlyph.glyph;
  if (!glyphController.canEdit) {
    return null;
  }
  return glyphController.path;
}

// Return the objects that can be moved independently, as MovableObject
// instances.
export function getMovableObjects(path, selection, pointLevel = false) {
  return getMovableObjectSelections(path, selection, { pointLevel }).map(
    (objectSelection) => new MovableObject(objectSelection)
  );
}

// The number of objects that can be moved independently. Align and
// distribute need at least two.
export function countMovableObjects(sceneController, pointLevel = false) {
  const path = getSelectedEditablePath(sceneController);
  if (!path) {
    return 0;
  }
  return countMovableObjectsForPath(path, sceneController.selection, { pointLevel });
}

export function canAlignOrDistribute(sceneController, pointLevel = false) {
  return canAlignOrDistributeForPath(
    getSelectedEditablePath(sceneController),
    sceneController.selection,
    { pointLevel }
  );
}

export function canDoPathOperation(sceneController, keyPart) {
  return canDoPathOperationForPath(
    getSelectedEditablePath(sceneController),
    sceneController.selection,
    keyPart
  );
}

export async function moveObjects(
  sceneController,
  fontController,
  moveDescriptor,
  pointLevel = false
) {
  const glyphController =
    await sceneController.sceneModel.getSelectedStaticGlyphController();
  const movableObjects = getMovableObjects(
    glyphController.instance.path,
    sceneController.selection,
    pointLevel
  );
  if (movableObjects.length <= 1) {
    return;
  }

  if (moveDescriptor.compareObjects) {
    // Distributing requires the objects to be sorted along the axis
    movableObjects.sort((a, b) =>
      moveDescriptor.compareObjects(
        a,
        b,
        glyphController,
        fontController.getBackgroundImageBoundsFunc
      )
    );
  }

  const staticGlyphControllers = await sceneController.getStaticGlyphControllers();
  await sceneController.editGlyph((sendIncrementalChange, glyph) => {
    const editLayerGlyphs = sceneController.getEditingLayerFromGlyphLayers(
      glyph.layers
    );

    const editChanges = [];
    const rollbackChanges = [];
    for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
      const changePath = ["layers", layerName, "glyph"];
      const controller = staticGlyphControllers[layerName] || glyphController;

      const boundingBoxes = movableObjects.map((obj) =>
        obj.computeBounds(controller, fontController.getBackgroundImageBoundsFunc)
      );
      const deltas = moveDescriptor.computeDeltasFromBoundingBoxes(
        boundingBoxes,
        transformationParameters.customDistributionSpacing
      );

      // Compute the change of every object *before* applying any of them, so
      // that all objects move relative to the same, unmodified geometry.
      const objectChanges = [];
      const explicitTargets = new Map();
      for (const [delta, movableObject] of zip(deltas, movableObjects)) {
        const [editChange, rollbackChange] = movableObject.makeChangesForDelta(
          delta,
          layerGlyph,
          sceneController
        );
        objectChanges.push({ editChange, rollbackChange });
        if (pointLevel) {
          // Moving an on-curve point also drags the off-curve handles next to
          // it along, so the change of one object can write the position of a
          // point that belongs to another object. Remember where each
          // explicitly selected point must end up.
          for (const [pointIndex, position] of getExplicitPointTargets(
            layerGlyph.path,
            movableObject.selection,
            delta
          )) {
            explicitTargets.set(pointIndex, position);
          }
        }
      }

      for (const { editChange, rollbackChange } of objectChanges) {
        applyChange(layerGlyph, editChange);
        editChanges.push(consolidateChanges(editChange, changePath));
        rollbackChanges.push(consolidateChanges(rollbackChange, changePath));
      }

      if (explicitTargets.size) {
        // Write the explicitly selected points to their target position, so
        // they end up aligned, even if they were dragged along by the move of
        // another object.
        const targetChanges = [];
        for (const [pointIndex, { x, y }] of explicitTargets) {
          targetChanges.push({ f: "=xy", a: [pointIndex, x, y] });
        }
        const targetChange = consolidateChanges(targetChanges, ["path"]);
        applyChange(layerGlyph, targetChange);
        editChanges.push(consolidateChanges(targetChange, changePath));
      }
    }

    const changes = ChangeCollector.fromChanges(
      consolidateChanges(editChanges),
      consolidateChanges(rollbackChanges)
    );

    return {
      changes: changes,
      undoLabel: moveDescriptor.undoLabel,
      broadcast: true,
    };
  });
}

export async function doPathOperations(
  sceneController,
  fontController,
  pathOperationFunc,
  key
) {
  if (!sceneController.sceneSettings.selectedGlyph?.isEditing) {
    return;
  }

  const positionedGlyph = sceneController.sceneModel.getSelectedPositionedGlyph();

  if (!positionedGlyph) {
    return;
  }

  const undoLabel = translate(
    `sidebar.selection-transformation.path-operations.${key}`
  );
  const doUnion = key === "union";
  let { point: pointIndices } = parseSelection(sceneController.selection);
  pointIndices = pointIndices || [];

  if (!pointIndices.length && !doUnion) {
    return;
  }

  const selectedContourIndicesMap = getSelectionByContour(
    positionedGlyph.glyph.path,
    pointIndices
  );
  const selectedContourIndices = [...selectedContourIndicesMap.keys()];

  if (
    !doUnion &&
    selectedContourIndices.length === positionedGlyph.glyph.path.numContours
  ) {
    // All contours are selected and we're not doing remove overlap: this will
    // result in an empty path or in the same path depending on the operator.
    return;
  }

  const isContourSelected =
    pointIndices.length || !doUnion
      ? (i) => selectedContourIndicesMap.has(i)
      : (i) => true;

  const editLayerGlyphs = sceneController.getEditingLayerFromGlyphLayers(
    positionedGlyph.varGlyph.glyph.layers
  );

  if (!positionedGlyph.glyph.layerName) {
    const newLayerName =
      fontController.fontSourcesInstancer.getSourceIdentifierForLocation(
        sceneController.sceneSettings.fontLocationSourceMapped
      );
    if (newLayerName) {
      editLayerGlyphs[newLayerName] = positionedGlyph.glyph.instance;
    }
  }

  const layerPaths = await mapObjectValuesAsync(editLayerGlyphs, async (layerGlyph) => {
    const path = layerGlyph.path;
    const selectedContoursPath = new VarPackedPath();
    const unselectedContoursPath = new VarPackedPath();

    for (const contourIndex of range(path.numContours)) {
      if (isContourSelected(contourIndex)) {
        selectedContoursPath.appendContour(path.getContour(contourIndex));
      } else {
        unselectedContoursPath.appendContour(path.getContour(contourIndex));
      }
    }
    if (doUnion) {
      return await pathOperationFunc(selectedContoursPath);
    } else {
      return await pathOperationFunc(unselectedContoursPath, selectedContoursPath);
    }
  });

  await sceneController.editGlyphAndRecordChanges(
    (glyph) => {
      for (const [layerName, layerPath] of Object.entries(layerPaths)) {
        if (doUnion && pointIndices.length) {
          const path = glyph.layers[layerName].glyph.path;
          for (const contourIndex of reversed(selectedContourIndices)) {
            path.deleteContour(contourIndex);
          }
          path.appendPath(layerPath);
        } else {
          glyph.layers[layerName].glyph.path = layerPath;
        }
      }
      return undoLabel.toLowerCase();
    },
    undefined,
    true
  );

  sceneController.selection = new Set(); // Clear selection
}

export async function transformSelection(
  sceneController,
  fontController,
  transformationForLayer,
  undoLabel
) {
  let {
    point: pointIndices,
    component: componentIndices,
    anchor: anchorIndices,
    backgroundImage: backgroundImageIndices,
  } = parseSelection(sceneController.selection);

  pointIndices = pointIndices || [];
  componentIndices = componentIndices || [];
  anchorIndices = anchorIndices || [];
  backgroundImageIndices = backgroundImageIndices || [];
  if (
    !pointIndices.length &&
    !componentIndices.length &&
    !anchorIndices.length &&
    !backgroundImageIndices.length
  ) {
    return;
  }

  const glyphController =
    await sceneController.sceneModel.getSelectedStaticGlyphController();
  const staticGlyphControllers = await sceneController.getStaticGlyphControllers();

  await sceneController.editGlyph((sendIncrementalChange, glyph) => {
    const layerInfo = Object.entries(
      sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
    ).map(([layerName, layerGlyph]) => {
      const behaviorFactory = new EditBehaviorFactory(
        layerGlyph,
        sceneController.selection,
        sceneController.selectedTool.scalingEditBehavior
      );
      return {
        layerName,
        changePath: ["layers", layerName, "glyph"],
        layerGlyph: layerGlyph,
        selectionBounds: (
          staticGlyphControllers[layerName] || glyphController
        ).getSelectionBounds(
          sceneController.selection,
          fontController.getBackgroundImageBoundsFunc
        ),
        editBehavior: behaviorFactory.getTransformBehavior("default"),
      };
    });

    const editChanges = [];
    const rollbackChanges = [];
    for (const { changePath, editBehavior, selectionBounds, layerGlyph } of layerInfo) {
      const pinPoint = getPinPoint(
        selectionBounds,
        transformationParameters.originX,
        transformationParameters.originY
      );

      const pinnedTransformation = new Transform()
        .translate(pinPoint.x, pinPoint.y)
        .transform(transformationForLayer(selectionBounds))
        .translate(-pinPoint.x, -pinPoint.y);

      const editChange = editBehavior.makeChangeForTransformation(pinnedTransformation);

      applyChange(layerGlyph, editChange);
      editChanges.push(consolidateChanges(editChange, changePath));
      rollbackChanges.push(consolidateChanges(editBehavior.rollbackChange, changePath));
    }

    const changes = ChangeCollector.fromChanges(
      consolidateChanges(editChanges),
      consolidateChanges(rollbackChanges)
    );

    return {
      changes: changes,
      undoLabel: undoLabel,
      broadcast: true,
    };
  });
}

export function registerSelectionTransformationActions(
  sceneController,
  fontController
) {
  const moveActions = [
    ["align.left", alignLeft, "l"],
    ["align.center", alignCenter, "c"],
    ["align.right", alignRight, "r"],
    ["align.top", alignTop, "t"],
    ["align.middle", alignMiddle, "m"],
    ["align.bottom", alignBottom, "b"],
    ["distribute.horizontally", distributeHorizontally, "h"],
    ["distribute.vertically", distributeVertically, "v"],
  ];

  for (const [keyPart, moveDescriptor, shortCutKey] of moveActions) {
    registerAction(
      `action.selection-transformation.${keyPart}`,
      {
        topic: ACTION_TOPIC,
        titleKey: `sidebar.selection-transformation.${keyPart}`,
        defaultShortCuts: [{ baseKey: shortCutKey, commandKey: true, altKey: true }],
      },
      () => moveObjects(sceneController, fontController, moveDescriptor),
      () => canAlignOrDistribute(sceneController)
    );
  }

  // Point-level variants: align/distribute the selected points themselves
  // instead of the whole objects (contours, components, ...).
  for (const [keyPart, moveDescriptor, shortCutKey] of moveActions) {
    registerAction(
      `action.selection-transformation.${keyPart}.points`,
      {
        topic: ACTION_TOPIC,
        titleKey: `sidebar.selection-transformation.${keyPart}`,
        defaultShortCuts: [
          {
            baseKey: shortCutKey,
            commandKey: true,
            altKey: true,
            shiftKey: true,
          },
        ],
      },
      () => moveObjects(sceneController, fontController, moveDescriptor, true),
      () => canAlignOrDistribute(sceneController, true),
      () => getPointsLabel(keyPart)
    );
  }

  const pathActions = [
    ["union", pathOperations.unionPath, "u"],
    ["subtract", pathOperations.subtractPath, "s"],
    ["intersect", pathOperations.intersectPath, "i"],
    ["exclude", pathOperations.excludePath, "x"],
  ];

  for (const [keyPart, pathOperationFunc, shortCutKey] of pathActions) {
    registerAction(
      `action.selection-transformation.path-operations.${keyPart}`,
      {
        topic: ACTION_TOPIC,
        titleKey: `sidebar.selection-transformation.path-operations.${keyPart}`,
        defaultShortCuts: [{ baseKey: shortCutKey, commandKey: true, altKey: true }],
      },
      () =>
        doPathOperations(sceneController, fontController, pathOperationFunc, keyPart),
      () => canDoPathOperation(sceneController, keyPart)
    );
  }
}

// The menu items for the selection transformation actions, shared by the
// canvas context menu and the top bar Edit menu.
export function getSelectionTransformationMenuItems() {
  const pointSuffix = (keyPart) => getPointsLabel(keyPart);

  return [
    {
      title: () => translate("menu.selection-transformations.align"),
      getItems: () => [
        {
          actionIdentifier: "action.selection-transformation.align.left",
          icon: "/tabler-icons/vertical-align-left.svg",
        },
        {
          actionIdentifier: "action.selection-transformation.align.center",
          icon: "/tabler-icons/vertical-align-center.svg",
        },
        {
          actionIdentifier: "action.selection-transformation.align.right",
          icon: "/tabler-icons/vertical-align-right.svg",
        },
        {
          actionIdentifier: "action.selection-transformation.align.top",
          icon: "/tabler-icons/horizontal-align-top.svg",
        },
        {
          actionIdentifier: "action.selection-transformation.align.middle",
          icon: "/tabler-icons/horizontal-align-center.svg",
        },
        {
          actionIdentifier: "action.selection-transformation.align.bottom",
          icon: "/tabler-icons/horizontal-align-bottom.svg",
        },
        MenuItemDivider,
        {
          title: () => pointSuffix("align.left"),
          actionIdentifier: "action.selection-transformation.align.left.points",
          icon: "/tabler-icons/vertical-align-left.svg",
        },
        {
          title: () => pointSuffix("align.center"),
          actionIdentifier: "action.selection-transformation.align.center.points",
          icon: "/tabler-icons/vertical-align-center.svg",
        },
        {
          title: () => pointSuffix("align.right"),
          actionIdentifier: "action.selection-transformation.align.right.points",
          icon: "/tabler-icons/vertical-align-right.svg",
        },
        {
          title: () => pointSuffix("align.top"),
          actionIdentifier: "action.selection-transformation.align.top.points",
          icon: "/tabler-icons/horizontal-align-top.svg",
        },
        {
          title: () => pointSuffix("align.middle"),
          actionIdentifier: "action.selection-transformation.align.middle.points",
          icon: "/tabler-icons/horizontal-align-center.svg",
        },
        {
          title: () => pointSuffix("align.bottom"),
          actionIdentifier: "action.selection-transformation.align.bottom.points",
          icon: "/tabler-icons/horizontal-align-bottom.svg",
        },
      ],
    },
    {
      title: () => translate("menu.selection-transformations.distribute"),
      getItems: () => [
        {
          actionIdentifier: "action.selection-transformation.distribute.horizontally",
          icon: "/tabler-icons/layout-distribute-vertical.svg",
        },
        {
          actionIdentifier: "action.selection-transformation.distribute.vertically",
          icon: "/tabler-icons/layout-distribute-horizontal.svg",
        },
        MenuItemDivider,
        {
          title: () => pointSuffix("distribute.horizontally"),
          actionIdentifier:
            "action.selection-transformation.distribute.horizontally.points",
          icon: "/tabler-icons/layout-distribute-vertical.svg",
        },
        {
          title: () => pointSuffix("distribute.vertically"),
          actionIdentifier:
            "action.selection-transformation.distribute.vertically.points",
          icon: "/tabler-icons/layout-distribute-horizontal.svg",
        },
      ],
    },
    {
      title: () => translate("menu.selection-transformations.path-operations"),
      getItems: () => [
        {
          title: () => translate("menu.selection-transformations.union"),
          actionIdentifier: "action.selection-transformation.path-operations.union",
          icon: "/tabler-icons/layers-union.svg",
        },
        {
          title: () => translate("menu.selection-transformations.subtract"),
          actionIdentifier: "action.selection-transformation.path-operations.subtract",
          icon: "/tabler-icons/layers-subtract.svg",
        },
        {
          title: () => translate("menu.selection-transformations.intersect"),
          actionIdentifier: "action.selection-transformation.path-operations.intersect",
          icon: "/tabler-icons/layers-intersect-2.svg",
        },
        {
          title: () => translate("menu.selection-transformations.exclude"),
          actionIdentifier: "action.selection-transformation.path-operations.exclude",
          icon: "/tabler-icons/layers-difference.svg",
        },
      ],
    },
  ];
}

export function getPinPoint(bounds, originX, originY) {
  const { width, height } = rectSize(bounds);
  // default from center
  let pinPointX = bounds.xMin + width / 2;
  let pinPointY = bounds.yMin + height / 2;

  if (typeof originX === "number") {
    pinPointX = originX;
  } else if (originX === "left") {
    pinPointX = bounds.xMin;
  } else if (originX === "right") {
    pinPointX = bounds.xMax;
  }

  if (typeof originY === "number") {
    pinPointY = originY;
  } else if (originY === "top") {
    pinPointY = bounds.yMax;
  } else if (originY === "bottom") {
    pinPointY = bounds.yMin;
  }

  return { x: pinPointX, y: pinPointY };
}

// Define MovableObject classes
export class MovableObject {
  constructor(selection) {
    this.selection = selection;
  }

  computeBounds(staticGlyphController, getBackgroundImageBoundsFunc) {
    return staticGlyphController.getSelectionBounds(
      this.selection,
      getBackgroundImageBoundsFunc
    );
  }

  makeChangesForDelta(delta, layerGlyph, sceneController) {
    const behaviorFactory = new EditBehaviorFactory(
      layerGlyph,
      this.selection,
      sceneController.selectedTool.scalingEditBehavior
    );

    const editBehavior = behaviorFactory.getBehavior("default");
    const editChange = editBehavior.makeChangeForDelta(delta);
    return [editChange, editBehavior.rollbackChange];
  }
}

// Define moveDescriptor objects
export const alignLeft = {
  undoLabel: "align left", // TODO: maybe use translate("sidebar.selection-transformation.align.left")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const xMins = boundingBoxes.map((bounds) => bounds.xMin);
    const left = Math.min(...xMins);
    return xMins.map((xMin) => ({
      x: left - xMin,
      y: 0,
    }));
  },
};

export const alignCenter = {
  undoLabel: "align center", // TODO: maybe use translate("sidebar.selection-transformation.align.center")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const xMaxes = boundingBoxes.map((bounds) => bounds.xMax);
    const xMins = boundingBoxes.map((bounds) => bounds.xMin);
    const left = Math.min(...xMins);
    const right = Math.max(...xMaxes);
    return boundingBoxes.map((bounds) => ({
      x: left - bounds.xMin + (right - left) / 2 - (bounds.xMax - bounds.xMin) / 2,
      y: 0,
    }));
  },
};

export const alignRight = {
  undoLabel: "align right", // TODO: maybe use translate("sidebar.selection-transformation.align.right")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const xMaxes = boundingBoxes.map((bounds) => bounds.xMax);
    const right = Math.max(...xMaxes);
    return xMaxes.map((xMax) => ({
      x: right - xMax,
      y: 0,
    }));
  },
};

export const alignTop = {
  undoLabel: "align top", // TODO: maybe use translate("sidebar.selection-transformation.align.top")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const yMaxes = boundingBoxes.map((bounds) => bounds.yMax);
    const top = Math.max(...yMaxes);
    return yMaxes.map((yMax) => ({
      x: 0,
      y: top - yMax,
    }));
  },
};

export const alignMiddle = {
  undoLabel: "align middle", // TODO: maybe use translate("sidebar.selection-transformation.align.middle")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const yMaxes = boundingBoxes.map((bounds) => bounds.yMax);
    const yMins = boundingBoxes.map((bounds) => bounds.yMin);
    const bottom = Math.min(...yMins);
    const top = Math.max(...yMaxes);
    return boundingBoxes.map((bounds) => ({
      x: 0,
      y: top - bounds.yMax + (bounds.yMax - bounds.yMin) / 2 - (top - bottom) / 2,
    }));
  },
};

export const alignBottom = {
  undoLabel: "align bottom", // TODO: maybe use translate("sidebar.selection-transformation.align.bottom")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const yMins = boundingBoxes.map((bounds) => bounds.yMin);
    const bottom = Math.min(...yMins);
    return yMins.map((yMin) => ({
      x: 0,
      y: bottom - yMin,
    }));
  },
};

class DistributeObjectsDescriptor {
  constructor(direction, directionVar) {
    this.undoLabel = `distribute ${direction}`;
    this.minProperty = `${directionVar}Min`;
    this.maxProperty = `${directionVar}Max`;
    this.deltaProperty = directionVar;
  }

  computeDeltasFromBoundingBoxes(boundingBoxes, customDistributionSpacing) {
    let effectiveExtent = 0;
    for (const bounds of boundingBoxes) {
      effectiveExtent += bounds[this.maxProperty] - bounds[this.minProperty];
    }
    const mins = boundingBoxes.map((bounds) => bounds[this.minProperty]);
    const maxes = boundingBoxes.map((bounds) => bounds[this.maxProperty]);
    const minimum = Math.min(...mins);
    const maximum = Math.max(...maxes);

    const distributionSpacing =
      customDistributionSpacing === null
        ? (maximum - minimum - effectiveExtent) / (boundingBoxes.length - 1)
        : customDistributionSpacing;

    let next = minimum;
    let deltas = [];
    for (const bounds of boundingBoxes) {
      const extent = bounds[this.maxProperty] - bounds[this.minProperty];
      const delta = { x: 0, y: 0 };
      delta[this.deltaProperty] = next - bounds[this.minProperty];
      deltas.push(delta);
      next += extent + distributionSpacing;
    }
    return deltas;
  }

  compareObjects(a, b, glyphController, getBackgroundImageBoundsFunc) {
    return (
      rectCenter(a.computeBounds(glyphController, getBackgroundImageBoundsFunc))[
        this.deltaProperty
      ] -
      rectCenter(b.computeBounds(glyphController, getBackgroundImageBoundsFunc))[
        this.deltaProperty
      ]
    );
  }
}

export const distributeHorizontally = new DistributeObjectsDescriptor(
  "horizontally",
  "x"
);
export const distributeVertically = new DistributeObjectsDescriptor("vertically", "y");
