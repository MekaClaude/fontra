# SpeedPunk Plugin Implementation Plan for Fontra

## Executive Summary
This document outlines the implementation plan for porting the SpeedPunk curvature visualization plugin to Fontra. SpeedPunk is a popular type design tool that illustrates Bézier curve curvature with perpendicular "combs" - lines whose length is proportional to curvature at each point. The implementation will consist of a visualization layer (for drawing) and a sidebar panel (for controls), fully integrated into Fontra's editor.

## Part 1: Research Findings

### 1.1 Fontra Architecture Analysis
**Fontra** is a browser-based font editor with client-server architecture:
- **Client**: JavaScript application with visualization layer system for drawing overlays
- **Server**: Python backend managing font data
- **Plugin System**: Two types - visualization layers (toggleable overlays) and sidebar panels (UI controls)
- **Key Files**:
  - `src-js/views-editor/src/visualization-layer-definitions.js` - Where visualization layers are defined
  - `src-js/views-editor/src/editor.js` - Main editor with plugin loading
  - `src-js/fontra-core/src/var-path.js` - Path data structures and iteration methods

**Visualization Layer System**:
- Layers registered via `registerVisualizationLayerDefinition()`
- Each layer has: identifier, name, draw function, parameters, colors
- User can toggle layers on/off in settings
- Layers draw on glyph canvas using Canvas 2D API

**Sidebar Panel System**:
- Panels added via `editor.addSidebarPanel()`
- Panel class has `identifier`, `iconPath`, `getContentElement()`
- Panel receives `editorController` in constructor
- Can listen to glyph changes and update UI

### 1.2 SpeedPunk Algorithm Analysis
**SpeedPunk** is a curvature visualization plugin for Glyphs.app and RoboFont:

**Core Algorithm** (from `speedpunklib.py`):
1. **Curvature Calculation**:
   - For cubic Bézier with control points P0, P1, P2, P3 at parameter t:
   - Position: `B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3`
   - First derivative: `B'(t) = 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)`
   - Second derivative: `B''(t) = 6(1-t)(P2-2P1+P0) + 6t(P3-2P2+P1)`
   - Curvature: `κ = (B'(t).x × B''(t).y - B'(t).y × B''(t).x) / |B'(t)|³`

2. **Visualization**:
   - Draw perpendicular lines from curve points
   - Line length = curvature × gain × unitsPerEm²
   - Color gradient based on curvature magnitude
   - Support for "outside of glyph" vs "outer side of curve" positions

3. **Features**:
   - Cubic and quadratic curve support
   - Gradient colors (low to high curvature)
   - Gain parameter to control comb length
   - Fader to highlight curves above/below threshold
   - Histogram of curvature values

### 1.3 Integration Challenges
**Differences between SpeedPunk and Fontra**:
1. **Coordinate System**: Both use same coordinate system (good)
2. **Point Representation**: SpeedPunk uses custom `Point` class, Fontra uses `{x, y}` objects
3. **Path Iteration**: SpeedPunk manually processes paths, Fontra has `iterContourDecomposedSegments()`
4. **Drawing API**: SpeedPunk uses AppKit/NSBezierPath, Fontra uses Canvas 2D API
5. **Segment Types**: Fontra separates cubic vs quad segments, SpeedPunk converts all to cubic

## Part 2: Implementation Plan

### Phase 1: Core Curvature Calculation Module
**File**: `src-js/views-editor/src/curvature.js`

**Functions to Implement**:
```javascript
// Core curvature calculation
export function solveCubicBezier(p0, p1, p2, p3, t) {
  // Returns: { point: {x, y}, derivative1: {x, y}, derivative2: {x, y} }
}

export function solveCubicBezierCurvature(r, r1, r2) {
  // Returns: curvature value κ
}

// Quadratic curve support
export function quadraticToCubic(p0, p1, p2) {
  // Convert quadratic to cubic for curvature calculation
}

// Color interpolation
export function interpolateCurvatureColor(curvature, min, max, colors) {
  // Returns CSS color string
}

// Main processing function
export function processGlyphCurvature(glyph, options) {
  // Returns array of comb segments for drawing
}
```

**Dependencies**: No new dependencies, uses existing math functions.

### Phase 2: Visualization Layer
**Modify**: `src-js/views-editor/src/visualization-layer-definitions.js`

