# Purpose

Owns the frontend application source: React routes, UI, domain rules, data loading, persistence, workers, and shared libraries.

## Ownership

- `App.tsx` owns live route composition and much of the mobile UI shell.
- `domain/` owns feed/filter/share/recommendation types and pure business rules.
- `services/` owns catalog loading, detail loading, and external data-source integration.
- `store/` owns local persistence and migrations.
- `workers/` owns background computation paths.
- `assets/`, `lib/`, and `db/` support source-level UI/data helpers.

## Local Contracts

- Read the root AGENTS.md first.
- Keep frontend data consumption compatible with `manhwa_db/db/exports/frontend`.
- Do not make the frontend read backend raw, processed, enrichment, cache, or state files.
- Do not add a blanket no-recognized-tag exclusion unless the user explicitly asks; backend/API tag coverage can differ from the MangaBaka site.
- Installed PWA users may already have IndexedDB state; migrations must be backward-compatible and recoverable.
- The default PWA identity is `Aeon`; preserve an intentionally customized app name in saved user settings.
- Home pager behavior is protected and user-visible: horizontal feed swipe, per-feed vertical scroll, detail back, and route/session restore must keep the stable `9f16d14` behavior baseline.
- Do not reintroduce commit `6b05599` behavior, `HOME_FEED_PREVIEW_TITLES = 18`, delayed route wrappers, hidden-pane vertical restoration, or delayed post-swipe scroll corrections.

## Work Guidance

- Use existing domain helpers and types before adding new state shapes.
- Keep rendering cheap on mobile; avoid expensive blur, image extraction, or large list updates in scroll handlers.
- Route/detail navigation should respond immediately, even if details or recommendations are still loading.
- If title drag/drop is added later, gate only that mode by disabling horizontal Home swipe while dragging; do not rewrite pager ownership.
- If changing feed settings, custom feeds, folders, or profiles, update migration and serialization paths together.
- Built-in default feeds use the compact settings drawer: grid columns, rank visibility, and cover-stat visibility only. User-created feeds retain the full advanced editor.
- Recommendations are currently suspended: do not expose a Recs navigation item or mount its page, and do not fetch/load recommendation-feature data. Keep the backend export contract intact for older installed frontend versions; old recommendation URLs redirect to Home.
- Built-in sensitive feed segments are installed once without replacing saved feeds. The BL/GL and Smut/Hentai Settings toggles gate their visibility on both Feeds and Home. Their own Home visibility setting then controls whether an eligible sensitive segment joins the normal Home sequence; they start hidden. A temporary preview of one closes as soon as its Settings toggle is off. Newly created feeds always enter UNSEGMENTED, never a built-in segment.
- Double-tapping the Home navigation item clears any temporary segment preview and sends one consumable reset command to Home, which resets to the first currently visible feed at its top. It must work even when Home is already active and must never replay after later feed-card navigation.
- Search should remain stable while typing and deleting; debounce expensive work instead of blocking input. Search covers display/source/native/romanized titles, every stored title alias, and author/artist names; preserve Fuse relevance order after sensitive-content filtering.

## Verification

- Run `npm run lint`, `npm test -- --run`, and `npm run build` for source changes.
- For Home, feed, search, settings, and detail interaction changes, test a mobile-width browser or LAN phone preview when possible.

## Child DOX Index

No deeper child AGENTS.md files yet. Add one if a source subfolder gains its own durable rules.
