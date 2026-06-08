# Manhwa Lib

Mobile-first local PWA for building custom manhwa discovery grids from the `zerodox9000-eng/manhwa_db` frontend exports.

## Live App

[Open Manhwa Lib on GitHub Pages](https://zerodox9000-eng.github.io/Manhwa_pwa/)

## What Is Implemented

- GitHub Pages-ready Vite + React + TypeScript PWA with install metadata, rounded app icons, and offline shell caching.
- Live-first data sync from the backend export, then local enriched query-index data is merged in for dates, links, authors, and extra search fields.
- Smart offline sync into IndexedDB for catalog, tags, history, settings, feeds, recommendations, and opened details.
- Grid-only UI across home, feeds, search, recommendation shelves, and details.
- Seeded first-run feeds decoded from shared feed links, including `New` with high-first release sorting.
- Feed builder with AniList/non-AniList source toggles, content ratings, chapter/year/all-metric min/max ranges, hierarchical tag include/exclude, rolling windows, per-feed descriptions, three cover-stat slots, and rank-in-stat-strip control.
- Catalog normalization deduplicates same-cover/title/source records, keeps current backend stats, and uses first history date as release date when backend dates are estimated.
- Default cover stats are Fan%, Pop, and Fav, capped at three visible metrics and scaled for dense grids without blurred overlay jitter.
- Full-page title detail route with current catalog stats, external links, local per-feed detail layout toggles, back/scroll restoration, and embedded recommendations.
- Title-only search with local recent-search history.
- Recommendation page with editable vertical top-20 shelves, tag-match scoring, metric ranges, and source toggles.
- Same-domain compressed share links for feeds, settings, recommendation config, and full backups.
- Visual and E2E coverage checks mobile/desktop overflow, navigation, search focus/history, feed mosaics, detail layout, and recommendation flow.

## Commands

```bash
npm install
npm run icons
npm run dev
npm run lint
npm test
npm run build
```

## Data Source

The app defaults to the raw backend export because it works reliably with CORS:

```text
https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend
```

It can also use the backend GitHub Pages export URL when available:

```text
https://zerodox9000-eng.github.io/manhwa_db/db/exports/frontend
```

## Deploy

The included GitHub Actions workflow builds and deploys `dist/` to GitHub Pages for this repo at:

```text
https://zerodox9000-eng.github.io/Manhwa_pwa/
```
