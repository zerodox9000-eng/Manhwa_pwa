import { describe, expect, it } from "vitest";
import defaultFeeds from "./defaultFeeds.generated.json";
import { POPULARITY_BANDS, popularityBandForDisplayedPercentile } from "./popularityBands";
import { buildTrendEvents, formatTrendDuration } from "./trends";
import type { SeriesCatalog } from "./types";

function series(id: number): SeriesCatalog {
  return {
    id,
    display_title: `Title ${id}`,
    cover: null,
    year: 2025,
    status: "Releasing",
    content_rating: "safe",
    total_chapters: null,
    tag_ids: [],
    stats: { popularity: id, favourites: 1, meanScore: null },
    analytics: {},
  };
}

describe("popularity trend bands", () => {
  it("matches the shipped Discover feed ranges", () => {
    const discoverFeeds = defaultFeeds.filter((feed) => feed.name.trim().startsWith("DISCOVER "));
    for (const band of POPULARITY_BANDS) {
      const expectedName = band.id === "top1" ? "DISCOVER TOP 1%" : `DISCOVER ${band.label.toUpperCase()}`;
      const feed = discoverFeeds.find((item) => item.name.trim() === expectedName);
      const range = feed?.filters.metricRanges.find((item) => item.metric === "popularityPercentile");
      expect(range?.min).toBe(band.min);
      expect(range?.max ?? null).toBe(band.max);
    }
  });

  it("uses the displayed rounded percentile", () => {
    expect(popularityBandForDisplayedPercentile(69.51)).toBe("underground");
    expect(popularityBandForDisplayedPercentile(89.5)).toBe("mainstream");
    expect(popularityBandForDisplayedPercentile(98.5)).toBe("top1");
  });

  it("does not report the first snapshot as a movement", () => {
    const catalog = Array.from({ length: 10 }, (_, index) => series(index + 1));
    const baselineRows = catalog.map((item) => ({
      id: String(item.id),
      entries: [{ d: "2026-01-01", p: item.id, f: 1, s: null, r: 0, rp: 0, pp: item.id * 10, ds: 0, dp: 0 }],
    }));
    expect(buildTrendEvents(catalog, baselineRows).events).toHaveLength(0);

    const changedRows = baselineRows.map((row) => ({
      ...row,
      entries: [
        ...row.entries,
        { ...row.entries[0], d: "2026-02-01", pp: Number(row.id) === 7 ? 99 : Number(row.id) * 10 },
      ],
    }));
    const changed = buildTrendEvents(catalog, changedRows);
    expect(changed.events.filter((event) => event.id === 7).map((event) => event.to)).toEqual([
      "upcoming",
      "mainstream",
      "top1",
    ]);
  });

  it("keeps each rising milestone as a separate event for the same title", () => {
    const catalog = Array.from({ length: 10 }, (_, index) => series(index + 1));
    const rows = catalog.map((item) => ({
      id: String(item.id),
      entries: [
        { d: "2026-01-01", p: item.id, f: 1, s: null, r: 0, rp: 0, pp: item.id * 10, ds: 0, dp: 0 },
        { d: "2026-02-01", p: item.id, f: 1, s: null, r: 0, rp: 0, pp: item.id === 7 ? 80 : item.id * 10, ds: 0, dp: 0 },
        { d: "2026-03-01", p: item.id, f: 1, s: null, r: 0, rp: 0, pp: item.id === 7 ? 90 : item.id * 10, ds: 0, dp: 0 },
        { d: "2026-04-01", p: item.id, f: 1, s: null, r: 0, rp: 0, pp: item.id === 7 ? 70 : item.id * 10, ds: 0, dp: 0 },
        { d: "2026-05-01", p: item.id, f: 1, s: null, r: 0, rp: 0, pp: item.id === 7 ? 90 : item.id * 10, ds: 0, dp: 0 },
      ],
    }));

    expect(buildTrendEvents(catalog, rows).events.filter((event) => event.id === 7).map((event) => event.to)).toEqual([
      "mainstream",
      "upcoming",
    ]);
  });
});

describe("trend duration formatting", () => {
  it.each([
    ["2025-01-01", "2025-01-19", "18 days"],
    ["2025-01-01", "2025-05-13", "4 months 12 days"],
    ["2025-01-01", "2026-01-16", "1 year 15 days"],
    ["2025-01-01", "2026-05-01", "1 year 4 months"],
    ["2025-01-01", "2026-01-01", "1 year"],
  ])("formats %s to %s", (from, to, expected) => {
    expect(formatTrendDuration(from, to)).toBe(expected);
  });
});
