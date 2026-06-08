import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, createFeed } from "./defaults";
import { runFeedQuery } from "./query";
import type { HistoryMap, SeriesCatalog, TagNode } from "./types";

const tags: TagNode[] = [
  { id: 1, name: "Action", path: "Genres > Action", is_genre: true, parent_id: null, level: 1 },
  { id: 2, name: "Hentai", path: "Sexual Content > Intensity > Hentai", is_genre: true, parent_id: null, level: 2 },
  { id: 3, name: "Fantasy", path: "Themes > Fantasy", is_genre: true, parent_id: null, level: 2 },
  { id: 4, name: "Isekai", path: "Themes > Fantasy > Isekai", is_genre: false, parent_id: 3, level: 3 },
  { id: 5, name: "Non-BL with Two Male Leads", path: "Themes > Relationship > Non-BL with Two Male Leads", is_genre: false, parent_id: null, level: 3 },
];

const baseSeries: SeriesCatalog[] = [
  {
    id: 1,
    display_title: "A Clean Action",
    cover: null,
    year: 2024,
    status: "releasing",
    content_rating: "safe",
    total_chapters: "20",
    tag_ids: [1],
    stats: { popularity: 100, favourites: 10, meanScore: 80 },
    analytics: { fanFavouriteRaw: 10, fanFavouriteDiscoveryScore: 90 },
    published: { start_date: "2024-05-01", end_date: null },
  },
  {
    id: 2,
    display_title: "Sensitive Fantasy",
    cover: null,
    year: 2024,
    status: "completed",
    content_rating: "safe",
    total_chapters: "40",
    tag_ids: [2, 3],
    stats: { popularity: 200, favourites: 20, meanScore: 70 },
    analytics: { fanFavouriteRaw: 10, fanFavouriteDiscoveryScore: 80 },
    published: { start_date: "2024-05-03", end_date: "2024-05-10" },
  },
  {
    id: 3,
    display_title: "No AniList",
    cover: null,
    year: 2024,
    status: "completed",
    content_rating: "safe",
    total_chapters: "8",
    tag_ids: [1],
    stats: { popularity: null, favourites: null, meanScore: null },
    analytics: {},
    published: { start_date: "2024-05-04", end_date: "2024-05-11" },
  },
];

const history: HistoryMap = {
  "1": [
    { d: "2024-05-01", p: 10, f: 1, s: 80, r: 10, rp: 1, pp: 1, ds: 20, dp: 1 },
    { d: "2024-05-10", p: 100, f: 10, s: 80, r: 10, rp: 1, pp: 1, ds: 90, dp: 1 },
  ],
  "2": [
    { d: "2024-05-01", p: 190, f: 19, s: 70, r: 10, rp: 1, pp: 1, ds: 70, dp: 1 },
    { d: "2024-05-10", p: 200, f: 20, s: 70, r: 10, rp: 1, pp: 1, ds: 80, dp: 1 },
  ],
};

describe("runFeedQuery", () => {
  it("hides sensitive tags unless adult content is unlocked", () => {
    const feed = createFeed("safe");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    const result = runFeedQuery({
      feed,
      series: baseSeries,
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([1, 3]);
  });

  it("does not hide non-BL relationship tags as sensitive Boys Love", () => {
    const feed = createFeed("non bl");
    feed.filters.sourceMode = "anilist";
    feed.filters.sourceModes = ["anilist"];
    const result = runFeedQuery({
      feed,
      series: [{ ...baseSeries[0], id: 40, display_title: "Non BL friendship", tag_ids: [5] }],
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([40]);
  });

  it("segments non-AniList titles by source mode", () => {
    const feed = createFeed("non anilist");
    feed.filters.sourceMode = "non-anilist";
    feed.filters.sourceModes = ["non-anilist"];
    const result = runFeedQuery({
      feed,
      series: baseSeries,
      tags,
      history,
      labels: [],
      settings: { ...DEFAULT_SETTINGS, adultUnlocked: true, nonAniListPlacement: "mixed" },
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([3]);
  });

  it("sorts by rolling growth inside available history", () => {
    const feed = createFeed("growth");
    feed.filters.sourceMode = "anilist";
    feed.filters.sourceModes = ["anilist"];
    feed.filters.rolling = { mode: "fixed", amount: 1, unit: "days", from: "2024-05-01", to: "2024-05-10" };
    feed.sort = [{ id: "growth", metric: "popularityGrowth", direction: "desc" }];
    const result = runFeedQuery({
      feed,
      series: baseSeries,
      tags,
      history,
      labels: [],
      settings: { ...DEFAULT_SETTINGS, adultUnlocked: true, nonAniListPlacement: "mixed" },
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items[0].id).toBe(1);
  });

  it("sorts by release date when query index dates are present", () => {
    const feed = createFeed("release");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.includeTagIds = [1, 2];
    feed.sort = [{ id: "release", metric: "releaseDate", direction: "desc" }];
    const result = runFeedQuery({
      feed,
      series: baseSeries,
      tags,
      history,
      labels: [],
      settings: { ...DEFAULT_SETTINGS, adultUnlocked: true, nonAniListPlacement: "mixed" },
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([3, 2, 1]);
  });

  it("keeps future release dates inactive for sorting and rolling filters", () => {
    const feed = createFeed("future release");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.sort = [{ id: "release", metric: "releaseDate", direction: "desc" }];
    const future = { ...baseSeries[0], id: 41, display_title: "Future dated", published: { start_date: "2999-01-01", end_date: null } };
    const past = { ...baseSeries[0], id: 42, display_title: "Past dated", published: { start_date: "2024-12-01", end_date: null } };
    const result = runFeedQuery({
      feed,
      series: [future, past],
      tags,
      history,
      labels: [],
      settings: { ...DEFAULT_SETTINGS, nonAniListPlacement: "mixed" },
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([42, 41]);

    feed.filters.dateField = "release";
    feed.filters.rolling = { mode: "fixed", amount: 1, unit: "days", from: "2998-01-01", to: "2999-12-31" };
    const filtered = runFeedQuery({
      feed,
      series: [future, past],
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(filtered.items).toEqual([]);
  });

  it("matches child tags when a parent tag is selected", () => {
    const feed = createFeed("hierarchy");
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.includeTagIds = [3];
    feed.filters.excludeTagIds = [];
    const result = runFeedQuery({
      feed,
      series: [
        { ...baseSeries[0], id: 10, display_title: "Child tagged", tag_ids: [4] },
        { ...baseSeries[0], id: 11, display_title: "Other tagged", tag_ids: [1] },
      ],
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([10]);
  });
});
