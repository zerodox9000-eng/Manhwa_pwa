import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_SENSITIVE_EXCLUDE_TAG_IDS, DEFAULT_SETTINGS } from "../domain/defaults";
import defaultFeedsJson from "../domain/defaultFeeds.generated.json";
import { feedUsesAniListOnlyParameters } from "../domain/query";
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
const TITLE_OVERRIDES_KEY = "manhwa-library-title-overrides-v1";

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
  titleOverrides: Record<number, string>;
  syncStatus: string;
  setActiveFeedId: (id: string | null) => void;
  setTitleOverride: (id: number, title: string) => void;
  clearTitleOverride: (id: number) => void;
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
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<AppStateSnapshot>;
  } catch {
    return {};
  }
}

function loadLocalTitleOverrides(): Record<number, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TITLE_OVERRIDES_KEY) ?? "{}") as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [Number(key), typeof value === "string" ? value.trim() : ""] as const)
        .filter(([id, value]) => Number.isFinite(id) && value.length > 0),
    );
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
  const relationshipTags =
    settings?.searchRelationshipTags ?? settings?.searchSensitiveTags ?? DEFAULT_SETTINGS.searchRelationshipTags;
  const adultTags = settings?.searchAdultTags ?? settings?.searchSensitiveTags ?? DEFAULT_SETTINGS.searchAdultTags;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
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
  const rawMetricSlots = feed.view?.metricSlots?.length ? feed.view.metricSlots : DEFAULT_SETTINGS.defaultFeedView.metricSlots;
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
      metricSlots: metricSlots.length ? metricSlots : ["year"],
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
  const [ready, setReady] = useState(false);
  const [catalog, setCatalog] = useState<SeriesCatalog[]>([]);
  const [tags, setTags] = useState<TagNode[]>([]);
  const [history, setHistory] = useState<HistoryMap>({});
  const [recommendationFeatures, setRecommendationFeatures] = useState<RecommendationFeature[]>([]);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>(
    (hasSavedState ? local.feeds ?? [] : (defaultFeedsJson as Feed[])).map((feed) => normalizeFeed(feed)),
  );
  const [folders, setFolders] = useState<Folder[]>(local.folders ?? []);
  const [labels, setLabels] = useState<UserLabel[]>(local.labels ?? []);
  const [settings, setSettings] = useState<AppSettings>(mergeSettings(local.settings));
  const [activeFeedId, setActiveFeedId] = useState<string | null>(local.activeFeedId ?? null);
  const [titleOverrides, setTitleOverrides] = useState<Record<number, string>>(loadLocalTitleOverrides);
  const [syncStatus, setSyncStatus] = useState("");

  useEffect(() => {
    void (async () => {
      const bundledCatalogPromise = loadBundledCatalog();
      const cachedDataPromise = loadCachedData();
      const metaPromise = loadSyncMeta();
      let cacheResolved = false;
      let showedBundled = false;
      const bundledTimer = window.setTimeout(() => {
        void bundledCatalogPromise.then((bundledCatalog) => {
          if (cacheResolved || bundledCatalog.length === 0) return;
          showedBundled = true;
          setCatalog(bundledCatalog);
          setSyncMeta({
            lastSync: new Date().toISOString(),
            totalSeries: bundledCatalog.length,
            historyFirstDate: null,
            historyLastDate: null,
            versionHash: `bundled-${bundledCatalog.length}`,
            source: "Bundled query index",
          });
          setReady(true);
        });
      }, 260);

      const [{ catalog: cachedCatalog, tags: cachedTags, history: cachedHistory, recommendationFeatures: cachedRecommendationFeatures }, meta] = await Promise.all([
        cachedDataPromise,
        metaPromise,
      ]);
      cacheResolved = true;
      window.clearTimeout(bundledTimer);
      if (cachedCatalog.length > 0) {
        setCatalog(cachedCatalog);
        setTags(cachedTags);
        setHistory(cachedHistory);
        setRecommendationFeatures(cachedRecommendationFeatures);
        setSyncMeta(meta);
      } else if (!showedBundled) {
        const bundledCatalog = await bundledCatalogPromise;
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
      }
      setReady(true);
      const hasLiveMergedCatalog = meta?.versionHash?.includes("live-merged");
      const hasQueryDates = cachedCatalog.some((item) => item.published?.start_date || item.published?.end_date);
      const online = typeof navigator === "undefined" || navigator.onLine;
      if (cachedCatalog.length === 0 || !hasQueryDates || !hasLiveMergedCatalog || online) {
        await refreshData();
      }
    })();
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

  useEffect(() => {
    localStorage.setItem(TITLE_OVERRIDES_KEY, JSON.stringify(titleOverrides));
  }, [titleOverrides]);

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

  const setTitleOverride = useCallback((id: number, title: string) => {
    const clean = title.trim();
    setTitleOverrides((current) => {
      if (!clean) {
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: clean };
    });
  }, []);

  const clearTitleOverride = useCallback((id: number) => {
    setTitleOverrides((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const resetLocalState = useCallback(async () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TITLE_OVERRIDES_KEY);
    await db.details.clear();
    setFeeds([]);
    setFolders([]);
    setLabels([]);
    setSettings(DEFAULT_SETTINGS);
    setActiveFeedId(null);
    setTitleOverrides({});
  }, []);

  const importSnapshot = useCallback((snapshot: Partial<AppStateSnapshot>, mode: "merge" | "replace") => {
    if (mode === "replace") {
      setFeeds((snapshot.feeds ?? []).map((feed) => normalizeFeed(feed, { preserveMetricSlots: true })));
      setFolders(snapshot.folders ?? []);
      setLabels(snapshot.labels ?? []);
      setSettings(mergeSettings(snapshot.settings));
      setActiveFeedId(snapshot.activeFeedId ?? null);
      return;
    }
    setFeeds((current) => [
      ...current,
      ...(snapshot.feeds ?? []).map((feed) => normalizeFeed(feed, { preserveMetricSlots: true })),
    ]);
    setFolders((current) => [...current, ...(snapshot.folders ?? [])]);
    setLabels((current) => [...current, ...(snapshot.labels ?? [])]);
    if (snapshot.settings) setSettings((current) => mergeSettings({ ...current, ...snapshot.settings }));
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
      titleOverrides,
      syncStatus,
      setActiveFeedId,
      setTitleOverride,
      clearTitleOverride,
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
      titleOverrides,
      syncStatus,
      setActiveFeedId,
      setTitleOverride,
      clearTitleOverride,
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
