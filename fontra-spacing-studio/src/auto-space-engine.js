export class AutoSpaceEngine {
  constructor(fontController) {
    this.fontController = fontController;
  }

  computeSuggestions(glyphName, varLocation, refs) {
    const shapeClass = this._classify(glyphName);
    return this._applyFormula(shapeClass, refs);
  }

  _classify(glyphName) {
    const classes = {
      straight:           ["n","m","h","l","i","u","r","H","I","L","E","F","T","U","N","M"],
      round:              ["o","c","e","d","b","p","q","O","C","G","D","Q"],
      diagonal:           ["v","w","y","x","k","z","V","W","A","X","Y","K","Z"],
      open_right:         ["f","t"],
      open_left:          ["j"],
      exception:          ["a","g","s","S"],
    };
    for (const [cls, glyphs] of Object.entries(classes)) {
      if (glyphs.includes(glyphName)) return cls;
    }
    return "unknown";
  }

  _applyFormula(shapeClass, refs) {
    const { nLSB = 60, nRSB = 60, nCounter = 250, hCounter = 350 } = refs;
    const base = (nLSB + nRSB) / 2;

    const formulae = {
      straight: () => {
        const b = nCounter * 0.25;
        return { lsb: b, rsb: b,
          formula: `25% × counter (${Math.round(nCounter)} u) = ${Math.round(b)} u` };
      },
      round: () => {
        const b = hCounter * 0.20;
        return { lsb: b, rsb: b,
          formula: `20% × H counter (${Math.round(hCounter)} u) = ${Math.round(b)} u` };
      },
      diagonal: () => {
        return { lsb: base, rsb: base * 0.65,
          formula: `n bearing (${Math.round(base)} u) × asymmetric ratio` };
      },
      open_right: () => {
        return { lsb: base, rsb: base * 0.5,
          formula: `n bearing, RSB reduced 50%` };
      },
      open_left: () => {
        return { lsb: base * 0.5, rsb: base,
          formula: `n bearing, LSB reduced 50%` };
      },
      exception: () => {
        return { lsb: base, rsb: base,
          formula: `Space by eye — no formula` };
      },
      unknown: () => {
        return { lsb: base, rsb: base,
          formula: `Using n bearing (${Math.round(base)} u)` };
      },
    };

    const fn = formulae[shapeClass] ?? formulae.unknown;
    const result = fn();
    return { ...result, shapeClass,
      lsb: Math.round(result.lsb), rsb: Math.round(result.rsb) };
  }
}
