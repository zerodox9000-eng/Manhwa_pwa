import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import {
  ArrowLeft,
  Check,
  Copy,
  Database,
  Download,
  EllipsisVertical,
  ExternalLink,
  Filter,
  GripVertical,
  Home,
  Import,
  Info,
  Library,
  ListFilter,
  Plus,
  Sparkles,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  HashRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { createFeed, DEFAULT_DETAIL_VISIBLE, DEFAULT_FILTERS, DEFAULT_SORT } from "./domain/defaults";
import { isFutureDate, resolveRollingWindow } from "./domain/dates";
import { buildSensitiveTagGroups, feedUsesAniListOnlyParameters, isGenreTag, runFeedQuery, tagRoot } from "./domain/query";
import { formatMetricValue, historyDeltaForWindow, METRIC_DEFINITIONS, metricDefinition, metricValue } from "./domain/metrics";
import { resolveDisplayTitle } from "./domain/catalog";
import { decodeSharePayload, exportCsv, makeShareUrl, type SharePayload } from "./domain/share";
import type {
  AppSettings,
  ContentRating,
  Feed,
  FeedViewSettings,
  HistoryMap,
  MetricId,
  MetricRange,
  RecommendationShelf,
  SeriesCatalog,
  SeriesDetail,
  SourceMode,
  TagNode,
} from "./domain/types";
import { fetchSeriesDetail } from "./services/dataService";
import { AppStoreProvider, useAppStore } from "./store/useAppStore";

const NAV_ITEMS = [
  { id: "home", to: "/", label: "Home", icon: Home },
  { id: "feeds", to: "/feeds", label: "Feeds", icon: ListFilter },
  { id: "search", to: "/search", label: "Search", icon: Search },
  { id: "recommendations", to: "/recommendations", label: "Recs", icon: Sparkles },
  { id: "settings", to: "/settings", label: "Settings", icon: Settings },
];

const SORT_OPTIONS: MetricId[] = METRIC_DEFINITIONS.map((definition) => definition.id);
const RANGE_METRICS = METRIC_DEFINITIONS.filter((definition) => definition.filterable);
const COVER_STAT_METRICS = METRIC_DEFINITIONS.filter((definition) => definition.id !== "title" && definition.id !== "mangabakaLatestRank");
const resetPageScroll = () => window.scrollTo({ top: 0, left: 0, behavior: "auto" });

const SESSION_RESTORE_KEY = "manhwa-library-route-v1";

function App() {
  return (
    <AppStoreProvider>
      <HashRouter>
        <AppFrame />
      </HashRouter>
    </AppStoreProvider>
  );
}

function AppFrame() {
  const store = useAppStore();
  const nav = NAV_ITEMS.filter((item) => store.settings.bottomNavItems.includes(item.id));

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", store.settings.accentColor);
    document.title = store.settings.appName || "Manhwa Lib";
  }, [store.settings.accentColor, store.settings.appName]);

  return (
    <div className="app-shell">
      <SessionRestorer />
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/feeds" element={<FeedsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/recommendations/:id" element={<RecommendationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/learn" element={<LearnPage />} />
          <Route path="/title/:id" element={<TitleDetailPage />} />
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.id} to={item.to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
              <Icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

function SessionRestorer() {
  const store = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current || !store.ready) return;
    restored.current = true;
    if (!store.settings.restoreLastSession) return;
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_RESTORE_KEY) ?? "{}") as { path?: string };
      const openedAtRoot = location.pathname === "/" && !location.search && (!window.location.hash || window.location.hash === "#/");
      if (saved.path && saved.path !== "/" && openedAtRoot) navigate(saved.path, { replace: true });
    } catch {
      // Bad restore metadata should never block the app.
    }
  }, [location.pathname, location.search, navigate, store.ready, store.settings.restoreLastSession]);

  useEffect(() => {
    if (!store.settings.restoreLastSession) return;
    const path = `${location.pathname}${location.search}`;
    if (location.pathname.startsWith("/title/")) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_RESTORE_KEY) ?? "{}") as { scroll?: Record<string, number> };
      const y = saved.scroll?.[path] ?? 0;
      if (y > 0) requestAnimationFrame(() => window.scrollTo({ top: y }));
    } catch {
      // Ignore stale restore payloads.
    }
  }, [location.pathname, location.search, store.settings.restoreLastSession]);

  useEffect(() => {
    if (!store.settings.restoreLastSession) return;
    const path = `${location.pathname}${location.search}`;
    if (location.pathname.startsWith("/title/")) return;
    const save = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(SESSION_RESTORE_KEY) ?? "{}") as {
          path?: string;
          scroll?: Record<string, number>;
        };
        localStorage.setItem(
          SESSION_RESTORE_KEY,
          JSON.stringify({ ...saved, path, scroll: { ...(saved.scroll ?? {}), [path]: window.scrollY } }),
        );
      } catch {
        // localStorage can be unavailable in private contexts.
      }
    };
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [location.pathname, location.search, store.settings.restoreLastSession]);

  return null;
}

function BottomDrawer({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer-content" onOpenAutoFocus={(event) => event.preventDefault()}>
          <div className="drawer-header">
            <Dialog.Title className="drawer-title">{title}</Dialog.Title>
            <Dialog.Description className="visually-hidden">
              Mobile-first drawer with controls for {title}. Use close, cancel, or apply actions to leave this panel.
            </Dialog.Description>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HomePage() {
  const store = useAppStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeAnimating, setSwipeAnimating] = useState(false);
  const activeFeed = store.feeds.find((feed) => feed.id === store.activeFeedId) ?? store.feeds[0] ?? null;

  useEffect(() => {
    if (!store.activeFeedId && store.feeds[0]) store.setActiveFeedId(store.feeds[0].id);
  }, [store]);

  const animateFeedChange = (nextIndex: number, direction: 1 | -1) => {
    const width = window.innerWidth || 360;
    setSwipeAnimating(true);
    setSwipeOffset(-direction * width);
    window.setTimeout(() => {
      store.setActiveFeedId(store.feeds[nextIndex].id);
      resetPageScroll();
      setSwipeAnimating(false);
      setSwipeOffset(direction * width);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSwipeAnimating(true);
          setSwipeOffset(0);
          window.setTimeout(() => setSwipeAnimating(false), 220);
        });
      });
    }, 190);
  };

  const settleSwipe = () => {
    setSwipeAnimating(true);
    setSwipeOffset(0);
    window.setTimeout(() => setSwipeAnimating(false), 180);
  };

  return (
    <div className="page">
      <FeedTabs />
      {!store.ready ? (
        <div className="empty-state">
          <strong>Loading local library</strong>
          <span className="muted">{store.syncStatus || "Opening IndexedDB cache"}</span>
        </div>
      ) : !activeFeed ? (
        <div className="empty-state">
          <Library size={34} />
          <h1>Build your first feed</h1>
          <p className="muted">
            Home stays empty until you create a feed, so every shelf here is intentional instead of a random default.
          </p>
          <button className="button primary" type="button" onClick={() => setEditorOpen(true)}>
            <Plus size={18} /> Create feed
          </button>
        </div>
      ) : (
        <div
          className={`feed-swipe-surface ${swipeAnimating ? "animating" : ""}`}
          style={{ "--swipe-offset": `${swipeOffset}px` } as React.CSSProperties}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            touchStart.current = { x: touch.clientX, y: touch.clientY };
          }}
          onTouchMove={(event) => {
            const start = touchStart.current;
            if (!start || event.touches.length === 0) return;
            const touch = event.touches[0];
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) < Math.abs(dy) * 1.2) return;
            setSwipeAnimating(false);
            setSwipeOffset(Math.max(-120, Math.min(120, dx)));
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            touchStart.current = null;
            if (!start || event.changedTouches.length === 0) {
              settleSwipe();
              return;
            }
            const touch = event.changedTouches[0];
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.35) {
              settleSwipe();
              return;
            }
            const index = store.feeds.findIndex((item) => item.id === activeFeed.id);
            const next = dx < 0 ? index + 1 : index - 1;
            if (next >= 0 && next < store.feeds.length) {
              animateFeedChange(next, dx < 0 ? 1 : -1);
            } else {
              settleSwipe();
            }
          }}
          onTouchCancel={settleSwipe}
        >
          <FeedView feed={activeFeed} />
        </div>
      )}
      <BottomDrawer title="Create Feed" open={editorOpen} onOpenChange={setEditorOpen}>
        <FeedEditor
          feed={createFeed("My Feed")}
          onCancel={() => setEditorOpen(false)}
          onSave={(feed) => {
            store.upsertFeed(feed);
            setEditorOpen(false);
          }}
        />
      </BottomDrawer>
    </div>
  );
}

