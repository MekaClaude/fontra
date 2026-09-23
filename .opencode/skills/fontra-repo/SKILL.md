---
name: fontra-repo
description: Operating manual for this Fontra fork repo — fork/upstream git strategy (main = clean mirror, upstream push disabled), weekly sync routine, branch rules, Windows exe builds, dev server launch, tests, and environment quirks. Use when syncing with upstream, committing/pushing, building the exe, running the server, or any repo maintenance task.
---

# Fontra Repo Operating Manual

Repo root: `D:\DEVWEB\MINIMAX AGENT\fontra\fontra`

## Git remotes & fork strategy

| Remote | URL | Push |
|---|---|---|
| `origin` | `https://github.com/MekaClaude/fontra.git` (user's fork) | allowed (ADMIN) |
| `upstream` | `https://github.com/fontra/fontra` | **DISABLED** (`git remote set-url --push upstream DISABLED`) — never re-enable |

Three rules:

1. **`main` = pure mirror of `upstream/main`.** No features, no experiments. Local `main` and `origin/main` must always be 0/0 vs `upstream/main`.
2. **All feature work lives on `code-review-feedback-42427`** (for now, by user decision). Push only to `origin`.
3. **Never push upstream** — hard-enforced; any `git push upstream` fails with `DISABLED`.

If `main` ever needs a safety snapshot before a rewrite: `git branch backup/main-pre-<date> main` (existing backups live under `backup/*`).

## Weekly follow-up routine

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout code-review-feedback-42427 && git rebase main   # or merge, when needed
```

Notes:

- If `git merge --ff-only` fails on `main`, something broke the mirror — investigate before forcing; `main` should only ever move forward with upstream.
- The feature branch has merge history and exists on `origin`: prefer `git merge main` (or `git merge upstream/main`) for it; a rebase would require `--force-with-lease` on push.
- Working tree should be clean before syncing (commit or stash first).

## Preserving local customizations when merging upstream

Local customizations live on the feature branch. After any merge, verify these survived (keep local/`--ours` version on conflict):

- `src-js/views-applicationsettings/applicationsettings.html` — `figma-theme.css`, "Fontra Application Settings" title
- `src-js/views-editor/editor.html` — `figma-theme.css`, "Fontra" title
- `src-js/views-editor/src/editor.js` — local senderInfo logic
- `src-js/views-fontinfo/fontinfo.html` — `figma-theme.css`, "Fontra Font Info" title
- `src-js/views-fontinfo/src/fontinfo.js` — `"Fontra Font Info — ${displayName}"` title pattern
- `src-js/views-fontoverview/fontoverview.html` — `figma-theme.css`, "Fontra Font Overview" title
- `src-js/views-fontoverview/src/fontoverview.js` — `"Fontra Font Overview — ${displayName}"` title pattern

Also check auto-merged files (`git diff --cached --name-only`) — upstream may have silently removed a local feature.

## Windows exe build

Full procedure: `.skills-data-prompt/build-fontra-windows-skill.md`. Key facts:

- One-command build: `python fontra-pak/build-timestamped.py` (auto-stamps version, runs bundle, PyInstaller).
- Version format `YYYY.MM.DD.HH` **GMT+1**; always a NEW folder `fontra-pak/dist/Fontra-Pak-v{VERSION}` — never overwrite/delete previous builds.
- Output: `Fontra Pak.exe` (PyQt6 GUI wrapper, `FontraPakMain.py`, `console=False`). It takes **no CLI font/port args** — args are silently ignored; use `test-startup` mode to self-quit after init.
- Prereqs: all changes committed or stashed, no running server, `npm run bundle` first if JS/CSS changed.
- Verification: `npm test` (expected ~1212 passing), `python fontra-pak/test-export.py` (expect Passed 7 / Failed 0), check `_version.py` + `version-info.txt` match the folder version.
- Build log: `C:\Users\Clarence\AppData\Local\Temp\opencode\fontra-build.log`.

## Dev server

```bash
# global flags MUST precede the subcommand
python run_server.py --http-port 8000 filesystem test-py/data/mutatorsans
```

- Default: http://localhost:8000. Status: check `Get-NetTCPConnection -LocalPort 8000` or HTTP code.
- Background processes are reaped in this environment — launch detached when needed:
  `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine="..."}`
- Stop: kill only the specific PID (`Get-CimInstance Win32_Process -Filter "Name='python.exe'"`), not blanket `taskkill /IM python.exe`.
- Served client bundle lives in `src/fontra/client/` (webpack output) — after any JS/CSS change under `src-js/` run `npm run bundle`; the server reads static files live (no restart needed for bundle swaps).

## Client dev workflow

- JS sources: `src-js/**` (esbuild via `npm run bundle`); tests: `npm test`; syntax spot-check: `node --check <file>`.
- After JS/CSS edits: `npm run bundle` → commit **both** source and `src/fontra/client/` output.

## GitHub CLI

- `gh` v2.101.0 installed (winget), authenticated as **MekaClaude** (keyring; scopes: `repo, workflow, gist, read:org`).
- PATH may need refresh in a new shell: `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`
- Usable for PRs, CI status, releases, `gh api` against `origin` (`MekaClaude/fontra`).

## Environment quirks

- Shell is PowerShell 5.1, **French locale** (error messages in French); `rg`/`head` not available — use PowerShell cmdlets or grep tool.
- Python: `venv\Scripts\python.exe` (3.13.x); Node v22 / npm 11.
- User skill docs live in `.skills-data-prompt/` (build skill, server skill, sync skill, feature plans).
- `fontra-pak` is a nested git repo (no `.gitmodules` mapping — `git submodule status` fails; treat its dirty `version-info.txt` as build noise).
- Never commit without the user asking; never force-push `origin/main` (mirror resets are the only exception, and only with a `backup/*` branch first).
