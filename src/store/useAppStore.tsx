import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SENSITIVE_EXCLUDE_TAG_IDS, DEFAULT_SETTINGS } from "../domain/defaults";
import defaultFeedsJson from "../domain/defaultFeeds.generated.json";
import {
  DEFAULT_HOME_SOURCE,
  canMoveFeedToFolder,
  canMoveFolder,
  createFeedFolder,
  descendantFolderIds,
  feedLocation,
  normalizeFeedFolders,
} from "../domain/feedLibrary";
import { feedUsesAniListOnlyParameters } from "../domain/query";
import { parseAppStateSnapshot, parseSettings } from "../domain/validation";
import type {
  AppSettings,
  AppStateSnapshot,
  Feed,
  FeedFolder,
  HistoryMap,
  HomeSource,
  Profile,
  ProfileSeedMode,
  ProfileSessionState,
  ProfileState,
  ProfilesBackup,
  RecommendationFeature,
  SeriesCatalog,
  SyncMeta,
  TagNode,
  UserLabel,
} from "../domain/types";
import { db, loadSyncMeta, profileDb } from "../db/appDb";
import { loadBundledCatalog, loadCachedData, syncFrontendData } from "../services/dataService";
import {
  ACTIVE_PROFILE_KEY,
  LEGACY_STATE_KEY,
  createProfileRecord,
  createProfileState,
  deleteProfileRecord,
  loadProfileState,
  makeProfilesBackup,
  migrateLegacyProfile,
  saveProfile,
} from "./profilePersistence";

const STORAGE_KEY = LEGACY_STATE_KEY;
const THREE_COLUMN_FEEDS_MIGRATION_KEY = "manhwa-three-column-feeds-v1";
const PROFILE_WRITE_DELAY_MS = 180;
const PROFILE_RUNTIME_CACHE_KEY = "manhwa-profile-runtime-v1";
export const MAX_PROFILES = 5;

function persistInBackground(promise: Promise<unknown>) {
  void promise.catch((error) => console.error("Profile persistence failed", error));
}

interface ProfileRuntimeCache {
  activeProfile: Profile;
  profiles: Profile[];
  state: ProfileState;
}

