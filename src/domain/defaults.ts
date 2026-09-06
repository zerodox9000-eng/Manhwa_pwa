import type {
  AppSettings,
  DetailVisibleFields,
  Feed,
  FeedFilters,
  FeedViewSettings,
  MetricId,
  RecommendationShelf,
  SortRule,
  SourceMode,
  TagWeightType,
  VisibleTitleFields,
} from "./types";
import { TAG_WEIGHT_TYPES } from "./types";
import defaultFeedsJson from "./defaultFeeds.generated.json";
import { metricDefinition } from "./metrics";

const DEFAULT_RAW_EXPORT_BASE =
  "https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend";

export const RAW_EXPORT_BASE = import.meta.env.VITE_DATA_SOURCE_URL?.trim() || DEFAULT_RAW_EXPORT_BASE;

export const PAGES_EXPORT_BASE =
  "https://zerodox9000-eng.github.io/manhwa_db/db/exports/frontend";

export const DATA_SOURCE_CANDIDATES = [PAGES_EXPORT_BASE, RAW_EXPORT_BASE];

export const SAFE_RATINGS = ["safe", "suggestive"] as const;
export const DEFAULT_SENSITIVE_EXCLUDE_TAG_IDS = [4, 180, 41, 10];
export const DEFAULT_TAG_WEIGHT_TYPES: TagWeightType[] = [...TAG_WEIGHT_TYPES];
export const DEFAULT_TAG_FEED_WEIGHT_TYPES: TagWeightType[] = ["core", "defining"];
const ALL_WEIGHT_TAG_FEED_NAMES = new Set(["political", "female empowerment", "second chance", "non-human"]);

