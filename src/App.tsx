import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Check,
  Copy,
  Database,
  Download,
  EllipsisVertical,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  Home,
  Import,
  Info,
  Library,
  ListFilter,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { createContext, memo, startTransition, useCallback, useContext, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Fuse from "fuse.js";
import { appDebugLog } from "./lib/debug";
import { useRegisterSW } from "virtual:pwa-register/react";
import ReactMarkdown from "react-markdown";
import {
  HashRouter,
  Link,
  Navigate,
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
import { createCustomFeed, createFeed, DEFAULT_DETAIL_VISIBLE, DEFAULT_FILTERS, DEFAULT_SORT, makeId } from "./domain/defaults";
import { isBuiltInSensitiveSegmentVisible } from "./domain/sensitiveFeedSegments";
import { resolveRollingWindow } from "./domain/dates";
import { buildSensitiveTagGroups, feedUsesAniListOnlyParameters, isGenreTag, isSearchVisible, runFeedQuery, sensitiveTagIdsForSearch, tagRoot } from "./domain/query";
import { matchesSearchTextWords, searchTextWordPosition, searchWords, seriesSearchText } from "./domain/search";
import { formatMetricValue, historyDeltaForWindow, METRIC_DEFINITIONS, metricDefinition } from "./domain/metrics";
import { rankRecommendations } from "./domain/recommendations";
import { resolveVisibleTitle } from "./domain/displayTitle";
import { decodeSharePayload, makeShareUrl, type SharePayload } from "./domain/share";
import type {
  AppSettings,
  AppStateSnapshot,
  ContentRating,
  Feed,
  FeedLibraryKind,
  FeedSegment,
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
import { AppStoreProvider, CUSTOM_FEED_TITLE_LIMIT, isBuiltInDefaultFeed, MY_LIST_UNSEGMENTED_FEED_SEGMENT_ID, UNSEGMENTED_FEED_SEGMENT_ID, useAppStore } from "./store/useAppStore";

const NAV_ITEMS = [
  { id: "home", to: "/", label: "Home", icon: Home },
  { id: "feeds", to: "/feeds", label: "Feeds", icon: ListFilter },
  { id: "search", to: "/search", label: "Search", icon: Search },
  { id: "settings", to: "/settings", label: "Settings", icon: Settings },
];

const SORT_OPTIONS: MetricId[] = METRIC_DEFINITIONS.map((definition) => definition.id);
const RANGE_METRICS = METRIC_DEFINITIONS.filter((definition) => definition.filterable);
const CUSTOM_ADDITIONAL_RANGE_METRICS = RANGE_METRICS.filter((definition) => definition.id !== "year" && definition.id !== "chapters");
const COVER_STAT_METRICS = METRIC_DEFINITIONS.filter((definition) => definition.id !== "title" && definition.id !== "mangabakaLatestRank");
const RECOMMENDATION_DEFAULT_RESULTS = 6;
const RECOMMENDATION_MAX_RESULTS = 18;
const HOME_FEED_INITIAL_RENDER_RADIUS = 4;
const SEARCH_OPENED_HISTORY_KEY = "manhwa-search-opened-title-ids";
const SEARCH_OPENED_HISTORY_LIMIT = 99;
type SegmentPalette = { colors: [RgbColor, RgbColor, RgbColor]; dark: RgbColor };
const APPROVED_SEGMENT_PALETTES: SegmentPalette[] = [
  { colors: [[135, 245, 245], [165, 161, 185], [233, 202, 163]], dark: [70, 80, 83] }, // Top 1% Trending
  { colors: [[237, 216, 126], [209, 192, 152], [192, 165, 224]], dark: [82, 76, 73] }, // Trending Deep Cut
  { colors: [[174, 199, 102], [155, 216, 233], [198, 214, 187]], dark: [70, 83, 75] }, // Recently Completed
  { colors: [[207, 226, 218], [162, 224, 247], [214, 180, 159]], dark: [76, 83, 87] }, // Trending Shounen
  { colors: [[183, 227, 235], [197, 191, 144], [238, 196, 195]], dark: [80, 81, 81] }, // Discover Mainstream
  { colors: [[232, 210, 200], [213, 234, 247], [125, 252, 152]], dark: [75, 90, 84] }, // Discover Upcoming
  { colors: [[244, 212, 144], [224, 245, 252], [132, 220, 226]], dark: [78, 88, 86] }, // Discover Deep Cut
  { colors: [[197, 235, 225], [229, 191, 201], [236, 195, 175]], dark: [85, 82, 84] }, // Overhyped
  { colors: [[151, 191, 226], [198, 199, 230], [218, 183, 193]], dark: [74, 76, 89] }, // Rising Underdogs
  { colors: [[231, 188, 120], [197, 193, 134], [82, 132, 145]], dark: [68, 69, 61] }, // Rising Upcoming
];
const BUILT_IN_SEGMENT_PALETTE_INDEX: Record<string, number> = {
  "f4da5512-aa3e-48bf-9f3d-a0afd14b8e56": 0,
  "2f19120b-0507-428d-9207-762d8726439e": 9,
  "f90877c1-e055-44a9-beaf-22f57345fcef": 8,
  "603daa76-e824-4bb6-be96-06588debd39e": 2,
  "8e59f651-ff3e-4c02-8c41-0a5e93e359ae": 7,
  "58de72e7-a56c-4c6a-9acc-3b7ac588551f": 1,
  "d9eb80bc-3a5f-4d06-8bb0-cf2841f75625": 5,
  "1adf71d3-8fe8-4c9c-b758-01226da09a63": 6,
  unsegmented: 4,
  "e362a18b-4a6c-42d7-85f8-f499ba2d195e": 3,
  "425682ab-52c3-41b6-bd6c-02dfd28a2903": 5,
  "d50f2a28-f923-4148-a39f-67f1b17882b4": 7,
};
const HOME_FEED_RENDER_RADIUS = 4;
const FEED_TITLE_EXPANDED_MAX = 140;
const FEED_DESCRIPTION_EXPANDED_MAX = 260;
const FEEDS_DRAG_EDGE_SIZE = 92;
const FEEDS_DRAG_MAX_SCROLL_SPEED = 18;
const FEEDS_PAGE_LIBRARY_SESSION_KEY = "aeon-feeds-page-library";
const PWA_CHROME_THEME_COLOR = "#11131a";
const DESKTOP_GRID_OPTIONS = [6, 7, 8] as const;

function resolvedDesktopGridColumns(view: FeedViewSettings) {
  return view.desktopGridColumns ?? (view.gridColumns >= 5 ? 8 : view.gridColumns === 4 ? 7 : 6);
}

function useDesktopLayout() {
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
}
const ACCENT_COLORS = [
  { name: "Rose", value: "#ff3b81" },
  { name: "Blue", value: "#4f8cff" },
  { name: "Emerald", value: "#26c281" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Cyan", value: "#06b6d4" },
] as const;

const SESSION_RESTORE_KEY = "manhwa-library-route-v1";
const HOME_SCROLL_PREFIX = "manhwa-home-scroll";
const HOME_RETURNING_FROM_TITLE_KEY = "manhwa-home-returning-from-title";
const FEEDS_SCROLL_KEY = "manhwa-feeds-scroll";
type RgbColor = [number, number, number];
const DEFAULT_FEED_PALETTE: [RgbColor, RgbColor, RgbColor] = [
  [126, 82, 166],
  [64, 132, 158],
  [170, 92, 132],
];
const coverPaletteCache = new Map<string, Promise<RgbColor>>();

type TitleSelectionMode = { kind: "collect" } | { kind: "remove"; feedId: string };
interface TitleSelectionSnapshot {
  mode: TitleSelectionMode | null;
  selectedIds: ReadonlySet<number>;
}
interface TitleSelectionStore {
  getSnapshot: () => TitleSelectionSnapshot;
  isSelected: (titleId: number) => boolean;
  subscribe: (titleId: number, listener: () => void) => () => void;
  subscribeAll: (listener: () => void) => () => void;
  replace: (mode: TitleSelectionMode, titleIds: Iterable<number>) => void;
  toggle: (titleId: number) => void;
  clear: () => void;
}
interface TitleSelectionValue {
  store: TitleSelectionStore;
  begin: (feed: Feed, titleId: number) => void;
  toggle: (feed: Feed, titleId: number) => void;
  clear: () => void;
}

function createTitleSelectionStore(): TitleSelectionStore {
  let snapshot: TitleSelectionSnapshot = { mode: null, selectedIds: new Set() };
  const titleListeners = new Map<number, Set<() => void>>();
  const allListeners = new Set<() => void>();
  const publish = (next: TitleSelectionSnapshot) => {
    const changedIds = new Set<number>([...snapshot.selectedIds, ...next.selectedIds]);
    for (const titleId of [...changedIds]) {
      if (snapshot.selectedIds.has(titleId) === next.selectedIds.has(titleId)) changedIds.delete(titleId);
    }
    snapshot = next;
    for (const titleId of changedIds) for (const listener of titleListeners.get(titleId) ?? []) listener();
    for (const listener of allListeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    isSelected: (titleId) => snapshot.selectedIds.has(titleId),
    subscribe: (titleId, listener) => {
      const listeners = titleListeners.get(titleId) ?? new Set<() => void>();
      listeners.add(listener);
      titleListeners.set(titleId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) titleListeners.delete(titleId);
      };
    },
    subscribeAll: (listener) => {
      allListeners.add(listener);
      return () => allListeners.delete(listener);
    },
    replace: (mode, titleIds) => publish({ mode, selectedIds: new Set(titleIds) }),
    toggle: (titleId) => {
      const selectedIds = new Set(snapshot.selectedIds);
      if (selectedIds.has(titleId)) selectedIds.delete(titleId);
      else selectedIds.add(titleId);
      publish({ ...snapshot, selectedIds });
    },
    clear: () => publish({ mode: null, selectedIds: new Set() }),
  };
}

const TitleSelectionContext = createContext<TitleSelectionValue | null>(null);
function useTitleSelection() {
  const value = useContext(TitleSelectionContext);
  if (!value) throw new Error("Title selection must be used inside AppFrame");
  return value;
}

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

function homeScrollKey(feed: Feed | null) {
  if (!feed) return `${HOME_SCROLL_PREFIX}:none`;
  return `${HOME_SCROLL_PREFIX}:${feed.id}:${feed.view.gridColumns}:${feed.view.gridDensity}`;
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
    const saved = JSON.parse(localStorage.getItem(SESSION_RESTORE_KEY) ?? "{}") as {
      path?: string;
      scroll?: Record<string, number>;
    };
    localStorage.setItem(
      SESSION_RESTORE_KEY,
      JSON.stringify({ ...saved, path: "/", scroll: { ...(saved.scroll ?? {}), "/": scrollTop, [key]: scrollTop } }),
    );
  } catch {
    // Best effort only.
  }
}

function prepareHomeTitleNavigation(feed: Feed | null) {
  if (!getHomeScrollContainer(feed)) return;
  saveHomeScroll(feed);
  try {
    sessionStorage.setItem(HOME_RETURNING_FROM_TITLE_KEY, "1");
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

function orderedFeedsForSegments(
  feeds: Feed[],
  segments: FeedSegment[],
  settings: Pick<AppSettings, "searchAdultTags" | "searchRelationshipTags">,
  options: { homeOnly?: boolean } = {},
  libraryOrder: FeedLibraryKind[] = ["logic", "custom"],
) {
  const byId = new Map(feeds.map((feed) => [feed.id, feed]));
  const seen = new Set<string>();
  const ordered: Feed[] = [];
  for (const library of libraryOrder) {
    for (const segment of segments) {
      if (segment.library !== library) continue;
      if (options.homeOnly && (segment.hiddenFromHome || !isBuiltInSensitiveSegmentVisible(segment, settings))) continue;
      for (const feedId of segment.feedIds) {
        const feed = byId.get(feedId);
        if (!feed || feed.kind !== library || seen.has(feedId)) continue;
        seen.add(feedId);
        ordered.push(feed);
      }
    }
  }
  if (!options.homeOnly) {
    for (const feed of feeds) {
      if (!seen.has(feed.id)) ordered.push(feed);
    }
  }
  return ordered;
}

function segmentColorStyle(segmentId: string) {
  let hash = 2166136261;
  for (let index = 0; index < segmentId.length; index += 1) {
    hash = Math.imul(hash ^ segmentId.charCodeAt(index), 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  const paletteIndex = BUILT_IN_SEGMENT_PALETTE_INDEX[segmentId] ?? hash % APPROVED_SEGMENT_PALETTES.length;
  const palette = APPROVED_SEGMENT_PALETTES[paletteIndex];
  return {
    "--segment-color-1": palette.colors[0].join(" "),
    "--segment-color-2": palette.colors[1].join(" "),
    "--segment-color-3": palette.colors[2].join(" "),
    "--segment-color-dark": palette.dark.join(" "),
  } as React.CSSProperties;
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
  const lastHomeNavTapRef = useRef(0);
  const homeTapTimerRef = useRef<number | null>(null);
  const titleSelectionHistoryEntryRef = useRef(false);
  const [titleSelectionStore] = useState(createTitleSelectionStore);
  const nav = NAV_ITEMS.filter((item) => store.settings.bottomNavItems.includes(item.id));
  const showingHome = location.pathname === "/";
  const showingTitle = location.pathname.startsWith("/title/");
  const [homeHasMounted, setHomeHasMounted] = useState(showingHome || showingTitle);
  const keepHomeMounted = homeHasMounted || showingHome || showingTitle;
  const defaultHomeFeeds = useMemo(
    () => orderedFeedsForSegments(store.feeds, store.feedSegments, store.settings, { homeOnly: true }, store.feedLibraryOrder),
    [store.feeds, store.feedLibraryOrder, store.feedSegments, store.settings],
  );
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW() {
      void 0;
    },
  });

  useEffect(() => {
    if (showingHome || showingTitle) setHomeHasMounted(true);
  }, [showingHome, showingTitle]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", store.settings.accentColor);
    document.title = store.settings.appName || "Aeon";
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

  useEffect(() => {
    if (needRefresh) void updateServiceWorker(true);
  }, [needRefresh, updateServiceWorker]);

  const clearTitleSelection = useCallback(() => {
    titleSelectionStore.clear();
    if (titleSelectionHistoryEntryRef.current) {
      titleSelectionHistoryEntryRef.current = false;
      window.history.back();
    }
  }, [titleSelectionStore]);
  const beginTitleSelection = useCallback((feed: Feed, titleId: number) => {
    if (!titleSelectionStore.getSnapshot().mode && !titleSelectionHistoryEntryRef.current) {
      window.history.pushState({ ...window.history.state, aeonTitleSelection: true }, "", window.location.href);
      titleSelectionHistoryEntryRef.current = true;
    }
    titleSelectionStore.replace(feed.kind === "custom" ? { kind: "remove", feedId: feed.id } : { kind: "collect" }, [titleId]);
  }, [titleSelectionStore]);
  const toggleTitleSelection = useCallback((feed: Feed, titleId: number) => {
    const { mode } = titleSelectionStore.getSnapshot();
    if (mode?.kind === "remove" && mode.feedId !== feed.id) return;
    if (mode?.kind === "collect" && feed.kind === "custom") return;
    if (!mode) {
      beginTitleSelection(feed, titleId);
      return;
    }
    titleSelectionStore.toggle(titleId);
  }, [beginTitleSelection, titleSelectionStore]);

  useEffect(() => {
    const handleSelectionBack = () => {
      if (!titleSelectionHistoryEntryRef.current) return;
      titleSelectionHistoryEntryRef.current = false;
      titleSelectionStore.clear();
    };
    window.addEventListener("popstate", handleSelectionBack);
    return () => window.removeEventListener("popstate", handleSelectionBack);
  }, [titleSelectionStore]);
  const selectionValue = useMemo<TitleSelectionValue>(() => ({
    store: titleSelectionStore,
    begin: beginTitleSelection,
    toggle: toggleTitleSelection,
    clear: clearTitleSelection,
  }), [beginTitleSelection, clearTitleSelection, titleSelectionStore, toggleTitleSelection]);

  return (
    <TitleSelectionContext.Provider value={selectionValue}>
    <div className="app-shell">
      <SessionRestorer />
      <main>
        {keepHomeMounted && (
          <div className={!showingHome ? "route-cache-hidden" : undefined} aria-hidden={!showingHome || undefined}>
            <StableHomePage />
          </div>
        )}
        {showingTitle ? (
          <Routes>
            <Route path="/title/:id" element={<TitleDetailPage />} />
          </Routes>
        ) : (
          !showingHome && (
            <Routes>
              <Route path="/feeds" element={<FeedsPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/recommendations/*" element={<Navigate to="/" replace />} />
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
                if (item.id !== "home") return;
                const now = Date.now();
                const isDoubleTap = now - lastHomeNavTapRef.current <= 700;
                if (homeTapTimerRef.current !== null) window.clearTimeout(homeTapTimerRef.current);
                lastHomeNavTapRef.current = now;
                if (!isDoubleTap) {
                  homeTapTimerRef.current = window.setTimeout(() => {
                    lastHomeNavTapRef.current = 0;
                    homeTapTimerRef.current = null;
                  }, 700);
                  return;
                }
                event.preventDefault();
                lastHomeNavTapRef.current = 0;
                store.exitHomePreview();
                store.setActiveFeedId(defaultHomeFeeds[0]?.id ?? null);
                store.requestHomeReset();
                navigate("/");
              }}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <TitleSelectionDock />
    </div>
    </TitleSelectionContext.Provider>
  );
}

function SessionRestorer() {
  const store = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();
  const restored = useRef(false);
  const activeFeed = useMemo(
    () => store.feeds.find((feed) => feed.id === store.activeFeedId) ?? store.feeds[0] ?? null,
    [store.activeFeedId, store.feeds],
  );

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
    const key = location.pathname === "/" ? homeScrollKey(activeFeed) : path;
    if (location.pathname.startsWith("/title/")) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    if (location.pathname === "/") {
      requestAnimationFrame(() => requestAnimationFrame(() => restoreHomeScroll(activeFeed)));
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_RESTORE_KEY) ?? "{}") as { scroll?: Record<string, number> };
      const candidates = [saved.scroll?.[key], Number(localStorage.getItem(key)), saved.scroll?.[path]];
      const y = candidates.find((value) => Number.isFinite(value)) ?? 0;
      if (y > 0) {
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y })));
      }
    } catch {
      // Ignore stale restore payloads.
    }
  }, [activeFeed, location.pathname, location.search, store.settings.restoreLastSession]);

  useEffect(() => {
    if (!store.settings.restoreLastSession) return;
    const path = `${location.pathname}${location.search}`;
    const key = location.pathname === "/" ? homeScrollKey(activeFeed) : path;
    if (location.pathname.startsWith("/title/")) return;
    if (location.pathname === "/") {
      const container = getHomeScrollContainer(activeFeed);
      if (!container) return;
      const save = () => {
        try {
          const saved = JSON.parse(localStorage.getItem(SESSION_RESTORE_KEY) ?? "{}") as {
            path?: string;
            scroll?: Record<string, number>;
          };
          localStorage.setItem(
            SESSION_RESTORE_KEY,
            JSON.stringify({
              ...saved,
              path,
              scroll: { ...(saved.scroll ?? {}), [path]: container.scrollTop, [key]: container.scrollTop },
            }),
          );
          localStorage.setItem(key, String(container.scrollTop));
        } catch {
          // localStorage can be unavailable in private contexts.
        }
      };
      save();
      container.addEventListener("scroll", save, { passive: true });
      return () => container.removeEventListener("scroll", save);
    }
    const save = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(SESSION_RESTORE_KEY) ?? "{}") as {
          path?: string;
          scroll?: Record<string, number>;
        };
        localStorage.setItem(
          SESSION_RESTORE_KEY,
          JSON.stringify({ ...saved, path, scroll: { ...(saved.scroll ?? {}), [path]: window.scrollY, [key]: window.scrollY } }),
        );
        if (location.pathname === "/") localStorage.setItem(key, String(window.scrollY));
      } catch {
        // localStorage can be unavailable in private contexts.
      }
    };
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [activeFeed, location.pathname, location.search, store.settings.restoreLastSession]);

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

function TitleSelectionDock() {
  const store = useAppStore();
  const selection = useTitleSelection();
  const selectionSnapshot = useSyncExternalStore(
    selection.store.subscribeAll,
    selection.store.getSnapshot,
    selection.store.getSnapshot,
  );
  const { mode, selectedIds } = selectionSnapshot;
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [destinationIds, setDestinationIds] = useState<Set<string>>(() => new Set());
  const [newListName, setNewListName] = useState("");
  const [summary, setSummary] = useState("");
  const customFeeds = useMemo(() => store.feeds.filter((feed) => feed.kind === "custom"), [store.feeds]);
  const customFeedsById = useMemo(() => new Map(customFeeds.map((feed) => [feed.id, feed])), [customFeeds]);
  const customSegments = useMemo(() => store.feedSegments.filter((segment) => segment.library === "custom"), [store.feedSegments]);
  const removalFeed = mode?.kind === "remove" ? customFeedsById.get(mode.feedId) : null;
  const selectedCount = selectedIds.size;

  useLayoutEffect(() => {
    if (mode && selectedCount === 0 && !destinationOpen) selection.clear();
  }, [destinationOpen, mode, selectedCount, selection]);

  useEffect(() => {
    if (!summary) return;
    const timer = window.setTimeout(() => setSummary(""), 2600);
    return () => window.clearTimeout(timer);
  }, [summary]);

  if (!mode && !summary) return null;
  const applyDestinations = () => {
    const result = store.addTitlesToCustomFeeds([...destinationIds], [...selectedIds]);
    setSummary(`${result.added} added${result.duplicates ? ` · ${result.duplicates} already there` : ""}${result.full ? ` · ${result.full} skipped (full)` : ""}`);
    setDestinationOpen(false);
    setDestinationIds(new Set());
    selection.clear();
  };

  return (
    <>
      {mode && !destinationOpen ? (
        <div className="title-selection-dock" role="toolbar" aria-label="Selected titles">
          <button className="button ghost" type="button" onClick={selection.clear}>Cancel</button>
          <strong className="title-selection-count" aria-label={`${selectedCount} selected`}>{selectedCount}</strong>
          {mode.kind === "remove" ? (
            <>
              <button className="button ghost" type="button" disabled={(removalFeed?.titleIds.length ?? 0) < 2} onClick={() => {
                if (!removalFeed) return;
                const feedId = removalFeed.id;
                selection.clear();
                window.dispatchEvent(new CustomEvent("aeon:rearrange-custom-feed", { detail: { feedId } }));
              }}><GripVertical size={17} /> Drag</button>
              <button className="button danger" type="button" disabled={selectedCount === 0} onClick={() => {
                store.removeTitlesFromCustomFeed(mode.kind === "remove" ? mode.feedId : "", [...selectedIds]);
                selection.clear();
              }}><Trash2 size={17} /> Remove</button>
            </>
          ) : (
            <button className="button primary" type="button" disabled={selectedCount === 0} onClick={() => setDestinationOpen(true)}><Plus size={17} /> Add</button>
          )}
        </div>
      ) : null}
      {summary ? <div className="selection-result-toast" role="status">{summary}</div> : null}
      <BottomDrawer title="Add to MY LIST" open={destinationOpen} onOpenChange={(open) => {
        setDestinationOpen(open);
        if (!open) setDestinationIds(new Set());
      }}>
        <div className="setting-stack custom-destination-list">
          {customSegments.map((segment) => {
            const feeds = segment.feedIds.flatMap((id) => {
              const feed = customFeedsById.get(id);
              return feed ? [feed] : [];
            });
            if (feeds.length === 0) return null;
            return <section key={segment.id}>
              <h3 className="small-label">{segment.name}</h3>
              {feeds.map((feed) => {
                const checked = destinationIds.has(feed.id);
                return <button className={`custom-destination-row ${checked ? "selected" : ""}`} type="button" key={feed.id} onClick={() => setDestinationIds((current) => {
                  const next = new Set(current);
                  if (next.has(feed.id)) next.delete(feed.id); else next.add(feed.id);
                  return next;
                })}>
                  <span>{feed.name}</span>
                  <small>{feed.titleIds.length} / {CUSTOM_FEED_TITLE_LIMIT}</small>
                  <span className="selection-check">{checked ? <Check size={16} /> : null}</span>
                </button>;
              })}
            </section>;
          })}
          <div className="field">
            <label htmlFor="selection-new-list">Create a new list</label>
            <div className="row">
              <input id="selection-new-list" className="input" value={newListName} onChange={(event) => setNewListName(event.target.value)} placeholder="List name" autoComplete="off" />
              <button className="button" type="button" disabled={!newListName.trim()} onClick={() => {
                const feed = createCustomFeed(newListName.trim());
                feed.titleIds = [...selectedIds].slice(0, CUSTOM_FEED_TITLE_LIMIT);
                store.upsertFeed(feed);
                setNewListName("");
                setDestinationOpen(false);
                setSummary(`${feed.titleIds.length} added to ${feed.name}`);
                selection.clear();
              }}><Plus size={16} /> Create</button>
            </div>
          </div>
          <div className="toolbar">
            <button className="button" type="button" onClick={() => setDestinationOpen(false)}>Cancel</button>
            <span className="spacer" />
            <button className="button primary" type="button" disabled={destinationIds.size === 0} onClick={applyDestinations}><Check size={16} /> Add to selected</button>
          </div>
        </div>
      </BottomDrawer>
    </>
  );
}

function LibraryLoadingState({
  complete,
  downloadProgress,
  onVisualComplete,
  status,
}: {
  complete: boolean;
  downloadProgress: number | null;
  onVisualComplete: () => void;
  status: string;
}) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const actualTargetRef = useRef(20);
  const visualTargetRef = useRef(20);
  const finishingRef = useRef(false);
  const completionAnimationRef = useRef<Animation | null>(null);

  useEffect(() => {
    const progress = Math.max(0, Math.min(1, downloadProgress ?? 0));
    actualTargetRef.current = 20 + progress * 62;
  }, [downloadProgress]);

  useEffect(() => {
    if (finishingRef.current || (!complete && !status.toLowerCase().includes("saving"))) return;
    if (complete && downloadProgress === null && !status.toLowerCase().includes("saving")) {
      finishingRef.current = true;
      onVisualComplete();
      return;
    }
    finishingRef.current = true;
    const fill = fillRef.current;
    if (!fill) {
      onVisualComplete();
      return;
    }
    const currentTransform = getComputedStyle(fill).transform;
    fill.style.transition = "none";
    const animation = fill.animate(
      [{ transform: currentTransform }, { transform: "scaleX(1)" }],
      { duration: 2400, easing: "cubic-bezier(0.22, 0.72, 0.2, 1)", fill: "forwards" },
    );
    completionAnimationRef.current = animation;
    void animation.finished.then(() => {
      fill.style.transform = "scaleX(1)";
      onVisualComplete();
    }).catch(() => undefined);
  }, [complete, downloadProgress, onVisualComplete, status]);

  useEffect(() => () => completionAnimationRef.current?.cancel(), []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (finishingRef.current) return;
      const allowedTarget = Math.min(82, actualTargetRef.current + 3);
      const remaining = allowedTarget - visualTargetRef.current;
      visualTargetRef.current = Math.min(
        allowedTarget,
        visualTargetRef.current + Math.max(0.08, remaining * 0.12),
      );
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${visualTargetRef.current / 100})`;
      }
    }, 160);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="library-loading-state" role="status" aria-live="polite" aria-busy="true">
      <div className="library-loading-panel">
        <div className="library-loading-mark" aria-hidden="true">
          <Database size={28} strokeWidth={1.8} />
        </div>
        <div className="library-loading-copy">
          <strong>Preparing your library</strong>
          <span>{status}</span>
        </div>
        <div
          className="library-loading-progress"
          role="progressbar"
          aria-label="Library download in progress"
          aria-valuetext={status}
        >
          <span ref={fillRef} />
        </div>
      </div>
    </div>
  );
}

function HomePage() {
  const store = useAppStore();
  const [libraryLoaderVisible, setLibraryLoaderVisible] = useState(() => !store.ready);
  const [libraryLoaderVisualComplete, setLibraryLoaderVisualComplete] = useState(false);
  const libraryDownloadObservedRef = useRef(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFeed, setEditorFeed] = useState<Feed | null>(null);
  const [preloadReady, setPreloadReady] = useState(false);
  const [renderCenterIndex, setRenderCenterIndex] = useState(-1);
  const [warmFeedIds, setWarmFeedIds] = useState<Set<string>>(() => new Set());
  const [returningFromTitle, setReturningFromTitle] = useState(() => sessionStorage.getItem(HOME_RETURNING_FROM_TITLE_KEY) === "1");
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const paneRefs = useRef(new Map<string, HTMLDivElement>());
  const renderCenterIndexRef = useRef(-1);
  const warmFeedIdsRef = useRef(new Set<string>());
  const didInitialPagerAlignRef = useRef(false);
  const completeLibraryLoaderVisual = useCallback(() => setLibraryLoaderVisualComplete(true), []);

  useEffect(() => {
    if (/starting sync|download|merging|saving/i.test(store.syncStatus)) {
      libraryDownloadObservedRef.current = true;
    }
  }, [store.syncStatus]);

  useEffect(() => {
    if (!libraryLoaderVisible || !store.ready) return;
    if (libraryDownloadObservedRef.current && !libraryLoaderVisualComplete) return;
    const delay = libraryDownloadObservedRef.current ? 220 : 120;
    const timer = window.setTimeout(() => setLibraryLoaderVisible(false), delay);
    return () => window.clearTimeout(timer);
  }, [libraryLoaderVisible, libraryLoaderVisualComplete, store.ready]);
  const previewSegment = useMemo(() => {
    const segment = store.feedSegments.find((item) => item.id === store.homePreviewSegmentId) ?? null;
    if (!segment || !isBuiltInSensitiveSegmentVisible(segment, store.settings)) return null;
    return segment;
  }, [store.feedSegments, store.homePreviewSegmentId, store.settings]);

  useEffect(() => {
    if (store.homePreviewSegmentId && !previewSegment) store.exitHomePreview();
  }, [previewSegment, store]);
  const feeds = useMemo(() => {
    if (!previewSegment) return orderedFeedsForSegments(store.feeds, store.feedSegments, store.settings, { homeOnly: true }, store.feedLibraryOrder);
    const byId = new Map(store.feeds.map((feed) => [feed.id, feed]));
    return previewSegment.feedIds.flatMap((feedId) => {
      const feed = byId.get(feedId);
      return feed ? [feed] : [];
    });
  }, [previewSegment, store.feedLibraryOrder, store.feedSegments, store.feeds, store.settings]);
  const { activeFeedId, completeHomeReset, setActiveFeedId } = store;
  const activeFeed = feeds.find((feed) => feed.id === activeFeedId) ?? feeds[0] ?? null;
  const activeFeedIndex = activeFeed ? feeds.findIndex((feed) => feed.id === activeFeed.id) : -1;

  useEffect(() => {
    renderCenterIndexRef.current = -1;
    didInitialPagerAlignRef.current = false;
    setRenderCenterIndex(-1);
  }, [store.homePreviewSegmentId]);

  useEffect(() => {
    if (!activeFeedId && feeds[0]) setActiveFeedId(feeds[0].id);
  }, [activeFeedId, feeds, setActiveFeedId]);

  useLayoutEffect(() => {
    if (!store.homeResetRequested || feeds.length === 0) return;
    const firstFeed = feeds[0];
    if (activeFeedId !== firstFeed.id) {
      setActiveFeedId(firstFeed.id);
      return;
    }
    const firstFeedIndex = 0;
    renderCenterIndexRef.current = firstFeedIndex;
    setRenderCenterIndex(firstFeedIndex);
    const frame = window.requestAnimationFrame(() => {
      const pane = paneRefs.current.get(firstFeed.id);
      if (!pane) return;
      pane.scrollIntoView({ behavior: "auto", block: "nearest", inline: "start" });
      const scroller = pane.querySelector<HTMLElement>(".feed-pane-scroll");
      scroller?.scrollTo({ top: 0, behavior: "auto" });
      localStorage.setItem(homeScrollKey(firstFeed), "0");
      completeHomeReset();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeFeedId, completeHomeReset, feeds, setActiveFeedId, store.homeResetRequested]);

  useEffect(() => {
    if (activeFeedIndex < 0 || renderCenterIndexRef.current >= 0) return;
    renderCenterIndexRef.current = activeFeedIndex;
    setRenderCenterIndex(activeFeedIndex);
  }, [activeFeedIndex]);

  useEffect(() => {
    const feedIds = new Set(feeds.map((feed) => feed.id));
    let changed = false;
    const nextWarmFeedIds = new Set<string>();
    warmFeedIdsRef.current.forEach((feedId) => {
      if (feedIds.has(feedId)) nextWarmFeedIds.add(feedId);
      else changed = true;
    });
    if (!changed) return;
    warmFeedIdsRef.current = nextWarmFeedIds;
    setWarmFeedIds(nextWarmFeedIds);
  }, [feeds]);

  const warmFeedAt = useCallback(
    (index: number) => {
      const feed = feeds[Math.max(0, Math.min(feeds.length - 1, index))];
      if (!feed || warmFeedIdsRef.current.has(feed.id)) return;
      const nextWarmFeedIds = new Set(warmFeedIdsRef.current);
      nextWarmFeedIds.add(feed.id);
      warmFeedIdsRef.current = nextWarmFeedIds;
      startTransition(() => setWarmFeedIds(nextWarmFeedIds));
    },
    [feeds],
  );

  useLayoutEffect(() => {
    const requestedFeedId = store.homeOpenFeedRequestId;
    if (!requestedFeedId) return;
    const requestedIndex = feeds.findIndex((feed) => feed.id === requestedFeedId);
    if (requestedIndex < 0) return;
    renderCenterIndexRef.current = requestedIndex;
    setRenderCenterIndex(requestedIndex);
    warmFeedAt(requestedIndex);
    const frame = window.requestAnimationFrame(() => {
      const pane = paneRefs.current.get(requestedFeedId);
      if (!pane) return;
      pane.scrollIntoView({ behavior: "auto", block: "nearest", inline: "start" });
      store.completeHomeFeedOpen();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [feeds, store, warmFeedAt]);

  useLayoutEffect(() => {
    if (!store.ready || !activeFeed) return;
    const pane = paneRefs.current.get(activeFeed.id);
    if (!pane) return;
    if (returningFromTitle) {
      pane.scrollIntoView({ behavior: "auto", block: "nearest", inline: "start" });
      restoreHomeScroll(activeFeed);
      setReturningFromTitle(false);
      try {
        sessionStorage.removeItem(HOME_RETURNING_FROM_TITLE_KEY);
      } catch {
        // Best effort only.
      }
      window.setTimeout(() => {
        setPreloadReady(true);
        for (let offset = -HOME_FEED_RENDER_RADIUS; offset <= HOME_FEED_RENDER_RADIUS; offset += 1) {
          warmFeedAt(activeFeedIndex + offset);
        }
      }, 120);
      return;
    }
    if (!didInitialPagerAlignRef.current) {
      didInitialPagerAlignRef.current = true;
      pane.scrollIntoView({ behavior: "auto", block: "nearest", inline: "start" });
      restoreHomeScroll(activeFeed);
    }
  }, [activeFeed, activeFeedIndex, returningFromTitle, store.ready, warmFeedAt]);

  useEffect(() => {
    if (!store.ready || activeFeedIndex < 0) return;
    const warmOrder = [5, -1, -2, -3, -4, -5];
    const timers = warmOrder.map((offset, step) =>
      window.setTimeout(() => warmFeedAt(activeFeedIndex + offset), 450 + step * 220),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeFeedIndex, store.ready, warmFeedAt]);

  const warmFeedsAroundScrollPosition = useCallback(() => {
    setPreloadReady(true);
    const pager = pagerRef.current;
    if (!pager || feeds.length === 0) return;
    const handleScroll = () => {
      const firstPane = paneRefs.current.get(feeds[0]?.id);
      const secondPane = paneRefs.current.get(feeds[1]?.id);
      const paneStep = secondPane && firstPane ? secondPane.offsetLeft - firstPane.offsetLeft : firstPane?.offsetWidth;
      if (!paneStep) return;
      const scrollIndex = pager.scrollLeft / paneStep;
      const nearestIndex = Math.round(scrollIndex);
      const nearestFeedId = feeds[nearestIndex]?.id;
      if (nearestFeedId && nearestFeedId !== activeFeedId) {
        setActiveFeedId(nearestFeedId);
      }
      if (nearestIndex !== renderCenterIndexRef.current) {
        renderCenterIndexRef.current = nearestIndex;
        startTransition(() => setRenderCenterIndex(nearestIndex));
      }
      for (let offset = -HOME_FEED_RENDER_RADIUS; offset <= HOME_FEED_RENDER_RADIUS; offset += 1) {
        warmFeedAt(nearestIndex + offset);
      }
    };
    handleScroll();
  }, [activeFeedId, feeds, setActiveFeedId, warmFeedAt]);

  const handleFeedPaneScroll = useCallback(
    (feed: Feed) => {
      saveHomeScroll(feed);
    },
    [],
  );

  const goToFeed = useCallback(
    (index: number) => {
      const targetFeed = feeds[index];
      const pane = targetFeed ? paneRefs.current.get(targetFeed.id) : null;
      if (!targetFeed || !pane) return;
      warmFeedAt(index);
      renderCenterIndexRef.current = index;
      setRenderCenterIndex(index);
      setActiveFeedId(targetFeed.id);
      pane.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    },
    [feeds, setActiveFeedId, warmFeedAt],
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
      {libraryLoaderVisible ? (
        <LibraryLoadingState
          complete={store.ready}
          downloadProgress={store.syncProgress}
          onVisualComplete={completeLibraryLoaderVisual}
          status={store.syncStatus || "Opening offline library"}
        />
      ) : store.feeds.length === 0 ? (
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
      ) : !activeFeed ? (
        <div className="empty-state">
          <Library size={34} />
          <h1>No visible Home segments</h1>
          <p className="muted">Unhide a segment from Feeds to bring its feeds back to Home.</p>
          <Link className="button primary" to="/feeds">
            Manage feeds
          </Link>
        </div>
      ) : (
        <div className="feed-pager-shell">
          <button
            className="desktop-feed-pager-button previous"
            type="button"
            onClick={() => goToFeed(activeFeedIndex - 1)}
            disabled={activeFeedIndex <= 0}
            aria-label="Previous feed"
          >
            <ChevronLeft size={28} />
          </button>
          <div className="feed-pager" ref={pagerRef} aria-label="Home feeds" onScroll={warmFeedsAroundScrollPosition}>
            <div className="feed-pager-track">
            {feeds.map((feed, index) => {
              const isActive = index === activeFeedIndex;
              const renderOriginIndex = renderCenterIndex >= 0 ? renderCenterIndex : activeFeedIndex;
              const renderRadius = returningFromTitle
                ? 0
                : preloadReady
                  ? HOME_FEED_RENDER_RADIUS
                  : HOME_FEED_INITIAL_RENDER_RADIUS;
              const isNearby = renderOriginIndex >= 0 && Math.abs(index - renderOriginIndex) <= renderRadius;
              const shouldRenderFeed = isActive || isNearby || warmFeedIds.has(feed.id);
              return (
                <div
                  key={feed.id}
                  className="feed-pager-panel"
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
                    {shouldRenderFeed ? <FeedView feed={feed} onEditFeed={setEditorFeed} /> : <HomeFeedPaneSkeleton feed={feed} />}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
          <button
            className="desktop-feed-pager-button next"
            type="button"
            onClick={() => goToFeed(activeFeedIndex + 1)}
            disabled={activeFeedIndex >= feeds.length - 1}
            aria-label="Next feed"
          >
            <ChevronRight size={28} />
          </button>
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
      <BottomDrawer title={editorFeed?.name ?? "Feed Settings"} open={Boolean(editorFeed)} onOpenChange={(open) => !open && setEditorFeed(null)}>
        {editorFeed ? (
          <FeedSettingsEditor
            key={editorFeed.id}
            feed={editorFeed}
            onCancel={() => setEditorFeed(null)}
            onSave={(feed) => {
              store.upsertFeed(feed);
              setEditorFeed(null);
            }}
          />
        ) : null}
      </BottomDrawer>
    </div>
  );
}

const StableHomePage = memo(HomePage);

function FeedView({ feed, onEditFeed }: { feed: Feed; onEditFeed?: (feed: Feed) => void }) {
  const store = useAppStore();
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [localSearchOpen, setLocalSearchOpen] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [customActionOpen, setCustomActionOpen] = useState(false);
  const [customMode, setCustomMode] = useState<"add" | "rearrange" | null>(null);
  const [customAddQuery, setCustomAddQuery] = useState("");
  const [pendingAddIds, setPendingAddIds] = useState<Set<number>>(() => new Set());
  const addSearchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingAddIdsRef = useRef<Set<number>>(new Set());
  const customModeRef = useRef<"add" | "rearrange" | null>(null);
  const customAddQueryRef = useRef("");
  const customAddHistoryEntryRef = useRef(false);
  const addTitlesRef = useRef(store.addTitlesToCustomFeeds);
  const lastTitleTapRef = useRef(0);
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
  const descriptionCanExpand = hasDescription;
  const descriptionText = hasDescription ? cappedText(feed.description, FEED_DESCRIPTION_EXPANDED_MAX) : "";
  const deferredLocalSearchQuery = useDeferredValue(localSearchQuery);
  const originalRanks = useMemo(() => new Map(query.items.map((item, index) => [item.id, index + 1])), [query.items]);
  const displayedItems = useMemo(() => {
    const words = searchWords(deferredLocalSearchQuery);
    if (words.length === 0) return query.items;
    return query.items.filter((item) => matchesSearchTextWords(seriesSearchText(item), words));
  }, [deferredLocalSearchQuery, query.items]);
  const sensitiveTagIds = useMemo(() => buildSensitiveTagGroups(store.tags), [store.tags]);
  const visibleAddCatalog = useMemo(
    () => store.catalog.filter((item) => isSearchVisible(item, store.settings, sensitiveTagIds)),
    [sensitiveTagIds, store.catalog, store.settings],
  );
  const addSearchTextById = useMemo(() => new Map(visibleAddCatalog.map((item) => [item.id, seriesSearchText(item)])), [visibleAddCatalog]);
  const addSearchIndex = useMemo(() => new Fuse(visibleAddCatalog, {
    shouldSort: true,
    ignoreLocation: true,
    threshold: 0.28,
    minMatchCharLength: 2,
    keys: [
      { name: "display_title", weight: 0.5 },
      { name: "titles.title", weight: 0.42 },
      { name: "animeplanet_title", weight: 0.3 },
      { name: "mangabaka_title", weight: 0.24 },
      { name: "native_title", weight: 0.22 },
      { name: "romanized_title", weight: 0.22 },
      { name: "authors", weight: 0.2 },
      { name: "artists", weight: 0.18 },
    ],
  }), [visibleAddCatalog]);
  const deferredAddQuery = useDeferredValue(customAddQuery);
  const addResults = useMemo(() => {
    const term = deferredAddQuery.trim();
    if (term.length < 2) return [];
    const words = searchWords(term);
    const direct = visibleAddCatalog
      .filter((item) => matchesSearchTextWords(addSearchTextById.get(item.id) ?? "", words))
      .sort((left, right) => searchTextWordPosition(addSearchTextById.get(left.id) ?? "", words) - searchTextWordPosition(addSearchTextById.get(right.id) ?? "", words));
    return (direct.length ? direct : addSearchIndex.search(term, { limit: 120 }).map((result) => result.item)).slice(0, 120);
  }, [addSearchIndex, addSearchTextById, deferredAddQuery, visibleAddCatalog]);
  const existingCustomIds = useMemo(() => new Set(feed.titleIds), [feed.titleIds]);
  useEffect(() => { pendingAddIdsRef.current = pendingAddIds; }, [pendingAddIds]);
  useEffect(() => { customModeRef.current = customMode; }, [customMode]);
  useEffect(() => { customAddQueryRef.current = customAddQuery; }, [customAddQuery]);
  useEffect(() => { addTitlesRef.current = store.addTitlesToCustomFeeds; }, [store.addTitlesToCustomFeeds]);
  const commitPendingAdds = useCallback(() => {
    const pending = pendingAddIdsRef.current;
    if (feed.kind !== "custom" || pending.size === 0) return;
    addTitlesRef.current([feed.id], [...pending]);
    pendingAddIdsRef.current = new Set();
    setPendingAddIds(new Set());
  }, [feed.id, feed.kind]);
  const closeCustomMode = useCallback(() => {
    if (customMode === "add") commitPendingAdds();
    setCustomMode(null);
    setCustomAddQuery("");
    if (customMode === "add" && customAddHistoryEntryRef.current) {
      customAddHistoryEntryRef.current = false;
      window.history.back();
    }
  }, [commitPendingAdds, customMode]);

  useEffect(() => {
    if (customMode !== "add") return;
    if (!customAddHistoryEntryRef.current) {
      window.history.pushState({ ...window.history.state, aeonCustomAdd: feed.id }, "", window.location.href);
      customAddHistoryEntryRef.current = true;
    }
    const handleBack = () => {
      if (!customAddHistoryEntryRef.current) return;
      customAddHistoryEntryRef.current = false;
      if (customAddQueryRef.current.trim()) {
        customAddQueryRef.current = "";
        setCustomAddQuery("");
        window.history.pushState({ ...window.history.state, aeonCustomAdd: feed.id }, "", window.location.href);
        customAddHistoryEntryRef.current = true;
        return;
      }
      commitPendingAdds();
      setCustomMode(null);
    };
    window.addEventListener("popstate", handleBack);
    return () => window.removeEventListener("popstate", handleBack);
  }, [commitPendingAdds, customMode, feed.id]);

  useEffect(() => () => {
    if (customModeRef.current === "add" && pendingAddIdsRef.current.size > 0 && feed.kind === "custom") {
      addTitlesRef.current([feed.id], [...pendingAddIdsRef.current]);
    }
  }, [feed.id, feed.kind]);

  useEffect(() => {
    if (customMode !== "rearrange") return;
    const pager = document.querySelector<HTMLElement>(".feed-pager");
    pager?.classList.add("custom-rearrange-lock");
    return () => pager?.classList.remove("custom-rearrange-lock");
  }, [customMode]);
  useEffect(() => {
    if (feed.kind !== "custom") return;
    const startRearrange = (event: Event) => {
      const requestedFeedId = (event as CustomEvent<{ feedId?: string }>).detail?.feedId;
      if (requestedFeedId !== feed.id) return;
      setCustomActionOpen(false);
      setLocalSearchOpen(false);
      setCustomMode("rearrange");
    };
    window.addEventListener("aeon:rearrange-custom-feed", startRearrange);
    return () => window.removeEventListener("aeon:rearrange-custom-feed", startRearrange);
  }, [feed.id, feed.kind]);
  return (
    <>
      <section className="section feed-summary-section">
        <div
          className={`feed-summary-card ${titleExpanded || descriptionExpanded ? "expanded" : ""}`}
          onDoubleClick={() => feed.kind === "custom" ? setCustomActionOpen(true) : setLocalSearchOpen(true)}
        >
          <FeedBarCoverWash items={query.items.slice(0, 3)} />
          <div className="feed-summary-content">
            <button
              className={`feed-title-button ${titleCanExpand ? "expandable" : ""}`}
              type="button"
              onClick={() => {
                const now = performance.now();
                if (onEditFeed && now - lastTitleTapRef.current < 320) {
                  lastTitleTapRef.current = 0;
                  onEditFeed(feed);
                  return;
                }
                lastTitleTapRef.current = now;
                if (titleCanExpand) setTitleExpanded((expanded) => !expanded);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              aria-expanded={titleCanExpand ? titleExpanded : undefined}
              aria-disabled={!titleCanExpand}
            >
              <FitSingleLineTitle text={feed.name} expanded={titleExpanded} maxChars={FEED_TITLE_EXPANDED_MAX} />
            </button>
            <div className={`feed-summary-lower ${hasDescription ? "" : "empty"}`}>
              {hasDescription ? (
                <button
                  className={`feed-description-button ${descriptionCanExpand ? "expandable" : ""}`}
                  type="button"
                  onClick={() => setDescriptionExpanded((expanded) => !expanded)}
                  aria-expanded={descriptionCanExpand ? descriptionExpanded : undefined}
                >
                  <span className={`feed-description-text ${descriptionExpanded ? "expanded" : ""}`}>{descriptionText}</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
      {localSearchOpen || customMode === "add" ? (
        <div className="feed-local-search">
          <input
            className="input"
            type="search"
            ref={customMode === "add" ? addSearchInputRef : undefined}
            value={customMode === "add" ? customAddQuery : localSearchQuery}
            onChange={(event) => customMode === "add" ? setCustomAddQuery(event.target.value) : setLocalSearchQuery(event.target.value)}
            placeholder={customMode === "add" ? "Find titles to add" : "Search this feed"}
            name={customMode === "add" ? "aeon-add-title-search" : "aeon-feed-search"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="search"
            enterKeyHint="search"
            autoFocus
          />
          <span className="feed-local-search-count">{customMode === "add" ? `${pendingAddIds.size} selected` : `${displayedItems.length} results`}</span>
          <button
            className="icon-button"
            type="button"
            onClick={() => {
              if (customMode === "add") {
                if (customAddQuery.trim()) {
                  customAddQueryRef.current = "";
                  setCustomAddQuery("");
                } else {
                  closeCustomMode();
                }
                return;
              }
              setLocalSearchQuery("");
              setLocalSearchOpen(false);
            }}
            aria-label={customMode === "add" ? "Back from title search" : "Close feed search"}
          >
            <X size={18} />
          </button>
        </div>
      ) : null}
      {customMode === "add" ? (
        <CustomAddResults
          items={addResults}
          existingIds={existingCustomIds}
          selectedIds={pendingAddIds}
          onToggle={(id) => {
            if (existingCustomIds.has(id)) return;
            setPendingAddIds((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id); else next.add(id);
              pendingAddIdsRef.current = next;
              return next;
            });
          }}
        />
      ) : customMode === "rearrange" ? (
        <CustomFeedReorderGrid feed={feed} items={displayedItems} onDone={closeCustomMode} />
      ) : (
        <TitleCollection
          items={displayedItems}
          feed={feed}
          history={store.history}
          latestDate={store.syncMeta?.historyLastDate}
          rankById={originalRanks}
        />
      )}
      <BottomDrawer title="MY LIST actions" open={customActionOpen} onOpenChange={setCustomActionOpen}>
        <div className="custom-feed-action-list">
          <button type="button" onClick={() => { setCustomActionOpen(false); setLocalSearchOpen(true); }}><Search size={18} /><span><strong>Search in feed</strong><small>Keep the list's original ranks.</small></span></button>
          <button type="button" onClick={() => { setCustomActionOpen(false); pendingAddIdsRef.current = new Set(); setPendingAddIds(new Set()); setCustomMode("add"); }}><Plus size={18} /><span><strong>Add to feed</strong><small>Search the full catalogue.</small></span></button>
        </div>
      </BottomDrawer>
    </>
  );
}

function CustomAddResults({
  items,
  existingIds,
  selectedIds,
  onToggle,
}: {
  items: SeriesCatalog[];
  existingIds: ReadonlySet<number>;
  selectedIds: ReadonlySet<number>;
  onToggle: (id: number) => void;
}) {
  if (items.length === 0) return <div className="empty-state"><Search size={26} /><strong>Search the catalogue</strong><span className="muted">Type at least two characters to find titles.</span></div>;
  return <div className="title-grid columns-3 density-standard custom-add-grid" style={{ "--grid-columns": 3 } as React.CSSProperties}>
    {items.map((series) => {
      const existing = existingIds.has(series.id);
      const selected = existing || selectedIds.has(series.id);
      return <button className={`custom-add-card ${selected ? "selected" : ""}`} type="button" key={series.id} onClick={() => onToggle(series.id)} aria-pressed={selected} aria-disabled={existing}>
        <div className="poster-shell"><Cover series={series} />{selected ? <span className="custom-add-check"><Check size={18} /></span> : null}</div>
        <span className="title-name">{visibleTitle(series)}</span>
        {existing ? <small>Already added</small> : null}
      </button>;
    })}
  </div>;
}

function CustomFeedReorderGrid({ feed, items, onDone }: { feed: Feed; items: SeriesCatalog[]; onDone: () => void }) {
  const store = useAppStore();
  const [orderedIds, setOrderedIds] = useState(() => items.map((item) => item.id));
  const orderedIdsRef = useRef(items.map((item) => item.id));
  const [dragItem, setDragItem] = useState<SeriesCatalog | null>(null);
  const [dragStartPoint, setDragStartPoint] = useState({ x: 0, y: 0 });
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const draggingIdRef = useRef<number | null>(null);
  const overIdRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverTargetIdRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerYRef = useRef(0);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const orderedItems = orderedIds.flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item] : [];
  });
  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = null;
  }, []);
  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);
  const updateAutoScroll = useCallback((clientY: number) => {
    pointerYRef.current = clientY;
    if (autoScrollFrameRef.current !== null) return;
    const pane = document.querySelector<HTMLElement>(`.feed-pager-panel[data-feed-id="${feed.id}"] .feed-pane-scroll`);
    if (!pane) return;
    const tick = () => {
      const rect = pane.getBoundingClientRect();
      const topPressure = Math.max(0, Math.min(1, (rect.top + 82 - pointerYRef.current) / 82));
      const bottomPressure = Math.max(0, Math.min(1, (pointerYRef.current - (rect.bottom - 82)) / 82));
      const speed = bottomPressure > 0 ? Math.max(3, bottomPressure * 16) : topPressure > 0 ? -Math.max(3, topPressure * 16) : 0;
      if (!speed || draggingIdRef.current == null) {
        autoScrollFrameRef.current = null;
        return;
      }
      pane.scrollTop += speed;
      autoScrollFrameRef.current = requestAnimationFrame(tick);
    };
    autoScrollFrameRef.current = requestAnimationFrame(tick);
  }, [feed.id]);
  useEffect(() => () => {
    stopAutoScroll();
    clearHoverTimer();
  }, [clearHoverTimer, stopAutoScroll]);

  const moveDraggedId = useCallback((current: number[], draggedId: number, targetId: number) => {
    const from = current.indexOf(draggedId);
    const to = current.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return current;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }, []);

  const finishDrag = useCallback(() => {
    const fromId = draggingIdRef.current;
    const toId = overIdRef.current;
    clearHoverTimer();
    if (fromId != null) {
      const next = toId != null ? moveDraggedId(orderedIdsRef.current, fromId, toId) : orderedIdsRef.current;
      orderedIdsRef.current = next;
      setOrderedIds(next);
      store.reorderCustomFeedTitles(feed.id, next);
    }
    document.querySelectorAll(".custom-reorder-card.drag-over").forEach((element) => element.classList.remove("drag-over"));
    draggingIdRef.current = null;
    overIdRef.current = null;
    hoverTargetIdRef.current = null;
    activePointerIdRef.current = null;
    setDragItem(null);
    stopAutoScroll();
  }, [clearHoverTimer, feed.id, moveDraggedId, stopAutoScroll, store]);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (draggingIdRef.current == null) return;
    if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${clientX + 12}px, ${clientY + 12}px, 0)`;
    updateAutoScroll(clientY);
    const grid = document.querySelector<HTMLElement>(`.feed-pager-panel[data-feed-id="${feed.id}"] .custom-reorder-grid`);
    const gridRect = grid?.getBoundingClientRect();
    const pane = document.querySelector<HTMLElement>(`.feed-pager-panel[data-feed-id="${feed.id}"] .feed-pane-scroll`);
    const paneRect = pane?.getBoundingClientRect();
    const inAutoScrollZone = Boolean(paneRect && (clientY < paneRect.top + 82 || clientY > paneRect.bottom - 82));
    const outsideGrid = !gridRect
      || clientX < gridRect.left
      || clientX > gridRect.right
      || clientY < Math.max(10, gridRect.top)
      || clientY > Math.min(window.innerHeight - 10, gridRect.bottom);
    if (outsideGrid || inAutoScrollZone) {
      clearHoverTimer();
      hoverTargetIdRef.current = null;
      document.querySelectorAll(".custom-reorder-card.drag-over").forEach((element) => element.classList.remove("drag-over"));
      return;
    }
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-reorder-id]");
    const targetId = Number(target?.dataset.reorderId);
    if (!Number.isSafeInteger(targetId)) return;
    document.querySelectorAll(".custom-reorder-card.drag-over").forEach((element) => element.classList.remove("drag-over"));
    target?.classList.add("drag-over");
    overIdRef.current = targetId;
    if (hoverTargetIdRef.current === targetId) return;
    hoverTargetIdRef.current = targetId;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      const draggedId = draggingIdRef.current;
      if (draggedId == null) return;
      setOrderedIds((current) => {
        const next = moveDraggedId(current, draggedId, targetId);
        orderedIdsRef.current = next;
        return next;
      });
      hoverTimerRef.current = null;
    }, 420);
  }, [clearHoverTimer, feed.id, moveDraggedId, updateAutoScroll]);

  useEffect(() => {
    if (!dragItem) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      event.preventDefault();
      moveDrag(event.clientX, event.clientY);
    };
    const onEnd = (event: PointerEvent) => {
      if (event.pointerId !== activePointerIdRef.current) return;
      finishDrag();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [dragItem, finishDrag, moveDrag]);

  return <div className="custom-reorder-mode">
    <div className="custom-reorder-toolbar"><span>Drag a handle to place visible titles.</span></div>
    <div className={`title-grid columns-${feed.view.gridColumns} density-${feed.view.gridDensity} custom-reorder-grid`} style={{ "--grid-columns": feed.view.gridColumns, "--desktop-grid-columns": resolvedDesktopGridColumns(feed.view) } as React.CSSProperties}>
      {orderedItems.map((series) => <article className={`custom-reorder-card ${dragItem?.id === series.id ? "drag-source" : ""}`} key={series.id} data-reorder-id={series.id}>
        <div className="poster-shell"><Cover series={series} /></div>
        <span className="title-name">{visibleTitle(series)}</span>
        <button className="custom-title-drag-handle" type="button" aria-label={`Move ${visibleTitle(series)}`}
          onPointerDown={(event) => {
            event.preventDefault();
            activePointerIdRef.current = event.pointerId;
            draggingIdRef.current = series.id;
            overIdRef.current = series.id;
            setDragStartPoint({ x: event.clientX + 12, y: event.clientY + 12 });
            setDragItem(series);
            updateAutoScroll(event.clientY);
          }}
        ><GripVertical size={16} /></button>
      </article>)}
    </div>
    {dragItem ? (
      <div
        className="custom-title-drag-ghost"
        ref={ghostRef}
        style={{ transform: `translate3d(${dragStartPoint.x}px, ${dragStartPoint.y}px, 0)` }}
      >
        <img src={dragItem.cover ?? ""} alt="" />
      </div>
    ) : null}
    <div className="custom-reorder-dock">
      <button className="button primary" type="button" onClick={onDone}><Check size={17} /> Done</button>
    </div>
  </div>;
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
      <TitleCollectionSkeleton columns={feed.view.gridColumns} />
    </section>
  );
}

function TitleCollection({
  items,
  feed,
  history,
  latestDate,
  rankById,
  loading = false,
}: {
  items: SeriesCatalog[];
  feed: Feed;
  history: HistoryMap;
  latestDate?: string | null;
  rankById?: ReadonlyMap<number, number>;
  loading?: boolean;
}) {
  const pageSize = feed.view.gridColumns >= 5 ? 60 : feed.view.gridColumns === 4 ? 72 : 120;
  const countKey = `manhwa-visible-count:${feed.id}:${feed.view.gridColumns}`;
  const [visibleCount, setVisibleCount] = useState(() => Number(sessionStorage.getItem(countKey)) || pageSize);
  useEffect(() => {
    const saved = Number(sessionStorage.getItem(countKey)) || pageSize;
    setVisibleCount(Math.max(pageSize, Math.min(saved, Math.max(pageSize, items.length))));
  }, [countKey, items.length, pageSize]);
  useEffect(() => {
    sessionStorage.setItem(countKey, String(visibleCount));
  }, [countKey, visibleCount]);
  const visibleItems = items.slice(0, visibleCount);
  const metricWindow = useMemo(() => resolveRollingWindow(feed.filters.rolling, latestDate), [feed.filters.rolling, latestDate]);

  if (loading) {
    return <TitleCollectionSkeleton columns={feed.view.gridColumns} />;
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <Filter size={28} />
        <strong>{feed.kind === "custom" && feed.titleIds.length === 0 ? "No titles in this list yet" : "No titles matched this feed"}</strong>
        <span className="muted">
          {feed.kind === "custom"
            ? feed.titleIds.length === 0
              ? "Double-tap the outer header card and choose Add to feed."
              : "The saved filters currently hide every title in this list."
            : "Loosen filters, include gated tag families if intended, or switch source mode."}
        </span>
      </div>
    );
  }
  return (
    <>
      <div
        className={`title-grid columns-${feed.view.gridColumns} density-${feed.view.gridDensity}`}
        style={{
          "--grid-columns": feed.view.gridColumns,
          "--desktop-grid-columns": resolvedDesktopGridColumns(feed.view),
        } as React.CSSProperties}
      >
        {visibleItems.map((series, index) => (
          <MemoTitleCard
            key={series.id}
            series={series}
            rank={rankById?.get(series.id) ?? index + 1}
            view={feed.view}
            feed={feed}
            history={history}
            latestDate={latestDate}
            metricWindow={metricWindow}
          />
        ))}
      </div>
      <LoadMore visibleCount={visibleCount} total={items.length} onMore={() => setVisibleCount((count) => count + pageSize)} />
    </>
  );
}

const MemoSearchTitleCollection = memo(TitleCollection);

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
        <img src={series.cover} alt="" loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : "auto"} />
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
  feed,
  history,
  latestDate,
  metricWindow,
}: {
  series: SeriesCatalog;
  rank: number;
  view: FeedViewSettings;
  feed: Feed;
  history: HistoryMap;
  latestDate?: string | null;
  metricWindow?: { from: string; to: string } | null;
}) {
  const title = visibleTitle(series);
  const selection = useTitleSelection();
  const longPressTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);
  const subscribeToSelected = useCallback((listener: () => void) => selection.store.subscribe(series.id, listener), [selection.store, series.id]);
  const getSelected = useCallback(() => selection.store.isSelected(series.id), [selection.store, series.id]);
  const selected = useSyncExternalStore(subscribeToSelected, getSelected, getSelected);
  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    pointerStartRef.current = null;
  };
  return (
    <div className={`title-card-wrap ${selected ? "selected" : ""}`}>
      <a
        href={`#/title/${series.id}`}
        className="title-card"
        data-testid="title-card"
        data-series-id={series.id}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          longPressedRef.current = false;
          pointerStartRef.current = { x: event.clientX, y: event.clientY };
          longPressTimerRef.current = window.setTimeout(() => {
            longPressedRef.current = true;
            selection.begin(feed, series.id);
            if (navigator.vibrate) navigator.vibrate(20);
          }, 320);
        }}
        onPointerMove={(event) => {
          const start = pointerStartRef.current;
          if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 12) return;
          cancelLongPress();
        }}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onContextMenu={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          if (longPressedRef.current) {
            event.preventDefault();
            event.stopPropagation();
            longPressedRef.current = false;
            return;
          }
          const { mode } = selection.store.getSnapshot();
          if (mode) {
            event.preventDefault();
            event.stopPropagation();
            const canSelect = mode.kind === "collect" ? feed.kind === "logic" : mode.feedId === feed.id;
            if (canSelect) selection.toggle(feed, series.id);
            return;
          }
          prepareHomeTitleNavigation(feed);
        }}
      >
        <div className="poster-shell">
          <Cover series={series} priority={rank <= 18} />
          {view.visible.rank && <span className="rank">{rank}</span>}
          <div className="poster-metrics">
            <MemoTitleMetrics series={series} view={view} compact history={history} latestDate={latestDate} metricWindow={metricWindow} />
          </div>
          {selected ? <span className="title-selection-mark"><Check size={19} /></span> : null}
        </div>
        <div className="title-meta">
          <span className="title-name">{title}</span>
        </div>
      </a>
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
  prev.metricWindow?.from === next.metricWindow?.from &&
  prev.metricWindow?.to === next.metricWindow?.to
);

function TitleCollectionSkeleton({ columns }: { columns: 1 | 2 | 3 | 4 | 5 }) {
  const count = columns >= 5 ? 10 : columns === 4 ? 12 : 9;
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
  const metricSlots: MetricId[] = useMemo(() => (view.metricSlots ?? []).slice(0, 3), [view.metricSlots]);
  const values = useMemo(
    () => {
      if (metricSlots.length === 0) return [];
      return metricSlots
        .map((metric) => ({ metric, value: formatFeedMetricValue(series, metric, history, latestDate, metricWindow) }))
        .filter((item) => item.value !== "n/a");
    },
    [history, latestDate, metricSlots, metricWindow, series],
  );
  if (metricSlots.length === 0) return null;
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
  const navigate = useNavigate();
  const [editorFeed, setEditorFeed] = useState<Feed | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overSegmentId, setOverSegmentId] = useState<string | null>(null);
  const [draggingSegmentId, setDraggingSegmentId] = useState<string | null>(null);
  const [overDraggingSegmentId, setOverDraggingSegmentId] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{ feed: Feed; covers: SeriesCatalog[]; x: number; y: number } | null>(null);
  const [segmentGhost, setSegmentGhost] = useState<{ segment: FeedSegment; count: number; x: number; y: number } | null>(null);
  const [renamingSegmentId, setRenamingSegmentId] = useState<string | null>(null);
  const [segmentNameDraft, setSegmentNameDraft] = useState("");
  const [segmentEditMode, setSegmentEditMode] = useState(false);
  const [selectedLibrary, setSelectedLibrary] = useState<FeedLibraryKind>(() =>
    sessionStorage.getItem(FEEDS_PAGE_LIBRARY_SESSION_KEY) === "custom" ? "custom" : "logic",
  );
  const [draggingLibrary, setDraggingLibrary] = useState<FeedLibraryKind | null>(null);
  const [deleteSegmentTarget, setDeleteSegmentTarget] = useState<{ segment: FeedSegment; count: number } | null>(null);
  const [coverMap, setCoverMap] = useState<Map<string, SeriesCatalog[]>>(new Map());
  const [coversLoading, setCoversLoading] = useState(true);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollYRef = useRef(0);
  const feedsById = useMemo(() => new Map(store.feeds.map((feed) => [feed.id, feed])), [store.feeds]);
  const { searchAdultTags, searchRelationshipTags } = store.settings;
  const visibleSegments = useMemo(
    () => store.feedSegments.filter((segment) => segment.library === selectedLibrary && isBuiltInSensitiveSegmentVisible(segment, { searchAdultTags, searchRelationshipTags })),
    [searchAdultTags, searchRelationshipTags, selectedLibrary, store.feedSegments],
  );

  useEffect(() => {
    sessionStorage.setItem(FEEDS_PAGE_LIBRARY_SESSION_KEY, selectedLibrary);
  }, [selectedLibrary]);

  const stopDragAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  const dragEdgeSpeed = useCallback((clientY: number) => {
    if (clientY < FEEDS_DRAG_EDGE_SIZE) {
      const pressure = (FEEDS_DRAG_EDGE_SIZE - clientY) / FEEDS_DRAG_EDGE_SIZE;
      return -Math.max(4, Math.round(pressure * FEEDS_DRAG_MAX_SCROLL_SPEED));
    }
    const bottomEdge = window.innerHeight - FEEDS_DRAG_EDGE_SIZE;
    if (clientY > bottomEdge) {
      const pressure = (clientY - bottomEdge) / FEEDS_DRAG_EDGE_SIZE;
      return Math.max(4, Math.round(pressure * FEEDS_DRAG_MAX_SCROLL_SPEED));
    }
    return 0;
  }, []);

  const updateDragAutoScroll = useCallback((clientY: number) => {
    autoScrollYRef.current = clientY;
    if (dragEdgeSpeed(clientY) === 0) {
      stopDragAutoScroll();
      return;
    }
    if (autoScrollFrameRef.current !== null) return;
    const tick = () => {
      const speed = dragEdgeSpeed(autoScrollYRef.current);
      if (speed === 0) {
        autoScrollFrameRef.current = null;
        return;
      }
      window.scrollBy({ top: speed, behavior: "auto" });
      autoScrollFrameRef.current = requestAnimationFrame(tick);
    };
    autoScrollFrameRef.current = requestAnimationFrame(tick);
  }, [dragEdgeSpeed, stopDragAutoScroll]);

  useEffect(() => {
    const target = Number(sessionStorage.getItem(FEEDS_SCROLL_KEY));
    const firstFrame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (Number.isFinite(target) && target > 0) window.scrollTo({ top: target, behavior: "auto" });
      });
    });
    const save = () => sessionStorage.setItem(FEEDS_SCROLL_KEY, String(window.scrollY));
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(firstFrame);
      save();
      window.removeEventListener("scroll", save);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let handle: number | null = null;
    setCoversLoading(true);
    const visibleFeedIds = new Set(visibleSegments.flatMap((segment) => segment.feedIds));
    const pendingFeeds = store.feeds.filter((feed) => feed.kind === selectedLibrary && visibleFeedIds.has(feed.id));
    const next = new Map<string, SeriesCatalog[]>();
    let index = 0;
    const processNextFeed = () => {
      if (cancelled) return;
      const feed = pendingFeeds[index];
      if (!feed) {
        setCoverMap(next);
        setCoversLoading(false);
        return;
      }
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
      index += 1;
      handle = window.setTimeout(processNextFeed, 0);
    };
    handle = window.setTimeout(processNextFeed, 24);
    return () => {
      cancelled = true;
      if (handle !== null) window.clearTimeout(handle);
    };
  }, [selectedLibrary, store.catalog, store.feeds, store.history, store.labels, store.settings, store.syncMeta, store.tags, visibleSegments]);

  useEffect(() => stopDragAutoScroll, [stopDragAutoScroll]);

  return (
    <div className="page">
      <div className="row feeds-page-header">
        <h1>FEEDS</h1>
        <span className="spacer" />
        <button className="button ghost compact-action" type="button" onClick={() => store.createFeedSegment(undefined, selectedLibrary)} aria-label="Create segment">
          <Plus size={16} /> Segment
        </button>
        <button
          className={`icon-button segment-edit-toggle ${segmentEditMode ? "active" : ""}`}
          type="button"
          aria-label={segmentEditMode ? "Finish editing segments" : "Edit segments"}
          aria-pressed={segmentEditMode}
          title={segmentEditMode ? "Finish editing segments" : "Edit segments"}
          onClick={() => {
            setSegmentEditMode((current) => !current);
            setRenamingSegmentId(null);
          }}
        >
          <Pencil size={18} />
        </button>
        <button className="icon-button" type="button" onClick={() => setEditorFeed(selectedLibrary === "custom" ? createCustomFeed("New List") : createFeed("New Feed"))} aria-label={selectedLibrary === "custom" ? "Create custom feed" : "Create feed"}>
          <Plus size={18} />
        </button>
      </div>
      <div className={`feed-library-selector ${segmentEditMode ? "editing" : ""}`} aria-label="Feed libraries">
        {store.feedLibraryOrder.map((library) => (
          <button
            className={`feed-library-option ${selectedLibrary === library ? "active" : ""} ${draggingLibrary === library ? "dragging" : ""}`}
            type="button"
            key={library}
            onClick={() => setSelectedLibrary(library)}
            onPointerDown={(event) => {
              if (!segmentEditMode) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDraggingLibrary(library);
            }}
            onPointerMove={(event) => {
              if (!segmentEditMode || !draggingLibrary) return;
              const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-feed-library]");
              const targetLibrary = target?.dataset.feedLibrary as FeedLibraryKind | undefined;
              if (targetLibrary && targetLibrary !== draggingLibrary) store.moveFeedLibrary(draggingLibrary, targetLibrary);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              setDraggingLibrary(null);
            }}
            onPointerCancel={() => setDraggingLibrary(null)}
            data-feed-library={library}
            aria-pressed={selectedLibrary === library}
          >
            {segmentEditMode ? <GripVertical size={15} /> : null}
            <span>{library === "logic" ? "LIST" : "MY LIST"}</span>
          </button>
        ))}
      </div>
      <div className="feed-segment-list">
        {visibleSegments.map((segment) => {
          const segmentFeeds = segment.feedIds.flatMap((feedId) => {
            const feed = feedsById.get(feedId);
            return feed ? [feed] : [];
          });
          const isUnsegmented = segment.id === UNSEGMENTED_FEED_SEGMENT_ID || segment.id === MY_LIST_UNSEGMENTED_FEED_SEGMENT_ID;
          const canDelete = !isUnsegmented && segmentFeeds.length === 0;
          const canDeleteWithFeeds = !isUnsegmented && segmentFeeds.length > 0;
          const isRenaming = renamingSegmentId === segment.id;
          return (
            <section
              key={segment.id}
              className={`feed-segment ${segment.collapsed ? "collapsed" : ""} ${draggingSegmentId === segment.id ? "dragging" : ""} ${overDraggingSegmentId === segment.id ? "drag-over" : ""} ${overSegmentId === segment.id ? "feed-over" : ""}`}
              data-segment-id={segment.id}
              style={segmentColorStyle(segment.id)}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
                store.updateFeedSegment(segment.id, { collapsed: !segment.collapsed });
              }}
            >
              <div className={`feed-segment-header ${segmentEditMode ? "editing" : ""}`}>
                <button
                  className="feed-segment-drag-handle"
                  type="button"
                  aria-label={`Move segment ${segment.name}`}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDraggingSegmentId(segment.id);
                    setOverDraggingSegmentId(segment.id);
                    setSegmentGhost({ segment, count: segmentFeeds.length, x: event.clientX, y: event.clientY });
                    updateDragAutoScroll(event.clientY);
                  }}
                  onPointerMove={(event) => {
                    if (!draggingSegmentId && !segmentGhost) return;
                    setSegmentGhost((current) => current && { ...current, x: event.clientX, y: event.clientY });
                    updateDragAutoScroll(event.clientY);
                    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-segment-id]");
                    if (target?.dataset.segmentId) setOverDraggingSegmentId(target.dataset.segmentId);
                  }}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                    if (draggingSegmentId && overDraggingSegmentId) store.moveFeedSegment(draggingSegmentId, overDraggingSegmentId);
                    setDraggingSegmentId(null);
                    setOverDraggingSegmentId(null);
                    setSegmentGhost(null);
                    stopDragAutoScroll();
                  }}
                  onPointerCancel={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                    setDraggingSegmentId(null);
                    setOverDraggingSegmentId(null);
                    setSegmentGhost(null);
                    stopDragAutoScroll();
                  }}
                >
                  <GripVertical size={18} />
                </button>
                {segmentEditMode && (
                  <button
                    className="feed-segment-rename"
                    type="button"
                    disabled={isUnsegmented}
                    onClick={() => {
                      if (isUnsegmented) return;
                      setRenamingSegmentId(segment.id);
                      setSegmentNameDraft(segment.name);
                    }}
                    aria-label={`Rename ${segment.name}`}
                  >
                    <Pencil size={17} />
                  </button>
                )}
                {isRenaming && !isUnsegmented ? (
                  <input
                    className="input feed-segment-name-input"
                    value={segmentNameDraft}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    onChange={(event) => setSegmentNameDraft(event.target.value)}
                    onBlur={() => {
                      const name = segmentNameDraft.trim();
                      if (name) store.updateFeedSegment(segment.id, { name });
                      setRenamingSegmentId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") setRenamingSegmentId(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <button
                    className="feed-segment-title"
                    type="button"
                    onClick={() => store.updateFeedSegment(segment.id, { collapsed: !segment.collapsed })}
                    aria-expanded={!segment.collapsed}
                  >
                    <span>{segment.name}</span>
                    <b>{segmentFeeds.length}</b>
                    {segment.collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                  </button>
                )}
                <div className="feed-segment-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => store.updateFeedSegment(segment.id, { hiddenFromHome: !segment.hiddenFromHome })}
                    aria-label={segment.hiddenFromHome ? `Show ${segment.name} in Home` : `Hide ${segment.name} from Home`}
                  >
                    {segment.hiddenFromHome ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                  {segmentEditMode && (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => downloadSegmentBackup(segment, segmentFeeds)}
                      aria-label={`Download ${segment.name}`}
                    >
                      <Download size={18} />
                    </button>
                  )}
                  {segmentEditMode && canDelete && (
                    <button className="icon-button danger" type="button" onClick={() => store.deleteFeedSegment(segment.id)} aria-label={`Delete ${segment.name}`}>
                      <Trash2 size={18} />
                    </button>
                  )}
                  {segmentEditMode && canDeleteWithFeeds && (
                    <button
                      className="icon-button danger"
                      type="button"
                      onClick={() => setDeleteSegmentTarget({ segment, count: segmentFeeds.length })}
                      aria-label={`Delete ${segment.name} with feeds`}
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
              {!segment.collapsed && (
                <div className="feed-cover-grid">
                  {segmentFeeds.map((feed) => {
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
                          store.openFeedInHome(feed.id, segment.hiddenFromHome ? segment.id : null);
                          navigate("/");
                        }}
                        onEdit={() => setEditorFeed(feed)}
                        onDelete={() => store.deleteFeed(feed.id)}
                        onDragStart={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setDraggingId(feed.id);
                          setOverId(feed.id);
                          setOverSegmentId(segment.id);
                          setDragGhost({ feed, covers, x: event.clientX, y: event.clientY });
                          updateDragAutoScroll(event.clientY);
                        }}
                        onDragMove={(event) => {
                          if (!draggingId && !dragGhost) return;
                          setDragGhost((current) => current && { ...current, x: event.clientX, y: event.clientY });
                          updateDragAutoScroll(event.clientY);
                          const element = document.elementFromPoint(event.clientX, event.clientY);
                          const targetFeed = element?.closest<HTMLElement>("[data-feed-id]");
                          const targetSegment = element?.closest<HTMLElement>("[data-segment-id]");
                          if (targetFeed?.dataset.feedId) setOverId(targetFeed.dataset.feedId);
                          else setOverId(null);
                          if (targetSegment?.dataset.segmentId) setOverSegmentId(targetSegment.dataset.segmentId);
                        }}
                        onDragEnd={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                          if (draggingId && overId) store.moveFeed(draggingId, overId);
                          else if (draggingId && overSegmentId) store.moveFeedToSegment(draggingId, overSegmentId);
                          setDraggingId(null);
                          setOverId(null);
                          setOverSegmentId(null);
                          setDragGhost(null);
                          stopDragAutoScroll();
                        }}
                      />
                    );
                  })}
                  {segmentFeeds.length === 0 && (
                    <div className="feed-segment-empty">Drop feeds here</div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {dragGhost && (
        <div className="feed-drag-ghost" style={{ left: dragGhost.x, top: dragGhost.y }}>
          <MosaicCover items={dragGhost.covers} title={dragGhost.feed.name} />
          <strong>{dragGhost.feed.name}</strong>
        </div>
      )}
      {segmentGhost && (
        <div className="segment-drag-ghost" style={{ left: segmentGhost.x, top: segmentGhost.y }}>
          <GripVertical size={16} />
          <strong>{segmentGhost.segment.name}</strong>
          <span>{segmentGhost.count} feeds</span>
        </div>
      )}
      <BottomDrawer title={editorFeed?.name ?? "Feed"} open={Boolean(editorFeed)} onOpenChange={(open) => !open && setEditorFeed(null)}>
        {editorFeed && (
          <FeedSettingsEditor
            key={editorFeed.id}
            feed={editorFeed}
            onCancel={() => setEditorFeed(null)}
            onSave={(feed) => {
              store.upsertFeed(feed);
              setEditorFeed(null);
            }}
          />
        )}
      </BottomDrawer>
      <BottomDrawer
        title="Delete segment"
        open={Boolean(deleteSegmentTarget)}
        onOpenChange={(open) => !open && setDeleteSegmentTarget(null)}
      >
        {deleteSegmentTarget && (
          <div className="setting-stack">
            <div>
              <strong>Delete {deleteSegmentTarget.segment.name}?</strong>
              <p className="muted">
                This will also delete {deleteSegmentTarget.count.toLocaleString()} feed{deleteSegmentTarget.count === 1 ? "" : "s"} inside it.
              </p>
            </div>
            <div className="toolbar">
              <button className="button" type="button" onClick={() => setDeleteSegmentTarget(null)}>
                Cancel
              </button>
              <span className="spacer" />
              <button
                className="button danger"
                type="button"
                onClick={() => {
                  store.deleteFeedSegmentWithFeeds(deleteSegmentTarget.segment.id);
                  setDeleteSegmentTarget(null);
                }}
              >
                <Trash2 size={16} /> Delete segment and feeds
              </button>
            </div>
          </div>
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
  const [menuAlign, setMenuAlign] = useState<"left" | "right">("right");
  const [shareCopied, setShareCopied] = useState(false);
  useEffect(() => {
    if (!shareCopied) return;
    const timer = window.setTimeout(() => setShareCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [shareCopied]);
  const toggleMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!menuOpen) {
      const card = event.currentTarget.closest<HTMLElement>(".feed-cover-card");
      if (card) {
        const cardRect = card.getBoundingClientRect();
        setMenuAlign(cardRect.right - 4 - 168 < 8 ? "left" : "right");
      }
    }
    setMenuOpen((open) => !open);
  };
  return (
    <article className={`feed-cover-card ${dragging ? "dragging" : ""} ${over ? "drag-over" : ""}`} data-feed-id={feed.id}>
      <button className="feed-cover-link" type="button" onClick={onOpen}>
        {loading ? <div className="mosaic-cover mosaic-loading" aria-hidden="true" /> : <MosaicCover items={covers} title={feed.name} />}
        <strong className="feed-card-title">{feed.name}</strong>
      </button>
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
      <button className="feed-card-menu-button" type="button" onClick={toggleMenu} aria-label={`${feed.name} menu`}>
        <EllipsisVertical size={18} />
      </button>
      {menuOpen && (
        <div className={`popover-menu card-menu align-${menuAlign}`}>
          <button type="button" onClick={() => { onEdit(); setMenuOpen(false); }}><SlidersHorizontal size={16} /> Edit</button>
          <SharePanelButton
            payload={{ kind: "feed", version: feed.kind === "custom" ? 3 : 2, feed }}
            label="Share"
            onCopied={() => {
              setMenuOpen(false);
              setShareCopied(true);
            }}
          />
          <button className="danger-text" type="button" onClick={onDelete}><Trash2 size={16} /> Delete</button>
        </div>
      )}
      {shareCopied ? <div className="selection-result-toast" role="status">Link copied</div> : null}
    </article>
  );
}

function FeedSettingsEditor({ feed, onSave, onCancel }: { feed: Feed; onSave: (feed: Feed) => void; onCancel: () => void }) {
  if (feed.kind === "custom") return <CustomFeedSettingsEditor feed={feed} onSave={onSave} onCancel={onCancel} />;
  if (!isBuiltInDefaultFeed(feed)) return <FeedEditor feed={feed} onSave={onSave} onCancel={onCancel} />;
  return <DefaultFeedSettingsEditor feed={feed} onSave={onSave} onCancel={onCancel} />;
}

function DefaultFeedSettingsEditor({ feed, onSave, onCancel }: { feed: Feed; onSave: (feed: Feed) => void; onCancel: () => void }) {
  const isDesktop = useDesktopLayout();
  const [view, setView] = useState<FeedViewSettings>(() => structuredClone(feed.view));
  const [statuses, setStatuses] = useState<string[]>(() =>
    feed.filters.statuses.filter((status) => status === "completed" || status === "hiatus"),
  );
  const savedMetricSlotsRef = useRef<MetricId[]>(feed.view.metricSlots.length ? [...feed.view.metricSlots] : ["fanFavouriteDiscoveryPercentile"]);
  const coverStatsVisible = view.metricSlots.length > 0;

  const setCoverStatsVisible = (visible: boolean) => {
    setView((current) => {
      if (visible) return { ...current, metricSlots: [...savedMetricSlotsRef.current] };
      if (current.metricSlots.length) savedMetricSlotsRef.current = [...current.metricSlots];
      return { ...current, metricSlots: [] };
    });
  };

  return (
    <div className="setting-stack default-feed-settings">
      <div className="field">
        <label>Grid columns</label>
        <div className="segmented compact-segments">
          {(isDesktop ? DESKTOP_GRID_OPTIONS : [1, 2, 3, 4, 5]).map((columns) => (
            <button
              className={`segment ${(isDesktop ? resolvedDesktopGridColumns(view) : view.gridColumns) === columns ? "active" : ""}`}
              type="button"
              key={columns}
              onClick={() => setView((current) => isDesktop
                ? { ...current, desktopGridColumns: columns as FeedViewSettings["desktopGridColumns"] }
                : { ...current, gridColumns: columns as FeedViewSettings["gridColumns"] })}
            >
              {columns}
            </button>
          ))}
        </div>
      </div>
      <ToggleRow
        label="Show rank"
        description="Show the title position on each cover."
        value={view.visible.rank}
        onChange={(rank) => setView((current) => ({ ...current, visible: { ...current.visible, rank } }))}
      />
      <ToggleRow
        label="Show cover stats"
        description="Show the feed's configured stat strip on covers."
        value={coverStatsVisible}
        onChange={setCoverStatsVisible}
      />
      <div className="field">
        <span className="small-label">Status</span>
        <p className="muted tiny">Leave both off to show every status.</p>
      </div>
      <ToggleRow
        label="Completed"
        description="Only include completed titles when selected."
        value={statuses.includes("completed")}
        onChange={(selected) => setStatuses((current) => selected
          ? [...current.filter((status) => status !== "completed"), "completed"]
          : current.filter((status) => status !== "completed"))}
      />
      <ToggleRow
        label="Hiatus"
        description="Only include titles on hiatus when selected."
        value={statuses.includes("hiatus")}
        onChange={(selected) => setStatuses((current) => selected
          ? [...current.filter((status) => status !== "hiatus"), "hiatus"]
          : current.filter((status) => status !== "hiatus"))}
      />
      <div className="toolbar">
        <button className="button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <span className="spacer" />
        <button
          className="button primary"
          type="button"
          onClick={() => onSave({ ...feed, view, filters: { ...feed.filters, statuses } })}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function CustomFeedSettingsEditor({ feed, onSave, onCancel }: { feed: Feed; onSave: (feed: Feed) => void; onCancel: () => void }) {
  const isDesktop = useDesktopLayout();
  const [draft, setDraft] = useState<Feed>(() => structuredClone(feed));
  const [advanced, setAdvanced] = useState(false);
  const savedMetricSlotsRef = useRef<MetricId[]>(feed.view.metricSlots.length ? [...feed.view.metricSlots] : ["fanFavouriteDiscoveryPercentile"]);
  const updateFilters = (patch: Partial<Feed["filters"]>) => setDraft((current) => ({ ...current, filters: { ...current.filters, ...patch } }));
  const updateView = (patch: Partial<FeedViewSettings>) => setDraft((current) => ({ ...current, view: { ...current.view, ...patch } }));
  const toggleStatus = (status: "completed" | "hiatus", selected: boolean) => updateFilters({
    statuses: selected
      ? [...draft.filters.statuses.filter((item) => item !== status), status]
      : draft.filters.statuses.filter((item) => item !== status),
  });
  const setCoverStatsVisible = (visible: boolean) => updateView({
    metricSlots: visible ? [...savedMetricSlotsRef.current] : [],
  });

  return (
    <div className="setting-stack custom-feed-settings">
      <div className="field">
        <label htmlFor="custom-feed-name">List name</label>
        <input id="custom-feed-name" className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="custom-feed-description">Description</label>
        <textarea id="custom-feed-description" className="textarea" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </div>
      <ToggleRow label="Show description" description="Show this text below the list name." value={draft.showDescription} onChange={(showDescription) => setDraft({ ...draft, showDescription })} />
      <div className="field">
        <label>Grid columns</label>
        <div className="segmented compact-segments">
          {(isDesktop ? DESKTOP_GRID_OPTIONS : [1, 2, 3, 4, 5]).map((columns) => (
            <button className={`segment ${(isDesktop ? resolvedDesktopGridColumns(draft.view) : draft.view.gridColumns) === columns ? "active" : ""}`} type="button" key={columns} onClick={() => updateView(isDesktop
              ? { desktopGridColumns: columns as FeedViewSettings["desktopGridColumns"] }
              : { gridColumns: columns as FeedViewSettings["gridColumns"] })}>
              {columns}
            </button>
          ))}
        </div>
      </div>
      <ToggleRow label="Show rank" description="Show each title's position on its cover." value={draft.view.visible.rank} onChange={(rank) => updateView({ visible: { ...draft.view.visible, rank } })} />
      <ToggleRow label="Show cover stats" description="Show the configured stat strip on covers." value={draft.view.metricSlots.length > 0} onChange={(visible) => {
        if (!visible && draft.view.metricSlots.length) savedMetricSlotsRef.current = [...draft.view.metricSlots];
        setCoverStatsVisible(visible);
      }} />
      <ToggleRow label="Completed" description="Only show completed titles when selected." value={draft.filters.statuses.includes("completed")} onChange={(selected) => toggleStatus("completed", selected)} />
      <ToggleRow label="Hiatus" description="Only show titles on hiatus when selected." value={draft.filters.statuses.includes("hiatus")} onChange={(selected) => toggleStatus("hiatus", selected)} />
      <div className="field">
        <label>New titles</label>
        <div className="segmented">
          {(["top", "bottom"] as const).map((placement) => <button className={`segment ${draft.newTitlePlacement === placement ? "active" : ""}`} type="button" key={placement} onClick={() => setDraft({ ...draft, newTitlePlacement: placement })}>{placement === "top" ? "Add to top" : "Add to bottom"}</button>)}
        </div>
      </div>
      <div className="field">
        <label>Non-AniList titles</label>
        <div className="segmented">
          {(["top", "bottom"] as const).map((placement) => <button className={`segment ${draft.nonAniListPlacement === placement ? "active" : ""}`} type="button" key={placement} onClick={() => setDraft({ ...draft, nonAniListPlacement: placement })}>{placement === "top" ? "Keep above" : "Keep below"}</button>)}
        </div>
      </div>
      <button className="button ghost" type="button" onClick={() => setAdvanced((open) => !open)} aria-expanded={advanced}>
        <SlidersHorizontal size={16} /> Advanced {advanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {advanced ? (
        <div className="custom-feed-advanced">
          <div className="field">
            <label>Order mode</label>
            <div className="segmented">
              {(["manual", "automatic"] as const).map((mode) => <button className={`segment ${draft.orderMode === mode ? "active" : ""}`} type="button" key={mode} onClick={() => setDraft({ ...draft, orderMode: mode })}>{mode === "manual" ? "Manual" : "Automatic"}</button>)}
            </div>
          </div>
          <div className="field-grid">
            <NumberField label="Min chapters" value={draft.filters.minChapters} onChange={(value) => updateFilters({ minChapters: value })} />
            <NumberField label="Max chapters" value={draft.filters.maxChapters} onChange={(value) => updateFilters({ maxChapters: value })} />
            <NumberField label="Min year" value={draft.filters.minYear} onChange={(value) => updateFilters({ minYear: value })} />
            <NumberField label="Max year" value={draft.filters.maxYear} onChange={(value) => updateFilters({ maxYear: value })} />
          </div>
          <MetricRangeEditor
            ranges={(draft.filters.metricRanges ?? []).filter((range) => range.metric !== "year" && range.metric !== "chapters")}
            metrics={CUSTOM_ADDITIONAL_RANGE_METRICS}
            onChange={(metricRanges) => updateFilters({ metricRanges })}
          />
          <h2 className="section-title">Rolling Dates</h2>
          <div className="field-grid">
            <div className="field">
              <label>Date field</label>
              <div className="segmented">
                {([
                  ["none", "None"],
                  ["release", "Release"],
                  ["end", "End"],
                ] as const).map(([value, label]) => (
                  <button className={`segment ${draft.filters.dateField === value ? "active" : ""}`} type="button" key={value} onClick={() => updateFilters({ dateField: value })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Window mode</label>
              <div className="segmented">
                {([
                  ["none", "None"],
                  ["last", "Last X"],
                  ["fixed", "Fixed"],
                ] as const).map(([value, label]) => (
                  <button className={`segment ${draft.filters.rolling.mode === value ? "active" : ""}`} type="button" key={value} onClick={() => updateFilters({ rolling: { ...draft.filters.rolling, mode: value } })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <RollingAmountField label="Amount" value={draft.filters.rolling.amount} onChange={(amount) => updateFilters({ rolling: { ...draft.filters.rolling, amount } })} />
            <div className="field">
              <label>Unit</label>
              <div className="segmented compact-segments">
                {(["days", "weeks", "months", "years"] as const).map((unit) => (
                  <button className={`segment ${draft.filters.rolling.unit === unit ? "active" : ""}`} type="button" key={unit} onClick={() => updateFilters({ rolling: { ...draft.filters.rolling, unit } })}>
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
          <h2 className="section-title">Sort</h2>
          <div className="settings-list">
            {draft.sort.map((rule, index) => <div className="setting-row" key={rule.id}>
              <div className="sort-editor">
                <div className="metric-choice">{SORT_OPTIONS.map((option) => <button className={`metric-option ${rule.metric === option ? "active" : ""}`} type="button" key={option} onClick={() => setDraft((current) => ({ ...current, orderMode: "automatic", sort: current.sort.map((item) => item.id === rule.id ? { ...item, metric: option } : item) }))}>{metricDefinition(option).shortLabel}</button>)}</div>
                <div className="segmented compact-segments">{(["desc", "asc"] as const).map((direction) => <button className={`segment ${rule.direction === direction ? "active" : ""}`} type="button" key={direction} onClick={() => setDraft((current) => ({ ...current, orderMode: "automatic", sort: current.sort.map((item) => item.id === rule.id ? { ...item, direction } : item) }))}>{direction === "desc" ? "High first" : "Low first"}</button>)}</div>
              </div>
              <button className="icon-button" type="button" onClick={() => setDraft((current) => ({ ...current, sort: current.sort.filter((item) => item.id !== rule.id) }))} aria-label={`Remove sort ${index + 1}`}><Trash2 size={16} /></button>
            </div>)}
            <button className="button" type="button" onClick={() => setDraft((current) => ({ ...current, orderMode: "automatic", sort: [...current.sort, { ...DEFAULT_SORT[0], id: makeId() }] }))}><Plus size={16} /> Add sort</button>
          </div>
        </div>
      ) : null}
      <div className="toolbar">
        <button className="button" type="button" onClick={onCancel}>Cancel</button>
        <span className="spacer" />
        <button className="button primary" type="button" disabled={!draft.name.trim()} onClick={() => onSave({
          ...draft,
          name: draft.name.trim(),
          filters: {
            ...draft.filters,
            minPopularity: null,
            maxPopularity: null,
            minFavourites: null,
            maxFavourites: null,
            minMeanScore: null,
            maxMeanScore: null,
            metricRanges: (draft.filters.metricRanges ?? []).filter((range) => range.metric !== "year" && range.metric !== "chapters"),
          },
        })}><Check size={16} /> Save list</button>
      </div>
    </div>
  );
}

function FeedEditor({ feed, onSave, onCancel }: { feed: Feed; onSave: (feed: Feed) => void; onCancel: () => void }) {
  const isDesktop = useDesktopLayout();
  const store = useAppStore();
  const [draft, setDraft] = useState<Feed>(() => structuredClone(feed));
  const [tagSearch, setTagSearch] = useState("");
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
        <input
          id="feed-name"
          className="input"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
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
        <RollingAmountField
          label="Amount"
          value={draft.filters.rolling.amount}
          onChange={(amount) => updateFilters({ rolling: { ...draft.filters.rolling, amount } })}
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
            {(isDesktop ? DESKTOP_GRID_OPTIONS : [1, 2, 3, 4, 5]).map((value) => (
              <button
                className={`segment ${(isDesktop ? resolvedDesktopGridColumns(draft.view) : draft.view.gridColumns) === value ? "active" : ""}`}
                type="button"
                key={value}
                onClick={() => updateView(isDesktop
                  ? { desktopGridColumns: value as FeedViewSettings["desktopGridColumns"] }
                  : { gridColumns: value as FeedViewSettings["gridColumns"] })}
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

function RollingAmountField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [input, setInput] = useState(() => String(value));

  useEffect(() => {
    setInput(String(value));
  }, [value]);

  const commit = (next: string) => {
    const amount = Number(next);
    if (!Number.isSafeInteger(amount) || amount < 1) return;
    onChange(amount);
  };

  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="number"
        min="1"
        step="1"
        value={input}
        onChange={(event) => {
          const next = event.target.value;
          setInput(next);
          if (next !== "") commit(next);
        }}
        onBlur={() => {
          if (input === "") setInput(String(value));
        }}
      />
    </div>
  );
}

function MetricRangeEditor({
  ranges,
  onChange,
  metrics = RANGE_METRICS,
}: {
  ranges: MetricRange[];
  onChange: (ranges: MetricRange[]) => void;
  metrics?: typeof RANGE_METRICS;
}) {
  const newestRangeRef = useRef<HTMLDivElement | null>(null);
  const previousRangeCountRef = useRef(ranges.length);
  useEffect(() => {
    if (ranges.length > previousRangeCountRef.current) {
      window.requestAnimationFrame(() => newestRangeRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" }));
    }
    previousRangeCountRef.current = ranges.length;
  }, [ranges.length]);
  const addRange = () => {
    const used = new Set(ranges.map((range) => range.metric));
    const nextMetric = metrics.find((metric) => !used.has(metric.id))?.id ?? metrics[0]?.id;
    if (!nextMetric) return;
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
        <button className="button" type="button" onClick={addRange} disabled={ranges.length >= metrics.length}>
          <Plus size={16} /> Add
        </button>
      </div>
      {ranges.length === 0 ? <p className="muted tiny">Add min/max filters for stats such as Fan%, popularity, favourites, scores, and growth.</p> : null}
      <div className="settings-list">
        {ranges.map((range, index) => (
          <div className="range-row" key={range.id} ref={index === ranges.length - 1 ? newestRangeRef : undefined}>
            <div className="metric-choice">
              {metrics.map((metric) => (
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
  const [query, setQuery] = useState(() => sessionStorage.getItem("manhwa-search-query") ?? "");
  const [committedQuery, setCommittedQuery] = useState(query);
  const [openedTitleIds, setOpenedTitleIds] = useState<number[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SEARCH_OPENED_HISTORY_KEY) ?? "[]") as unknown;
      if (!Array.isArray(saved)) return [];
      return saved
        .filter((id): id is number => Number.isSafeInteger(id) && id > 0)
        .slice(0, SEARCH_OPENED_HISTORY_LIMIT);
    } catch {
      return [];
    }
  });
  const sensitiveTagIds = useMemo(() => buildSensitiveTagGroups(store.tags), [store.tags]);
  const visibleSearchCatalog = useMemo(
    () => store.catalog.filter((item) => isSearchVisible(item, store.settings, sensitiveTagIds)),
    [sensitiveTagIds, store.catalog, store.settings],
  );
  const searchFeed = useMemo(() => {
    const feed = createFeed("Search results");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.contentRatings = [...store.settings.contentRatings];
    feed.view = { ...feed.view, gridColumns: 3 };
    return feed;
  }, [store.settings.contentRatings]);
  const recentFeed = useMemo(() => {
    const feed = createFeed("Recently opened");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.contentRatings = [...store.settings.contentRatings];
    feed.view = { ...feed.view, gridColumns: 3 };
    return feed;
  }, [store.settings.contentRatings]);
  const getTitle = useCallback((item: SeriesCatalog) => visibleTitle(item), []);
  const searchIndex = useMemo(
    () =>
      new Fuse(visibleSearchCatalog, {
        includeScore: true,
        shouldSort: true,
        ignoreLocation: true,
        minMatchCharLength: 2,
        threshold: 0.28,
        keys: [
          { name: "display_title", weight: 0.5 },
          { name: "titles.title", weight: 0.42 },
          { name: "animeplanet_title", weight: 0.3 },
          { name: "mangabaka_title", weight: 0.24 },
          { name: "native_title", weight: 0.22 },
          { name: "romanized_title", weight: 0.22 },
          { name: "authors", weight: 0.2 },
          { name: "artists", weight: 0.18 },
        ],
      }),
    [visibleSearchCatalog],
  );
  const searchTextById = useMemo(
    () => new Map(store.catalog.map((item) => [item.id, seriesSearchText(item)])),
    [store.catalog],
  );
  useEffect(() => {
    if (!query.trim()) {
      setCommittedQuery("");
      return;
    }
    const timeout = window.setTimeout(() => {
      startTransition(() => setCommittedQuery(query));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);
  const results = useMemo(() => {
    const term = committedQuery.trim();
    if (term.length < 2) return [];
    const sensitiveFamily = sensitiveTagIdsForSearch(term, sensitiveTagIds);
    if (sensitiveFamily) {
      return visibleSearchCatalog
        .filter((item) => item.tag_ids.some((tagId) => sensitiveFamily.has(tagId)))
        .sort((a, b) => getTitle(a).localeCompare(getTitle(b)))
        .slice(0, 120);
    }
    const words = searchWords(term);
    const directMatches = visibleSearchCatalog
      .filter((item) => matchesSearchTextWords(searchTextById.get(item.id) ?? "", words))
      .sort(
        (left, right) =>
          searchTextWordPosition(searchTextById.get(left.id) ?? "", words) -
          searchTextWordPosition(searchTextById.get(right.id) ?? "", words),
      );
    if (directMatches.length > 0) return directMatches.slice(0, 120);
    const fuzzyMatches = searchIndex
      .search(term, { limit: 180 })
      .map((result) => result.item);
    return fuzzyMatches.slice(0, 120);
  }, [committedQuery, getTitle, searchIndex, searchTextById, sensitiveTagIds, visibleSearchCatalog]);
  const recentItems = useMemo(() => {
    const visibleById = new Map(visibleSearchCatalog.map((item) => [item.id, item]));
    return openedTitleIds
      .map((id) => visibleById.get(id))
      .filter((item): item is SeriesCatalog => Boolean(item));
  }, [openedTitleIds, visibleSearchCatalog]);
  useEffect(() => {
    sessionStorage.setItem("manhwa-search-query", query);
  }, [query]);
  const rememberOpenedTitle = useCallback((id: number) => {
    setOpenedTitleIds((current) => {
      const next = [id, ...current.filter((item) => item !== id)].slice(0, SEARCH_OPENED_HISTORY_LIMIT);
      localStorage.setItem(SEARCH_OPENED_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const rememberOpenedTitleFromClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-series-id]");
    const id = Number(card?.dataset.seriesId);
    if (Number.isSafeInteger(id) && id > 0) rememberOpenedTitle(id);
  }, [rememberOpenedTitle]);
  return (
    <div className="page search-page">
      <div className="search-page-header">
        <h1>SEARCH</h1>
        <form className="field" onSubmit={(event) => event.preventDefault()}>
          <label>Title or creator</label>
          <div className="search-input-wrap">
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Titles, aliases, creators"
              autoComplete="off"
            />
            {query && (
              <button className="input-clear" type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
      {query.trim() ? (
        <section className="search-results-surface" onClickCapture={rememberOpenedTitleFromClick}>
          <MemoSearchTitleCollection
            items={results}
            feed={searchFeed}
            history={store.history}
            latestDate={store.syncMeta?.historyLastDate}
          />
        </section>
      ) : (
        <section className="search-history-surface">
          <div className="row">
            <h2 className="section-title">Recently opened</h2>
            <span className="spacer" />
            {openedTitleIds.length > 0 && (
              <button className="button ghost" type="button" onClick={() => { setOpenedTitleIds([]); localStorage.removeItem(SEARCH_OPENED_HISTORY_KEY); }}>
                Clear
              </button>
            )}
          </div>
          {recentItems.length > 0 ? (
            <div onClickCapture={rememberOpenedTitleFromClick}>
              <MemoSearchTitleCollection
                items={recentItems}
                feed={recentFeed}
                history={store.history}
                latestDate={store.syncMeta?.historyLastDate}
              />
            </div>
          ) : (
            <p className="muted search-history-empty">Titles opened from Global Search will appear here.</p>
          )}
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
  const getTitle = useCallback((item: SeriesCatalog) => visibleTitle(item), []);
  const defaultRecommendationTitle = store.catalog.find((item) => getTitle(item).toLocaleLowerCase() === "bastard");
  const selected =
    store.catalog.find((item) => item.id === selectedId) ??
    store.catalog.find((item) => item.id === Number(params.id)) ??
    defaultRecommendationTitle ??
    store.catalog[0];
  const candidates = search.trim()
    ? store.catalog
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
          <Cover series={selected} priority />
          <div>
            <span className="muted tiny">Selected</span>
            <h2>{getTitle(selected)}</h2>
            <p className="muted tiny">Recommendations prioritize shared tags, then shelf-specific sorting.</p>
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
    setItems(null);
    const handle = window.setTimeout(() => {
      if (cancelled) return;
      const ranked = recommendationItems(base, shelf, store).slice(0, visibleLimit);
      if (!cancelled) setItems(ranked);
    }, 24);
    return () => {
      cancelled = true;
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
    return <TitleCollectionSkeleton columns={feed.view.gridColumns} />;
  }

  return <TitleCollection items={items} feed={feed} history={store.history} latestDate={store.syncMeta?.historyLastDate} />;
}

function recommendationItems(base: SeriesCatalog, shelf: RecommendationShelf, store: ReturnType<typeof useAppStore>) {
  const buildPool = (metricRanges: RecommendationShelf["metricRanges"]) => {
    const filterFeed = createFeed(shelf.name);
    filterFeed.filters.sourceModes = shelf.sourceModes;
    filterFeed.filters.sourceMode = shelf.sourceModes.length === 2 ? "mixed" : shelf.sourceModes[0];
    filterFeed.filters.contentRatings = ["safe", "suggestive"];
    filterFeed.filters.metricRanges = metricRanges;
    return runFeedQuery({
      feed: filterFeed,
      series: store.catalog,
      tags: store.tags,
      history: store.history,
      labels: store.labels,
      settings: store.settings,
      metaHistoryFirst: store.syncMeta?.historyFirstDate,
      metaHistoryLast: store.syncMeta?.historyLastDate,
    }).items.filter((item) => item.id !== base.id);
  };

  const rankPool = (pool: SeriesCatalog[]) =>
    rankRecommendations({
      base,
      candidates: pool,
      tags: store.tags,
      features: store.recommendationFeatures,
      shelf,
      history: store.history,
      latestDate: store.syncMeta?.historyLastDate,
    });

  const ranked = rankPool(buildPool(shelf.metricRanges));
  if (ranked.length || !shelf.metricRanges.length) return ranked;
  return rankPool(buildPool([]));
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
        sort: [{ id: crypto.randomUUID(), metric: "fanFavouriteDiscoveryPercentile", direction: "desc" }],
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
                sort: [...draft.sort, { id: crypto.randomUUID(), metric: "fanFavouriteDiscoveryPercentile", direction: "desc" }],
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

// Kept as dormant source for the eventual recommendation rebuild; no route mounts it while suspended.
void [RecommendationsPage, RecommendationResults, recommendationItems, RecommendationShelfEditor];

function SettingsPage() {
  const store = useAppStore();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [backupStatus, setBackupStatus] = useState("");
  const refreshLabel = store.syncInFlight
    ? store.syncStatus.startsWith("Checking")
      ? "Checking..."
      : "Syncing..."
    : "Refresh";
  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const snapshot = JSON.parse(await file.text()) as Partial<AppStateSnapshot>;
      if (!Array.isArray(snapshot.feeds)) throw new Error("This file does not contain a feeds backup.");
      store.importSnapshot(snapshot, "merge");
      setBackupStatus(`Added ${snapshot.feeds.length.toLocaleString()} feeds.`);
    } catch (error) {
      setBackupStatus(error instanceof Error ? error.message : "Could not import this backup.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };
  return (
    <div className="page settings-page">
      <div className="settings-page-header">
        <h1>SETTINGS</h1>
      </div>

      <SettingsSection title="Appearance">
        <div className="setting-stack">
          <div>
            <strong>Accent color</strong>
            <div className="muted tiny">Used for active controls, selection, and navigation.</div>
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
          <button className="button" type="button" onClick={() => void store.refreshData()} disabled={store.syncInFlight}>
            <Database size={16} /> {refreshLabel}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="Session">
        <ToggleRow label="Restore last session" description="Reopen at the prior route/feed/scroll when possible." value={store.settings.restoreLastSession} onChange={(restoreLastSession) => store.updateSettings({ restoreLastSession })} />
      </SettingsSection>

      <SettingsSection title="Search">
        <ToggleRow
          label="Show BL / GL families"
          description="Global title search includes Boys Love, Girls Love, Yaoi, Yuri, and child tags. It also reveals the Yuri & Yaoi built-in segment in Feeds."
          value={store.settings.searchRelationshipTags}
          onChange={(searchRelationshipTags) => store.updateSettings({ searchRelationshipTags })}
        />
        <ToggleRow
          label="Show Smut / Erotica"
          description="Global title search includes adult-rated titles plus Smut, Erotica, and child tags. It also reveals the SMUT/EROTICA built-in segment in Feeds."
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
        {backupStatus ? <div className="settings-status" role="status">{backupStatus}</div> : null}
        <button className="button danger" type="button" onClick={() => void store.resetLocalState()}>
          Reset local app state
        </button>
      </SettingsSection>
    </div>
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
  const detailLayoutKey = `manhwa-detail-layout:${store.activeFeedId ?? "default"}`;
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
      return { ...DEFAULT_DETAIL_VISIBLE, description: true, links: true, cover: true, title: true, authorsArtists: true };
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
    if (invalidRoute) {
      setStatus("Invalid title route");
      setLoading(false);
      return;
    }
    void fetchSeriesDetail(store.settings.dataSourceUrl, id)
      .then((value) => {
        if (!cancelled) {
          setDetail(value);
          setLoading(false);
          setStatus(value.description?.trim() ? "" : "Description unavailable from data source.");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          if (catalogItem) {
            setDetail({ ...catalogItem, description: null });
            setLoading(false);
            setStatus(error instanceof Error ? error.message : "Could not load detail");
            return;
          }
          setStatus(error instanceof Error ? error.message : "Could not load detail");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [catalogItem, id, invalidRoute, store.settings.dataSourceUrl]);

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

  return (
    <div className="detail-page">
      {series?.cover && <img className="detail-bg" src={series.cover} alt="" />}
      <div className="detail-top-actions">
        <button className="icon-button" type="button" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <span className="spacer" />
        <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Detail settings">
          <EllipsisVertical size={20} />
        </button>
      </div>
      {loadingDetail ? (
        <DetailSkeleton series={catalogItem ?? null} />
      ) : series ? (
        <>
          <section className="detail-identity">
            {visible.cover && (
              <div className="detail-cover-shell">
                {series.cover ? <img className="detail-cover" src={series.cover} alt="" /> : <div className="detail-cover cover-fallback">No cover</div>}
              </div>
            )}
            <div className="detail-copy">
              {visible.title && <h1 className="detail-title">{series.display_title}</h1>}
              {visible.authorsArtists && (
                <p className="detail-creators">{uniqueNames(series.authors, series.artists).join(" / ") || "Creator unavailable"}</p>
              )}
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
          {visible.description && !detail?.description && status && (
            <section className="detail-block">
              <h2 className="section-title">Description</h2>
              <p className="muted">{status}</p>
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
        </>
      ) : showError ? (
        <div className="detail-error">
          <p className="muted">{status}</p>
        </div>
      ) : (
        <DetailSkeleton series={null} />
      )}
      <BottomDrawer title="Detail Settings" open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DetailSettingsDrawer visible={visible} onChange={setVisible} />
      </BottomDrawer>
    </div>
  );
}

function DetailSkeleton({ series }: { series: SeriesCatalog | null }) {
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
        </div>
      </section>
      <section className="detail-meta-strip detail-skeleton-strip" aria-hidden="true">
        <div className="detail-meta-chip skeleton-chip" />
        <div className="detail-meta-chip skeleton-chip" />
        <div className="detail-meta-chip skeleton-chip" />
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
          <a href="https://mangabaka.org" target="_blank" rel="noreferrer">MangaBaka</a> supplies the main catalog,
          covers, publication details, links, and tag hierarchy used by feeds and detail pages.
        </LearnItem>
        <LearnItem title="AniList signals">
          <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a> supplies popularity, favourites,
          and mean score for mapped titles. These values give audience-size and engagement context; they are not
          available for every title.
        </LearnItem>
        <LearnItem title="Fan Rank">
          Fan Rank is like comparing a YouTube video&apos;s likes with its views to estimate how strongly viewers
          engaged. Here, favourites are compared with popularity, adjusted for sample-size confidence, then ranked
          as a percentile across the AniList-mapped manhwa catalog with the required stats.
        </LearnItem>
        <LearnItem title="Dates and history">
          Release and completion windows use confirmed dates only; estimated dates do not qualify. Growth values
          compare available history snapshots, so longer windows improve as more backend history accumulates.
        </LearnItem>
        <LearnItem title="Gestures">
          Double-tap Home to return to the first visible feed at its top. On Home, double-tap a feed title to open
          that feed&apos;s settings, or double-tap the surrounding header card to search titles already inside that feed.
        </LearnItem>
        <LearnItem title="Segments">
          The eye control in Feeds hides a segment from Home without deleting its feeds. Smut/Erotica and BL/GL
          segments also stay unavailable until their matching Settings search toggle is enabled.
        </LearnItem>
        <LearnItem title="Additional sources">
          When available, title identity and links are cross-checked with{" "}
          <a href="https://www.mangaupdates.com" target="_blank" rel="noreferrer">MangaUpdates</a> and{" "}
          <a href="https://www.anime-planet.com/manga" target="_blank" rel="noreferrer">Anime-Planet</a>. Feeds and
          settings stay on this device and can be moved with the JSON backup.
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
  const importedFeedRef = useRef(false);
  const payload = useMemo(() => {
    const encoded = params.get("p");
    if (!encoded) return null;
    try {
      return decodeSharePayload(encoded);
    } catch {
      return null;
    }
  }, [params]);

  useLayoutEffect(() => {
    if (!store.ready || payload?.kind !== "feed" || importedFeedRef.current) return;
    importedFeedRef.current = true;
    const now = new Date().toISOString();
    const importedFeed = { ...payload.feed, id: makeId(), createdAt: now, updatedAt: now };
    store.upsertFeed(importedFeed);
    store.openFeedInHome(importedFeed.id, null);
    navigate("/", { replace: true });
  }, [navigate, payload, store]);

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
      ) : payload.kind === "feed" ? (
        <div className="empty-state">Opening {payload.feed.name}...</div>
      ) : (
        <div className="empty-state">
          <Import size={28} />
          <strong>{`${payload.kind} share`}</strong>
          <span className="muted">Review before applying this shared configuration.</span>
          <div className="toolbar">
            <button className="button primary" type="button" onClick={() => apply("merge")}>
              Apply
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

function SharePanelButton({ payload, label = "Share", onCopied }: { payload: SharePayload; label?: string; onCopied?: () => void }) {
  const [open, setOpen] = useState(false);
  const handleCopied = () => {
    setOpen(false);
    onCopied?.();
  };
  return (
    <>
      <button className="button" type="button" onClick={() => setOpen(true)}>
        <Share2 size={16} /> {label}
      </button>
      <BottomDrawer title={label} open={open} onOpenChange={setOpen}>
        <SharePanel payload={payload} onCopied={handleCopied} />
      </BottomDrawer>
    </>
  );
}

function SharePanel({ payload, onCopied }: { payload: SharePayload; onCopied: () => void }) {
  const url = useMemo(() => makeShareUrl(payload), [payload]);
  const [copyError, setCopyError] = useState("");
  const title = payload.kind === "feed" ? payload.feed.name : "Aeon configuration";
  const description = payload.kind === "feed" && payload.feed.showDescription ? payload.feed.description.trim() : "";
  const copyLink = async () => {
    if (!url) return;
    if (await copyTextToClipboard(url)) onCopied();
    else setCopyError("Could not copy link");
  };
  const share = async () => {
    if (!url) return;
    if (navigator.share) {
      await navigator.share({ title, text: description ? `${title}\n${description}` : title, url });
      return;
    }
    await copyLink();
  };
  return (
    <div>
      <h2 className="share-title">{title}</h2>
      {description && <p className="muted">{description}</p>}
      {url ? (
        <>
          <p className="muted">Same-domain compressed share link. No URL shortener, no tracker.</p>
          <textarea className="textarea" readOnly value={url} />
          <div className="toolbar">
            <button className="button primary" type="button" onClick={() => void share()}><Share2 size={16} /> Share</button>
            <button className="button" type="button" onClick={() => void copyLink()}><Copy size={16} /> Copy</button>
            {payload.kind === "feed" ? (
              <button className="button" type="button" onClick={() => downloadText(`${safeFilename(payload.feed.name)}.json`, JSON.stringify({ feeds: [payload.feed] }, null, 2))}>
                <Download size={16} /> JSON
              </button>
            ) : null}
          </div>
          {copyError ? <div className="settings-status" role="status">{copyError}</div> : null}
        </>
      ) : payload.kind === "feed" ? (
        <div className="setting-stack">
          <p className="muted">This list is too large for a reliable link. Share it as a JSON file instead.</p>
          <button className="button primary" type="button" onClick={() => downloadText(`${safeFilename(payload.feed.name)}.json`, JSON.stringify({ feeds: [payload.feed] }, null, 2))}><Download size={16} /> Download JSON</button>
        </div>
      ) : null}
    </div>
  );
}

function makeSnapshot(store: ReturnType<typeof useAppStore>) {
  return {
    feeds: store.feeds,
    feedSegments: store.feedSegments,
    feedLibraryOrder: store.feedLibraryOrder,
    settings: store.settings,
    activeFeedId: store.activeFeedId,
    lastRoute: window.location.hash,
  };
}

function downloadSegmentBackup(segment: FeedSegment, feeds: Feed[]) {
  const feedIdMap = new Map(feeds.map((feed) => [feed.id, makeId()]));
  const exportedFeeds = feeds.map((feed) => ({ ...feed, id: feedIdMap.get(feed.id) ?? makeId() }));
  const snapshot: Partial<AppStateSnapshot> = {
    feeds: exportedFeeds,
    feedSegments: [{ ...segment, id: makeId(), feedIds: exportedFeeds.map((feed) => feed.id) }],
    activeFeedId: exportedFeeds[0]?.id ?? null,
  };
  downloadText(`${safeFilename(segment.name)}-segment.json`, JSON.stringify(snapshot, null, 2));
}

function safeFilename(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "segment";
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // LAN HTTP previews may not expose the modern Clipboard API.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
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