function FeedTabs() {
  const store = useAppStore();
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [store.activeFeedId, store.feeds.length]);
  if (store.feeds.length === 0) return null;
  return (
    <div className="feed-tabs" aria-label="Feed tabs">
      {store.feeds.map((feed) => (
        <button
          type="button"
          key={feed.id}
          ref={store.activeFeedId === feed.id ? activeRef : null}
          className={`feed-tab ${store.activeFeedId === feed.id ? "active" : ""}`}
          onClick={() => {
            store.setActiveFeedId(feed.id);
            resetPageScroll();
          }}
        >
          <span className="feed-tab-title">{feed.name}</span>
        </button>
      ))}
    </div>
  );
}

function FeedView({ feed }: { feed: Feed }) {
  const store = useAppStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedSearch, setFeedSearch] = useState("");
  const runtimeFeed = useMemo(
    () =>
      feedSearch.trim()
        ? {
            ...feed,
            filters: { ...feed.filters, query: feedSearch.trim() },
          }
        : feed,
    [feed, feedSearch],
  );
  const query = useMemo(
    () =>
      runFeedQuery({
        feed: runtimeFeed,
        series: store.catalog,
        tags: store.tags,
        history: store.history,
        labels: store.labels,
        settings: store.settings,
        metaHistoryFirst: store.syncMeta?.historyFirstDate,
        metaHistoryLast: store.syncMeta?.historyLastDate,
      }),
    [runtimeFeed, store.catalog, store.history, store.labels, store.settings, store.syncMeta, store.tags],
  );
  return (
    <>
      <section className="section">
        <div className="feed-action-row">
          <button className="icon-button" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Feed menu">
            <EllipsisVertical size={20} />
          </button>
          {menuOpen && (
            <div className="popover-menu feed-menu">
              <button type="button" onClick={() => { setSearchOpen((open) => !open); setMenuOpen(false); }}><Search size={17} /> Search</button>
              <button type="button" onClick={() => { setEditorOpen(true); setMenuOpen(false); }}><SlidersHorizontal size={17} /> Settings</button>
              <button type="button" onClick={() => { setShareOpen(true); setMenuOpen(false); }}><Share2 size={17} /> Share</button>
              <button type="button" onClick={() => { setInfoOpen(true); setMenuOpen(false); }}><Info size={17} /> Info</button>
            </div>
          )}
        </div>
        <div className="feed-view-header">
          <div className="feed-view-title">
            <h1 className="single-line-title">{feed.name}</h1>
            {feed.showDescription && feed.description && <p className="feed-description">{feed.description}</p>}
          </div>
        </div>
        {searchOpen && (
          <div className="field feed-search">
            <label>Search in this feed</label>
            <input
              className="input"
              value={feedSearch}
              onChange={(event) => setFeedSearch(event.target.value)}
              placeholder="Filter current feed without changing saved settings"
              autoComplete="off"
            />
          </div>
        )}
        {query.activeNotes.map((note) => (
          <p className="muted tiny" key={note}>
            {note}
          </p>
        ))}
        {query.missingDateData && (
          <p className="muted tiny">Some current exports do not include date fields in the catalog yet.</p>
        )}
      </section>
      <TitleCollection
        items={query.items}
        feed={runtimeFeed}
        history={store.history}
        latestDate={store.syncMeta?.historyLastDate}
      />
      <BottomDrawer title="Feed Settings" open={editorOpen} onOpenChange={setEditorOpen}>
        <FeedEditor
          feed={feed}
          onCancel={() => setEditorOpen(false)}
          onSave={(updated) => {
            store.upsertFeed(updated);
            setEditorOpen(false);
          }}
        />
      </BottomDrawer>
      <BottomDrawer title="Share Feed" open={shareOpen} onOpenChange={setShareOpen}>
        <SharePanel payload={{ kind: "feed", version: 2, feed }} />
      </BottomDrawer>
      <BottomDrawer title="Feed Info" open={infoOpen} onOpenChange={setInfoOpen}>
        <div className="settings-list">
          <div className="setting-row"><span>Titles</span><strong>{query.items.length.toLocaleString()}</strong></div>
          <div className="setting-row"><span>Last data refresh</span><strong>{store.syncMeta?.lastSync ? new Date(store.syncMeta.lastSync).toLocaleString() : "Not synced"}</strong></div>
          <div className="setting-row"><span>Source</span><strong>{store.syncMeta?.source ?? "Offline cache"}</strong></div>
        </div>
      </BottomDrawer>
    </>
  );
}

function TitleCollection({
  items,
  feed,
  history,
  latestDate,
}: {
  items: SeriesCatalog[];
  feed: Feed;
  history: HistoryMap;
  latestDate?: string | null;
}) {
  const countKey = `manhwa-visible-count:${feed.id}`;
  const [visibleCount, setVisibleCount] = useState(() => Number(sessionStorage.getItem(countKey)) || 120);
  useEffect(() => {
    const saved = Number(sessionStorage.getItem(countKey)) || 120;
    setVisibleCount(Math.max(120, Math.min(saved, Math.max(120, items.length))));
  }, [countKey, items.length]);
  useEffect(() => {
    sessionStorage.setItem(countKey, String(visibleCount));
  }, [countKey, visibleCount]);
  const visibleItems = items.slice(0, visibleCount);
  const metricWindow = useMemo(() => resolveRollingWindow(feed.filters.rolling, latestDate), [feed.filters.rolling, latestDate]);

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <Filter size={28} />
        <strong>No titles matched this feed</strong>
        <span className="muted">Loosen filters, include gated tag families if intended, or switch source mode.</span>
      </div>
    );
  }
  return (
    <>
      <div
        className={`title-grid columns-${feed.view.gridColumns} density-${feed.view.gridDensity}`}
        style={{ "--grid-columns": feed.view.gridColumns } as React.CSSProperties}
      >
        {visibleItems.map((series, index) => (
          <TitleCard
            key={series.id}
            series={series}
            rank={index + 1}
            view={feed.view}
            history={history}
            latestDate={latestDate}
            metricWindow={metricWindow}
          />
        ))}
      </div>
      <LoadMore visibleCount={visibleCount} total={items.length} onMore={() => setVisibleCount((count) => count + 120)} />
    </>
  );
}

function LoadMore({ visibleCount, total, onMore }: { visibleCount: number; total: number; onMore: () => void }) {
  if (visibleCount >= total) return null;
  return (
    <div className="toolbar" style={{ justifyContent: "center", margin: "18px 0" }}>
      <button className="button" type="button" onClick={onMore}>
        Load more ({Math.min(visibleCount, total).toLocaleString()} / {total.toLocaleString()})
      </button>
    </div>
  );
}

function Cover({ series }: { series: SeriesCatalog }) {
  const initials = series.display_title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className="cover-wrap">
      {series.cover ? <img src={series.cover} alt="" loading="lazy" /> : <div className="cover-fallback cover-fallback-initials">{initials || "ML"}</div>}
    </div>
  );
}

function MosaicCover({ items, title }: { items: SeriesCatalog[]; title: string }) {
  const covers = items.filter((item) => item.cover).slice(0, 4);
  return (
    <div className="mosaic-cover" aria-hidden="true">
      {covers.length === 0 ? (
        <div className="mosaic-fallback">{title.slice(0, 2).toUpperCase()}</div>
      ) : (
        covers.map((item, index) => <img src={item.cover ?? ""} alt="" key={`${item.id}-${index}`} loading="lazy" />)
      )}
    </div>
  );
}

function GenreChips({ series, tagsById }: { series: SeriesCatalog; tagsById: Map<number, TagNode> }) {
  const genreTags = series.tag_ids
    .map((id) => tagsById.get(id))
    .filter((tag): tag is TagNode => Boolean(tag && isGenreTag(tag)))
    .slice(0, 3);
  if (genreTags.length === 0) return null;
  return (
    <div className="chips">
      {genreTags.map((tag) => (
        <span className="chip" key={tag.id}>
          {tag.name}
        </span>
      ))}
    </div>
  );
}

function TitleCard({
  series,
  rank,
  view,
  history,
  latestDate,
  metricWindow,
}: {
  series: SeriesCatalog;
  rank: number;
  view: FeedViewSettings;
  history: HistoryMap;
  latestDate?: string | null;
  metricWindow?: { from: string; to: string } | null;
}) {
  return (
    <div className="title-card-wrap">
      <Link to={`/title/${series.id}`} className="title-card" data-testid="title-card">
        <div className="poster-shell">
          <Cover series={series} />
          {view.visible.rank && <span className="rank">{rank}</span>}
          <div className="poster-metrics">
            <TitleMetrics series={series} view={view} compact history={history} latestDate={latestDate} metricWindow={metricWindow} />
          </div>
        </div>
        <div className="title-meta">
          <span className="title-name">{series.display_title}</span>
        </div>
      </Link>
    </div>
  );
}

function isGrowthMetric(metric: MetricId) {
  return metric.includes("Growth") || metric.includes("Delta");
}

function formatRawMetricValue(metric: MetricId, value: number) {
  if (!Number.isFinite(value)) return "n/a";
  if (metric === "fanFavouriteRaw" || metric === "fanFavouriteDelta") return `${value.toFixed(1)}%`;
  if (metric.includes("Percentile") || metric.includes("Percent")) return `${value.toFixed(0)}%`;
  if (metric === "meanScore" || metric === "fanFavouriteDiscoveryScore" || metric === "fanFavouriteDiscoveryPercentile") {
    return value.toFixed(metric === "meanScore" ? 0 : 1);
  }
  return value.toLocaleString();
}

