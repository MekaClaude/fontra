# Sync Fontra Fork with Upstream

## Description

Sync this repo's feature branch with upstream `https://github.com/fontra/fontra` while preserving local customizations (e.g., `figma-theme.css`, "Fontra" title prefix, custom title patterns).

## Workflow

### 1. Check Status

```powershell
git remote -v
git status
git log --oneline -10
```

### 2. Stash Unrelated Changes (if any)

```powershell
git stash
```

Only stash files that are not part of the repo's source code (e.g., `.qwen/settings.json`).

### 3. Fetch Upstream

```powershell
git fetch upstream
```

### 4. See What's New

```powershell
git log --oneline HEAD..upstream/main
```

### 5. Merge Upstream into Current Branch

```powershell
git merge upstream/main
```

### 6. Resolve Conflicts

List conflicts:

```powershell
git diff --name-only --diff-filter=U
```

For each conflicted file, keep the local (HEAD) version to preserve customizations:

```powershell
git checkout --ours <file>
git add <file>
```

### 7. Check Auto-Merged Files

Auto-merged files may silently overwrite local changes. Check them:

```powershell
git diff --cached --name-only
```

For any auto-merged files where upstream removed local features, restore the local version:

```powershell
git checkout HEAD -- <file>
```

Known local features to preserve (check each):
- `src-js/views-applicationsettings/applicationsettings.html` — keep `figma-theme.css`, "Fontra Application Settings" title
- `src-js/views-editor/editor.html` — keep `figma-theme.css`, "Fontra" title
- `src-js/views-editor/src/editor.js` — keep local senderInfo logic
- `src-js/views-fontinfo/fontinfo.html` — keep `figma-theme.css`, "Fontra Font Info" title
- `src-js/views-fontinfo/src/fontinfo.js` — keep `"Fontra Font Info — ${displayName}"` title pattern
- `src-js/views-fontoverview/fontoverview.html` — keep `figma-theme.css`, "Fontra Font Overview" title
- `src-js/views-fontoverview/src/fontoverview.js` — keep `"Fontra Font Overview — ${displayName}"` title pattern

### 8. Commit Merge

```powershell
git commit -m "Merge remote-tracking branch 'upstream/main' into <branch-name>"
```

### 9. Restore Stash

```powershell
git stash pop
```
