# Manhwa Lib

Mobile-first local PWA for building custom manhwa discovery grids from the `zerodox9000-eng/manhwa_db` frontend export.

## Live App

[Open Manhwa Lib on GitHub Pages](https://zerodox9000-eng.github.io/Manhwa_pwa/)

## What This Frontend Does

- Vite + React + TypeScript PWA with install metadata, maskable icons, service worker registration, and offline shell caching.
- Uses the backend export as a catalog source, then merges in the local query index so the frontend keeps the richer search and display fields current.
- Stores catalog, tags, history, details, recommendation features, feeds, folders, labels, and settings in IndexedDB for offline use.
- Home is feed-driven and mobile-first, with horizontal feed paging, scroll restore, and per-feed grid settings.
- Feeds support AniList and non-AniList filtering, content ratings, status, chapter/year/popularity/favourites/score bounds, tag include/exclude, rolling date windows, labels, and custom sort rules.
- Title detail pages include external links, creator metadata, markdown description rendering, configurable stat blocks, and embedded recommendations.
- Search is title-only with local recent-search history and sensitive-tag filtering controls.
- Recommendations use editable shelves, source-mode toggles, tag-match scoring, and metric ranges.
- Share links are compressed and same-domain, and import links open a preview before anything is applied.
- Exports currently cover feeds as CSV, plus share payloads for feeds, folders, settings, labels, and full snapshots.

## Routes

- `/` Home
- `/feeds` Feed manager
- `/search` Search
- `/recommendations` Recommendations
- `/recommendations/:id` Single shelf view
- `/settings` App settings and exports
- `/learn` Help and data notes
- `/title/:id` Title detail
- `/import` Share import preview

## Current Data Flow

1. The app tries the configured frontend data source URL first.
2. If that fails, it falls back to the bundled raw and GitHub Pages export candidates.
3. It loads `series/all.json`, `meta/tags.json`, `stats/history.json`, and optional recommendation features.
4. It merges live catalog data with the local `query-index.json.gz` enrichment file and cached IndexedDB state.
5. It writes the normalized catalog, tags, history, details, and recommendation features back to IndexedDB.

## Data Sources

Default frontend source:

```text
https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend
```

Fallback frontend source:

```text
https://zerodox9000-eng.github.io/manhwa_db/db/exports/frontend
```

## Commands

```bash
npm install
npm run icons
npm run dev
npm run lint
npm test
npm run build
```

## Notes For Agents

- Keep frontend docs focused on this repo only; the backend export format is a dependency, not the place to make changes here.
- `src/domain/defaults.ts` is the quickest source of truth for shipped defaults.
- `src/App.tsx` is the best place to verify current routes and UI behavior.
- `src/services/dataService.ts` shows the current data sync and merge path.
