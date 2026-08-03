import { describe, expect, it } from "vitest";
import { createCustomFeed, createFeed } from "./defaults";
import {
  CHAPTER_PRESETS,
  FAN_RANK_PRESETS,
  PERIOD_PRESETS,
  POPULARITY_PRESETS,
  releaseYearPresets,
  selectPeriodPreset,
  selectPeriodPurpose,
  selectSingleFeedPreset,
  selectSortPreset,
  selectStatusPreset,
  selectedFeedPresetIds,
  selectedPeriodPresetId,
  selectedReleaseYearPresets,
  selectedSortPresetId,
  selectedStatusPresetId,
  togglePopularityPreset,
  toggleReleaseYearPreset,
} from "./feedPresets";

describe("feed presets", () => {
  it("keeps exact popularity bands as independent ranges", () => {
    const feed = createFeed();
    feed.filters = togglePopularityPreset(feed.filters, "deep-cut");
    feed.filters = togglePopularityPreset(feed.filters, "underground");

    expect(selectedFeedPresetIds(feed.filters, "popularity")).toEqual(["underground", "deep-cut"]);
    expect(feed.filters.metricRanges).toMatchObject([
      { metric: "popularityPercentile", min: 70, max: 79 },
      { metric: "popularityPercentile", min: null, max: 69 },
    ]);
  });

  it("makes Top Half exclusive from narrower popularity bands", () => {
    const feed = createFeed();
    feed.filters = togglePopularityPreset(feed.filters, "deep-cut");
    feed.filters = togglePopularityPreset(feed.filters, "top-half");

    expect(selectedFeedPresetIds(feed.filters, "popularity")).toEqual(["top-half"]);
    expect(feed.filters.metricRanges).toMatchObject([{ min: 50, max: null }]);
  });

  it("makes Bottom Half exclusive and caps popularity percentile at 49", () => {
    const feed = createFeed();
    feed.filters = togglePopularityPreset(feed.filters, "mainstream");
    feed.filters = togglePopularityPreset(feed.filters, "bottom-half");

    expect(selectedFeedPresetIds(feed.filters, "popularity")).toEqual(["bottom-half"]);
    expect(feed.filters.metricRanges).toMatchObject([{ min: null, max: 49 }]);
  });

  it("uses one Fan Rank or chapter preset at a time and toggles it off", () => {
    const feed = createFeed();
    feed.filters = selectSingleFeedPreset(feed.filters, "fan-rank", "60-plus");
    feed.filters = selectSingleFeedPreset(feed.filters, "fan-rank", "90-plus");
    expect(selectedFeedPresetIds(feed.filters, "fan-rank")).toEqual(["90-plus"]);

    feed.filters.minChapters = 25;
    feed.filters = selectSingleFeedPreset(feed.filters, "chapters", "50-plus");
    expect(feed.filters.minChapters).toBeNull();
    expect(selectedFeedPresetIds(feed.filters, "chapters")).toEqual(["50-plus"]);
    feed.filters = selectSingleFeedPreset(feed.filters, "chapters", "50-plus");
    expect(selectedFeedPresetIds(feed.filters, "chapters")).toEqual([]);
  });

  it("presents popularity, Fan Rank, and chapter presets from high to low", () => {
    expect(POPULARITY_PRESETS.map((option) => option.label)).toEqual([
      "Top 1%",
      "Mainstream",
      "Upcoming",
      "Underground",
      "Deep Cut",
      "Top Half",
      "Bottom Half",
    ]);
    expect(FAN_RANK_PRESETS.at(0)?.label).toBe("90%+");
    expect(FAN_RANK_PRESETS.at(-1)?.label).toBe("Below 50%");
    expect(CHAPTER_PRESETS.at(0)?.label).toBe("200+");
    expect(CHAPTER_PRESETS.at(-1)?.label).toBe("Below 10");
  });

  it("selects simple status and sorting presets", () => {
    const feed = createFeed();
    feed.filters = selectStatusPreset(feed.filters, "hiatus");
    expect(selectedStatusPresetId(feed.filters)).toBe("hiatus");
    expect(feed.filters.statuses).toEqual(["hiatus"]);
    feed.filters = selectStatusPreset(feed.filters, "all");
    expect(selectedStatusPresetId(feed.filters)).toBe("all");

    feed.sort = selectSortPreset(feed.sort, "popularity-growth");
    expect(selectedSortPresetId(feed.sort)).toBe("popularity-growth");
    expect(feed.sort).toMatchObject([{ metric: "popularityGrowthPercent", direction: "desc" }]);

    feed.sort = [{ ...feed.sort[0], direction: "asc" }];
    feed.sort = selectSortPreset(feed.sort, "popularity");
    expect(selectedSortPresetId(feed.sort)).toBe("popularity");
    expect(feed.sort).toMatchObject([{ metric: "popularity", direction: "asc" }]);
  });

  it("starts new logic and custom feeds with Fan Rank sorting", () => {
    expect(selectedSortPresetId(createFeed().sort)).toBe("fan-rank");
    const custom = createCustomFeed();
    expect(custom.orderMode).toBe("automatic");
    expect(selectedSortPresetId(custom.sort)).toBe("fan-rank");
  });

  it("selects rolling periods and their purpose without replacing advanced dates", () => {
    const feed = createFeed();
    feed.filters = selectPeriodPurpose(feed.filters, "release");
    feed.filters = selectPeriodPreset(feed.filters, "three-months");
    expect(selectedPeriodPresetId(feed.filters)).toBe("three-months");
    expect(feed.filters.rolling).toMatchObject({ mode: "last", amount: 3, unit: "months" });
    expect(feed.filters.dateField).toBe("release");
    expect(PERIOD_PRESETS.map((option) => option.label)).toEqual(["1 Week", "1 Month", "3 Months", "1 Year"]);
  });

  it("keeps growth fixed to one week while leaving release periods flexible", () => {
    const feed = createFeed();
    feed.filters = selectPeriodPurpose(feed.filters, "growth");
    feed.filters = selectPeriodPreset(feed.filters, "year");
    expect(selectedPeriodPresetId(feed.filters)).toBe("week");

    feed.filters = selectPeriodPurpose(feed.filters, "release");
    feed.filters = selectPeriodPreset(feed.filters, "year");
    expect(selectedPeriodPresetId(feed.filters)).toBe("year");

    feed.filters = selectPeriodPurpose(feed.filters, "growth");
    expect(selectedPeriodPresetId(feed.filters)).toBe("week");
    expect(feed.filters.dateField).toBe("none");
  });

  it("selects multiple exact release years without retaining a manual year range", () => {
    const feed = createFeed();
    feed.filters.minYear = 2020;
    feed.filters.maxYear = 2024;
    feed.filters = toggleReleaseYearPreset(feed.filters, 2026);
    feed.filters = toggleReleaseYearPreset(feed.filters, 2024);

    expect(releaseYearPresets(2026)).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]);
    expect(selectedReleaseYearPresets(feed.filters)).toEqual([2026, 2024]);
    expect(feed.filters).toMatchObject({ minYear: null, maxYear: null });
    expect(feed.filters.metricRanges).toMatchObject([
      { metric: "year", min: 2026, max: 2026 },
      { metric: "year", min: 2024, max: 2024 },
    ]);
  });
});
