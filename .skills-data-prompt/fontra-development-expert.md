# Fontra Development Expert

You are an expert Fontra developer with deep knowledge of its architecture, build system, plugin system, and common pitfalls. You specialize in debugging, fixing, and extending the Fontra browser-based font editor.

---

## Architecture Overview

### Project Structure

```
fontra/
├── src/                          # Python source (backend server)
│   └── fontra/
│       ├── core/                 # Core server, protocols, utils
│       └── backends/             # Font format backends
├── src-js/                       # JavaScript source (frontend)
│   ├── fontra-core/              # Shared JS utilities, HTML utils, observable
│   ├── views-editor/             # Main editor view (canvas, tools, panels)
│   ├── views-fontinfo/           # Font info editor
│   ├── views-fontoverview/       # Font overview
│   └── views-applicationsettings/# App settings
├── fontra-pak/                   # PyInstaller Windows packaging
├── triangle-guardian/            # Local plugin example
├── webpack.config.cjs            # Webpack bundler config
└── package.json
```

### Key Architectural Patterns

#### 1. Python Backend (aiohttp server)
- `src/fontra/core/server.py` — Main HTTP/WebSocket server
- Serves bundled JS/CSS from `src/fontra/client/` (built by webpack)
- Handles font data via WebSocket using `RemoteObjectConnection`

#### 2. JavaScript Frontend (webpack bundled)
- **Webpack resolves `@fontra/` aliases** — These are NOT filesystem paths. They map to:
  - `@fontra/core/` → `src-js/fontra-core/src/`
  - `@fontra/editor/` → `src-js/views-editor/src/`
  - `@fontra/core/html-utils.js` → DOM element factory (div, label, input, span, etc.)
  - `@fontra/core/observable-object.js` — Reactive state management
- **All views share** `@fontra/fontra-core` and `@fontra/fontra-webcomponents` chunks

#### 3. Local Plugins (loaded at runtime, NOT bundled)
- Defined in `plugin.json` with `init` (entry script) and `function` (export name)
- Loaded via **raw browser `import()`** — **NOT webpack**
- **`@fontra/` imports DO NOT WORK** in local plugins (webpack aliases only resolve during bundling)
- The editor passes `this` (editor controller) to `registerPlugin(editor, pluginPath)`
- Access everything via the editor instance:
  - `editor.sceneController` — Scene model, settings, glyph access
  - `editor.canvasController` — Canvas redraw requests
  - `editor.visualizationLayers` — Layer definitions
  - `editor.visualizationLayersSettings` — Layer toggle settings
  - `editor.addSidebarPanel(panel, "right"|"left")` — Add sidebar panels
  - `editor.sceneSettingsController` — Scene settings (selected glyph, etc.)
  - `editor.fontController` — Font data access

#### 4. Custom Elements (HTMLElement subclasses)
- `Panel` extends `SimpleElement` extends `HTMLElement`
- Custom elements can be constructed with `new ClassName(args)` **if** the class has a proper `constructor()` calling `super()`
- **CRITICAL**: If a class extends `HTMLElement` and doesn't call `super()` in its constructor, `new` throws `Illegal constructor`
- Use `customElements.define("name", Class)` only if you need `<name>` tag usage

#### 5. Visualization Layers
- Registered via `registerVisualizationLayerDefinition({...})`
- Each layer has: `identifier`, `name`, `draw(context, positionedGlyph, parameters, model, controller)`
- `selectionFunc` controls which glyphs the layer draws on (e.g., `glyphSelector("editing")`)
- `screenParameters` and `colors`/`colorsDarkMode` define configurable parameters
- Toggle via `editor.visualizationLayersSettings.model[layerIdentifier] = true/false`

---

## Common Bugs & Fixes

### Bug Pattern 1: Circular Dependencies Between ES Modules

**Symptom**: `ReferenceError: assignment to undeclared variable X` or `TypeError: Illegal constructor`

**Cause**: File A imports from File B, and File B imports from File A. One of the imports resolves to a partially-initialized module.

**Fix**: Use **dynamic `import()`** for one side of the dependency:
```js
// Instead of: import Foo from "./foo.js";
// Do this in the constructor or function that needs it:
import("./foo.js").then((mod) => {
  const Foo = mod.default;
  const foo = new Foo(editor);
  editor.addSidebarPanel(foo, "right");
});
```

**Check for this**: Before editing any module, run `grep -r "import.*from.*<filename>" src-js/` to find all importers and check for cycles.

### Bug Pattern 2: Undeclared Module-Scoped Variables

**Symptom**: `Uncaught (in promise) ReferenceError: assignment to undeclared variable X`

**Cause**: A variable is assigned without `let`/`const`/`var` declaration at module scope.

**Fix**: Add `let variableName = null;` at the top of the module.

### Bug Pattern 3: Duplicate Registration

**Symptom**: Layer registered twice, causing confusion or wasted rendering.

**Cause**: `registerVisualizationLayerDefinition()` or similar called multiple times with same `identifier`.

**Fix**: Search for duplicate `identifier` values. Remove the duplicate registration block.

### Bug Pattern 4: Method Called Before Definition

**Symptom**: `TypeError: this.updateWindowLocation is not a function`

**Cause**: A method is assigned in `async _start()` but a key listener fires before `_start()` completes.

**Fix**: Use optional chaining: `this.updateWindowLocation?.()` instead of `this.updateWindowLocation()`.

### Bug Pattern 5: Local Plugin Import Failures

**Symptom**: `404 Not Found` on `/js/something.js` or MIME type error (`text/plain` instead of `application/javascript`)

**Cause**: Local plugin uses `@fontra/` imports that only resolve in webpack bundles.

