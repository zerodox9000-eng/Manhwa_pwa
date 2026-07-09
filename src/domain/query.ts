import Fuse from "fuse.js";
import type {
  AppSettings,
  Feed,
  HistoryMap,
  QueryResult,
  SeriesCatalog,
  TagNode,
  UserLabel,
} from "./types";
import { isDateWithin, isFutureDate, resolveRollingWindow } from "./dates";
import { chapterNumber, displayComparableMetricValue, displayReleaseDate, effectiveEndDate, effectiveReleaseDate, historyDeltaForWindow, metricDefinition, metricValue } from "./metrics";

const RELATIONSHIP_SENSITIVE_NAMES = new Set(["boys love", "girls love"]);
const ADULT_SENSITIVE_NAMES = new Set(["smut", "hentai"]);
type SensitiveSearchFamily = "boysLove" | "girlsLove" | "yaoi" | "yuri" | "smut" | "hentai";

const SENSITIVE_SEARCH_ALIASES: ReadonlyMap<string, SensitiveSearchFamily> = new Map([
  ["bl", "boysLove"],
  ["boys love", "boysLove"],
  ["boy love", "boysLove"],
  ["yaoi", "yaoi"],
  ["gl", "girlsLove"],
  ["girls love", "girlsLove"],
  ["girl love", "girlsLove"],
  ["yuri", "yuri"],
  ["smut", "smut"],
  ["hentai", "hentai"],
]);

export function hasAniList(series: SeriesCatalog) {
  return Boolean(
    series.source?.anilist ||
      series.stats?.popularity != null ||
      series.stats?.favourites != null ||
      series.stats?.meanScore != null,
  );
}

function buildExactTagSet(tags: TagNode[], names: Set<string>) {
  return new Set(tags.filter((tag) => names.has(tag.name.trim().toLocaleLowerCase())).map((tag) => tag.id));
}

function buildDescendantTagSet(tags: TagNode[], roots: Set<number>) {
  if (roots.size === 0) return new Set<number>();
  const byParent = new Map<number, number[]>();
  for (const tag of tags) {
    if (tag.parent_id == null) continue;
    const children = byParent.get(tag.parent_id) ?? [];
    children.push(tag.id);
    byParent.set(tag.parent_id, children);
  }
  const collected = new Set<number>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childId of byParent.get(current) ?? []) {
      if (collected.has(childId)) continue;
      collected.add(childId);
      queue.push(childId);
    }
  }
  return collected;
}

export function buildSensitiveTagGroups(tags: TagNode[]) {
  const boysLove = buildDescendantTagSet(tags, buildExactTagSet(tags, new Set(["boys love"])));
  const girlsLove = buildDescendantTagSet(tags, buildExactTagSet(tags, new Set(["girls love"])));
  const yaoi = buildDescendantTagSet(tags, buildExactTagSet(tags, new Set(["yaoi"])));
  const yuri = buildDescendantTagSet(tags, buildExactTagSet(tags, new Set(["yuri"])));
  const smut = buildDescendantTagSet(tags, buildExactTagSet(tags, new Set(["smut"])));
  const hentai = buildDescendantTagSet(tags, buildExactTagSet(tags, new Set(["hentai"])));
  const relationshipRoots = buildExactTagSet(tags, RELATIONSHIP_SENSITIVE_NAMES);
  const relationship = buildDescendantTagSet(tags, relationshipRoots);
  const adultRoots = buildExactTagSet(tags, ADULT_SENSITIVE_NAMES);
  const adult = buildDescendantTagSet(tags, adultRoots);
  return {
    boysLove,
    girlsLove,
    yaoi,
    yuri,
    smut,
    hentai,
    relationship,
    adult,
    all: new Set([...relationship, ...adult]),
  };
}

export function buildSensitiveTagSet(tags: TagNode[]) {
  return buildSensitiveTagGroups(tags).all;
}

export function sensitiveTagIdsForSearch(
  query: string,
  groups: ReturnType<typeof buildSensitiveTagGroups>,
) {
  const family = SENSITIVE_SEARCH_ALIASES.get(query.trim().toLocaleLowerCase());
  return family ? groups[family] : null;
}