function formatFeedMetricValue(
  series: SeriesCatalog,
  metric: MetricId,
  history: HistoryMap,
  latestDate?: string | null,
  metricWindow?: { from: string; to: string } | null,
) {
  if (metricWindow && isGrowthMetric(metric)) {
    const value = historyDeltaForWindow(series.id, metric, history, metricWindow.from, metricWindow.to);
    if (value != null) return formatRawMetricValue(metric, value);
  }
  return formatMetricValue(series, metric, history, latestDate);
}

function TitleMetrics({
  series,
  view,
  compact = false,
  history,
  latestDate,
  metricWindow,
}: {
  series: SeriesCatalog;
  view: FeedViewSettings;
  compact?: boolean;
  history: HistoryMap;
  latestDate?: string | null;
  metricWindow?: { from: string; to: string } | null;
}) {
  const metricSlots: MetricId[] = (view.metricSlots?.length ? view.metricSlots : (["fanFavouriteRaw", "popularity", "favourites"] as MetricId[])).slice(0, 3);
  const values = metricSlots
    .map((metric) => ({ metric, value: formatFeedMetricValue(series, metric, history, latestDate, metricWindow) }))
    .filter((item) => item.value !== "n/a");
  return (
    <div className={`metrics ${compact ? "compact-metrics" : ""}`}>
      {values.map(({ metric, value }) => (
        <span key={metric}>
          <b>{metricDefinition(metric).shortLabel}</b> {value}
        </span>
      ))}
    </div>
  );
}

function FeedsPage() {
  const store = useAppStore();
  const [editorFeed, setEditorFeed] = useState<Feed | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{ feed: Feed; covers: SeriesCatalog[]; x: number; y: number } | null>(null);
  const [coverMap, setCoverMap] = useState<Map<string, SeriesCatalog[]>>(new Map());
  const [coversLoading, setCoversLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCoversLoading(true);
    const handle = window.setTimeout(() => {
      const next = new Map<string, SeriesCatalog[]>();
      for (const feed of store.feeds) {
        next.set(
          feed.id,
          runFeedQuery({
            feed,
            series: store.catalog,
            tags: store.tags,
            history: store.history,
            labels: store.labels,
            settings: store.settings,
            metaHistoryFirst: store.syncMeta?.historyFirstDate,
            metaHistoryLast: store.syncMeta?.historyLastDate,
          }).items.slice(0, 4),
        );
      }
      if (!cancelled) {
        setCoverMap(next);
        setCoversLoading(false);
      }
    }, 24);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [store.catalog, store.feeds, store.history, store.labels, store.settings, store.syncMeta, store.tags]);

  return (
    <div className="page">
      <div className="row">
        <h1>Feeds</h1>
        <span className="spacer" />
        <button className="icon-button" type="button" onClick={() => setEditorFeed(createFeed("New Feed"))} aria-label="Create feed">
          <Plus size={18} />
        </button>
      </div>
      <p className="muted tiny">Hold the grip and drag a feed to change Home swipe order.</p>
      <div className="feed-cover-grid">
        {store.feeds.map((feed) => {
          const covers = coverMap.get(feed.id) ?? [];
          return (
            <FeedCoverCard
              key={feed.id}
              feed={feed}
              covers={covers}
              loading={coversLoading && covers.length === 0}
              dragging={draggingId === feed.id}
              over={overId === feed.id}
              onOpen={() => {
                store.setActiveFeedId(feed.id);
                resetPageScroll();
              }}
              onEdit={() => setEditorFeed(feed)}
              onDelete={() => store.deleteFeed(feed.id)}
              onDragStart={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDraggingId(feed.id);
                setOverId(feed.id);
                setDragGhost({ feed, covers, x: event.clientX, y: event.clientY });
              }}
              onDragMove={(event) => {
                if (!draggingId && !dragGhost) return;
                setDragGhost((current) => current && { ...current, x: event.clientX, y: event.clientY });
                const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-feed-id]");
                if (target?.dataset.feedId) setOverId(target.dataset.feedId);
              }}
              onDragEnd={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                if (draggingId && overId) store.moveFeed(draggingId, overId);
                setDraggingId(null);
                setOverId(null);
                setDragGhost(null);
              }}
            />
          );
        })}
      </div>
      {dragGhost && (
        <div className="feed-drag-ghost" style={{ left: dragGhost.x, top: dragGhost.y }}>
          <MosaicCover items={dragGhost.covers} title={dragGhost.feed.name} />
          <strong>{dragGhost.feed.name}</strong>
        </div>
      )}
      <BottomDrawer title={editorFeed?.name ?? "Feed"} open={Boolean(editorFeed)} onOpenChange={(open) => !open && setEditorFeed(null)}>
        {editorFeed && (
          <FeedEditor
            feed={editorFeed}
            onCancel={() => setEditorFeed(null)}
            onSave={(feed) => {
              store.upsertFeed(feed);
              setEditorFeed(null);
            }}
          />
        )}
      </BottomDrawer>
    </div>
  );
}

function FeedCoverCard({
  feed,
  covers,
  loading,
  dragging,
  over,
  onOpen,
  onEdit,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  feed: Feed;
  covers: SeriesCatalog[];
  loading: boolean;
  dragging: boolean;
  over: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: React.PointerEventHandler<HTMLButtonElement>;
  onDragMove: React.PointerEventHandler<HTMLButtonElement>;
  onDragEnd: React.PointerEventHandler<HTMLButtonElement>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article className={`feed-cover-card ${dragging ? "dragging" : ""} ${over ? "drag-over" : ""}`} data-feed-id={feed.id}>
      <Link className="feed-cover-link" to="/" onClick={onOpen}>
        {loading ? <div className="mosaic-cover mosaic-loading" aria-hidden="true" /> : <MosaicCover items={covers} title={feed.name} />}
        <strong className="feed-card-title">{feed.name}</strong>
        {feed.showDescription && feed.description && <span className="feed-card-description">{feed.description}</span>}
      </Link>
      <button
        className="feed-drag-handle"
        type="button"
        aria-label={`Reorder ${feed.name}`}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <GripVertical size={18} />
      </button>
      <button className="feed-card-menu-button" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={`${feed.name} menu`}>
        <EllipsisVertical size={18} />
      </button>
      {menuOpen && (
        <div className="popover-menu card-menu">
          <button type="button" onClick={() => { onEdit(); setMenuOpen(false); }}><SlidersHorizontal size={16} /> Edit</button>
          <SharePanelButton payload={{ kind: "feed", version: 2, feed }} label="Share" />
          <button className="danger-text" type="button" onClick={onDelete}><Trash2 size={16} /> Delete</button>
        </div>
      )}
    </article>
  );
}

