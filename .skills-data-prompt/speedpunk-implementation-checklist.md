# SpeedPunk Plugin Implementation Checklist

## Pre-Implementation Setup

### 1. Development Environment
- [ ] Ensure Fontra development environment is set up
- [ ] Run Fontra in dev mode: `fontra --dev --launch filesystem /path/to/fonts`
- [ ] Verify plugin loading works with existing plugins
- [ ] Set up hot-reloading for JavaScript changes

### 2. Code Structure Understanding
- [ ] Examine `src-js/views-editor/src/visualization-layer-definitions.js`
- [ ] Review existing visualization layers (guidelines, metrics, etc.)
- [ ] Study `src-js/fontra-core/src/var-path.js` for path iteration methods
- [ ] Look at `fontra-spacing-studio` panel implementation

### 3. Algorithm Verification
- [ ] Port Python curvature calculation to JavaScript
- [ ] Test with known mathematical cases (circles, lines)
- [ ] Compare results with original SpeedPunk plugin

## Phase 1: Core Curvature Module

### Step 1.1: Create `curvature.js`
**File**: `src-js/views-editor/src/curvature.js`

- [ ] **Point class** (optional, may use plain objects)
  ```javascript
  class Point {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    // Vector operations: add, subtract, multiply, divide, length
  }
  ```

- [ ] **solveCubicBezier function**
  ```javascript
  export function solveCubicBezier(p0, p1, p2, p3, t) {
    // Returns: { point, derivative1, derivative2 }
  }
  ```

- [ ] **solveCubicBezierCurvature function**
  ```javascript
  export function solveCubicBezierCurvature(point, derivative1, derivative2) {
    // Returns: curvature value κ
  }
  ```

- [ ] **Curvature at segment function**
  ```javascript
  export function getCurvatureAtT(segment, t) {
    // segment: { type, points }
    // Returns: { curvature, point, tangent, perpendicular }
  }
  ```

- [ ] **Segment processing function**
  ```javascript
  export function processSegment(segment, options) {
    // Returns array of curvature points with combs
  }
  ```

### Step 1.2: Quadratic Curve Support
- [ ] **Quadratic to cubic conversion**
  ```javascript
  export function quadraticToCubic(p0, p1, p2) {
    // Returns cubic control points
  }
  ```

- [ ] **Direct quadratic curvature** (alternative)
  ```javascript
  export function solveQuadraticBezierCurvature(p0, p1, p2, t) {
    // Quadratic Bézier curvature formula
  }
  ```

### Step 1.3: Color Interpolation
- [ ] **Color utility functions**
  ```javascript
  export function hexToRgb(hex) {
    // Convert hex color to RGB
  }
  
  export function lerpColor(color1, color2, t) {
    // Linear interpolation between colors
  }
  
  export function interpolateCurvatureColor(curvature, min, max, colors) {
    // Get color for curvature value
  }
  ```

### Step 1.4: Testing
- [ ] **Unit tests for curvature calculation**
  - [ ] Test with straight line (curvature = 0)
  - [ ] Test with circular arc (constant curvature)
  - [ ] Test with known curves from mathematical references

- [ ] **Integration test with Fontra path data**
  - [ ] Load sample glyph
  - [ ] Extract segments
  - [ ] Calculate curvature for each segment

## Phase 2: Visualization Layer

### Step 2.1: Register Visualization Layer
**Modify**: `src-js/views-editor/src/visualization-layer-definitions.js`

- [ ] **Add layer definition**
  ```javascript
  registerVisualizationLayerDefinition({
    identifier: "fontra.curvature.comb",
    name: "Curvature Combs",
    selectionFunc: glyphSelector("editing"),
    userSwitchable: true,
    defaultOn: false,
    zIndex: 100,
    screenParameters: { /* parameters */ },
    colors: { /* colors */ },
    colorsDarkMode: { /* dark mode colors */ },
    draw: drawCurvatureCombs
  });
  ```

- [ ] **Define screen parameters**
  - [ ] `combLengthFactor: 0.01` (default)
  - [ ] `strokeWidth: 1`
  - [ ] `illustrationPosition: "outsideOfGlyph"` (options: "outsideOfGlyph", "outsideOfCurve")
  - [ ] `curveGain: 1.0`
  - [ ] `useFader: false`
  - [ ] `faderValue: 0.5`

- [ ] **Define color parameters**
  - [ ] `combColorLow: "#8b939c"`
  - [ ] `combColorMid: "#f29400"`
  - [ ] `combColorHigh: "#e3004f"`
  - [ ] Dark mode equivalents

