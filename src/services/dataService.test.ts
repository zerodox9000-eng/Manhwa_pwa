import { describe, expect, it } from "vitest";
import { CATALOG_NORMALIZATION_VERSION, deriveAnimePlanetTitle, detailSourceCandidates, needsCatalogNormalizationRepair } from "./dataService";

describe("detailSourceCandidates", () => {
  it("keeps the preferred detail source first and falls back to configured sources", () => {
    const sources = detailSourceCandidates("https://preferred.example/frontend");

    expect(sources[0]).toBe("https://preferred.example/frontend");
    expect(sources).toContain("https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend");
  });

  it("does not retry the same detail source twice", () => {
    const sources = detailSourceCandidates("https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend");

    expect(sources.filter((source) => source.includes("raw.githubusercontent.com"))).toHaveLength(1);
  });
});

describe("catalog normalization repair", () => {
  it("repairs only caches from before the current normalization rule", () => {
    expect(needsCatalogNormalizationRepair(null)).toBe(true);
    expect(needsCatalogNormalizationRepair({ catalogNormalizationVersion: CATALOG_NORMALIZATION_VERSION - 1 })).toBe(true);
    expect(needsCatalogNormalizationRepair({ catalogNormalizationVersion: CATALOG_NORMALIZATION_VERSION })).toBe(false);
  });
});

describe("deriveAnimePlanetTitle", () => {
  it("keeps a backend-provided Anime-Planet title", () => {
    expect(deriveAnimePlanetTitle({
      id: 1,
      display_title: "Backend title",
      animeplanet_title: "Provided title",
      cover: null,
      year: null,
      status: null,
      content_rating: null,
      total_chapters: null,
      tag_ids: [],
      stats: { popularity: null, favourites: null, meanScore: null },
      analytics: {},
    })).toBe("Provided title");
  });

  it("derives the search alias from the fresh Anime-Planet source link", () => {
    expect(deriveAnimePlanetTitle({
      id: 1,
      display_title: "Backend title",
      cover: null,
      year: null,
      status: null,
      content_rating: null,
      total_chapters: null,
      tag_ids: [],
      stats: { popularity: null, favourites: null, meanScore: null },
      analytics: {},
      source: { animeplanet: { id: "the-flower-that-bloomed-by-a-cloud" } },
    })).toBe("The Flower That Bloomed by a Cloud");
  });
});
