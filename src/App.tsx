import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Database,
  Download,
  EllipsisVertical,
  Filter,
  Folder as FolderIcon,
  FolderOpen,
  GripVertical,
  Home,
  Import,
  Info,
  Library,
  ListTree,
  ListFilter,
  Plus,
  Sparkles,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { appDebugLog } from "./lib/debug";
import ReactMarkdown from "react-markdown";
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
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { createFeed, DEFAULT_DETAIL_VISIBLE, DEFAULT_FILTERS, DEFAULT_SORT, makeId } from "./domain/defaults";
import { resolveRollingWindow } from "./domain/dates";
import {
  canMoveFolder,
  descendantFolderIds,
  feedLocation,
  orderedFolderTree,
  resolveHomeFeeds,
  unfiledFeeds,
} from "./domain/feedLibrary";
import { buildSensitiveTagGroups, feedUsesAniListOnlyParameters, hasAniList, hasDetailTags, isGenreTag, isSearchVisible, runFeedQuery, sensitiveTagIdsForSearch, tagRoot } from "./domain/query";
import { displayComparableMetricValue, formatMetricValue, historyDeltaForWindow, METRIC_DEFINITIONS, metricDefinition } from "./domain/metrics";
import { rankRecommendationsAsync } from "./domain/recommendations";
import { resolveVisibleTitle } from "./domain/displayTitle";
import { decodeSharePayload, makeShareUrl, type SharePayload } from "./domain/share";
import type {
  AppSettings,
  AppStateSnapshot,
  ContentRating,
  Feed,
  FeedFolder,
  FeedViewSettings,
  HistoryMap,
  MetricId,
  MetricRange,
  ProfileSeedMode,
  RecommendationShelf,
  SeriesCatalog,
  SeriesDetail,
  SourceMode,
  TagNode,
} from "./domain/types";
import { fetchSeriesDetail } from "./services/dataService";
import { AppStoreProvider, MAX_PROFILES, useAppStore } from "./store/useAppStore";
import { ACTIVE_PROFILE_KEY } from "./store/profilePersistence";

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
const RECOMMENDATION_DEFAULT_RESULTS = 6;
const RECOMMENDATION_MAX_RESULTS = 18;
const SEARCH_DEBOUNCE_MS = 140;
const HOME_FEED_RENDER_RADIUS = 4;
const HOME_FEED_PREVIEW_TITLES = 18;
const FEED_TITLE_EXPANDED_MAX = 140;
const FEED_DESCRIPTION_EXPANDED_MAX = 260;
const PWA_CHROME_THEME_COLOR = "#11131a";

const HOME_SCROLL_PREFIX = "manhwa-home-scroll";
const HOME_RETURNING_FROM_TITLE_KEY = "manhwa-home-returning-from-title";
const FEEDS_SCROLL_KEY = "manhwa-feeds-scroll";
const SEARCH_OPENED_HISTORY_LIMIT = 99;
const ACCENT_COLORS = [
  { name: "Rose", value: "#ff3b81" },
  { name: "Blue", value: "#4f8cff" },
  { name: "Emerald", value: "#26c281" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Cyan", value: "#06b6d4" },
] as const;
type RouteFeedbackKind = "detail" | "page";

function clearRouteFeedback() {
  delete document.documentElement.dataset.routePending;
}

function scheduleRouteChange(kind: RouteFeedbackKind, action: () => void) {
  document.documentElement.dataset.routePending = kind;
  action();
  window.setTimeout(clearRouteFeedback, 1800);
}

function isPlainNavigationClick(event: React.MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function markImageLoaded(event: React.SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.classList.add("image-loaded");
}

type RgbColor = [number, number, number];
const DEFAULT_FEED_PALETTE: [RgbColor, RgbColor, RgbColor] = [
  [126, 82, 166],
  [64, 132, 158],
  [170, 92, 132],
];
const coverPaletteCache = new Map<string, Promise<RgbColor>>();

function extractBrightCoverColor(image: HTMLImageElement): RgbColor {
  const canvas = document.createElement("canvas");
  canvas.width = 20;
  canvas.height = 28;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return DEFAULT_FEED_PALETTE[0];
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const candidates: Array<{ color: RgbColor; score: number }> = [];
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 220) continue;
    const color: RgbColor = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const [r, g, b] = color.map((channel) => channel / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (luminance < 0.2 || luminance > 0.96 || saturation < 0.1) continue;
    candidates.push({ color, score: luminance * 0.72 + saturation * 0.28 });
  }
  if (candidates.length === 0) return DEFAULT_FEED_PALETTE[0];
  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates.slice(0, Math.max(10, Math.ceil(candidates.length * 0.22)));
  const totals = selected.reduce(
    (result, candidate) => {
      const weight = candidate.score * candidate.score;
      result.red += candidate.color[0] * weight;
      result.green += candidate.color[1] * weight;
      result.blue += candidate.color[2] * weight;
      result.weight += weight;
      return result;
    },
    { red: 0, green: 0, blue: 0, weight: 0 },
  );
  const averaged: RgbColor = [
    Math.round(totals.red / totals.weight),
    Math.round(totals.green / totals.weight),
    Math.round(totals.blue / totals.weight),
  ];
  const luminance = (averaged[0] * 0.2126 + averaged[1] * 0.7152 + averaged[2] * 0.0722) / 255;
  const lift = luminance < 0.48 ? Math.min(1.6, 0.48 / Math.max(luminance, 0.01)) : 1;
  return averaged.map((channel) => Math.min(255, Math.round(channel * lift))) as RgbColor;
}

function sampleCoverColor(url: string, fallback: RgbColor) {
  const cached = coverPaletteCache.get(url);
  if (cached) return cached;
  const sampled = new Promise<RgbColor>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        resolve(extractBrightCoverColor(image));
      } catch {
        resolve(fallback);
      }
    };
    image.onerror = () => resolve(fallback);
    image.src = url;
  });
  coverPaletteCache.set(url, sampled);
  return sampled;
}
function visibleTitle(series: SeriesCatalog, fallback?: SeriesCatalog) {
  return resolveVisibleTitle(series, fallback);
}

function cappedText(text: string, max: number) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function profileStorageKey(key: string) {
  return `${key}:${localStorage.getItem(ACTIVE_PROFILE_KEY) ?? "default"}`;
}

function homeScrollKey(feed: Feed | null) {
  if (!feed) return profileStorageKey(`${HOME_SCROLL_PREFIX}:none`);
  return profileStorageKey(`${HOME_SCROLL_PREFIX}:${feed.id}:${feed.view.gridColumns}:${feed.view.gridDensity}`);
}

function getHomeScrollContainer(feed: Feed | null) {
  if (!feed) return null;
  return document.querySelector<HTMLElement>(`[data-home-scroll-key="${homeScrollKey(feed)}"]`);
}

function saveHomeScroll(feed: Feed | null) {
  if (!feed) return;
  try {
    const key = homeScrollKey(feed);
    const scrollTop = getHomeScrollContainer(feed)?.scrollTop ?? 0;
    localStorage.setItem(key, String(scrollTop));
  } catch {
    // Best effort only.
  }
}

function prepareHomeTitleNavigation(feed: Feed | null) {
  if (!getHomeScrollContainer(feed)) return;
  saveHomeScroll(feed);
  try {
    sessionStorage.setItem(profileStorageKey(HOME_RETURNING_FROM_TITLE_KEY), "1");
  } catch {
    // Best effort only.
  }
}

function restoreHomeScroll(feed: Feed | null) {
  if (!feed) return;
  const key = homeScrollKey(feed);
  const target = Number(localStorage.getItem(key));
  appDebugLog("home-scroll", "restore lookup", { feedId: feed?.id ?? null, key, target });
  if (!Number.isFinite(target) || target <= 0) return;
  const container = getHomeScrollContainer(feed);
  if (!container) {
    requestAnimationFrame(() => restoreHomeScroll(feed));
    return;
  }
  container.scrollTo({ top: target, behavior: "auto" });
}

