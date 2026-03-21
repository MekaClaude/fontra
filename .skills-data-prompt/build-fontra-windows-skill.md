# Build Fontra Windows Bundle

## Overview

This skill builds a standalone Windows executable (`.exe`) from the Fontra font editor source code using PyInstaller. It creates versioned builds to preserve history and enable easy rollback.

## Version Convention

- **Timezone**: GMT+1 (Europe/Paris) - used for version hour
- **Format**: `YYYY.MM.DD.HH` (e.g., `2026.03.20.14`)
- **Output folder**: `Fontra-Pak-v{VERSION}` (e.g., `Fontra-Pak-v2026.03.20.14`)
- **Policy**: Always creates NEW folder - never overwrites or deletes previous builds

## Prerequisites

1. Python 3.13 or higher installed
2. Node.js and npm installed
3. Fontra source code cloned
4. All source code changes committed or stashed

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

### Step 3: Update Version Files

Edit these files to set the new version:

**File 1: `fontra-pak/version-info.txt`**
```python
# Update all 4 occurrences (filevers, prodvers, FileVersion, ProductVersion)
filevers=(2026, 3, 20, 14),
prodvers=(2026, 3, 20, 14),
# ...
StringStruct(u'FileVersion', u'2026.03.20.14'),
# ...
StringStruct(u'ProductVersion', u'2026.03.20.14')
```

**File 2: `src/fontra/_version.py`**
```python
__version__ = version = '2026.03.20.14'
__version_tuple__ = version_tuple = (2026, 3, 20, 14)
```

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

### Step 5: Install Dependencies

```bash
# Python dependencies
pip install -r fontra-pak/requirements.txt
pip install -r fontra-pak/requirements-dev.txt
```

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
3. Updates version files
4. Installs dependencies
5. Builds JS bundle
6. Builds Windows executable
7. Creates versioned output folder

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

## Common Issues

### Issue: "No module named 'fontra'"
**Solution**: Install fontra in editable mode
```bash
pip install -e .
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

## File Summary

| File | Purpose |
|------|---------|
| `fontra-pak/FontraPak.spec` | PyInstaller configuration |
| `fontra-pak/build-timestamped.py` | Automated build script |
| `fontra-pak/requirements.txt` | Python runtime dependencies |
| `fontra-pak/requirements-dev.txt` | Python build dependencies |
| `fontra-pak/version-info.txt` | Windows file properties |
| `src/fontra/_version.py` | Python version info |
| `fontra-pak/icon/FontraIcon.ico` | Application icon |
| `fontra-pak/test-export.py` | Export functionality test |

## Related Skills

- **Run Fontra Server**: Launch development server for testing
- **Sync with Upstream**: Keep fork synchronized with main Fontra repo
- **Export Fonts**: OTF/TTF export functionality guide