function normalizedFeedName(name: string) {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function isNovelBasedFeed(feed: Pick<Feed, "name">) {
  return /^(?:based on )?(?:a )?(?:web )?novel$/.test(normalizedFeedName(feed.name));
}

export function defaultTagWeightTypesForBuiltInFeed(feed: Pick<Feed, "name" | "filters">): TagWeightType[] | null {
  if ((feed.filters.includeTagIds?.length ?? 0) === 0) return null;
  if (isNovelBasedFeed(feed) || ALL_WEIGHT_TAG_FEED_NAMES.has(normalizedFeedName(feed.name))) {
    return [...DEFAULT_TAG_WEIGHT_TYPES];
  }
  return [...DEFAULT_TAG_FEED_WEIGHT_TYPES];
}

export function normalizeTagWeightTypes(values?: readonly TagWeightType[] | null): TagWeightType[] {
  if (values == null) return [...DEFAULT_TAG_WEIGHT_TYPES];
  const allowed = new Set<TagWeightType>(TAG_WEIGHT_TYPES);
  return [...new Set(values.filter((value): value is TagWeightType => allowed.has(value)))];
}

export const DEFAULT_VISIBLE_TITLE_FIELDS: VisibleTitleFields = {
  cover: true,
  title: true,
  rank: true,
  genreChips: true,
  status: false,
  year: false,
  chapters: false,
  contentRating: false,
  popularity: true,
  favourites: true,
  meanScore: false,
  fanFavouriteRatio: false,
  discoveryScore: false,
  growthDelta: false,
  labels: false,
  sourceBadges: false,
  quickActions: false,
  description: false,
  links: false,
};

export const DEFAULT_FEED_VIEW: FeedViewSettings = {
  mode: "grid",
  gridColumns: 3,
  desktopGridColumns: 6,
  gridDensity: "standard",
  listCoverSize: "medium",
  listDensity: "standard",
  metricSlots: ["fanFavouriteDiscoveryPercentile"],
  visible: DEFAULT_VISIBLE_TITLE_FIELDS,
};

export const DEFAULT_DETAIL_VISIBLE: DetailVisibleFields = {
  cover: true,
  title: true,
  description: false,
  genreTags: true,
  allTags: false,
  authorsArtists: false,
  links: true,
  labels: false,
  popularity: true,
  favourites: true,
  meanScore: false,
  fanFavouriteRatio: false,
  discoveryMetrics: true,
  growthNumbers: false,
  status: true,
  year: true,
  chapters: true,
  contentRating: false,
};

export const DEFAULT_FILTERS: FeedFilters = {
  sourceMode: "anilist",
  sourceModes: ["anilist"],
  query: "",
  includeTagIds: [],
  excludeTagIds: [...DEFAULT_SENSITIVE_EXCLUDE_TAG_IDS],
  tagMatch: "any",
  tagWeightTypes: [...DEFAULT_TAG_WEIGHT_TYPES],
  contentRatings: ["safe", "suggestive"],
  statuses: [],
  minChapters: null,
  maxChapters: null,
  minYear: null,
  maxYear: null,
  minPopularity: null,
  maxPopularity: null,
  minFavourites: null,
  maxFavourites: null,
  minMeanScore: null,
  maxMeanScore: null,
  metricRanges: [],
  includeEstimatedDates: true,
  requireOfficialEnglishLink: false,
  dateField: "none",
  rolling: {
    mode: "none",
    amount: 7,
    unit: "days",
  },
  labelIds: [],
};

export const DEFAULT_SORT: SortRule[] = [
  { id: "sort-discovery-percentile", metric: "fanFavouriteDiscoveryPercentile", direction: "desc" },
];

export const DEFAULT_RECOMMENDATION_SHELVES: RecommendationShelf[] = [
  {
    id: "similar-loved",
    name: "Most loved matches",
    statusMode: "any",
    dateMode: "any",
    sourceModes: ["anilist"],
    sort: [{ id: "rec-discpct", metric: "fanFavouriteDiscoveryPercentile", direction: "desc" }],
    metricRanges: [],
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  appName: "Aeon",
  themeMode: "dark",
  accentColor: "#ff006e",
  dataSourceUrl: RAW_EXPORT_BASE,
  adultUnlocked: false,
  contentRatings: ["safe", "suggestive"],
  defaultFeedView: DEFAULT_FEED_VIEW,
  recommendationShelves: DEFAULT_RECOMMENDATION_SHELVES,
  detailVisible: DEFAULT_DETAIL_VISIBLE,
  detailCoverLayout: "left",
  metricNames: {
    popularity: "Popularity",
    favourites: "Favourites",
    meanScore: "Mean Score",
    fanFavouriteRaw: "Fan Favourite Percent",
    fanFavouriteDiscoveryScore: "Discovery Score",
    fanFavouriteDiscoveryPercentile: "Fan Rank",
    underratedScore: "Und",
    popularityGrowth: "Popularity Growth",
    favouritesGrowth: "Favourites Growth",
  },
  bottomNavItems: ["home", "feeds", "search", "trends", "settings"],
  controlPlacement: "toolbar",
  restoreLastSession: true,
  nonAniListPlacement: "bottom",
  sharingDefault: "feed",
  sfwShareDefault: true,
  includeAppNameInShare: true,
  searchSensitiveTags: false,
  searchRelationshipTags: false,
  searchAdultTags: false,
};

const SHIPPED_DEFAULT_FEEDS = defaultFeedsJson as unknown as Feed[];
const SHIPPED_DEFAULT_METRIC_SLOTS = new Map<string, MetricId[]>(
  SHIPPED_DEFAULT_FEEDS.map((feed) => [feed.id, (feed.view?.metricSlots ?? []) as MetricId[]]),
);

export const DEFAULT_LATEST_LISTINGS_EXCLUDE_TAG_IDS = (
  SHIPPED_DEFAULT_FEEDS.find((feed) => feed.id === "b68dcc8b-3ca0-44a4-a474-dd91af2debe7")?.filters.excludeTagIds
  ?? DEFAULT_SENSITIVE_EXCLUDE_TAG_IDS
).slice();

export function defaultMetricSlotsForFeed(feed: Feed): MetricId[] {
  const shippedSlots = SHIPPED_DEFAULT_METRIC_SLOTS.get(feed.id);
  if (shippedSlots?.length) return shippedSlots.slice(0, 3);

  const sourceModes = feed.filters.sourceModes?.length
    ? feed.filters.sourceModes.filter((mode) => mode !== "mixed")
    : feed.filters.sourceMode === "anilist"
      ? ["anilist"]
      : feed.filters.sourceMode === "non-anilist"
        ? ["non-anilist"]
        : feed.filters.sourceMode === "oel"
          ? ["oel"]
          : ["anilist", "non-anilist", "oel"];
  const canUseAniListMetrics = sourceModes.length === 0 || sourceModes.includes("anilist");
  return [canUseAniListMetrics ? "fanFavouriteDiscoveryPercentile" : "year"];
}

function sourceModesForMetricRestore(feed: Feed): SourceMode[] {
  const filters = feed.filters;
  return (filters.sourceModes?.length
    ? filters.sourceModes
    : filters.sourceMode === "anilist"
      ? ["anilist"]
      : filters.sourceMode === "non-anilist"
        ? ["non-anilist"]
        : filters.sourceMode === "oel"
          ? ["oel"]
          : ["anilist", "non-anilist", "oel"]) as SourceMode[];
}

export function metricSlotsToRestoreForFeed(feed: Feed): MetricId[] {
  const sourceModes = sourceModesForMetricRestore(feed);
  const nonAniListOnly = feed.kind !== "custom" && sourceModes.length > 0 && sourceModes.every((mode) => mode === "non-anilist" || mode === "oel");
  const sourceCompatible = (slots: MetricId[]) => (nonAniListOnly
    ? slots.filter((metric) => !metricDefinition(metric).anilistOnly)
    : slots).slice(0, 3);
  const savedSlots = sourceCompatible(feed.view.metricSlotsWhenHidden ?? []);
  if (savedSlots.length) return savedSlots;
  const fallbackSlots = sourceCompatible(defaultMetricSlotsForFeed(feed));
  return fallbackSlots.length ? fallbackSlots : ["year"];
}

export function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
    (Number(char) ^ (Math.random() * 16) >> Number(char) / 4).toString(16),
  );
}

