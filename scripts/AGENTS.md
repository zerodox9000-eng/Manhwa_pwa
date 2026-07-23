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
- `sync-updates-bootstrap.mjs` copies the sibling backend's compact compressed Updates export into `public/data/updates-bootstrap.json.gz`. It is a lazy fallback for staged frontend/backend releases and must be refreshed whenever the initial Updates schema or reconstructed ledger changes.
- Keep destructive behavior opt-in and documented.

## Verification

- Run the changed script or a dry-run path when available.
- Run `npm run build` if script output is consumed by the app.

## Child DOX Index

No child AGENTS.md files.
