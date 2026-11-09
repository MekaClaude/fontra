// The « Overwrite ? » sheet (step 5, brief § 4.7): what Make shows before it
// replaces a drawing. A glyph of the target that has a rule but a drawing of
// its own is « drawn by hand »: ⑤ lists it apart, Make N leaves it alone, and
// only a glyph ticked here — each box unticked to begin with — is overwritten.
// Pure (tests/test_overwrite.mjs); marks-panel.js puts it in Fontra's dialog.

/** Split the glyphs a Make works on: those it writes, those the sheet asks about. */
export function splitForOverwrite(names, drawnByHand = []) {
  const drawn = new Set(drawnByHand);
  return {
    plain: names.filter((name) => !drawn.has(name)),
    ask: names.filter((name) => drawn.has(name)),
  };
}

/** The sheet's rows: one per glyph, its rule in words, the box unticked. */
export function sheetRows(names, ruleText = () => "") {
  return names.map((glyph) => ({ glyph, rule: ruleText(glyph), checked: false }));
}

/**
 * What the dialog's answer means: the glyphs to overwrite. *Leave them*, the
 * Escape key and a click outside answer null — nothing. *Overwrite checked*
 * answers the ticked names, which may be none.
 */
export function chosenForOverwrite(answer, asked) {
  if (!Array.isArray(answer)) {
    return new Set();
  }
  return new Set(answer.filter((name) => asked.includes(name)));
}

/** The title of the sheet. */
export function sheetTitle(count) {
  return count === 1 ? "Overwrite a glyph drawn by hand?" : `Overwrite ${count} glyphs drawn by hand?`;
}

// --- the previews: a layer as an SVG path ------------------------------------

function number(value) {
  return String(Math.round(value * 10) / 10);
}

function point(p) {
  return `${number(p.x)} ${number(p.y)}`;
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Fontra's unpacked contours — [{points: [{x, y, type?}], isClosed}], `type`
 * "cubic" or "quad" on an off-curve point — as SVG path data, in font units,
 * y up (the SVG flips it). Quadratic runs get their implied on-curve points.
 */
export function svgPathData(contours, { dx = 0, dy = 0 } = {}) {
  const parts = [];
  const at = (p) => ({ x: p.x + dx, y: p.y + dy, type: p.type });
  for (const contour of contours || []) {
    const points = (contour.points || []).map(at);
    if (!points.length) {
      continue;
    }
    const closed = contour.isClosed !== false;
    const firstOn = points.findIndex((p) => !p.type);
    if (firstOn < 0) {
      // all off-curve: a TrueType circle
      const n = points.length;
      parts.push(`M${point(mid(points[n - 1], points[0]))}`);
      for (let i = 0; i < n; i++) {
        parts.push(`Q${point(points[i])} ${point(mid(points[i], points[(i + 1) % n]))}`);
      }
      parts.push("Z");
      continue;
    }
    const order = closed
      ? [...points.slice(firstOn), ...points.slice(0, firstOn), points[firstOn]]
      : points.slice(firstOn);
    parts.push(`M${point(order[0])}`);
    let offCurves = [];
    for (const p of order.slice(1)) {
      if (p.type) {
        offCurves.push(p);
        continue;
      }
      if (!offCurves.length) {
        parts.push(`L${point(p)}`);
      } else if (offCurves[0].type === "cubic") {
        if (offCurves.length === 1) {
          parts.push(`Q${point(offCurves[0])} ${point(p)}`);
        } else {
          parts.push(`C${point(offCurves[0])} ${point(offCurves.at(-1))} ${point(p)}`);
        }
      } else {
        for (let i = 0; i < offCurves.length - 1; i++) {
          parts.push(`Q${point(offCurves[i])} ${point(mid(offCurves[i], offCurves[i + 1]))}`);
        }
        parts.push(`Q${point(offCurves.at(-1))} ${point(p)}`);
      }
      offCurves = [];
    }
    if (closed) {
      parts.push("Z");
    }
  }
  return parts.join(" ");
}

/**
 * The SVG of one preview: `shapes` [{contours, dx, dy}] in font units, framed
 * from the descender to the ascender and over the advance, y up.
 */
export function previewSVG(shapes, { xAdvance = 0, ascender = 800, descender = -200, height = 56 } = {}) {
  const d = shapes.map((shape) => svgPathData(shape.contours, shape)).filter((text) => text).join(" ");
  const xs = [];
  for (const shape of shapes) {
    for (const contour of shape.contours || []) {
      for (const p of contour.points || []) {
        xs.push(p.x + (shape.dx || 0));
      }
    }
  }
  const left = Math.min(0, ...xs);
  const right = Math.max(xAdvance, ...xs, left + 1);
  const width = right - left;
  const tall = ascender - descender;
  const pixelWidth = Math.max(8, Math.round((height * width) / tall));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${height}" ` +
    `viewBox="${number(left)} ${number(-ascender)} ${number(width)} ${number(tall)}">` +
    `<line x1="0" x2="0" y1="${number(-ascender)}" y2="${number(-descender)}" class="umarks-preview-edge"/>` +
    `<line x1="${number(xAdvance)}" x2="${number(xAdvance)}" y1="${number(-ascender)}" y2="${number(-descender)}" class="umarks-preview-edge"/>` +
    `<path transform="scale(1,-1)" d="${d}"/></svg>`
  );
}
