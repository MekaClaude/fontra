# Build Fontra Windows Bundle

## Overview

This skill builds a standalone Windows executable (`.exe`) from the Fontra font editor source code using PyInstaller. It creates versioned builds to preserve history and enable easy rollback.

The Windows build lives in the **`fontra-pak/`** sub-repository (a fork of
`https://github.com/fontra/fontra-pak`). It is a separate git repository that
is *not* a submodule: `git submodule status` fails on it, and the parent repo
only tracks its commit pointer.

## Version Convention

- **Timezone**: GMT+1 (Europe/Paris) - used for version hour
- **Format**: `YYYY.MM.DD.HH` (e.g., `2026.03.20.14`)
- **Output folder**: `Fontra-Pak-v{VERSION}` (e.g., `Fontra-Pak-v2026.03.20.14`)
- **Policy**: Always creates NEW folder - never overwrites or deletes previous builds

### There is exactly ONE version to set

`src/fontra/_version.py`:

```python
__version__ = version = '2026.03.20.14'
__version_tuple__ = version_tuple = (2026, 3, 20, 14)
```

`fontra-pak/FontraPak.spec` builds the Windows version resource from the
installed package (`from fontra import __version__ as fontraVersion`), so this
single file is the source of truth for the `.exe`'s file properties. There is
no `version-info.txt` any more - do not re-introduce one, a second source of
truth is exactly what used to drift out of sync.

The build script stamps the file and then *verifies* that the installed
package reports it, so a stale or non-editable install fails the build loudly
instead of producing an `.exe` with the wrong version.

## Prerequisites

1. Python 3.13 or higher installed
2. Node.js and npm installed
3. Fontra source code cloned
4. All source code changes committed or stashed
5. **The virtualenv's `Scripts` folder is on `PATH`** - see below

### The `sr-aef` PATH requirement

Upstream Fontra added `sr-aef` (a feature-extraction helper) as a runtime
dependency. It is installed as a console script into the virtualenv's
`Scripts` folder, and the opentype backend calls it as a bare
`subprocess.run(["sr-aef", path])`. If `Scripts` is not on `PATH`, the
opentype backend and its tests fail with:

```
FileNotFoundError: [WinError 2] The system cannot find the file specified
```

In PowerShell, for the current shell:

```powershell
$env:Path = "$(Resolve-Path venv\Scripts);$env:Path"
```

The same applies to the build: `build-timestamped.py` installs into the
virtualenv it is run with, and `FontraPak.spec` imports `fontra` from it, so
**run the build with the virtualenv's Python**:

```bash
cd fontra-pak
../venv/Scripts/python.exe build-timestamped.py
```

## Build Steps

### Step 1: Pre-Build Checklist

```bash
# 1. Stop any running Fontra server
taskkill /F /FI "IMAGENAME eq python.exe" 2>/dev/null

# 2. Navigate to fontra-pak directory
cd fontra-pak
```

### Step 2: Determine Version

The version is based on the current date/time in GMT+1 timezone:

```bash
# Get current version (GMT+1)
TZ=Europe/Paris date "+%Y.%m.%d.%H"
# Example output: 2026.03.20.14
```

### Step 3: Update the Version File

Edit `src/fontra/_version.py` to set the new version:

```python
__version__ = version = '2026.03.20.14'
__version_tuple__ = version_tuple = (2026, 3, 20, 14)
```

The automated build script does this for you (see "Quick Build Command").

### Step 4: Optional - Replace Application Icon

Custom icons are stored in `.skills-data-prompt/fontra-dev-logo/`:

| File | Description | Format |
|------|-------------|--------|
| `FontraIconDev.ico` | Development variant icon | ICO |
| `FontraIcon.ico` | Original production icon | ICO |
| `FontraIcon.png` | High-quality PNG (needs conversion) | PNG |

To use a custom icon:
```bash
# Replace the default icon
cp ".skills-data-prompt/fontra-dev-logo/FontraIconDev.ico" fontra-pak/icon/FontraIcon.ico
```

To restore original icon after build:
```bash
git checkout fontra-pak/icon/FontraIcon.ico
```

The fork's icon is generated from `fontra-pak/icon/fontra-icon-source.svg`;
regenerate it with:

```bash
cd fontra-pak && python scripts/convert-icons-simple.py
```

### Step 5: Install Dependencies

```bash
# Python dependencies
pip install -r fontra-pak/requirements.txt
pip install -r fontra-pak/requirements-dev.txt
```

`requirements-dev.txt` deliberately keeps `delocate` commented out: it is
macOS-only and this build targets Windows.

### Step 6: Build JavaScript Bundle

```bash
# From fontra root directory
cd ..
npm install
npm run bundle
```

### Step 7: Build Windows Executable

```bash
# Back to fontra-pak directory
cd fontra-pak

# Run PyInstaller
python -m PyInstaller FontraPak.spec --clean
```

### Step 8: Create Versioned Output Folder

```bash
# Create folder and copy executable
mkdir -p dist/Fontra-Pak-v2026.03.20.14
cp "dist/Fontra Pak.exe" "dist/Fontra-Pak-v2026.03.20.14/Fontra Pak.exe"
```

### Step 9: Verify Build

```bash
# Check output
ls -la fontra-pak/dist/Fontra-Pak-v2026.03.20.14/

# Run export test (optional but recommended)
python fontra-pak/test-export.py
```

## Quick Build Command

For convenience, use the automated build script:

```bash
cd fontra-pak
python build-timestamped.py
```

This script automatically:
1. Checks Python version
2. Generates timestamped version
3. Installs dependencies
4. Installs the parent Fontra package in editable mode
5. Builds JS bundle
6. Stamps `../src/fontra/_version.py` and verifies `fontra.__version__`
7. Builds Windows executable
8. Creates versioned output folder