function loadProfileRuntimeCache(): ProfileRuntimeCache | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PROFILE_RUNTIME_CACHE_KEY) ?? "null") as ProfileRuntimeCache | null;
    if (!value?.activeProfile?.id || value.state?.profileId !== value.activeProfile.id || !Array.isArray(value.profiles)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

interface StoreState {
  ready: boolean;
  profileReady: boolean;
  catalog: SeriesCatalog[];
  tags: TagNode[];
  history: HistoryMap;
  recommendationFeatures: RecommendationFeature[];
  syncMeta: SyncMeta | null;
  profiles: Profile[];
  activeProfile: Profile;
  profileSession: ProfileSessionState;
  feeds: Feed[];
  folders: FeedFolder[];
  homeSource: HomeSource;
  labels: UserLabel[];
  settings: AppSettings;
  activeFeedId: string | null;
  syncStatus: string;
  switchProfile: (id: string) => Promise<void>;
  createProfile: (name: string, mode: ProfileSeedMode) => Promise<Profile>;
  renameProfile: (id: string, name: string) => Promise<void>;
  duplicateProfile: (id: string, name?: string) => Promise<Profile>;
  deleteProfile: (id: string) => Promise<void>;
  updateProfileSession: (patch: Partial<ProfileSessionState>) => void;
  setSearchHistory: (history: string[]) => void;
  setOpenedTitleIds: (ids: number[]) => void;
  exportActiveProfile: () => ProfileState;
  exportAllProfiles: () => Promise<ProfilesBackup>;
  setActiveFeedId: (id: string | null) => void;
  upsertFeed: (feed: Feed) => void;
  deleteFeed: (id: string) => void;
  moveFeed: (id: string, targetId: string) => void;
  createFolder: (name: string, parentId: string | null, migrateParentFeeds?: boolean) => FeedFolder;
  renameFolder: (id: string, name: string) => void;
  moveFeedToFolder: (feedId: string, folderId: string | null, targetIndex?: number) => void;
  moveFolder: (folderId: string, parentId: string | null, targetIndex?: number) => void;
  duplicateFeed: (feedId: string, folderId?: string | null) => Feed | null;
  deleteFolder: (id: string, preserveFeeds: boolean) => void;
  updateHomeSource: (source: HomeSource) => void;
  upsertLabel: (label: UserLabel) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  refreshData: () => Promise<void>;
  resetCurrentProfile: () => Promise<void>;
  resetEntireApp: () => Promise<void>;
  importSnapshot: (snapshot: Partial<AppStateSnapshot>, mode: "merge" | "replace") => void;
}

const FALLBACK_PROFILE: Profile = {
  id: "loading",
  name: "User 1",
  accentColor: DEFAULT_SETTINGS.accentColor,
  createdAt: "",
  updatedAt: "",
  lastUsedAt: "",
};

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

function loadLegacySession(): Partial<ProfileSessionState> {
  const readArray = <T,>(key: string): T[] => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(value) ? value as T[] : [];
    } catch {
      return [];
    }
  };
  try {
    const route = JSON.parse(localStorage.getItem("manhwa-library-route-v1") ?? "{}") as {
      path?: string;
      scroll?: Record<string, number>;
    };
    return {
      lastRoute: route.path || "#/",
      scroll: route.scroll ?? {},
      searchHistory: readArray<string>("manhwa-search-history"),
      openedTitleIds: readArray<number>("manhwa-search-opened-titles"),
      searchQuery: sessionStorage.getItem("manhwa-search-query") ?? "",
    };
  } catch {
    return {
      searchHistory: readArray<string>("manhwa-search-history"),
      openedTitleIds: readArray<number>("manhwa-search-opened-titles"),
      searchQuery: sessionStorage.getItem("manhwa-search-query") ?? "",
    };
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
  const legacySession = useMemo(loadLegacySession, []);
  const runtimeCache = useMemo(loadProfileRuntimeCache, []);
  const hasSavedState = useMemo(() => localStorage.getItem(STORAGE_KEY) != null, []);
  const shouldMigrateFeedsToThreeColumns = useMemo(
    () => localStorage.getItem(THREE_COLUMN_FEEDS_MIGRATION_KEY) !== "1",
    [],
  );
  const [dataReady, setDataReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [catalog, setCatalog] = useState<SeriesCatalog[]>([]);
  const [tags, setTags] = useState<TagNode[]>([]);
  const [history, setHistory] = useState<HistoryMap>({});
  const [recommendationFeatures, setRecommendationFeatures] = useState<RecommendationFeature[]>([]);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);
  const defaultFeeds = useMemo(
    () => (defaultFeedsJson as Feed[]).map((feed) => {
      const normalized = normalizeFeed(feed);
      return { ...normalized, view: { ...normalized.view, gridColumns: 3 as const } };
    }),
    [],
  );
  const initialFeeds = useMemo(() => {
    if (!hasSavedState) return defaultFeeds;
    const normalizedFeeds = (local.feeds ?? []).map((feed) => normalizeFeed(feed));
    if (!shouldMigrateFeedsToThreeColumns) return normalizedFeeds;
    return normalizedFeeds.map((feed) => ({ ...feed, view: { ...feed.view, gridColumns: 3 as const } }));
  }, [defaultFeeds, hasSavedState, local.feeds, shouldMigrateFeedsToThreeColumns]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile>(FALLBACK_PROFILE);
  const [profileSession, setProfileSession] = useState<ProfileSessionState>({
    lastRoute: "#/",
    scroll: {},
    searchHistory: [],
    openedTitleIds: [],
    searchQuery: "",
  });
  const [feeds, setFeeds] = useState<Feed[]>(initialFeeds);
  const [folders, setFolders] = useState<FeedFolder[]>(() => normalizeFeedFolders(local.folders, new Set(initialFeeds.map((feed) => feed.id))));
  const [homeSource, setHomeSource] = useState<HomeSource>(local.homeSource ?? DEFAULT_HOME_SOURCE);
  const [labels, setLabels] = useState<UserLabel[]>(local.labels ?? []);
  const [settings, setSettings] = useState<AppSettings>(mergeSettings(parseSettings(local.settings) ?? local.settings));
  const [activeFeedId, setActiveFeedId] = useState<string | null>(local.activeFeedId ?? null);
  const [syncStatus, setSyncStatus] = useState("");
  const writeTimerRef = useRef<number | null>(null);
  const runtimeCacheTimerRef = useRef<number | null>(null);
  const writeInFlightRef = useRef<Promise<void> | null>(null);
  const pendingWriteRef = useRef<{ profile: Profile; state: ProfileState } | null>(null);
  const currentProfileRef = useRef(activeProfile);
  const currentProfileStateRef = useRef<ProfileState | null>(null);
  const profileCacheRef = useRef(new Map<string, Profile>());
  const profileStateCacheRef = useRef(new Map<string, ProfileState>());
  const switchingProfileRef = useRef(false);

  const applyProfileState = useCallback((profile: Profile, state: ProfileState) => {
    setActiveProfile(profile);
    setFeeds(state.feeds.map((feed) => normalizeFeed(feed, { preserveMetricSlots: true })));
    const normalizedFolders = normalizeFeedFolders(state.folders, new Set(state.feeds.map((feed) => feed.id)));
    setFolders(normalizedFolders);
    setHomeSource(
      state.homeSource?.kind === "folder" && !normalizedFolders.some((folder) => folder.id === state.homeSource.folderId)
        ? DEFAULT_HOME_SOURCE
        : state.homeSource ?? DEFAULT_HOME_SOURCE,
    );
    setLabels(state.labels ?? []);
    setSettings(mergeSettings(state.settings));
    setActiveFeedId(state.activeFeedId ?? null);
    setProfileSession({
      lastRoute: state.session?.lastRoute || "#/",
      scroll: { ...(state.session?.scroll ?? {}) },
      searchHistory: [...(state.session?.searchHistory ?? [])],
      openedTitleIds: [...(state.session?.openedTitleIds ?? [])],
      searchQuery: state.session?.searchQuery ?? "",
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (runtimeCache) {
      runtimeCache.profiles.forEach((profile) => profileCacheRef.current.set(profile.id, profile));
      profileStateCacheRef.current.set(runtimeCache.activeProfile.id, runtimeCache.state);
      applyProfileState(runtimeCache.activeProfile, runtimeCache.state);
      setProfiles(runtimeCache.profiles);
      setProfileReady(true);
    }
    void (async () => {
      const discovered = await migrateLegacyProfile(hasSavedState ? local : null, {
        feeds: initialFeeds,
        settings: mergeSettings(parseSettings(local.settings) ?? local.settings),
        session: legacySession,
      });
      if (cancelled) return;
      const requestedId = runtimeCache?.activeProfile.id ?? localStorage.getItem(ACTIVE_PROFILE_KEY);
      const selected = runtimeCache?.activeProfile.id === requestedId
        ? runtimeCache.activeProfile
        : discovered.find((profile) => profile.id === requestedId) ?? discovered[0];
      discovered.forEach((profile) => profileCacheRef.current.set(profile.id, profile));
      const storedStates = await profileDb.profileStates.bulkGet(discovered.map((profile) => profile.id));
      if (cancelled) return;
      discovered.forEach((profile, index) => {
        const state = storedStates[index];
        if (state) profileStateCacheRef.current.set(profile.id, state);
      });
      const state = runtimeCache?.activeProfile.id === selected.id
        ? runtimeCache.state
        : profileStateCacheRef.current.get(selected.id) ?? createProfileState(selected.id, {
        feeds: initialFeeds,
        settings: DEFAULT_SETTINGS,
      });
      profileStateCacheRef.current.set(selected.id, state);
      const mergedProfiles = runtimeCache
        ? [
            ...discovered,
            ...runtimeCache.profiles.filter((profile) => !discovered.some((item) => item.id === profile.id)),
          ]
        : discovered;
      if (!runtimeCache) applyProfileState(selected, state);
      setProfiles(mergedProfiles);
      localStorage.setItem(ACTIVE_PROFILE_KEY, selected.id);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("manhwa-library-route-v1");
      localStorage.removeItem("manhwa-search-history");
      localStorage.removeItem("manhwa-search-opened-titles");
      sessionStorage.removeItem("manhwa-search-query");
      setProfileReady(true);
      if (runtimeCache) persistInBackground(saveProfile(runtimeCache.activeProfile, runtimeCache.state));
    })().catch((error) => {
      console.error("Profile migration failed", error);
      setProfileReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [applyProfileState, hasSavedState, initialFeeds, legacySession, local, runtimeCache]);

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
        setDataReady(true);

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
          setDataReady(true);
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
      setDataReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildCurrentProfileState = useCallback((): ProfileState => createProfileState(activeProfile.id, {
    feeds,
    folders,
    homeSource,
    labels,
    settings,
    activeFeedId,
    session: profileSession,
  }), [activeFeedId, activeProfile.id, feeds, folders, homeSource, labels, profileSession, settings]);

  useEffect(() => {
    currentProfileRef.current = activeProfile;
    currentProfileStateRef.current = activeProfile.id === "loading" ? null : buildCurrentProfileState();
    if (currentProfileStateRef.current) {
      profileStateCacheRef.current.set(activeProfile.id, currentProfileStateRef.current);
    }
    if (profileReady && currentProfileStateRef.current) {
      if (runtimeCacheTimerRef.current != null) window.clearTimeout(runtimeCacheTimerRef.current);
      const state = currentProfileStateRef.current;
      runtimeCacheTimerRef.current = window.setTimeout(() => {
        sessionStorage.setItem(PROFILE_RUNTIME_CACHE_KEY, JSON.stringify({
          activeProfile,
          profiles,
          state,
        } satisfies ProfileRuntimeCache));
      }, PROFILE_WRITE_DELAY_MS);
    }
  }, [activeProfile, buildCurrentProfileState, profileReady, profiles]);

  const flushProfileWrite = useCallback(async () => {
    if (writeTimerRef.current != null) {
      window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    const state = currentProfileStateRef.current;
    const profile = currentProfileRef.current;
    if (!state || profile.id === "loading") return;
    pendingWriteRef.current = { profile, state };
    if (!writeInFlightRef.current) {
      const writeLatest = async () => {
        while (pendingWriteRef.current) {
          const pending = pendingWriteRef.current;
          pendingWriteRef.current = null;
          await saveProfile(pending.profile, pending.state);
        }
      };
      const write = writeLatest().finally(() => {
        if (writeInFlightRef.current === write) writeInFlightRef.current = null;
      });
      writeInFlightRef.current = write;
    }
    await writeInFlightRef.current;
  }, []);

  useEffect(() => {
    if (!profileReady || switchingProfileRef.current) return;
    if (writeTimerRef.current != null) window.clearTimeout(writeTimerRef.current);
    writeTimerRef.current = window.setTimeout(() => {
      writeTimerRef.current = null;
      persistInBackground(flushProfileWrite());
    }, PROFILE_WRITE_DELAY_MS);
    return () => {
      if (writeTimerRef.current != null) window.clearTimeout(writeTimerRef.current);
    };
  }, [activeFeedId, activeProfile, feeds, flushProfileWrite, folders, homeSource, labels, profileReady, profileSession, settings]);

  useEffect(() => {
    const flush = () => {
      const state = currentProfileStateRef.current;
      if (state) {
        sessionStorage.setItem(PROFILE_RUNTIME_CACHE_KEY, JSON.stringify({
          activeProfile: currentProfileRef.current,
          profiles,
          state,
        } satisfies ProfileRuntimeCache));
      }
      persistInBackground(flushProfileWrite());
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      if (runtimeCacheTimerRef.current != null) window.clearTimeout(runtimeCacheTimerRef.current);
    };
  }, [flushProfileWrite, profiles]);

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

  const createFolder = useCallback((name: string, parentId: string | null, migrateParentFeeds = false) => {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Folder name is required.");
    const parent = parentId ? folders.find((folder) => folder.id === parentId) : null;
    if (parentId && !parent) throw new Error("Parent folder not found.");
    if (parent?.feedIds.length && !migrateParentFeeds) {
      throw new Error("Move the parent folder feeds into its first subfolder.");
    }
    const siblingCount = folders.filter((folder) => folder.parentId === parentId).length;
    const folder = createFeedFolder(cleanName, parentId, siblingCount);
    const prospectiveFolders = [
      ...folders.map((item) => (
        item.id === parentId && migrateParentFeeds
          ? { ...item, feedIds: [], childFolderIds: [...item.childFolderIds, folder.id] }
          : item
      )),
      folder,
    ];
    if (!canMoveFolder(folder.id, parentId, prospectiveFolders)) {
      throw new Error("Folders can be at most three levels deep.");
    }
    setFolders((current) => {
      const next = current.map((item) => {
        if (item.id !== parentId) return item;
        return {
          ...item,
          childFolderIds: [...item.childFolderIds, folder.id],
          feedIds: migrateParentFeeds ? [] : item.feedIds,
          updatedAt: new Date().toISOString(),
        };
      });
      return [...next, { ...folder, feedIds: migrateParentFeeds ? [...(parent?.feedIds ?? [])] : [] }];
    });
    return folder;
  }, [folders]);

  const renameFolder = useCallback((id: string, name: string) => {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Folder name is required.");
    setFolders((current) => current.map((folder) => (
      folder.id === id ? { ...folder, name: cleanName, updatedAt: new Date().toISOString() } : folder
    )));
  }, []);

  const moveFeedToFolder = useCallback((feedId: string, folderId: string | null, targetIndex?: number) => {
    if (!canMoveFeedToFolder(folderId, folders)) throw new Error("A folder with subfolders cannot also contain feeds.");
    setFolders((current) => current.map((folder) => {
      const without = folder.feedIds.filter((id) => id !== feedId);
      if (folder.id !== folderId) return without.length === folder.feedIds.length ? folder : { ...folder, feedIds: without };
      const index = Math.max(0, Math.min(targetIndex ?? without.length, without.length));
      const next = [...without];
      next.splice(index, 0, feedId);
      return { ...folder, feedIds: next, updatedAt: new Date().toISOString() };
    }));
    if (!folderId) {
      setFeeds((current) => {
        const sourceIndex = current.findIndex((feed) => feed.id === feedId);
        if (sourceIndex < 0) return current;
        const next = [...current];
        const [moved] = next.splice(sourceIndex, 1);
        const index = Math.max(0, Math.min(targetIndex ?? next.length, next.length));
        next.splice(index, 0, moved);
        return next;
      });
    }
  }, [folders]);

  const moveFolder = useCallback((folderId: string, parentId: string | null, targetIndex?: number) => {
    if (!canMoveFolder(folderId, parentId, folders)) throw new Error("That move would create a cycle or exceed three folder levels.");
    const now = new Date().toISOString();
    setFolders((current) => {
      const siblings = current
        .filter((folder) => folder.parentId === parentId && folder.id !== folderId)
        .sort((left, right) => left.order - right.order);
      const index = Math.max(0, Math.min(targetIndex ?? siblings.length, siblings.length));
      const ordered = [...siblings];
      const moved = current.find((folder) => folder.id === folderId);
      if (!moved) return current;
      ordered.splice(index, 0, { ...moved, parentId });
      const orderById = new Map(ordered.map((folder, order) => [folder.id, order]));
      return current.map((folder) => {
        if (folder.id === folderId) return { ...folder, parentId, order: orderById.get(folder.id) ?? folder.order, updatedAt: now };
        if (orderById.has(folder.id)) return { ...folder, order: orderById.get(folder.id)! };
        const childFolderIds = folder.childFolderIds.filter((id) => id !== folderId);
        if (folder.id === parentId) childFolderIds.push(folderId);
        return childFolderIds.length === folder.childFolderIds.length && folder.id !== parentId
          ? folder
          : { ...folder, childFolderIds, updatedAt: now };
      });
    });
  }, [folders]);

  const duplicateFeed = useCallback((feedId: string, requestedFolderId?: string | null) => {
    const source = feeds.find((feed) => feed.id === feedId);
    if (!source) return null;
    const now = new Date().toISOString();
    const copy = {
      ...structuredClone(source),
      id: globalThis.crypto?.randomUUID?.() ?? `feed-${Date.now()}`,
      name: `${source.name} Copy`,
      createdAt: now,
      updatedAt: now,
    };
    setFeeds((current) => {
      const index = current.findIndex((feed) => feed.id === feedId);
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
    const location = requestedFolderId === undefined ? feedLocation(feedId, folders) : requestedFolderId;
    if (location) {
      setFolders((current) => current.map((folder) => (
        folder.id === location ? { ...folder, feedIds: [...folder.feedIds, copy.id] } : folder
      )));
    }
    return copy;
  }, [feeds, folders]);

  const deleteFolder = useCallback((id: string, preserveFeeds: boolean) => {
    const removedIds = new Set([id, ...descendantFolderIds(id, folders)]);
    const removedFeedIds = folders.filter((folder) => removedIds.has(folder.id)).flatMap((folder) => folder.feedIds);
    setFolders((current) => current
      .filter((folder) => !removedIds.has(folder.id))
      .map((folder) => ({ ...folder, childFolderIds: folder.childFolderIds.filter((childId) => !removedIds.has(childId)) })));
    if (!preserveFeeds) {
      const feedIds = new Set(removedFeedIds);
      setFeeds((current) => current.filter((feed) => !feedIds.has(feed.id)));
      setActiveFeedId((current) => (current && feedIds.has(current) ? null : current));
    }
    setHomeSource((current) => (
      current.folderId && removedIds.has(current.folderId) ? DEFAULT_HOME_SOURCE : current
    ));
  }, [folders]);

  const updateHomeSource = useCallback((source: HomeSource) => {
    if (source.kind === "folder" && !folders.some((folder) => folder.id === source.folderId)) {
      throw new Error("Home source folder not found.");
    }
    setHomeSource(source);
  }, [folders]);

  const upsertLabel = useCallback((label: UserLabel) => {
    setLabels((current) => {
      const exists = current.some((item) => item.id === label.id);
      return exists ? current.map((item) => (item.id === label.id ? label : item)) : [...current, label];
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => mergeSettings({ ...current, ...patch }));
    if (patch.accentColor) {
      const now = new Date().toISOString();
      setActiveProfile((current) => ({ ...current, accentColor: patch.accentColor!, updatedAt: now }));
      setProfiles((current) => current.map((profile) => (
        profile.id === currentProfileRef.current.id
          ? { ...profile, accentColor: patch.accentColor!, updatedAt: now }
          : profile
      )));
    }
  }, []);

  const updateProfileSession = useCallback((patch: Partial<ProfileSessionState>) => {
    setProfileSession((current) => ({
      ...current,
      ...patch,
      scroll: patch.scroll ? { ...patch.scroll } : current.scroll,
      searchHistory: patch.searchHistory ? [...patch.searchHistory] : current.searchHistory,
      openedTitleIds: patch.openedTitleIds ? [...patch.openedTitleIds] : current.openedTitleIds,
    }));
  }, []);
  const setSearchHistory = useCallback((searchHistory: string[]) => {
    updateProfileSession({ searchHistory });
  }, [updateProfileSession]);
  const setOpenedTitleIds = useCallback((openedTitleIds: number[]) => {
    updateProfileSession({ openedTitleIds });
  }, [updateProfileSession]);

  const switchProfile = useCallback(async (id: string) => {
    if (id === currentProfileRef.current.id) return;
    switchingProfileRef.current = true;
    persistInBackground(flushProfileWrite());
    const profile = profileCacheRef.current.get(id) ?? await profileDb.profiles.get(id);
    const state = profileStateCacheRef.current.get(id) ?? await loadProfileState(id);
    if (!profile || !state) {
      switchingProfileRef.current = false;
      throw new Error("That profile could not be loaded.");
    }
    const now = new Date().toISOString();
    const selected = { ...profile, lastUsedAt: now };
    profileCacheRef.current.set(id, selected);
    applyProfileState(selected, state);
    setProfiles((current) => current.map((item) => (item.id === id ? selected : item)));
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    persistInBackground(profileDb.profiles.put(selected));
    switchingProfileRef.current = false;
    window.location.hash = state.session.lastRoute || "#/";
  }, [applyProfileState, flushProfileWrite]);

  const createProfile = useCallback(async (name: string, mode: ProfileSeedMode) => {
    if (profiles.length >= MAX_PROFILES) throw new Error(`You can keep up to ${MAX_PROFILES} profiles.`);
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Profile name is required.");
    if (profiles.some((profile) => profile.name.localeCompare(cleanName, undefined, { sensitivity: "accent" }) === 0)) {
      throw new Error("Profile names must be unique.");
    }
    const profile = createProfileRecord(cleanName, mode === "clone" ? settings.accentColor : DEFAULT_SETTINGS.accentColor);
    const state = mode === "clone"
      ? createProfileState(profile.id, structuredClone(buildCurrentProfileState()))
      : createProfileState(profile.id, {
          feeds: mode === "defaults" ? structuredClone(defaultFeeds) : [],
          settings: DEFAULT_SETTINGS,
          activeFeedId: mode === "defaults" ? defaultFeeds[0]?.id ?? null : null,
        });
    profileStateCacheRef.current.set(profile.id, state);
    profileCacheRef.current.set(profile.id, profile);
    persistInBackground(saveProfile(profile, state));
    setProfiles((current) => [...current, profile]);
    return profile;
  }, [buildCurrentProfileState, defaultFeeds, profiles, settings.accentColor]);

  const renameProfile = useCallback(async (id: string, name: string) => {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Profile name is required.");
    if (profiles.some((profile) => profile.id !== id && profile.name.localeCompare(cleanName, undefined, { sensitivity: "accent" }) === 0)) {
      throw new Error("Profile names must be unique.");
    }
    const now = new Date().toISOString();
    const profile = profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profile not found.");
    const updated = { ...profile, name: cleanName, updatedAt: now };
    profileCacheRef.current.set(id, updated);
    setProfiles((current) => current.map((item) => (item.id === id ? updated : item)));
    if (activeProfile.id === id) setActiveProfile(updated);
    persistInBackground(profileDb.profiles.put(updated));
  }, [activeProfile.id, profiles]);

  const duplicateProfile = useCallback(async (id: string, name?: string) => {
    if (profiles.length >= MAX_PROFILES) throw new Error(`You can keep up to ${MAX_PROFILES} profiles.`);
    persistInBackground(flushProfileWrite());
    const sourceProfile = profiles.find((profile) => profile.id === id);
    const sourceState = id === activeProfile.id
      ? buildCurrentProfileState()
      : profileStateCacheRef.current.get(id) ?? await loadProfileState(id);
    if (!sourceProfile || !sourceState) throw new Error("Profile not found.");
    const base = name?.trim() || `${sourceProfile.name} Copy`;
    let uniqueName = base;
    let suffix = 2;
    while (profiles.some((profile) => profile.name.localeCompare(uniqueName, undefined, { sensitivity: "accent" }) === 0)) {
      uniqueName = `${base} ${suffix}`;
      suffix += 1;
    }
    const profile = createProfileRecord(uniqueName, sourceProfile.accentColor);
    const state = createProfileState(profile.id, structuredClone(sourceState));
    profileCacheRef.current.set(profile.id, profile);
    profileStateCacheRef.current.set(profile.id, state);
    setProfiles((current) => [...current, profile]);
    persistInBackground(saveProfile(profile, state));
    return profile;
  }, [activeProfile.id, buildCurrentProfileState, flushProfileWrite, profiles]);

  const deleteProfile = useCallback(async (id: string) => {
    if (profiles.length <= 1) throw new Error("The final profile cannot be deleted.");
    if (id === activeProfile.id) {
      const next = profiles.find((profile) => profile.id !== id);
      if (!next) throw new Error("Another profile is required.");
      await switchProfile(next.id);
    }
    await deleteProfileRecord(id);
    profileCacheRef.current.delete(id);
    profileStateCacheRef.current.delete(id);
    setProfiles((current) => current.filter((profile) => profile.id !== id));
  }, [activeProfile.id, profiles, switchProfile]);

  const resetCurrentProfile = useCallback(async () => {
    const now = new Date().toISOString();
    setFeeds([]);
    setFolders([]);
    setHomeSource(DEFAULT_HOME_SOURCE);
    setLabels([]);
    setSettings(mergeSettings(DEFAULT_SETTINGS));
    setActiveFeedId(null);
    setActiveProfile((current) => ({
      ...current,
      accentColor: DEFAULT_SETTINGS.accentColor,
      updatedAt: now,
    }));
    setProfiles((current) => current.map((profile) => (
      profile.id === currentProfileRef.current.id
        ? { ...profile, accentColor: DEFAULT_SETTINGS.accentColor, updatedAt: now }
        : profile
    )));
    setProfileSession({
      lastRoute: "#/",
      scroll: {},
      searchHistory: [],
      openedTitleIds: [],
      searchQuery: "",
    });
  }, []);

  const resetEntireApp = useCallback(async () => {
    if (writeTimerRef.current != null) window.clearTimeout(writeTimerRef.current);
    switchingProfileRef.current = true;
    currentProfileStateRef.current = null;
    await Promise.all([
      profileDb.transaction("rw", profileDb.profiles, profileDb.profileStates, async () => {
        await profileDb.profileStates.clear();
        await profileDb.profiles.clear();
      }),
      db.details.clear(),
    ]);
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
    sessionStorage.removeItem(PROFILE_RUNTIME_CACHE_KEY);
    window.location.reload();
  }, []);

  const exportAllProfiles = useCallback(async () => {
    await flushProfileWrite();
    return makeProfilesBackup(activeProfile.id);
  }, [activeProfile.id, flushProfileWrite]);

  const importSnapshot = useCallback((snapshot: Partial<AppStateSnapshot>, mode: "merge" | "replace") => {
    const safeSnapshot = parseAppStateSnapshot(snapshot) ?? snapshot;
    if (mode === "replace") {
      const nextFeeds = (safeSnapshot.feeds ?? []).map((feed) => normalizeFeed(feed, { preserveMetricSlots: true }));
      const nextFolders = normalizeFeedFolders(safeSnapshot.folders, new Set(nextFeeds.map((feed) => feed.id)));
      setFeeds(nextFeeds);
      setFolders(nextFolders);
      setHomeSource(
        safeSnapshot.homeSource?.kind === "folder" && nextFolders.some((folder) => folder.id === safeSnapshot.homeSource?.folderId)
          ? safeSnapshot.homeSource
          : DEFAULT_HOME_SOURCE,
      );
      setLabels(safeSnapshot.labels ?? []);
      setSettings(mergeSettings(safeSnapshot.settings ? parseSettings(safeSnapshot.settings) ?? safeSnapshot.settings : undefined));
      setActiveFeedId(safeSnapshot.activeFeedId ?? null);
      return;
    }
    setFeeds((current) => [
      ...current,
      ...(safeSnapshot.feeds ?? []).map((feed) => normalizeFeed(feed, { preserveMetricSlots: true })),
    ]);
    setFolders((current) => normalizeFeedFolders(
      [...current, ...(safeSnapshot.folders ?? [])],
      new Set([...feeds, ...(safeSnapshot.feeds ?? [])].map((feed) => feed.id)),
    ));
    setLabels((current) => [...current, ...(safeSnapshot.labels ?? [])]);
    if (safeSnapshot.settings) {
      setSettings((current) => mergeSettings({ ...current, ...(parseSettings(safeSnapshot.settings) ?? safeSnapshot.settings) }));
    }
  }, [feeds]);

  const value = useMemo<StoreState>(
    () => ({
      ready: dataReady && profileReady,
      profileReady,
      catalog,
      tags,
      history,
      recommendationFeatures,
      syncMeta,
      profiles,
      activeProfile,
      profileSession,
      feeds,
      folders,
      homeSource,
      labels,
      settings,
      activeFeedId,
      syncStatus,
      switchProfile,
      createProfile,
      renameProfile,
      duplicateProfile,
      deleteProfile,
      updateProfileSession,
      setSearchHistory,
      setOpenedTitleIds,
      exportActiveProfile: buildCurrentProfileState,
      exportAllProfiles,
      setActiveFeedId,
      upsertFeed,
      deleteFeed,
      moveFeed,
      createFolder,
      renameFolder,
      moveFeedToFolder,
      moveFolder,
      duplicateFeed,
      deleteFolder,
      updateHomeSource,
      upsertLabel,
      updateSettings,
      refreshData,
      resetCurrentProfile,
      resetEntireApp,
      importSnapshot,
    }),
    [
      dataReady,
      profileReady,
      catalog,
      tags,
      history,
      recommendationFeatures,
      syncMeta,
      profiles,
      activeProfile,
      profileSession,
      feeds,
      folders,
      homeSource,
      labels,
      settings,
      activeFeedId,
      syncStatus,
      switchProfile,
      createProfile,
      renameProfile,
      duplicateProfile,
      deleteProfile,
      updateProfileSession,
      setSearchHistory,
      setOpenedTitleIds,
      buildCurrentProfileState,
      exportAllProfiles,
      setActiveFeedId,
      upsertFeed,
      deleteFeed,
      moveFeed,
      createFolder,
      renameFolder,
      moveFeedToFolder,
      moveFolder,
      duplicateFeed,
      deleteFolder,
      updateHomeSource,
      upsertLabel,
      updateSettings,
      refreshData,
      resetCurrentProfile,
      resetEntireApp,
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
