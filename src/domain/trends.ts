import type { HistoryEntry, SeriesCatalog } from "./types";
import { POPULARITY_BANDS, popularityBandForDisplayedPercentile, popularityBandIndex, type PopularityBandId } from "./popularityBands";

export const TREND_WINDOW_DAYS = 365;
const DAY_MS = 86_400_000;
const DISCOVER_EXCLUDED_TAG_IDS = new Set([4, 180, 41, 10]);

export type TrendEventBandId = PopularityBandId | "deep-cut";

export interface TrendEvent {
  id: number;
  date: string;
  from: TrendEventBandId | null;
  to: TrendEventBandId;
  direction: "rising" | "falling";
  popularityPercentile: number;
  previousObservedDate: string | null;
  observedMilestones: Partial<Record<TrendEventBandId, string>>;
}

export interface TrendBuildResult {
  latestDate: string | null;
  events: TrendEvent[];
}

export interface StatusChangeEvent {
  id: number;
  date: string;
  from: string;
  to: string;
}

export interface ChapterChangeEvent {
  id: number;
  date: string;
  from: number;
  to: number;
}

export interface UpdatesExport {
  schemaVersion: 1;
  generatedAt: string;
  latestDate: string;
  windowDays: number;
  statusWindowDays: number;
  chapterWindowDays: number;
  eligibleTitleCount: number;
  popularity: TrendEvent[];
  statuses: StatusChangeEvent[];
  chapters: ChapterChangeEvent[];
}

export interface HistoryRow {
  id: string;
  entries: HistoryEntry[];
}

function isDiscoverEligible(series: SeriesCatalog) {
  if (series.content_rating !== "safe" && series.content_rating !== "suggestive") return false;
  if (!series.stats || !Number.isFinite(series.stats.popularity)) return false;
  return !(series.tag_ids ?? []).some((id) => DISCOVER_EXCLUDED_TAG_IDS.has(id));
}

export function buildTrendEvents(
  catalog: SeriesCatalog[],
  historyRows: HistoryRow[],
  onProgress?: (value: number) => void,
): TrendBuildResult {
  const eligibleIds = new Set(catalog.filter(isDiscoverEligible).map((series) => series.id));
  let latestDate: string | null = null;
  for (const row of historyRows) {
    for (const entry of row.entries ?? []) {
      if (entry.d && (!latestDate || entry.d > latestDate)) latestDate = entry.d;
    }
  }
  if (!latestDate) return { latestDate: null, events: [] };
  const cutoff = Date.parse(`${latestDate}T00:00:00Z`) - TREND_WINDOW_DAYS * DAY_MS;
  const events: TrendEvent[] = [];

  historyRows.forEach((row, rowIndex) => {
    const id = Number(row.id);
    if (!eligibleIds.has(id)) return;
    const entries = [...(row.entries ?? [])]
      .filter((entry) => entry.d && Number.isFinite(entry.pp))
      .sort((left, right) => left.d.localeCompare(right.d));
    let prior: { band: PopularityBandId | null; enteredAt: string | null } | null = null;
    const titleMilestones: Partial<Record<PopularityBandId, string>> = {};
    const titleAchievements = new Set<PopularityBandId>();

    for (const entry of entries) {
      const date = entry.d;
      const displayedPercentile = Math.round(entry.pp);
      const band = popularityBandForDisplayedPercentile(displayedPercentile);
      if (!prior) {
        const initialBandIndex = popularityBandIndex(band);
        POPULARITY_BANDS.slice(0, initialBandIndex + 1).forEach((item) => titleAchievements.add(item.id));
        prior = { band, enteredAt: null };
        continue;
      }
      if (prior.band === band) continue;

      const direction = popularityBandIndex(band) > popularityBandIndex(prior.band) ? "rising" : "falling";
      if (direction === "rising" && band) {
        const previousIndex = popularityBandIndex(prior.band);
        const nextIndex = popularityBandIndex(band);
        for (let index = Math.max(0, previousIndex + 1); index <= nextIndex; index += 1) {
          const achievedBand = POPULARITY_BANDS[index].id;
          if (titleAchievements.has(achievedBand)) continue;
          titleAchievements.add(achievedBand);
          titleMilestones[achievedBand] = date;
          if (Date.parse(`${date}T00:00:00Z`) >= cutoff) {
            events.push({
              id,
              date,
              from: index === 0 ? null : POPULARITY_BANDS[index - 1].id,
              to: achievedBand,
              direction,
              popularityPercentile: displayedPercentile,
              previousObservedDate: prior.enteredAt,
              observedMilestones: { ...titleMilestones },
            });
          }
        }
      }
      prior = { band, enteredAt: date };
    }

    if (rowIndex % 200 === 0 || rowIndex === historyRows.length - 1) onProgress?.((rowIndex + 1) / historyRows.length);
  });

  return {
    latestDate,
    events: events.sort((left, right) =>
      right.date.localeCompare(left.date) || right.popularityPercentile - left.popularityPercentile,
    ),
  };
}

function addUtcYears(date: Date, years: number) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function addUtcMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function unit(value: number, singular: string) {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

export function formatTrendDuration(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return null;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;

  let years = end.getUTCFullYear() - start.getUTCFullYear();
  while (years > 0 && addUtcYears(start, years) > end) years -= 1;
  const afterYears = addUtcYears(start, years);
  let months = (end.getUTCFullYear() - afterYears.getUTCFullYear()) * 12 + end.getUTCMonth() - afterYears.getUTCMonth();
  while (months > 0 && addUtcMonths(afterYears, months) > end) months -= 1;
  const afterMonths = addUtcMonths(afterYears, months);
  const days = Math.floor((end.getTime() - afterMonths.getTime()) / DAY_MS);

  if (years > 0) {
    if (months > 0) return `${unit(years, "year")} ${unit(months, "month")}`;
    if (days > 0) return `${unit(years, "year")} ${unit(days, "day")}`;
    return unit(years, "year");
  }
  if (months > 0) return days > 0 ? `${unit(months, "month")} ${unit(days, "day")}` : unit(months, "month");
  return unit(days, "day");
}