function FeedEditor({ feed, onSave, onCancel }: { feed: Feed; onSave: (feed: Feed) => void; onCancel: () => void }) {
  const store = useAppStore();
  const [draft, setDraft] = useState<Feed>(() => structuredClone(feed));
  const [tagSearch, setTagSearch] = useState("");
  const statusOptions = useMemo(
    () => [...new Set(store.catalog.map((item) => item.status).filter(Boolean) as string[])].sort(),
    [store.catalog],
  );
  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    return q
      ? store.tags.filter((tag) => `${tag.name} ${tag.path}`.toLowerCase().includes(q))
      : store.tags;
  }, [store.tags, tagSearch]);
  const anilistLocked = feedUsesAniListOnlyParameters(draft);

  const updateFilters = (patch: Partial<Feed["filters"]>) => {
    setDraft((current) => ({ ...current, filters: { ...current.filters, ...patch } }));
  };
  const updateView = (patch: Partial<FeedViewSettings>) => {
    setDraft((current) => ({ ...current, view: { ...current.view, ...patch } }));
  };
  const toggleArrayValue = <T,>(values: T[], value: T) => (values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const toggleSourceMode = (mode: "anilist" | "non-anilist") => {
    if (anilistLocked && mode === "non-anilist") return;
    const current: SourceMode[] = draft.filters.sourceModes?.length ? draft.filters.sourceModes : ["anilist", "non-anilist"];
    const next = current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode];
    const normalized: SourceMode[] = next.length > 0 ? next : [mode];
    updateFilters({
      sourceModes: normalized,
      sourceMode: normalized.length === 2 ? "mixed" : normalized[0],
    });
  };

  useEffect(() => {
    if (!anilistLocked) return;
    if (draft.filters.sourceMode !== "anilist" || draft.filters.sourceModes?.some((mode) => mode !== "anilist")) {
      updateFilters({ sourceMode: "anilist", sourceModes: ["anilist"] });
    }
  }, [anilistLocked, draft.filters.sourceMode, draft.filters.sourceModes]);
  const cycleTag = (tagId: number) => {
    const include = draft.filters.includeTagIds.includes(tagId);
    const exclude = draft.filters.excludeTagIds.includes(tagId);
    if (!include && !exclude) updateFilters({ includeTagIds: [...draft.filters.includeTagIds, tagId] });
    if (include) {
      updateFilters({
        includeTagIds: draft.filters.includeTagIds.filter((id) => id !== tagId),
        excludeTagIds: [...draft.filters.excludeTagIds, tagId],
      });
    }
    if (exclude) updateFilters({ excludeTagIds: draft.filters.excludeTagIds.filter((id) => id !== tagId) });
  };

  return (
    <div>
      <div className="field">
        <label htmlFor="feed-name">Feed name</label>
        <input id="feed-name" className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="feed-description">Description</label>
        <textarea
          id="feed-description"
          className="textarea"
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          placeholder="Optional context for this feed"
        />
      </div>
      <ToggleRow
        label="Show description"
        description="Show the description directly below the feed name."
        value={draft.showDescription}
        onChange={(showDescription) => setDraft({ ...draft, showDescription })}
      />

      <h2 className="section-title">Filters</h2>
      <div className="field">
        <span className="small-label">Source</span>
        <div className="segmented">
          {(["anilist", "non-anilist"] as const).map((mode) => (
            <button
              className={`segment ${draft.filters.sourceModes?.includes(mode) ? "active" : ""}`}
              type="button"
              key={mode}
              disabled={anilistLocked && mode === "non-anilist"}
              onClick={() => toggleSourceMode(mode)}
            >
              {mode === "anilist" ? "AniList" : "Non-AniList"}
            </button>
          ))}
        </div>
        {anilistLocked && (
          <p className="muted tiny">AniList-only is locked because this feed uses AniList stats in sorting, ranges, or cover stats.</p>
        )}
      </div>

      <div className="field">
        <span className="small-label">Content ratings</span>
        <div className="chips">
          {(["safe", "suggestive", "erotica", "pornographic"] as ContentRating[]).map((rating) => (
            <button
              className={`chip chipbutton ${draft.filters.contentRatings.includes(rating) ? "active" : ""}`}
              type="button"
              key={rating}
              onClick={() => updateFilters({ contentRatings: toggleArrayValue(draft.filters.contentRatings, rating) })}
            >
              {rating}
            </button>
          ))}
        </div>
        <p className="muted tiny">Default sensitive exclusions apply only to exact BL, GL, Smut, and Hentai tags.</p>
      </div>

      <div className="field">
        <span className="small-label">Statuses</span>
        <div className="chips">
          {statusOptions.map((status) => (
            <button
              className={`chip chipbutton ${draft.filters.statuses.includes(status) ? "active" : ""}`}
              type="button"
              key={status}
              onClick={() => updateFilters({ statuses: toggleArrayValue(draft.filters.statuses, status) })}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="field-grid">
        <NumberField label="Min chapters" value={draft.filters.minChapters} onChange={(value) => updateFilters({ minChapters: value })} />
        <NumberField label="Max chapters" value={draft.filters.maxChapters} onChange={(value) => updateFilters({ maxChapters: value })} />
        <NumberField label="Min year" value={draft.filters.minYear} onChange={(value) => updateFilters({ minYear: value })} />
        <NumberField label="Max year" value={draft.filters.maxYear} onChange={(value) => updateFilters({ maxYear: value })} />
        <NumberField label="Min popularity" value={draft.filters.minPopularity} onChange={(value) => updateFilters({ minPopularity: value })} />
        <NumberField label="Max popularity" value={draft.filters.maxPopularity} onChange={(value) => updateFilters({ maxPopularity: value })} />
        <NumberField label="Min favourites" value={draft.filters.minFavourites} onChange={(value) => updateFilters({ minFavourites: value })} />
        <NumberField label="Max favourites" value={draft.filters.maxFavourites} onChange={(value) => updateFilters({ maxFavourites: value })} />
        <NumberField label="Min mean score" value={draft.filters.minMeanScore} onChange={(value) => updateFilters({ minMeanScore: value })} />
        <NumberField label="Max mean score" value={draft.filters.maxMeanScore} onChange={(value) => updateFilters({ maxMeanScore: value })} />
      </div>

      <MetricRangeEditor
        ranges={draft.filters.metricRanges ?? []}
        onChange={(metricRanges) => updateFilters({ metricRanges })}
      />

      <h2 className="section-title">Rolling Dates</h2>
      <div className="field-grid">
        <div className="field">
          <label>Date field</label>
          <div className="segmented">
            {[
              ["none", "None"],
              ["release", "Release"],
              ["end", "End"],
            ].map(([value, label]) => (
              <button
                className={`segment ${draft.filters.dateField === value ? "active" : ""}`}
                type="button"
                key={value}
                onClick={() => updateFilters({ dateField: value as Feed["filters"]["dateField"] })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Window mode</label>
          <div className="segmented">
            {[
              ["none", "None"],
              ["last", "Last X"],
              ["fixed", "Fixed"],
            ].map(([value, label]) => (
              <button
                className={`segment ${draft.filters.rolling.mode === value ? "active" : ""}`}
                type="button"
                key={value}
                onClick={() => updateFilters({ rolling: { ...draft.filters.rolling, mode: value as Feed["filters"]["rolling"]["mode"] } })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <NumberField
          label="Amount"
          value={draft.filters.rolling.amount}
          onChange={(value) => updateFilters({ rolling: { ...draft.filters.rolling, amount: value ?? 1 } })}
        />
        <div className="field">
          <label>Unit</label>
          <div className="segmented compact-segments">
            {(["days", "weeks", "months", "years"] as const).map((unit) => (
              <button
                className={`segment ${draft.filters.rolling.unit === unit ? "active" : ""}`}
                type="button"
                key={unit}
                onClick={() => updateFilters({ rolling: { ...draft.filters.rolling, unit } })}
              >
                {unit}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>From</label>
          <input className="input" type="date" value={draft.filters.rolling.from ?? ""} onChange={(event) => updateFilters({ rolling: { ...draft.filters.rolling, from: event.target.value } })} />
        </div>
        <div className="field">
          <label>To</label>
          <input className="input" type="date" value={draft.filters.rolling.to ?? ""} onChange={(event) => updateFilters({ rolling: { ...draft.filters.rolling, to: event.target.value } })} />
        </div>
      </div>

      <h2 className="section-title">Tags</h2>
      <div className="field">
        <label>Tag search</label>
        <input className="input" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="Genres, themes, tropes" />
      </div>
      <div className="field">
        <label>Tag match</label>
        <button
          className={`switch-row ${draft.filters.tagMatch === "any" ? "" : "on"}`}
          type="button"
          onClick={() => updateFilters({ tagMatch: draft.filters.tagMatch === "any" ? "all" : "any" })}
        >
          <span>{draft.filters.tagMatch === "any" ? "Match ANY included tag" : "Match ALL included tags"}</span>
          <span className="switch-dot" />
        </button>
      </div>
      <TagChipCloud tags={filteredTags} feed={draft} onTagClick={cycleTag} />

      <h2 className="section-title">Sort</h2>
      <div className="settings-list">
        {draft.sort.map((rule, index) => (
          <div className="setting-row" key={rule.id}>
            <div className="sort-editor">
              <div className="metric-choice">
                {SORT_OPTIONS.map((option) => (
                  <button
                    className={`metric-option ${rule.metric === option ? "active" : ""}`}
                    type="button"
                    key={option}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        sort: current.sort.map((item) => (item.id === rule.id ? { ...item, metric: option } : item)),
                      }))
                    }
                    title={metricDefinition(option).help}
                  >
                    {metricDefinition(option).shortLabel}
                  </button>
                ))}
              </div>
              <div className="segmented compact-segments">
                {(["desc", "asc"] as const).map((direction) => (
                  <button
                    className={`segment ${rule.direction === direction ? "active" : ""}`}
                    type="button"
                    key={direction}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        sort: current.sort.map((item) => (item.id === rule.id ? { ...item, direction } : item)),
                      }))
                    }
                  >
                    {direction === "desc" ? "High first" : "Low first"}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => setDraft((current) => ({ ...current, sort: current.sort.filter((item) => item.id !== rule.id) }))}
              aria-label={`Remove sort ${index + 1}`}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          className="button"
          type="button"
          onClick={() => setDraft((current) => ({ ...current, sort: [...current.sort, { ...DEFAULT_SORT[0], id: crypto.randomUUID() }] }))}
        >
          <Plus size={16} /> Add sort
        </button>
      </div>

      <h2 className="section-title">Title View</h2>
      <div className="field-grid">
        <div className="field">
          <label>Grid columns</label>
          <div className="segmented compact-segments">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                className={`segment ${draft.view.gridColumns === value ? "active" : ""}`}
                type="button"
                key={value}
                onClick={() => updateView({ gridColumns: value as FeedViewSettings["gridColumns"] })}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>
      <MetricSlotPicker
        slots={draft.view.metricSlots ?? []}
        onChange={(metricSlots) => updateView({ metricSlots })}
      />
      <ToggleRow
        label="Show rank"
        description="Places the rank inside the cover stat strip."
        value={draft.view.visible.rank}
        onChange={(rank) =>
          setDraft((current) => ({
            ...current,
            view: { ...current.view, visible: { ...current.view.visible, rank } },
          }))
        }
      />

      <div className="toolbar">
        <button className="button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <span className="spacer" />
        <button
          className="button"
          type="button"
          onClick={() =>
            setDraft({
              ...draft,
              filters: {
                ...DEFAULT_FILTERS,
                sourceModes: [...(DEFAULT_FILTERS.sourceModes ?? [])],
                contentRatings: [...DEFAULT_FILTERS.contentRatings],
                metricRanges: [],
              },
            })
          }
        >
          Reset filters
        </button>
        <button className="button primary" type="button" onClick={() => onSave(draft)}>
          <Check size={16} /> Save feed
        </button>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </div>
  );
}

function MetricRangeEditor({ ranges, onChange }: { ranges: MetricRange[]; onChange: (ranges: MetricRange[]) => void }) {
  const addRange = () => {
    const used = new Set(ranges.map((range) => range.metric));
    const nextMetric = RANGE_METRICS.find((metric) => !used.has(metric.id))?.id ?? "fanFavouriteRaw";
    onChange([...ranges, { id: crypto.randomUUID(), metric: nextMetric, min: null, max: null }]);
  };
  const update = (id: string, patch: Partial<MetricRange>) => {
    onChange(ranges.map((range) => (range.id === id ? { ...range, ...patch } : range)));
  };
  return (
    <section className="section compact-section">
      <div className="row">
        <h2 className="section-title">Additional Stat Ranges</h2>
        <span className="spacer" />
        <button className="button" type="button" onClick={addRange}>
          <Plus size={16} /> Add
        </button>
      </div>
      {ranges.length === 0 ? <p className="muted tiny">Add min/max filters for any metric, including Fan%, discovery, growth, year, and chapters.</p> : null}
      <div className="settings-list">
        {ranges.map((range) => (
          <div className="range-row" key={range.id}>
            <div className="metric-choice">
              {RANGE_METRICS.map((metric) => (
                <button
                  className={`metric-option ${range.metric === metric.id ? "active" : ""}`}
                  type="button"
                  key={metric.id}
                  onClick={() => update(range.id, { metric: metric.id })}
                >
                  {metric.shortLabel}
                </button>
              ))}
            </div>
            <NumberField label="Min" value={range.min} onChange={(min) => update(range.id, { min })} />
            <NumberField label="Max" value={range.max} onChange={(max) => update(range.id, { max })} />
            <button className="icon-button" type="button" onClick={() => onChange(ranges.filter((item) => item.id !== range.id))} aria-label="Remove stat range">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function MetricSlotPicker({ slots, onChange }: { slots: MetricId[]; onChange: (slots: MetricId[]) => void }) {
  const current = slots.length ? slots.slice(0, 3) : ["fanFavouriteRaw", "popularity", "favourites"] as MetricId[];
  const toggle = (metric: MetricId) => {
    if (current.includes(metric)) {
      onChange(current.filter((item) => item !== metric));
      return;
    }
    onChange([...current, metric].slice(-3));
  };
  return (
    <div className="field">
      <span className="small-label">Cover stats - max 3</span>
      <div className="metric-choice">
        {COVER_STAT_METRICS.map((metric) => (
          <button
            className={`metric-option ${current.includes(metric.id) ? "active" : ""}`}
            type="button"
            key={metric.id}
            onClick={() => toggle(metric.id)}
            title={metric.help}
          >
            {metric.shortLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function TagChipCloud({ tags, feed, onTagClick }: { tags: TagNode[]; feed: Feed; onTagClick: (id: number) => void }) {
  const [expandedRoots, setExpandedRoots] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    const map = new Map<string, TagNode[]>();
    for (const tag of tags) {
      const root = tag.is_genre ? "Genres" : tagRoot(tag);
      map.set(root, [...(map.get(root) ?? []), tag]);
    }
    const order = ["Genres", "Themes", "Settings", "Activities", "Narrative Tropes", "Work Info", "Relationship", "Character Types"];
    return [...map.entries()].sort((a, b) => {
      const ai = order.includes(a[0]) ? order.indexOf(a[0]) : 999;
      const bi = order.includes(b[0]) ? order.indexOf(b[0]) : 999;
      return ai - bi || a[0].localeCompare(b[0]);
    }).map(([root, group]) => [root, group.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name))] as [string, TagNode[]]);
  }, [tags]);
  const selectedTags = tags.filter((tag) => feed.filters.includeTagIds.includes(tag.id) || feed.filters.excludeTagIds.includes(tag.id));

  return (
    <div className="tag-tree">
      {selectedTags.length > 0 && (
        <div className="selected-tags">
          <span className="small-label">Selected</span>
          <div className="chips">
            {selectedTags.map((tag) => (
              <button
                className={`chip chipbutton ${feed.filters.includeTagIds.includes(tag.id) ? "active" : "exclude"}`}
                type="button"
                key={tag.id}
                onClick={() => onTagClick(tag.id)}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {grouped.map(([root, group]) => (
        <details className="tag-group" key={root} open={root === "Genres"}>
          <summary className="tag-summary">
            <span>{root}</span>
            <span className="muted tiny">{group.length}</span>
          </summary>
          <div className="chips tag-chip-grid">
            {(expandedRoots[root] ? group : group.slice(0, root === "Genres" ? 80 : 36)).map((tag) => {
              const included = feed.filters.includeTagIds.includes(tag.id);
              const excluded = feed.filters.excludeTagIds.includes(tag.id);
              return (
                <button
                  className={`chip chipbutton ${included ? "active" : ""} ${excluded ? "exclude" : ""}`}
                  type="button"
                  style={{ marginLeft: Math.max(0, tag.level - 1) * 8 }}
                  key={tag.id}
                  onClick={() => onTagClick(tag.id)}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
          {group.length > (root === "Genres" ? 80 : 36) && (
            <button
              className="button ghost"
              type="button"
              onClick={() => setExpandedRoots((current) => ({ ...current, [root]: !current[root] }))}
            >
              {expandedRoots[root] ? "Show less" : `Show all ${group.length}`}
            </button>
          )}
        </details>
      ))}
    </div>
  );
}

function SearchPage() {
  const store = useAppStore();
  const [query, setQuery] = useState(() => sessionStorage.getItem("manhwa-search-query") ?? "");
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("manhwa-search-history") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const searchFeed = useMemo(() => {
    const feed = createFeed("Search results");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.contentRatings = ["safe", "suggestive"];
    feed.view = { ...feed.view, gridColumns: 3 };
    return feed;
  }, []);
  const sensitiveTagGroups = useMemo(() => buildSensitiveTagGroups(store.tags), [store.tags]);
  const results = useMemo(
    () =>
      query.trim()
        ? store.catalog
            .filter((item) => {
              if (!item.display_title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) return false;
              if (!["safe", "suggestive"].includes(String(item.content_rating ?? ""))) return false;
              if (!store.settings.searchRelationshipTags && item.tag_ids.some((id) => sensitiveTagGroups.relationship.has(id))) return false;
              if (!store.settings.searchAdultTags && item.tag_ids.some((id) => sensitiveTagGroups.adult.has(id))) return false;
              return true;
            })
            .sort((a, b) => a.display_title.localeCompare(b.display_title))
        : [],
    [query, sensitiveTagGroups, store.catalog, store.settings.searchAdultTags, store.settings.searchRelationshipTags],
  );
  useEffect(() => {
    sessionStorage.setItem("manhwa-search-query", query);
  }, [query]);
  const remember = (value = query) => {
    const clean = value.trim();
    if (!clean) return;
    const next = [clean, ...history.filter((item) => item.toLocaleLowerCase() !== clean.toLocaleLowerCase())].slice(0, 12);
    setHistory(next);
    localStorage.setItem("manhwa-search-history", JSON.stringify(next));
  };
  return (
    <div className="page">
      <h1>Search</h1>
      <form className="field" onSubmit={(event) => { event.preventDefault(); remember(); }}>
        <label>Title</label>
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search titles"
          autoComplete="off"
        />
      </form>
      {query.trim() ? (
        <TitleCollection
          items={results}
          feed={searchFeed}
          history={store.history}
          latestDate={store.syncMeta?.historyLastDate}
        />
      ) : (
        <section>
          <div className="row">
            <h2 className="section-title">Recent searches</h2>
            <span className="spacer" />
            {history.length > 0 && (
              <button className="button ghost" type="button" onClick={() => { setHistory([]); localStorage.removeItem("manhwa-search-history"); }}>
                Clear
              </button>
            )}
          </div>
          <div className="chips">
            {history.map((item) => (
              <button className="chip chipbutton" type="button" key={item} onClick={() => { setQuery(item); remember(item); }}>
                {item}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RecommendationsPage() {
  const store = useAppStore();
  const params = useParams();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(Number(params.id) || null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingShelf, setEditingShelf] = useState<RecommendationShelf | null>(null);
  const defaultRecommendationTitle = store.catalog.find((item) => item.display_title.toLocaleLowerCase() === "bastard");
  const selected =
    store.catalog.find((item) => item.id === selectedId) ??
    store.catalog.find((item) => item.id === Number(params.id)) ??
    defaultRecommendationTitle ??
    store.catalog[0];
  const candidates = search.trim()
    ? store.catalog
        .filter((item) => item.display_title.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 12)
    : [];
  const saveShelf = (shelf: RecommendationShelf) => {
    store.updateSettings({
      recommendationShelves: store.settings.recommendationShelves.some((item) => item.id === shelf.id)
        ? store.settings.recommendationShelves.map((item) => (item.id === shelf.id ? shelf : item))
        : [...store.settings.recommendationShelves, shelf],
    });
    setEditingShelf(null);
    setEditorOpen(false);
  };
  const deleteShelf = (id: string) => {
    store.updateSettings({ recommendationShelves: store.settings.recommendationShelves.filter((shelf) => shelf.id !== id) });
  };
  return (
    <div className="page">
      <div className="row">
        <h1>Recommendations</h1>
        <span className="spacer" />
        <button
          className="icon-button"
          type="button"
          onClick={() => {
            setEditingShelf(null);
            setEditorOpen(true);
          }}
          aria-label="Create recommendation drawer"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="field">
        <label htmlFor="base-title">Base title</label>
        <input id="base-title" className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={selected?.display_title ?? "Search title"} />
      </div>
      {candidates.length > 0 && (
        <section>
          <h2 className="section-title">Pick a base title</h2>
          <div className="title-grid columns-3 recommendation-picker">
          {candidates.map((series) => (
            <button
              className={`recommendation-pick ${selected?.id === series.id ? "active" : ""}`}
              type="button"
              key={series.id}
              onClick={() => { setSelectedId(series.id); setSearch(""); }}
            >
              <Cover series={series} />
              <strong className="title-name">{series.display_title}</strong>
              <span className="muted tiny">Fan% {formatMetricValue(series, "fanFavouriteRaw", store.history, store.syncMeta?.historyLastDate)}</span>
            </button>
          ))}
          </div>
        </section>
      )}
      {selected && (
        <section className="selected-rec-base">
          <MosaicCover items={[selected]} title={selected.display_title} />
          <div>
            <span className="muted tiny">Selected</span>
            <h2>{selected.display_title}</h2>
            <p className="muted tiny">Recommendations prioritize shared tags, then shelf-specific sorting.</p>
          </div>
        </section>
      )}
      {selected &&
        store.settings.recommendationShelves.map((shelf) => {
          const items = recommendationItems(selected, shelf, store).slice(0, 20);
          const recFeed = createFeed(shelf.name);
          recFeed.id = `recommendation-${shelf.id}-${selected.id}`;
          recFeed.view = { ...recFeed.view, gridColumns: 3 };
          return (
            <section className="recommendation-section" key={shelf.id}>
              <div className="row recommendation-heading">
                <h2 className="section-title">{shelf.name}</h2>
                <span className="spacer" />
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => {
                    setEditingShelf(shelf);
                    setEditorOpen(true);
                  }}
                  aria-label={`Edit ${shelf.name}`}
                >
                  <SlidersHorizontal size={16} />
                </button>
                <button className="icon-button danger" type="button" onClick={() => deleteShelf(shelf.id)} aria-label={`Delete ${shelf.name}`}>
                  <Trash2 size={16} />
                </button>
              </div>
              <TitleCollection
                items={items}
                feed={recFeed}
                history={store.history}
                latestDate={store.syncMeta?.historyLastDate}
              />
            </section>
          );
        })}
      <BottomDrawer title={editingShelf ? "Edit Recommendation" : "Create Recommendation"} open={editorOpen} onOpenChange={setEditorOpen}>
        <RecommendationShelfEditor shelf={editingShelf} onCancel={() => setEditorOpen(false)} onSave={saveShelf} />
      </BottomDrawer>
    </div>
  );
}

function recommendationItems(base: SeriesCatalog, shelf: RecommendationShelf, store: ReturnType<typeof useAppStore>) {
  const baseTags = new Set(base.tag_ids);
  const filterFeed = createFeed(shelf.name);
  filterFeed.filters.sourceModes = shelf.sourceModes;
  filterFeed.filters.sourceMode = shelf.sourceModes.length === 2 ? "mixed" : shelf.sourceModes[0];
  filterFeed.filters.contentRatings = ["safe", "suggestive"];
  filterFeed.filters.metricRanges = shelf.metricRanges;
  const pool = runFeedQuery({
    feed: filterFeed,
    series: store.catalog,
    tags: store.tags,
    history: store.history,
    labels: store.labels,
    settings: store.settings,
    metaHistoryFirst: store.syncMeta?.historyFirstDate,
    metaHistoryLast: store.syncMeta?.historyLastDate,
  }).items.filter((item) => item.id !== base.id);
  return pool
    .map((item) => ({ item, tagScore: item.tag_ids.filter((id) => baseTags.has(id)).length }))
    .filter(({ item, tagScore }) => {
      if (tagScore === 0) return false;
      if (shelf.statusMode === "completed" && item.status !== "completed") return false;
      if (shelf.statusMode === "ongoing" && item.status === "completed") return false;
      return true;
    })
    .sort((a, b) => {
      if (a.tagScore !== b.tagScore) return b.tagScore - a.tagScore;
      for (const rule of shelf.sort) {
        const av = metricValue(a.item, rule.metric, store.history, store.syncMeta?.historyLastDate);
        const bv = metricValue(b.item, rule.metric, store.history, store.syncMeta?.historyLastDate);
        const aMissing = typeof av !== "string" && (av === -Infinity || av == null || Number.isNaN(Number(av)));
        const bMissing = typeof bv !== "string" && (bv === -Infinity || bv == null || Number.isNaN(Number(bv)));
        if (aMissing || bMissing) {
          if (aMissing && bMissing) continue;
          return aMissing ? 1 : -1;
        }
        if (av === bv) continue;
        const direction = rule.direction === "asc" ? 1 : -1;
        return av > bv ? direction : -direction;
      }
      if (shelf.dateMode === "latest") {
        const ad = isFutureDate(a.item.published?.start_date) ? "" : String(a.item.published?.start_date ?? "");
        const bd = isFutureDate(b.item.published?.start_date) ? "" : String(b.item.published?.start_date ?? "");
        return bd.localeCompare(ad);
      }
      return b.item.display_title.localeCompare(a.item.display_title);
    })
    .map(({ item }) => item);
}

function RecommendationShelfEditor({
  shelf,
  onSave,
  onCancel,
}: {
  shelf: RecommendationShelf | null;
  onSave: (shelf: RecommendationShelf) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RecommendationShelf>(
    () =>
      shelf ?? {
        id: crypto.randomUUID(),
        name: "Custom matches",
        statusMode: "any",
        dateMode: "any",
        sourceModes: ["anilist", "non-anilist"],
        sort: [{ id: crypto.randomUUID(), metric: "fanFavouriteRaw", direction: "desc" }],
        metricRanges: [],
      },
  );
  const toggleSource = (mode: "anilist" | "non-anilist") => {
    const next = draft.sourceModes.includes(mode) ? draft.sourceModes.filter((item) => item !== mode) : [...draft.sourceModes, mode];
    setDraft({ ...draft, sourceModes: next.length ? next : [mode] });
  };
  return (
    <div>
      <div className="field">
        <label>Name</label>
        <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </div>
      <div className="field">
        <label>Source</label>
        <div className="segmented">
          {(["anilist", "non-anilist"] as const).map((mode) => (
            <button className={`segment ${draft.sourceModes.includes(mode) ? "active" : ""}`} type="button" key={mode} onClick={() => toggleSource(mode)}>
              {mode === "anilist" ? "AniList" : "Non-AniList"}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Status</label>
        <div className="segmented">
          {(["any", "completed", "ongoing"] as const).map((mode) => (
            <button className={`segment ${draft.statusMode === mode ? "active" : ""}`} type="button" key={mode} onClick={() => setDraft({ ...draft, statusMode: mode })}>
              {mode}
            </button>
          ))}
        </div>
      </div>
      <section className="section compact-section">
        <div className="row">
          <h2 className="section-title">Sort</h2>
          <span className="spacer" />
          <button
            className="button"
            type="button"
            onClick={() =>
              setDraft({
                ...draft,
                sort: [...draft.sort, { id: crypto.randomUUID(), metric: "fanFavouriteRaw", direction: "desc" }],
              })
            }
          >
            <Plus size={16} /> Add
          </button>
        </div>
        <div className="settings-list">
          {draft.sort.map((rule) => (
            <div className="setting-row" key={rule.id}>
              <div className="sort-editor">
                <div className="metric-choice">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      className={`metric-option ${rule.metric === option ? "active" : ""}`}
                      type="button"
                      key={option}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          sort: draft.sort.map((item) => (item.id === rule.id ? { ...item, metric: option } : item)),
                        })
                      }
                      title={metricDefinition(option).help}
                    >
                      {metricDefinition(option).shortLabel}
                    </button>
                  ))}
                </div>
                <div className="segmented compact-segments">
                  {(["desc", "asc"] as const).map((direction) => (
                    <button
                      className={`segment ${rule.direction === direction ? "active" : ""}`}
                      type="button"
                      key={direction}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          sort: draft.sort.map((item) => (item.id === rule.id ? { ...item, direction } : item)),
                        })
                      }
                    >
                      {direction === "desc" ? "High first" : "Low first"}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setDraft({ ...draft, sort: draft.sort.filter((item) => item.id !== rule.id) })}
                aria-label="Remove recommendation sort"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>
      <MetricRangeEditor ranges={draft.metricRanges} onChange={(metricRanges) => setDraft({ ...draft, metricRanges })} />
      <div className="toolbar">
        <button className="button" type="button" onClick={onCancel}>Cancel</button>
        <span className="spacer" />
        <button className="button primary" type="button" onClick={() => onSave(draft)}>Save drawer</button>
      </div>
    </div>
  );
}

function SettingsPage() {
  const store = useAppStore();
  return (
    <div className="page">
      <h1>Settings</h1>

      <SettingsSection title="App Settings">
        <div className="field">
          <label>In-app app name</label>
          <input className="input" value={store.settings.appName} onChange={(event) => store.updateSettings({ appName: event.target.value })} />
        </div>
        <div className="field">
          <label>Accent color</label>
          <input className="input" type="color" value={store.settings.accentColor} onChange={(event) => store.updateSettings({ accentColor: event.target.value })} />
        </div>
      </SettingsSection>

      <SettingsSection title="Data & Sync">
        <div className="field">
          <label>Data source URL</label>
          <input className="input" value={store.settings.dataSourceUrl} onChange={(event) => store.updateSettings({ dataSourceUrl: event.target.value })} />
        </div>
        <div className="setting-row">
          <div>
            <strong>{store.syncMeta?.totalSeries.toLocaleString() ?? 0} titles cached</strong>
            <div className="muted tiny">{store.syncStatus || store.syncMeta?.source || "No sync yet"}</div>
          </div>
          <button className="button" type="button" onClick={() => void store.refreshData()}>
            <Database size={16} /> Refresh
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="Session">
        <ToggleRow label="Restore last session" description="Reopen at the prior route/feed/scroll when possible." value={store.settings.restoreLastSession} onChange={(restoreLastSession) => store.updateSettings({ restoreLastSession })} />
      </SettingsSection>

      <SettingsSection title="Search">
        <ToggleRow
          label="Show BL / GL families"
          description="Global title search includes Boys Love, Girls Love, Yaoi, Yuri, and child tags only when this is on."
          value={store.settings.searchRelationshipTags}
          onChange={(searchRelationshipTags) => store.updateSettings({ searchRelationshipTags })}
        />
        <ToggleRow
          label="Show Smut / Hentai"
          description="Global title search includes Smut, Hentai, and child tags only when this is on."
          value={store.settings.searchAdultTags}
          onChange={(searchAdultTags) => store.updateSettings({ searchAdultTags })}
        />
      </SettingsSection>

      <SettingsSection title="Sharing & Backup">
        <Link className="button" to="/learn">
          <Info size={16} /> Learn metrics and data
        </Link>
        <SharePanelButton payload={{ kind: "settings", version: 2, settings: store.settings }} label="Share settings" />
        <button
          className="button"
          type="button"
          onClick={() => downloadText("manhwa-library-backup.json", JSON.stringify(makeSnapshot(store), null, 2))}
        >
          <Download size={16} /> Export JSON backup
        </button>
        <button
          className="button"
          type="button"
          onClick={() =>
            downloadText(
              "manhwa-library-feeds.csv",
              exportCsv(store.feeds.map((feed) => ({ name: feed.name, description: feed.description, sourceMode: feed.filters.sourceMode, createdAt: feed.createdAt }))),
            )
          }
        >
          <Download size={16} /> Export feeds CSV
        </button>
        <button className="button danger" type="button" onClick={() => void store.resetLocalState()}>
          Reset local app state
        </button>
      </SettingsSection>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <div className="settings-list">{children}</div>
    </section>
  );
}

function ToggleRow({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <div className="muted tiny">{description}</div>
      </div>
      <Switch.Root className={`switch ${value ? "on" : ""}`} checked={value} onCheckedChange={onChange} aria-label={label}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </div>
  );
}

function TitleDetailPage() {
  const store = useAppStore();
  const navigate = useNavigate();
  const params = useParams();
  const id = Number(params.id);
  const catalogItem = store.catalog.find((item) => item.id === id);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [status, setStatus] = useState("Loading detail");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const detailLayoutKey = `manhwa-detail-layout:${store.activeFeedId ?? "default"}`;
  const [visible, setVisible] = useState(() => {
    try {
      return {
        ...DEFAULT_DETAIL_VISIBLE,
        description: true,
        authorsArtists: true,
        links: true,
        ...JSON.parse(localStorage.getItem(detailLayoutKey) ?? "{}"),
      };
    } catch {
      return { ...DEFAULT_DETAIL_VISIBLE, description: true, authorsArtists: true, links: true };
    }
  });
  const tagsById = useMemo(() => new Map(store.tags.map((tag) => [tag.id, tag])), [store.tags]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [id]);

  useEffect(() => {
    localStorage.setItem(detailLayoutKey, JSON.stringify(visible));
  }, [detailLayoutKey, visible]);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    void fetchSeriesDetail(store.settings.dataSourceUrl, id)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load detail"));
    return () => {
      cancelled = true;
    };
  }, [id, store.settings.dataSourceUrl]);

  const series = detail && catalogItem
    ? {
        ...detail,
        display_title: resolveDisplayTitle(detail, catalogItem),
        stats: catalogItem.stats,
        analytics: catalogItem.analytics,
        source: catalogItem.source ?? detail.source,
        published: catalogItem.published ?? detail.published,
        last_updated_at: catalogItem.last_updated_at ?? detail.last_updated_at,
        authors: catalogItem.authors?.length ? catalogItem.authors : detail.authors,
        artists: catalogItem.artists?.length ? catalogItem.artists : detail.artists,
        links: { ...(detail.links ?? {}), ...(catalogItem.links ?? {}) },
      }
    : detail
      ? { ...detail, display_title: resolveDisplayTitle(detail) }
      : catalogItem;
  if (!series) {
    return (
      <div className="page">
        <button className="button" type="button" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </button>
        <p className="muted">{status}</p>
      </div>
    );
  }

  return (
    <div className="detail-page">
      {series.cover && <img className="detail-bg" src={series.cover} alt="" />}
      <div className="detail-top-actions">
        <button className="icon-button" type="button" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <span className="spacer" />
        <Link className="icon-button" to={`/recommendations/${series.id}`} aria-label="Recommendations">
          <Sparkles size={20} />
        </Link>
        <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Detail settings">
          <EllipsisVertical size={20} />
        </button>
      </div>
      <section className="detail-identity">
        {visible.cover && (series.cover ? <img className="detail-cover" src={series.cover} alt="" /> : <div className="detail-cover cover-fallback">No cover</div>)}
        <div className="detail-copy">
          {visible.title && <h1 className="detail-title">{series.display_title}</h1>}
          {visible.authorsArtists && (
            <p className="detail-creators">{uniqueNames(series.authors, series.artists).join(" / ") || "Creator unavailable"}</p>
          )}
          <p className="detail-facts">
            {[visible.year && series.year ? String(series.year) : "", visible.status ? series.status ?? "" : "", visible.chapters && series.total_chapters ? `${series.total_chapters} chapters` : ""]
              .filter(Boolean)
              .join(" / ")}
          </p>
        </div>
      </section>
      <section className="detail-stat-grid">
        {(["fanFavouriteRaw", "popularity", "favourites"] as MetricId[]).map((metric) => (
          <div className="detail-stat" key={metric}>
            <strong>{formatMetricValue(series, metric, store.history, store.syncMeta?.historyLastDate)}</strong>
            <span>{metricDefinition(metric).shortLabel}</span>
          </div>
        ))}
      </section>
      {visible.genreTags && <section className="detail-block"><GenreChips series={series} tagsById={tagsById} /></section>}
      <section className="detail-block detail-links">
        <DetailLinks series={series} />
      </section>
      {visible.description && detail?.description && (
        <section className="detail-block">
          <h2 className="section-title">Description</h2>
          <p>{detail.description}</p>
        </section>
      )}
      {visible.allTags && (
        <section className="detail-block">
          <h2 className="section-title">Tags</h2>
          <div className="chips">
            {series.tag_ids
              .map((tagId) => tagsById.get(tagId))
              .filter(Boolean)
              .map((tag) => (
                <span className="chip" key={tag!.id}>
                  {tag!.name}
                </span>
              ))}
          </div>
        </section>
      )}
      <section className="detail-block detail-recommendations">
        <div className="row">
          <h2 className="section-title">Recommendations</h2>
          <span className="spacer" />
          <button className="button ghost" type="button" onClick={() => setShowAllRecommendations((value) => !value)}>
            {showAllRecommendations ? "Show less" : "Show more"}
          </button>
        </div>
        {store.settings.recommendationShelves.slice(0, showAllRecommendations ? undefined : 1).map((shelf) => {
          const items = recommendationItems(series, shelf, store).slice(0, showAllRecommendations ? 20 : 6);
          const recFeed = createFeed(shelf.name);
          recFeed.id = `detail-rec-${series.id}-${shelf.id}`;
          recFeed.view.gridColumns = 3;
          return (
            <div className="detail-rec-section" key={shelf.id}>
              <h3>{shelf.name}</h3>
              <TitleCollection items={items} feed={recFeed} history={store.history} latestDate={store.syncMeta?.historyLastDate} />
            </div>
          );
        })}
      </section>
      <BottomDrawer title="Detail Settings" open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DetailSettingsDrawer visible={visible} onChange={setVisible} />
      </BottomDrawer>
    </div>
  );
}

function uniqueNames(...groups: (string[] | undefined)[]) {
  return [...new Set(groups.flat().filter(Boolean))];
}

function DetailLinks({ series }: { series: SeriesCatalog }) {
  const links = [
    ["MangaBaka", series.links?.mangabaka],
    ["AniList", series.source?.anilist?.url],
    ["MangaUpdates", series.source?.mangaupdates?.url],
    ["Anime-Planet", series.source?.animeplanet?.url],
    ["Read EN", series.links?.read_en],
  ].filter(([, href]) => Boolean(href)) as [string, string][];
  if (links.length === 0) return null;
  return (
    <div className="chips link-chips">
      {links.map(([label, href]) => (
        <a className="chip link-chip" href={href} target="_blank" rel="noreferrer" key={label}>
          {label} <ExternalLink size={13} />
        </a>
      ))}
    </div>
  );
}

function DetailSettingsDrawer({
  visible,
  onChange,
}: {
  visible: AppSettings["detailVisible"];
  onChange: React.Dispatch<React.SetStateAction<AppSettings["detailVisible"]>>;
}) {
  const fields: [keyof AppSettings["detailVisible"], string, string][] = [
    ["cover", "Cover", "Show the title artwork."],
    ["title", "Title", "Show the primary title."],
    ["description", "Description", "Show the full available synopsis."],
    ["genreTags", "Genres", "Show the main genre row."],
    ["allTags", "All tags", "Show every catalog tag."],
    ["authorsArtists", "Creators", "Show authors and artists."],
    ["links", "External links", "Show MangaBaka, AniList, and other sources."],
    ["status", "Status", "Show publication status."],
    ["year", "Year", "Show release year."],
    ["chapters", "Chapters", "Show chapter count when available."],
  ];
  return (
    <div className="settings-list detail-toggle-list">
      {fields.map(([key, label, description]) => (
        <ToggleRow
          key={key}
          label={label}
          description={description}
          value={visible[key]}
          onChange={(value) => onChange((current) => ({ ...current, [key]: value }))}
        />
      ))}
    </div>
  );
}

function LearnPage() {
  return (
    <div className="page">
      <h1>Learn</h1>
      <div className="learn-grid">
        <LearnItem title="MangaBaka">
          MangaBaka is the catalog backbone: titles, covers, chapters, status, dates, content rating, links, and the detailed tag
          hierarchy come from the backend export. <a href="https://mangabaka.org" target="_blank" rel="noreferrer">Open MangaBaka</a>.
        </LearnItem>
        <LearnItem title="AniList Metrics">
          Popularity, favourites, and mean score are used only for AniList-mapped titles. Non-AniList titles can still be browsed
          through common filters such as title, tags, year, chapters, and status. <a href="https://anilist.co" target="_blank" rel="noreferrer">Open AniList</a>.
        </LearnItem>
        <LearnItem title="Discovery Metrics">
          Fan% is favourites divided by popularity. Discovery score combines fandom attachment and popularity confidence so niche titles do not unfairly dominate.
        </LearnItem>
        <LearnItem title="Cover Stats">
          Cover stat slots show at most three metrics. Fan% is the default rank signal, with Pop and Fav beside it for context.
        </LearnItem>
        <LearnItem title="Safe Defaults">
          Safe and suggestive content are enabled by default. BL, GL, Smut, and Hentai are exact-tag exclusions unless a feed explicitly includes them.
        </LearnItem>
        <LearnItem title="Offline And Sharing">
          Catalog, tags, history, feeds, settings, and opened details are cached locally. Share links contain compressed
          config data and open an import preview before changing anything.
        </LearnItem>
        <LearnItem title="Other Sources">
          Non-AniList titles prefer <a href="https://www.mangaupdates.com" target="_blank" rel="noreferrer">MangaUpdates</a>, then{" "}
          <a href="https://www.anime-planet.com/manga" target="_blank" rel="noreferrer">Anime-Planet</a>. Available English reading links appear last.
        </LearnItem>
        <LearnItem title="Live Data Sync">
          The app now merges live backend catalog stats with query-only enriched fields so cover stats and detail stats use the current backend values.
        </LearnItem>
        <LearnItem title="Data Limits">
          Long growth windows become more useful as backend history accumulates. Until then, the app runs against available history and
          tells you when a query is limited.
        </LearnItem>
      </div>
    </div>
  );
}

function LearnItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="learn-item">
      <h2 className="section-title">{title}</h2>
      <p className="muted">{children}</p>
    </section>
  );
}

function ImportPage() {
  const store = useAppStore();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const payload = useMemo(() => {
    const encoded = params.get("p");
    if (!encoded) return null;
    try {
      return decodeSharePayload(encoded);
    } catch {
      return null;
    }
  }, [params]);

  useEffect(() => {
    if (payload?.kind !== "feed") return;
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = payload.feed.name;
    if (description) description.content = payload.feed.showDescription && payload.feed.description.trim()
      ? payload.feed.description.trim()
      : `Add the ${payload.feed.name} feed.`;
    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, [payload]);

  const apply = (mode: "merge" | "replace") => {
    if (!payload) return;
    if (payload.kind === "feed") store.importSnapshot({ feeds: [payload.feed] }, "merge");
    if (payload.kind === "settings") store.importSnapshot({ settings: payload.settings as AppSettings }, mode);
    if (payload.kind === "labels") store.importSnapshot({ labels: payload.labels }, mode);
    if (payload.kind === "full") store.importSnapshot(payload.snapshot, mode);
    navigate("/");
  };

  return (
    <div className="page">
      <h1>Import Preview</h1>
      {!payload ? (
        <div className="empty-state">This share link could not be decoded.</div>
      ) : (
        <div className="empty-state">
          <Import size={28} />
          <strong>{payload.kind === "feed" ? payload.feed.name : `${payload.kind} share`}</strong>
          <span className="muted">
            {payload.kind === "feed" && payload.feed.showDescription && payload.feed.description.trim()
              ? payload.feed.description.trim()
              : payload.kind === "feed"
                ? "Review this feed before adding it to your library."
                : "Review before applying this shared configuration."}
          </span>
          <div className="toolbar">
            <button className="button primary" type="button" onClick={() => apply("merge")}>
              Add
            </button>
            {(payload.kind === "settings" || payload.kind === "full") && (
              <button className="button" type="button" onClick={() => apply("replace")}>
                Replace settings/full backup
              </button>
            )}
            <button className="button" type="button" onClick={() => navigate("/")}>
              Do not add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SharePanelButton({ payload, label = "Share" }: { payload: SharePayload; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="button" type="button" onClick={() => setOpen(true)}>
        <Share2 size={16} /> {label}
      </button>
      <BottomDrawer title={label} open={open} onOpenChange={setOpen}>
        <SharePanel payload={payload} />
      </BottomDrawer>
    </>
  );
}

function SharePanel({ payload }: { payload: SharePayload }) {
  const url = useMemo(() => makeShareUrl(payload), [payload]);
  const title = payload.kind === "feed" ? payload.feed.name : "Manhwa Lib configuration";
  const description = payload.kind === "feed" && payload.feed.showDescription ? payload.feed.description.trim() : "";
  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title, text: description ? `${title}\n${description}` : title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
  };
  return (
    <div>
      <h2 className="share-title">{title}</h2>
      {description && <p className="muted">{description}</p>}
      <p className="muted">Same-domain compressed share link. No URL shortener, no tracker.</p>
      <textarea className="textarea" readOnly value={url} />
      <div className="toolbar">
        <button className="button primary" type="button" onClick={() => void share()}>
          <Share2 size={16} /> Share
        </button>
        <button className="button" type="button" onClick={() => void navigator.clipboard.writeText(url)}>
          <Copy size={16} /> Copy
        </button>
      </div>
    </div>
  );
}

function makeSnapshot(store: ReturnType<typeof useAppStore>) {
  return {
    feeds: store.feeds,
    settings: store.settings,
    activeFeedId: store.activeFeedId,
    lastRoute: window.location.hash,
  };
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default App;
