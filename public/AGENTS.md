# Purpose

Owns static files served by the PWA, including icons, manifest assets, and bundled static data.

## Ownership

- PWA install and browser-facing assets live here.
- Changes can affect cache behavior and installed app appearance.

## Local Contracts

- Read the root AGENTS.md first.
- Keep asset paths compatible with the Vite base path used for GitHub Pages.
- Do not remove or rename install-critical icons/manifest assets without updating references.

## Work Guidance

- Prefer generated assets only when the generator command and source are known.
- Keep large static data additions intentional; frontend catalog data normally comes from the backend export.

## Verification

- Run `npm run build` after changing public assets referenced by the app.

## Child DOX Index

No child AGENTS.md files.
