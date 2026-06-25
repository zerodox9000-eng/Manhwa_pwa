# Frontend Agent Notes

This repo is the PWA frontend for `zerodox9000-eng/manhwa_db`. Keep changes here scoped to the frontend unless the user explicitly asks for backend work.

## Source Of Truth

- `src/App.tsx` defines the live routes, page composition, share/import flows, and most visible UI behavior.
- `src/domain/defaults.ts` defines shipped defaults for feeds, filters, settings, and cover/stat visibility.
- `src/services/dataService.ts` defines the current sync path and data-source fallback behavior.
- `src/domain/share.ts` defines what can be shared and how import payloads are encoded.
- `src/domain/types.ts` is the canonical shape for app data and settings.
- `src/domain/recommendations.ts` is the ranking math. This is where tag weights become rec scores.

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
- `tag_weights` are read from the catalog items inside `query-index.json.gz` or the live export, not from the standalone scrape file directly.
- `recommendations/features.json` is optional. If present, the frontend uses it; if absent, it falls back to local feature building from catalog data and tag weights.

## Tag Weight Pipeline

1. Scrape or derive tag weights from MangaBaka.
2. Merge those weights into the exported catalog payload for each title, usually the same payload that feeds `query-index.json.gz`.
3. Ship the merged catalog in the frontend export.
4. Let the frontend load the catalog and use `series.tag_weights` during recommendation feature building and ranking.
5. Optionally also ship `recommendations/features.json` if you want backend-side precomputed features.

## Where The Math Lives

- The frontend already does the final ranking math in `src/domain/recommendations.ts`.
- The backend is the right place to store and publish raw scraped weights and any precomputed recommendation features.
- The frontend should remain the consumer and scorer, not the scraper.

## Editing Guidance

- Update README first when user-facing behavior changes.
- Add or revise a markdown note here if the change affects app flow, routes, or agent onboarding.
- Do not document backend implementation details in this repo unless they directly affect the frontend contract.
