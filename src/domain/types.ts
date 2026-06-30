export type ContentRating = "safe" | "suggestive" | "erotica" | "pornographic";
export type ViewMode = "grid" | "list";
export type GridDensity = "comfortable" | "standard" | "compact";
export type ListDensity = "compact" | "standard" | "detailed";
export type ListCoverSize = "small" | "medium" | "large";
export type SourceMode = "anilist" | "non-anilist" | "mixed";
export type NonAniListPlacement = "top" | "bottom" | "mixed";
export type ControlPlacement = "drawer" | "toolbar" | "fab";
export type ThemeMode = "system" | "dark" | "light";

export interface AniListStats {
  popularity: number | null;
  favourites: number | null;
  meanScore: number | null;
}

export interface AnalyticsStats {
  fanFavouriteRaw?: number | null;
  fanRatioPercentile?: number | null;
  popularityPercentile?: number | null;
  fanFavouriteDiscoveryScore?: number | null;
  fanFavouriteDiscoveryPercentile?: number | null;
  fanFavouriteWeighted?: number | null;
  fanFavouritePercentile?: number | null;
}

export interface PublishedDates {
  start_date?: string | null;
  end_date?: string | null;
  start_date_is_estimated?: boolean | null;
  end_date_is_estimated?: boolean | null;
}

export interface SeriesTitle {
  language: string | null;
  title: string;
  traits: string[];
  is_primary: boolean;
  note?: string | null;
}

export interface SeriesCatalog {
  id: number;
  merged_ids?: number[];
  display_title: string;
  animeplanet_title?: string | null;
  mangabaka_title?: string | null;
  native_title?: string | null;
  romanized_title?: string | null;
  titles?: SeriesTitle[];
  tag_weights?: Record<number, number | string> | null;
  anilist_first_seen_at?: string | null;
  cover: string | null;
  year: number | null;
  status: string | null;
  content_rating: ContentRating | string | null;
  total_chapters: string | number | null;
  tag_ids: number[];
  stats: AniListStats;
  analytics: AnalyticsStats;
  published?: PublishedDates | null;
  first_seen_at?: string | null;
  first_seen_at_is_trusted?: boolean | null;
  created_at?: string | null;
  added_at?: string | null;
  last_updated_at?: string | null;
  mangabaka_latest_rank?: number | null;
  mangabaka_latest_snapshot_at?: string | null;
  authors?: string[];
  artists?: string[];
  links?: Record<string, string | null>;
  source?: {
    anilist?: { id: number; rating?: number | null; url?: string | null } | null;
    animeplanet?: { id: string; rating?: number | null; url?: string | null } | null;
    mangaupdates?: { id: string; rating?: number | null; url?: string | null } | null;
  } | null;
}

export interface SeriesDetail extends SeriesCatalog {
  state?: string;
  type?: string;
  description?: string | null;
  is_licensed?: boolean;
}

export interface TagNode {
  id: number;
  name: string;
  path: string;
  is_genre: boolean;
  parent_id: number | null;
  level: number;
}

export interface RecommendationFeature {
  id: number;
  profileGroups: string[];
  primaryAnchors: string[];
  tagFeatures: Record<string, number>;
  tagWeightSignal?: Record<string, number>;
  textFeatures: Record<string, number>;
  storySignals?: Record<string, number>;
  quality: {
    discPct: number | null;
    fanPct: number | null;
    popularity: number | null;
  };
}

export interface HistoryEntry {
  d: string;
  p: number;
  f: number;
  s: number | null;
  r: number;
  rp: number;
  pp: number;
  ds: number;
  dp: number;
}

export type HistoryMap = Record<string, HistoryEntry[]>;

export interface SortRule {
  id: string;
  metric: MetricId;
  direction: "asc" | "desc";
}

export type MetricId =
  | "title"
  | "year"
  | "chapters"
  | "popularity"
  | "favourites"
  | "meanScore"
  | "fanFavouriteRaw"
  | "fanRatioPercentile"
  | "popularityPercentile"
  | "underratedScore"
  | "fanFavouriteDiscoveryScore"
  | "fanFavouriteDiscoveryPercentile"
  | "releaseDate"
  | "endDate"
  | "mangabakaLatestRank"
  | "popularityGrowth"
  | "popularityGrowthPercent"
  | "favouritesGrowth"
  | "favouritesGrowthPercent"
  | "meanScoreDelta"
  | "fanFavouriteDelta"
  | "discoveryScoreDelta"
  | "discoveryPercentileDelta";

export interface MetricRange {
  id: string;
  metric: MetricId;
  min: number | null;
  max: number | null;
}

export interface RollingWindow {
  mode: "none" | "last" | "fixed";
  amount: number;
  unit: "days" | "weeks" | "months" | "years";
  from?: string;
  to?: string;
}

export interface FeedFilters {
  sourceMode: SourceMode;
  sourceModes?: SourceMode[];
  query: string;
  includeTagIds: number[];
  excludeTagIds: number[];
  tagMatch: "any" | "all";
  contentRatings: ContentRating[];
  statuses: string[];
  minChapters: number | null;
  maxChapters: number | null;
  minYear: number | null;
  maxYear: number | null;
  minPopularity: number | null;
  maxPopularity: number | null;
  minFavourites: number | null;
  maxFavourites: number | null;
  minMeanScore: number | null;
  maxMeanScore: number | null;
  metricRanges: MetricRange[];
  includeEstimatedDates: boolean;
  dateField: "none" | "release" | "end";
  rolling: RollingWindow;
  labelIds: string[];
}