export function isSearchVisible(
  series: SeriesCatalog,
  settings: AppSettings,
  groups: ReturnType<typeof buildSensitiveTagGroups>,
) {
  const tagIds = new Set(series.tag_ids ?? []);
  const hasRelationshipTag = [...groups.relationship].some((id) => tagIds.has(id));
  const hasAdultTag = [...groups.adult].some((id) => tagIds.has(id));

  if (!settings.searchRelationshipTags && hasRelationshipTag) return false;
  if (!settings.searchAdultTags && hasAdultTag) return false;

  const rating = series.content_rating as AppSettings["contentRatings"][number] | null;
  if (rating && !settings.contentRatings.includes(rating)) {
    const explicitlyAllowed =
      (settings.searchRelationshipTags && hasRelationshipTag) ||
      (settings.searchAdultTags && hasAdultTag);
    if (!explicitlyAllowed) return false;
  }

  return true;
}

function dateTimeValue(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function anilistFirstAddedValue(series: SeriesCatalog) {
  return dateTimeValue(series.anilist_first_seen_at ?? series.first_seen_at ?? series.created_at ?? series.added_at ?? series.last_updated_at);
}

function hasMangaUpdates(series: SeriesCatalog) {
  return Boolean(series.source?.mangaupdates?.id || series.source?.mangaupdates?.url);
}

function decodeProxyCoverUrl(value: string) {
  try {
    const encoded = value.split("/").at(-1);
    if (!encoded) return "";
    return globalThis.atob(encoded.replace(/-/g, "+").replace(/_/g, "/")).toLocaleLowerCase();
  } catch {
    return "";
  }
}

function isAnimePlanetProxyCover(cover: string) {
  const normalized = cover.toLocaleLowerCase();
  if (normalized.includes("anime-planet.com") || normalized.includes("ap-proxy.mangabaka.dev/proxy")) return true;
  const decoded = decodeProxyCoverUrl(cover);
  return decoded.includes("anime-planet.com") || decoded.includes("ap-proxy.mangabaka.dev/proxy");
}

function hasUsableMangaBakaCover(series: SeriesCatalog) {
  const cover = series.cover?.trim();
  if (!cover) return false;
  return !isAnimePlanetProxyCover(cover);
}

function isNonAniListAddCandidate(series: SeriesCatalog) {
  return hasUsableMangaBakaCover(series) && hasMangaUpdates(series);
}

function sourceModesFromFilters(feed: Feed) {
  const filters = feed.filters;
  return (
    filters.sourceModes?.length
      ? filters.sourceModes
      : filters.sourceMode === "anilist"
        ? ["anilist"]
        : filters.sourceMode === "non-anilist"
          ? ["non-anilist"]
          : ["anilist", "non-anilist"]
  ).filter((mode) => mode !== "mixed");
}

export function feedUsesAniListOnlyParameters(feed: Feed) {
  const filters = feed.filters;
  if (
    filters.minPopularity != null ||
    filters.maxPopularity != null ||
    filters.minFavourites != null ||
    filters.maxFavourites != null ||
    filters.minMeanScore != null ||
    filters.maxMeanScore != null
  ) {
    return true;
  }
  const metrics = [
    ...feed.sort.map((rule) => rule.metric),
    ...(filters.metricRanges ?? []).map((range) => range.metric),
    ...(feed.view?.metricSlots ?? []),
  ];
  return metrics.some((metric) => metricDefinition(metric).anilistOnly);
}

export function effectiveSourceModesForFeed(feed: Feed) {
  return feedUsesAniListOnlyParameters(feed) ? ["anilist"] : sourceModesFromFilters(feed);
}

export function tagRoot(tag: TagNode) {
  return tag.path?.split(" > ")[0] || "Other";
}

export function isGenreTag(tag: TagNode) {
  return tag.is_genre || tagRoot(tag) === "Genres";
}

export function buildFuse(items: SeriesCatalog[], tagsById: Map<number, TagNode>) {
  return new Fuse(items, {
    includeScore: true,
    threshold: 0.24,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: "display_title", weight: 0.82 },
      { name: "animeplanet_title", weight: 0.44 },
      { name: "description", weight: 0.18 },
      { name: "authors", weight: 0.22 },
      { name: "artists", weight: 0.22 },
      {
        name: "tagText",
        weight: 0.16,
        getFn: (series) =>
          (series as SeriesCatalog).tag_ids
            ?.map((id) => tagsById.get(id)?.name)
            .filter(Boolean)
            .join(" ") ?? "",
      },
    ],
  });
}

export function labelMatchesSeries(label: UserLabel, item: SeriesCatalog) {
  if (label.manualTitleIds.includes(item.id)) return true;
  const rule = label.rule;
  if (!rule) return false;
  if (rule.minMeanScore != null && (item.stats.meanScore == null || item.stats.meanScore < rule.minMeanScore)) return false;
  if (rule.minPopularity != null && (item.stats.popularity == null || item.stats.popularity < rule.minPopularity)) return false;
  if (rule.minFavourites != null && (item.stats.favourites == null || item.stats.favourites < rule.minFavourites)) return false;
  if (rule.includeTagIds?.length && !rule.includeTagIds.every((tagId) => item.tag_ids.includes(tagId))) return false;
  return true;
}

