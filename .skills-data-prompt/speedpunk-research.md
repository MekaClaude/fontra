# SpeedPunk Research: Algorithm Analysis and Fontra Integration

## 1. SpeedPunk Algorithm Deep Dive

### 1.1 Mathematical Foundation

**Bézier Curve Mathematics**:
A cubic Bézier curve is defined by four control points: P0 (start), P1, P2, P3 (end).

**Parametric Form**:
```
B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
where t ∈ [0, 1]
```

**First Derivative (Tangent Vector)**:
```
B'(t) = 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)
```

**Second Derivative (Curvature Change)**:
```
B''(t) = 6(1-t)(P2-2P1+P0) + 6t(P3-2P2+P1)
```

**Curvature Formula**:
For a parametric curve (x(t), y(t)), curvature κ is:
```
κ = |x'y'' - y'x''| / (x'² + y'²)^(3/2)
```

Where:
- x' = dx/dt, y' = dy/dt (first derivatives)
- x'' = d²x/dt², y'' = d²y/dt² (second derivatives)

**SpeedPunk Implementation**:
From `speedpunklib.py`, the curvature calculation is:
```python
def solveCubicBezierCurvature(r, r1, r2):
    return (r1.x * r2.y - r1.y * r2.x) / (r1.x**2 + r1.y**2)**1.5
```

Where:
- r = point on curve
- r1 = first derivative vector
- r2 = second derivative vector

**Key Insight**: Curvature can be positive or negative, indicating direction of bend.

### 1.2 Visualization Algorithm

**Comb Drawing**:
1. For each point on curve at parameter t:
   - Calculate curvature κ(t)
   - Compute perpendicular vector to tangent
   - Draw line from curve point to curve point + (perpendicular × κ × gain)

**Perpendicular Vector Calculation**:
For tangent vector (dx, dy):
- Perpendicular options: (-dy, dx) or (dy, -dx)
- SpeedPunk chooses based on "illustration position" setting

**Length Scaling**:
```
length = |curvature| × gain × unitsPerEm² × drawfactor
```
Where:
- `gain` = user-controlled parameter (default 1.0)
- `unitsPerEm` = font's UPM (typically 1000)
- `drawfactor` = 0.01 (constant)

**Color Mapping**:
SpeedPunk uses 3-color gradient:
- Low curvature: #8b939c (gray)
- Medium curvature: #f29400 (orange)
- High curvature: #e3004f (red)

Color interpolation based on normalized curvature value.

## 2. Fontra Integration Points

### 2.1 Path Data Access

**Fontra Path Structure**:
In `var-path.js`, paths are stored as:
- `coordinates`: VarArray of x,y coordinates
- `pointTypes`: Array of point type flags (on-curve, off-curve cubic/quad)
- `contourInfo`: Array of contour metadata

**Key Methods for Iteration**:
```javascript
// Iterate through all contours
for (const contour of path.iterUnpackedContours()) {
  // contour.points: array of {x, y, type}
  // contour.isClosed: boolean
}

// Iterate through segments (recommended for SpeedPunk)
for (const segment of path.iterContourDecomposedSegments(contourIndex)) {
  // segment.type: "line", "cubic", "quad"
  // segment.points: array of 2-4 points
  // segment.pointIndices: original indices
}
```

**Segment Structure**:
For cubic segments:
```javascript
{
  type: "cubic",
  points: [
    {x: x0, y: y0},  // on-curve start
    {x: x1, y: y1},  // off-curve handle 1
    {x: x2, y: y2},  // off-curve handle 2  
    {x: x3, y: y3}   // on-curve end
  ]
}
```

For quadratic segments:
```javascript
{
  type: "quad",
  points: [
    {x: x0, y: y0},  // on-curve start
    {x: x1, y: y1},  // off-curve handle
    {x: x2, y: y2}   // on-curve end
  ]
}
```

### 2.2 Visualization Layer Integration

**Layer Definition Structure**:
```javascript
{
  identifier: "fontra.curvature.comb",
  name: "Curvature Combs",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: false,
  zIndex: 100,
  screenParameters: { /* user-adjustable parameters */ },
  colors: { /* color definitions */ },
  draw: drawFunction
}
```

**Draw Function Signature**:
```javascript
function drawCurvatureCombs(context, positionedGlyph, parameters, model, controller) {
  // context: CanvasRenderingContext2D
  // positionedGlyph: { x, y, glyph: { path, ... } }
  // parameters: screenParameters values
  // model: additional data model
  // controller: editor controller
}
```

