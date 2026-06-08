import { describe, expect, it } from "vitest";
import { normalizeCatalog } from "./catalog";
import { formatMetricValue, metricValue } from "./metrics";
import type { HistoryMap, SeriesCatalog } from "./types";

const base: SeriesCatalog = {
  id: 1,
  display_title: "Blind Devotion",
  cover: "https://example.com/cover.jpg?size=large",
  year: null,
  status: "releasing",
  content_rating: "safe",
  total_chapters: null,
  tag_ids: [1],
  stats: { popularity: 89, favourites: 9, meanScore: 71 },
  analytics: {
    fanFavouriteRaw: 10.1,
    fanFavouriteDiscoveryScore: 40,
    fanFavouriteDiscoveryPercentile: 55,
  },
  published: { start_date: "2020-01-01", start_date_is_estimated: true },
};

const history: HistoryMap = {
  "99": [
    { d: "2026-05-15", p: 50, f: 5, s: 70, r: 10, rp: 40, pp: 20, ds: 25, dp: 40 },
  ],
  "1": [
    { d: "2026-05-20", p: 70, f: 7, s: 70, r: 10, rp: 40, pp: 20, ds: 30, dp: 45 },
  ],
  "2": [
    { d: "2026-05-21", p: 75, f: 8, s: 71, r: 10.6, rp: 42, pp: 22, ds: 35, dp: 50 },
  ],
};

describe("catalog normalization", () => {
  it("deduplicates same-cover placeholder records and keeps the real title", () => {
    const duplicate: SeriesCatalog = {
      ...base,
      id: 2,
      display_title: "Unknown Title",
      cover: "https://example.com/cover.jpg",
    };
    const normalized = normalizeCatalog([base, duplicate], history);
    expect(normalized.catalog).toHaveLength(1);
    expect(normalized.catalog[0].display_title).toBe("Blind Devotion");
    expect(normalized.catalog[0].merged_ids).toEqual(expect.arrayContaining([1, 2]));
    expect(normalized.history[String(normalized.catalog[0].id)]).toHaveLength(2);
  });

  it("uses first database history date for estimated releases", () => {
    const normalized = normalizeCatalog([base], history);
    expect(normalized.catalog[0].published?.start_date).toBe("2026-05-20");
    expect(normalized.catalog[0].year).toBe(2026);
  });

  it("does not turn the global history start into every old title release date", () => {
    const oldHistory: HistoryMap = {
      "1": [
        { d: "2026-05-15", p: 70, f: 7, s: 70, r: 10, rp: 40, pp: 20, ds: 30, dp: 45 },
      ],
    };
    const normalized = normalizeCatalog([base], oldHistory);
    expect(normalized.catalog[0].published?.start_date).toBeNull();
  });

  it("drops estimated release dates when no first-seen date exists", () => {
    const normalized = normalizeCatalog([{ ...base, id: 5 }], {});
    expect(normalized.catalog[0].published?.start_date).toBeNull();
    expect(normalized.catalog[0].year).toBeNull();
  });

  it("preserves actual backend release dates", () => {
    const actual = {
      ...base,
      id: 6,
      published: { start_date: "2021-08-05", end_date: null, start_date_is_estimated: false },
    };
    const normalized = normalizeCatalog([actual], {});
    expect(normalized.catalog[0].published?.start_date).toBe("2021-08-05");
    expect(normalized.catalog[0].year).toBe(2021);
  });

  it("derives a usable title from source slugs when the backend title is a placeholder", () => {
    const normalized = normalizeCatalog([
      {
        ...base,
        id: 7,
        display_title: "Unknown Title",
        source: {
          anilist: null,
          mangaupdates: null,
          animeplanet: { id: "the-demonic-warrior", rating: null, url: "https://www.anime-planet.com/manga/the-demonic-warrior" },
        },
      },
    ], {});
    expect(normalized.catalog[0].display_title).toBe("The Demonic Warrior");
  });

  it("formats years without thousands separators and derives current growth", () => {
    const current = { ...base, year: 2026 };
    expect(formatMetricValue(current, "year")).toBe("2026");
    expect(metricValue(current, "popularityGrowth", history, "2026-05-21")).toBe(19);
    expect(formatMetricValue(current, "discoveryPercentileDelta", history, "2026-05-21")).toBe("10%");
  });
});
