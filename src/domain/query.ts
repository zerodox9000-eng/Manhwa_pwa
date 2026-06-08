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
import { chapterNumber, historyDeltaForWindow, metricValue } from "./metrics";

const RELATIONSHIP_SENSITIVE_MATCH =
  /\b(Boys['’ ]?Love|Girls['’ ]?Love|Yaoi|Yuri|Shounen Ai|Shoujo Ai|Danmei|Bara|Baihe|Tanbi)\b/i;
const ADULT_SENSITIVE_MATCH = /\b(Smut|Hentai)\b/i;

export function hasAniList(series: SeriesCatalog) {
  return Boolean(
    series.source?.anilist ||
      series.stats?.popularity != null ||
      series.stats?.favourites != null ||
      series.stats?.meanScore != null,
  );
}

function buildTagSet(tags: TagNode[], matches: (tag: TagNode) => boolean) {
  const sensitive = new Set<number>();
  const byParent = new Map<number, TagNode[]>();
  for (const tag of tags) {
    if (tag.parent_id != null) {
      const existing = byParent.get(tag.parent_id) ?? [];
      existing.push(tag);
      byParent.set(tag.parent_id, existing);
    }
  }

  const visit = (tag: TagNode) => {
    sensitive.add(tag.id);
    for (const child of byParent.get(tag.id) ?? []) visit(child);
  };

  for (const tag of tags) {
    if (matches(tag)) visit(tag);
  }
  return sensitive;
}

export function buildSensitiveTagGroups(tags: TagNode[]) {
  const relationship = buildTagSet(tags, (tag) => RELATIONSHIP_SENSITIVE_MATCH.test(`${tag.name} ${tag.path}`));
  const adult = buildTagSet(tags, (tag) => ADULT_SENSITIVE_MATCH.test(`${tag.name} ${tag.path}`));
  return {
    relationship,
    adult,
    all: new Set([...relationship, ...adult]),
  };
}

export function buildSensitiveTagSet(tags: TagNode[]) {
  return buildSensitiveTagGroups(tags).all;
}

function expandTagIds(ids: number[], tags: TagNode[]) {
  if (ids.length === 0) return ids;
  const expanded = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const tag of tags) {
      if (tag.parent_id != null && expanded.has(tag.parent_id) && !expanded.has(tag.id)) {
        expanded.add(tag.id);
        changed = true;
      }
    }
  }
  return [...expanded];
}

function dateTimeValue(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
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
  const sensitiveTagIds = buildSensitiveTagSet(tags);
  const includeTagGroups = filters.includeTagIds.map((id) => expandTagIds([id], tags));
  const includeTagIds = [...new Set(includeTagGroups.flat())];
  const excludeTagIds = expandTagIds(filters.excludeTagIds, tags);
  const activeNotes: string[] = [];
  let limitedHistory = false;
  let missingDateData = false;
  let candidates = series;

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
    const hasSensitive = item.tag_ids.some((id) => sensitiveTagIds.has(id));
    const hasIncludedSensitive = includeTagIds.some((id) => sensitiveTagIds.has(id));
    if (hasSensitive && !hasIncludedSensitive) return false;

    const ani = hasAniList(item);
    const sourceModes = (
      filters.sourceModes?.length
        ? filters.sourceModes
        : filters.sourceMode === "anilist"
          ? ["anilist"]
          : filters.sourceMode === "non-anilist"
            ? ["non-anilist"]
            : ["anilist", "non-anilist"]
    ).filter((mode) => mode !== "mixed");
    if (!sourceModes.includes(ani ? "anilist" : "non-anilist")) return false;

    if (filters.statuses.length > 0 && (!item.status || !filters.statuses.includes(item.status))) return false;
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
      const value = metricValue(item, range.metric, history, metaHistoryLast);
      if (typeof value !== "number" || value === -Infinity || Number.isNaN(value)) return false;
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
      const dateValue = filters.dateField === "release" ? item.published?.start_date : item.published?.end_date;
      if (!dateValue) {
        missingDateData = true;
        return false;
      }
      if (isFutureDate(dateValue)) return false;
      if (!isDateWithin(dateValue, window.from, window.to)) return false;
    }

    return true;
  });

  const sorted = [...result].sort((a, b) => {
    const aAni = hasAniList(a);
    const bAni = hasAniList(b);
    if ((filters.sourceModes?.length ?? 0) > 1 && aAni !== bAni && settings.nonAniListPlacement !== "mixed") {
      return settings.nonAniListPlacement === "top" ? (aAni ? 1 : -1) : aAni ? -1 : 1;
    }

    for (const rule of feed.sort) {
      let av = metricValue(a, rule.metric, history, metaHistoryLast);
      let bv = metricValue(b, rule.metric, history, metaHistoryLast);
      if (window && rule.metric.includes("Growth")) {
        av = historyDeltaForWindow(a.id, rule.metric, history, window.from, window.to) ?? av;
        bv = historyDeltaForWindow(b.id, rule.metric, history, window.from, window.to) ?? bv;
      }
      const aMissing = typeof av !== "string" && (av === -Infinity || av == null || Number.isNaN(Number(av)));
      const bMissing = typeof bv !== "string" && (bv === -Infinity || bv == null || Number.isNaN(Number(bv)));
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
      const aMissing = av === -Infinity || av == null || Number.isNaN(Number(av));
      const bMissing = bv === -Infinity || bv == null || Number.isNaN(Number(bv));
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
