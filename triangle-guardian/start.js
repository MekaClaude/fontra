/**
 * Triangle Guardian plugin entry point.
 *
 * Loaded as a raw browser ES module via import() — @fontra/ webpack aliases
 * do NOT resolve here. We use the editor instance that's passed in, which
 * exposes all the infrastructure we need.
 *
 * @param {Object} editor - The Fontra editor controller.
 * @param {string} pluginPath - Base URL path for this plugin's assets.
 */
export function registerPlugin(editor, pluginPath) {
  // Register the visualization layer
  _registerLayer(editor);

  // Create and add the sidebar panel
  const panel = _createPanel(editor);
  editor.addSidebarPanel(panel, "right");
}

function _registerLayer(editor) {
  const sceneModel = editor.sceneController.sceneModel;
  const canvasController = editor.canvasController;

  const layerDef = {
    identifier: "com.fontra.plugins.triangle-guardian.overlay",
    name: "Triangle Guardian",
    userSwitchable: true,
    defaultOn: true,
    zIndex: 200,
    screenParameters: {
      strokeWidth: 1,
      triangleOpacity: 0.18,
      violationColor: "#E24B4A",
      okColor: "#1D9E75",
      sCurveColor: "#185FA5",
      apexRadius: 3,
      dashLength: 5,
      dashGap: 4,
    },
    draw: (context, positionedGlyph, parameters, model, controller) => {
      if (!_state.enabled) return;

      const glyph = positionedGlyph.glyph;
      if (!glyph || !glyph.path) return;

      const path = glyph.path;
      const educMode = _state.educationalMode;
      const showAll = _state.showAllSegments;

      for (let ci = 0; ci < path.numContours; ci++) {
        for (const segment of path.iterContourDecomposedSegments(ci)) {
          if (segment.type !== "cubic" || segment.points.length !== 4) continue;

          const [P0, P1, P2, P3] = segment.points;
          const indices = segment.parentPointIndices;

          const isSelected =
            educMode || showAll || _isSegmentSelected(indices, _getSelectedSet(model), _getHoveredSet(model));
          if (!isSelected) continue;
          if (_isDegenerate(P0, P1, P2, P3)) continue;

          const { apex, isSCurve } = _computeApex(P0, P1, P2, P3);
          if (!apex && !isSCurve) continue;

          const p1Outside = apex && !_pointInTriangle(P1, P0, P3, apex);
          const p2Outside = apex && !_pointInTriangle(P2, P0, P3, apex);

          context.save();
          if (isSCurve) {
            _drawSCurveTriangles(context, P0, P1, P2, P3, parameters);
          } else {
            _drawSimpleTriangle(context, P0, P1, P2, P3, apex, p1Outside, p2Outside, parameters);
          }
          context.restore();
        }
      }
    },
  };

  // Register via editor's visualizationLayers
  editor.visualizationLayers.addDefinition(layerDef, true);

  // Enable by default in settings
  if (editor.visualizationLayersSettings) {
    editor.visualizationLayersSettings.model["com.fontra.plugins.triangle-guardian.overlay"] = true;
  }
}

function _createPanel(editor) {
  // Create a minimal panel element
  const container = document.createElement("div");
  container.id = "tg-panel";
  container.style.cssText = "padding:12px;display:flex;flex-direction:column;gap:12px;font-family:system-ui;font-size:12px;";

  const toggles = [
    { key: "showAllSegments", label: "Show all segments" },
    { key: "educationalMode", label: "Educational mode" },
    { key: "highlightViolations", label: "Highlight violations" },
    { key: "showSCurveLabels", label: "S-curve labels" },
  ];

  function _buildSection(title, rows) {
    const section = document.createElement("div");
    section.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;opacity:.55;padding-bottom:2px;border-bottom:0.5px solid var(--ui-element-background-color-1);";
    titleEl.textContent = title;
    section.appendChild(titleEl);
    rows.forEach((r) => section.appendChild(r));
    return section;
  }

  const modeRows = [];
  for (const { key, label: lbl } of toggles) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
    const lblEl = document.createElement("label");
    lblEl.style.cssText = "font-size:12px;";
    lblEl.textContent = lbl;
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = _state[key];
    chk.addEventListener("change", () => {
      _state[key] = chk.checked;
      canvasController.requestUpdate();
      if (key !== "triangleOpacity") _scheduleViolationScan(editor, violationList);
    });
    row.appendChild(lblEl);
    row.appendChild(chk);
    modeRows.push(row);
  }

  const opacityRow = document.createElement("div");
  opacityRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
  const opacityLbl = document.createElement("label");
  opacityLbl.style.cssText = "font-size:12px;";
  opacityLbl.textContent = "Triangle opacity";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 0;
  slider.max = 100;
  slider.value = Math.round(_state.triangleOpacity * 100);
  const valLbl = document.createElement("span");
  valLbl.style.cssText = "font-size:12px;";
  valLbl.textContent = `${slider.value}%`;
  slider.addEventListener("input", () => {
    _state.triangleOpacity = parseInt(slider.value) / 100;
    valLbl.textContent = `${slider.value}%`;
    canvasController.requestUpdate();
  });
  opacityRow.appendChild(opacityLbl);
  opacityRow.appendChild(slider);
  opacityRow.appendChild(valLbl);

  const canvasController = editor.canvasController;
  const violationList = document.createElement("div");
  violationList.style.cssText = "min-height:80px;";

  const modeSection = _buildSection("Mode", modeRows);
  const appearanceSection = _buildSection("Appearance", [opacityRow]);
  const violationsSection = (() => {
    const s = document.createElement("div");
    s.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    const t = document.createElement("div");
    t.style.cssText = "font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;opacity:.55;padding-bottom:2px;border-bottom:0.5px solid var(--ui-element-background-color-1);";
    t.textContent = "Violations";
    s.appendChild(t);
    s.appendChild(violationList);
    return s;
  })();

  container.appendChild(modeSection);
  container.appendChild(appearanceSection);
  container.appendChild(violationsSection);

  // Set panel metadata
  container.identifier = "triangle-guardian-panel";
  container.name = "triangle-guardian-panel";
  container.label = "Triangle Guardian";

  _scheduleViolationScan(editor, violationList);

  editor.sceneController.addCurrentGlyphChangeListener(() =>
    _scheduleViolationScan(editor, violationList)
  );
  editor.sceneSettingsController?.addKeyListener?.(
    "selectedGlyphName",
    () => _scheduleViolationScan(editor, violationList)
  );

  return container;
}