## Build Output

### Location
```
fontra-pak/dist/Fontra-Pak-v{VERSION}/Fontra Pak.exe
```

### Example
```
fontra-pak/dist/Fontra-Pak-v2026.03.20.14/Fontra Pak.exe
```

### Build History
All previous builds are preserved in `fontra-pak/dist/`:

```
fontra-pak/dist/
├── Fontra-Pak-v2026.03.20.14/    # Latest
├── Fontra-Pak-v2026.03.20.13/     # Previous
├── Fontra-Pak-v2026.03.20.12/     # etc.
└── ...
```

## Testing the Build

### Basic Launch Test
1. Navigate to `fontra-pak/dist/Fontra-Pak-v{VERSION}/`
2. Double-click `Fontra Pak.exe`
3. Verify the application launches correctly
4. Check the icon in taskbar matches expected

### Export Functionality Test
```bash
python fontra-pak/test-export.py
```

Expected output:
```
Testing OTF/TTF Export Functionality
==================================================
1. Testing fontra_compile imports...      [OK]
2. Testing fontTools imports...          [OK]
3. Testing fontmake imports...           [OK]
4. Testing ufo2ft imports...             [OK]
5. Testing Fontra workflow actions...    [OK]
6. Testing Fontra export modules...      [OK]
7. Testing basic font compilation...      [SKIP]

TEST SUMMARY
==================================================
Passed: 7, Failed: 0
All core modules imported successfully!
OTF/TTF export should work correctly
```

### Check the version landed in the exe
```bash
# The version resource comes from fontra.__version__
python -c "import fontra; print(fontra.__version__)"
# Then compare with the "File version" shown in Explorer's file properties
```

## Common Issues

### Issue: "No module named 'fontra'"
**Solution**: Install fontra in editable mode
```bash
pip install -e .
```

### Issue: "No module named 'sr-aef'" / `FileNotFoundError` on `sr-aef`
**Solution**: The virtualenv's `Scripts` folder is not on `PATH`
```powershell
$env:Path = "$(Resolve-Path venv\Scripts);$env:Path"
```

### Issue: "the built exe reports the wrong version"
**Solution**: The fontra package is not installed in editable mode, so the
spec reads a stale `__version__`. Re-install and re-stamp:
```bash
pip install -e ..
python build-timestamped.py
```

### Issue: JS bundle not updating
**Solution**: Clear webpack cache and rebuild
```bash
rm -rf node_modules/.cache
npm run bundle
```

### Issue: PyInstaller fails with icon error
**Solution**: Check icon file exists and is valid ICO format
```bash
ls -la fontra-pak/icon/FontraIcon.ico
```

### Issue: Old version still showing
**Solution**: Rebuild with clean cache
```bash
python -m PyInstaller FontraPak.spec --clean
```

## Checking the build did not break the source tree

After a build, `src/fontra/_version.py` and the client bundle in
`src/fontra/client/` are modified. Commit them (or revert them) before
switching branches:

```bash
git status
npm test                       # 1212 core + 171 plugin tests
python fontra-pak/test-export.py
```

`npm test` now also runs the local plugin suites (`npm run test:plugins`),
which cover the plugins in `src/fontra/localplugins/`.

## Keeping `fontra-pak` in sync with upstream

`fontra-pak` has two remotes:

| Remote | URL | Push |
|---|---|---|
| `origin` | `https://github.com/MekaClaude/fontra-pak.git` (your fork) | allowed |
| `upstream` | `https://github.com/fontra/fontra-pak.git` | **do not push** |

The fork is deliberately **upstream + a small set of additive files** that
serve the Windows build:

| File | Why it stays |
|---|---|
| `build-timestamped.py` | the one-command, timestamped Windows build |
| `test-export.py` | the export smoke test |
| `hook-fontra.backends.py`, `hook-fontra_compile.py` | PyInstaller hooks (auto-discovered) |
| `scripts/convert-icons*.py`, `icon/fontra-icon-source.svg` | the icon toolchain |
| `icon/FontraIcon.ico` | the fork's own icon (regenerated from the SVG) |
| `requirements-dev.txt` | `delocate` stays commented out (macOS-only) |

Everything else, **including `FontraPak.spec`**, is taken from upstream
verbatim. So the sync routine is:

```bash
cd fontra-pak
git fetch upstream
git merge upstream/main
```

If upstream deletes one of the additive files above, keep ours (`git checkout
--ours <file>`). If upstream changes `FontraPak.spec`, take upstream's
version - the version resource is built from `fontra.__version__`, so the
spec needs no local changes.

Then push to the fork and record the new pointer in the parent repo:

```bash
git push origin main
cd ..
git add fontra-pak
git commit -m "Update fontra pak"
```

## File Summary

| File | Purpose |
|------|---------|
| `fontra-pak/FontraPak.spec` | PyInstaller configuration (owned by upstream) |
| `fontra-pak/build-timestamped.py` | Automated build script |
| `fontra-pak/BUILD-WINDOWS.md` | Short build notes (this file is the long version) |
| `fontra-pak/requirements.txt` | Python runtime dependencies |
| `fontra-pak/requirements-dev.txt` | Python build dependencies |
| `src/fontra/_version.py` | The one and only version source |
| `fontra-pak/icon/FontraIcon.ico` | Application icon |
| `fontra-pak/icon/fontra-icon-source.svg` | Icon source |
| `fontra-pak/scripts/convert-icons-simple.py` | SVG → ICO conversion |
| `fontra-pak/test-export.py` | Export functionality test |

## Related Skills

- **Run Fontra Server**: Launch development server for testing
- **Sync with Upstream**: Keep fork synchronized with main Fontra repo
- **Export Fonts**: OTF/TTF export functionality guide
