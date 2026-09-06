import { describe, expect, it } from "vitest";
import { applyTagWeightExport, CATALOG_NORMALIZATION_VERSION, detailSourceCandidates, mergeLiveCatalog, needsCatalogNormalizationRepair } from "./dataService";
import { normalizeCatalog } from "../domain/catalog";
import { parseCatalogList } from "../domain/validation";
import type { SeriesCatalog } from "../domain/types";

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

  it("looks up weights through merged IDs while letting the current ID win", () => {
    const catalog = [{
      id: 7,
      merged_ids: [7, 70],
      display_title: "Weighted title",
      cover: null,
      year: null,
      status: "releasing",
      content_rating: "safe",
      total_chapters: null,
      tag_ids: [1, 2, 3],
      stats: { popularity: null, favourites: null, meanScore: null },
      analytics: {},
      source: { anilist: { id: 7 } },
      tag_weights: { 1: "core" },
    }];

    const enriched = applyTagWeightExport(catalog, [
      { id: 70, tag_weights: { "2": "incidental", "4": "defining" } },
      { id: 7, tag_weights: { "2": "core", "3": "recurrent" } },
    ]);

    expect(enriched[0].tag_weights).toEqual({
      1: "core",
      2: "core",
      3: "recurrent",
      4: "defining",
    });
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

describe("live catalogue continuity", () => {
  const record = (overrides: Partial<SeriesCatalog>): SeriesCatalog => ({
    id: 1,
    display_title: "Series",
    cover: "https://example.com/cover.jpg",
    year: null,
    status: "releasing",
    content_rating: "safe",
    total_chapters: null,
    tag_ids: [1],
    stats: { popularity: null, favourites: null, meanScore: null },
    analytics: {},
    ...overrides,
  });

  it("does not reintroduce a stale cover merge when the current export has separate source IDs", () => {
    const previous = [record({
      id: 514258,
      display_title: "Pungsajeongi 1-bu",
      merged_ids: [514258, 514259],
      source: { anilist: { id: 198979 } },
      links: { mangabaka: "https://mangabaka.org/514258" },
    })];
    const live = [
      record({ id: 514258, display_title: "Pungsajeongi 1-bu", source: { anilist: { id: 198979 } } }),
      record({ id: 514259, display_title: "Pungsajeongi 2-bu", source: { anilist: { id: 198980 } } }),
    ];

    const normalized = normalizeCatalog(mergeLiveCatalog(live, previous), {});

    expect(normalized.catalog).toHaveLength(2);
    expect(normalized.catalog.map((item) => item.display_title)).toEqual([
      "Pungsajeongi 1-bu",
      "Pungsajeongi 2-bu",
    ]);
  });

  it("carries links, sources, and the old ID when a current record changes ID", () => {
    const previous = [record({
      id: 90,
      display_title: "Old title",
      source: {
        anilist: { id: 900, url: "https://anilist.co/manga/900" },
        mangaupdates: { id: "old-slug", url: "https://www.mangaupdates.com/series/old-slug" },
      },
      links: {
        mangabaka: "https://mangabaka.org/90",
        read_en: "https://reader.example/old-title",
      },
    })];
    const live = [record({
      id: 91,
      display_title: "Current title",
      source: { anilist: { id: 900, url: null } },
      links: { mangabaka: "https://mangabaka.org/91", read_en: null },
    })];

    const [merged] = mergeLiveCatalog(live, previous);

    expect(merged.merged_ids).toEqual(expect.arrayContaining([90, 91]));
    expect(merged.links?.mangabaka).toBe("https://mangabaka.org/91");
    expect(merged.links?.read_en).toBe("https://reader.example/old-title");
    expect(merged.source?.anilist?.url).toBe("https://anilist.co/manga/900");
    expect(merged.source?.mangaupdates?.id).toBe("old-slug");
  });
});
