# Vendored copy — fontra-tutorials

- Upstream project: Fontra Hive "Try Fontra" tours (try.fontrahive.com). Standalone repo install via jsDelivr `uplus-type/fontra-tutorials`.
- Vendored into this fork in commit `b14202c72` (11 Nov 2026).
- The vendored copy was stripped of the standalone repo's CI/deploy/dev artifacts (`.github/workflows/pages.yml`, `scripts/purge-jsdelivr.sh`, `.gitignore`) in this fork.
- No upstream version declared upstream; fork labels it `1.0.0`.
- License: GPL-3.0 (full text in `LICENSE`). Preserve the notice on redistribution.
- The Playwright/pytest suite (`test/test_plugin.py`) assumes a server rooted at the plugin folder; not wired into `npm run test:plugins`.
