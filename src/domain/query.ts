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
import { chapterNumber, displayReleaseDate, historyDeltaForWindow, isRollingMetric, listedDate, metricDefinition, metricValue, realEndDate, realReleaseDate } from "./metrics";

const RELATIONSHIP_SENSITIVE_NAMES = new Set(["boys love", "girls love"]);
const ADULT_SENSITIVE_NAMES = new Set(["smut", "hentai"]);

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

export function buildSensitiveTagGroups(tags: TagNode[]) {
  const relationship = buildExactTagSet(tags, RELATIONSHIP_SENSITIVE_NAMES);
  const adult = buildExactTagSet(tags, ADULT_SENSITIVE_NAMES);
  return {
    relationship,
    adult,
    all: new Set([...relationship, ...adult]),
  };
}

export function buildSensitiveTagSet(tags: TagNode[]) {
  return buildSensitiveTagGroups(tags).all;
}

function dateTimeValue(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
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

function debugDirectionLabel(metric: Feed["sort"][number]["metric"], direction: Feed["sort"][number]["direction"]) {
  if (metric === "title") return direction === "asc" ? "A-Z" : "Z-A";
  if (metric === "mangabakaLatestRank") return direction === "asc" ? "Latest first" : "Older first";
  if (metric === "releaseDate" || metric === "endDate" || metric === "year") return direction === "desc" ? "Newest first" : "Oldest first";
  if (isRollingMetric(metric)) return direction === "desc" ? "Biggest gain first" : "Smallest gain first";
  return direction === "desc" ? "High first" : "Low first";
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
  const debugCounts: Record<string, number> = {};
  let limitedHistory = false;
  let missingDateData = false;
  let candidates = series;
  const count = (key: string) => {
    debugCounts[key] = (debugCounts[key] ?? 0) + 1;
  };

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
  const usesHistorySort = feed.sort.some((rule) => isRollingMetric(rule.metric));
  const sourceModes = effectiveSourceModesForFeed(feed);
  activeNotes.push(`Date mode: ${filters.dateField === "none" ? "None" : filters.dateField === "release" ? "Rel" : filters.dateField === "added" ? "Listed date" : "End"}.`);
  activeNotes.push(`Source: ${sourceModes.join(" + ")}${feedUsesAniListOnlyParameters(feed) ? " (AniList stat locked)" : ""}.`);
  activeNotes.push(`Sort: ${feed.sort.map((rule) => `${metricDefinition(rule.metric).shortLabel} - ${debugDirectionLabel(rule.metric, rule.direction)}`).join(", ") || "none"}.`);
  if (feed.view?.metricSlots?.length) {
    activeNotes.push(`Cover stats: ${feed.view.metricSlots.map((metric) => metricDefinition(metric).shortLabel).join(", ")} (display only).`);
  }
  if (filters.dateField === "release") activeNotes.push("Rel date mode: real non-estimated release dates only.");
  if (filters.dateField === "added") activeNotes.push("Added date mode: first-seen/listed date cutoff, sorted separately from Add rank.");
  if (filters.dateField === "end") activeNotes.push("End date mode: actual non-estimated completion dates only.");
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
    if (rating && !filters.contentRatings.includes(rating)) {
      count("Excluded by content rating");
      return false;
    }

    const ani = hasAniList(item);
    if (!sourceModes.includes(ani ? "anilist" : "non-anilist")) {
      count("Excluded by source");
      return false;
    }

    if (filters.statuses.length > 0 && (!item.status || !filters.statuses.includes(item.status))) {
      count("Excluded by status");
      return false;
    }
    if (filters.includeEstimatedDates === false && !displayReleaseDate(item)) {
      if (item.published?.start_date_is_estimated) count("Excluded estimated release date");
      else count("Excluded missing real release date");
      return false;
    }

    if (filters.minYear != null && (item.year == null || item.year < filters.minYear)) {
      count("Excluded by year range");
      return false;
    }
    if (filters.maxYear != null && (item.year == null || item.year > filters.maxYear)) {
      count("Excluded by year range");
      return false;
    }

    const chapters = chapterNumber(item.total_chapters);
    if (filters.minChapters != null && (chapters == null || chapters < filters.minChapters)) {
      count("Excluded by chapter range");
      return false;
    }
    if (filters.maxChapters != null && (chapters == null || chapters > filters.maxChapters)) {
      count("Excluded by chapter range");
      return false;
    }

    if (filters.minPopularity != null && (item.stats.popularity == null || item.stats.popularity < filters.minPopularity)) {
      count("Excluded by stat range");
      return false;
    }
    if (filters.maxPopularity != null && (item.stats.popularity == null || item.stats.popularity > filters.maxPopularity)) {
      count("Excluded by stat range");
      return false;
    }
    if (filters.minFavourites != null && (item.stats.favourites == null || item.stats.favourites < filters.minFavourites)) {
      count("Excluded by stat range");
      return false;
    }
    if (filters.maxFavourites != null && (item.stats.favourites == null || item.stats.favourites > filters.maxFavourites)) {
      count("Excluded by stat range");
      return false;
    }
    if (filters.minMeanScore != null && (item.stats.meanScore == null || item.stats.meanScore < filters.minMeanScore)) {
      count("Excluded by stat range");
      return false;
    }
    if (filters.maxMeanScore != null && (item.stats.meanScore == null || item.stats.meanScore > filters.maxMeanScore)) {
      count("Excluded by stat range");
      return false;
    }
    for (const range of filters.metricRanges ?? []) {
      const value = metricValue(item, range.metric, history, metaHistoryLast);
      if (typeof value !== "number" || !Number.isFinite(value)) {
        count("Excluded by stat range");
        return false;
      }
      if (range.min != null && value < range.min) {
        count("Excluded by stat range");
        return false;
      }
      if (range.max != null && value > range.max) {
        count("Excluded by stat range");
        return false;
      }
    }

    if (includeTagIds.length > 0) {
      const hasTagGroup = (ids: number[]) => ids.some((id) => item.tag_ids.includes(id));
      const ok = filters.tagMatch === "all" ? includeTagGroups.every(hasTagGroup) : includeTagGroups.some(hasTagGroup);
      if (!ok) {
        count("Excluded by included tags");
        return false;
      }
    }
    if (excludeTagIds.some((id) => item.tag_ids.includes(id))) {
      count("Excluded by blocked tags");
      return false;
    }

    if (filters.labelIds.length > 0) {
      const matchingLabels = labels.filter((label) => filters.labelIds.includes(label.id));
      const itemLabelIds = matchingLabels.filter((label) => labelMatchesSeries(label, item)).map((label) => label.id);
      if (itemLabelIds.length === 0) {
        count("Excluded by labels");
        return false;
      }
    }

    if (window && filters.dateField !== "none") {
      const dateValue =
        filters.dateField === "release"
          ? realReleaseDate(item)
          : filters.dateField === "end"
            ? realEndDate(item)
            : listedDate(item);
      if (!dateValue) {
        missingDateData = true;
        if (filters.dateField === "release" && item.published?.start_date_is_estimated) count("Excluded estimated release date");
        else if (filters.dateField === "release") count("Excluded missing real release date");
        else if (filters.dateField === "end") count("Excluded missing real end date");
        else count("Excluded missing added/listed date");
        return false;
      }
      if (isFutureDate(dateValue)) {
        count("Excluded future date");
        return false;
      }
      if (!isDateWithin(dateValue, window.from, window.to)) {
        count("Excluded outside date window");
        return false;
      }
    }

    return true;
  });

  const usesLatestAddedSort = feed.sort.some((rule) => rule.metric === "mangabakaLatestRank");
  const sorted = [...result].sort((a, b) => {
    const aAni = hasAniList(a);
    const bAni = hasAniList(b);
    if (!usesLatestAddedSort && (filters.sourceModes?.length ?? 0) > 1 && aAni !== bAni && settings.nonAniListPlacement !== "mixed") {
      return settings.nonAniListPlacement === "top" ? (aAni ? 1 : -1) : aAni ? -1 : 1;
    }

    for (const rule of feed.sort) {
      let av = metricValue(a, rule.metric, history, metaHistoryLast);
      let bv = metricValue(b, rule.metric, history, metaHistoryLast);
      if (window && isRollingMetric(rule.metric)) {
        av = historyDeltaForWindow(a.id, rule.metric, history, window.from, window.to) ?? av;
        bv = historyDeltaForWindow(b.id, rule.metric, history, window.from, window.to) ?? bv;
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
    debugCounts,
  };
}
