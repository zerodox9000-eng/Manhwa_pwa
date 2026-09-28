# Purpose

Owns GitHub Actions workflows and repository automation for the frontend.

## Ownership

- Workflows here build, test, and deploy the GitHub Pages PWA.

## Local Contracts

- Read the root AGENTS.md first.
- Do not weaken live deployment checks without explicit user approval.
- Keep workflow paths aligned with the Vite/GitHub Pages base path.
- The Pages push trigger skips README- and docs-only changes. Manual dispatch and the weekly cover refresh's reusable deployment remain available.

## Work Guidance

- Prefer small workflow edits with clear trigger and permission scope.
- If changing deploy behavior, verify the workflow after push.
- `refresh-loading-covers.yml` refreshes the five normal Trending top-50 sets every Friday at 03:30 UTC, also manually dispatchable. It reads existing public backend exports, runs the shipped frontend query, generates bounded small cover assets, and commits only those generated files after lint, tests, and build pass. It never triggers backend collection. Because GITHUB_TOKEN pushes do not start another workflow, it explicitly calls the reusable Pages deployment with the validated new commit SHA. A failed refresh leaves the deployed assets unchanged.

## Verification

- Inspect workflow syntax locally.
- After deployment workflow changes, confirm the GitHub Actions run completes successfully.

## Child DOX Index

No child AGENTS.md files.