export interface VisibleTitleFields {
  cover: boolean;
  title: boolean;
  rank: boolean;
  genreChips: boolean;
  status: boolean;
  year: boolean;
  chapters: boolean;
  contentRating: boolean;
  popularity: boolean;
  favourites: boolean;
  meanScore: boolean;
  fanFavouriteRatio: boolean;
  discoveryScore: boolean;
  growthDelta: boolean;
  labels: boolean;
  sourceBadges: boolean;
  quickActions: boolean;
  description: boolean;
  links: boolean;
}

export interface FeedViewSettings {
  mode: ViewMode;
  gridColumns: 1 | 2 | 3 | 4 | 5;
  gridDensity: GridDensity;
  listCoverSize: ListCoverSize;
  listDensity: ListDensity;
  metricSlots: MetricId[];
  visible: VisibleTitleFields;
}

export interface Feed {
  id: string;
  kind: "logic" | "custom";
  name: string;
  description: string;
  showDescription: boolean;
  createdAt: string;
  updatedAt: string;
  filters: FeedFilters;
  sort: SortRule[];
  view: FeedViewSettings;
  coverTitleIds: number[];
  customTitleIds: number[];
  customOrder: boolean;
  customInsertion: "top" | "bottom";
  customNonAniListPlacement: "top" | "bottom";
}

export interface Folder {
  id: string;
  name: string;
  kind: "manual" | "smart";
  titleIds: number[];
  feedId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedFolder {
  id: string;
  name: string;
  parentId: string | null;
  childFolderIds: string[];
  feedIds: string[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface HomeSource {
  kind: "unfiled" | "folder";
  folderId: string | null;
  continuous: boolean;
}

export interface RecommendationShelf {
  id: string;
  name: string;
  statusMode: "any" | "completed" | "ongoing";
  dateMode: "any" | "latest";
  sourceModes: SourceMode[];
  sort: SortRule[];
  metricRanges: MetricRange[];
}

export interface LabelRule {
  minMeanScore?: number | null;
  minPopularity?: number | null;
  minFavourites?: number | null;
  includeTagIds?: number[];
}

export interface UserLabel {
  id: string;
  name: string;
  color: string;
  manualTitleIds: number[];
  rule?: LabelRule | null;
}

export interface DetailVisibleFields {
  cover: boolean;
  title: boolean;
  recommendations: boolean;
  description: boolean;
  genreTags: boolean;
  allTags: boolean;
  authorsArtists: boolean;
  links: boolean;
  labels: boolean;
  popularity: boolean;
  favourites: boolean;
  meanScore: boolean;
  fanFavouriteRatio: boolean;
  discoveryMetrics: boolean;
  growthNumbers: boolean;
  status: boolean;
  year: boolean;
  chapters: boolean;
  contentRating: boolean;
}

export interface AppSettings {
  appName: string;
  themeMode: ThemeMode;
  accentColor: string;
  dataSourceUrl: string;
  adultUnlocked: boolean;
  contentRatings: ContentRating[];
  defaultFeedView: FeedViewSettings;
  recommendationShelves: RecommendationShelf[];
  detailVisible: DetailVisibleFields;
  detailCoverLayout: "left" | "right" | "center" | "background" | "minimal";
  metricNames: Record<string, string>;
  bottomNavItems: string[];
  controlPlacement: ControlPlacement;
  restoreLastSession: boolean;
  nonAniListPlacement: NonAniListPlacement;
  sharingDefault: "feed" | "folder" | "settings" | "full";
  sfwShareDefault: boolean;
  includeAppNameInShare: boolean;
  searchSensitiveTags: boolean;
  searchRelationshipTags: boolean;
  searchAdultTags: boolean;
  showSearchHistory: boolean;
}

export interface SyncMeta {
  lastSync: string | null;
  totalSeries: number;
  historyFirstDate: string | null;
  historyLastDate: string | null;
  versionHash: string | null;
  fileSizes?: Record<string, number>;
  source: string;
}

export interface AppStateSnapshot {
  feeds: Feed[];
  folders?: FeedFolder[];
  homeSource?: HomeSource;
  labels?: UserLabel[];
  settings: AppSettings;
  activeFeedId: string | null;
  lastRoute: string;
}

export type ProfileSeedMode = "blank" | "defaults" | "clone";

export interface Profile {
  id: string;
  name: string;
  accentColor: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
}

export interface ProfileSessionState {
  lastRoute: string;
  scroll: Record<string, number>;
  searchHistory: string[];
  openedTitleIds: number[];
  searchQuery: string;
}

export interface ProfileState {
  profileId: string;
  schemaVersion: 1 | 2;
  feeds: Feed[];
  folders: FeedFolder[];
  homeSource: HomeSource;
  labels: UserLabel[];
  settings: AppSettings;
  activeFeedId: string | null;
  session: ProfileSessionState;
}

export interface ProfilesBackup {
  kind: "manhwa-profiles-backup";
  version: 1;
  exportedAt: string;
  activeProfileId: string;
  profiles: Array<{
    profile: Profile;
    state: ProfileState;
  }>;
}

export interface QueryResult {
  items: SeriesCatalog[];
  limitedHistory: boolean;
  missingDateData: boolean;
  activeNotes: string[];
}
