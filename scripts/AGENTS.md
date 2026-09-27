# Purpose

Owns frontend maintenance and generation scripts.

## Ownership

- Scripts here support local development, asset generation, or data preparation for the frontend repo.

## Local Contracts

- Read the root AGENTS.md first.
- Scripts must be safe to run from the repo root and should not mutate the sibling backend repo unless explicitly documented.

## Work Guidance

- Prefer deterministic scripts with clear input/output paths.
- `generate-icons.mjs` owns the platform icon outputs and uses `assets/aeon-icon-master.png` as the single visual source.
- `generate-wiki-fan-rank-assets.mjs` reads the current sibling backend frontend-data manifest and every catalog chunk, plus `manhwa_db/db/exports/frontend/meta/tags.json.gz`. It writes chart data and SVGs to `%TEMP%/aeon-wiki-assets` by default, or a supplied `--output-dir` such as a temporary Wiki clone. It validates the manifest record count before writing and uses the tag hierarchy to keep sensitive-tagged titles out of safe-normal examples.
- Keep destructive behavior opt-in and documented.
- `refresh-loading-covers.mjs` reads the existing public versioned backend export and reuses the shipped normalization and feed-query modules through Vite SSR to select the five normal Discover feeds' exact top 100. It writes `assets/loading-cover-pools.json` only after validating every pool. Never duplicate ranking logic or trigger backend collection.
- Raw shipped feed JSON omits `kind`; always normalize Discover definitions to `logic` through `selectLoadingCoverTitles` before querying. Otherwise rating/source/excluded-tag filters are bypassed. The selector additionally rejects unsafe ratings and any selected entry carrying the actual Discover excluded IDs before assets can be published. Keep the exact normal-feed rules, not a new broader filter.
- `build-loading-covers.mjs` reads that ranked snapshot, reuses/downloads cover images with bounded retries, and emits `public/loading-covers/` plus `src/assets/loadingCovers.generated.json`. Only real cover thumbnails are generated; do not add substitute preview posters. After success it removes only unreferenced generator-owned hashed WebP files. The frontend weekly workflow runs both scripts, checks the app, and deploys the validated assets.

## Verification

- Run the changed script or a dry-run path when available.
- Run `npm run build` if script output is consumed by the app.

## Child DOX Index

No child AGENTS.md files.
