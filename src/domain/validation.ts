import { z } from "zod";
import type {
  AppSettings,
  AppStateSnapshot,
  HistoryMap,
  RecommendationFeature,
  SeriesCatalog,
  SeriesDetail,
  TagNode,
} from "./types";

const stringNull = z.union([z.string(), z.null(), z.undefined()]).transform((value) => (value == null ? null : value));
const booleanNull = z.union([z.boolean(), z.null(), z.undefined()]).transform((value) => (value == null ? null : value));
const numberNull = z.union([z.number(), z.null(), z.undefined()]).transform((value) => (value == null ? null : value));

const seriesTitleSchema = z
  .object({
    language: stringNull.default(null),
    title: z.string().default(""),
    traits: z.array(z.string()).default([]),
    is_primary: z.boolean().default(false),
    note: stringNull.default(null),
  })
  .passthrough();

const publishedDatesSchema = z
  .object({
    start_date: stringNull.default(null),
    end_date: stringNull.default(null),
    start_date_is_estimated: booleanNull.default(null),
    end_date_is_estimated: booleanNull.default(null),
  })
  .passthrough();

const analyticsSchema = z
  .object({
    fanFavouriteRaw: numberNull.optional(),
    fanRatioPercentile: numberNull.optional(),
    popularityPercentile: numberNull.optional(),
    fanFavouriteDiscoveryScore: numberNull.optional(),
    fanFavouriteDiscoveryPercentile: numberNull.optional(),
    fanFavouriteWeighted: numberNull.optional(),
    fanFavouritePercentile: numberNull.optional(),
  })
  .passthrough();

const statsSchema = z
  .object({
    popularity: numberNull.optional(),
    favourites: numberNull.optional(),
    meanScore: numberNull.optional(),
  })
  .passthrough();

const tagNodeSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    path: z.string(),
    is_genre: z.boolean(),
    parent_id: numberNull.default(null),
    level: z.number(),
  })
  .passthrough();

const recommendationFeatureSchema = z
  .object({
    id: z.number(),
    profileGroups: z.array(z.string()).default([]),
    primaryAnchors: z.array(z.string()).default([]),
    tagFeatures: z.record(z.string(), z.number()).default({}),
    tagWeightSignal: z.record(z.string(), z.number()).optional(),
    textFeatures: z.record(z.string(), z.number()).default({}),
    storySignals: z.record(z.string(), z.number()).optional(),
    quality: z
      .object({
        discPct: numberNull.default(null),
        fanPct: numberNull.default(null),
        popularity: numberNull.default(null),
      })
      .default({ discPct: null, fanPct: null, popularity: null }),
  })
  .passthrough();