**Add Layer Definition**:
```javascript
registerVisualizationLayerDefinition({
  identifier: "fontra.curvature.comb",
  name: "Curvature Combs",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: false,
  zIndex: 100,
  screenParameters: {
    combLengthFactor: 0.01,  // Multiplier for comb length
    strokeWidth: 1,
    illustrationPosition: "outsideOfGlyph", // or "outsideOfCurve"
    curveGain: 1.0,
    useFader: false,
    faderValue: 0.5
  },
  colors: {
    combColorLow: "#8b939c",
    combColorMid: "#f29400", 
    combColorHigh: "#e3004f"
  },
  colorsDarkMode: {
    combColorLow: "#6b737c",
    combColorMid: "#d27400",
    combColorHigh: "#c3003f"
  },
  draw: drawCurvatureCombs
});
```

**Draw Function Logic**:
1. Get glyph path: `positionedGlyph.glyph.path`
2. Iterate contours: `path.iterContourDecomposedSegments(contourIndex)`
3. For each cubic segment (4 points):
   - Calculate curvature at multiple t values (e.g., t = 0, 0.1, 0.2, ..., 1)
   - Compute perpendicular direction
   - Draw line from curve point to point + (perpendicular × curvature × gain)
4. Apply gradient color based on curvature magnitude

### Phase 3: Sidebar Panel
**Create**: `src-js/views-editor/src/panel-speedpunk.js`

**Panel Structure**:
```javascript
export class SpeedPunkPanel {
  identifier = "curvature-analysis";
  iconPath = "./speedpunk-icon.svg"; // Need to create icon
  
  constructor(editorController) {
    this.editorController = editorController;
    this.sceneController = editorController.sceneController;
    this.visualizationLayersSettings = editorController.visualizationLayersSettings;
  }
  
  getContentElement() {
    // Build UI with:
    // - Toggle switch for curvature layer
    // - Comb length slider (0.1 - 3.0)
    // - Illustration position radio buttons
    // - Color gradient preview
    // - Fader checkbox and slider
    // - Reset button
  }
}
```

**UI Controls**:
1. **Enable/Disable**: Toggle curvature layer visibility
2. **Comb Length**: Slider 0.1-3.0 (multiplier for comb length)
3. **Position**: Radio buttons - "Outside of glyph" vs "Outer side of curve"
4. **Colors**: Visual gradient preview
5. **Fader**: Checkbox + slider to highlight curves above threshold
6. **Reset**: Restore default settings

**Integration**:
- Panel updates `visualizationLayersSettings.model["fontra.curvature.comb.*"]`
- Listen to layer settings changes to sync UI
- Register panel: `editor.addSidebarPanel(new SpeedPunkPanel(editor), "right")`

### Phase 4: Quadratic Curve Support
**Approach**: Convert quadratic segments to cubic for curvature calculation.

**Conversion Formula**:
For quadratic Bézier with P0, P1, P2:
- Equivalent cubic control points: P0, P0 + 2/3(P1-P0), P2 + 2/3(P1-P2), P2
- Or use quadratic curvature formula directly

**Implementation**:
```javascript
export function getCurvatureForSegment(segment) {
  if (segment.type === "cubic") {
    // Use cubic formula
    return calculateCubicCurvature(segment.points);
  } else if (segment.type === "quad") {
    // Convert to cubic or use quadratic formula
    const cubicPoints = quadraticToCubic(...segment.points);
    return calculateCubicCurvature(cubicPoints);
  }
  return 0; // Lines have zero curvature
}
```

### Phase 5: Advanced Features
1. **Gradient Colors**: Interpolate between 3 colors based on normalized curvature
2. **Fader**: Highlight combs above/below threshold with alpha transparency
3. **Histogram**: Optional histogram panel showing curvature distribution
4. **Performance**: Cache curvature calculations, update only on glyph change

### Phase 6: Integration and Testing
1. **Registration**: Add panel to editor initialization in `editor.js`
2. **Icon**: Create simple SVG icon for the panel
3. **Testing**:
   - Unit tests for curvature calculation functions
   - Visual tests with sample glyphs
   - Performance tests with complex glyphs
   - Cross-browser testing

## Part 3: Technical Specifications

### 3.1 Curvature Calculation Details
**Mathematical Background**:
- Curvature κ measures how quickly a curve changes direction
- For parametric curve (x(t), y(t)): κ = |x'y'' - y'x''| / (x'² + y'²)^(3/2)
- Positive curvature = curve bends to the left
- Negative curvature = curve bends to the right

**Implementation Considerations**:
- Handle division by zero (when derivative is zero)
- Normalize curvature by units per em
- Cache intermediate calculations for performance

### 3.2 Drawing Algorithm
**Perpendicular Line Calculation**:
For curve point with tangent vector (dx, dy):
- Perpendicular vector: (-dy, dx) or (dy, -dx) depending on direction
- Length = |curvature| × gain × scale
- Start point: curve point
- End point: curve point + (perpendicular × length)

