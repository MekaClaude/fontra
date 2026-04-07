# Meka Agent - Execution Checklist

## Active Goals

These are the ongoing goals for Fontra development and maintenance.

---

## Phase 1: Critical Stability (Completed 2026-04-07)

### Bug Fixes Applied

- [x] **1.1** Circular dependency in `edit-tools-triangle-guardian.js` → Fixed with lazy `import()`
- [x] **1.2** Undeclared `theTriangleGuardianTool` variable → Merged into `activeToolInstance`
- [x] **1.3** Duplicate `registerVisualizationLayerDefinition` → Removed duplicate block
- [x] **1.4** `updateWindowLocation` called before definition → Added `?.` optional chaining
- [x] **1.5** Local plugin webpack imports → Rewrote as self-contained module (zero imports)
- [x] **1.6** Windows build v2026.04.07.05 → Built successfully (71 MB)

### Commits Made

- [x] `52e89c778` — Fix Fontra core bugs and improve Triangle Guardian plugin
- [x] `c8b2312` — Bump version to 2026.04.07.05 (fontra-pak submodule)

---

## Phase 2: Code Quality (Not Started)

### Duplicate Code Audit

- [ ] **2.1** Search for duplicate `computeApex` implementations
  - Files: `edit-tools-triangle-guardian.js`, `triangle-guardian-geometry.js`, `triangle-guardian-layer.js`, `panel-triangle-guardian.js`
  - Action: Consolidate into single shared module
- [ ] **2.2** Search for duplicate `pointInTriangle` implementations
  - Same files as above
- [ ] **2.3** Search for duplicate `isDegenerate` implementations
  - Same files as above
- [ ] **2.4** Search for duplicate `registerVisualizationLayerDefinition` calls across entire codebase
  - Command: `grep -r "registerVisualizationLayerDefinition" src-js/ -A 10 | grep "identifier"`
- [ ] **2.5** Search for duplicate panel styling patterns
  - Command: `grep -r "static styles" src-js/ --include="*.js"`

### Linting & Static Analysis

- [ ] **2.6** Set up ESLint for `src-js/` directory
  - Rules: `no-undef`, `no-redeclare`, `no-duplicate-imports`, `no-unused-vars`
- [ ] **2.7** Add circular dependency detection to webpack build
  - Option A: `circular-dependency-plugin`
  - Option B: `madge --circular src-js/`
- [ ] **2.8** Run linter on entire codebase and fix findings

### API Standards Review

- [ ] **2.9** Verify all panel constructors call `super()` in correct order
  - Check every `class X extends Panel` file
  - Ensure `constructor(args) { super(args); }` pattern
- [ ] **2.10** Verify all visualization layers have unique identifiers
  - No two layers should share the same `identifier` string
- [ ] **2.11** Verify all local plugins use zero external imports
  - Each `start.js` should be self-contained
  - Access everything through `editor` parameter

---

## Phase 3: Testing & Reliability (Not Started)

### E2E Testing

- [ ] **3.1** Set up Playwright for E2E testing
- [ ] **3.2** Write test: Editor loads without console errors
- [ ] **3.3** Write test: All sidebar panels can be opened
- [ ] **3.4** Write test: Glyph editing works (move point, undo)
- [ ] **3.5** Write test: Triangle Guardian panel renders
- [ ] **3.6** Write test: Local plugin loads without 404 errors

### Dev Server Diagnostics

- [ ] **3.7** Create script to check server health after start
  - Verify HTTP status 200 on `http://localhost:PORT/`
  - Verify no 404s in server logs
  - Verify WebSocket connection established
- [ ] **3.8** Create console log parser
  - Parse browser console output
  - Categorize: errors, warnings, info
  - Flag critical errors automatically

---

## Phase 4: Build Automation (Not Started)

### Automated Build Script

- [ ] **4.1** Create `build-fontra.ps1` PowerShell script
  - Auto-detects GMT+1 timestamp
  - Updates `version-info.txt` (4 occurrences)
  - Updates `_version.py`
  - Runs `npm install && npm run bundle`
  - Runs PyInstaller with `--clean`
  - Creates versioned output folder
  - Runs `test-export.py`
  - Reports: "Build SUCCESS" or "Build FAILED: <reason>"
- [ ] **4.2** Test build script end-to-end
- [ ] **4.3** Add build script to documentation

---

## Issue Tracking Template

Use this template when tracking new issues:

```
### Issue #X: <Title>
- **Date discovered**: YYYY-MM-DD
- **Severity**: CRITICAL | HIGH | MEDIUM | LOW
- **Symptom**: What the user sees
- **Root cause**: Why it happens
- **Files affected**: List of files
- **Status**: Open | In Progress | Fixed | Verified
- **Fix applied**: Brief description
- **Verified by**: Manual testing | Automated test
```

---

## Session Log

| Date | Session | Summary | Outcome |
|------|---------|---------|---------|
| 2026-04-07 | Session 1 | Fix Fontra editor loading, fix Triangle Guardian plugin, build Windows exe | ✅ All goals met |
| | | Fixed 5 critical bugs in Fontra core | Editor loads and works |
| | | Built Fontra-Pak-v2026.04.07.05 (71 MB) | Windows build successful |
| | | Created Fontra Development Expert skill | Documentation complete |
| | | Created Meka Agent plan and checklist | Planning infrastructure in place |

---

## Quick Commands Reference

```powershell
# Stop any running Fontra server
taskkill /F /T /PID <pid> 2>nul

# Start dev server with auto-open
python run_server.py --launch --dev filesystem test-py/data/mutatorsans

# Get current version (GMT+1)
powershell -Command "[System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), [System.TimeZoneInfo]::FindSystemTimeZoneById('W. Europe Standard Time')).ToString('yyyy.MM.dd.HH')"

# Check for circular dependencies (requires madge)
npx madge --circular src-js/views-editor/src/

# Search for duplicate function definitions
grep -r "function computeApex\|function pointInTriangle\|function isDegenerate" src-js/ --include="*.js"

# Search for duplicate layer registrations
grep -r "registerVisualizationLayerDefinition" src-js/ --include="*.js" -B 1 -A 5 | grep "identifier"
```