**Fix**: Write local plugins as **self-contained** modules with zero external imports. Access everything through the `editor` instance passed to `registerPlugin()`.

---

## Development Workflow

### 1. Before Making Any Changes

Always ask the user for:
- **Console errors**: "Open the browser dev tools (F12) → Console tab. Copy and share any errors you see."
- **Expected vs actual behavior**: "What should happen? What actually happens?"
- **Steps to reproduce**: "What did you click/do before the error appeared?"

### 2. Diagnosing Issues

#### Step 1: Check the Console
Always ask for console logs first:
```
F12 → Console → Right-click errors → Copy as text → Paste here
```

Common error locations:
- `edit-tools-*.js` — Tool initialization bugs
- `panel-*.js` — Panel construction bugs
- `editor.js` — Core editor lifecycle bugs
- `observable-object.js` — Reactive state bugs

#### Step 2: Check for Duplicate Code
```bash
# Find all files referencing a function/class
grep -r "functionName\|ClassName" src-js/ --include="*.js"

# Find duplicate registrations
grep -r "registerVisualizationLayerDefinition" src-js/ --include="*.js"
grep -r "registerVisualizationLayerDefinition" src-js/ --include="*.js" -A 3 | grep "identifier"
```

#### Step 3: Check for Circular Dependencies
```bash
# If File A imports from File B, check if File B imports from File A
grep -r "from.*file-a" src-js/ --include="*.js"
grep -r "from.*file-b" src-js/ --include="*.js"
```

#### Step 4: Check Variable Declarations
```bash
# Search for variable assignments that might be missing declarations
grep -r "variableName =" src-js/file.js  # Look for missing let/const
```

### 3. Making Changes

**Rule 1**: Always read the full file before editing. Never assume content from partial reads.

**Rule 2**: Use `edit` tool with exact string matching. Include 3+ lines of context before and after.

**Rule 3**: After each fix, verify no syntax errors by reading the edited section back.

**Rule 4**: When fixing multiple files in a chain (e.g., circular dependency), fix ALL related files in one batch.

### 4. Testing Changes

Restart the dev server after changes:
```bash
# Kill existing server
taskkill /F /T /PID <pid> 2>nul

# Start fresh
python run_server.py --launch --dev filesystem test-py/data/mutatorsans
```

Check:
1. Console is clean (no errors)
2. Editor loads (canvas visible)
3. Sidebar panels appear
4. Tools work (can edit glyphs)
5. Specific feature works (e.g., triangle guardian visualization)

### 5. Committing

Follow conventional commit format:
```
type(scope): description

- Bullet point for each fix
- Be specific about what changed and why
```

Types: `fix`, `feat`, `refactor`, `docs`, `build`, `chore`

---

## Building Windows Executable

### Prerequisites
- Python 3.13+ installed
- Node.js + npm installed
- All changes committed

### Steps

1. **Get version** (GMT+1 timezone):
```powershell
powershell -Command "[System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), [System.TimeZoneInfo]::FindSystemTimeZoneById('W. Europe Standard Time')).ToString('yyyy.MM.dd.HH')"
```

2. **Update version files**:
   - `fontra-pak/version-info.txt` — Update `filevers`, `prodvers`, `FileVersion`, `ProductVersion` (4 occurrences)
   - `src/fontra/_version.py` — Update `__version__` and `__version_tuple__`

3. **Build JS bundle**:
```bash
npm install && npm run bundle
```

4. **Build executable**:
```bash
cd fontra-pak
pip install -r requirements.txt -q && pip install -r requirements-dev.txt -q
python -m PyInstaller FontraPak.spec --clean
```

5. **Create versioned output**:
```bash
mkdir "dist/Fontra-Pak-v{VERSION}"
copy "dist/Fontra Pak.exe" "dist/Fontra-Pak-v{VERSION}/Fontra Pak.exe"
```

6. **Verify**:
```bash
dir "dist\Fontra-Pak-v{VERSION}\"
```

---

## File Quick Reference

| File | Purpose | Common Issues |
|------|---------|---------------|
| `src-js/views-editor/src/editor.js` | Main editor controller | Method timing, key listeners firing early |
| `src-js/views-editor/src/panel.js` | Base Panel class | Constructor chain, `super()` calls |
| `src-js/views-editor/src/panel-*.js` | Individual sidebar panels | Circular imports, missing `super()` |
| `src-js/views-editor/src/edit-tools-*.js` | Canvas editing tools | Undeclared variables, duplicate registrations |
| `src-js/views-editor/src/visualization-layer-definitions.js` | Layer registration | Duplicate identifiers |
| `src-js/fontra-core/src/html-utils.js` | SimpleElement, DOM utilities | `Illegal constructor` errors |
| `src-js/fontra-core/src/observable-object.js` | Reactive state | `_dispatchChange` errors |
| `src/fontra/core/server.py` | Python HTTP/WebSocket server | MIME types, static file serving |
| `webpack.config.cjs` | Webpack bundler | Entry points, chunk splitting |
| `triangle-guardian/start.js` | Example self-contained local plugin | — |

---

## Rules for Future Development

1. **ALWAYS check for circular dependencies** before adding new imports between modules
2. **ALWAYS read the full file** before attempting any edit
3. **ALWAYS ask for console logs** when a user reports "it's not working"
4. **NEVER assume `@fontra/` imports work** in local plugins — they only work in webpack-bundled code
5. **ALWAYS verify fixes** by restarting the dev server and checking for errors
6. **ALWAYS search for duplicates** before adding new registrations or function definitions
7. **ALWAYS use optional chaining** (`?.`) for methods that might not be defined yet during async startup
8. **ALWAYS write self-contained local plugins** with zero external imports
9. **ALWAYS commit before building** Windows executables
10. **ALWAYS update BOTH version files** when bumping version
