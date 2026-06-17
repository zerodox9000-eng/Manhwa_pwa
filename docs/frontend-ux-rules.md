# Frontend UX Rules

## Loading

- Default feeds and presets stay visible on first run.
- Result areas show skeleton/progress until usable data exists.
- Empty states must not appear while data is still loading.
- Bundled/fallback data must be labeled as preview/offline fallback.

## Detail Pages

- Route id changes must not show stale detail data.
- Catalog shell should appear immediately when available.
- Description and recommendation sections should reserve space with skeletons.
- Detail requests should use cache and avoid duplicate in-flight fetches.

## Feed Pager And Grid

- Feed swipes use app motion constants and transform-based movement.
- Horizontal swipe locks only after clear horizontal intent.
- Each feed panel owns its vertical scroll container. Do not use shared `window.scrollY` for Home feed content.
- Unopened feeds start at the top; previously opened feeds restore their own panel `scrollTop`.
- The grid virtualizer must use the nearest feed panel as its scroll element when rendered on Home.
- Large/dense grids should be virtualized and avoid endless DOM growth.

## Detail Sharing

- Title detail sharing should open the title route, not import a feed.
- A screenshot-friendly share preview is the safe fallback when image download is blocked by cover CORS.
- Share preview toggles are local UI only and must not mutate detail visibility settings.

## Import

- Exact shared feeds should dedupe and open the existing feed.
- New shared feeds should add and open immediately.
- Import URLs should be cleaned after action to prevent accidental re-import.