**Color Mapping**:
1. Normalize curvature: `p = (curvature - min) / (max - min)`
2. Interpolate between 3 colors: low → mid → high
3. Apply alpha based on fader settings

### 3.3 Performance Optimization
1. **Caching**: Cache curvature calculations per glyph
2. **Incremental Update**: Only recalculate changed segments
3. **Worker Threads**: Consider Web Workers for heavy calculations
4. **Level of Detail**: Reduce calculation density when zoomed out

## Part 4: File Structure and Dependencies

### 4.1 New Files
```
src-js/views-editor/src/
├── curvature.js              # Core curvature calculation
└── panel-speedpunk.js        # Sidebar panel

.speeds-data-prompt/          # Documentation
└── speedpunk-plugin-plan.md  # This file
```

### 4.2 Modified Files
```
src-js/views-editor/src/
└── visualization-layer-definitions.js  # Add curvature comb layer

src-js/views-editor/src/
└── editor.js                           # Add SpeedPunk panel registration
```

### 4.3 Optional External Plugin
If built as separate plugin:
```
fontra-speedpunk/
├── plugin.json
├── start.js
├── speedpunk-icon.svg
└── src/
    ├── curvature.js
    └── speedpunk-panel.js
```

## Part 5: Timeline and Milestones

### Week 1: Core Algorithm
- Days 1-2: Port curvature calculation functions
- Days 3-4: Implement cubic and quadratic support
- Day 5: Unit tests and validation

### Week 2: Visualization Layer
- Days 1-2: Implement drawing function
- Days 3-4: Add color gradients and parameters
- Day 5: Integration testing

### Week 3: UI and Features
- Days 1-2: Create sidebar panel UI
- Days 3-4: Implement fader and advanced features
- Day 5: Performance optimization

### Week 4: Polish and Release
- Days 1-2: Cross-browser testing
- Days 3-4: Documentation and examples
- Day 5: Final integration and release

**Total Estimated Time**: 20 working days (4 weeks)

## Part 6: Success Criteria

### Functional Requirements
1. ✅ Display curvature combs on glyph outlines
2. ✅ Support cubic and quadratic Bézier curves
3. ✅ Provide controls for comb length, position, colors
4. ✅ Work with all supported font formats (UFO, designspace, TTF, OTF)
5. ✅ Toggle on/off via user settings

### Performance Requirements
1. ✅ Maintain 60 FPS during glyph editing
2. ✅ Handle complex glyphs (1000+ points) without lag
3. ✅ Efficient memory usage (cache appropriately)

### Quality Requirements
1. ✅ Code follows Fontra conventions and style
2. ✅ Comprehensive unit tests
3. ✅ Documentation and usage examples
4. ✅ Cross-browser compatibility

## Part 7: Risk Assessment and Mitigation

### Technical Risks
1. **Curvature Calculation Accuracy**
   - Risk: Numerical instability with certain curve configurations
   - Mitigation: Handle edge cases, use epsilon comparisons

2. **Performance with Complex Glyphs**
   - Risk: Slow rendering with many points
   - Mitigation: Implement caching, level of detail

3. **Browser Compatibility**
   - Risk: Canvas 2D API differences
   - Mitigation: Test across browsers, use standard APIs

### Integration Risks
1. **Plugin System Changes**
   - Risk: Fontra API changes break plugin
   - Mitigation: Follow official plugin documentation, use stable interfaces

2. **Coordinate System Issues**
   - Risk: Misalignment with glyph coordinates
   - Mitigation: Test with various font formats, validate coordinate transformations

## Part 8: Future Enhancements

### Short-term
1. Export curvature data as CSV
2. Curvature statistics (min, max, average)
3. Curvature continuity analysis

### Medium-term
1. Curvature-based glyph comparison
2. Integration with font validation tools
3. Curvature presets for common design tasks

### Long-term
1. Real-time curvature optimization suggestions
2. Machine learning for curve quality assessment
3. Collaboration features for curvature analysis

## Conclusion

The SpeedPunk plugin implementation will significantly enhance Fontra's type design capabilities by providing professional-grade curvature visualization. The modular architecture (visualization layer + sidebar panel) fits well with Fontra's plugin system, and the full algorithm port ensures feature parity with the original SpeedPunk plugin.

The implementation is estimated to take 4 weeks, with clear milestones and success criteria. The primary challenges are mathematical accuracy and performance optimization, both of which have clear mitigation strategies.

By following this plan, Fontra will gain a valuable tool for type designers to analyze and improve curve quality, maintaining its position as a modern, feature-rich browser-based font editor.