# Frontend Agent Notes

This repo is the PWA frontend for `zerodox9000-eng/manhwa_db`. Keep changes here scoped to the frontend unless the user explicitly asks for backend work.

## Source Of Truth

- `src/App.tsx` defines the live routes, page composition, share/import flows, and most visible UI behavior.
- `src/domain/defaults.ts` defines shipped defaults for feeds, filters, settings, and cover/stat visibility.
- `src/services/dataService.ts` defines the current sync path and data-source fallback behavior.
- `src/domain/share.ts` defines what can be shared and how import payloads are encoded.
- `src/domain/types.ts` is the canonical shape for app data and settings.

## Current Routes

- `/` Home with feed pager and per-feed grid settings.
- `/feeds` Feed management.
- `/search` Title search with local history and sensitive-tag filters.
- `/recommendations` Recommendation shelves.
- `/recommendations/:id` Single shelf view.
- `/settings` App settings, exports, and sharing controls.
- `/learn` User-facing help.
- `/title/:id` Title detail page.
- `/import` Share import preview.

## Current Behavior

- The app loads the frontend export, then merges in the local query index and cached IndexedDB data.
- Catalog, tags, history, details, recommendation features, feeds, folders, labels, and settings are persisted locally.
- Share payloads currently support `feed`, `folder`, `settings`, `labels`, and `full` snapshots.
- Import links always open a preview before applying anything.
- Search is title-only; filtering still honors content ratings and sensitive-tag toggles.
- The home screen is feed-first and remembers scroll position per feed and layout.

## Editing Guidance

- Update README first when user-facing behavior changes.
- Add or revise a markdown note here if the change affects app flow, routes, or agent onboarding.
- Do not document backend implementation details in this repo unless they directly affect the frontend contract.

