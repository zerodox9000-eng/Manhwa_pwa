import type { HistoryMap, MetricId, SeriesCatalog } from "./types";
import { parseDate } from "./dates";

export interface MetricDefinition {
  id: MetricId;
  label: string;
  shortLabel: string;
  help: string;
  filterable: boolean;
  anilistOnly: boolean;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { id: "fanFavouriteRaw", label: "Fan favourite percent", shortLabel: "Fan%", help: "Favourites divided by popularity. Better for finding loved titles, not just famous ones.", filterable: true, anilistOnly: true },
  { id: "popularity", label: "Popularity", shortLabel: "Pop", help: "AniList popularity count. Good for broad mainstream sorting.", filterable: true, anilistOnly: true },
  { id: "favourites", label: "Favourites", shortLabel: "Fav", help: "AniList favourite count. Good for strong fandom signal.", filterable: true, anilistOnly: true },
  { id: "meanScore", label: "Mean score", shortLabel: "Score", help: "AniList mean score from users. Hidden by default because coverage varies.", filterable: true, anilistOnly: true },
  { id: "fanRatioPercentile", label: "Fan percent percentile", shortLabel: "FanPct", help: "How high the fan favourite percent ranks against other titles.", filterable: true, anilistOnly: true },
  { id: "popularityPercentile", label: "Popularity percentile", shortLabel: "PopPct", help: "How high popularity ranks against other titles.", filterable: true, anilistOnly: true },
  { id: "fanFavouriteDiscoveryScore", label: "Discovery score", shortLabel: "Disc", help: "Balanced score for loved titles with enough popularity confidence.", filterable: true, anilistOnly: true },
  { id: "fanFavouriteDiscoveryPercentile", label: "Discovery percentile", shortLabel: "DiscPct", help: "Percentile version of discovery score.", filterable: true, anilistOnly: true },
  { id: "year", label: "Year", shortLabel: "Year", help: "Release year from the catalog.", filterable: true, anilistOnly: false },
  { id: "chapters", label: "Chapters", shortLabel: "Ch", help: "Parsed chapter count when available.", filterable: true, anilistOnly: false },
  { id: "releaseDate", label: "Release date", shortLabel: "Rel", help: "Start date from MangaBaka/AniList export.", filterable: false, anilistOnly: false },
  { id: "endDate", label: "End date", shortLabel: "End", help: "Completion/end date when available.", filterable: false, anilistOnly: false },
  { id: "popularityGrowth", label: "Popularity growth", shortLabel: "Pop+", help: "Popularity delta across available history.", filterable: true, anilistOnly: true },
  { id: "popularityGrowthPercent", label: "Popularity growth percent", shortLabel: "Pop+%", help: "Popularity percentage growth across available history.", filterable: true, anilistOnly: true },
  { id: "favouritesGrowth", label: "Favourites growth", shortLabel: "Fav+", help: "Favourite delta across available history.", filterable: true, anilistOnly: true },
  { id: "favouritesGrowthPercent", label: "Favourites growth percent", shortLabel: "Fav+%", help: "Favourite percentage growth across available history.", filterable: true, anilistOnly: true },
  { id: "meanScoreDelta", label: "Mean score delta", shortLabel: "Score+", help: "Mean score movement across available history.", filterable: true, anilistOnly: true },
  { id: "fanFavouriteDelta", label: "Fan percent delta", shortLabel: "Fan+%", help: "Fan favourite percent movement across available history.", filterable: true, anilistOnly: true },
  { id: "discoveryScoreDelta", label: "Discovery score delta", shortLabel: "Disc+", help: "Discovery score movement across available history.", filterable: true, anilistOnly: true },
  { id: "discoveryPercentileDelta", label: "Discovery percentile delta", shortLabel: "DiscPct+", help: "Discovery percentile movement across available history.", filterable: true, anilistOnly: true },
  { id: "title", label: "Title", shortLabel: "A-Z", help: "Alphabetical title sort.", filterable: false, anilistOnly: false },
];

export const metricDefinition = (metric: MetricId) =>
  METRIC_DEFINITIONS.find((definition) => definition.id === metric) ?? METRIC_DEFINITIONS[0];

export function chapterNumber(value: SeriesCatalog["total_chapters"]) {
  if (value == null) return null;
  const number = Number.parseFloat(String(value));
  return Number.isFinite(number) ? number : null;
}

function closestHistory(entries: HistoryMap[string], targetDate: string, direction: "before" | "after") {
  const filtered = entries.filter((entry) =>
    direction === "before" ? entry.d <= targetDate : entry.d >= targetDate,
  );
  return direction === "before" ? filtered.at(-1) : filtered[0];
}