**Drawing Context**:
- Canvas 2D API available via `context`
- Coordinate system: glyph coordinates (not screen coordinates)
- Use `positionedGlyph.x` and `positionedGlyph.y` for offset

### 2.3 Sidebar Panel Integration

**Panel Class Structure**:
```javascript
export class SpeedPunkPanel {
  identifier = "curvature-analysis";
  iconPath = "./speedpunk-icon.svg";
  
  constructor(editorController) {
    this.editorController = editorController;
    this.fontController = editorController.fontController;
    this.sceneController = editorController.sceneController;
    this.visualizationLayersSettings = editorController.visualizationLayersSettings;
  }
  
  getContentElement() {
    // Return DOM element with controls
  }
  
  destroy() {
    // Cleanup listeners
  }
}
```

**Parameter Synchronization**:
```javascript
// Update visualization layer parameter
this.visualizationLayersSettings.model["fontra.curvature.comb.combLengthFactor"] = newValue;

// Listen to parameter changes
this.visualizationLayersSettings.addKeyListener(
  ["fontra.curvature.comb.combLengthFactor"],
  (event) => { /* update UI */ }
);
```

## 3. Quadratic Curve Handling

### 3.1 Conversion Approaches

**Approach 1: Convert Quadratic to Cubic**
For quadratic Bézier with P0, P1, P2:
```
Cubic control points:
Q0 = P0
Q1 = P0 + 2/3(P1 - P0)
Q2 = P2 + 2/3(P1 - P2)  
Q3 = P2
```

**Approach 2: Direct Quadratic Curvature**
Quadratic Bézier curvature formula:
```
B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
B'(t) = 2(1-t)(P1-P0) + 2t(P2-P1)
B''(t) = 2(P2-2P1+P0)

κ = (B'.x × B''.y - B'.y × B''.x) / |B'|³
```

**Recommendation**: Use conversion approach for consistency with existing code.

### 3.2 Special Cases

**Straight Lines (Linear Segments)**:
- Curvature = 0
- No combs should be drawn
- Skip in iteration

**Degenerate Curves**:
- Collinear control points (effectively lines)
- Handle with epsilon comparison for zero curvature

**Sharp Corners**:
- On-curve points with discontinuous curvature
- May want to draw separate combs for each segment

## 4. Performance Considerations

### 4.1 Calculation Optimization

**Caching Strategy**:
```javascript
class CurvatureCache {
  constructor() {
    this.cache = new Map(); // glyphName -> curvature data
  }
  
  getCurvatureData(glyph, forceRecalc = false) {
    const key = glyph.name + glyph.hash;
    if (!forceRecalc && this.cache.has(key)) {
      return this.cache.get(key);
    }
    const data = this.calculateCurvature(glyph);
    this.cache.set(key, data);
    return data;
  }
}
```

**Incremental Update**:
- Only recalculate changed segments
- Track which glyphs have been modified
- Clear cache on glyph edit

### 4.2 Drawing Optimization

**Level of Detail**:
```javascript
function getStepSize(magnification, segmentLength) {
  // More points when zoomed in, fewer when zoomed out
  const baseSteps = 10;
  const minSteps = 3;
  const maxSteps = 30;
  
  const scaleFactor = Math.max(0.5, Math.min(2, magnification));
  return Math.round(baseSteps * scaleFactor);
}
```

**Batch Drawing**:
```javascript
// Batch lines of same color/style
context.beginPath();
for (const comb of combs) {
  context.moveTo(comb.start.x, comb.start.y);
  context.lineTo(comb.end.x, comb.end.y);
}
context.strokeStyle = color;
context.lineWidth = width;
context.stroke();
```

### 4.3 Memory Management

**Point Objects**:
- Reuse point objects when possible
- Avoid creating new objects in tight loops
- Use typed arrays for large datasets

**Canvas State**:
- Save/restore canvas state minimally
- Batch state changes

## 5. Color System Design

### 5.1 Gradient Implementation

**Three-Color Gradient**:
```javascript
function interpolateColor(curvature, min, max, colors) {
  // Normalize curvature to [0, 1]
  const normalized = (curvature - min) / (max - min);
  
  if (normalized < 0.5) {
    // Interpolate between low and mid
    const t = normalized * 2;
    return lerpColor(colors.low, colors.mid, t);
  } else {
    // Interpolate between mid and high
    const t = (normalized - 0.5) * 2;
    return lerpColor(colors.mid, colors.high, t);
  }
}
```

