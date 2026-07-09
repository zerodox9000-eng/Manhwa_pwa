import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SENSITIVE_EXCLUDE_TAG_IDS, DEFAULT_SETTINGS, makeId } from "../domain/defaults";
import defaultFeedSegmentsJson from "../domain/defaultFeedSegments.generated.json";
import defaultFeedsJson from "../domain/defaultFeeds.generated.json";
import defaultSettingsJson from "../domain/defaultSettings.generated.json";
import { feedUsesAniListOnlyParameters } from "../domain/query";
import { builtInSensitiveFeeds, builtInSensitiveSegments, mergeBuiltInSensitiveDefaults } from "../domain/sensitiveFeedSegments";
import { parseAppStateSnapshot, parseSettings } from "../domain/validation";
import type {
  AppSettings,
  AppStateSnapshot,
  Feed,
  FeedSegment,
  Folder,
  HistoryMap,
  RecommendationFeature,
  SeriesCatalog,
  SyncMeta,
  TagNode,
  UserLabel,
} from "../domain/types";
import { db, loadSyncMeta } from "../db/appDb";
import { checkFrontendDataVersion, loadCachedData, syncFrontendData } from "../services/dataService";

const STORAGE_KEY = "manhwa-library-state-v1";
const THREE_COLUMN_FEEDS_MIGRATION_KEY = "manhwa-three-column-feeds-v1";
const DEFAULT_FEED_LIBRARY_VERSION_KEY = "manhwa-default-feed-library-version";
const DEFAULT_FEED_LIBRARY_VERSION = "backup-4-segmented-v4";
const SENSITIVE_FEED_SEGMENTS_VERSION_KEY = "manhwa-sensitive-feed-segments-version";
const SENSITIVE_FEED_SEGMENTS_VERSION = "v1";
export const UNSEGMENTED_FEED_SEGMENT_ID = "unsegmented";

function shortDataVersion(versionHash: string | null | undefined) {
  if (!versionHash) return "none";
  return versionHash.replace(/^chunked-v1-/, "v1-").replace(/^live-merged-/, "legacy-").slice(0, 22);
}

