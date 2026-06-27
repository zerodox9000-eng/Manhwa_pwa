import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_SENSITIVE_EXCLUDE_TAG_IDS, DEFAULT_SETTINGS } from "../domain/defaults";
import defaultFeedsJson from "../domain/defaultFeeds.generated.json";
import { feedUsesAniListOnlyParameters } from "../domain/query";
import { parseAppStateSnapshot, parseSettings } from "../domain/validation";
import type {
  AppSettings,
  AppStateSnapshot,
  Feed,
  Folder,
  HistoryMap,
  RecommendationFeature,
  SeriesCatalog,
  SyncMeta,
  TagNode,
  UserLabel,
} from "../domain/types";
import { db, loadSyncMeta } from "../db/appDb";
import { loadBundledCatalog, loadCachedData, syncFrontendData } from "../services/dataService";

const STORAGE_KEY = "manhwa-library-state-v1";
const THREE_COLUMN_FEEDS_MIGRATION_KEY = "manhwa-three-column-feeds-v1";

interface StoreState {
  ready: boolean;
  catalog: SeriesCatalog[];
  tags: TagNode[];
  history: HistoryMap;
  recommendationFeatures: RecommendationFeature[];
  syncMeta: SyncMeta | null;
  feeds: Feed[];
  folders: Folder[];
  labels: UserLabel[];
  settings: AppSettings;
  activeFeedId: string | null;
  syncStatus: string;
  setActiveFeedId: (id: string | null) => void;
  upsertFeed: (feed: Feed) => void;
  deleteFeed: (id: string) => void;
  moveFeed: (id: string, targetId: string) => void;
  upsertFolder: (folder: Folder) => void;
  deleteFolder: (id: string) => void;
  upsertLabel: (label: UserLabel) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  refreshData: () => Promise<void>;
  resetLocalState: () => Promise<void>;
  importSnapshot: (snapshot: Partial<AppStateSnapshot>, mode: "merge" | "replace") => void;
}

