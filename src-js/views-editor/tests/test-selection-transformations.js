import { expect } from "chai";
import { VarPackedPath } from "@fontra/core/var-path.js";
import { parseSelection } from "@fontra/core/utils.ts";

// The editor module pulls in the context menu web component, which needs a
// DOM, and fontra-core keeps some state in localStorage. Provide the bare
// minimum, so the module can be imported under Node.
globalThis.HTMLElement = globalThis.HTMLElement || class HTMLElement {};
globalThis.customElements = globalThis.customElements || { define() {} };
globalThis.window = globalThis.window || { addEventListener() {} };
globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const { alignLeft, alignRight, moveObjects } =
  await import("../src/selection-transformations.js");

const fontController = { getBackgroundImageBoundsFunc: undefined };

// A round-ish contour, with the point order Fontra uses:
//   0 P0 (on-curve), 1 H0a (off-curve), 2 H0b (off-curve),
//   3 P1 (on-curve), 4 H1a (off-curve), 5 H1b (off-curve)
// H0a is the outgoing handle of P0, H1b is the incoming handle of P0.
function makeRoundContour() {
  return VarPackedPath.fromUnpackedContours([
    {
      isClosed: true,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: -50, type: "cubic" },
        { x: 70, y: -50, type: "cubic" },
        { x: 100, y: 0 },
        { x: 70, y: 50, type: "cubic" },
        { x: 30, y: 50, type: "cubic" },
      ],
    },
  ]);
}

// The same shape, twice, so we have two independently movable objects.
function makeTwoRoundContours() {
  return VarPackedPath.fromUnpackedContours([
    {
      isClosed: true,
      points: [
        { x: 0, y: 0 },
        { x: 30, y: -50, type: "cubic" },
        { x: 70, y: -50, type: "cubic" },
        { x: 100, y: 0 },
        { x: 70, y: 50, type: "cubic" },
        { x: 30, y: 50, type: "cubic" },
      ],
    },
    {
      isClosed: true,
      points: [
        { x: 200, y: 0 },
        { x: 230, y: -50, type: "cubic" },
        { x: 270, y: -50, type: "cubic" },
        { x: 300, y: 0 },
        { x: 270, y: 50, type: "cubic" },
        { x: 230, y: 50, type: "cubic" },
      ],
    },
  ]);
}

// A minimal stand-in for the scene controller and the static glyph
// controller, good enough for moveObjects().
function makeSceneController(path) {
  const layerGlyph = {
    path,
    components: [],
    anchors: [],
    guidelines: [],
  };

  const staticGlyphController = {
    instance: { path },
    getSelectionBounds(selection) {
      const { point: pointIndices } = parseSelection(selection);
      const points = (pointIndices || []).map((pointIndex) =>
        path.getPoint(pointIndex)
      );
      if (!points.length) {
        return undefined;
      }
      return {
        xMin: Math.min(...points.map((point) => point.x)),
        xMax: Math.max(...points.map((point) => point.x)),
        yMin: Math.min(...points.map((point) => point.y)),
        yMax: Math.max(...points.map((point) => point.y)),
      };
    },
  };

  const sceneController = {
    sceneSettings: { selectedGlyph: { isEditing: true } },
    sceneModel: {
      getSelectedStaticGlyphController: async () => staticGlyphController,
    },
    getStaticGlyphControllers: async () => ({ master: staticGlyphController }),
    selectedTool: { scalingEditBehavior: false },
    getEditingLayerFromGlyphLayers: (layers) =>
      Object.fromEntries(
        Object.entries(layers).map(([layerName, layer]) => [layerName, layer.glyph])
      ),
    editGlyph: async (editFunc) =>
      await editFunc(() => {}, { layers: { master: { glyph: layerGlyph } } }),
  };

  return { sceneController, layerGlyph };
}

function pointPositions(path) {
  return path.unpackedContours()[0].points.map((point) => ({
    x: point.x,
    y: point.y,
  }));
}

describe("Selection Transformations -- moving objects", () => {
  it("aligns two on-curve points", async () => {
    const path = makeRoundContour();
    const { sceneController } = makeSceneController(path);
    sceneController.selection = new Set(["point/0", "point/3"]);

    await moveObjects(sceneController, fontController, alignRight, true);

    const points = pointPositions(path);
    expect(points[0].x).to.equal(points[3].x);
    expect(points[0].x).to.equal(100);
  });

  it("aligns an on-curve point and the handle next to it", async () => {
    // Moving an on-curve point drags the off-curve handles next to it along,
    // so the move of one point can write the position of the other one. The
    // explicitly selected point must end up at its own target position.
    const path = makeRoundContour();
    const { sceneController } = makeSceneController(path);
    sceneController.selection = new Set(["point/0", "point/1"]);

    await moveObjects(sceneController, fontController, alignRight, true);

    const points = pointPositions(path);
    expect(points[0].x).to.equal(points[1].x);
    expect(points[0].x).to.equal(30);
  });

  it("aligns an on-curve point and the handle in front of it", async () => {
    // Point 5 is the incoming handle of point 0, so it comes *before* it in
    // the contour. The move of the on-curve point drags the handle along, so
    // the handle would end up at the position of the on-curve point.
    const path = makeRoundContour();
    const { sceneController } = makeSceneController(path);
    sceneController.selection = new Set(["point/5", "point/0"]);

    await moveObjects(sceneController, fontController, alignRight, true);

    const points = pointPositions(path);
    expect(points[0].x).to.equal(points[5].x);
    expect(points[0].x).to.equal(30);
  });

  it("moves the handle of an unselected point along with its point", async () => {
    const path = makeRoundContour();
    const { sceneController } = makeSceneController(path);
    sceneController.selection = new Set(["point/0", "point/3"]);

    await moveObjects(sceneController, fontController, alignRight, true);

    const points = pointPositions(path);
    // P0 moved from x=0 to x=100, so its handle moved along
    expect(points[1].x).to.equal(130);
  });

  it("aligns whole contours (object level)", async () => {
    const path = makeTwoRoundContours();
    const { sceneController } = makeSceneController(path);
    sceneController.selection = new Set(["point/0", "point/6"]);

    await moveObjects(sceneController, fontController, alignLeft, false);

    const contours = path.unpackedContours();
    expect(contours[0].points[0].x).to.equal(contours[1].points[0].x);
    // Align left moves the right-most contour to the left-most one
    expect(contours[0].points[0].x).to.equal(0);
    expect(contours[1].points[0].x).to.equal(0);
    // The contour kept its shape
    expect(contours[1].points[3].x).to.equal(100);
  });
});