interface StoreState {
  ready: boolean;
  catalog: SeriesCatalog[];
  tags: TagNode[];
  history: HistoryMap;
  recommendationFeatures: RecommendationFeature[];
  syncMeta: SyncMeta | null;
  feeds: Feed[];
  feedSegments: FeedSegment[];
  folders: Folder[];
  labels: UserLabel[];
  settings: AppSettings;
  activeFeedId: string | null;
  syncStatus: string;
  syncInFlight: boolean;
  setActiveFeedId: (id: string | null) => void;
  upsertFeed: (feed: Feed) => void;
  deleteFeed: (id: string) => void;
  moveFeed: (id: string, targetId: string) => void;
  moveFeedToSegment: (id: string, segmentId: string) => void;
  createFeedSegment: (name?: string) => void;
  updateFeedSegment: (id: string, patch: Partial<Pick<FeedSegment, "name" | "collapsed" | "hiddenFromHome">>) => void;
  deleteFeedSegment: (id: string) => void;
  deleteFeedSegmentWithFeeds: (id: string) => void;
  moveFeedSegment: (id: string, targetId: string) => void;
  upsertFolder: (folder: Folder) => void;
  deleteFolder: (id: string) => void;
  upsertLabel: (label: UserLabel) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  refreshData: (options?: { force?: boolean }) => Promise<void>;
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

export function normalizeFeed(feed: Feed, options: { preserveMetricSlots?: boolean; preserveFeedSettings?: boolean } = {}): Feed {
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
      labelIds: options.preserveFeedSettings ? feed.filters.labelIds ?? [] : [],
      query: options.preserveFeedSettings ? feed.filters.query ?? "" : "",
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
        labels: options.preserveFeedSettings ? feed.view?.visible?.labels ?? false : false,
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

function createSegment(name = "New Segment", feedIds: string[] = []): FeedSegment {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    name,
    feedIds,
    collapsed: false,
    hiddenFromHome: false,
    createdAt: now,
    updatedAt: now,
  };
}

function unsegmentedSegment(feedIds: string[] = []): FeedSegment {
  const now = new Date().toISOString();
  return {
    id: UNSEGMENTED_FEED_SEGMENT_ID,
    name: "Unsegmented",
    feedIds,
    collapsed: false,
    hiddenFromHome: false,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeFeedSegments(feeds: Feed[], segments?: FeedSegment[]): FeedSegment[] {
  const feedIdSet = new Set(feeds.map((feed) => feed.id));
  const assigned = new Set<string>();
  const normalized: FeedSegment[] = [];
  const source = segments?.length ? segments : [unsegmentedSegment(feeds.map((feed) => feed.id))];
  let hasUnsegmented = false;

  for (const segment of source) {
    const id = segment.id || makeId();
    const feedIds: string[] = [];
    for (const feedId of segment.feedIds ?? []) {
      if (!feedIdSet.has(feedId) || assigned.has(feedId)) continue;
      assigned.add(feedId);
      feedIds.push(feedId);
    }
    if (id === UNSEGMENTED_FEED_SEGMENT_ID) hasUnsegmented = true;
    normalized.push({
      id,
      name: id === UNSEGMENTED_FEED_SEGMENT_ID ? "Unsegmented" : segment.name || "New Segment",
      feedIds,
      collapsed: Boolean(segment.collapsed),
      hiddenFromHome: Boolean(segment.hiddenFromHome),
      createdAt: segment.createdAt || new Date().toISOString(),
      updatedAt: segment.updatedAt || segment.createdAt || new Date().toISOString(),
    });
  }

  if (!hasUnsegmented) normalized.unshift(unsegmentedSegment());
  const unsegmented = normalized.find((segment) => segment.id === UNSEGMENTED_FEED_SEGMENT_ID) ?? normalized[0];
  for (const feed of feeds) {
    if (!assigned.has(feed.id)) unsegmented.feedIds.push(feed.id);
  }

  return normalized;
}

function orderFeedsBySegments(feeds: Feed[], segments: FeedSegment[]) {
  const byId = new Map(feeds.map((feed) => [feed.id, feed]));
  const seen = new Set<string>();
  const ordered: Feed[] = [];
  for (const segment of segments) {
    for (const feedId of segment.feedIds) {
      const feed = byId.get(feedId);
      if (!feed || seen.has(feedId)) continue;
      seen.add(feedId);
      ordered.push(feed);
    }
  }
  for (const feed of feeds) {
    if (!seen.has(feed.id)) ordered.push(feed);
  }
  return ordered;
}

function defaultFeeds() {
  return [...(defaultFeedsJson as Feed[]), ...builtInSensitiveFeeds()].map((feed) =>
    normalizeFeed(feed, { preserveMetricSlots: true, preserveFeedSettings: true }),
  );
}

function defaultFeedSegments(feeds: Feed[]) {
  return normalizeFeedSegments(feeds, [...(defaultFeedSegmentsJson as FeedSegment[]), ...builtInSensitiveSegments()]);
}

function defaultSettings() {
  return mergeSettings(defaultSettingsJson as Partial<AppSettings>);
}

function shouldReplaceSavedFeeds(hasSavedState: boolean) {
  if (!hasSavedState) return false;
  return localStorage.getItem(DEFAULT_FEED_LIBRARY_VERSION_KEY) !== DEFAULT_FEED_LIBRARY_VERSION;
}

const AppStoreContext = createContext<StoreState | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const local = useMemo(loadLocalSnapshot, []);
  const hasSavedState = useMemo(() => localStorage.getItem(STORAGE_KEY) != null, []);
  const replaceDefaultLikeSavedFeeds = useMemo(
    () => shouldReplaceSavedFeeds(hasSavedState),
    [hasSavedState],
  );
  const shouldInstallSensitiveFeedSegments = useMemo(
    () => hasSavedState && !replaceDefaultLikeSavedFeeds && localStorage.getItem(SENSITIVE_FEED_SEGMENTS_VERSION_KEY) !== SENSITIVE_FEED_SEGMENTS_VERSION,
    [hasSavedState, replaceDefaultLikeSavedFeeds],
  );
  const initialFeeds = useMemo(
    () => {
      if (replaceDefaultLikeSavedFeeds || !hasSavedState) return defaultFeeds();
      const savedFeeds = (local.feeds ?? []).map((feed) => normalizeFeed(feed));
      const merged = shouldInstallSensitiveFeedSegments
        ? mergeBuiltInSensitiveDefaults(savedFeeds, local.feedSegments ?? []).feeds
        : savedFeeds;
      return merged.map((feed) => normalizeFeed(feed, { preserveMetricSlots: true, preserveFeedSettings: true }));
    },
    [hasSavedState, local.feedSegments, local.feeds, replaceDefaultLikeSavedFeeds, shouldInstallSensitiveFeedSegments],
  );
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
    const normalizedFeeds = initialFeeds;
    if (!shouldMigrateFeedsToThreeColumns || replaceDefaultLikeSavedFeeds || !hasSavedState) return normalizedFeeds;
    return normalizedFeeds.map((feed) => ({ ...feed, view: { ...feed.view, gridColumns: 3 } }));
  });
  const [feedSegments, setFeedSegments] = useState<FeedSegment[]>(() => {
    if (replaceDefaultLikeSavedFeeds || !hasSavedState) return defaultFeedSegments(initialFeeds);
    const sourceSegments = shouldInstallSensitiveFeedSegments
      ? mergeBuiltInSensitiveDefaults(initialFeeds, local.feedSegments ?? []).segments
      : local.feedSegments;
    return normalizeFeedSegments(initialFeeds, sourceSegments);
  });
  const [folders, setFolders] = useState<Folder[]>(local.folders ?? []);
  const [labels, setLabels] = useState<UserLabel[]>(local.labels ?? []);
  const [settings, setSettings] = useState<AppSettings>(() =>
    replaceDefaultLikeSavedFeeds || !hasSavedState
      ? defaultSettings()
      : mergeSettings(parseSettings(local.settings) ?? local.settings),
  );
  const [activeFeedId, setActiveFeedId] = useState<string | null>(local.activeFeedId ?? null);
  const [syncStatus, setSyncStatus] = useState("");
  const [syncInFlight, setSyncInFlight] = useState(false);
  const syncInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (shouldMigrateFeedsToThreeColumns) {
      localStorage.setItem(THREE_COLUMN_FEEDS_MIGRATION_KEY, "1");
    }
    if (replaceDefaultLikeSavedFeeds || !hasSavedState) {
      localStorage.setItem(DEFAULT_FEED_LIBRARY_VERSION_KEY, DEFAULT_FEED_LIBRARY_VERSION);
    }
    if (shouldInstallSensitiveFeedSegments || !hasSavedState) {
      localStorage.setItem(SENSITIVE_FEED_SEGMENTS_VERSION_KEY, SENSITIVE_FEED_SEGMENTS_VERSION);
    }
  }, [hasSavedState, replaceDefaultLikeSavedFeeds, shouldInstallSensitiveFeedSegments, shouldMigrateFeedsToThreeColumns]);

  useEffect(() => {
    void (async () => {
      const cachedDataPromise = loadCachedData();
      const metaPromise = loadSyncMeta();
      const [{ catalog: cachedCatalog, tags: cachedTags, history: cachedHistory, recommendationFeatures: cachedRecommendationFeatures }, meta] = await Promise.all([
        cachedDataPromise,
        metaPromise,
      ]);
      const hasQueryDates = cachedCatalog.some((item) => item.published?.start_date || item.published?.end_date);
      const online = typeof navigator === "undefined" || navigator.onLine;
      const hasUsableCache = cachedCatalog.length > 0 && hasQueryDates && Boolean(meta?.versionHash);
      let remote: Awaited<ReturnType<typeof checkFrontendDataVersion>> | null = null;

      if (online) {
        try {
          setSyncStatus("Checking library version");
          remote = await checkFrontendDataVersion(settings.dataSourceUrl);
        } catch (error) {
          setSyncStatus(error instanceof Error ? error.message : "Version check failed");
        }
      }

      const cacheMatchesRemote = Boolean(
        remote?.versionHash &&
        meta?.versionHash &&
        remote.versionHash === meta.versionHash,
      );
      const canShowCachedData = hasUsableCache && (!online || !remote?.versionHash || cacheMatchesRemote);

      if (canShowCachedData) {
        setCatalog(cachedCatalog);
        setTags(cachedTags);
        setHistory(cachedHistory);
        setRecommendationFeatures(cachedRecommendationFeatures);
        setSyncMeta(meta);
        setReady(true);
      } else if (hasUsableCache && remote?.versionHash && meta?.versionHash && remote.versionHash !== meta.versionHash) {
        setSyncMeta(meta);
        setSyncStatus(`Updating ${shortDataVersion(meta.versionHash)} -> ${shortDataVersion(remote.versionHash)}`);
      }

      if (!hasUsableCache || (remote?.versionHash && remote.versionHash !== meta?.versionHash)) {
        await refreshData({ force: true });
        setReady(true);
      } else if (online && remote?.versionHash && cacheMatchesRemote) {
        setSyncStatus("Library already current");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setFeedSegments((current) => normalizeFeedSegments(feeds, current));
  }, [feeds]);

  useEffect(() => {
    const snapshot: AppStateSnapshot = {
      feeds,
      feedSegments,
      folders,
      labels,
      settings,
      activeFeedId,
      lastRoute: window.location.hash,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [feeds, feedSegments, folders, labels, settings, activeFeedId]);

  const refreshData = useCallback((options?: { force?: boolean }) => {
    if (syncInFlightRef.current) return syncInFlightRef.current;

    const task = (async () => {
      setSyncInFlight(true);
      setSyncStatus("Checking library version");
      try {
        if (!options?.force) {
          const [remote, latestMeta] = await Promise.all([
            checkFrontendDataVersion(settings.dataSourceUrl),
            loadSyncMeta(),
          ]);
          const currentVersion = latestMeta?.versionHash ?? syncMeta?.versionHash;
          const hasCachedCatalog = catalog.length > 0 || Number(latestMeta?.totalSeries ?? 0) > 0;
          if (remote.versionHash && currentVersion === remote.versionHash && hasCachedCatalog) {
            if (latestMeta && latestMeta.versionHash !== syncMeta?.versionHash) setSyncMeta(latestMeta);
            setSyncStatus("Library already current");
            return;
          }
          setSyncStatus(`Updating ${shortDataVersion(currentVersion)} -> ${shortDataVersion(remote.versionHash)}`);
        }
        setSyncStatus("Starting sync");
        const synced = await syncFrontendData(settings.dataSourceUrl, setSyncStatus);
        setSyncMeta(synced.meta);
        setSettings((current) => ({ ...current, dataSourceUrl: synced.meta.source }));
        startTransition(() => {
          setCatalog(synced.catalog);
          setTags(synced.tags);
          setHistory(synced.history);
          setRecommendationFeatures(synced.recommendationFeatures);
        });
        setSyncStatus("Sync complete");
      } catch (error) {
        setSyncStatus(error instanceof Error ? error.message : "Sync failed");
      }
    })();

    syncInFlightRef.current = task.finally(() => {
      syncInFlightRef.current = null;
      setSyncInFlight(false);
    });
    return syncInFlightRef.current;
  }, [catalog.length, settings.dataSourceUrl, syncMeta?.versionHash]);

  const upsertFeed = useCallback((feed: Feed) => {
    const updated = normalizeFeed({ ...feed, updatedAt: new Date().toISOString() });
    setFeeds((current) => {
      const exists = current.some((item) => item.id === feed.id);
      return exists ? current.map((item) => (item.id === feed.id ? updated : item)) : [...current, updated];
    });
    setFeedSegments((current) => {
      if (current.some((segment) => segment.feedIds.includes(updated.id))) return current;
      const normalized = current.length ? current : [unsegmentedSegment()];
      const targetIndex = Math.max(0, normalized.length - 1);
      return normalized.map((segment, index) =>
        index === targetIndex ? { ...segment, feedIds: [...segment.feedIds, updated.id], updatedAt: new Date().toISOString() } : segment,
      );
    });
    setActiveFeedId((current) => current ?? updated.id);
  }, []);

  const deleteFeed = useCallback((id: string) => {
    setFeeds((current) => current.filter((feed) => feed.id !== id));
    setFeedSegments((current) =>
      current.map((segment) => ({ ...segment, feedIds: segment.feedIds.filter((feedId) => feedId !== id) })),
    );
    setActiveFeedId((current) => (current === id ? null : current));
  }, []);

  const moveFeed = useCallback((id: string, targetId: string) => {
    setFeedSegments((current) => {
      let sourceIndex = -1;
      let targetIndex = -1;
      current.forEach((segment, index) => {
        if (segment.feedIds.includes(id)) sourceIndex = index;
        if (segment.feedIds.includes(targetId)) targetIndex = index;
      });
      if (sourceIndex < 0 || targetIndex < 0 || id === targetId) return current;
      const sourceLocalIndex = current[sourceIndex].feedIds.indexOf(id);
      const targetLocalIndex = current[targetIndex].feedIds.indexOf(targetId);
      const next = current.map((segment) => ({ ...segment, feedIds: segment.feedIds.filter((feedId) => feedId !== id) }));
      const insertAt = sourceIndex === targetIndex && sourceLocalIndex < targetLocalIndex
        ? targetLocalIndex
        : next[targetIndex].feedIds.indexOf(targetId);
      next[targetIndex] = {
        ...next[targetIndex],
        feedIds: [
          ...next[targetIndex].feedIds.slice(0, insertAt < 0 ? next[targetIndex].feedIds.length : insertAt),
          id,
          ...next[targetIndex].feedIds.slice(insertAt < 0 ? next[targetIndex].feedIds.length : insertAt),
        ],
        updatedAt: new Date().toISOString(),
      };
      setFeeds((feedsCurrent) => orderFeedsBySegments(feedsCurrent, next));
      return next;
    });
  }, []);

  const moveFeedToSegment = useCallback((id: string, segmentId: string) => {
    setFeedSegments((current) => {
      const targetIndex = current.findIndex((segment) => segment.id === segmentId);
      if (targetIndex < 0) return current;
      const next = current.map((segment) => ({ ...segment, feedIds: segment.feedIds.filter((feedId) => feedId !== id) }));
      next[targetIndex] = {
        ...next[targetIndex],
        feedIds: [...next[targetIndex].feedIds, id],
        updatedAt: new Date().toISOString(),
      };
      setFeeds((feedsCurrent) => orderFeedsBySegments(feedsCurrent, next));
      return next;
    });
  }, []);

  const createFeedSegment = useCallback((name = "New Segment") => {
    setFeedSegments((current) => [...normalizeFeedSegments(feeds, current), createSegment(name)]);
  }, [feeds]);

  const updateFeedSegment = useCallback((id: string, patch: Partial<Pick<FeedSegment, "name" | "collapsed" | "hiddenFromHome">>) => {
    setFeedSegments((current) =>
      current.map((segment) =>
        segment.id === id
          ? {
              ...segment,
              ...patch,
              name: segment.id === UNSEGMENTED_FEED_SEGMENT_ID ? "Unsegmented" : patch.name ?? segment.name,
              updatedAt: new Date().toISOString(),
            }
          : segment,
      ),
    );
  }, []);

  const deleteFeedSegment = useCallback((id: string) => {
    if (id === UNSEGMENTED_FEED_SEGMENT_ID) return;
    setFeedSegments((current) => current.filter((segment) => segment.id !== id || segment.feedIds.length > 0));
  }, []);

  const deleteFeedSegmentWithFeeds = useCallback((id: string) => {
    if (id === UNSEGMENTED_FEED_SEGMENT_ID) return;
    const segment = feedSegments.find((item) => item.id === id);
    if (!segment) return;
    const removedFeedIds = new Set(segment.feedIds);
    setFeedSegments((current) => current.filter((item) => item.id !== id));
    setFeeds((current) => current.filter((feed) => !removedFeedIds.has(feed.id)));
    setActiveFeedId((current) => (current && removedFeedIds.has(current) ? null : current));
  }, [feedSegments]);

  const moveFeedSegment = useCallback((id: string, targetId: string) => {
    setFeedSegments((current) => {
      const from = current.findIndex((segment) => segment.id === id);
      const to = current.findIndex((segment) => segment.id === targetId);
      if (from < 0 || to < 0 || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setFeeds((feedsCurrent) => orderFeedsBySegments(feedsCurrent, next));
      return next;
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
    const nextFeeds = defaultFeeds();
    setFeeds(nextFeeds);
    setFeedSegments(defaultFeedSegments(nextFeeds));
    setFolders([]);
    setLabels([]);
    setSettings(defaultSettings());
    setActiveFeedId(nextFeeds[0]?.id ?? null);
    localStorage.setItem(DEFAULT_FEED_LIBRARY_VERSION_KEY, DEFAULT_FEED_LIBRARY_VERSION);
    localStorage.setItem(SENSITIVE_FEED_SEGMENTS_VERSION_KEY, SENSITIVE_FEED_SEGMENTS_VERSION);
  }, []);

  const importSnapshot = useCallback((snapshot: Partial<AppStateSnapshot>, mode: "merge" | "replace") => {
    const safeSnapshot = parseAppStateSnapshot(snapshot) ?? snapshot;
    if (mode === "replace") {
      const nextFeeds = (safeSnapshot.feeds ?? []).map((feed) => normalizeFeed(feed, { preserveMetricSlots: true }));
      setFeeds(nextFeeds);
      setFeedSegments(normalizeFeedSegments(nextFeeds, safeSnapshot.feedSegments));
      setFolders(safeSnapshot.folders ?? []);
      setLabels(safeSnapshot.labels ?? []);
      setSettings(mergeSettings(safeSnapshot.settings ? parseSettings(safeSnapshot.settings) ?? safeSnapshot.settings : undefined));
      setActiveFeedId(safeSnapshot.activeFeedId ?? null);
      return;
    }
    const sourceFeeds = (safeSnapshot.feeds ?? []).map((feed) => normalizeFeed(feed, { preserveMetricSlots: true }));
    const importedIdMap = new Map(sourceFeeds.map((feed) => [feed.id, makeId()]));
    const incomingFeeds = sourceFeeds.map((feed) => ({ ...feed, id: importedIdMap.get(feed.id) ?? makeId() }));
    const incomingSegments = safeSnapshot.feedSegments?.length
      ? safeSnapshot.feedSegments.map((segment) => ({
          ...segment,
          id: makeId(),
          feedIds: (segment.feedIds ?? []).flatMap((feedId) => {
            const nextId = importedIdMap.get(feedId);
            return nextId ? [nextId] : [];
          }),
        }))
      : [createSegment("Imported", incomingFeeds.map((feed) => feed.id))];
    setFeeds((current) => [...current, ...incomingFeeds]);
    setFeedSegments((current) => {
      const normalized = current.length ? current : [unsegmentedSegment()];
      return normalizeFeedSegments([...feeds, ...incomingFeeds], [...normalized, ...incomingSegments]);
    });
    setFolders((current) => [...current, ...(safeSnapshot.folders ?? [])]);
    setLabels((current) => [...current, ...(safeSnapshot.labels ?? [])]);
    if (safeSnapshot.settings && incomingFeeds.length === 0 && incomingSegments.every((segment) => segment.feedIds.length === 0)) {
      setSettings((current) => mergeSettings({ ...current, ...(parseSettings(safeSnapshot.settings) ?? safeSnapshot.settings) }));
    }
  }, [feeds]);

  const value = useMemo<StoreState>(
    () => ({
      ready,
      catalog,
      tags,
      history,
      recommendationFeatures,
      syncMeta,
      feeds,
      feedSegments,
      folders,
      labels,
      settings,
      activeFeedId,
      syncStatus,
      syncInFlight,
      setActiveFeedId,
      upsertFeed,
      deleteFeed,
      moveFeed,
      moveFeedToSegment,
      createFeedSegment,
      updateFeedSegment,
      deleteFeedSegment,
      deleteFeedSegmentWithFeeds,
      moveFeedSegment,
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
      feedSegments,
      folders,
      labels,
      settings,
      activeFeedId,
      syncStatus,
      syncInFlight,
      setActiveFeedId,
      upsertFeed,
      deleteFeed,
      moveFeed,
      moveFeedToSegment,
      createFeedSegment,
      updateFeedSegment,
      deleteFeedSegment,
      deleteFeedSegmentWithFeeds,
      moveFeedSegment,
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