function loadLocalSnapshot(): Partial<AppStateSnapshot> {
  try {
    if (new URLSearchParams(window.location.search).has("resetLocal")) {
      const resetKey = `manhwa-reset-consumed:${window.location.pathname}${window.location.hash || "#/"}`;
      const shouldReset = sessionStorage.getItem(resetKey) !== "1";
      if (shouldReset) {
        sessionStorage.setItem(resetKey, "1");
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem("manhwa-library-route-v1");
        if ("caches" in window) void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
        if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => void registration.unregister()));
      }
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash || "#/"}`);
      if (shouldReset) return {};
    }
    return parseAppStateSnapshot(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")) ?? {};
  } catch {
    return {};
  }
}

function isOldDefaultRecommendationRange(range: { id: string; metric: string; min: number | null; max: number | null }) {
  return (
    (range.id === "rec-min-pop" && range.metric === "popularity" && range.min === 500 && range.max == null) ||
    (range.id === "rec-min-fan" && range.metric === "fanFavouriteRaw" && range.min === 2 && range.max == null)
  );
}

function normalizeRecommendationShelves(settings?: Partial<AppSettings>) {
  const shelves = settings?.recommendationShelves ?? DEFAULT_SETTINGS.recommendationShelves;
  return shelves.map((shelf) => {
    if (shelf.id !== "similar-loved") return shelf;
    const ranges = shelf.metricRanges ?? [];
    const isLegacyDefault =
      ranges.length === 2 && ranges.every((range) => isOldDefaultRecommendationRange(range));
    return isLegacyDefault ? { ...shelf, metricRanges: [] } : shelf;
  });
}

function mergeSettings(settings?: Partial<AppSettings>): AppSettings {
  const recommendationShelves = normalizeRecommendationShelves(settings);
  const accentColor = settings?.accentColor?.toLowerCase() === "#ff006e"
    ? "#ff3b81"
    : settings?.accentColor ?? DEFAULT_SETTINGS.accentColor;
  const relationshipTags =
    settings?.searchRelationshipTags ?? settings?.searchSensitiveTags ?? DEFAULT_SETTINGS.searchRelationshipTags;
  const adultTags = settings?.searchAdultTags ?? settings?.searchSensitiveTags ?? DEFAULT_SETTINGS.searchAdultTags;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    accentColor,
    defaultFeedView: {
      ...DEFAULT_SETTINGS.defaultFeedView,
      ...settings?.defaultFeedView,
      mode: "grid",
      metricSlots: settings?.defaultFeedView?.metricSlots?.length
        ? settings.defaultFeedView.metricSlots.slice(0, 3)
        : DEFAULT_SETTINGS.defaultFeedView.metricSlots,
      visible: {
        ...DEFAULT_SETTINGS.defaultFeedView.visible,
        ...settings?.defaultFeedView?.visible,
        labels: false,
      },
    },
    recommendationShelves,
    detailVisible: {
      ...DEFAULT_SETTINGS.detailVisible,
      ...settings?.detailVisible,
    },
    metricNames: {
      ...DEFAULT_SETTINGS.metricNames,
      ...settings?.metricNames,
    },
    searchSensitiveTags: relationshipTags && adultTags,
    searchRelationshipTags: relationshipTags,
    searchAdultTags: adultTags,
  };
}

export function normalizeFeed(feed: Feed, options: { preserveMetricSlots?: boolean } = {}): Feed {
  const excludeTagIds = feed.filters.excludeTagIds?.length
    ? feed.filters.excludeTagIds
    : DEFAULT_SENSITIVE_EXCLUDE_TAG_IDS;
  const rawMetricSlots = feed.view?.metricSlots ?? DEFAULT_SETTINGS.defaultFeedView.metricSlots;
  const metricSlots = (options.preserveMetricSlots
    ? rawMetricSlots
    : rawMetricSlots.filter((metric) => metric !== "mangabakaLatestRank")
  ).slice(0, 3);
  const normalized: Feed = {
    ...feed,
    description: feed.description ?? "",
    showDescription: feed.showDescription ?? false,
    filters: {
      ...feed.filters,
      sourceMode: feed.filters.sourceMode ?? "mixed",
      sourceModes:
        feed.filters.sourceModes?.length
          ? feed.filters.sourceModes
          : feed.filters.sourceMode === "anilist"
            ? ["anilist"]
            : feed.filters.sourceMode === "non-anilist"
              ? ["non-anilist"]
              : ["anilist", "non-anilist"],
      contentRatings: feed.filters.contentRatings ?? DEFAULT_SETTINGS.contentRatings,
      metricRanges: feed.filters.metricRanges ?? [],
      includeEstimatedDates: feed.filters.includeEstimatedDates ?? true,
      excludeTagIds,
      labelIds: [],
      query: "",
    },
    sort: feed.sort?.length ? feed.sort : [],
    view: {
      ...DEFAULT_SETTINGS.defaultFeedView,
      ...feed.view,
      mode: "grid",
      metricSlots,
      visible: {
        ...DEFAULT_SETTINGS.defaultFeedView.visible,
        ...feed.view?.visible,
        labels: false,
      },
    },
  };
  if (feedUsesAniListOnlyParameters(normalized)) {
    return {
      ...normalized,
      filters: {
        ...normalized.filters,
        sourceMode: "anilist",
        sourceModes: ["anilist"],
      },
    };
  }
  return normalized;
}

const AppStoreContext = createContext<StoreState | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const local = useMemo(loadLocalSnapshot, []);
  const hasSavedState = useMemo(() => localStorage.getItem(STORAGE_KEY) != null, []);
  const shouldMigrateFeedsToThreeColumns = useMemo(
    () => localStorage.getItem(THREE_COLUMN_FEEDS_MIGRATION_KEY) !== "1",
    [],
  );
  const [ready, setReady] = useState(false);
  const [catalog, setCatalog] = useState<SeriesCatalog[]>([]);
  const [tags, setTags] = useState<TagNode[]>([]);
  const [history, setHistory] = useState<HistoryMap>({});
  const [recommendationFeatures, setRecommendationFeatures] = useState<RecommendationFeature[]>([]);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>(() => {
    const normalizedFeeds = (hasSavedState ? local.feeds ?? [] : (defaultFeedsJson as Feed[])).map((feed) =>
      normalizeFeed(feed),
    );
    if (!shouldMigrateFeedsToThreeColumns) return normalizedFeeds;
    return normalizedFeeds.map((feed) => ({ ...feed, view: { ...feed.view, gridColumns: 3 } }));
  });
  const [folders, setFolders] = useState<Folder[]>(local.folders ?? []);
  const [labels, setLabels] = useState<UserLabel[]>(local.labels ?? []);
  const [settings, setSettings] = useState<AppSettings>(mergeSettings(parseSettings(local.settings) ?? local.settings));
  const [activeFeedId, setActiveFeedId] = useState<string | null>(local.activeFeedId ?? null);
  const [syncStatus, setSyncStatus] = useState("");

  useEffect(() => {
    if (shouldMigrateFeedsToThreeColumns) {
      localStorage.setItem(THREE_COLUMN_FEEDS_MIGRATION_KEY, "1");
    }
  }, [shouldMigrateFeedsToThreeColumns]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [
        { catalog: cachedCatalog, tags: cachedTags, history: cachedHistory, recommendationFeatures: cachedRecommendationFeatures },
        meta,
        bundledCatalog,
      ] = await Promise.all([
        loadCachedData(),
        loadSyncMeta(),
        loadBundledCatalog(),
      ]);
      if (cancelled) return;

      if (cachedCatalog.length > 0) {
        setCatalog(cachedCatalog);
        setTags(cachedTags);
        setHistory(cachedHistory);
        setRecommendationFeatures(cachedRecommendationFeatures);
        setSyncMeta(meta);
        setReady(true);

        const lastSyncTime = meta?.lastSync ? Date.parse(meta.lastSync) : Number.NaN;
        const cacheIsStale = !Number.isFinite(lastSyncTime) || Date.now() - lastSyncTime > 6 * 60 * 60 * 1000;
        const needsRefresh =
          !meta?.versionHash?.includes("live-merged") ||
          !cachedCatalog.some((item) => item.published?.start_date || item.published?.end_date) ||
          cacheIsStale;
        if (needsRefresh && navigator.onLine) {
          window.setTimeout(() => void refreshData(), 2400);
        }
        return;
      }

      if (navigator.onLine) {
        try {
          setSyncStatus("Loading current library");
          const synced = await syncFrontendData(settings.dataSourceUrl, setSyncStatus);
          if (cancelled) return;
          setCatalog(synced.catalog);
          setTags(synced.tags);
          setHistory(synced.history);
          setRecommendationFeatures(synced.recommendationFeatures);
          setSyncMeta(synced.meta);
          setSettings((current) => ({ ...current, dataSourceUrl: synced.meta.source }));
          setSyncStatus("");
          setReady(true);
          return;
        } catch {
          if (cancelled) return;
          setSyncStatus("Using bundled offline library");
        }
      }

      if (bundledCatalog.length > 0) {
        setCatalog(bundledCatalog);
        setSyncMeta({
          lastSync: new Date().toISOString(),
          totalSeries: bundledCatalog.length,
          historyFirstDate: null,
          historyLastDate: null,
          versionHash: `bundled-${bundledCatalog.length}`,
          source: "Bundled query index",
        });
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const snapshot: AppStateSnapshot = {
      feeds,
      folders,
      labels,
      settings,
      activeFeedId,
      lastRoute: window.location.hash,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [feeds, folders, labels, settings, activeFeedId]);

  const refreshData = useCallback(async () => {
    setSyncStatus("Starting sync");
    try {
      const synced = await syncFrontendData(settings.dataSourceUrl, setSyncStatus);
      setCatalog(synced.catalog);
      setTags(synced.tags);
      setHistory(synced.history);
      setRecommendationFeatures(synced.recommendationFeatures);
      setSyncMeta(synced.meta);
      setSettings((current) => ({ ...current, dataSourceUrl: synced.meta.source }));
      setSyncStatus("Sync complete");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Sync failed");
    }
  }, [settings.dataSourceUrl]);

  const upsertFeed = useCallback((feed: Feed) => {
    const updated = normalizeFeed({ ...feed, updatedAt: new Date().toISOString() });
    setFeeds((current) => {
      const exists = current.some((item) => item.id === feed.id);
      return exists ? current.map((item) => (item.id === feed.id ? updated : item)) : [...current, updated];
    });
    setActiveFeedId((current) => current ?? updated.id);
  }, []);

  const deleteFeed = useCallback((id: string) => {
    setFeeds((current) => current.filter((feed) => feed.id !== id));
    setActiveFeedId((current) => (current === id ? null : current));
  }, []);

  const moveFeed = useCallback((id: string, targetId: string) => {
    setFeeds((current) => {
      const index = current.findIndex((feed) => feed.id === id);
      const targetIndex = current.findIndex((feed) => feed.id === targetId);
      if (index < 0 || targetIndex < 0 || index === targetIndex) return current;
      const copy = [...current];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIndex, 0, moved);
      return copy;
    });
  }, []);

  const upsertFolder = useCallback((folder: Folder) => {
    setFolders((current) => {
      const exists = current.some((item) => item.id === folder.id);
      return exists ? current.map((item) => (item.id === folder.id ? folder : item)) : [...current, folder];
    });
  }, []);

  const deleteFolder = useCallback((id: string) => {
    setFolders((current) => current.filter((folder) => folder.id !== id));
  }, []);

  const upsertLabel = useCallback((label: UserLabel) => {
    setLabels((current) => {
      const exists = current.some((item) => item.id === label.id);
      return exists ? current.map((item) => (item.id === label.id ? label : item)) : [...current, label];
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => mergeSettings({ ...current, ...patch }));
  }, []);

  const resetLocalState = useCallback(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await db.details.clear();
    setFeeds([]);
    setFolders([]);
    setLabels([]);
    setSettings(DEFAULT_SETTINGS);
    setActiveFeedId(null);
  }, []);

  const importSnapshot = useCallback((snapshot: Partial<AppStateSnapshot>, mode: "merge" | "replace") => {
    const safeSnapshot = parseAppStateSnapshot(snapshot) ?? snapshot;
    if (mode === "replace") {
      setFeeds((safeSnapshot.feeds ?? []).map((feed) => normalizeFeed(feed, { preserveMetricSlots: true })));
      setFolders(safeSnapshot.folders ?? []);
      setLabels(safeSnapshot.labels ?? []);
      setSettings(mergeSettings(safeSnapshot.settings ? parseSettings(safeSnapshot.settings) ?? safeSnapshot.settings : undefined));
      setActiveFeedId(safeSnapshot.activeFeedId ?? null);
      return;
    }
    setFeeds((current) => [
      ...current,
      ...(safeSnapshot.feeds ?? []).map((feed) => normalizeFeed(feed, { preserveMetricSlots: true })),
    ]);
    setFolders((current) => [...current, ...(safeSnapshot.folders ?? [])]);
    setLabels((current) => [...current, ...(safeSnapshot.labels ?? [])]);
    if (safeSnapshot.settings) {
      setSettings((current) => mergeSettings({ ...current, ...(parseSettings(safeSnapshot.settings) ?? safeSnapshot.settings) }));
    }
  }, []);

  const value = useMemo<StoreState>(
    () => ({
      ready,
      catalog,
      tags,
      history,
      recommendationFeatures,
      syncMeta,
      feeds,
      folders,
      labels,
      settings,
      activeFeedId,
      syncStatus,
      setActiveFeedId,
      upsertFeed,
      deleteFeed,
      moveFeed,
      upsertFolder,
      deleteFolder,
      upsertLabel,
      updateSettings,
      refreshData,
      resetLocalState,
      importSnapshot,
    }),
    [
      ready,
      catalog,
      tags,
      history,
      recommendationFeatures,
      syncMeta,
      feeds,
      folders,
      labels,
      settings,
      activeFeedId,
      syncStatus,
      setActiveFeedId,
      upsertFeed,
      deleteFeed,
      moveFeed,
      upsertFolder,
      deleteFolder,
      upsertLabel,
      updateSettings,
      refreshData,
      resetLocalState,
      importSnapshot,
    ],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("useAppStore must be used inside AppStoreProvider");
  return store;
}