export function runFeedQuery(args: {
  feed: Feed;
  series: SeriesCatalog[];
  tags: TagNode[];
  history: HistoryMap;
  labels: UserLabel[];
  settings: AppSettings;
  metaHistoryFirst?: string | null;
  metaHistoryLast?: string | null;
}): QueryResult {
  const { feed, series, tags, history, labels, settings, metaHistoryFirst, metaHistoryLast } = args;
  const filters = feed.filters;
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const includeTagGroups = filters.includeTagIds.map((id) => [id]);
  const includeTagIds = [...new Set(filters.includeTagIds)];
  const excludeTagIds = filters.excludeTagIds;
  const activeNotes: string[] = [];
  let limitedHistory = false;
  let missingDateData = false;
  let candidates = series;
  const usesLatestAddedSort = feed.sort.some((rule) => rule.metric === "mangabakaLatestRank");

  if (filters.query.trim()) {
    const q = filters.query.trim().toLocaleLowerCase();
    const exactMatches = series.filter((item) => {
      const tagText = item.tag_ids
        .map((id) => tagsById.get(id)?.name)
        .filter(Boolean)
        .join(" ");
      return `${item.display_title} ${(item.authors ?? []).join(" ")} ${(item.artists ?? []).join(" ")} ${tagText}`
        .toLocaleLowerCase()
        .includes(q);
    });
    if (exactMatches.length > 0) {
      candidates = exactMatches;
    } else {
      const fuse = buildFuse(series, tagsById);
      candidates = fuse.search(filters.query.trim()).map((result) => result.item);
    }
  }

  const window = resolveRollingWindow(filters.rolling, metaHistoryLast);
  const growthWindow = window ?? resolveRollingWindow({ mode: "last", amount: 1, unit: "days" }, metaHistoryLast);
  const usesHistorySort = feed.sort.some((rule) => rule.metric.includes("Growth") || rule.metric.includes("Delta"));
  if (window && usesHistorySort) {
    activeNotes.push(`Growth window: ${window.from} to ${window.to}.`);
    if (Object.keys(history).length === 0) activeNotes.push("Growth sorting will update after history sync finishes.");
  }
  if (window && metaHistoryFirst && window.from < metaHistoryFirst) {
    limitedHistory = true;
    activeNotes.push(`History is currently available from ${metaHistoryFirst} to ${metaHistoryLast}.`);
  }

  const result = candidates.filter((item) => {
    const rating = item.content_rating as AppSettings["contentRatings"][number] | null;
    if (rating && !filters.contentRatings.includes(rating)) return false;

    const ani = hasAniList(item);
    const sourceModes = effectiveSourceModesForFeed(feed);
    if (!sourceModes.includes(ani ? "anilist" : "non-anilist")) return false;
    if (!ani && usesLatestAddedSort && !isNonAniListAddCandidate(item)) return false;

    if (filters.statuses.length > 0 && (!item.status || !filters.statuses.includes(item.status))) return false;
    if (filters.includeEstimatedDates === false && !displayReleaseDate(item)) return false;

    if (filters.minYear != null && (item.year == null || item.year < filters.minYear)) return false;
    if (filters.maxYear != null && (item.year == null || item.year > filters.maxYear)) return false;

    const chapters = chapterNumber(item.total_chapters);
    if (filters.minChapters != null && (chapters == null || chapters < filters.minChapters)) return false;
    if (filters.maxChapters != null && (chapters == null || chapters > filters.maxChapters)) return false;

    if (filters.minPopularity != null && (item.stats.popularity == null || item.stats.popularity < filters.minPopularity)) return false;
    if (filters.maxPopularity != null && (item.stats.popularity == null || item.stats.popularity > filters.maxPopularity)) return false;
    if (filters.minFavourites != null && (item.stats.favourites == null || item.stats.favourites < filters.minFavourites)) return false;
    if (filters.maxFavourites != null && (item.stats.favourites == null || item.stats.favourites > filters.maxFavourites)) return false;
    if (filters.minMeanScore != null && (item.stats.meanScore == null || item.stats.meanScore < filters.minMeanScore)) return false;
    if (filters.maxMeanScore != null && (item.stats.meanScore == null || item.stats.meanScore > filters.maxMeanScore)) return false;
    for (const range of filters.metricRanges ?? []) {
      const value = (growthWindow && (range.metric.includes("Growth") || range.metric.includes("Delta")))
        ? historyDeltaForWindow(item.id, range.metric, history, growthWindow.from, growthWindow.to)
        : displayComparableMetricValue(item, range.metric, history, metaHistoryLast);
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      if (range.min != null && value < range.min) return false;
      if (range.max != null && value > range.max) return false;
    }

    if (includeTagIds.length > 0) {
      const hasTagGroup = (ids: number[]) => ids.some((id) => item.tag_ids.includes(id));
      const ok = filters.tagMatch === "all" ? includeTagGroups.every(hasTagGroup) : includeTagGroups.some(hasTagGroup);
      if (!ok) return false;
    }
    if (excludeTagIds.some((id) => item.tag_ids.includes(id))) return false;

    if (filters.labelIds.length > 0) {
      const matchingLabels = labels.filter((label) => filters.labelIds.includes(label.id));
      const itemLabelIds = matchingLabels.filter((label) => labelMatchesSeries(label, item)).map((label) => label.id);
      if (itemLabelIds.length === 0) return false;
    }

    if (window && filters.dateField !== "none") {
      const dateValue = filters.dateField === "release" ? effectiveReleaseDate(item) : effectiveEndDate(item);
      if (!dateValue) {
        missingDateData = true;
        return false;
      }
      if (isFutureDate(dateValue)) return false;
      if (!isDateWithin(dateValue, window.from, window.to)) return false;
    }

    return true;
  });

  const effectiveSourceModes = effectiveSourceModesForFeed(feed);
  const usesAniListAddedSort = usesLatestAddedSort && effectiveSourceModes.length === 1 && effectiveSourceModes[0] === "anilist";
  const sorted = [...result].sort((a, b) => {
    const aAni = hasAniList(a);
    const bAni = hasAniList(b);
    if (!usesLatestAddedSort && (filters.sourceModes?.length ?? 0) > 1 && aAni !== bAni && settings.nonAniListPlacement !== "mixed") {
      return settings.nonAniListPlacement === "top" ? (aAni ? 1 : -1) : aAni ? -1 : 1;
    }

    if (usesAniListAddedSort) {
      const av = anilistFirstAddedValue(a);
      const bv = anilistFirstAddedValue(b);
      if (av !== bv) return av - bv;
    }

    for (const rule of feed.sort) {
      if (usesAniListAddedSort && rule.metric === "mangabakaLatestRank") continue;
      let av = metricValue(a, rule.metric, history, metaHistoryLast);
      let bv = metricValue(b, rule.metric, history, metaHistoryLast);
      if (growthWindow && (rule.metric.includes("Growth") || rule.metric.includes("Delta"))) {
        av = historyDeltaForWindow(a.id, rule.metric, history, growthWindow.from, growthWindow.to) ?? av;
        bv = historyDeltaForWindow(b.id, rule.metric, history, growthWindow.from, growthWindow.to) ?? bv;
      }
      const aMissing = typeof av !== "string" && (!Number.isFinite(Number(av)) || av == null);
      const bMissing = typeof bv !== "string" && (!Number.isFinite(Number(bv)) || bv == null);
      if (aMissing || bMissing) {
        if (aMissing && bMissing) continue;
        return aMissing ? 1 : -1;
      }
      if (av === bv) continue;
      const direction = rule.direction === "asc" ? 1 : -1;
      return av > bv ? direction : -direction;
    }
    const fallbackMetrics: Array<"popularity" | "fanFavouriteRaw" | "favourites"> = ["popularity", "fanFavouriteRaw", "favourites"];
    for (const metric of fallbackMetrics) {
      const av = metricValue(a, metric, history, metaHistoryLast);
      const bv = metricValue(b, metric, history, metaHistoryLast);
      const aMissing = !Number.isFinite(Number(av)) || av == null;
      const bMissing = !Number.isFinite(Number(bv)) || bv == null;
      if (aMissing || bMissing) {
        if (aMissing && bMissing) continue;
        return aMissing ? 1 : -1;
      }
      if (av !== bv) return av > bv ? -1 : 1;
    }
    const updatedDiff = dateTimeValue(b.last_updated_at) - dateTimeValue(a.last_updated_at);
    if (updatedDiff !== 0) return updatedDiff;
    if (a.id !== b.id) return b.id - a.id;
    return a.display_title.localeCompare(b.display_title);
  });

  return {
    items: sorted,
    limitedHistory,
    missingDateData,
    activeNotes,
  };
}
