import type { Feed, FeedFilters, MetricId, MetricRange, SortRule } from "./types";
import { isGrowthMetric } from "./metrics";
import { POPULARITY_BANDS } from "./popularityBands";

export type FeedPresetOption = {
  id: string;
  label: string;
  metric: MetricId;
  min: number | null;
  max: number | null;
};

export const POPULARITY_PRESETS: FeedPresetOption[] = [
  ...[...POPULARITY_BANDS].reverse().map((band) => ({
    id: band.id === "top1" ? "top-one" : band.id,
    label: band.label,
    metric: "popularityPercentile" as const,
    min: band.min,
    max: band.max,
  })),
  { id: "deep-cut", label: "Deep Cut", metric: "popularityPercentile", min: null, max: 69 },
  { id: "top-half", label: "Top Half", metric: "popularityPercentile", min: 50, max: null },
  { id: "bottom-half", label: "Bottom Half", metric: "popularityPercentile", min: null, max: 49 },
];

export const FAN_RANK_PRESETS: FeedPresetOption[] = [
  ...[90, 80, 70, 60, 50].map((min) => ({
    id: `${min}-plus`,
    label: `${min}%+`,
    metric: "fanFavouriteDiscoveryPercentile" as const,
    min,
    max: null,
  })),
  { id: "below-50", label: "Below 50%", metric: "fanFavouriteDiscoveryPercentile", min: null, max: 49 },
];

export const CHAPTER_PRESETS: FeedPresetOption[] = [
  ...[200, 150, 100, 50, 30, 20, 10].map((min) => ({
    id: `${min}-plus`,
    label: `${min}+`,
    metric: "chapters" as const,
    min,
    max: null,
  })),
  { id: "below-10", label: "Below 10", metric: "chapters", min: null, max: 9 },
];

export const STATUS_PRESETS = [
  { id: "releasing", label: "Releasing", value: "releasing" },
  { id: "completed", label: "Completed", value: "completed" },
  { id: "hiatus", label: "Hiatus", value: "hiatus" },
  { id: "upcoming", label: "Upcoming", value: "upcoming" },
  { id: "cancelled", label: "Cancelled", value: "cancelled" },
  { id: "all", label: "All statuses", value: null },
] as const;

export const SORT_PRESETS: ReadonlyArray<{ id: string; label: string; metric: MetricId }> = [
  { id: "fan-rank", label: "Fan Rank", metric: "fanFavouriteDiscoveryPercentile" },
  { id: "popularity-growth", label: "Popularity Growth", metric: "popularityGrowthPercent" },
  { id: "popularity", label: "Popularity", metric: "popularity" },
  { id: "chapters", label: "Chapters", metric: "chapters" },
  { id: "release", label: "Newest Releases", metric: "releaseDate" },
  { id: "end", label: "Recent Completions", metric: "endDate" },
  { id: "fan-rank-growth", label: "Fan Rank Growth", metric: "discoveryPercentileDelta" },
];

export const PERIOD_PRESETS = [
  { id: "week", label: "1 Week", amount: 1, unit: "weeks" },
  { id: "month", label: "1 Month", amount: 1, unit: "months" },
  { id: "three-months", label: "3 Months", amount: 3, unit: "months" },
  { id: "year", label: "1 Year", amount: 1, unit: "years" },
] as const;

export const WEEKLY_GROWTH_PERIOD = PERIOD_PRESETS[0];

export const PERIOD_PURPOSES = [
  { id: "growth", label: "Growth", dateField: "none" },
  { id: "release", label: "Released", dateField: "release" },
  { id: "end", label: "Completed", dateField: "end" },
] as const;

type PresetGroup = "popularity" | "fan-rank" | "chapters";

const optionsByGroup: Record<PresetGroup, FeedPresetOption[]> = {
  popularity: POPULARITY_PRESETS,
  "fan-rank": FAN_RANK_PRESETS,
  chapters: CHAPTER_PRESETS,
};

const presetId = (group: PresetGroup, id: string) => `preset:${group}:${id}`;
const releaseYearPresetId = (year: number) => `preset:release-year:${year}`;

export function isFeedPresetRange(range: MetricRange) {
  return range.id.startsWith("preset:");
}

export function selectedFeedPresetIds(filters: FeedFilters, group: PresetGroup) {
  const ids = new Set((filters.metricRanges ?? []).map((range) => range.id));
  return optionsByGroup[group].filter((option) => ids.has(presetId(group, option.id))).map((option) => option.id);
}

export function releaseYearPresets(currentYear = new Date().getFullYear()) {
  return Array.from({ length: Math.max(0, currentYear - 2013) }, (_, index) => currentYear - index);
}

export function selectedReleaseYearPresets(filters: FeedFilters) {
  return (filters.metricRanges ?? [])
    .filter((range) => range.id.startsWith("preset:release-year:") && range.metric === "year" && range.min === range.max)
    .map((range) => range.min)
    .filter((year): year is number => year != null);
}

