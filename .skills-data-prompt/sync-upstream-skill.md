# Sync Fontra Fork with Upstream

## Overview

This guide helps keep the Fontra fork synchronized with the upstream repository while preserving custom modifications. All fork-specific changes (like custom builds, modified features, etc.) are stored in the `.skills-data-prompt/` folder to avoid conflicts during sync.

## Upstream Repository

- **Upstream URL**: `https://github.com/fontra/fontra.git`
- **Default branch**: `main`

## Initial Setup (One Time)

### 1. Add Upstream Remote

```bash
# Navigate to fontra root
cd fontra

# Add upstream repository
git remote add upstream https://github.com/fontra/fontra.git

# Verify remotes
git remote -v
```

Expected output:
```
origin    https://github.com/YOUR_FORK/fontra.git (fetch)
origin    https://github.com/YOUR_FORK/fontra.git (push)
upstream  https://github.com/fontra/fontra.git (fetch)
upstream  https://github.com/fontra/fontra.git (push)
```

## Sync Workflow

### Step 1: Stash Local Changes (if any)

```bash
# Check for uncommitted changes
git status

# Stash if there are changes
git stash
git stash list
```

### Step 2: Fetch Upstream Changes

```bash
# Fetch latest from upstream
git fetch upstream

# Check upstream branches
git branch -r
```

### Step 3: Merge Upstream into Main

```bash
# Switch to main branch
git checkout main

# Merge upstream/main into local main
git merge upstream/main

# Or use rebase for cleaner history (recommended)
git checkout main
git rebase upstream/main
```

### Step 4: Resolve Conflicts (if any)

```bash
# Check for conflicts
git status

# List conflicted files
git diff --name-only --diff-filter=U

# Resolve conflicts in each file, then:
git add <resolved-file>
git commit
```

### Step 5: Push to Origin

```bash
# Push merged changes to your fork
git push origin main
```

### Step 6: Restore Local Changes

```bash
# Apply stashed changes
git stash pop

# If there are stash conflicts, resolve them
```

## Fork-Specific Modifications

### What Goes in `.skills-data-prompt/`

This folder contains all fork-specific changes that are NOT synced from upstream:

| File/Folder | Purpose |
|-------------|---------|
| `build-fontra-windows-skill.md` | Windows build instructions |
| `sync-upstream-skill.md` | This file - sync instructions |
| `CHANGELOG-custom.md` | Fork-specific changelog |
| `fontra-dev-logo/` | Custom icons and logos |
| `*.patch` | Custom patches for features |

### Custom Features Workflow

When implementing custom features:

1. **Do NOT modify upstream files directly** for customizations
2. **Create copies** in `.skills-data-prompt/` with `_custom` suffix
3. **Document changes** in `CHANGELOG-custom.md`

Example:
```
# Instead of modifying this file directly:
src/fontra/core/application-settings.js

# Create a copy with customizations:
.skills-data-prompt/custom-application-settings.js

# Document the change:
.skills-data-prompt/CHANGELOG-custom.md
```

## Rebuild After Sync

After syncing with upstream, rebuild Windows executable:

```bash
# Stop any running processes
taskkill /F /FI "IMAGENAME eq python.exe" 2>/dev/null

# Rebuild
cd fontra-pak
python build-timestamped.py
```

## Quick Sync Commands

### Full Sync (one-liner)
```bash
git stash && git checkout main && git fetch upstream && git merge upstream/main && git push origin main && git stash pop
```

### Check Sync Status
```bash
# Compare versions
echo "Upstream main:"
git log upstream/main --oneline -1
echo "Local main:"
git log main --oneline -1
echo "Your fork:"
git log origin/main --oneline -1
```

## Changelog Management

### Strategy

- **UPSTREAM CHANGELOG**: Do NOT edit `CHANGELOG.md`
- **FORK CHANGELOG**: Use `.skills-data-prompt/CHANGELOG-custom.md`

### Template for CHANGELOG-custom.md

```markdown
# Fontra Fork Changelog

## Fork-Specific Changes

### Version YYYY.MM.DD.HH
**Date**: YYYY-MM-DD
**Based on upstream**: vX.Y.Z

#### New Features
- Feature 1: Description

#### Modifications
- Modified file: What changed

#### Bug Fixes
- Fixed issue: Description

#### Build Changes
- Custom icon: FontraIconDev.ico
- Build configuration: custom settings

---

## Previous Fork Versions

### Version YYYY.MM.DD.HH
[Previous entries...]
```

## Troubleshooting

### Issue: "fatal: refusing to merge unrelated histories"
**Solution**: Use `--allow-unrelated-histories` flag
```bash
git merge upstream/main --allow-unrelated-histories
```

### Issue: Detached HEAD state
**Solution**: Checkout main branch
```bash
git checkout main
```

### Issue: Stash conflicts after merge
**Solution**: Resolve manually
```bash
git stash show -p | grep -A 5 "<<<<<<"
# Edit files to resolve, then:
git add .
git stash drop
```

## Best Practices

1. **Sync regularly** - at least weekly to minimize conflicts
2. **Test after sync** - run `python fontra-pak/test-export.py`
3. **Build after sync** - create new Windows build
4. **Document custom changes** - update CHANGELOG-custom.md
5. **Commit custom changes first** - before pulling upstream

## Related Skills

- **Build Fontra Windows**: Build Windows executable
- **Run Fontra Server**: Test changes locally