function formatStatusLabel(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function faviconForUrl(href: string) {
  try {
    const url = new URL(href);
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
  } catch {
    return "";
  }
}

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
  const location = useLocation();
  const navigate = useNavigate();
  const nav = NAV_ITEMS.filter((item) => store.settings.bottomNavItems.includes(item.id));
  const showingHome = location.pathname === "/";
  const showingTitle = location.pathname.startsWith("/title/");
  const keepHomeMounted = showingHome || showingTitle;
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", store.settings.accentColor);
    document.title = store.settings.appName || "Manhwa Lib";
  }, [store.settings.accentColor, store.settings.appName]);

  useEffect(() => {
    let themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!themeMeta) {
      themeMeta = document.createElement("meta");
      themeMeta.name = "theme-color";
      document.head.appendChild(themeMeta);
    }
    const enforceChromeTheme = () => {
      themeMeta.content = PWA_CHROME_THEME_COLOR;
      document.documentElement.style.backgroundColor = PWA_CHROME_THEME_COLOR;
      document.body.style.backgroundColor = PWA_CHROME_THEME_COLOR;
    };
    const enforceAfterViewportChange = () => requestAnimationFrame(enforceChromeTheme);
    enforceChromeTheme();
    window.addEventListener("focusin", enforceAfterViewportChange);
    window.addEventListener("focusout", enforceAfterViewportChange);
    window.visualViewport?.addEventListener("resize", enforceAfterViewportChange);
    return () => {
      window.removeEventListener("focusin", enforceAfterViewportChange);
      window.removeEventListener("focusout", enforceAfterViewportChange);
      window.visualViewport?.removeEventListener("resize", enforceAfterViewportChange);
    };
  }, [location.pathname]);

  useLayoutEffect(() => {
    clearRouteFeedback();
  }, [location.pathname]);

  if (!store.profileReady) {
    return (
      <div className="app-shell">
        <main>
          <div className="page profile-loading-page" aria-label="Loading local profile">
            <div className="skeleton-line skeleton-line-title" />
            <div className="skeleton-block" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <SessionRestorer />
      <RouteTransitionFeedback />
      <main>
        {keepHomeMounted && (
          <div className={showingTitle ? "route-cache-hidden" : undefined} aria-hidden={showingTitle || undefined}>
            <HomePage />
          </div>
        )}
        {showingTitle ? (
          <Routes>
            <Route path="/title/:id" element={<TitleDetailPage key={store.activeProfile.id} />} />
          </Routes>
        ) : (
          !showingHome && (
            <Routes>
              <Route path="/feeds" element={<FeedsPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/recommendations" element={<RecommendationsPage />} />
              <Route path="/recommendations/:id" element={<RecommendationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/learn" element={<LearnPage />} />
              <Route path="/import" element={<ImportPage />} />
            </Routes>
          )
        )}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              onClick={(event) => {
                if (!isPlainNavigationClick(event) || location.pathname === item.to) return;
                event.preventDefault();
                scheduleRouteChange("page", () => navigate(item.to));
              }}
            >
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
  const updateProfileSession = store.updateProfileSession;
  const location = useLocation();
  const navigate = useNavigate();
  const restoredProfileId = useRef("");
  const sessionRef = useRef(store.profileSession);
  const sessionWriteTimer = useRef<number | null>(null);
  const homeFeeds = useMemo(
    () => resolveHomeFeeds(store.feeds, store.folders, store.homeSource),
    [store.feeds, store.folders, store.homeSource],
  );
  const activeFeed = useMemo(
    () => homeFeeds.find((feed) => feed.id === store.activeFeedId) ?? homeFeeds[0] ?? null,
    [homeFeeds, store.activeFeedId],
  );

  useEffect(() => {
    sessionRef.current = store.profileSession;
  }, [store.profileSession]);

  useEffect(() => {
    if (!store.ready || restoredProfileId.current === store.activeProfile.id) return;
    restoredProfileId.current = store.activeProfile.id;
    if (!store.settings.restoreLastSession) return;
    const savedPath = store.profileSession.lastRoute.replace(/^#/, "");
    const openedAtRoot = location.pathname === "/" && !location.search && (!window.location.hash || window.location.hash === "#/");
    if (savedPath && savedPath !== "/" && openedAtRoot) navigate(savedPath, { replace: true });
  }, [
    location.pathname,
    location.search,
    navigate,
    store.activeProfile.id,
    store.profileSession.lastRoute,
    store.ready,
    store.settings.restoreLastSession,
  ]);

  useEffect(() => {
    if (!store.settings.restoreLastSession) return;
    const path = `${location.pathname}${location.search}`;
    const key = location.pathname === "/" ? homeScrollKey(activeFeed) : path;
    if (location.pathname.startsWith("/title/")) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    if (location.pathname === "/") {
      requestAnimationFrame(() => requestAnimationFrame(() => restoreHomeScroll(activeFeed)));
      return;
    }
    const candidates = [store.profileSession.scroll[key], Number(localStorage.getItem(key)), store.profileSession.scroll[path]];
    const y = candidates.find((value) => Number.isFinite(value)) ?? 0;
    if (y > 0) {
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y })));
    }
  }, [activeFeed, location.pathname, location.search, store.activeProfile.id, store.profileSession.scroll, store.settings.restoreLastSession]);

  useEffect(() => {
    if (!store.settings.restoreLastSession) return;
    const path = `${location.pathname}${location.search}`;
    const key = location.pathname === "/" ? homeScrollKey(activeFeed) : path;
    if (location.pathname.startsWith("/title/")) return;
    if (location.pathname === "/") {
      const container = getHomeScrollContainer(activeFeed);
      if (!container) return;
      const save = () => {
        localStorage.setItem(key, String(container.scrollTop));
        if (sessionWriteTimer.current != null) window.clearTimeout(sessionWriteTimer.current);
        sessionWriteTimer.current = window.setTimeout(() => {
          updateProfileSession({
            lastRoute: path,
            scroll: { ...sessionRef.current.scroll, [path]: container.scrollTop, [key]: container.scrollTop },
          });
        }, 120);
      };
      save();
      container.addEventListener("scroll", save, { passive: true });
      return () => container.removeEventListener("scroll", save);
    }
    const save = () => {
      if (sessionWriteTimer.current != null) window.clearTimeout(sessionWriteTimer.current);
      sessionWriteTimer.current = window.setTimeout(() => {
        updateProfileSession({
          lastRoute: path,
          scroll: { ...sessionRef.current.scroll, [path]: window.scrollY, [key]: window.scrollY },
        });
      }, 120);
    };
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [activeFeed, location.pathname, location.search, store.activeProfile.id, store.settings.restoreLastSession, updateProfileSession]);

  useEffect(() => () => {
    if (sessionWriteTimer.current != null) window.clearTimeout(sessionWriteTimer.current);
  }, []);

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
  const [editingFeed, setEditingFeed] = useState<Feed | null>(null);
  const [renderCenterIndex, setRenderCenterIndex] = useState(-1);
  const [returningFromTitle, setReturningFromTitle] = useState(
    () => sessionStorage.getItem(profileStorageKey(HOME_RETURNING_FROM_TITLE_KEY)) === "1",
  );
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const paneRefs = useRef(new Map<string, HTMLDivElement>());
  const renderCenterIndexRef = useRef(-1);
  const pendingFeedIndexRef = useRef(-1);
  const feedSettleTimerRef = useRef<number | null>(null);
  const didInitialPagerAlignRef = useRef(false);
  const feeds = useMemo(
    () => resolveHomeFeeds(store.feeds, store.folders, store.homeSource),
    [store.feeds, store.folders, store.homeSource],
  );
  const { activeFeedId, setActiveFeedId } = store;
  const activeFeedIdRef = useRef(activeFeedId);
  const activeFeed = feeds.find((feed) => feed.id === activeFeedId) ?? feeds[0] ?? null;
  const activeFeedIndex = activeFeed ? feeds.findIndex((feed) => feed.id === activeFeed.id) : -1;

  useEffect(() => {
    activeFeedIdRef.current = activeFeedId;
  }, [activeFeedId]);

  useEffect(() => {
    if (feeds.length === 0) {
      if (activeFeedId) setActiveFeedId(null);
      return;
    }
    if (!activeFeedId || !feeds.some((feed) => feed.id === activeFeedId)) setActiveFeedId(feeds[0].id);
  }, [activeFeedId, feeds, setActiveFeedId]);

  useEffect(() => {
    if (activeFeedIndex < 0 || renderCenterIndexRef.current >= 0) return;
    renderCenterIndexRef.current = activeFeedIndex;
    setRenderCenterIndex(activeFeedIndex);
  }, [activeFeedIndex]);

  useLayoutEffect(() => {
    if (!store.ready || !activeFeed) return;
    const pane = paneRefs.current.get(activeFeed.id);
    if (!pane) return;
    if (returningFromTitle) {
      pane.scrollIntoView({ behavior: "auto", block: "nearest", inline: "start" });
      restoreHomeScroll(activeFeed);
      setReturningFromTitle(false);
      try {
        sessionStorage.removeItem(profileStorageKey(HOME_RETURNING_FROM_TITLE_KEY));
      } catch {
        // Best effort only.
      }
      return;
    }
    if (!didInitialPagerAlignRef.current) {
      didInitialPagerAlignRef.current = true;
      pane.scrollIntoView({ behavior: "auto", block: "nearest", inline: "start" });
      restoreHomeScroll(activeFeed);
    }
  }, [activeFeed, returningFromTitle, store.ready]);

  const warmFeedsAroundScrollPosition = useCallback(() => {
    const pager = pagerRef.current;
    if (!pager || feeds.length === 0) return;
    const firstPane = paneRefs.current.get(feeds[0]?.id);
    const secondPane = paneRefs.current.get(feeds[1]?.id);
    const paneStep = secondPane && firstPane ? secondPane.offsetLeft - firstPane.offsetLeft : firstPane?.offsetWidth;
    if (!paneStep) return;

    const nearestIndex = Math.max(0, Math.min(feeds.length - 1, Math.round(pager.scrollLeft / paneStep)));
    pendingFeedIndexRef.current = nearestIndex;
    if (nearestIndex !== renderCenterIndexRef.current) {
      renderCenterIndexRef.current = nearestIndex;
      startTransition(() => setRenderCenterIndex(nearestIndex));
    }

    if (feedSettleTimerRef.current !== null) window.clearTimeout(feedSettleTimerRef.current);
    feedSettleTimerRef.current = window.setTimeout(() => {
      feedSettleTimerRef.current = null;
      const settledFeedId = feeds[pendingFeedIndexRef.current]?.id;
      if (settledFeedId && settledFeedId !== activeFeedIdRef.current) {
        setActiveFeedId(settledFeedId);
      }
    }, 110);
  }, [feeds, setActiveFeedId]);

  useEffect(
    () => () => {
      if (feedSettleTimerRef.current !== null) window.clearTimeout(feedSettleTimerRef.current);
    },
    [],
  );

  const handleFeedPaneScroll = useCallback(
    (feed: Feed) => {
      saveHomeScroll(feed);
    },
    [],
  );

  useEffect(() => {
    const feed = feeds.find((item) => item.id === activeFeedId) ?? feeds[0] ?? null;
    const pane = feed ? paneRefs.current.get(feed.id) : null;
    const scroller = pane?.querySelector<HTMLElement>(".feed-pane-scroll");
    if (!pane || !feed || !scroller) return;
    appDebugLog("home-scroll", "attach scroll listener", { feedId: feed.id });
    saveHomeScroll(feed);
  }, [activeFeedId, feeds]);

  return (
    <div className="page home-page">
      {!store.ready ? (
        activeFeed ? (
          <div className="startup-home-skeleton">
            <HomeFeedPaneSkeleton feed={activeFeed} />
          </div>
        ) : (
          <div className="empty-state">
            <strong>Loading local library</strong>
            <span className="muted">{store.syncStatus || "Opening IndexedDB cache"}</span>
          </div>
        )
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
        <div className="feed-pager" ref={pagerRef} aria-label="Home feeds" onScroll={warmFeedsAroundScrollPosition}>
          <div className="feed-pager-track">
            {feeds.map((feed, index) => {
              const isActive = index === activeFeedIndex;
              const renderOriginIndex = renderCenterIndex >= 0 ? renderCenterIndex : activeFeedIndex;
              const renderRadius = returningFromTitle ? 0 : HOME_FEED_RENDER_RADIUS;
              const isNearby = renderOriginIndex >= 0 && Math.abs(index - renderOriginIndex) <= renderRadius;
              const shouldRenderFeed = isActive || isNearby;
              return (
                <div
                  key={feed.id}
                  className={`feed-pager-panel ${isActive ? "is-active" : ""}`}
                  data-feed-id={feed.id}
                  ref={(node) => {
                    if (node) paneRefs.current.set(feed.id, node);
                    else paneRefs.current.delete(feed.id);
                  }}
                >
                  <div
                    className="feed-pane-scroll"
                    data-home-scroll-key={homeScrollKey(feed)}
                    onScroll={() => handleFeedPaneScroll(feed)}
                  >
                    {shouldRenderFeed ? (
                      <FeedView feed={feed} preview={!isActive} onEdit={() => setEditingFeed(feed)} />
                    ) : (
                      <HomeFeedPaneSkeleton feed={feed} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
      <BottomDrawer title="Edit Feed" open={Boolean(editingFeed)} onOpenChange={(open) => !open && setEditingFeed(null)}>
        {editingFeed ? (
          <FeedEditor
            feed={editingFeed}
            onCancel={() => setEditingFeed(null)}
            onSave={(feed) => {
              store.upsertFeed(feed);
              setEditingFeed(null);
            }}
          />
        ) : null}
      </BottomDrawer>
    </div>
  );
}

function FeedView({ feed, preview = false, onEdit }: { feed: Feed; preview?: boolean; onEdit?: () => void }) {
  const store = useAppStore();
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionOverflows, setDescriptionOverflows] = useState(false);
  const titleTapTimerRef = useRef<number | null>(null);
  const descriptionRef = useRef<HTMLSpanElement | null>(null);
  const query = useMemo(
    () =>
      runFeedQuery({
        feed,
        series: store.catalog,
        tags: store.tags,
        history: store.history,
        labels: store.labels,
        settings: store.settings,
        metaHistoryFirst: store.syncMeta?.historyFirstDate,
        metaHistoryLast: store.syncMeta?.historyLastDate,
      }),
    [feed, store.catalog, store.history, store.labels, store.settings, store.syncMeta, store.tags],
  );
  const hasDescription = feed.showDescription && Boolean(feed.description.trim());
  const titleCanExpand = feed.name.trim().length > 34;
  const descriptionCanExpand = hasDescription && descriptionOverflows;
  const descriptionText = hasDescription ? cappedText(feed.description, FEED_DESCRIPTION_EXPANDED_MAX) : "";
  useEffect(
    () => () => {
      if (titleTapTimerRef.current != null) window.clearTimeout(titleTapTimerRef.current);
    },
    [],
  );
  useLayoutEffect(() => {
    const node = descriptionRef.current;
    if (!node || descriptionExpanded) return;
    const update = () => setDescriptionOverflows(node.scrollWidth > node.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [descriptionExpanded, descriptionText]);
  return (
    <>
      <section className="section feed-summary-section">
        <div className={`feed-summary-card ${titleExpanded || descriptionExpanded ? "expanded" : ""}`}>
          <FeedBarCoverWash items={query.items.slice(0, 3)} />
          <div className="feed-summary-content">
            <button
              className={`feed-title-button ${titleCanExpand ? "expandable" : ""}`}
              type="button"
              onClick={(event) => {
                if (event.detail > 1 || !titleCanExpand) return;
                titleTapTimerRef.current = window.setTimeout(() => {
                  setTitleExpanded((expanded) => !expanded);
                  titleTapTimerRef.current = null;
                }, 230);
              }}
              onDoubleClick={() => {
                if (titleTapTimerRef.current != null) {
                  window.clearTimeout(titleTapTimerRef.current);
                  titleTapTimerRef.current = null;
                }
                onEdit?.();
              }}
              aria-expanded={titleCanExpand ? titleExpanded : undefined}
              aria-label={`${feed.name}. Double tap to edit feed.`}
            >
              <FitSingleLineTitle text={feed.name} expanded={titleExpanded} maxChars={FEED_TITLE_EXPANDED_MAX} />
            </button>
            <div className={`feed-summary-lower ${hasDescription ? "" : "empty"}`}>
              {hasDescription ? (
                <button
                  className={`feed-description-button ${descriptionCanExpand ? "expandable" : ""}`}
                  type="button"
                  onClick={() => descriptionCanExpand && setDescriptionExpanded((expanded) => !expanded)}
                  aria-expanded={descriptionCanExpand ? descriptionExpanded : undefined}
                  aria-disabled={!descriptionCanExpand}
                >
                  <span ref={descriptionRef} className={`feed-description-text ${descriptionExpanded ? "expanded" : ""}`}>{descriptionText}</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <TitleCollection
        items={query.items}
        feed={feed}
        history={store.history}
        latestDate={store.syncMeta?.historyLastDate}
        preview={preview}
      />
    </>
  );
}

function RouteTransitionFeedback() {
  return (
    <>
      <div className="route-transition-feedback route-transition-detail" aria-hidden="true">
        <div className="detail-page">
          <div className="detail-top-actions route-transition-actions">
            <span className="skeleton-chip" />
            <span className="spacer" />
            <span className="skeleton-chip" />
          </div>
          <DetailSkeleton series={null} showRecommendations={false} />
        </div>
      </div>
      <div className="route-transition-feedback route-transition-page" aria-hidden="true">
        <div className="page route-page-skeleton">
          <span className="skeleton-line skeleton-line-title" />
          <div className="title-grid columns-3 density-standard" style={{ "--grid-columns": 3 } as React.CSSProperties}>
            {Array.from({ length: 9 }).map((_, index) => (
              <div className="title-card-wrap" key={index}>
                <div className="cover-wrap skeleton-box" />
                <span className="skeleton-line skeleton-line-body" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function FeedBarCoverWash({ items }: { items: SeriesCatalog[] }) {
  const coverKey = items.slice(0, 3).map((item) => item.cover ?? "").join("|");
  const [palette, setPalette] = useState(DEFAULT_FEED_PALETTE);
  useEffect(() => {
    let active = true;
    const coverUrls = coverKey.split("|");
    void Promise.all(
      DEFAULT_FEED_PALETTE.map((fallback, index) => {
        const url = coverUrls[index];
        return url ? sampleCoverColor(url, fallback) : Promise.resolve(fallback);
      }),
    ).then((colors) => {
      if (active) setPalette(colors as [RgbColor, RgbColor, RgbColor]);
    });
    return () => {
      active = false;
    };
  }, [coverKey]);
  const average = palette.reduce(
    (result, color) => [result[0] + color[0] / 3, result[1] + color[1] / 3, result[2] + color[2] / 3] as RgbColor,
    [0, 0, 0] as RgbColor,
  );
  const dark: RgbColor = average.map((channel, index) =>
    Math.round(channel * 0.34 + ([15, 17, 24] as RgbColor)[index] * 0.66),
  ) as RgbColor;
  const style = {
    "--feed-color-1": palette[0].join(" "),
    "--feed-color-2": palette[1].join(" "),
    "--feed-color-3": palette[2].join(" "),
    "--feed-color-dark": dark.join(" "),
  } as React.CSSProperties;
  return (
    <span className="feed-bar-cover-wash" style={style} aria-hidden="true" />
  );
}

function FitSingleLineTitle({ text, expanded = false, maxChars = FEED_TITLE_EXPANDED_MAX }: { text: string; expanded?: boolean; maxChars?: number }) {
  const displayText = expanded ? cappedText(text, maxChars) : text;
  const widthUnits = Math.max(
    1,
    [...displayText].reduce((total, character) => {
      if (character === " ") return total + 0.32;
      if (/[MW@%&]/.test(character)) return total + 0.9;
      if (/[ilI1|.,'!:;]/.test(character)) return total + 0.3;
      if (/[A-Z0-9]/.test(character)) return total + 0.64;
      return total + 0.55;
    }, 0) * 1.1,
  );
  const responsiveFontSize = `clamp(15px, calc(${(100 / widthUnits).toFixed(4)}cqw - ${(72 / widthUnits).toFixed(3)}px), 30px)`;

  return (
    <h1
      className={`single-line-title ${expanded ? "expanded" : ""}`}
      style={expanded ? undefined : { fontSize: responsiveFontSize }}
    >
      {displayText}
    </h1>
  );
}

function HomeFeedPaneSkeleton({ feed }: { feed: Feed }) {
  return (
    <>
      <section className="section feed-summary-section">
        <div className="feed-summary-card">
          <FeedBarCoverWash items={[]} />
          <div className="feed-summary-content">
            <div className="feed-title-button skeleton-feed-title">
              <h1 className="single-line-title skeleton-line skeleton-line-title" />
            </div>
            <div className={`feed-summary-lower ${feed.showDescription ? "" : "empty"}`}>
              {feed.showDescription ? (
                <div className="feed-description-button skeleton-feed-description">
                  <span className="skeleton-line skeleton-line-body" />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      <TitleCollectionSkeleton columns={feed.view.gridColumns} />
    </>
  );
}

function TitleCollection({
  items,
  feed,
  history,
  latestDate,
  loading = false,
  preview = false,
  onTitleOpen,
}: {
  items: SeriesCatalog[];
  feed: Feed;
  history: HistoryMap;
  latestDate?: string | null;
  loading?: boolean;
  preview?: boolean;
  onTitleOpen?: (series: SeriesCatalog) => void;
}) {
  const pageSize = feed.view.gridColumns >= 5 ? 60 : feed.view.gridColumns === 4 ? 72 : 120;
  const countKey = profileStorageKey(`manhwa-visible-count:${feed.id}:${feed.view.gridColumns}`);
  const [visibleCount, setVisibleCount] = useState(() => Number(sessionStorage.getItem(countKey)) || pageSize);
  useEffect(() => {
    const saved = Number(sessionStorage.getItem(countKey)) || pageSize;
    setVisibleCount(Math.max(pageSize, Math.min(saved, Math.max(pageSize, items.length))));
  }, [countKey, items.length, pageSize]);
  useEffect(() => {
    sessionStorage.setItem(countKey, String(visibleCount));
  }, [countKey, visibleCount]);
  const visibleItems = items.slice(0, preview ? Math.min(visibleCount, HOME_FEED_PREVIEW_TITLES) : visibleCount);
  const metricWindow = useMemo(() => resolveRollingWindow(feed.filters.rolling, latestDate), [feed.filters.rolling, latestDate]);

  if (loading) {
    return <TitleCollectionSkeleton columns={feed.view.gridColumns} />;
  }

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
          <MemoTitleCard
            key={series.id}
            series={series}
            rank={index + 1}
            view={feed.view}
            feed={feed}
            history={history}
            latestDate={latestDate}
            metricWindow={metricWindow}
            onOpen={onTitleOpen}
          />
        ))}
      </div>
      {preview ? null : (
        <LoadMore visibleCount={visibleCount} total={items.length} onMore={() => setVisibleCount((count) => count + pageSize)} />
      )}
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

function Cover({ series, priority = false }: { series: SeriesCatalog; priority?: boolean }) {
  const title = visibleTitle(series);
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className="cover-wrap">
      {series.cover ? (
        <img
          className="loading-cover-image"
          src={series.cover}
          alt=""
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          onLoad={markImageLoaded}
        />
      ) : (
        <div className="cover-fallback cover-fallback-initials">{initials || "ML"}</div>
      )}
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
        covers.map((item, index) => (
          <img
            className="loading-cover-image"
            src={item.cover ?? ""}
            alt=""
            key={`${item.id}-${index}`}
            loading="lazy"
            decoding="async"
            onLoad={markImageLoaded}
          />
        ))
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
  feed,
  history,
  latestDate,
  metricWindow,
  onOpen,
}: {
  series: SeriesCatalog;
  rank: number;
  view: FeedViewSettings;
  feed: Feed;
  history: HistoryMap;
  latestDate?: string | null;
  metricWindow?: { from: string; to: string } | null;
  onOpen?: (series: SeriesCatalog) => void;
}) {
  const title = visibleTitle(series);
  const navigate = useNavigate();
  const detailPath = `/title/${series.id}`;
  return (
    <div className="title-card-wrap">
      <Link
        to={detailPath}
        className="title-card"
        data-testid="title-card"
        onClick={(event) => {
          if (!isPlainNavigationClick(event)) return;
          event.preventDefault();
          onOpen?.(series);
          prepareHomeTitleNavigation(feed);
          scheduleRouteChange("detail", () => navigate(detailPath));
        }}
      >
        <div className="poster-shell">
          <Cover series={series} priority={rank <= 18} />
          {view.visible.rank && <span className="rank">{rank}</span>}
          <div className="poster-metrics">
            <MemoTitleMetrics series={series} view={view} compact history={history} latestDate={latestDate} metricWindow={metricWindow} />
          </div>
        </div>
        <div className="title-meta">
          <span className="title-name">{title}</span>
        </div>
      </Link>
    </div>
  );
}

const MemoTitleCard = memo(TitleCard, (prev, next) =>
  prev.series.id === next.series.id &&
  prev.rank === next.rank &&
  prev.view === next.view &&
  prev.feed.id === next.feed.id &&
  prev.feed.view.gridColumns === next.feed.view.gridColumns &&
  prev.feed.view.gridDensity === next.feed.view.gridDensity &&
  prev.history === next.history &&
  prev.latestDate === next.latestDate &&
  prev.onOpen === next.onOpen &&
  prev.metricWindow?.from === next.metricWindow?.from &&
  prev.metricWindow?.to === next.metricWindow?.to
);

function TitleCollectionSkeleton({ columns, count: requestedCount }: { columns: 1 | 2 | 3 | 4 | 5; count?: number }) {
  const count = requestedCount ?? (columns >= 5 ? 10 : columns === 4 ? 12 : 9);
  return (
    <div className={`title-grid columns-${columns} density-standard`} style={{ "--grid-columns": columns } as React.CSSProperties} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div className="title-card-wrap" key={index}>
          <div className="title-card skeleton-title-card">
            <div className="poster-shell">
              <div className="cover-wrap skeleton-box" />
              <div className="rank skeleton-chip" />
              <div className="poster-metrics">
                <div className="metrics compact-metrics">
                  <span className="skeleton-line skeleton-line-body short" />
                </div>
              </div>
            </div>
            <div className="title-meta">
              <span className="skeleton-line skeleton-line-title" />
            </div>
          </div>
      </div>
      ))}
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

function defaultGrowthWindow(latestDate?: string | null) {
  return resolveRollingWindow({ mode: "last", amount: 1, unit: "days" }, latestDate);
}

function formatFeedMetricValue(
  series: SeriesCatalog,
  metric: MetricId,
  history: HistoryMap,
  latestDate?: string | null,
  metricWindow?: { from: string; to: string } | null,
) {
  if (isGrowthMetric(metric)) {
    const window = metricWindow ?? defaultGrowthWindow(latestDate);
    const value = window ? historyDeltaForWindow(series.id, metric, history, window.from, window.to) : null;
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
  const metricSlots: MetricId[] = useMemo(
    () => (view.metricSlots ?? []).filter((metric) => metric !== "underratedScore").slice(0, 3),
    [view.metricSlots],
  );
  const values = useMemo(
    () => {
      if (metricSlots.length === 0) return [];
      return metricSlots
        .map((metric) => ({ metric, value: formatFeedMetricValue(series, metric, history, latestDate, metricWindow) }))
        .filter((item) => item.value !== "n/a");
    },
    [history, latestDate, metricSlots, metricWindow, series],
  );
  if (values.length === 0) return null;
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

const MemoTitleMetrics = memo(TitleMetrics, (prev, next) =>
  prev.series.id === next.series.id &&
  prev.view === next.view &&
  prev.compact === next.compact &&
  prev.history === next.history &&
  prev.latestDate === next.latestDate &&
  prev.metricWindow?.from === next.metricWindow?.from &&
  prev.metricWindow?.to === next.metricWindow?.to
);

function FeedsPage() {
  const store = useAppStore();
  const [editorFeed, setEditorFeed] = useState<Feed | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
    () => sessionStorage.getItem(profileStorageKey("manhwa-feeds-folder")) || null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [homeSourceOpen, setHomeSourceOpen] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [moveItem, setMoveItem] = useState<{ type: "feed" | "folder"; id: string } | null>(null);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<FeedFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<FeedFolder | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [coverMap, setCoverMap] = useState<Map<string, SeriesCatalog[]>>(new Map());
  const [coversLoading, setCoversLoading] = useState(true);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const selectedFolder = selectedFolderId ? store.folders.find((folder) => folder.id === selectedFolderId) ?? null : null;
  const feedById = useMemo(() => new Map(store.feeds.map((feed) => [feed.id, feed])), [store.feeds]);
  const visibleFolders = useMemo(
    () => store.folders
      .filter((folder) => folder.parentId === selectedFolderId)
      .sort((left, right) => left.order - right.order),
    [selectedFolderId, store.folders],
  );
  const visibleFeeds = useMemo(() => {
    if (!selectedFolder) return unfiledFeeds(store.feeds, store.folders);
    return selectedFolder.feedIds.flatMap((id) => {
      const feed = feedById.get(id);
      return feed ? [feed] : [];
    });
  }, [feedById, selectedFolder, store.feeds, store.folders]);
  const folderPresentationMap = useMemo(() => {
    const presentation = new Map<string, { feedCount: number; covers: SeriesCatalog[] }>();
    visibleFolders.forEach((folder) => {
      const descendantIds = new Set([folder.id, ...descendantFolderIds(folder.id, store.folders)]);
      const descendantFeeds = store.folders
        .filter((item) => descendantIds.has(item.id))
        .flatMap((item) => item.feedIds);
      presentation.set(folder.id, {
        feedCount: descendantFeeds.length,
        covers: descendantFeeds.flatMap((id) => coverMap.get(id) ?? []).slice(0, 3),
      });
    });
    return presentation;
  }, [coverMap, store.folders, visibleFolders]);

  useEffect(() => {
    const target = Number(sessionStorage.getItem(profileStorageKey(FEEDS_SCROLL_KEY)));
    const firstFrame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (Number.isFinite(target) && target > 0) window.scrollTo({ top: target, behavior: "auto" });
      });
    });
    const save = () => sessionStorage.setItem(profileStorageKey(FEEDS_SCROLL_KEY), String(window.scrollY));
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(firstFrame);
      save();
      window.removeEventListener("scroll", save);
    };
  }, []);

  useEffect(() => {
    if (selectedFolderId && !store.folders.some((folder) => folder.id === selectedFolderId)) {
      setSelectedFolderId(null);
      sessionStorage.removeItem(profileStorageKey("manhwa-feeds-folder"));
    }
  }, [selectedFolderId, store.folders]);

  useEffect(() => {
    let cancelled = false;
    setCoversLoading(true);
    let index = 0;
    let handle = 0;
    const next = new Map<string, SeriesCatalog[]>();
    const processBatch = () => {
      const batchEnd = Math.min(index + 4, store.feeds.length);
      for (; index < batchEnd; index += 1) {
        const feed = store.feeds[index];
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
      if (cancelled) return;
      setCoverMap(new Map(next));
      if (index < store.feeds.length) {
        handle = window.setTimeout(processBatch, 16);
      } else {
        setCoversLoading(false);
      }
    };
    handle = window.setTimeout(processBatch, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [store.catalog, store.feeds, store.history, store.labels, store.settings, store.syncMeta, store.tags]);

  const openFolder = useCallback((folderId: string | null) => {
    setSelectedFolderId(folderId);
    if (folderId) sessionStorage.setItem(profileStorageKey("manhwa-feeds-folder"), folderId);
    else sessionStorage.removeItem(profileStorageKey("manhwa-feeds-folder"));
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragId(null);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!overId || activeId === overId) return;
    if (activeId.startsWith("feed:") && overId.startsWith("feed:")) {
      const feedId = activeId.slice(5);
      const targetId = overId.slice(5);
      const targetIndex = visibleFeeds.findIndex((feed) => feed.id === targetId);
      store.moveFeedToFolder(feedId, selectedFolderId, targetIndex);
      return;
    }
    if (activeId.startsWith("folder:") && overId.startsWith("folder:")) {
      const folderId = activeId.slice(7);
      const targetId = overId.slice(7);
      const targetIndex = visibleFolders.findIndex((folder) => folder.id === targetId);
      store.moveFolder(folderId, selectedFolderId, targetIndex);
    }
  }, [selectedFolderId, store, visibleFeeds, visibleFolders]);
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setFolderMenuId(null);
    setActiveDragId(String(event.active.id));
  }, []);

  const folderSortableIds = useMemo(
    () => visibleFolders.map((folder) => `folder:${folder.id}`),
    [visibleFolders],
  );
  const feedSortableIds = useMemo(
    () => visibleFeeds.map((feed) => `feed:${feed.id}`),
    [visibleFeeds],
  );
  const openFeed = useCallback((feedId: string) => {
    const folderId = feedLocation(feedId, store.folders);
    store.updateHomeSource({
      ...store.homeSource,
      kind: folderId ? "folder" : "unfiled",
      folderId,
    });
    store.setActiveFeedId(feedId);
  }, [store]);

  return (
    <div className={`page feeds-library-page ${activeDragId ? "drag-active" : ""}`}>
      <div className="row feeds-library-header">
        {selectedFolder ? (
          <button
            className="icon-button"
            type="button"
            aria-label="Back to parent folder"
            onClick={() => openFolder(selectedFolder.parentId)}
          >
            <ArrowLeft size={20} />
          </button>
        ) : null}
        <div>
          <h1>{selectedFolder?.name ?? "Feeds"}</h1>
          {selectedFolder ? <div className="muted tiny">Feed folder</div> : null}
        </div>
        <span className="spacer" />
        <button className="icon-button" type="button" onClick={() => setHomeSourceOpen(true)} aria-label="Choose Home source">
          <Home size={18} />
        </button>
        <button
          className={`icon-button ${organizing ? "active" : ""}`}
          type="button"
          onClick={() => setOrganizing((current) => !current)}
          aria-label={organizing ? "Finish organizing" : "Organize feeds"}
          aria-pressed={organizing}
        >
          {organizing ? <Check size={18} /> : <ListTree size={18} />}
        </button>
        <button className="icon-button" type="button" onClick={() => setCreateOpen(true)} aria-label="Create">
          <Plus size={18} />
        </button>
      </div>
      {organizing ? <p className="muted tiny organize-hint">Drag handles reorder this level. Use each menu to move across folders.</p> : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveDragId(null)}
        onDragEnd={handleDragEnd}
      >
        {visibleFolders.length > 0 ? (
          <SortableContext items={folderSortableIds} strategy={verticalListSortingStrategy}>
            <section className="feed-folder-section">
              {!selectedFolder ? <h2 className="feed-library-label">Folders</h2> : null}
              <div className="feed-folder-list">
                {visibleFolders.map((folder) => {
                  const presentation = folderPresentationMap.get(folder.id)!;
                  return (
                    <SortableFolderRow
                      key={folder.id}
                      folder={folder}
                      folders={store.folders}
                      feedCount={presentation.feedCount}
                      covers={presentation.covers}
                      organizing={organizing}
                      menuOpen={folderMenuId === folder.id}
                      onOpen={() => openFolder(folder.id)}
                      onMenu={() => setFolderMenuId((current) => current === folder.id ? null : folder.id)}
                      onRename={() => { setRenamingFolder(folder); setFolderMenuId(null); }}
                      onMove={() => { setMoveItem({ type: "folder", id: folder.id }); setFolderMenuId(null); }}
                      onDelete={() => { setDeletingFolder(folder); setFolderMenuId(null); }}
                    />
                  );
                })}
              </div>
            </section>
          </SortableContext>
        ) : null}
        <SortableContext items={feedSortableIds} strategy={rectSortingStrategy}>
          <section className="unfiled-feed-section">
            {!selectedFolder ? <h2 className="feed-library-label">Unfiled Feeds</h2> : null}
            {visibleFeeds.length > 0 ? (
              <div className="feed-cover-grid">
                {visibleFeeds.map((feed) => (
                  <SortableFeedCoverCard
                    key={feed.id}
                    feed={feed}
                    covers={coverMap.get(feed.id) ?? []}
                    loading={coversLoading && !(coverMap.get(feed.id)?.length)}
                    organizing={organizing}
                    onOpen={() => openFeed(feed.id)}
                    onEdit={() => setEditorFeed(feed)}
                    onMove={() => setMoveItem({ type: "feed", id: feed.id })}
                    onDuplicate={() => store.duplicateFeed(feed.id)}
                    onDelete={() => store.deleteFeed(feed.id)}
                  />
                ))}
              </div>
            ) : visibleFolders.length === 0 ? (
              <div className="empty-state compact-empty">
                <FolderOpen size={28} />
                <strong>{selectedFolder ? "This folder is empty" : "No unfiled feeds"}</strong>
                <button className="button primary" type="button" onClick={() => setCreateOpen(true)}>
                  <Plus size={16} /> Create
                </button>
              </div>
            ) : null}
          </section>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeDragId?.startsWith("folder:") ? (
            <div className="folder-drag-overlay">
              <FolderIcon size={22} />
              <strong>{store.folders.find((folder) => folder.id === activeDragId.slice(7))?.name ?? "Folder"}</strong>
              <GripVertical size={18} />
            </div>
          ) : activeDragId?.startsWith("feed:") ? (
            <div className="feed-drag-overlay">
              <strong>{feedById.get(activeDragId.slice(5))?.name ?? "Feed"}</strong>
              <GripVertical size={18} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <BottomDrawer title={editorFeed?.name ?? "Feed"} open={Boolean(editorFeed)} onOpenChange={(open) => !open && setEditorFeed(null)}>
        {editorFeed && (
          <FeedEditor
            feed={editorFeed}
            onCancel={() => setEditorFeed(null)}
            onSave={(feed) => {
              const isNew = !store.feeds.some((item) => item.id === feed.id);
              store.upsertFeed(feed);
              if (isNew && selectedFolderId) store.moveFeedToFolder(feed.id, selectedFolderId);
              setEditorFeed(null);
            }}
          />
        )}
      </BottomDrawer>
      <CreateLibraryDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        parentFolder={selectedFolder}
        onCreateFeed={() => {
          setCreateOpen(false);
          setEditorFeed(createFeed("New Feed"));
        }}
        onCreateFolder={(name, migrateFeeds) => {
          store.createFolder(name, selectedFolderId, migrateFeeds);
          setCreateOpen(false);
        }}
      />
      <HomeSourceDrawer open={homeSourceOpen} onOpenChange={setHomeSourceOpen} />
      <MoveLibraryItemDrawer item={moveItem} onOpenChange={(open) => !open && setMoveItem(null)} />
      <RenameFolderDrawer folder={renamingFolder} onOpenChange={(open) => !open && setRenamingFolder(null)} />
      <DeleteFolderDrawer folder={deletingFolder} onOpenChange={(open) => !open && setDeletingFolder(null)} />
    </div>
  );
}

function SortableFeedCoverCard({
  feed,
  covers,
  loading,
  organizing,
  onOpen,
  onEdit,
  onMove,
  onDuplicate,
  onDelete,
}: {
  feed: Feed;
  covers: SeriesCatalog[];
  loading: boolean;
  organizing: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `feed:${feed.id}`, disabled: !organizing });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "sortable-dragging" : ""}
    >
      <FeedCoverCard
        feed={feed}
        covers={covers}
        loading={loading}
        organizing={organizing}
        dragHandleProps={{ ...attributes, ...listeners }}
        onOpen={onOpen}
        onEdit={onEdit}
        onMove={onMove}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </div>
  );
}

function SortableFolderRow({
  folder,
  folders,
  feedCount,
  covers,
  organizing,
  menuOpen,
  onOpen,
  onMenu,
  onRename,
  onMove,
  onDelete,
}: {
  folder: FeedFolder;
  folders: FeedFolder[];
  feedCount: number;
  covers: SeriesCatalog[];
  organizing: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onMenu: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `folder:${folder.id}`, disabled: !organizing });
  const [palette, setPalette] = useState<RgbColor[]>(DEFAULT_FEED_PALETTE);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      covers.slice(0, 3).map((cover, index) => cover.cover
        ? sampleCoverColor(cover.cover, DEFAULT_FEED_PALETTE[index] ?? DEFAULT_FEED_PALETTE[0])
        : Promise.resolve(DEFAULT_FEED_PALETTE[index] ?? DEFAULT_FEED_PALETTE[0])),
    ).then((colors) => {
      if (!cancelled && colors.length > 0) setPalette(colors);
    });
    return () => { cancelled = true; };
  }, [covers]);
  const descendants = descendantFolderIds(folder.id, folders).length;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    "--folder-color-1": (palette[0] ?? DEFAULT_FEED_PALETTE[0]).join(" "),
    "--folder-color-2": (palette[1] ?? palette[0] ?? DEFAULT_FEED_PALETTE[1]).join(" "),
    "--folder-color-3": (palette[2] ?? palette[0] ?? DEFAULT_FEED_PALETTE[2]).join(" "),
  } as React.CSSProperties;
  return (
    <div ref={setNodeRef} className={`feed-folder-row ${isDragging ? "sortable-dragging" : ""}`} style={style}>
      <button className="feed-folder-main" type="button" onClick={onOpen}>
        <FolderIcon size={24} />
        <span>
          <strong>{folder.name}</strong>
          <small>
            {descendants > 0 ? `${descendants} ${descendants === 1 ? "folder" : "folders"} · ` : ""}
            {feedCount} {feedCount === 1 ? "feed" : "feeds"}
          </small>
        </span>
        <ChevronRight size={20} />
      </button>
      {organizing ? (
        <button className="feed-folder-drag" type="button" aria-label={`Reorder ${folder.name}`} {...attributes} {...listeners}>
          <GripVertical size={18} />
        </button>
      ) : null}
      <button className="feed-folder-menu" type="button" onClick={onMenu} aria-label={`${folder.name} menu`}>
        <EllipsisVertical size={18} />
      </button>
      {menuOpen ? (
        <div className="popover-menu folder-row-menu">
          <button type="button" onClick={onRename}><SlidersHorizontal size={16} /> Rename</button>
          <button type="button" onClick={onMove}><FolderOpen size={16} /> Move</button>
          <button className="danger-text" type="button" onClick={onDelete}><Trash2 size={16} /> Delete</button>
        </div>
      ) : null}
    </div>
  );
}

function CreateLibraryDrawer({
  open,
  onOpenChange,
  parentFolder,
  onCreateFeed,
  onCreateFolder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentFolder: FeedFolder | null;
  onCreateFeed: () => void;
  onCreateFolder: (name: string, migrateFeeds: boolean) => void;
}) {
  const [folderName, setFolderName] = useState("");
  const [pendingMigration, setPendingMigration] = useState(false);
  useEffect(() => {
    if (!open) {
      setFolderName("");
      setPendingMigration(false);
    }
  }, [open]);
  const needsMigration = Boolean(parentFolder?.feedIds.length && parentFolder.childFolderIds.length === 0);
  return (
    <BottomDrawer title="Create" open={open} onOpenChange={onOpenChange}>
      <div className="create-library-options">
        {pendingMigration && parentFolder ? (
          <div className="folder-migration-confirmation">
            <div className="folder-migration-icon"><FolderOpen size={24} /></div>
            <strong>Create the first subfolder?</strong>
            <p>
              {parentFolder.feedIds.length} {parentFolder.feedIds.length === 1 ? "feed" : "feeds"} will move into
              {" "}<b>{folderName.trim()}</b>. Nothing will be deleted.
            </p>
            <div className="toolbar">
              <button className="button" type="button" onClick={() => setPendingMigration(false)}>Back</button>
              <span className="spacer" />
              <button className="button primary" type="button" onClick={() => onCreateFolder(folderName, true)}>
                <FolderIcon size={17} /> Create and move
              </button>
            </div>
          </div>
        ) : (
          <>
        <button className="library-create-row" type="button" onClick={onCreateFeed}>
          <Plus size={20} />
          <span><strong>Logic Feed</strong><small>Build from filters and live catalog data.</small></span>
          <ChevronRight size={18} />
        </button>
        <div className="library-folder-create">
          <label className="field">
            <span>Folder name</span>
            <input
              className="input"
              name="folder-display-name"
              type="text"
              value={folderName}
              maxLength={60}
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="done"
              spellCheck
              onChange={(event) => setFolderName(event.target.value)}
              placeholder={parentFolder ? `Inside ${parentFolder.name}` : "New folder"}
            />
          </label>
          <button
            className="button primary"
            type="button"
            disabled={!folderName.trim()}
            onClick={() => needsMigration ? setPendingMigration(true) : onCreateFolder(folderName, false)}
          >
            <FolderIcon size={17} /> Create Folder
          </button>
        </div>
          </>
        )}
      </div>
    </BottomDrawer>
  );
}

function HomeSourceDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useAppStore();
  const [draft, setDraft] = useState(store.homeSource);
  useEffect(() => {
    if (open) setDraft(store.homeSource);
  }, [open, store.homeSource]);
  const ordered = orderedFolderTree(store.folders);
  return (
    <BottomDrawer title="Home Source" open={open} onOpenChange={onOpenChange}>
      <div className="home-source-list">
        <button
          className={`destination-row ${draft.kind === "unfiled" ? "selected" : ""}`}
          type="button"
          aria-pressed={draft.kind === "unfiled"}
          onClick={() => setDraft({ ...draft, kind: "unfiled", folderId: null })}
        >
          <Library size={19} /><span><strong>Unfiled Feeds</strong><small>Use only feeds outside folders.</small></span>
          {draft.kind === "unfiled" ? <Check size={18} /> : null}
        </button>
        {ordered.map((folder) => (
          <button
            className={`destination-row ${draft.folderId === folder.id ? "selected" : ""}`}
            type="button"
            key={folder.id}
            aria-pressed={draft.folderId === folder.id}
            style={{ paddingLeft: `${14 + Math.max(0, folderDepthForUi(folder, store.folders) - 1) * 18}px` }}
            onClick={() => setDraft({ ...draft, kind: "folder", folderId: folder.id })}
          >
            <FolderIcon size={19} /><span><strong>{folder.name}</strong><small>Include its descendant feeds.</small></span>
            {draft.folderId === folder.id ? <Check size={18} /> : null}
          </button>
        ))}
      </div>
      <ToggleRow
        label="Continuous"
        description="Start here, continue through every other folder in tree order, wrap around, then show unfiled feeds."
        value={draft.continuous}
        onChange={(continuous) => setDraft({ ...draft, continuous })}
      />
      <div className="toolbar">
        <button className="button" type="button" onClick={() => onOpenChange(false)}>Cancel</button>
        <span className="spacer" />
        <button className="button primary" type="button" onClick={() => { store.updateHomeSource(draft); onOpenChange(false); }}>
          <Check size={16} /> Apply
        </button>
      </div>
    </BottomDrawer>
  );
}

function MoveLibraryItemDrawer({
  item,
  onOpenChange,
}: {
  item: { type: "feed" | "folder"; id: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const store = useAppStore();
  const currentFolderId = item?.type === "feed"
    ? feedLocation(item.id, store.folders)
    : store.folders.find((folder) => folder.id === item?.id)?.parentId ?? null;
  const destinations = store.folders.filter((folder) => {
    if (!item) return false;
    if (item.type === "feed") return folder.childFolderIds.length === 0;
    return canMoveFolder(item.id, folder.id, store.folders);
  });
  return (
    <BottomDrawer title="Move" open={Boolean(item)} onOpenChange={onOpenChange}>
      <div className="home-source-list">
        <button
          className={`destination-row ${currentFolderId === null ? "selected" : ""}`}
          type="button"
          onClick={() => {
            if (!item) return;
            if (item.type === "feed") store.moveFeedToFolder(item.id, null);
            else store.moveFolder(item.id, null);
            onOpenChange(false);
          }}
        >
          <Library size={19} /><span><strong>{item?.type === "feed" ? "Unfiled Feeds" : "Root Folders"}</strong></span>
          {currentFolderId === null ? <Check size={18} /> : null}
        </button>
        {destinations.map((folder) => (
          <button
            className={`destination-row ${currentFolderId === folder.id ? "selected" : ""}`}
            type="button"
            key={folder.id}
            disabled={currentFolderId === folder.id}
            onClick={() => {
              if (!item) return;
              if (item.type === "feed") store.moveFeedToFolder(item.id, folder.id);
              else store.moveFolder(item.id, folder.id);
              onOpenChange(false);
            }}
          >
            <FolderIcon size={19} /><span><strong>{folder.name}</strong></span>
            {currentFolderId === folder.id ? <Check size={18} /> : null}
          </button>
        ))}
      </div>
    </BottomDrawer>
  );
}

function RenameFolderDrawer({ folder, onOpenChange }: { folder: FeedFolder | null; onOpenChange: (open: boolean) => void }) {
  const store = useAppStore();
  const [name, setName] = useState(folder?.name ?? "");
  useEffect(() => setName(folder?.name ?? ""), [folder]);
  return (
    <BottomDrawer title="Rename Folder" open={Boolean(folder)} onOpenChange={onOpenChange}>
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="toolbar">
        <button className="button" type="button" onClick={() => onOpenChange(false)}>Cancel</button>
        <span className="spacer" />
        <button className="button primary" type="button" disabled={!name.trim()} onClick={() => {
          if (folder) store.renameFolder(folder.id, name);
          onOpenChange(false);
        }}>Save</button>
      </div>
    </BottomDrawer>
  );
}

function DeleteFolderDrawer({ folder, onOpenChange }: { folder: FeedFolder | null; onOpenChange: (open: boolean) => void }) {
  const store = useAppStore();
  if (!folder) return <BottomDrawer title="Delete Folder" open={false} onOpenChange={onOpenChange}><span /></BottomDrawer>;
  const ids = new Set([folder.id, ...descendantFolderIds(folder.id, store.folders)]);
  const feedCount = store.folders.filter((item) => ids.has(item.id)).reduce((total, item) => total + item.feedIds.length, 0);
  return (
    <BottomDrawer title="Delete Folder" open onOpenChange={onOpenChange}>
      <div className="delete-folder-summary">
        <strong>{folder.name}</strong>
        <p className="muted">{ids.size} folder{ids.size === 1 ? "" : "s"} and {feedCount} feed{feedCount === 1 ? "" : "s"} are inside this subtree.</p>
        <button className="button" type="button" onClick={() => { store.deleteFolder(folder.id, true); onOpenChange(false); }}>
          Keep feeds unfiled
        </button>
        <button className="button danger" type="button" onClick={() => { store.deleteFolder(folder.id, false); onOpenChange(false); }}>
          <Trash2 size={16} /> Delete subtree and feeds
        </button>
      </div>
    </BottomDrawer>
  );
}

function folderDepthForUi(folder: FeedFolder, folders: FeedFolder[]) {
  let depth = 1;
  let current = folder;
  const byId = new Map(folders.map((item) => [item.id, item]));
  while (current.parentId) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

function FeedCoverCard({
  feed,
  covers,
  loading,
  organizing,
  dragHandleProps,
  onOpen,
  onEdit,
  onMove,
  onDuplicate,
  onDelete,
}: {
  feed: Feed;
  covers: SeriesCatalog[];
  loading: boolean;
  organizing: boolean;
  dragHandleProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  onOpen: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <article className="feed-cover-card" data-feed-id={feed.id}>
      <Link
        className="feed-cover-link"
        to="/"
        onClick={(event) => {
          if (!isPlainNavigationClick(event)) return;
          event.preventDefault();
          onOpen();
          scheduleRouteChange("page", () => navigate("/"));
        }}
      >
        {loading ? <div className="mosaic-cover mosaic-loading" aria-hidden="true" /> : <MosaicCover items={covers} title={feed.name} />}
        <strong className="feed-card-title">{feed.name}</strong>
      </Link>
      {organizing ? (
        <button className="feed-drag-handle" type="button" aria-label={`Reorder ${feed.name}`} {...dragHandleProps}>
          <GripVertical size={18} />
        </button>
      ) : null}
      <button className="feed-card-menu-button" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label={`${feed.name} menu`}>
        <EllipsisVertical size={18} />
      </button>
      {menuOpen && (
        <div className="popover-menu card-menu">
          <button type="button" onClick={() => { onEdit(); setMenuOpen(false); }}><SlidersHorizontal size={16} /> Edit</button>
          <button type="button" onClick={() => { onMove(); setMenuOpen(false); }}><FolderOpen size={16} /> Move</button>
          <button type="button" onClick={() => { onDuplicate(); setMenuOpen(false); }}><Copy size={16} /> Duplicate</button>
          <SharePanelButton payload={{ kind: "feed", version: 2, feed }} label="Share" />
          <button className="danger-text" type="button" onClick={() => { onDelete(); setMenuOpen(false); }}><Trash2 size={16} /> Delete</button>
        </div>
      )}
    </article>
  );
}

function FeedEditor({ feed, onSave, onCancel }: { feed: Feed; onSave: (feed: Feed) => void; onCancel: () => void }) {
  const store = useAppStore();
  const [draft, setDraft] = useState<Feed>(() => structuredClone(feed));
  const [tagSearch, setTagSearch] = useState("");
  const [rollingAmountText, setRollingAmountText] = useState(() => String(feed.filters.rolling.amount));
  const statusOptions = useMemo(
    () => [...new Set(store.catalog.map((item) => item.status).filter(Boolean) as string[])].sort(),
    [store.catalog],
  );
  const statusLabels = useMemo(
    () => statusOptions.map((status) => [status, formatStatusLabel(status)] as const),
    [statusOptions],
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
          {statusLabels.map(([status, label]) => (
            <button
              className={`chip chipbutton ${draft.filters.statuses.includes(status) ? "active" : ""}`}
              type="button"
              key={status}
              onClick={() => updateFilters({ statuses: toggleArrayValue(draft.filters.statuses, status) })}
            >
              {label}
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
        <div className="field">
          <label htmlFor="rolling-amount">Amount</label>
          <input
            id="rolling-amount"
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={rollingAmountText}
            onChange={(event) => {
              const text = event.target.value;
              if (!/^\d*$/.test(text)) return;
              setRollingAmountText(text);
              if (text !== "") {
                const amount = Number(text);
                if (Number.isFinite(amount)) {
                  updateFilters({ rolling: { ...draft.filters.rolling, amount: Math.max(1, Math.trunc(amount)) } });
                }
              }
            }}
            onBlur={() => {
              if (rollingAmountText === "") {
                setRollingAmountText("1");
                updateFilters({ rolling: { ...draft.filters.rolling, amount: 1 } });
              }
            }}
          />
        </div>
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
          onClick={() => setDraft((current) => ({ ...current, sort: [...current.sort, { ...DEFAULT_SORT[0], id: makeId() }] }))}
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
          onClick={() => {
            setRollingAmountText(String(DEFAULT_FILTERS.rolling.amount));
            setDraft({
              ...draft,
              filters: {
                ...DEFAULT_FILTERS,
                sourceModes: [...(DEFAULT_FILTERS.sourceModes ?? [])],
                contentRatings: [...DEFAULT_FILTERS.contentRatings],
                metricRanges: [],
              },
            });
          }}
        >
          Reset filters
        </button>
        <button
          className="button primary"
          type="button"
          onClick={() => {
            const parsedAmount = Number(rollingAmountText);
            onSave({
              ...draft,
              filters: {
                ...draft.filters,
                rolling: {
                  ...draft.filters.rolling,
                  amount: Number.isFinite(parsedAmount) && parsedAmount >= 1 ? Math.trunc(parsedAmount) : 1,
                },
              },
            });
          }}
        >
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
    onChange([...ranges, { id: makeId(), metric: nextMetric, min: null, max: null }]);
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
  const current = slots.slice(0, 3);
  const toggle = (metric: MetricId) => {
    if (current.includes(metric)) {
      onChange(current.filter((item) => item !== metric));
      return;
    }
    onChange([...current, metric].slice(-3));
  };
  return (
    <div className="field">
      <div className="row">
        <span className="small-label">Cover stats - max 3</span>
        <span className="spacer" />
        <button className="button ghost tiny-button" type="button" onClick={() => onChange([])}>
          None
        </button>
      </div>
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
  const updateProfileSession = store.updateProfileSession;
  const setSearchHistory = store.setSearchHistory;
  const setOpenedTitleIds = store.setOpenedTitleIds;
  const [query, setQuery] = useState(store.profileSession.searchQuery);
  const searchHistory = store.profileSession.searchHistory;
  const openedTitleIds = store.profileSession.openedTitleIds;
  const sensitiveTagIds = useMemo(() => buildSensitiveTagGroups(store.tags), [store.tags]);
  const tagsById = useMemo(() => new Map(store.tags.map((tag) => [tag.id, tag])), [store.tags]);
  const eligibleCatalog = useMemo(
    () => store.catalog.filter((item) => hasDetailTags(item, tagsById)),
    [store.catalog, tagsById],
  );
  const searchableCatalog = useMemo(
    () => eligibleCatalog.filter((item) => isSearchVisible(item, store.settings, sensitiveTagIds)),
    [
      eligibleCatalog,
      sensitiveTagIds,
      store.settings,
    ],
  );
  const searchFeed = useMemo(() => {
    const feed = createFeed("Search results");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.contentRatings = [...store.settings.contentRatings];
    feed.view = { ...feed.view, gridColumns: 3 };
    return feed;
  }, [store.settings.contentRatings]);
  const getTitle = useCallback((item: SeriesCatalog) => visibleTitle(item), []);
  const inputQuery = query;
  const [debouncedQuery, setDebouncedQuery] = useState(inputQuery);
  const [searchResultIds, setSearchResultIds] = useState<number[]>([]);
  const searchWorkerRef = useRef<Worker | null>(null);
  const searchRequestRef = useRef(0);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(inputQuery), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [inputQuery]);

  useEffect(() => {
    const worker = new Worker(new URL("./workers/search.worker.ts", import.meta.url), { type: "module" });
    searchWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: "results"; requestId: number; ids: number[] }>) => {
      if (event.data.type !== "results" || event.data.requestId !== searchRequestRef.current) return;
      setSearchResultIds(event.data.ids);
    };
    return () => {
      worker.terminate();
      searchWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    searchRequestRef.current += 1;
    setSearchResultIds([]);
    searchWorkerRef.current?.postMessage({
      type: "index",
      items: searchableCatalog.map((item) => ({
        id: item.id,
        display_title: item.display_title,
        animeplanet_title: item.animeplanet_title,
        mangabaka_title: item.mangabaka_title,
        native_title: item.native_title,
        romanized_title: item.romanized_title,
        authors: item.authors,
        artists: item.artists,
      })),
    });
  }, [searchableCatalog]);

  useEffect(() => {
    const term = debouncedQuery.trim();
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    if (!term) {
      setSearchResultIds([]);
      return;
    }

    const sensitiveFamily = sensitiveTagIdsForSearch(term, sensitiveTagIds);
    if (sensitiveFamily) {
      setSearchResultIds(
        searchableCatalog
        .filter((item) => item.tag_ids.some((tagId) => sensitiveFamily.has(tagId)))
        .sort((a, b) => getTitle(a).localeCompare(getTitle(b)))
        .slice(0, 60)
        .map((item) => item.id),
      );
      return;
    }

    searchWorkerRef.current?.postMessage({ type: "search", query: term, requestId });
  }, [debouncedQuery, getTitle, searchableCatalog, sensitiveTagIds]);

  const searchableCatalogById = useMemo(
    () => new Map(searchableCatalog.map((item) => [item.id, item])),
    [searchableCatalog],
  );
  const results = useMemo(
    () =>
      searchResultIds
        .map((id) => searchableCatalogById.get(id))
        .filter((item): item is SeriesCatalog => Boolean(item))
        .sort((a, b) => getTitle(a).localeCompare(getTitle(b))),
    [getTitle, searchResultIds, searchableCatalogById],
  );
  useEffect(() => {
    updateProfileSession({ searchQuery: inputQuery });
  }, [inputQuery, updateProfileSession]);
  useEffect(() => {
    setQuery(store.profileSession.searchQuery);
  }, [store.activeProfile.id, store.profileSession.searchQuery]);
  const remember = (value = query) => {
    const clean = value.trim();
    if (!clean) return;
    const next = [clean, ...searchHistory.filter((item) => item.toLocaleLowerCase() !== clean.toLocaleLowerCase())].slice(0, 12);
    setSearchHistory(next);
  };
  const rememberOpenedTitle = useCallback((series: SeriesCatalog) => {
    const next = [series.id, ...store.profileSession.openedTitleIds.filter((id) => id !== series.id)]
      .slice(0, SEARCH_OPENED_HISTORY_LIMIT);
    setOpenedTitleIds(next);
  }, [setOpenedTitleIds, store.profileSession.openedTitleIds]);
  const openedTitles = useMemo(() => {
    const byId = new Map(eligibleCatalog.map((item) => [item.id, item]));
    return openedTitleIds.map((id) => byId.get(id)).filter((item): item is SeriesCatalog => Boolean(item));
  }, [eligibleCatalog, openedTitleIds]);
  return (
    <div className="page search-page">
      <h1>Search</h1>
      <form className="field" onSubmit={(event) => { event.preventDefault(); remember(); }}>
        <label>Title</label>
        <div className="search-input-wrap">
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles"
            autoComplete="off"
          />
          {query && (
            <button className="input-clear" type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={16} />
            </button>
          )}
        </div>
      </form>
        {query.trim() ? (
        <TitleCollection
          items={results}
          feed={searchFeed}
          history={store.history}
          latestDate={store.syncMeta?.historyLastDate}
          onTitleOpen={rememberOpenedTitle}
        />
      ) : (
        <>
          {store.settings.showSearchHistory && openedTitles.length > 0 ? (
            <section className="section search-opened-history">
              <div className="row">
                <h2 className="section-title">Recently opened from Search</h2>
                <span className="spacer" />
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => setOpenedTitleIds([])}
                >
                  Clear
                </button>
              </div>
              <TitleCollection
                items={openedTitles}
                feed={searchFeed}
                history={store.history}
                latestDate={store.syncMeta?.historyLastDate}
                onTitleOpen={rememberOpenedTitle}
              />
            </section>
          ) : null}
          <section className="section">
            <div className="row">
              <h2 className="section-title">Recent searches</h2>
              <span className="spacer" />
              {searchHistory.length > 0 && (
                <button className="button ghost" type="button" onClick={() => setSearchHistory([])}>
                  Clear
                </button>
              )}
            </div>
            <div className="chips">
              {searchHistory.map((item) => (
                <button className="chip chipbutton" type="button" key={item} onClick={() => { setQuery(item); remember(item); }}>
                  {item}
                </button>
              ))}
            </div>
          </section>
        </>
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
  const getTitle = useCallback((item: SeriesCatalog) => visibleTitle(item), []);
  const tagsById = useMemo(() => new Map(store.tags.map((tag) => [tag.id, tag])), [store.tags]);
  const eligibleCatalog = useMemo(
    () => store.catalog.filter((item) => hasDetailTags(item, tagsById)),
    [store.catalog, tagsById],
  );
  const defaultRecommendationTitle = eligibleCatalog.find((item) => getTitle(item).toLocaleLowerCase() === "bastard");
  const selected =
    eligibleCatalog.find((item) => item.id === selectedId) ??
    eligibleCatalog.find((item) => item.id === Number(params.id)) ??
    defaultRecommendationTitle ??
    eligibleCatalog[0];
  const candidates = search.trim()
    ? eligibleCatalog
        .filter((item) => getTitle(item).toLowerCase().includes(search.trim().toLowerCase()))
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
    <div className="page recommendations-page">
      {selected?.cover ? <img className="recommendations-bg" src={selected.cover} alt="" aria-hidden="true" /> : null}
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
        <input id="base-title" className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={selected ? getTitle(selected) : "Search title"} />
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
              <strong className="title-name">{getTitle(series)}</strong>
              <span className="muted tiny">Fan% {formatMetricValue(series, "fanFavouriteRaw", store.history, store.syncMeta?.historyLastDate)}</span>
            </button>
          ))}
          </div>
        </section>
      )}
      {selected && (
        <section className="selected-rec-base">
          <div className="detail-cover-shell">
            <Cover series={selected} priority />
          </div>
          <div className="detail-copy">
            <h2 className="detail-title">{getTitle(selected)}</h2>
            <p className="detail-creators">{uniqueNames(selected.authors, selected.artists).join(" / ") || "Creator unavailable"}</p>
          </div>
        </section>
      )}
      {selected &&
        store.settings.recommendationShelves.map((shelf) => {
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
              <RecommendationResults base={selected} shelf={shelf} feed={recFeed} limit={RECOMMENDATION_MAX_RESULTS} />
            </section>
          );
        })}
      <BottomDrawer title={editingShelf ? "Edit Recommendation" : "Create Recommendation"} open={editorOpen} onOpenChange={setEditorOpen}>
        <RecommendationShelfEditor shelf={editingShelf} onCancel={() => setEditorOpen(false)} onSave={saveShelf} />
      </BottomDrawer>
    </div>
  );
}

async function recommendationItems(
  base: SeriesCatalog,
  shelf: RecommendationShelf,
  store: ReturnType<typeof useAppStore>,
  signal: AbortSignal,
) {
  const yieldToRoute = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  const buildPool = async (metricRanges: RecommendationShelf["metricRanges"]) => {
    const pool: SeriesCatalog[] = [];
    const tagsById = new Map(store.tags.map((tag) => [tag.id, tag]));
    const latestDate = store.syncMeta?.historyLastDate;
    const growthWindow = resolveRollingWindow({ mode: "last", amount: 1, unit: "days" }, latestDate);

    for (let index = 0; index < store.catalog.length; index += 1) {
      if (signal.aborted) return [];
      const item = store.catalog[index];
      const rating = item.content_rating as ContentRating | null;
      const sourceMode = hasAniList(item) ? "anilist" : "non-anilist";
      const matchesRanges = metricRanges.every((range) => {
        const value =
          growthWindow && (range.metric.includes("Growth") || range.metric.includes("Delta"))
            ? historyDeltaForWindow(item.id, range.metric, store.history, growthWindow.from, growthWindow.to)
            : displayComparableMetricValue(item, range.metric, store.history, latestDate);
        return (
          typeof value === "number" &&
          Number.isFinite(value) &&
          (range.min == null || value >= range.min) &&
          (range.max == null || value <= range.max)
        );
      });

      if (
        item.id !== base.id &&
        hasDetailTags(item, tagsById) &&
        (!rating || rating === "safe" || rating === "suggestive") &&
        shelf.sourceModes.includes(sourceMode) &&
        matchesRanges
      ) {
        pool.push(item);
      }

      if ((index + 1) % 128 === 0) await yieldToRoute();
    }

    return pool;
  };

  const rankPool = (pool: SeriesCatalog[]) =>
    rankRecommendationsAsync({
      base,
      candidates: pool,
      tags: store.tags,
      features: store.recommendationFeatures,
      shelf,
      history: store.history,
      latestDate: store.syncMeta?.historyLastDate,
    }, signal);

  const ranked = await rankPool(await buildPool(shelf.metricRanges));
  if (signal.aborted) return [];
  if (ranked.length || !shelf.metricRanges.length) return ranked;
  return rankPool(await buildPool([]));
}

function RecommendationResults({
  base,
  shelf,
  feed,
  limit,
}: {
  base: SeriesCatalog;
  shelf: RecommendationShelf;
  feed: Feed;
  limit: number;
}) {
  const store = useAppStore();
  const [items, setItems] = useState<SeriesCatalog[] | null>(null);
  const shelfKey = JSON.stringify(shelf);
  const visibleLimit = Math.min(RECOMMENDATION_MAX_RESULTS, Math.max(RECOMMENDATION_DEFAULT_RESULTS, limit));

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setItems(null);
    const handle = window.setTimeout(() => {
      if (cancelled) return;
      void recommendationItems(base, shelf, store, controller.signal).then((ranked) => {
        if (!cancelled && !controller.signal.aborted) setItems(ranked.slice(0, visibleLimit));
      });
    }, 600);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [
    base,
    base.id,
    feed.id,
    visibleLimit,
    shelf,
    shelfKey,
    store,
    store.catalog,
    store.history,
    store.labels,
    store.recommendationFeatures,
    store.settings,
    store.syncMeta?.historyFirstDate,
    store.syncMeta?.historyLastDate,
    store.tags,
  ]);

  if (items == null) {
    return <TitleCollectionSkeleton columns={feed.view.gridColumns} count={visibleLimit} />;
  }

  return <TitleCollection items={items} feed={feed} history={store.history} latestDate={store.syncMeta?.historyLastDate} />;
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
        id: makeId(),
        name: "Custom matches",
        statusMode: "any",
        dateMode: "any",
        sourceModes: ["anilist", "non-anilist"],
        sort: [{ id: makeId(), metric: "fanFavouriteDiscoveryPercentile", direction: "desc" }],
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
                sort: [...draft.sort, { id: makeId(), metric: "fanFavouriteDiscoveryPercentile", direction: "desc" }],
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
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [backupStatus, setBackupStatus] = useState("");
  const [profilesOpen, setProfilesOpen] = useState(false);
  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const snapshot = JSON.parse(await file.text()) as Partial<AppStateSnapshot>;
      if (!Array.isArray(snapshot.feeds)) throw new Error("This file does not contain a feeds backup.");
      store.importSnapshot(snapshot, "replace");
      setBackupStatus(`Imported ${snapshot.feeds.length.toLocaleString()} feeds.`);
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Could not import this backup.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };
  return (
    <div className="page settings-page">
      <h1>Settings</h1>

      <button className="profile-identity-row" type="button" onClick={() => setProfilesOpen(true)}>
        <span className="profile-avatar" style={{ "--profile-accent": store.activeProfile.accentColor } as React.CSSProperties}>
          {store.activeProfile.name.trim().slice(0, 1).toLocaleUpperCase() || <UserRound size={20} />}
        </span>
        <span className="profile-identity-copy">
          <strong>{store.activeProfile.name}</strong>
          <span>Local profile</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </button>

      <SettingsSection title="Appearance">
        <div className="setting-stack">
          <div>
            <strong>Accent color</strong>
            <div className="muted tiny">Used for selection, active controls, and navigation.</div>
          </div>
          <div className="accent-swatches" role="group" aria-label="Accent color">
            {ACCENT_COLORS.map((color) => {
              const selected = store.settings.accentColor.toLowerCase() === color.value.toLowerCase();
              return (
                <button
                  className={`accent-swatch ${selected ? "selected" : ""}`}
                  style={{ "--swatch-color": color.value } as React.CSSProperties}
                  type="button"
                  key={color.value}
                  onClick={() => store.updateSettings({ accentColor: color.value })}
                  aria-label={color.name}
                  aria-pressed={selected}
                  title={color.name}
                >
                  {selected ? <Check size={17} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Library">
        <div className="setting-row">
          <div>
            <strong>{store.syncMeta?.totalSeries.toLocaleString() ?? store.catalog.length.toLocaleString()} total titles</strong>
            <div className="muted tiny">{store.syncStatus || "Library data is cached for offline use."}</div>
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
          label="Show opened-title history"
          description="Show up to 99 titles opened from Search."
          value={store.settings.showSearchHistory}
          onChange={(showSearchHistory) => store.updateSettings({ showSearchHistory })}
        />
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

      <SettingsSection title="Backup & Help">
        <Link className="button" to="/learn">
          <Info size={16} /> Learn metrics and data
        </Link>
        <button
          className="button"
          type="button"
          onClick={() => downloadText("manhwa-feeds-backup.json", JSON.stringify(makeSnapshot(store), null, 2))}
        >
          <Download size={16} /> Export Feeds JSON Backup
        </button>
        <input
          ref={importInputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void importBackup(event.target.files?.[0])}
        />
        <button
          className="button"
          type="button"
          onClick={() => importInputRef.current?.click()}
        >
          <Import size={16} /> Import Feeds JSON Backup
        </button>
        <button
          className="button"
          type="button"
          onClick={() => downloadText(
            `${safeFilename(store.activeProfile.name)}-profile-backup.json`,
            JSON.stringify({
              kind: "manhwa-profile-backup",
              version: 1,
              exportedAt: new Date().toISOString(),
              profile: store.activeProfile,
              state: store.exportActiveProfile(),
            }, null, 2),
          )}
        >
          <Download size={16} /> Export Current Profile
        </button>
        <button
          className="button"
          type="button"
          onClick={() => void store.exportAllProfiles().then((backup) => {
            downloadText("manhwa-all-profiles-backup.json", JSON.stringify(backup, null, 2));
          })}
        >
          <Users size={16} /> Export All Profiles
        </button>
        {backupStatus ? <div className="settings-status" role="status">{backupStatus}</div> : null}
        <button
          className="button danger"
          type="button"
          onClick={() => {
            if (window.confirm(`Reset ${store.activeProfile.name}? This removes its feeds, settings, and history.`)) {
              void store.resetCurrentProfile();
            }
          }}
        >
          <Trash2 size={16} /> Reset Current Profile
        </button>
        <button
          className="button danger"
          type="button"
          onClick={() => {
            if (window.confirm("Reset the entire app? Every local profile will be removed.")) {
              void store.resetEntireApp();
            }
          }}
        >
          <Trash2 size={16} /> Reset Entire App
        </button>
      </SettingsSection>
      <ProfileManagerDrawer open={profilesOpen} onOpenChange={setProfilesOpen} />
    </div>
  );
}

function ProfileManagerDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const store = useAppStore();
  const [mode, setMode] = useState<"list" | "add" | "rename" | "delete">("list");
  const [name, setName] = useState("");
  const [seedMode, setSeedMode] = useState<ProfileSeedMode>("blank");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("list");
    setName("");
    setStatus("");
    setBusy(false);
  }, [open]);

  const run = async (action: () => Promise<void>) => {
    setStatus("");
    setBusy(true);
    try {
      await action();
      setMode("list");
      setName("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "That profile action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomDrawer title="Profiles" open={open} onOpenChange={onOpenChange}>
      <div className="profile-drawer">
        <div className="profile-count">{store.profiles.length} / {MAX_PROFILES} profiles</div>
        <div className="profile-list">
          {store.profiles.map((profile) => {
            const active = profile.id === store.activeProfile.id;
            return (
              <button
                className={`profile-row ${active ? "active" : ""}`}
                type="button"
                key={profile.id}
                aria-current={active ? "true" : undefined}
                disabled={busy}
                onClick={() => {
                  if (!active) void run(() => store.switchProfile(profile.id));
                }}
              >
                <span className="profile-avatar small" style={{ "--profile-accent": profile.accentColor } as React.CSSProperties}>
                  {profile.name.trim().slice(0, 1).toLocaleUpperCase()}
                </span>
                <span className="profile-row-copy">
                  <strong>{profile.name}</strong>
                  <span>{active ? "Current profile" : "Tap to switch"}</span>
                </span>
                {active ? <Check size={18} /> : <ChevronRight size={18} />}
              </button>
            );
          })}
        </div>

        {mode === "add" ? (
          <div className="profile-form">
            <label className="field">
              <span>Name</span>
              <input className="input" value={name} maxLength={40} autoFocus onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="segments profile-seed-options" role="group" aria-label="Starting content">
              {([
                ["blank", "Blank"],
                ["defaults", "Defaults"],
                ["clone", "Clone current"],
              ] as const).map(([value, label]) => (
                <button
                  className={`segment ${seedMode === value ? "active" : ""}`}
                  type="button"
                  key={value}
                  aria-pressed={seedMode === value}
                  onClick={() => setSeedMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="toolbar">
              <button className="button" type="button" onClick={() => setMode("list")}>Cancel</button>
              <span className="spacer" />
              <button
                className="button primary"
                type="button"
                disabled={busy}
                onClick={() => void run(async () => {
                  const profile = await store.createProfile(name, seedMode);
                  await store.switchProfile(profile.id);
                })}
              >
                <UserPlus size={16} /> Create
              </button>
            </div>
          </div>
        ) : null}

        {mode === "rename" ? (
          <div className="profile-form">
            <label className="field">
              <span>Profile name</span>
              <input className="input" value={name} maxLength={40} autoFocus onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="toolbar">
              <button className="button" type="button" onClick={() => setMode("list")}>Cancel</button>
              <span className="spacer" />
              <button
                className="button primary"
                type="button"
                disabled={busy}
                onClick={() => void run(() => store.renameProfile(store.activeProfile.id, name))}
              >
                Save
              </button>
            </div>
          </div>
        ) : null}

        {mode === "delete" ? (
          <div className="profile-confirm">
            <strong>Delete {store.activeProfile.name}?</strong>
            <p className="muted">Its feeds, settings, and history will be removed. Other profiles stay untouched.</p>
            <div className="toolbar">
              <button className="button" type="button" onClick={() => setMode("list")}>Cancel</button>
              <span className="spacer" />
              <button
                className="button danger"
                type="button"
                disabled={busy || store.profiles.length <= 1}
                onClick={() => void run(() => store.deleteProfile(store.activeProfile.id))}
              >
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>
        ) : null}

        {mode === "list" ? (
          <div className="profile-actions">
            <button className="button" type="button" disabled={busy || store.profiles.length >= MAX_PROFILES} onClick={() => { setName(""); setSeedMode("blank"); setMode("add"); }}>
              <UserPlus size={17} /> Add
            </button>
            <button className="button" type="button" disabled={busy} onClick={() => { setName(store.activeProfile.name); setMode("rename"); }}>
              Rename
            </button>
            <button className="button" type="button" disabled={busy || store.profiles.length >= MAX_PROFILES} onClick={() => void run(async () => { await store.duplicateProfile(store.activeProfile.id); })}>
              <Copy size={17} /> Duplicate
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => downloadText(
                `${safeFilename(store.activeProfile.name)}-profile-backup.json`,
                JSON.stringify({
                  kind: "manhwa-profile-backup",
                  version: 1,
                  exportedAt: new Date().toISOString(),
                  profile: store.activeProfile,
                  state: store.exportActiveProfile(),
                }, null, 2),
              )}
            >
              <Download size={17} /> Export
            </button>
            <button
              className="button danger"
              type="button"
              disabled={busy || store.profiles.length <= 1}
              onClick={() => setMode("delete")}
            >
              <Trash2 size={17} /> Delete
            </button>
          </div>
        ) : null}
        {status ? <div className="settings-status" role="status">{status}</div> : null}
      </div>
    </BottomDrawer>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section settings-section">
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
  const invalidRoute = !Number.isFinite(id) || id <= 0;
  const catalogItem = store.catalog.find((item) => item.id === id);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading detail");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const detailLayoutKey = profileStorageKey(`manhwa-detail-layout:${store.activeFeedId ?? "default"}`);
  const [visible, setVisible] = useState(() => {
    try {
      return {
        ...DEFAULT_DETAIL_VISIBLE,
        description: true,
        links: true,
        ...JSON.parse(localStorage.getItem(detailLayoutKey) ?? "{}"),
        cover: true,
        title: true,
        authorsArtists: true,
      };
    } catch {
      return { ...DEFAULT_DETAIL_VISIBLE, description: true, authorsArtists: true, links: true, cover: true, title: true };
    }
  });
  const tagsById = useMemo(() => new Map(store.tags.map((tag) => [tag.id, tag])), [store.tags]);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [id]);

  useEffect(() => {
    localStorage.setItem(detailLayoutKey, JSON.stringify(visible));
  }, [detailLayoutKey, visible]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoading(true);
    setStatus("Loading detail");
    setShowRecommendations(false);
    if (invalidRoute) {
      setStatus("Invalid title route");
      setLoading(false);
      return;
    }
    const handle = window.setTimeout(() => {
      void fetchSeriesDetail(store.settings.dataSourceUrl, id)
      .then((value) => {
        if (!cancelled) {
          setDetail(value);
          setLoading(false);
          setStatus("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Could not load detail");
          setLoading(false);
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [id, invalidRoute, store.settings.dataSourceUrl]);

  const series = useMemo(() => {
    if (!detail || detail.id !== id) return null;
    const localTitle = resolveVisibleTitle(detail, catalogItem ?? undefined);
    return catalogItem
      ? {
          ...detail,
          display_title: localTitle,
          stats: catalogItem.stats,
          analytics: catalogItem.analytics,
          source: catalogItem.source ?? detail.source,
          published: catalogItem.published ?? detail.published,
          last_updated_at: catalogItem.last_updated_at ?? detail.last_updated_at,
          authors: catalogItem.authors?.length ? catalogItem.authors : detail.authors,
          artists: catalogItem.artists?.length ? catalogItem.artists : detail.artists,
          links: { ...(detail.links ?? {}), ...(catalogItem.links ?? {}) },
        }
      : { ...detail, display_title: localTitle };
  }, [catalogItem, detail, id]);

  const loadingDetail = !invalidRoute && (loading || Boolean(detail && detail.id !== id));
  const showError = invalidRoute || (!loading && !detail && status && status !== "Loading detail");

  useEffect(() => {
    if (loadingDetail || showError || !series || !visible.recommendations) {
      setShowRecommendations(false);
      return;
    }
    const handle = window.setTimeout(() => setShowRecommendations(true), 180);
    return () => window.clearTimeout(handle);
  }, [loadingDetail, series, showError, visible.recommendations]);

  return (
    <div className="detail-page title-detail-page">
      {series?.cover && <img className="detail-bg" src={series.cover} alt="" />}
      <div className="detail-top-actions">
        <button
          className="icon-button"
          type="button"
          onClick={() => {
            clearRouteFeedback();
            navigate(-1);
          }}
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <span className="spacer" />
        <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Detail settings">
          <EllipsisVertical size={20} />
        </button>
      </div>
      {loadingDetail ? (
        <DetailSkeleton series={catalogItem ?? null} showRecommendations={visible.recommendations} />
      ) : series ? (
        <>
          <section className="detail-identity">
            <div className="detail-cover-shell">
              {series.cover ? (
                <img className="detail-cover loading-cover-image" src={series.cover} alt="" onLoad={markImageLoaded} />
              ) : (
                <div className="detail-cover cover-fallback">No cover</div>
              )}
            </div>
            <div className="detail-copy">
              <h1 className="detail-title">{series.display_title}</h1>
              <p className="detail-creators">{uniqueNames(series.authors, series.artists).join(" / ") || "Creator unavailable"}</p>
              <section className="detail-meta-strip" aria-label="Publication details">
                {visible.year && series.year ? (
                  <div className="detail-meta-chip">
                    <span>Year</span>
                    <strong>{series.year}</strong>
                  </div>
                ) : null}
                {visible.status && series.status ? (
                  <div className="detail-meta-chip">
                    <span>Status</span>
                    <strong>{formatStatusLabel(series.status)}</strong>
                  </div>
                ) : null}
                {visible.chapters && series.total_chapters ? (
                  <div className="detail-meta-chip">
                    <span>Chapters</span>
                    <strong>{series.total_chapters}</strong>
                  </div>
                ) : null}
              </section>
            </div>
          </section>
          <DetailStats series={series} visible={visible} history={store.history} latestDate={store.syncMeta?.historyLastDate} />
          {visible.description && detail?.description && (
            <section className="detail-block">
              <h2 className="section-title">Description</h2>
              <RichDescription text={detail.description} />
            </section>
          )}
          {visible.genreTags && (
            <section className="detail-block">
              <GenreChips series={series} tagsById={tagsById} />
            </section>
          )}
          {visible.links && (
            <section className="detail-block detail-links">
              <DetailLinks series={series} />
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
          {visible.recommendations && showRecommendations && (
            <section className="detail-block detail-recommendations">
              <div className="row">
                <h2 className="section-title">Recommendations</h2>
                <span className="spacer" />
                <button className="button ghost" type="button" onClick={() => setShowAllRecommendations((value) => !value)}>
                  {showAllRecommendations ? "Show less" : "Show more"}
                </button>
              </div>
              {store.settings.recommendationShelves.slice(0, showAllRecommendations ? undefined : 1).map((shelf) => {
                const recFeed = createFeed(shelf.name);
                recFeed.id = `detail-rec-${series!.id}-${shelf.id}`;
                recFeed.view.gridColumns = 3;
                return (
                  <div className="detail-rec-section" key={shelf.id}>
                    <h3>{shelf.name}</h3>
                    <RecommendationResults
                      base={series}
                      shelf={shelf}
                      feed={recFeed}
                      limit={showAllRecommendations ? RECOMMENDATION_MAX_RESULTS : RECOMMENDATION_DEFAULT_RESULTS}
                    />
                  </div>
                );
              })}
            </section>
          )}
        </>
      ) : showError ? (
        <div className="detail-error">
          <p className="muted">{status}</p>
        </div>
      ) : (
        <DetailSkeleton series={null} showRecommendations={visible.recommendations} />
      )}
      <BottomDrawer title="Detail Settings" open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DetailSettingsDrawer visible={visible} onChange={setVisible} />
      </BottomDrawer>
    </div>
  );
}

function DetailSkeleton({
  series,
  showRecommendations = true,
}: {
  series: SeriesCatalog | null;
  showRecommendations?: boolean;
}) {
  const hiddenStats = series
    ? [
        formatMetricValue(series, "popularity", undefined, undefined),
        formatMetricValue(series, "favourites", undefined, undefined),
        formatMetricValue(series, "meanScore", undefined, undefined),
      ]
    : [];
  return (
    <>
      <section className="detail-identity detail-skeleton-identity" aria-hidden="true">
        <div className="detail-cover-shell">
          <div className="detail-cover skeleton-box" />
        </div>
        <div className="detail-copy">
          <div className="skeleton-line skeleton-line-title" />
          <div className="skeleton-line skeleton-line-creators" />
          <section className="detail-meta-strip detail-skeleton-strip">
            <div className="detail-meta-chip skeleton-chip" />
            <div className="detail-meta-chip skeleton-chip" />
            <div className="detail-meta-chip skeleton-chip" />
          </section>
        </div>
      </section>
      <section className="detail-stat-grid detail-skeleton-grid detail-skeleton-stats" aria-hidden="true">
        <div className="detail-stat skeleton-stat skeleton-stat-compact" />
        <div className="detail-stat skeleton-stat skeleton-stat-compact" />
        <div className="detail-stat skeleton-stat skeleton-stat-compact" />
        {hiddenStats.length > 0 && <span className="visually-hidden">{hiddenStats.join(" ")}</span>}
      </section>
      <section className="detail-block" aria-hidden="true">
        <h2 className="section-title">Description</h2>
        <div className="skeleton-paragraph">
          <span className="skeleton-line skeleton-line-body" />
          <span className="skeleton-line skeleton-line-body" />
          <span className="skeleton-line skeleton-line-body short" />
        </div>
      </section>
      <section className="detail-block" aria-hidden="true">
        <div className="chips">
          <span className="chip skeleton-chip" />
          <span className="chip skeleton-chip" />
          <span className="chip skeleton-chip" />
        </div>
      </section>
      <section className="detail-block" aria-hidden="true">
        <div className="chips link-chips">
          <span className="chip link-chip skeleton-chip" />
          <span className="chip link-chip skeleton-chip" />
          <span className="chip link-chip skeleton-chip" />
        </div>
      </section>
      {showRecommendations ? (
        <section className="detail-block detail-recommendations" aria-hidden="true">
          <div className="row">
            <h2 className="section-title">Recommendations</h2>
          </div>
          <div className="title-grid columns-3 recommendation-picker detail-skeleton-rec-grid">
            {Array.from({ length: RECOMMENDATION_DEFAULT_RESULTS }).map((_, index) => (
              <div className="recommendation-pick skeleton-rec" key={index} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function uniqueNames(...groups: (string[] | undefined)[]) {
  return [...new Set(groups.flat().filter(Boolean))];
}

function RichDescription({ text }: { text: string }) {
  const source = text.replace(/\\([\\[\]*_`])/g, "$1").replace(/\r\n/g, "\n");
  return (
    <div className="rich-description">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => <strong>{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          a: ({ href, children }) => (
            <a href={href ?? "#"} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul>{children}</ul>,
          ol: ({ children }) => <ol>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => <blockquote>{children}</blockquote>,
          code: ({ children }) => <code>{children}</code>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function DetailStats({
  series,
  visible,
  history,
  latestDate,
}: {
  series: SeriesCatalog;
  visible: AppSettings["detailVisible"];
  history: HistoryMap;
  latestDate?: string | null;
}) {
  const metrics: MetricId[] = [
    ...(visible.discoveryMetrics ? (["fanFavouriteDiscoveryPercentile"] as MetricId[]) : []),
    ...(visible.popularity ? (["popularity"] as MetricId[]) : []),
    ...(visible.favourites ? (["favourites"] as MetricId[]) : []),
    ...(visible.meanScore ? (["meanScore"] as MetricId[]) : []),
    ...(visible.fanFavouriteRatio ? (["fanFavouriteRaw"] as MetricId[]) : []),
    ...(visible.growthNumbers ? (["popularityGrowth", "favouritesGrowth"] as MetricId[]) : []),
  ].slice(0, 6);
  const detailGrowthWindow = defaultGrowthWindow(latestDate);
  const values = metrics
    .map((metric) => ({
      metric,
      value:
        isGrowthMetric(metric) && detailGrowthWindow
          ? formatRawMetricValue(
              metric,
              historyDeltaForWindow(series.id, metric, history, detailGrowthWindow.from, detailGrowthWindow.to) ?? Number.NaN,
            )
          : formatMetricValue(series, metric, history, latestDate),
    }))
    .filter((item) => item.value !== "n/a");
  if (!values.length) return null;
  const detailLabel = (metric: MetricId) => {
    if (metric === "popularity") return "Popularity";
    if (metric === "favourites") return "Favourites";
    return metricDefinition(metric).shortLabel;
  };
  return (
    <section className={`detail-stat-grid detail-stat-count-${Math.min(values.length, 3)}`}>
      {values.map(({ metric, value }) => (
        <div className="detail-stat" key={metric}>
          <strong>{value}</strong>
          <span>{detailLabel(metric)}</span>
        </div>
      ))}
    </section>
  );
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
          <img className="link-favicon" src={faviconForUrl(href)} alt="" aria-hidden="true" loading="lazy" decoding="async" />
          <span>{label}</span>
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
    ["recommendations", "Recommendations", "Show recommendation shelves below title details."],
    ["description", "Description", "Show the full available synopsis."],
    ["genreTags", "Genres", "Show the main genre row."],
    ["allTags", "All tags", "Show every catalog tag."],
    ["links", "External links", "Show MangaBaka, AniList, and other sources."],
    ["discoveryMetrics", "Fan Rank", "Show Fan Rank in the stat row."],
    ["popularity", "Popularity", "Show AniList popularity."],
    ["favourites", "Favourites", "Show AniList favourites."],
    ["meanScore", "Mean score", "Show AniList mean score."],
    ["fanFavouriteRatio", "Fan percent", "Show favourites divided by popularity."],
    ["growthNumbers", "Growth stats", "Show available historical movement stats."],
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
    <div className="page learn-page">
      <h1>Learn</h1>
      <div className="learn-grid">
        <LearnItem title="Catalog and tags">
          <a href="https://mangabaka.org" target="_blank" rel="noreferrer">MangaBaka</a> supplies the main catalog, covers,
          publication details, links, and tag hierarchy. Titles without a recognized detail tag are hidden from discovery results.
        </LearnItem>
        <LearnItem title="AniList signals">
          <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a> supplies popularity, favourites, and mean score
          for mapped titles. These values provide audience-size and engagement context; they are not available for every title.
        </LearnItem>
        <LearnItem title="Fan Rank">
          Fan Rank measures fan engagement using AniList favourites relative to popularity, similar to comparing likes with views
          on a YouTube video. It adjusts for titles with low popularity so limited data does not produce an unfairly high rank. A
          Fan Rank of 90% means stronger fan engagement than 90% of titles.
        </LearnItem>
        <LearnItem title="Dates and history">
          Release and completion windows use confirmed dates only; estimated dates never qualify. Growth values compare available
          historical snapshots, so longer windows depend on how much history has been collected.
        </LearnItem>
        <LearnItem title="Additional sources">
          When available, title identity and links are cross-checked with{" "}
          <a href="https://www.mangaupdates.com" target="_blank" rel="noreferrer">MangaUpdates</a> and{" "}
          <a href="https://www.anime-planet.com/manga" target="_blank" rel="noreferrer">Anime-Planet</a>. Feeds and settings stay
          on this device and can be moved with the JSON backup.
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
    folders: store.folders,
    homeSource: store.homeSource,
    labels: store.labels,
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

function safeFilename(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
}

export default App;





