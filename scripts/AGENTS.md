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
- Keep destructive behavior opt-in and documented.

## Verification

- Run the changed script or a dry-run path when available.
- Run `npm run build` if script output is consumed by the app.

## Child DOX Index

No child AGENTS.md files.