// ── Shared state ──────────────────────────────────────────────

const _state = {
  enabled: true,
  educationalMode: false,
  showAllSegments: false,
  highlightViolations: true,
  showSCurveLabels: true,
  triangleOpacity: 0.18,
};

// ── Geometry helpers ──────────────────────────────────────────

function _isDegenerate(P0, P1, P2, P3) {
  if (P0.x === P3.x && P0.y === P3.y) return true;
  if (P0.x === P1.x && P0.y === P1.y) return true;
  if (P3.x === P2.x && P3.y === P2.y) return true;
  return false;
}

function _computeApex(P0, P1, P2, P3) {
  const d1x = P1.x - P0.x;
  const d1y = P1.y - P0.y;
  const d2x = P2.x - P3.x;
  const d2y = P2.y - P3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-6) return { apex: null, isSCurve: false };
  const dx = P3.x - P0.x;
  const dy = P3.y - P0.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const s = (dx * d1y - dy * d1x) / denom;
  const isSCurve = t < 0 || s < 0;
  const apex = { x: P0.x + t * d1x, y: P0.y + t * d1y };
  return { apex, isSCurve };
}

function _pointInTriangle(pt, A, B, C, eps = 0.5) {
  function sign(ax, ay, bx, by, cx, cy) {
    return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  }
  const d1 = sign(pt.x, pt.y, A.x, A.y, B.x, B.y);
  const d2 = sign(pt.x, pt.y, B.x, B.y, C.x, C.y);
  const d3 = sign(pt.x, pt.y, C.x, C.y, A.x, A.y);
  const hasNeg = d1 < -eps || d2 < -eps || d3 < -eps;
  const hasPos = d1 > eps || d2 > eps || d3 > eps;
  return !(hasNeg && hasPos);
}

function _getSelectedSet(model) {
  if (!model.selection) return new Set();
  const sel = model.selection;
  const result = new Set();
  for (const item of sel) {
    if (item.startsWith("point/")) {
      result.add(parseInt(item.split("/")[1]));
    }
  }
  return result;
}

function _getHoveredSet(model) {
  if (!model.hoverSelection) return new Set();
  const sel = model.hoverSelection;
  const result = new Set();
  for (const item of sel) {
    if (item.startsWith("point/")) {
      result.add(parseInt(item.split("/")[1]));
    }
  }
  return result;
}

function _isSegmentSelected(indices, selectedSet, hoveredSet) {
  for (const idx of indices) {
    if (selectedSet.has(idx) || hoveredSet.has(idx)) return true;
  }
  return false;
}

function _drawLine(ctx, a, b) {
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}