**Color Interpolation**:
```javascript
function lerpColor(color1, color2, t) {
  const r1 = parseInt(color1.slice(1, 3), 16);
  const g1 = parseInt(color1.slice(3, 5), 16);
  const b1 = parseInt(color1.slice(5, 7), 16);
  
  const r2 = parseInt(color2.slice(1, 3), 16);
  const g2 = parseInt(color2.slice(3, 5), 16);
  const b2 = parseInt(color2.slice(5, 7), 16);
  
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  
  return `rgb(${r}, ${g}, ${b})`;
}
```

### 5.2 Dark Mode Support

**Color Adaptation**:
```javascript
const colorsLight = {
  low: "#8b939c",
  mid: "#f29400", 
  high: "#e3004f"
};

const colorsDark = {
  low: "#6b737c",
  mid: "#d27400",
  high: "#c3003f"
};

function getColors(isDarkMode) {
  return isDarkMode ? colorsDark : colorsLight;
}
```

## 6. Testing Strategy

### 6.1 Unit Tests

**Curvature Calculation Tests**:
```javascript
describe('Curvature Calculation', () => {
  test('straight line has zero curvature', () => {
    const p0 = {x: 0, y: 0};
    const p1 = {x: 1, y: 0};
    const p2 = {x: 2, y: 0};
    const p3 = {x: 3, y: 0};
    
    const result = solveCubicBezier(p0, p1, p2, p3, 0.5);
    expect(solveCubicBezierCurvature(result.point, result.derivative1, result.derivative2))
      .toBeCloseTo(0, 5);
  });
  
  test('circular arc has constant curvature', () => {
    // Approximate quarter circle with Bézier
    const curvature = calculateCurvatureForCircle();
    expect(curvature).toBeCloseTo(1/radius, 3);
  });
});
```

### 6.2 Visual Tests

**Test Glyphs**:
1. Simple curves (circles, arcs)
2. Mixed linear and curved segments
3. Complex real-world glyphs
4. Edge cases (sharp corners, collinear points)

**Comparison Tests**:
- Compare with original SpeedPunk output
- Validate against known curvature values

### 6.3 Performance Tests

**Benchmark Scenarios**:
1. Single glyph with 10 points
2. Complex glyph with 1000 points  
3. Multiple glyphs (font overview)
4. Real-time editing (60 FPS requirement)

**Metrics**:
- Calculation time per frame
- Memory usage
- Frame rate during editing

## 7. Browser Compatibility

### 7.1 Canvas 2D API Support

**Required Features**:
- `beginPath()`, `moveTo()`, `lineTo()`, `stroke()`
- `strokeStyle`, `lineWidth`, `setLineDash()`
- `createLinearGradient()` for advanced coloring

**Fallback Strategy**:
- Basic line drawing widely supported
- Gradient support may be optional
- Test across Chrome, Firefox, Safari, Edge

### 7.2 Performance Across Browsers

**Differences**:
- Chrome: Generally fastest Canvas 2D
- Firefox: Good performance, slightly different rendering
- Safari: May have performance quirks on macOS

**Mitigation**:
- Use standard APIs only
- Avoid browser-specific optimizations
- Test on target platforms

## 8. Future Extensions

### 8.1 Advanced Features

**Curvature Continuity Analysis**:
```javascript
function analyzeContinuity(glyph) {
  const issues = [];
  for (const contour of glyph.path.iterUnpackedContours()) {
    for (let i = 0; i < contour.points.length; i++) {
      const prev = getCurvatureAt(contour, i - 0.001);
      const next = getCurvatureAt(contour, i + 0.001);
      if (Math.abs(prev - next) > threshold) {
        issues.push({ pointIndex: i, discontinuity: Math.abs(prev - next) });
      }
    }
  }
  return issues;
}
```

**Export Features**:
- CSV export of curvature data
- SVG export of curvature combs
- Integration with font validation tools

### 8.2 Machine Learning Integration

**Potential Applications**:
- Train model to recognize "good" vs "bad" curves
- Suggest curve adjustments for better continuity
- Automated curve optimization

**Data Collection**:
- Curvature patterns from professional fonts
- User preferences and adjustments
- Quality metrics from type designers

## Conclusion

This research provides a comprehensive foundation for implementing SpeedPunk in Fontra. The mathematical foundation is well-established, and Fontra's architecture provides clear integration points. The main challenges are performance optimization and ensuring accurate curvature calculation across different curve types.

The implementation should focus on:
1. Accurate curvature calculation with proper edge case handling
2. Efficient drawing with caching and batch operations
3. Clean integration with Fontra's plugin system
4. Comprehensive testing across browsers and font formats

With careful implementation, the SpeedPunk plugin will provide Fontra users with professional-grade curvature visualization, enhancing the font editor's capabilities for type design quality analysis.