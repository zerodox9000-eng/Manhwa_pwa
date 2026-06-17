# Recommendation Context Rules

## Data Contract

Recommendation context can come from backend exports and must remain optional for backward compatibility. Frontend fallback is allowed only when context is missing.

Core fields:

- `primaryProfile`
- `profileGroups`
- `primaryAnchors`
- `excludedProfiles`
- `storySignals`
- `semanticSummary`
- `searchKeywords`
- `evidence`
- `confidence`

## Scoring

Recommendations should prefer core story context over incidental broad tags. Business regression should not drift into tower fantasy, murim, or office romance just because of generic tags. Horror should not drift into romance unless horror context is also present.

Use debug breakdowns for future tuning: final score, profile score, context score, tag score, text score, quality score, shared anchors, shared profile groups, shared context features, and rejection reason.

## Backend

Backend generation must be offline and deterministic from existing titles, descriptions, tags, source fields, and manual overrides. It must not require an external AI API.
