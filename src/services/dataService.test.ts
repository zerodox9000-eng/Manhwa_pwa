import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/appDb", () => ({
  db: {
    details: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) },
    catalog: { get: vi.fn(async () => undefined), toArray: vi.fn(async () => []), bulkPut: vi.fn(async () => undefined) },
    tags: { toArray: vi.fn(async () => []) },
    history: { toArray: vi.fn(async () => []) },
    meta: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) },
  },
  loadSyncMeta: vi.fn(async () => null),
  saveSyncMeta: vi.fn(),
}));

import { applyChapterIncreaseDates, applyTagWeightExport, CATALOG_NORMALIZATION_VERSION, detailSourceCandidates, fetchSeriesDetail, loadCachedData, loadCachedUpdatesSnapshot, mergeLiveCatalog, needsCatalogNormalizationRepair } from "./dataService";
import { db, loadSyncMeta } from "../db/appDb";
import { normalizeCatalog } from "../domain/catalog";
import { parseCatalogList } from "../domain/validation";
import type { SeriesCatalog, SyncMeta } from "../domain/types";
import type { UpdatesExport } from "../domain/trends";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

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

describe("bounded detail requests", () => {
  it("aborts a stalled first source and quickly tries the next configured source", async () => {
    vi.useFakeTimers();
    const detail = {
      id: 1,
      display_title: "Fast fallback",
      description: "Loaded from the fallback source",
    };
    const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://slow.example/")) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          }, { once: true });
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => detail,
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchSeriesDetail("https://slow.example/frontend", 1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_800);
    await expect(pending).resolves.toMatchObject(detail);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });
});

describe("versioned Updates snapshots", () => {
  const payload = (generatedAt: string): UpdatesExport => ({
    schemaVersion: 1 as const,
    generatedAt,
    latestDate: new Date().toISOString().slice(0, 10),
    windowDays: 365,
    statusWindowDays: 90,
    chapterWindowDays: 7,
    eligibleTitleCount: 1,
    popularity: [],
    statuses: [],
    chapters: [],
  });

  it("loads only a fresh Updates snapshot saved for the current manifest", async () => {
    const current = payload(new Date().toISOString());
    vi.mocked(db.meta.get).mockResolvedValueOnce({
      key: "updates-snapshot",
      value: { versionHash: "chunked-current", payload: current },
    });

    await expect(loadCachedUpdatesSnapshot("chunked-current")).resolves.toEqual(current);
  });

  it("rejects an old cached Updates snapshot instead of showing it as current", async () => {
    const stale = payload(new Date(Date.now() - 72 * 60 * 60 * 1_000).toISOString());
    vi.mocked(db.meta.get).mockResolvedValueOnce({
      key: "updates-snapshot",
      value: { versionHash: "chunked-current", payload: stale },
    });

    await expect(loadCachedUpdatesSnapshot("chunked-current")).resolves.toBeNull();
  });

  it("uses fresh Updates chapter dates in the cached catalogue and saves them for later sorts", async () => {
    const catalog: SeriesCatalog[] = [{
      id: 3036,
      display_title: "Manager Kim",
      cover: null,
      year: 2016,
      status: "releasing",
      content_rating: "safe",
      total_chapters: "260",
      tag_ids: [],
      stats: { popularity: 10_152, favourites: null, meanScore: null },
      analytics: {},
    }];
    const updates = payload(new Date().toISOString());
    updates.chapters.push({ id: 3036, date: "2026-09-22", from: 259, to: 260 });
    vi.mocked(db.catalog.toArray).mockResolvedValueOnce(catalog);
    vi.mocked(loadSyncMeta).mockResolvedValueOnce({
      lastSync: new Date().toISOString(),
      totalSeries: 1,
      historyFirstDate: null,
      historyLastDate: null,
      versionHash: "chunked-current",
      source: "test",
    } satisfies SyncMeta);
    vi.mocked(db.meta.get).mockResolvedValueOnce({
      key: "updates-snapshot",
      value: { versionHash: "chunked-current", payload: updates },
    });

    const result = await loadCachedData();

    expect(result.catalog[0].last_chapter_increase_date).toBe("2026-09-22");
    expect(db.catalog.bulkPut).toHaveBeenCalledWith([
      expect.objectContaining({ id: 3036, last_chapter_increase_date: "2026-09-22" }),
    ]);
  });
});

describe("chapter increase sort dates", () => {
  const record = (overrides: Partial<SeriesCatalog>): SeriesCatalog => ({
    id: 101,
    display_title: "Series",
    cover: null,
    year: null,
    status: "releasing",
    content_rating: "safe",
    total_chapters: null,
    tag_ids: [],
    stats: { popularity: null, favourites: null, meanScore: null },
    analytics: {},
    ...overrides,
  });

  it("attaches the latest Updates event through merged IDs and retains a newer cached date", () => {
    const current = [
      record({ id: 101, merged_ids: [101, 100] }),
      record({ id: 202, last_chapter_increase_date: "2026-09-27" }),
    ];
    const previous = [record({ id: 202, last_chapter_increase_date: "2026-09-27" })];
    const updates = {
      schemaVersion: 1 as const,
      generatedAt: new Date().toISOString(),
      latestDate: "2026-09-27",
      windowDays: 365,
      statusWindowDays: 90,
      chapterWindowDays: 7,
      eligibleTitleCount: 2,
      popularity: [],
      statuses: [],
      chapters: [
        { id: 100, date: "2026-09-26", from: 20, to: 21 },
        { id: 202, date: "2026-09-22", from: 259, to: 260 },
      ],
    };

    const enriched = applyChapterIncreaseDates(current, updates, previous);

    expect(enriched.map((item) => item.last_chapter_increase_date)).toEqual([
      "2026-09-26",
      "2026-09-27",
    ]);
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

  it("uses descriptions from current exports and keeps them when older exports omit the field", () => {
    const previous = [record({ id: 92, description: "Previously cached description" })];
    const current = mergeLiveCatalog(
      [record({ id: 92, description: "Current exported description" })],
      previous,
    );
    const olderExport = mergeLiveCatalog(
      [record({ id: 92, description: undefined })],
      previous,
    );

    expect(current[0].description).toBe("Current exported description");
    expect(olderExport[0].description).toBe("Previously cached description");
  });

  it("keeps a missing description undefined when neither the old nor current catalogue has one", () => {
    const [merged] = mergeLiveCatalog(
      [record({ id: 93, description: undefined })],
      [record({ id: 93, description: undefined })],
    );
    const [oldNullMarker] = mergeLiveCatalog(
      [record({ id: 94, description: undefined })],
      [record({ id: 94, description: null })],
    );

    expect(merged.description).toBeUndefined();
    expect(oldNullMarker.description).toBeUndefined();
  });
});
