import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";
import { Check, RotateCw, X } from "lucide-react";
import { inflate } from "pako";
import { useLocation } from "react-router-dom";
import { POPULARITY_BANDS } from "./domain/popularityBands";
import { formatTrendDuration, type ChapterChangeEvent, type StatusChangeEvent, type TrendBuildResult, type TrendEvent, type TrendEventBandId, type UpdatesExport } from "./domain/trends";
import { matchesSearchWords } from "./domain/search";
import type { SeriesCatalog } from "./domain/types";
import { resolveVisibleTitle } from "./domain/displayTitle";
import { useAppStore } from "./store/useAppStore";
import { useTitleSelection } from "./titleSelection";

const TREND_CACHE_VERSION = 7;
const INITIAL_SECTION_COUNT = 60;
const TREND_SCROLL_KEY = "aeon-trends-scroll";
const TREND_RETURN_KEY = "aeon-trends-returning-from-title";
export const UPDATES_DETAIL_ORIGIN_KEY = "aeon-updates-detail-origin";
const TREND_SEARCH_KEY = "aeon-trends-search";
const TREND_SEARCH_OPEN_KEY = "aeon-trends-search-open";
const UPDATES_VIEW_KEY = "aeon-updates-view";
const UPDATES_LIMIT_KEYS: Record<UpdatesView, string> = {
  popularity: "aeon-updates-popularity-limit",
  status: "aeon-updates-status-limit",
  chapters: "aeon-updates-chapters-limit",
};
const updatesMemoryCache = new Map<string, UpdatesExport>();
type UpdatesView = "popularity" | "status" | "chapters";

function savedUpdatesLimit(view: UpdatesView) {
  const value = Number(sessionStorage.getItem(UPDATES_LIMIT_KEYS[view]));
  if (!Number.isFinite(value) || value < INITIAL_SECTION_COUNT) return INITIAL_SECTION_COUNT;
  return Math.ceil(value / INITIAL_SECTION_COUNT) * INITIAL_SECTION_COUNT;
}

function savedUpdatesView(): UpdatesView {
  const value = sessionStorage.getItem(UPDATES_VIEW_KEY);
  return value === "status" || value === "chapters" ? value : "popularity";
}

async function readUpdatesResponse(response: Response): Promise<UpdatesExport> {
  if (!response.ok) throw new Error("Updates data unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const firstContentByte = bytes.find((value) => value > 32);
  const json = firstContentByte === 123
    ? new TextDecoder().decode(bytes)
    : inflate(bytes, { to: "string" });
  const value = JSON.parse(json);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.popularity) || !Array.isArray(value.statuses) || !Array.isArray(value.chapters)) {
    throw new Error("Invalid Updates data");
  }
  return value as UpdatesExport;
}

async function loadUpdates(source: string, version: string) {
  try {
    return await readUpdatesResponse(await fetch(`${source}/stats/updates.json?v=${encodeURIComponent(version)}`, {
      cache: "no-cache",
      signal: AbortSignal.timeout(3_500),
    }));
  } catch {
    return readUpdatesResponse(await fetch(
      `${import.meta.env.BASE_URL}data/updates-bootstrap.json.gz?v=${encodeURIComponent(`${version}-${TREND_CACHE_VERSION}`)}`,
      { cache: "no-cache" },
    ));
  }
}

function bandLabel(band: TrendEventBandId | null) {
  if (band === "deep-cut") return "Deep Cut";
  return POPULARITY_BANDS.find((item) => item.id === band)?.label ?? "Deep Cut";
}

export function useUpdateCardSelection(titleId: number, onOpen: () => void) {
  const selection = useTitleSelection();
  const longPressTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);
  const subscribe = useCallback((listener: () => void) => selection.store.subscribe(titleId, listener), [selection.store, titleId]);
  const getSelected = useCallback(() => selection.store.isSelected(titleId), [selection.store, titleId]);
  const selected = useSyncExternalStore(subscribe, getSelected, getSelected);
  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    pointerStartRef.current = null;
  };
  return {
    selected,
    onPointerDown: (event: PointerEvent<HTMLAnchorElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      longPressedRef.current = false;
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressedRef.current = true;
        selection.beginCollect(titleId);
        if (navigator.vibrate) navigator.vibrate(20);
      }, 320);
    },
    onPointerMove: (event: PointerEvent<HTMLAnchorElement>) => {
      const start = pointerStartRef.current;
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 12) return;
      cancelLongPress();
    },
    onPointerUp: cancelLongPress,
    onPointerCancel: cancelLongPress,
    onContextMenu: (event: MouseEvent<HTMLAnchorElement>) => event.preventDefault(),
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (longPressedRef.current) {
        event.preventDefault();
        event.stopPropagation();
        longPressedRef.current = false;
        return;
      }
      if (selection.store.getSnapshot().mode) {
        event.preventDefault();
        event.stopPropagation();
        selection.toggleCollect(titleId);
        return;
      }
      onOpen();
    },
  };
}

