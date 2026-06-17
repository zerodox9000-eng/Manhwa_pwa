import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, createFeed } from "./defaults";
import { feedUsesAniListOnlyParameters, runFeedQuery } from "./query";
import type { HistoryMap, SeriesCatalog, TagNode } from "./types";

const tags: TagNode[] = [
  { id: 1, name: "Action", path: "Genres > Action", is_genre: true, parent_id: null, level: 1 },
  { id: 2, name: "Hentai", path: "Sexual Content > Intensity > Hentai", is_genre: true, parent_id: null, level: 2 },
  { id: 3, name: "Fantasy", path: "Themes > Fantasy", is_genre: true, parent_id: null, level: 2 },
  { id: 4, name: "Isekai", path: "Themes > Fantasy > Isekai", is_genre: false, parent_id: 3, level: 3 },
  { id: 5, name: "Non-BL with Two Male Leads", path: "Themes > Relationship > Non-BL with Two Male Leads", is_genre: false, parent_id: null, level: 3 },
  { id: 6, name: "Adult Comedy", path: "Sexual Content > Intensity > Hentai > Adult Comedy", is_genre: false, parent_id: 2, level: 3 },
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
  it("keeps the intentional new-feed default as AniList plus Fan Rank", () => {
    const feed = createFeed("default");
    expect(feed.filters.sourceModes).toEqual(["anilist"]);
    expect(feed.sort).toHaveLength(1);
    expect(feed.sort[0].metric).toBe("fanFavouriteDiscoveryPercentile");
    expect(feed.sort[0].direction).toBe("desc");
    expect(feed.view.metricSlots).toEqual(["fanFavouriteDiscoveryPercentile"]);
  });

  it("hides default exact sensitive parent tags only while they are excluded", () => {
    const feed = createFeed("safe");
    feed.filters.excludeTagIds = [2];
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
    expect(result.items.map((item) => item.id)).toEqual([1]);
  });

  it("treats removed default sensitive exclusions as neutral when adult ratings are selected", () => {
    const feed = createFeed("adult neutral tags");
    feed.filters.contentRatings = ["safe", "suggestive", "erotica", "pornographic"];
    feed.filters.excludeTagIds = [];
    const result = runFeedQuery({
      feed,
      series: [
        { ...baseSeries[1], id: 45, display_title: "Neutral Hentai tag", content_rating: "pornographic", tag_ids: [2] },
      ],
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([45]);
  });

  it("does not hide child-only tags when a sensitive parent is excluded", () => {
    const feed = createFeed("exact sensitive");
    const result = runFeedQuery({
      feed,
      series: [{ ...baseSeries[0], id: 44, display_title: "Child only", tag_ids: [6] }],
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([44]);
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
    feed.sort = [{ id: "title", metric: "title", direction: "asc" }];
    feed.view.metricSlots = ["year", "chapters"];
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
    expect(result.activeNotes).toContain("Growth window: 2024-05-01 to 2024-05-10.");
  });

  it("falls back to popularity when growth data is unavailable", () => {
    const feed = createFeed("missing growth");
    feed.filters.sourceMode = "anilist";
    feed.filters.sourceModes = ["anilist"];
    feed.sort = [{ id: "growth", metric: "popularityGrowth", direction: "desc" }];
    const result = runFeedQuery({
      feed,
      series: [
        { ...baseSeries[0], id: 20, display_title: "Lower popularity", stats: { ...baseSeries[0].stats, popularity: 200 } },
        { ...baseSeries[0], id: 21, display_title: "Higher popularity", stats: { ...baseSeries[0].stats, popularity: 900 } },
      ],
      tags,
      history: {},
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: null,
      metaHistoryLast: null,
    });
    expect(result.items.map((item) => item.id)).toEqual([21, 20]);
  });

  it("sorts by release date when query index dates are present", () => {
    const feed = createFeed("release");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.includeTagIds = [1, 2];
    feed.sort = [{ id: "release", metric: "releaseDate", direction: "desc" }];
    feed.view.metricSlots = ["releaseDate"];
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

  it("uses id fallback instead of last-updated or alphabetical order when release dates are missing", () => {
    const feed = createFeed("missing non anilist values");
    feed.filters.sourceMode = "non-anilist";
    feed.filters.sourceModes = ["non-anilist"];
    feed.sort = [{ id: "release", metric: "releaseDate", direction: "desc" }];
    feed.view.metricSlots = ["releaseDate"];
    const result = runFeedQuery({
      feed,
      series: [
        { ...baseSeries[2], id: 500, display_title: "Alpha", published: null, last_updated_at: "2026-06-01T00:00:00.000Z" },
        { ...baseSeries[2], id: 600, display_title: "Zulu", published: null, last_updated_at: "2026-06-08T00:00:00.000Z" },
      ],
      tags,
      history: {},
      labels: [],
      settings: { ...DEFAULT_SETTINGS, nonAniListPlacement: "mixed" },
      metaHistoryFirst: null,
      metaHistoryLast: null,
    });
    expect(result.items.map((item) => item.id)).toEqual([600, 500]);
  });

  it("can exclude estimated release dates while keeping real dates", () => {
    const feed = createFeed("real releases only");
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.sourceMode = "mixed";
    feed.filters.includeEstimatedDates = false;
    feed.sort = [{ id: "release", metric: "releaseDate", direction: "desc" }];
    const result = runFeedQuery({
      feed,
      series: [
        { ...baseSeries[0], id: 80, display_title: "Real", published: { start_date: "2026-06-05", end_date: null, start_date_is_estimated: false } },
        { ...baseSeries[0], id: 81, display_title: "Estimated", published: { start_date: "2026-01-01", end_date: null, start_date_is_estimated: true } },
        { ...baseSeries[0], id: 82, display_title: "Missing", published: null },
      ],
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([80]);
  });

  it("uses MangaBaka latest rank after projecting source mode locally", () => {
    const feed = createFeed("latest added");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.sort = [{ id: "mb", metric: "mangabakaLatestRank", direction: "asc" }];
    feed.view.metricSlots = ["year"];
    expect(feedUsesAniListOnlyParameters(feed)).toBe(false);
    const result = runFeedQuery({
      feed,
      series: [
        { ...baseSeries[0], id: 90, display_title: "AniList rank one", mangabaka_latest_rank: 1 },
        {
          ...baseSeries[2],
          id: 91,
          display_title: "Non AniList rank two",
          stats: { popularity: null, favourites: null, meanScore: null },
          mangabaka_latest_rank: 2,
        },
        {
          ...baseSeries[2],
          id: 92,
          display_title: "Non AniList rank four",
          stats: { popularity: null, favourites: null, meanScore: null },
          mangabaka_latest_rank: 4,
        },
      ],
      tags,
      history,
      labels: [],
      settings: { ...DEFAULT_SETTINGS, nonAniListPlacement: "bottom" },
      metaHistoryFirst: null,
      metaHistoryLast: null,
    });
    expect(result.items.map((item) => item.id)).toEqual([90, 91, 92]);
  });

  it("matches MangaBaka safe latest by applying local safety and exact tag filters after rank order", () => {
    const feed = createFeed("MangaBaka safe latest");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.contentRatings = ["safe"];
    feed.filters.excludeTagIds = [4, 180, 41, 10];
    feed.filters.includeEstimatedDates = true;
    feed.sort = [{ id: "mb", metric: "mangabakaLatestRank", direction: "asc" }];
    feed.view.metricSlots = ["year"];
    const result = runFeedQuery({
      feed,
      series: [
        { ...baseSeries[0], id: 100, display_title: "Safe rank two", content_rating: "safe", tag_ids: [1], mangabaka_latest_rank: 2 },
        { ...baseSeries[0], id: 101, display_title: "Suggestive rank one", content_rating: "suggestive", tag_ids: [1], mangabaka_latest_rank: 1 },
        { ...baseSeries[0], id: 102, display_title: "BL exact rank three", content_rating: "safe", tag_ids: [180], mangabaka_latest_rank: 3 },
        { ...baseSeries[0], id: 103, display_title: "Safe rank four", content_rating: "safe", tag_ids: [1], mangabaka_latest_rank: 4 },
      ],
      tags,
      history,
      labels: [],
      settings: { ...DEFAULT_SETTINGS, nonAniListPlacement: "mixed" },
      metaHistoryFirst: null,
      metaHistoryLast: null,
    });
    expect(result.items.map((item) => item.id)).toEqual([100, 103]);
  });

  it("keeps future release dates inactive for sorting and rolling filters", () => {
    const feed = createFeed("future release");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.sort = [{ id: "release", metric: "releaseDate", direction: "desc" }];
    feed.view.metricSlots = ["releaseDate"];
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

  it("keeps parent tag selection exact instead of matching children", () => {
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
    expect(result.items.map((item) => item.id)).toEqual([]);
  });

  it("uses raw metric values for range filters instead of rounded display values", () => {
    const feed = createFeed("raw ranges");
    feed.filters.sourceMode = "anilist";
    feed.filters.sourceModes = ["anilist"];
    feed.filters.metricRanges = [{ id: "disc", metric: "fanFavouriteDiscoveryPercentile", min: 90, max: 90 }];
    const result = runFeedQuery({
      feed,
      series: [
        { ...baseSeries[0], id: 70, display_title: "Rounds below into 90", analytics: { fanFavouriteDiscoveryPercentile: 89.6 } },
        { ...baseSeries[0], id: 71, display_title: "Rounds above into 90", analytics: { fanFavouriteDiscoveryPercentile: 90.4 } },
        { ...baseSeries[0], id: 72, display_title: "Rounds below 90", analytics: { fanFavouriteDiscoveryPercentile: 89.4 } },
        { ...baseSeries[0], id: 73, display_title: "Rounds above 90", analytics: { fanFavouriteDiscoveryPercentile: 90.5 } },
      ],
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toEqual([]);
  });

  it("does not let cover stats force an AniList-only source lock", () => {
    const feed = createFeed("cover stats mixed");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.sort = [{ id: "rel", metric: "releaseDate", direction: "desc" }];
    feed.view.metricSlots = ["fanFavouriteDiscoveryPercentile"];
    expect(feedUsesAniListOnlyParameters(feed)).toBe(false);
    const result = runFeedQuery({
      feed,
      series: baseSeries,
      tags,
      history,
      labels: [],
      settings: { ...DEFAULT_SETTINGS, nonAniListPlacement: "mixed" },
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items.map((item) => item.id)).toContain(3);
  });

  it("keeps estimated release dates out of Rel sorting and rolling windows", () => {
    const feed = createFeed("estimated release ignored");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.dateField = "release";
    feed.filters.rolling = { mode: "fixed", amount: 1, unit: "days", from: "2026-01-01", to: "2026-01-31" };
    feed.sort = [{ id: "rel", metric: "releaseDate", direction: "desc" }];
    const result = runFeedQuery({
      feed,
      series: [
        {
          ...baseSeries[0],
          id: 74,
          display_title: "Estimated January",
          first_seen_at: "2026-06-10T00:00:00.000Z",
          published: { start_date: "2026-01-01", start_date_is_estimated: true, end_date: null },
        },
      ],
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: "2024-05-01",
      metaHistoryLast: "2024-05-10",
    });
    expect(result.items).toEqual([]);
    expect(result.debugCounts["Excluded estimated release date"]).toBe(1);
  });

  it("can use listed dates for a rolling added-date cutoff", () => {
    const feed = createFeed("added window");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.filters.dateField = "added";
    feed.filters.rolling = { mode: "fixed", amount: 1, unit: "days", from: "2026-06-01", to: "2026-06-30" };
    feed.sort = [{ id: "add", metric: "mangabakaLatestRank", direction: "asc" }];
    const result = runFeedQuery({
      feed,
      series: [
        { ...baseSeries[0], id: 75, display_title: "Fresh", first_seen_at: "2026-06-12T00:00:00.000Z", mangabaka_latest_rank: 2 },
        { ...baseSeries[0], id: 76, display_title: "Old", first_seen_at: "2026-05-12T00:00:00.000Z", mangabaka_latest_rank: 1 },
      ],
      tags,
      history,
      labels: [],
      settings: DEFAULT_SETTINGS,
      metaHistoryFirst: null,
      metaHistoryLast: null,
    });
    expect(result.items.map((item) => item.id)).toEqual([75]);
  });
});
