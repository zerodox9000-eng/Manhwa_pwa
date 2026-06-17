# Manhwa Lib Contributor Notes

## Core Rules

- Inspect actual code before editing.
- Keep default new-feed AniList + Fan Rank unless explicitly told.
- Keep default feeds/presets visible for first-run UX.
- Treat `Rel` as a real release date only. Do not use estimated MangaBaka/AniList placeholders, `first_seen_at`, or `last_updated_at` as release dates.
- Treat `Add` as MangaBaka latest-added order from `mangabaka_latest_rank`. It is a sort option, not a cover stat.
- Cover stat slots are display-only. They must not force AniList-only source filtering.
- AniList-only source locking is allowed only when sort rules or metric range filters use AniList-only metrics.
- Raw values drive logic; formatted/rounded values are display-only.
- Estimated end dates are ignored for completion behavior, end sorting, rolling windows, and display.
- Rolling growth metrics must use the selected feed rolling window.
- Never show empty state while loading.
- Never show stale detail for a new route id.
- Reserve layout space before async content arrives and use skeletons for loading sections.
- Use virtualized grids for large/dense title lists.
- Use per-feed panel scroll state for the feed pager; Home feed content must not share `window.scrollY`.
- Import shared objects with dedupe and open the target.
- Title detail shares should open the title route and may use a screenshot-friendly preview instead of image export when cover CORS blocks downloads.
- Use app-defined motion constants.
- Recommendations should use backend semantic context when present, with frontend fallback only for compatibility.
- Local title overrides are user/device state. They should not mutate backend catalog fields.

## Verification

Before committing frontend behavior changes, run:

```powershell
npm.cmd test -- --run
npm.cmd run build
npm.cmd run lint
npm.cmd run test:e2e
```