export function toggleReleaseYearPreset(filters: FeedFilters, year: number) {
  const selected = new Set(selectedReleaseYearPresets(filters));
  if (selected.has(year)) selected.delete(year);
  else selected.add(year);
  const metricRanges = [
    ...(filters.metricRanges ?? []).filter((range) => range.metric !== "year"),
    ...[...selected]
      .sort((left, right) => right - left)
      .map((value) => ({ id: releaseYearPresetId(value), metric: "year" as const, min: value, max: value })),
  ];
  return { ...filters, minYear: null, maxYear: null, metricRanges };
}

function replaceMetricRanges(filters: FeedFilters, metric: MetricId, ranges: MetricRange[]) {
  return {
    ...filters,
    metricRanges: [...(filters.metricRanges ?? []).filter((range) => range.metric !== metric), ...ranges],
  };
}

function toRange(group: PresetGroup, option: FeedPresetOption): MetricRange {
  return { id: presetId(group, option.id), metric: option.metric, min: option.min, max: option.max };
}

export function togglePopularityPreset(filters: FeedFilters, id: string) {
  const selected = new Set(selectedFeedPresetIds(filters, "popularity"));
  if (id === "top-half" || id === "bottom-half") {
    selected.clear();
    if (!selectedFeedPresetIds(filters, "popularity").includes(id)) selected.add(id);
  } else {
    selected.delete("top-half");
    selected.delete("bottom-half");
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }
  const ranges = POPULARITY_PRESETS.filter((option) => selected.has(option.id)).map((option) => toRange("popularity", option));
  return replaceMetricRanges(filters, "popularityPercentile", ranges);
}

export function selectSingleFeedPreset(filters: FeedFilters, group: "fan-rank" | "chapters", id: string) {
  const options = optionsByGroup[group];
  const alreadySelected = selectedFeedPresetIds(filters, group).includes(id);
  const option = options.find((item) => item.id === id);
  const ranges = !alreadySelected && option ? [toRange(group, option)] : [];
  const next = replaceMetricRanges(filters, options[0].metric, ranges);
  if (group !== "chapters") return next;
  return { ...next, minChapters: null, maxChapters: null };
}

export function selectedStatusPresetId(filters: FeedFilters) {
  if (filters.statuses.length === 0) return "all";
  if (filters.statuses.length !== 1) return null;
  return STATUS_PRESETS.find((option) => option.value === filters.statuses[0])?.id ?? null;
}

export function selectStatusPreset(filters: FeedFilters, id: string) {
  const option = STATUS_PRESETS.find((item) => item.id === id);
  if (!option) return filters;
  return { ...filters, statuses: option.value == null ? [] : [option.value] };
}

export function selectedSortPresetId(sort: SortRule[]) {
  if (sort.length !== 1) return null;
  return SORT_PRESETS.find((option) => option.metric === sort[0].metric)?.id ?? null;
}

export function selectSortPreset(sort: SortRule[], id: string): SortRule[] {
  const option = SORT_PRESETS.find((item) => item.id === id);
  if (!option) return sort;
  return [{
    id: sort[0]?.id ?? `sort:preset:${id}`,
    metric: option.metric,
    direction: sort[0]?.direction ?? "desc",
  }];
}

export function selectedPeriodPresetId(filters: FeedFilters) {
  if (filters.rolling.mode !== "last") return null;
  return PERIOD_PRESETS.find((option) => option.amount === filters.rolling.amount && option.unit === filters.rolling.unit)?.id ?? null;
}

export function selectPeriodPreset(filters: FeedFilters, id: string) {
  if (filters.dateField === "none" && id !== WEEKLY_GROWTH_PERIOD.id) return filters;
  const selected = selectedPeriodPresetId(filters);
  if (selected === id) {
    return filters.dateField === "none"
      ? filters
      : { ...filters, rolling: { ...filters.rolling, mode: "none" as const } };
  }
  const option = PERIOD_PRESETS.find((item) => item.id === id);
  if (!option) return filters;
  return { ...filters, rolling: { ...filters.rolling, mode: "last" as const, amount: option.amount, unit: option.unit } };
}

export function selectPeriodPurpose(filters: FeedFilters, id: string): FeedFilters {
  const option = PERIOD_PURPOSES.find((item) => item.id === id);
  if (!option) return filters;
  if (option.id !== "growth") return { ...filters, dateField: option.dateField };
  return {
    ...filters,
    dateField: "none",
    rolling: { ...filters.rolling, mode: "last", amount: 1, unit: "weeks" },
  };
}

export function normalizeWeeklyGrowthFeed(feed: Feed): Feed {
  const usesGrowth = [
    ...feed.sort.map((rule) => rule.metric),
    ...(feed.filters.metricRanges ?? []).map((range) => range.metric),
    ...(feed.view.metricSlots ?? []),
  ].some(isGrowthMetric);
  if (!usesGrowth || feed.filters.dateField !== "none") return feed;
  const rolling = feed.filters.rolling;
  if (rolling.mode === "last" && rolling.amount === 1 && rolling.unit === "weeks") return feed;
  return {
    ...feed,
    filters: {
      ...feed.filters,
      rolling: { ...rolling, mode: "last", amount: 1, unit: "weeks" },
    },
  };
}
