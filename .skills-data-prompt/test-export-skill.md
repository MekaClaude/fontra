# Test Fontra Export Functionality

## Overview

This skill verifies that the OTF/TTF font export functionality works correctly in the Fontra codebase. Run this test after building or making changes to ensure export features are operational.

## When to Run

- After building a new Windows executable
- After syncing with upstream
- After installing new dependencies
- Before releasing a new build
- When reporting export-related bugs

## Prerequisites

```bash
# Ensure fontra source is in Python path
cd fontra
pip install -e .
```

## Run the Test

### Quick Test

```bash
python fontra-pak/test-export.py
```

### Expected Output (Success)

```
Testing OTF/TTF Export Functionality
==================================================

1. Testing fontra_compile imports...      [OK]
2. Testing fontTools imports...           [OK]
3. Testing fontmake imports...            [OK]
4. Testing ufo2ft imports...              [OK]
5. Testing Fontra workflow actions...     [OK]
6. Testing Fontra export modules...        [OK]
7. Testing basic font compilation...       [SKIP]

==================================================
TEST SUMMARY
==================================================
Passed: 7, Failed: 0

All core modules imported successfully!
OTF/TTF export should work correctly
```

### Expected Output (Issues Found)

```
==================================================
TEST SUMMARY
==================================================
Passed: 6, Failed: 1

Warnings/Errors (1):
  - fontmake: No module named 'fontmake.builder'

Some optional dependencies missing
Export may work but with limited features
```

## Test Details

### What Gets Tested

| Test | Description | Critical |
|------|-------------|----------|
| fontra_compile | Font compilation engine | Yes |
| fontTools | Core font manipulation | Yes |
| fontmake | Font build system | Yes |
| ufo2ft | UFO to font conversion | Yes |
| Fontra Workflow | Export workflow engine | Yes |
| OTFBackend | OpenType backend | Yes |
| FontInstancer | Font instancing | Yes |
| Full compilation | Complete font build | No (needs test font) |

### Required Dependencies

These MUST be installed for export to work:

```bash
pip install fontmake>=3.8.0
pip install fontTools[ufo,unicode,woff]>=4.40
pip install uharfbuzz>=0.23.0
pip install ufo2ft>=3.7.0
pip install fontra-compile  # External compilation engine
```

### Test Font Path (Optional)

To test actual font compilation, provide a test font project:

```bash
python fontra-pak/test-export.py /path/to/fontra/project
```

## Troubleshooting

### Issue: "fontra_compile not installed"

```bash
pip install fontra-compile
```

### Issue: "No module named 'fontTools'"

```bash
pip install fontTools
```

### Issue: "No module named 'fontmake'"

```bash
pip install fontmake
```

### Issue: "No module named 'ufo2ft'"

```bash
pip install ufo2ft
```

### Issue: All tests fail

```bash
# Reinstall all dependencies
pip install -r fontra-pak/requirements.txt
pip install -e .
```

## Manual Export Test

### Test OTF Export

1. Launch Fontra: `fontra --dev --launch`
2. Open any font project
3. Go to **File** → **Export**
4. Select **OTF** format
5. Click **Export**
6. Verify output `.otf` file is created

### Test TTF Export

1. Same as OTF but select **TTF** format
2. Verify output `.ttf` file is created

### Verify Export Quality

```bash
# Check exported font
fonttools varLib.instancer /path/to/exported-font.otf

# Check font tables
ttx /path/to/exported-font.otf
```

## Export Format Details

### OTF (OpenType Font)
- Format: CFF outlines
- Extension: `.otf`
- Used for: Most modern applications

### TTF (TrueType Font)
- Format: TrueType outlines
- Extension: `.ttf`
- Used for: Legacy application support

### WOFF/WOFF2
- Web-optimized formats
- Used for: Web embedding

## Related Skills

- **Build Fontra Windows**: Build Windows executable
- **Sync Upstream**: Keep fork synchronized
