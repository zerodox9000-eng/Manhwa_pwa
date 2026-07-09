import type {
  AppSettings,
  DetailVisibleFields,
  Feed,
  FeedFilters,
  FeedViewSettings,
  RecommendationShelf,
  SortRule,
  VisibleTitleFields,
} from "./types";

export const RAW_EXPORT_BASE =
  "https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend";

export const PAGES_EXPORT_BASE =
  "https://zerodox9000-eng.github.io/manhwa_db/db/exports/frontend";

export const DATA_SOURCE_CANDIDATES = [PAGES_EXPORT_BASE, RAW_EXPORT_BASE];

export const SAFE_RATINGS = ["safe", "suggestive"] as const;
export const DEFAULT_SENSITIVE_EXCLUDE_TAG_IDS = [4, 180, 41, 10];

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
  appName: "Manhwa Lib",
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
  bottomNavItems: ["home", "feeds", "search", "recommendations", "settings"],
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
    name,
    description: "",
    showDescription: false,
    createdAt: now,
    updatedAt: now,
    filters: {
      ...DEFAULT_FILTERS,
      sourceModes: [...(DEFAULT_FILTERS.sourceModes ?? [])],
      contentRatings: [...DEFAULT_FILTERS.contentRatings],
      metricRanges: [],
    },
    sort: DEFAULT_SORT.map((rule) => ({ ...rule, id: makeId() })),
    view: {
      ...DEFAULT_FEED_VIEW,
      metricSlots: [...DEFAULT_FEED_VIEW.metricSlots],
      visible: { ...DEFAULT_FEED_VIEW.visible },
    },
    coverTitleIds: [],
  };
}
