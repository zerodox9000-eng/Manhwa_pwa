# Feed Semantics

## Rel

`Rel` means a real `published.start_date` where `start_date_is_estimated` is not true and the date is not in the future. If the title only has an estimated placeholder, the release stat displays blank and release filters do not match it.

## Add

`Add` means MangaBaka latest-added order using `mangabaka_latest_rank`. Lower rank is newer, so `Add` ascending is displayed as `Latest first`.

`Add` is source-neutral and works for AniList and Non-AniList titles. It should not appear in cover-stat choices.

## Added Date Window

The feed date field `Added` is a rolling/fixed cutoff based on local listed metadata such as `first_seen_at`, then `added_at`, `created_at`, `mangabaka_latest_snapshot_at`, and finally `last_updated_at`.

Use this only to limit a latest-added style feed to a recent period. It is not the same thing as release date.

## AniList Locking

AniList-only locking happens when sort rules or metric range filters use AniList-only stats. Visible cover stats must not lock the source because they are display-only.

