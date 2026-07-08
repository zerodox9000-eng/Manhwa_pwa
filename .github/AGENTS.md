# Purpose

Owns GitHub Actions workflows and repository automation for the frontend.

## Ownership

- Workflows here build, test, and deploy the GitHub Pages PWA.

## Local Contracts

- Read the root AGENTS.md first.
- Do not weaken live deployment checks without explicit user approval.
- Keep workflow paths aligned with the Vite/GitHub Pages base path.

## Work Guidance

- Prefer small workflow edits with clear trigger and permission scope.
- If changing deploy behavior, verify the workflow after push.

## Verification

- Inspect workflow syntax locally.
- After deployment workflow changes, confirm the GitHub Actions run completes successfully.

## Child DOX Index

No child AGENTS.md files.
