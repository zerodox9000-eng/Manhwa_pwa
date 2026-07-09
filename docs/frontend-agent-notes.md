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
- Catalog, tags, history, details, recommendation features, feeds, labels, and settings are persisted locally.
- Share payloads currently support feeds, settings, labels, and full snapshots; folder UI is not part of the stable behavior baseline.
- Import links always open a preview before applying anything.
- Search is title-only; filtering still honors content ratings and sensitive-tag toggles.
- The home screen is feed-first and remembers scroll position per feed and layout.
- Home paging uses the protected `9f16d14` native scroll-snap behavior plus chunked backend loading. Treat this as the stable baseline.
- Feed headers use a fixed two-lane layout: the title stays on one line and can shrink before ellipsizing, while the description gets its own glass block with a stable two-line footprint.
- Title detail pages do not render embedded recommendation shelves; keep detail back/navigation free from recommendation ranking or loading work.
- Double-tapping the Home feed title opens that feed's existing settings drawer. Keep this shortcut scoped to the header; it must not change pager ownership.
- Startup and Settings refresh must check the backend manifest before heavy data sync. Opening Settings, Search, or any route must not initiate a full sync by itself; the Refresh button stays disabled while a sync is already running.
- LAN previews may run on insecure `http://192.168...` origins where `crypto.subtle` is unavailable; chunk loading must still work there without falling back to legacy full-file sync loops.
- Restore keys for Home should stay scoped to feed id plus grid columns and density, otherwise 4/5-grid back navigation will drift.
- Blacklist `6b05599 Improve navigation and loading responsiveness`: do not reintroduce `HOME_FEED_PREVIEW_TITLES = 18`, delayed route wrappers, hidden-pane vertical restore, or post-swipe scroll correction.
- If custom title drag/drop is rebuilt, the only acceptable pager-facing change is disabling horizontal Home swipe while drag mode is active.
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


## Debugging Notes

- The app now has an opt-in debug logger in `src/lib/debug.ts`.
- Enable it with `localStorage.manhwa-debug-logs = "1"` when you need breadcrumb output for pager selection, restore timing, or scroll state.
- Use logs to verify behavior before changing layout constants.
- Keep feed card spacing frozen unless the user explicitly asks for it; most Home bugs live in the shell, not inside the cards.
## Editing Guidance

- Update README first when user-facing behavior changes.
- Add or revise a markdown note here if the change affects app flow, routes, or agent onboarding.
- Do not document backend implementation details in this repo unless they directly affect the frontend contract.