export function createFeed(name = "New Feed"): Feed {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    kind: "logic",
    name,
    description: "",
    showDescription: false,
    createdAt: now,
    updatedAt: now,
    filters: {
      ...DEFAULT_FILTERS,
      sourceModes: [...(DEFAULT_FILTERS.sourceModes ?? [])],
      includeTagIds: [...DEFAULT_FILTERS.includeTagIds],
      excludeTagIds: [...DEFAULT_FILTERS.excludeTagIds],
      tagWeightTypes: [...(DEFAULT_FILTERS.tagWeightTypes ?? DEFAULT_TAG_WEIGHT_TYPES)],
      contentRatings: [...DEFAULT_FILTERS.contentRatings],
      statuses: [...DEFAULT_FILTERS.statuses],
      metricRanges: [],
      rolling: { ...DEFAULT_FILTERS.rolling },
      labelIds: [...DEFAULT_FILTERS.labelIds],
    },
    sort: DEFAULT_SORT.map((rule) => ({ ...rule, id: makeId() })),
    view: {
      ...DEFAULT_FEED_VIEW,
      metricSlots: [...DEFAULT_FEED_VIEW.metricSlots],
      visible: { ...DEFAULT_FEED_VIEW.visible },
    },
    coverTitleIds: [],
    titleIds: [],
    orderMode: "automatic",
    newTitlePlacement: "top",
    nonAniListPlacement: "top",
  };
}

export function createCustomFeed(name = "New List"): Feed {
  const feed = createFeed(name);
  return {
    ...feed,
    kind: "custom",
    titleIds: [],
    orderMode: "automatic",
    filters: {
      ...feed.filters,
      sourceMode: "mixed",
      sourceModes: ["anilist", "non-anilist", "oel"],
      query: "",
      includeTagIds: [],
      excludeTagIds: [],
      contentRatings: ["safe", "suggestive", "erotica", "pornographic"],
      labelIds: [],
    },
  };
}