function _drawSimpleTriangle(ctx, P0, P1, P2, P3, apex, p1Outside, p2Outside, p) {
  const anyViolation = p1Outside || p2Outside;
  const fillColor = anyViolation ? p.violationColor : p.okColor;

  ctx.beginPath();
  ctx.moveTo(P0.x, P0.y);
  ctx.lineTo(apex.x, apex.y);
  ctx.lineTo(P3.x, P3.y);
  ctx.closePath();
  ctx.globalAlpha = p.triangleOpacity;
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.setLineDash([p.dashLength, p.dashGap]);
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = p.strokeWidth;
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(apex.x, apex.y, p.apexRadius, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = fillColor;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = p.strokeWidth * 0.7;
  _drawLine(ctx, P0, apex);
  ctx.stroke();
  _drawLine(ctx, P3, apex);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  if (_state.highlightViolations) {
    if (p1Outside) _drawViolationMarker(ctx, P1, p);
    if (p2Outside) _drawViolationMarker(ctx, P2, p);
  }
}

function _drawViolationMarker(ctx, pt, p) {
  const r = p.apexRadius * 1.8;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = p.violationColor;
  ctx.lineWidth = p.strokeWidth * 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pt.x - r * 0.6, pt.y - r * 0.6);
  ctx.lineTo(pt.x + r * 0.6, pt.y + r * 0.6);
  ctx.moveTo(pt.x + r * 0.6, pt.y - r * 0.6);
  ctx.lineTo(pt.x - r * 0.6, pt.y + r * 0.6);
  ctx.strokeStyle = p.violationColor;
  ctx.stroke();
}

function _drawSCurveTriangles(ctx, P0, P1, P2, P3, p) {
  const M = { x: (P0.x + P3.x) / 2, y: (P0.y + P3.y) / 2 };
  _drawHalfTriangle(ctx, P0, M, P1, p.sCurveColor, p);
  _drawHalfTriangle(ctx, P3, M, P2, p.sCurveColor, p);
  if (_state.showSCurveLabels) {
    const screenPx = Math.round(9 / ctx.getTransform().a);
    ctx.font = `${screenPx}px sans-serif`;
    ctx.fillStyle = p.sCurveColor;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = "center";
    ctx.fillText("S", M.x, M.y - 6);
    ctx.globalAlpha = 1;
  }
}

function _drawHalfTriangle(ctx, A, B, C, color, p) {
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(C.x, C.y);
  ctx.closePath();
  ctx.globalAlpha = p.triangleOpacity * 0.7;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.setLineDash([p.dashLength, p.dashGap]);
  ctx.strokeStyle = color;
  ctx.lineWidth = p.strokeWidth;
  ctx.stroke();
  ctx.setLineDash([]);
}

// ── Violation scanning ────────────────────────────────────────

let _scanPending = null;

async function _scheduleViolationScan(editor, violationList) {
  if (_scanPending) return;
  _scanPending = _runViolationScan(editor, violationList);
  await _scanPending;
  _scanPending = null;
}

async function _runViolationScan(editor, violationList) {
  try {
    const sceneController = editor.sceneController;
    const sceneModel = sceneController.sceneModel;
    const glyphName = sceneController.sceneSettings.selectedGlyphName;

    if (!glyphName) {
      violationList.innerHTML = '<div style="font-size:11px;opacity:.5;padding:8px 0;text-align:center;">No glyph selected</div>';
      return;
    }

    const instance = await sceneModel.getGlyphInstance(glyphName);
    if (!instance || !instance.path) {
      violationList.innerHTML = '<div style="font-size:11px;opacity:.5;padding:8px 0;text-align:center;">No path data</div>';
      return;
    }

    const path = instance.path;
    const violations = [];

    for (let ci = 0; ci < path.numContours; ci++) {
      for (const segment of path.iterContourDecomposedSegments(ci)) {
        if (segment.type !== "cubic" || segment.points.length !== 4) continue;
        const [P0, P1, P2, P3] = segment.points;
        if (_isDegenerate(P0, P1, P2, P3)) continue;

        const { apex, isSCurve } = _computeApex(P0, P1, P2, P3);
        if (isSCurve) {
          violations.push({ contour: ci, segment: segment.segmentIndex ?? ci, issue: "S-curve" });
          continue;
        }
        if (!apex) continue;

        const p1Out = !_pointInTriangle(P1, P0, P3, apex);
        const p2Out = !_pointInTriangle(P2, P0, P3, apex);
        if (p1Out || p2Out) {
          const parts = [];
          if (p1Out) parts.push("handle A");
          if (p2Out) parts.push("handle B");
          violations.push({ contour: ci, segment: segment.segmentIndex ?? ci, issue: parts.join(", ") });
        }
      }
    }

    if (violations.length === 0) {
      violationList.innerHTML = '<div style="font-size:11px;opacity:.5;padding:8px 0;text-align:center;">No violations</div>';
    } else {
      violationList.innerHTML = "";
      for (const v of violations) {
        const item = document.createElement("div");
        item.style.cssText = "display:flex;align-items:center;gap:4px;padding:3px 0;cursor:pointer;font-size:11px;";
        item.innerHTML = `<span style="width:48px;">c${v.contour}</span><span style="width:36px;">s${v.segment}</span><span style="color:var(--fontra-red,#e24b4a);">${v.issue}</span>`;
        violationList.appendChild(item);
      }
    }
  } catch (error) {
    console.error("[Triangle Guardian] Violation scan failed:", error);
    violationList.innerHTML = `<div style="font-size:11px;color:var(--fontra-red,#e24b4a);padding:8px 0;text-align:center;">Scan error: ${error.message}</div>`;
  }
}