### Step 2.2: Implement Draw Function
- [ ] **Main draw function**
  ```javascript
  function drawCurvatureCombs(context, positionedGlyph, parameters, model, controller) {
    // 1. Get glyph path
    // 2. Iterate through contours
    // 3. For each segment:
    //    - Calculate curvature at multiple t values
    //    - Draw perpendicular lines (combs)
    //    - Apply gradient colors
  }
  ```

- [ ] **Segment iteration logic**
  - [ ] Use `positionedGlyph.glyph.path.iterContourDecomposedSegments()`
  - [ ] Filter for cubic and quadratic segments (skip lines)
  - [ ] Handle closed vs open contours

- [ ] **Comb drawing logic**
  ```javascript
  function drawComb(context, curvePoint, curvature, tangent, parameters) {
    // 1. Calculate perpendicular vector
    // 2. Determine length = |curvature| × gain × factor
    // 3. Calculate start/end points
    // 4. Draw line with appropriate color
  }
  ```

- [ ] **Gradient color application**
  - [ ] Calculate min/max curvature for glyph
  - [ ] Normalize curvature values
  - [ ] Apply color gradient based on normalized value

### Step 2.3: Parameter Integration
- [ ] **Access parameters in draw function**
  ```javascript
  const {
    combLengthFactor,
    strokeWidth,
    illustrationPosition,
    curveGain,
    useFader,
    faderValue
  } = parameters;
  ```

- [ ] **Apply parameters to drawing**
  - [ ] Scale comb length by `combLengthFactor × curveGain`
  - [ ] Set line width to `strokeWidth`
  - [ ] Apply fader effect if enabled

### Step 2.4: Testing
- [ ] **Visual testing**
  - [ ] Enable curvature layer in user settings
  - [ ] Load various glyphs
  - [ ] Verify combs display correctly
  - [ ] Test with different parameter values

- [ ] **Performance testing**
  - [ ] Test with simple glyphs (few points)
  - [ ] Test with complex glyphs (many points)
  - [ ] Verify 60 FPS during editing

## Phase 3: Sidebar Panel

### Step 3.1: Create Panel File
**Create**: `src-js/views-editor/src/panel-speedpunk.js`

- [ ] **Panel class structure**
  ```javascript
  export class SpeedPunkPanel {
    identifier = "curvature-analysis";
    iconPath = "./speedpunk-icon.svg";
    
    static styles = `/* CSS styles */`;
    
    constructor(editorController) {
      this.editorController = editorController;
      // Initialize
    }
    
    getContentElement() {
      // Build UI
    }
    
    destroy() {
      // Cleanup
    }
  }
  ```

- [ ] **UI controls**
  - [ ] Enable/disable toggle
  - [ ] Comb length slider (0.1 - 3.0)
  - [ ] Illustration position radio buttons
  - [ ] Color gradient preview
  - [ ] Fader checkbox and slider
  - [ ] Reset button

### Step 3.2: Parameter Synchronization
- [ ] **Initialize from layer settings**
  ```javascript
  const settings = this.editorController.visualizationLayersSettings;
  const params = settings.model["fontra.curvature.comb.*"];
  // Set UI values from params
  ```

- [ ] **Update layer when UI changes**
  ```javascript
  onCombLengthChange(value) {
    this.editorController.visualizationLayersSettings
      .model["fontra.curvature.comb.combLengthFactor"] = value;
  }
  ```

- [ ] **Listen to layer changes**
  ```javascript
  settings.addKeyListener(
    ["fontra.curvature.comb.combLengthFactor"],
    (event) => { this.updateUI(event.newValue); }
  );
  ```

### Step 3.3: Panel Registration
- [ ] **Register panel in editor**
  Modify `src-js/views-editor/src/editor.js`:
  ```javascript
  import { SpeedPunkPanel } from "./panel-speedpunk.js";
  
  // In editor initialization:
  this.addSidebarPanel(new SpeedPunkPanel(this), "right");
  ```

- [ ] **Create icon file** (optional)
  - [ ] Simple SVG icon for the panel
  - [ ] Add to `src-js/views-editor/assets/` or similar

### Step 3.4: Testing
- [ ] **UI functionality**
  - [ ] Panel appears in sidebar
  - [ ] Controls work (sliders, buttons, etc.)
  - [ ] Settings persist between sessions

- [ ] **Integration testing**
  - [ ] UI changes update visualization
  - [ ] Visualization changes update UI
  - [ ] Both work together seamlessly

## Phase 4: Advanced Features

### Step 4.1: Fader Functionality
- [ ] **Implement fader logic**
  ```javascript
  function applyFader(curvature, faderValue, useFader) {
    if (!useFader) return 1.0; // Full opacity
    
    const normalized = (curvature - min) / (max - min);
    if (normalized > faderValue) {
      // Above threshold: fade out
      const d = normalized - faderValue;
      const hysteresis = 0.2;
      if (d > hysteresis) return 0.0;
      return 1.0 - d / hysteresis;
    }
    return 1.0; // Below threshold: full opacity
  }
  ```