const seriesCatalogSchema = z
  .object({
    id: z.number(),
    merged_ids: z.array(z.number()).optional(),
    display_title: z.string().default(""),
    animeplanet_title: stringNull.default(null),
    mangabaka_title: stringNull.default(null),
    native_title: stringNull.default(null),
    romanized_title: stringNull.default(null),
    titles: z.array(seriesTitleSchema).optional(),
    tag_weights: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
    anilist_first_seen_at: stringNull.default(null),
    cover: stringNull.default(null),
    year: numberNull.default(null),
    status: stringNull.default(null),
    content_rating: z.union([z.string(), z.null(), z.undefined()]).transform((value) => (value == null ? null : value)).default(null),
    total_chapters: z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((value) => (value == null ? null : value)).default(null),
    tag_ids: z.array(z.number()).default([]),
    stats: statsSchema.default({ popularity: null, favourites: null, meanScore: null }),
    analytics: analyticsSchema.default({}),
    published: publishedDatesSchema.optional(),
    first_seen_at: stringNull.default(null),
    first_seen_at_is_trusted: booleanNull.default(null),
    created_at: stringNull.default(null),
    added_at: stringNull.default(null),
    last_updated_at: stringNull.default(null),
    mangabaka_latest_rank: numberNull.default(null),
    mangabaka_latest_snapshot_at: stringNull.default(null),
    authors: z.array(z.string()).optional(),
    artists: z.array(z.string()).optional(),
    links: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
    source: z
      .object({
        anilist: z
          .object({
            id: z.number(),
            rating: numberNull.optional(),
            url: stringNull.optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        animeplanet: z
          .object({
            id: z.string(),
            rating: numberNull.optional(),
            url: stringNull.optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
        mangaupdates: z
          .object({
            id: z.string(),
            rating: numberNull.optional(),
            url: stringNull.optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const seriesDetailSchema = seriesCatalogSchema.extend({
  state: stringNull.optional(),
  type: stringNull.optional(),
  description: stringNull.optional(),
  is_licensed: booleanNull.default(null),
});

const historyEntrySchema = z
  .object({
    d: z.string(),
    p: z.number(),
    f: z.number(),
    s: numberNull.default(null),
    r: z.number(),
    rp: z.number(),
    pp: z.number(),
    ds: z.number(),
    dp: z.number(),
  })
  .passthrough();

const feedFiltersSchema = z
  .object({
    sourceMode: z.enum(["anilist", "non-anilist", "mixed"]).optional(),
    sourceModes: z.array(z.enum(["anilist", "non-anilist", "mixed"])).optional(),
    query: z.string().optional(),
    includeTagIds: z.array(z.number()).optional(),
    excludeTagIds: z.array(z.number()).optional(),
    tagMatch: z.enum(["any", "all"]).optional(),
    contentRatings: z.array(z.enum(["safe", "suggestive", "erotica", "pornographic"])).optional(),
    statuses: z.array(z.string()).optional(),
    minChapters: numberNull.optional(),
    maxChapters: numberNull.optional(),
    minYear: numberNull.optional(),
    maxYear: numberNull.optional(),
    minPopularity: numberNull.optional(),
    maxPopularity: numberNull.optional(),
    minFavourites: numberNull.optional(),
    maxFavourites: numberNull.optional(),
    minMeanScore: numberNull.optional(),
    maxMeanScore: numberNull.optional(),
    metricRanges: z.array(
      z
        .object({
          id: z.string(),
          metric: z.string(),
          min: numberNull.optional(),
          max: numberNull.optional(),
        })
        .passthrough(),
    ).optional(),
    includeEstimatedDates: z.boolean().optional(),
    dateField: z.enum(["none", "release", "end"]).optional(),
    rolling: z
      .object({
        mode: z.enum(["none", "last", "fixed"]).optional(),
        amount: z.number().optional(),
        unit: z.enum(["days", "weeks", "months", "years"]).optional(),
        from: stringNull.optional(),
        to: stringNull.optional(),
      })
      .passthrough()
      .optional(),
    labelIds: z.array(z.string()).optional(),
  })
  .passthrough();

const visibleTitleFieldsSchema = z
  .object({
    cover: z.boolean().optional(),
    title: z.boolean().optional(),
    rank: z.boolean().optional(),
    genreChips: z.boolean().optional(),
    status: z.boolean().optional(),
    year: z.boolean().optional(),
    chapters: z.boolean().optional(),
    contentRating: z.boolean().optional(),
    popularity: z.boolean().optional(),
    favourites: z.boolean().optional(),
    meanScore: z.boolean().optional(),
    fanFavouriteRatio: z.boolean().optional(),
    discoveryScore: z.boolean().optional(),
    growthDelta: z.boolean().optional(),
    labels: z.boolean().optional(),
    sourceBadges: z.boolean().optional(),
    quickActions: z.boolean().optional(),
    description: z.boolean().optional(),
    links: z.boolean().optional(),
  })
  .passthrough();

const feedViewSettingsSchema = z
  .object({
    mode: z.enum(["grid", "list"]).optional(),
    gridColumns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
    gridDensity: z.enum(["comfortable", "standard", "compact"]).optional(),
    listCoverSize: z.enum(["small", "medium", "large"]).optional(),
    listDensity: z.enum(["compact", "standard", "detailed"]).optional(),
    metricSlots: z.array(z.string()).optional(),
    visible: visibleTitleFieldsSchema.optional(),
  })
  .passthrough();

const sortRuleSchema = z
  .object({
    id: z.string(),
    metric: z.string(),
    direction: z.enum(["asc", "desc"]),
  })
  .passthrough();

const feedSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["logic", "custom"]).optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    showDescription: z.boolean().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    filters: feedFiltersSchema.optional(),
    sort: z.array(sortRuleSchema).optional(),
    view: feedViewSettingsSchema.optional(),
    coverTitleIds: z.array(z.number()).optional(),
    customTitleIds: z.array(z.number()).max(500).optional(),
    customOrder: z.boolean().optional(),
    customInsertion: z.enum(["top", "bottom"]).optional(),
    customNonAniListPlacement: z.enum(["top", "bottom"]).optional(),
  })
  .passthrough();

const folderSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    parentId: z.string().nullable().optional(),
    childFolderIds: z.array(z.string()).optional(),
    feedIds: z.array(z.string()).optional(),
    order: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

const labelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    color: z.string().optional(),
    manualTitleIds: z.array(z.number()).optional(),
    rule: z
      .object({
        minMeanScore: numberNull.optional(),
        minPopularity: numberNull.optional(),
        minFavourites: numberNull.optional(),
        includeTagIds: z.array(z.number()).optional(),
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();

const appSettingsSchema = z
  .object({
    appName: z.string().optional(),
    themeMode: z.enum(["system", "dark", "light"]).optional(),
    accentColor: z.string().optional(),
    dataSourceUrl: z.string().optional(),
    adultUnlocked: z.boolean().optional(),
    contentRatings: z.array(z.enum(["safe", "suggestive", "erotica", "pornographic"])).optional(),
    defaultFeedView: feedViewSettingsSchema.optional(),
    recommendationShelves: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          statusMode: z.enum(["any", "completed", "ongoing"]).optional(),
          dateMode: z.enum(["any", "latest"]).optional(),
          sourceModes: z.array(z.enum(["anilist", "non-anilist", "mixed"])).optional(),
          sort: z.array(sortRuleSchema).optional(),
          metricRanges: z.array(
            z
              .object({
                id: z.string(),
                metric: z.string(),
                min: numberNull.optional(),
                max: numberNull.optional(),
              })
              .passthrough(),
          ).optional(),
        })
        .passthrough(),
    ).optional(),
    detailVisible: z.record(z.string(), z.boolean()).optional(),
    detailCoverLayout: z.enum(["left", "right", "center", "background", "minimal"]).optional(),
    metricNames: z.record(z.string(), z.string()).optional(),
    bottomNavItems: z.array(z.string()).optional(),
    controlPlacement: z.enum(["drawer", "toolbar", "fab"]).optional(),
    restoreLastSession: z.boolean().optional(),
    nonAniListPlacement: z.enum(["top", "bottom", "mixed"]).optional(),
    sharingDefault: z.enum(["feed", "folder", "settings", "full"]).optional(),
    sfwShareDefault: z.boolean().optional(),
    includeAppNameInShare: z.boolean().optional(),
    searchSensitiveTags: z.boolean().optional(),
    searchRelationshipTags: z.boolean().optional(),
    searchAdultTags: z.boolean().optional(),
    showSearchHistory: z.boolean().optional(),
  })
  .passthrough();

const appStateSnapshotSchema = z
  .object({
    feeds: z.array(feedSchema).optional(),
    folders: z.array(folderSchema).optional(),
    homeSource: z.object({
      kind: z.enum(["unfiled", "folder"]),
      folderId: z.string().nullable().optional(),
      continuous: z.boolean().optional(),
    }).optional(),
    labels: z.array(labelSchema).optional(),
    settings: appSettingsSchema.optional(),
    activeFeedId: z.string().nullable().optional(),
    lastRoute: z.string().optional(),
  })
  .passthrough();

export function parseSettings(value: unknown): Partial<AppSettings> | null {
  const parsed = appSettingsSchema.safeParse(value);
  return parsed.success ? (parsed.data as Partial<AppSettings>) : null;
}

export function parseAppStateSnapshot(value: unknown): Partial<AppStateSnapshot> | null {
  const parsed = appStateSnapshotSchema.safeParse(value);
  return parsed.success ? (parsed.data as Partial<AppStateSnapshot>) : null;
}

export function parseCatalogList(value: unknown): SeriesCatalog[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = seriesCatalogSchema.safeParse(item);
    return parsed.success ? [parsed.data as SeriesCatalog] : [];
  });
}

export function parseDetail(value: unknown): SeriesDetail | null {
  const parsed = seriesDetailSchema.safeParse(value);
  return parsed.success ? (parsed.data as SeriesDetail) : null;
}

export function parseTags(value: unknown): TagNode[] {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value as Record<string, unknown>) : [];
  return list.flatMap((item) => {
    const parsed = tagNodeSchema.safeParse(item);
    return parsed.success ? [parsed.data as TagNode] : [];
  });
}

export function parseHistory(value: unknown): HistoryMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: HistoryMap = {};
  for (const [id, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const parsedEntries = entries.flatMap((entry) => {
      const parsed = historyEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data as HistoryMap[string][number]] : [];
    });
    if (parsedEntries.length > 0) output[id] = parsedEntries;
  }
  return output;
}

export function parseRecommendationFeatures(value: unknown): RecommendationFeature[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = recommendationFeatureSchema.safeParse(item);
    return parsed.success ? [parsed.data as RecommendationFeature] : [];
  });
}
