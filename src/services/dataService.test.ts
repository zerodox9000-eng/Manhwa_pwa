import { describe, expect, it } from "vitest";
import { applyTagWeightExport, CATALOG_NORMALIZATION_VERSION, detailSourceCandidates, needsCatalogNormalizationRepair } from "./dataService";
import { parseCatalogList } from "../domain/validation";

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

describe("tag weight export", () => {
  it("keeps cached unweighted rows when the sync marker is null", () => {
    const parsed = parseCatalogList([{
      id: 588985,
      display_title: "Teto X Egen",
      tag_weights: null,
      tag_ids: [],
    }]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].display_title).toBe("Teto X Egen");
    expect(parsed[0].tag_weights).toBeNull();
  });

  it("adds valid exported weights without removing existing catalog weights", () => {
    const catalog = [{
      id: 7,
      display_title: "Weighted title",
      cover: null,
      year: 2024,
      status: "releasing",
      content_rating: "safe",
      total_chapters: "10",
      tag_ids: [1, 2],
      tag_weights: { 1: "core" },
      stats: { popularity: null, favourites: null, meanScore: null },
      analytics: {},
      source: { anilist: { id: 7 } },
    }];

    const enriched = applyTagWeightExport(catalog, [
      { id: 7, tag_weights: { "2": "defining", "bad": { value: "ignored" } } },
      { id: "bad", tag_weights: { "3": "incidental" } },
    ]);

    expect(enriched[0].tag_weights).toEqual({ 1: "core", 2: "defining" });
  });

  it("does not attach the AniList weight export to non-AniList records", () => {
    const catalog = [{
      id: 8,
      display_title: "Non-AniList title",
      cover: null,
      year: 2024,
      status: "releasing",
      content_rating: "safe",
      total_chapters: "10",
      tag_ids: [1],
      stats: { popularity: null, favourites: null, meanScore: null },
      analytics: {},
      source: { mangaupdates: { id: "8", url: null } },
    }];

    const enriched = applyTagWeightExport(catalog, [{ id: 8, tag_weights: { "1": "incidental" } }]);

    expect(enriched[0].tag_weights).toBeUndefined();
  });
});
