# Stats And Feed Query Rules

## Date Metrics

- `Rel` means real `published.start_date` only.
- `Rel` ignores `start_date_is_estimated: true`.
- `Rel` never falls back to `first_seen_at`, `added_at`, `created_at`, `last_updated_at`, or latest-added rank.
- `Add` means MangaBaka latest-added order from `mangabaka_latest_rank`. Lower rank is newer.
- `End` means real non-estimated `published.end_date` only.
- Estimated end dates are treated as no completion date.
- `Added` date filtering is a separate rolling cutoff based on listed metadata. It is not release date.

## Values

- Query filters and sorting use raw numeric values.
- Rounded strings are display-only.
- Cover stat slots are display-only and must not change inclusion.
- AniList-only source locking applies only to sort rules and metric range filters.
- Rolling metrics must use the feed's selected rolling window for both display and sorting.

## Feed Info

Feed Info should expose date mode, source mode, sort mode, display-only cover stats, and exclusion counts so a feed never feels random.

