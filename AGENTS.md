# Manhwa Lib Contributor Notes

## Core Rules

- Treat `Rel` as a real release date only. Do not use estimated MangaBaka/AniList placeholders, `first_seen_at`, or `last_updated_at` as release dates.
- Treat `Add` as MangaBaka latest-added order from `mangabaka_latest_rank`. It is a sort option, not a cover stat.
- Cover stat slots are display-only. They must not force AniList-only source filtering.
- AniList-only source locking is allowed only when sort rules or metric range filters use AniList-only metrics.
- Estimated end dates are ignored for completion behavior, end sorting, rolling windows, and display.
- Rolling growth metrics must use the selected feed rolling window.
- Local title overrides are user/device state. They should not mutate backend catalog fields.

## Verification

Before committing frontend behavior changes, run:

```powershell
npm.cmd test -- --run
npm.cmd run build
npm.cmd run lint
npm.cmd run test:e2e
```