export function historyDeltaForWindow(seriesId: number, metric: MetricId, history: HistoryMap, from: string, to: string) {
  const entries = history[String(seriesId)] ?? [];
  const start = closestHistory(entries, from, "after");
  const end = closestHistory(entries, to, "before");
  if (!start || !end) return null;
  const read = (entry: HistoryMap[string][number]) => {
    if (metric.includes("popularity")) return entry.p;
    if (metric.includes("favourites")) return entry.f;
    if (metric.includes("meanScore")) return entry.s;
    if (metric.includes("fanFavourite")) return entry.r;
    if (metric.includes("discoveryPercentile")) return entry.dp;
    if (metric.includes("discoveryScore")) return entry.ds;
    return null;
  };
  const a = read(start);
  const b = read(end);
  if (a == null || b == null) return null;
  if (metric.includes("Percent") && a !== 0) return ((b - a) / a) * 100;
  return b - a;
}

export function metricValue(series: SeriesCatalog, metric: MetricId, history: HistoryMap = {}, latestDate?: string | null) {
  const stats = series.stats ?? {};
  const analytics = series.analytics ?? {};
  if (metric === "title") return series.display_title.toLocaleLowerCase();
  if (metric === "year") return series.year ?? -Infinity;
  if (metric === "chapters") return chapterNumber(series.total_chapters) ?? -Infinity;
  if (metric === "popularity") return stats.popularity ?? -Infinity;
  if (metric === "favourites") return stats.favourites ?? -Infinity;
  if (metric === "meanScore") return stats.meanScore ?? -Infinity;
  if (metric === "fanFavouriteRaw") return analytics.fanFavouriteRaw ?? -Infinity;
  if (metric === "fanRatioPercentile") return analytics.fanRatioPercentile ?? -Infinity;
  if (metric === "popularityPercentile") return analytics.popularityPercentile ?? -Infinity;
  if (metric === "fanFavouriteDiscoveryScore") return analytics.fanFavouriteDiscoveryScore ?? -Infinity;
  if (metric === "fanFavouriteDiscoveryPercentile") return analytics.fanFavouriteDiscoveryPercentile ?? -Infinity;
  if (metric === "releaseDate") return parseDate(series.published?.start_date)?.getTime() ?? -Infinity;
  if (metric === "endDate") return parseDate(series.published?.end_date)?.getTime() ?? -Infinity;

  const entries = history[String(series.id)] ?? [];
  const earliest = entries[0];
  if (!earliest) return -Infinity;

  const delta = (a: number | null | undefined, b: number | null | undefined) =>
    a == null || b == null ? -Infinity : a - b;
  const percent = (a: number | null | undefined, b: number | null | undefined) =>
    a == null || b == null || b === 0 ? -Infinity : ((a - b) / b) * 100;

  const latestHistory = latestDate ? closestHistory(entries, latestDate, "before") : entries.at(-1);
  const current = {
    p: stats.popularity ?? latestHistory?.p,
    f: stats.favourites ?? latestHistory?.f,
    s: stats.meanScore ?? latestHistory?.s,
    r: analytics.fanFavouriteRaw ?? latestHistory?.r,
    ds: analytics.fanFavouriteDiscoveryScore ?? latestHistory?.ds,
    dp: analytics.fanFavouriteDiscoveryPercentile ?? latestHistory?.dp,
  };
  if (metric === "popularityGrowth") return delta(current.p, earliest.p);
  if (metric === "popularityGrowthPercent") return percent(current.p, earliest.p);
  if (metric === "favouritesGrowth") return delta(current.f, earliest.f);
  if (metric === "favouritesGrowthPercent") return percent(current.f, earliest.f);
  if (metric === "meanScoreDelta") return delta(current.s, earliest.s);
  if (metric === "fanFavouriteDelta") return delta(current.r, earliest.r);
  if (metric === "discoveryScoreDelta") return delta(current.ds, earliest.ds);
  if (metric === "discoveryPercentileDelta") return delta(current.dp, earliest.dp);
  return -Infinity;
}

export function formatMetricValue(series: SeriesCatalog, metric: MetricId, history?: HistoryMap, latestDate?: string | null) {
  const value = metricValue(series, metric, history, latestDate);
  if (value === -Infinity || value == null || Number.isNaN(Number(value))) return "n/a";
  if (typeof value === "string") return value;
  if (metric === "fanFavouriteRaw" || metric === "fanFavouriteDelta") return `${Number(value).toFixed(1)}%`;
  if (metric.includes("Percentile") || metric.includes("Percent") || metric.includes("Percentile")) return `${Number(value).toFixed(0)}%`;
  if (metric === "meanScore" || metric === "fanFavouriteDiscoveryScore" || metric === "fanFavouriteDiscoveryPercentile") {
    return Number(value).toFixed(metric === "meanScore" ? 0 : 1);
  }
  if (metric === "releaseDate" || metric === "endDate") {
    const raw = metric === "releaseDate" ? series.published?.start_date : series.published?.end_date;
    return raw ?? "n/a";
  }
  if (metric === "year") return String(Math.trunc(Number(value)));
  return Number(value).toLocaleString();
}