- [ ] **Apply fader to drawing**
  - [ ] Adjust alpha/opacity based on fader value
  - [ ] Visual feedback in UI

### Step 4.2: Histogram (Optional)
- [ ] **Calculate curvature distribution**
- [ ] **Draw histogram in panel**
- [ ] **Update with fader slider**

### Step 4.3: Performance Optimization
- [ ] **Implement caching**
  ```javascript
  class CurvatureCache {
    // Cache curvature calculations per glyph
  }
  ```

- [ ] **Batch drawing operations**
  - [ ] Group combs by color
  - [ ] Single beginPath/stroke call per color group

- [ ] **Level of detail**
  - [ ] Adjust calculation density based on zoom level
  - [ ] Reduce points when zoomed out

## Phase 5: Integration and Testing

### Step 5.1: Final Integration
- [ ] **Ensure all components work together**
  - [ ] Visualization layer
  - [ ] Sidebar panel
  - [ ] Parameter synchronization

- [ ] **Clean up code**
  - [ ] Remove console.log statements
  - [ ] Add proper comments
  - [ ] Follow Fontra coding style

### Step 5.2: Comprehensive Testing
- [ ] **Test with various font formats**
  - [ ] UFO files
  - [ ] Designspace files
  - [ ] TTF files
  - [ ] OTF files

- [ ] **Edge case testing**
  - [ ] Glyphs with no curves
  - [ ] Glyphs with only lines
  - [ ] Mixed cubic and quadratic curves
  - [ ] Very complex glyphs (1000+ points)

- [ ] **Browser compatibility**
  - [ ] Chrome
  - [ ] Firefox
  - [ ] Safari
  - [ ] Edge

### Step 5.3: Documentation
- [ ] **Create README for plugin**
- [ ] **Add usage instructions**
- [ ] **Document keyboard shortcuts** (if any)
- [ ] **Add to Fontra documentation**

## Phase 6: Polish and Release

### Step 6.1: User Experience
- [ ] **Add tooltips to controls**
- [ ] **Improve UI layout and styling**
- [ ] **Add visual feedback for interactions**

### Step 6.2: Error Handling
- [ ] **Handle invalid glyphs gracefully**
- [ ] **Add error messages for edge cases**
- [ ] **Prevent crashes with malformed data**

### Step 6.3: Final Checks
- [ ] **Run linter and fix issues**
- [ ] **Run type checker (if applicable)**
- [ ] **Test performance with large fonts**
- [ ] **Verify memory usage is reasonable**

### Step 6.4: Release Preparation
- [ ] **Create pull request**
- [ ] **Write changelog entry**
- [ ] **Update version number** (if applicable)
- [ ] **Merge to main branch**

## Post-Implementation

### Maintenance
- [ ] **Monitor for issues**
- [ ] **Collect user feedback**
- [ ] **Plan future enhancements**

### Future Enhancements
- [ ] **Export curvature data**
- [ ] **Curvature analysis tools**
- [ ] **Integration with other Fontra features**
- [ ] **Machine learning integration** (long-term)

## Quick Reference Commands

### Development
```bash
# Run Fontra in dev mode
fontra --dev --launch filesystem /path/to/fonts

# Build client (if needed)
npm run bundle

# Run tests
npm test  # JavaScript tests
pytest    # Python tests
```

### File Locations
- **Visualization layers**: `src-js/views-editor/src/visualization-layer-definitions.js`
- **Editor initialization**: `src-js/views-editor/src/editor.js`
- **Panel template**: `src-js/views-editor/src/panel-*.js`
- **Path utilities**: `src-js/fontra-core/src/var-path.js`

### Key Functions to Import
```javascript
// From var-path.js
path.iterContourDecomposedSegments(contourIndex)

// From visualization-layer-definitions.js
registerVisualizationLayerDefinition()
strokeLine(context, x1, y1, x2, y2)
glyphSelector(mode)
```

## Estimated Timeline
- **Phase 1**: 2-3 days (core algorithm)
- **Phase 2**: 2-3 days (visualization layer)
- **Phase 3**: 1-2 days (sidebar panel)
- **Phase 4**: 1-2 days (advanced features)
- **Phase 5**: 2-3 days (integration/testing)
- **Phase 6**: 1-2 days (polish/release)

**Total**: 9-15 working days

## Success Criteria
1. ✅ Curvature combs display correctly on all curve types
2. ✅ Controls in sidebar panel affect visualization
3. ✅ Plugin works with all supported font formats
4. ✅ Performance is acceptable (60 FPS during editing)
5. ✅ Code follows Fontra conventions and passes linting
6. ✅ Documentation is complete and accurate