function TrendCard({
  event,
  series,
  latestDate,
  onOpen,
}: {
  event: TrendEvent;
  series: SeriesCatalog;
  latestDate: string | null;
  onOpen: () => void;
}) {
  const title = resolveVisibleTitle(series);
  const targetLabel = bandLabel(event.to);
  const sinceChange = formatTrendDuration(event.date, latestDate);
  const { selected, ...selectionHandlers } = useUpdateCardSelection(series.id, onOpen);

  return (
    <a className={`trend-card rising ${selected ? "selected" : ""}`} href={`#/title/${series.id}`} {...selectionHandlers}>
      {series.cover ? <img className="trend-card-bg" src={series.cover} alt="" loading="lazy" /> : null}
      <span className="trend-card-shade" aria-hidden="true" />
      <div className="trend-card-main">
        <div className="trend-cover-wrap">
          {series.cover ? <img className="trend-cover" src={series.cover} alt="" loading="lazy" /> : <div className="trend-cover trend-cover-fallback" />}
          {selected ? <span className="title-selection-mark"><Check size={19} /></span> : null}
        </div>
        <div className="trend-copy">
          <div className="trend-title-row">
            <h2>{title}</h2>
          </div>
          <div className="trend-event-summary">
            <p className="trend-primary-change">
              <span>{targetLabel}</span> {event.direction === "rising" ? "reached" : "entered"}
            </p>
            <p className="trend-elapsed">
              <strong>{sinceChange && sinceChange !== "0 days" ? `${sinceChange} ago` : "Today"}</strong>
              <span>({event.date})</span>
            </p>
          </div>
        </div>
      </div>
    </a>
  );
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusChangeCard({ event, series, latestDate, onOpen }: {
  event: StatusChangeEvent;
  series: SeriesCatalog;
  latestDate: string | null;
  onOpen: () => void;
}) {
  const sinceChange = formatTrendDuration(event.date, latestDate);
  const { selected, ...selectionHandlers } = useUpdateCardSelection(series.id, onOpen);
  return (
    <a className={`trend-card status-change-card ${selected ? "selected" : ""}`} href={`#/title/${series.id}`} {...selectionHandlers}>
      {series.cover ? <img className="trend-card-bg" src={series.cover} alt="" loading="lazy" /> : null}
      <span className="trend-card-shade" aria-hidden="true" />
      <div className="trend-card-main">
        <div className="trend-cover-wrap">
          {series.cover ? <img className="trend-cover" src={series.cover} alt="" loading="lazy" /> : <div className="trend-cover trend-cover-fallback" />}
          {selected ? <span className="title-selection-mark"><Check size={19} /></span> : null}
        </div>
        <div className="trend-copy">
          <div className="trend-title-row"><h2>{resolveVisibleTitle(series)}</h2></div>
          <div className="trend-event-summary">
            <div className="trend-status-value" aria-label={`Status changed from ${statusLabel(event.from)} to ${statusLabel(event.to)}`}>
              <strong>{statusLabel(event.to)}</strong>
              <span>from {statusLabel(event.from)}</span>
            </div>
            <p className="trend-elapsed">
              <strong>{sinceChange && sinceChange !== "0 days" ? `${sinceChange} ago` : "Today"}</strong>
              <span>({event.date})</span>
            </p>
          </div>
        </div>
      </div>
    </a>
  );
}

function ChapterChangeCard({ event, series, latestDate, onOpen }: {
  event: ChapterChangeEvent;
  series: SeriesCatalog;
  latestDate: string | null;
  onOpen: () => void;
}) {
  const sinceChange = formatTrendDuration(event.date, latestDate);
  const { selected, ...selectionHandlers } = useUpdateCardSelection(series.id, onOpen);
  return (
    <a className={`trend-card chapter-change-card ${selected ? "selected" : ""}`} href={`#/title/${series.id}`} {...selectionHandlers}>
      {series.cover ? <img className="trend-card-bg" src={series.cover} alt="" loading="lazy" /> : null}
      <span className="trend-card-shade" aria-hidden="true" />
      <div className="trend-card-main">
        <div className="trend-cover-wrap">
          {series.cover ? <img className="trend-cover" src={series.cover} alt="" loading="lazy" /> : <div className="trend-cover trend-cover-fallback" />}
          {selected ? <span className="title-selection-mark"><Check size={19} /></span> : null}
        </div>
        <div className="trend-copy">
          <div className="trend-title-row"><h2>{resolveVisibleTitle(series)}</h2></div>
          <div className="trend-event-summary">
            <div className="trend-chapter-value" aria-label={`Chapter count increased from ${event.from} to ${event.to}`}>
              <strong>{event.to}</strong>
              <span>+{event.to - event.from} {event.to - event.from === 1 ? "chapter" : "chapters"}</span>
            </div>
            <p className="trend-elapsed">
              <strong>{sinceChange && sinceChange !== "0 days" ? `${sinceChange} ago` : "Today"}</strong>
              <span>({event.date})</span>
            </p>
          </div>
        </div>
      </div>
    </a>
  );
}

export function TrendsPage() {
  const store = useAppStore();
  const location = useLocation();
  const cacheKey = `trends:${TREND_CACHE_VERSION}:${store.syncMeta?.historyLastDate ?? "none"}:${store.catalog.length}`;
  const cachedUpdates = updatesMemoryCache.get(cacheKey);
  const [result, setResult] = useState<TrendBuildResult | null>(() => cachedUpdates ? { latestDate: cachedUpdates.latestDate, events: cachedUpdates.popularity } : null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(() => sessionStorage.getItem(TREND_SEARCH_OPEN_KEY) === "1");
  const [searchQuery, setSearchQuery] = useState(() => sessionStorage.getItem(TREND_SEARCH_KEY) ?? "");
  const [activeView, setActiveView] = useState<UpdatesView>(savedUpdatesView);
  const [statusChanges, setStatusChanges] = useState<StatusChangeEvent[]>(() => cachedUpdates?.statuses ?? []);
  const [chapterChanges, setChapterChanges] = useState<ChapterChangeEvent[]>(() => cachedUpdates?.chapters ?? []);
  const [popularityLimit, setPopularityLimit] = useState(() => savedUpdatesLimit("popularity"));
  const [statusLimit, setStatusLimit] = useState(() => savedUpdatesLimit("status"));
  const [chapterLimit, setChapterLimit] = useState(() => savedUpdatesLimit("chapters"));

  useEffect(() => {
    if (!store.ready || store.catalog.length === 0) return;
    let cancelled = false;
    const source = store.settings.dataSourceUrl.replace(/\/$/, "");
    void loadUpdates(source, store.syncMeta?.versionHash ?? "current")
      .then((payload) => {
        if (cancelled) return;
        updatesMemoryCache.set(cacheKey, payload);
        setResult({ latestDate: payload.latestDate, events: payload.popularity });
        setStatusChanges(payload.statuses);
        setChapterChanges(payload.chapters);
        setError(null);
      })
      .catch(() => !cancelled && setError("Unable to load updates."));
    return () => { cancelled = true; };
  }, [cacheKey, store.catalog.length, store.ready, store.settings.dataSourceUrl, store.syncMeta?.versionHash]);

  const seriesById = useMemo(() => new Map(store.catalog.map((series) => [series.id, series])), [store.catalog]);
  const visibleEvents = useMemo(() => {
    const events = result?.events ?? [];
    const query = searchQuery.trim();
    if (!query) return events;
    return events.filter((event) => {
      const series = seriesById.get(event.id);
      return series ? matchesSearchWords(series, query) : false;
    });
  }, [result?.events, searchQuery, seriesById]);
  const visibleStatusChanges = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return statusChanges;
    return statusChanges.filter((event) => {
      const series = seriesById.get(event.id);
      return series ? matchesSearchWords(series, query) : false;
    });
  }, [searchQuery, seriesById, statusChanges]);
  const visibleChapterChanges = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return chapterChanges;
    return chapterChanges.filter((event) => {
      const series = seriesById.get(event.id);
      return series ? matchesSearchWords(series, query) : false;
    });
  }, [chapterChanges, searchQuery, seriesById]);

  useEffect(() => {
    sessionStorage.setItem(TREND_SEARCH_KEY, searchQuery);
    sessionStorage.setItem(TREND_SEARCH_OPEN_KEY, searchOpen ? "1" : "0");
  }, [searchOpen, searchQuery]);

  useEffect(() => {
    sessionStorage.setItem(UPDATES_VIEW_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    sessionStorage.setItem(UPDATES_LIMIT_KEYS.popularity, String(popularityLimit));
    sessionStorage.setItem(UPDATES_LIMIT_KEYS.status, String(statusLimit));
    sessionStorage.setItem(UPDATES_LIMIT_KEYS.chapters, String(chapterLimit));
  }, [chapterLimit, popularityLimit, statusLimit]);

  useLayoutEffect(() => {
    if (location.pathname !== "/updates" || !result || sessionStorage.getItem(TREND_RETURN_KEY) !== "1") return;
    const target = Number(sessionStorage.getItem(TREND_SCROLL_KEY));
    if (Number.isFinite(target) && target > 0) window.scrollTo({ top: target, behavior: "auto" });
    sessionStorage.removeItem(TREND_RETURN_KEY);
  }, [location.pathname, result]);

  const prepareTitleOpen = () => {
    sessionStorage.setItem(TREND_SCROLL_KEY, String(window.scrollY));
    sessionStorage.setItem(TREND_RETURN_KEY, "1");
    sessionStorage.setItem(UPDATES_DETAIL_ORIGIN_KEY, "1");
  };
  const activeResultCount = activeView === "popularity"
    ? visibleEvents.length
    : activeView === "status"
      ? visibleStatusChanges.length
      : visibleChapterChanges.length;

  const renderUpdatesSection = (view: UpdatesView) => {
    if (view === "popularity") return (
      <section className="updates-section">
        {visibleEvents.length ? (
          <div className="trend-list">
            {visibleEvents.slice(0, popularityLimit).map((event) => {
              const series = seriesById.get(event.id);
              return series ? <TrendCard event={event} series={series} latestDate={result?.latestDate ?? null} onOpen={prepareTitleOpen} key={`${event.id}:${event.date}:${event.to}`} /> : null;
            })}
          </div>
        ) : <div className="empty-state">No matching popularity milestones.</div>}
        {visibleEvents.length > popularityLimit ? <button className="button updates-load-more" type="button" onClick={() => setPopularityLimit((value) => value + INITIAL_SECTION_COUNT)}>Load more</button> : null}
      </section>
    );
    if (view === "status") return (
      <section className="updates-section status-updates-section">
        {visibleStatusChanges.length ? (
          <div className="trend-list">
            {visibleStatusChanges.slice(0, statusLimit).map((event) => {
              const series = seriesById.get(event.id);
              return series ? <StatusChangeCard event={event} series={series} latestDate={result?.latestDate ?? null} onOpen={prepareTitleOpen} key={`${event.id}:${event.date}:${event.from}:${event.to}`} /> : null;
            })}
          </div>
        ) : <div className="empty-state">No matching status changes.</div>}
        {visibleStatusChanges.length > statusLimit ? <button className="button updates-load-more" type="button" onClick={() => setStatusLimit((value) => value + INITIAL_SECTION_COUNT)}>Load more</button> : null}
      </section>
    );
    return (
      <section className="updates-section chapter-updates-section">
        {visibleChapterChanges.length ? (
          <div className="trend-list">
            {visibleChapterChanges.slice(0, chapterLimit).map((event) => {
              const series = seriesById.get(event.id);
              return series ? <ChapterChangeCard event={event} series={series} latestDate={result?.latestDate ?? null} onOpen={prepareTitleOpen} key={`${event.id}:${event.date}:${event.from}:${event.to}`} /> : null;
            })}
          </div>
        ) : <div className="empty-state">No matching chapter updates.</div>}
        {visibleChapterChanges.length > chapterLimit ? <button className="button updates-load-more" type="button" onClick={() => setChapterLimit((value) => value + INITIAL_SECTION_COUNT)}>Load more</button> : null}
      </section>
    );
  };

  return (
    <div className="page trends-page">
      <header
        className="trends-page-header"
        onDoubleClick={(event) => {
          event.preventDefault();
          setSearchOpen(true);
        }}
      >
        <div>
          <h1>UPDATES</h1>
        </div>
      </header>
      <div className="updates-view-tabs" role="tablist" aria-label="Update type">
        {([
          ["popularity", "Popularity Milestones"],
          ["status", "Status Changes"],
          ["chapters", "Chapter Updates"],
        ] as const).map(([id, label]) => (
          <button
            className={activeView === id ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeView === id}
            onClick={() => setActiveView(id)}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      {searchOpen ? (
        <div className="feed-local-search trends-local-search">
          <input
            className="input"
            type="search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setPopularityLimit(INITIAL_SECTION_COUNT);
              setStatusLimit(INITIAL_SECTION_COUNT);
              setChapterLimit(INITIAL_SECTION_COUNT);
            }}
            placeholder="Search updates"
            name="aeon-trends-search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="search"
            enterKeyHint="search"
            autoFocus
          />
          <span className="feed-local-search-count">{activeResultCount} results</span>
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSearchOpen(false);
              setPopularityLimit(INITIAL_SECTION_COUNT);
              setStatusLimit(INITIAL_SECTION_COUNT);
              setChapterLimit(INITIAL_SECTION_COUNT);
            }}
            aria-label="Close updates search"
          >
            <X size={18} />
          </button>
        </div>
      ) : null}
      {!result && !error ? (
        <section className="trends-loading" aria-live="polite">
          <RotateCw className="trends-spinner" size={24} />
          <strong>Loading updates</strong>
        </section>
      ) : error ? (
        <section className="empty-state">{error}</section>
      ) : renderUpdatesSection(activeView)}
    </div>
  );
}
