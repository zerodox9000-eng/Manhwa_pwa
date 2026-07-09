# DOX Framework

Source: https://github.com/agent0ai/dox.git at `5cb5ba55bd1c0f7c1b31fe655fe36e2febb760d2`.

- DOX is the AGENTS.md hierarchy installed here.
- Agents must follow DOX instructions across any edits.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it.

## Read Before Editing

1. Read this root AGENTS.md.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every AGENTS.md found along each route.
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there.
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Project Contract

- This repo is the frontend PWA. Backend data and pipeline work belongs in the sibling `C:\Users\japne\OneDrive\Documents\manhwa_db` repo unless the user explicitly asks for cross-repo work.
- The live app is GitHub Pages at `https://zerodox9000-eng.github.io/Aeon/`.
- Treat phone/PWA observations from the user as authoritative UX evidence.
- Keep local repo layout clear: frontend is `MANHWA CODEX 1`; backend is `manhwa_db`; do not recreate duplicate backend folders.
- Do not push frontend changes unless the user asks to ship or explicitly gives live/deploy approval.
- When pushing frontend changes, run the relevant checks first. Default verification is `npm run lint`, `npm test -- --run`, and `npm run build` unless the change is docs-only.

## Work Guidance

- Keep the app mobile-first and PWA-safe.
- Preserve existing data contracts with `zerodox9000-eng/manhwa_db` unless the backend repo is updated in the same task.
- Do not change shipped default feeds, profile state, or feed migration behavior casually; those changes affect installed PWAs.
- For Home pager work, protect native horizontal scroll-snap, per-feed vertical scroll, and back/return restoration.
- Prefer scoped fixes over broad rewrites. If a bug is in a shell or persistence path, do not churn card rendering or feed math unless needed.
- Keep docs concise, current, and operational. Document stable contracts, not diary entries.

## Verification

- Docs-only changes: no runtime check required; inspect markdown and git diff.
- Frontend behavior changes: run `npm run lint`, `npm test -- --run`, and `npm run build`.
- UI or interaction changes: verify with a local browser/LAN preview when possible before live deployment.

## Child DOX Index

- `src/AGENTS.md`: React application source, domain logic, services, stores, workers, and UI behavior.
- `docs/AGENTS.md`: durable frontend notes and agent handoff documentation.
- `public/AGENTS.md`: static PWA assets and bundled data assets.
- `scripts/AGENTS.md`: local maintenance scripts and generation helpers.
- `tests/AGENTS.md`: unit and browser test guidance.
- `.github/AGENTS.md`: GitHub Actions and deployment workflows.
