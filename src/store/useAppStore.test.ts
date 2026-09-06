import { describe, expect, it } from "vitest";
import defaultFeedSegmentsJson from "../domain/defaultFeedSegments.generated.json";
import defaultFeedsJson from "../domain/defaultFeeds.generated.json";
import { createFeed } from "../domain/defaults";
import type { Feed, FeedSegment } from "../domain/types";
import { mergeBuiltInCuratedDefaults } from "../domain/curatedFeedDefaults";
import { addNewFeedToUnsegmentedSegment, correctDefaultFeedDescriptions, correctDiscoverDeepCutExclusions, mergeLatestListingsDefault, migrateLegacyOelSourceMode, MY_LIST_UNSEGMENTED_FEED_SEGMENT_ID, normalizeFeed, normalizeFeedSegments, removeRetiredDefaultFeeds, UNSEGMENTED_FEED_SEGMENT_ID } from "./useAppStore";

const now = "2026-07-10T00:00:00.000Z";

function segment(id: string, feedIds: string[]): FeedSegment {
  return { id, library: "logic", name: id, feedIds, collapsed: false, hiddenFromHome: false, createdAt: now, updatedAt: now };
}

describe("normalizeFeed", () => {
  it("keeps every shipped growth feed on the one-week runtime contract", () => {
    const feeds = defaultFeedsJson as unknown as Feed[];
    const growthFeeds = feeds.filter((feed) => [
      ...feed.sort.map((rule) => rule.metric),
      ...(feed.filters.metricRanges ?? []).map((range) => range.metric),
      ...(feed.view.metricSlots ?? []),
    ].some((metric) => metric.includes("Growth") || metric.includes("Delta")));

    expect(growthFeeds).toHaveLength(17);
    expect(growthFeeds.every((feed) => (
      feed.filters.rolling.mode === "last" &&
      feed.filters.rolling.amount === 1 &&
      feed.filters.rolling.unit === "weeks"
    ))).toBe(true);
  });

  it("migrates legacy feeds to logic without changing their id", () => {
    const legacy = createFeed("Legacy");
    delete (legacy as Partial<typeof legacy>).kind;
    const normalized = normalizeFeed(legacy);
    expect(normalized.kind).toBe("logic");
    expect(normalized.id).toBe(legacy.id);
  });

  it("keeps custom membership and creates a separate MY LIST segment", () => {
    const logic = createFeed("Logic");
    const custom = createFeed("Custom");
    custom.kind = "custom";
    custom.titleIds = [3, 3, 2];
    const segments = normalizeFeedSegments([normalizeFeed(logic), normalizeFeed(custom)], [segment(UNSEGMENTED_FEED_SEGMENT_ID, [logic.id])]);
    expect(segments.find((item) => item.id === MY_LIST_UNSEGMENTED_FEED_SEGMENT_ID)?.feedIds).toEqual([custom.id]);
    expect(normalizeFeed(custom).titleIds).toEqual([3, 2]);
  });
  it("removes latest-added rank from visible cover stats", () => {
    const feed = createFeed("old latest");
    feed.filters.sourceMode = "mixed";
    feed.filters.sourceModes = ["anilist", "non-anilist"];
    feed.sort = [{ id: "add", metric: "mangabakaLatestRank", direction: "asc" }];
    feed.view.metricSlots = ["mangabakaLatestRank"];

    const normalized = normalizeFeed(feed);

    expect(normalized.filters.sourceModes).toEqual(["anilist", "non-anilist"]);
    expect(normalized.sort[0].metric).toBe("mangabakaLatestRank");
    expect(normalized.view.metricSlots).toEqual([]);
  });

  it("preserves shared cover stats when requested", () => {
    const feed = createFeed("shared exact");
    feed.view.metricSlots = ["mangabakaLatestRank", "popularity", "favourites"];
    feed.view.metricSlotsWhenHidden = ["year"];

    const normalized = normalizeFeed(feed, { preserveMetricSlots: true });

    expect(normalized.view.metricSlots).toEqual(["mangabakaLatestRank", "popularity", "favourites"]);
    expect(normalized.view.metricSlotsWhenHidden).toEqual(["year"]);
  });

  it("preserves an explicitly cleared sensitive exclusion list", () => {
    const feed = createFeed("allow sensitive tags");
    feed.filters.excludeTagIds = [];

    expect(normalizeFeed(feed).filters.excludeTagIds).toEqual([]);
  });

  it("defaults legacy feeds to all five tag weight types", () => {
    const feed = createFeed("legacy weights");
    delete (feed.filters as Partial<typeof feed.filters>).tagWeightTypes;

    expect(normalizeFeed(feed).filters.tagWeightTypes).toEqual([
      "core",
      "defining",
      "recurrent",
      "incidental",
      "unweighted",
    ]);
  });

  it("defaults built-in tag feeds to core and defining weights", () => {
    const generatedFeeds = defaultFeedsJson as unknown as Feed[];
    const genderBender = generatedFeeds.find((feed) => feed.name.trim() === "GENDER BENDER");
    expect(genderBender).toBeDefined();

    const normalized = normalizeFeed(genderBender!);

    expect(normalized.filters.tagWeightTypes).toEqual(["core", "defining"]);
  });

  it("leaves Novel Based feeds unfiltered by weight and keeps the named broad tag feeds fully enabled", () => {
    const generatedFeeds = defaultFeedsJson as unknown as Feed[];
    const expectedAllTypes = ["core", "defining", "recurrent", "incidental", "unweighted"];
    const novelBased = generatedFeeds.find((feed) => feed.name.trim() === "BASED ON A NOVEL");
    const broadTagFeeds = ["POLITICAL", "FEMALE EMPOWERMENT", "SECOND CHANCE", "NON-HUMAN"]
      .map((name) => generatedFeeds.find((feed) => feed.name.trim() === name));

    expect(normalizeFeed(novelBased!).filters.tagWeightTypes).toEqual(expectedAllTypes);
    expect(broadTagFeeds.map((feed) => normalizeFeed(feed!).filters.tagWeightTypes)).toEqual([
      expectedAllTypes,
      expectedAllTypes,
      expectedAllTypes,
      expectedAllTypes,
    ]);
  });

  it("keeps existing sensitive exclusions unchanged", () => {
    const feed = createFeed("safe feed");
    const savedExclusions = [...feed.filters.excludeTagIds];

    expect(normalizeFeed(feed).filters.excludeTagIds).toEqual(savedExclusions);
  });

  it("migrates saved non-weekly growth feeds to one week without changing other settings", () => {
    const feed = createFeed("Old monthly growth");
    feed.sort = [{ id: "growth", metric: "popularityGrowthPercent", direction: "asc" }];
    feed.filters.rolling = { mode: "last", amount: 1, unit: "months" };
    feed.filters.statuses = ["releasing"];

    const normalized = normalizeFeed(feed);

    expect(normalized.filters.rolling).toMatchObject({ mode: "last", amount: 1, unit: "weeks" });
    expect(normalized.sort).toEqual(feed.sort);
    expect(normalized.filters.statuses).toEqual(["releasing"]);
  });

  it("keeps release windows independent when a feed also sorts by weekly growth", () => {
    const feed = createFeed("Recent releases by growth");
    feed.sort = [{ id: "growth", metric: "popularityGrowthPercent", direction: "desc" }];
    feed.filters.dateField = "release";
    feed.filters.rolling = { mode: "last", amount: 3, unit: "months" };

    expect(normalizeFeed(feed).filters.rolling).toEqual(feed.filters.rolling);
  });

  it("keeps legacy Non-AniList feed membership by adding the new OEL source once", () => {
    const feed = createFeed("Legacy non-AniList");
    feed.filters.sourceMode = "non-anilist";
    feed.filters.sourceModes = ["non-anilist"];

    const migrated = migrateLegacyOelSourceMode(feed);

    expect(migrated.filters.sourceMode).toBe("mixed");
    expect(migrated.filters.sourceModes).toEqual(["non-anilist", "oel"]);
    expect(migrateLegacyOelSourceMode(migrated)).toEqual(migrated);
  });
});

describe("new feed segment placement", () => {
  it("adds new feeds to UNSEGMENTED even when a sensitive segment is last", () => {
    const next = addNewFeedToUnsegmentedSegment([
      segment(UNSEGMENTED_FEED_SEGMENT_ID, ["existing-feed"]),
      segment("smut-yuri-yaoi", ["sensitive-feed"]),
    ], "new-feed");

    expect(next.find((item) => item.id === UNSEGMENTED_FEED_SEGMENT_ID)?.feedIds).toEqual(["existing-feed", "new-feed"]);
    expect(next.find((item) => item.id === "smut-yuri-yaoi")?.feedIds).toEqual(["sensitive-feed"]);
  });

  it("recovers the UNSEGMENTED segment before adding a feed when it is missing", () => {
    const next = addNewFeedToUnsegmentedSegment([segment("smut", ["sensitive-feed"])], "new-feed");

    expect(next[0]?.id).toBe(UNSEGMENTED_FEED_SEGMENT_ID);
    expect(next[0]?.feedIds).toEqual(["new-feed"]);
  });
});

describe("default feed description fixes", () => {
  it("corrects only unchanged built-in descriptions", () => {
    const mostUnderrated = createFeed("Most underrated");
    mostUnderrated.id = "0c96761d-09d2-423a-a959-b2c3e451f739";
    mostUnderrated.description = "Fan Loved but Less Popular | Filter : 70% < Popularity & 10% < Underrated ";
    const underrated = createFeed("Underrated");
    underrated.id = "99609e6f-9bd7-4d8c-9885-de48718fc051";
    underrated.description = "Deserve More Spotlight | Filter : 70% < Popularity & 5% < Underrated < 10%";
    const custom = createFeed("Custom");
    custom.description = "My own wording";
    const ranked = createFeed("Top 10% ranked");
    ranked.id = "default-feed-1";
    ranked.description = "Ranking by Engagement | Filter : 70% < Popularity & 90% < Ranking ";

    const corrected = correctDefaultFeedDescriptions([mostUnderrated, underrated, custom, ranked]);

    expect(corrected[0].description).toContain("50% < Popularity");
    expect(corrected[1].description).toContain("50% < Popularity");
    expect(corrected[2]).toBe(custom);
    expect(corrected[3].description).toContain("Ranked by Engagement");
  });
});

describe("Discover Deep Cut default filter fix", () => {
  it("ships with the same exclusions as Discover Underground", () => {
    const defaultFeeds = defaultFeedsJson as unknown as Feed[];
    const deepCut = defaultFeeds.find((feed) => feed.id === "default-feed-12");
    const underground = defaultFeeds.find((feed) => feed.id === "98baa3ee-b1ff-404a-9878-b834aa7ea95b");

    expect(deepCut?.filters.excludeTagIds).toEqual([4, 180, 41, 10]);
    expect(deepCut?.filters.excludeTagIds).toEqual(underground?.filters.excludeTagIds);
  });

  it("aligns only the built-in Deep Cut exclusions with the other Discovery feeds", () => {
    const deepCut = createFeed("DISCOVER DEEP CUT");
    deepCut.id = "default-feed-12";
    deepCut.filters.excludeTagIds = [4, 180, 41, 10, 33, 16];
    const userFeed = createFeed("My Deep Cut");
    userFeed.filters.excludeTagIds = [33, 16];

    const corrected = correctDiscoverDeepCutExclusions([deepCut, userFeed]);

    expect(corrected[0].filters.excludeTagIds).toEqual([4, 180, 41, 10]);
    expect(corrected[1]).toBe(userFeed);
  });
});

describe("retired default feed migration", () => {
  it("removes only Latest Listings and clears its segment reference", () => {
    const latestListings = createFeed("LATEST LISTINGS");
    latestListings.id = "089d6f0f-cd06-4e94-9d43-d80071d427fb";
    const retainedDefault = createFeed("TRENDING");
    retainedDefault.id = "retained-default";
    const customFeed = createFeed("My list");
    customFeed.id = "custom-feed";
    customFeed.kind = "custom";

    const feeds = removeRetiredDefaultFeeds([latestListings, retainedDefault, customFeed]);
    const segments = normalizeFeedSegments(feeds, [segment("updates", [retainedDefault.id, latestListings.id]), segment(UNSEGMENTED_FEED_SEGMENT_ID, []), { ...segment(MY_LIST_UNSEGMENTED_FEED_SEGMENT_ID, [customFeed.id]), library: "custom" }]);

    expect(feeds.map((feed) => feed.id)).toEqual([retainedDefault.id, customFeed.id]);
    expect(segments.find((item) => item.id === "updates")?.feedIds).toEqual([retainedDefault.id]);
    expect(segments.find((item) => item.id === MY_LIST_UNSEGMENTED_FEED_SEGMENT_ID)?.feedIds).toEqual([customFeed.id]);
  });
});

describe("Latest Listings default feed installation", () => {
  it("adds the supplied feed after Recently Completed without replacing saved state", () => {
    const newReleases = createFeed("NEW RELEASES");
    newReleases.id = "3511ae36-01bd-432b-9287-b1afdf85869a";
    const recentlyCompleted = createFeed("RECENTLY COMPLETED");
    recentlyCompleted.id = "5be53571-49c2-404f-8379-c7516fa6e979";
    const userFeed = createFeed("My saved feed");
    userFeed.id = "user-feed";
    const updates = {
      ...segment("2f19120b-0507-428d-9207-762d8726439e", [newReleases.id, recentlyCompleted.id]),
      collapsed: false,
      hiddenFromHome: true,
    };
    const userSegment = segment("user-segment", [userFeed.id]);

    const merged = mergeLatestListingsDefault(
      [newReleases, recentlyCompleted, userFeed],
      [updates, userSegment],
    );
    const latestListings = merged.feeds.find((feed) => feed.id === "b68dcc8b-3ca0-44a4-a474-dd91af2debe7");

    expect(latestListings?.name).toBe("LATEST LISTINGS");
    expect(latestListings?.filters.sourceModes).toEqual(["non-anilist"]);
    expect(latestListings?.sort[0]).toMatchObject({ metric: "mangabakaLatestRank", direction: "asc" });
    expect(merged.segments[0]).toMatchObject({ collapsed: false, hiddenFromHome: true });
    expect(merged.segments[0]?.feedIds).toEqual([
      newReleases.id,
      recentlyCompleted.id,
      "b68dcc8b-3ca0-44a4-a474-dd91af2debe7",
    ]);
    expect(merged.segments[1]).toEqual(userSegment);
    expect(merged.feeds).toContain(userFeed);
  });

  it("is idempotent and does not duplicate the feed or its segment membership", () => {
    const recentlyCompleted = createFeed("RECENTLY COMPLETED");
    recentlyCompleted.id = "5be53571-49c2-404f-8379-c7516fa6e979";
    const updates = segment("2f19120b-0507-428d-9207-762d8726439e", [recentlyCompleted.id]);

    const installed = mergeLatestListingsDefault([recentlyCompleted], [updates]);
    const installedAgain = mergeLatestListingsDefault(installed.feeds, installed.segments);

    expect(installedAgain.feeds.filter((feed) => feed.id === "b68dcc8b-3ca0-44a4-a474-dd91af2debe7")).toHaveLength(1);
    expect(installedAgain.segments[0]?.feedIds.filter((id) => id === "b68dcc8b-3ca0-44a4-a474-dd91af2debe7")).toHaveLength(1);
    expect(installedAgain).toEqual(installed);
  });
});

describe("curated default feed installation", () => {
  const expectedSegments = [
    ["OEL", 2],
    ["NOVEL BASED", 2],
    ["CHARACTER TYPES", 5],
    ["NARRATIVE TROPES", 6],
    ["SETTINGS", 3],
    ["LOCATION", 4],
    ["GENRE COMBOS", 6],
    ["OCCUPATIONS", 7],
    ["RELATIONSHIP", 6],
    ["THEME", 14],
    ["SPECIES & CREATURES", 7],
    ["Unsegmented", 0],
  ] as const;
  const legacyTagFeedIds = [
    "2f7c754a-52ff-44d1-bdbd-e6ac47b07d75",
    "7804e1f1-f018-4ef8-a656-80e154c0dd86",
    "98e259c2-0a3b-4620-bd1c-9492c9c558dc",
    "a72e8925-645d-4a84-b16b-3e32d88f0da6",
    "8c52fcde-1df5-47b8-bb2e-9896fcac02e4",
    "d7f02dcb-2bc5-49c0-b6f2-4dd6cb7f1e32",
    "046cfd8e-57d2-4c70-b4c1-3ff382f61924",
    "18e2db15-8b71-4c2f-bb6a-e42c53232219",
    "1948e099-ba5f-43fb-96d2-f4dac85a87c1",
    "211b483c-036a-4cdd-a955-f82417efcd34",
    "0763db20-1b5a-429d-a1f3-9199d12e47b4",
    "afd31cfd-62fe-44ac-a76c-10a2f19a999c",
    "011887f7-9783-44e9-bd81-4858f446f7e5",
    "08ed70e2-ee5f-4edd-abed-0148efc0c1bb",
    "fa49d77a-7fbc-4833-bce0-df8e9cfe2b41",
    "6410e2cf-7dcc-4515-b701-7babb235d3ca",
    "b6fabf5c-5ae6-4c58-828f-085c871b43da",
    "1c3a6507-bb7f-4e8b-8618-99086836d5ed",
    "ad80f768-ab50-4753-9096-bf25f01222fd",
    "43e592cd-5f18-4470-b400-a5951c3558d2",
    "ec27fd3c-adbe-4cab-ac9c-0095d19258bf",
    "cb77f208-8e54-43cb-ac7b-23fb9da237d8",
    "b2e9d710-7a31-4b00-b126-c91011bbdbe0",
    "84018df9-5dd0-43fc-a7fc-b02fa621128c",
  ];

  it("keeps the fresh default placement and replaces TAG BASED FEEDS", () => {
    const defaults = defaultFeedSegmentsJson as unknown as FeedSegment[];
    const underrated = defaults.find((item) => item.id === "8e59f651-ff3e-4c02-8c41-0a5e93e359ae");

    expect(underrated?.feedIds).toEqual([
      "0c96761d-09d2-423a-a959-b2c3e451f739",
      "99609e6f-9bd7-4d8c-9885-de48718fc051",
      "2f13f7fc-37f4-4049-938a-538ebb4ecf7a",
      "c456f0dd-adf8-4acc-8394-d2467ab5dcf8",
    ]);
    expect(defaults.slice(-12).map((item) => [item.name, item.feedIds.length])).toEqual(expectedSegments);
    expect(defaults.find((item) => item.name === "TAG BASED FEEDS")).toBeUndefined();
    expect(defaults.slice(-11, -1).every((item) => item.hiddenFromHome === false)).toBe(true);
    expect((defaultFeedsJson as unknown as Feed[])).toHaveLength(96);
    expect((defaultFeedsJson as unknown as Feed[]).some((feed) => legacyTagFeedIds.includes(feed.id))).toBe(false);
  });

  it("retires an untouched legacy segment and its obsolete feeds", () => {
    const legacyFeeds = legacyTagFeedIds.map((id) => {
      const feed = createFeed(id);
      feed.id = id;
      return feed;
    });
    const legacySegment = {
      ...segment("ef724293-e9a6-4c7b-a1e0-c398c209afc5", legacyTagFeedIds),
      name: "TAG BASED FEEDS",
      collapsed: true,
      hiddenFromHome: false,
    };
    const merged = mergeBuiltInCuratedDefaults(legacyFeeds, [legacySegment, { ...segment(UNSEGMENTED_FEED_SEGMENT_ID, []), name: "Unsegmented" }]);

    expect(merged.segments.find((item) => item.id === legacySegment.id)).toBeUndefined();
    expect(merged.feeds.some((feed) => legacyTagFeedIds.includes(feed.id))).toBe(false);
    expect(merged.segments.slice(-12).map((item) => [item.name, item.feedIds.length])).toEqual(expectedSegments);
  });

  it("preserves a customized legacy segment while adding the replacement defaults", () => {
    const legacyFeeds = legacyTagFeedIds.map((id) => {
      const feed = createFeed(id);
      feed.id = id;
      return feed;
    });
    const customizedLegacySegment = {
      ...segment("ef724293-e9a6-4c7b-a1e0-c398c209afc5", [...legacyTagFeedIds].reverse()),
      name: "My tag feeds",
      collapsed: false,
      hiddenFromHome: true,
    };
    const merged = mergeBuiltInCuratedDefaults(legacyFeeds, [customizedLegacySegment, { ...segment(UNSEGMENTED_FEED_SEGMENT_ID, []), name: "Unsegmented" }]);

    expect(merged.segments.find((item) => item.id === customizedLegacySegment.id)).toEqual(customizedLegacySegment);
    expect(merged.feeds.filter((feed) => legacyTagFeedIds.includes(feed.id))).toHaveLength(legacyTagFeedIds.length);
  });

  it("does not move a feed or overwrite an existing replacement segment", () => {
    const notYetDiscovered = createFeed("NOT YET DISCOVERED");
    notYetDiscovered.id = "2f13f7fc-37f4-4049-938a-538ebb4ecf7a";
    const movedSegment = { ...segment("user-segment", [notYetDiscovered.id]), name: "My placement" };
    const existingCuratedSegment = {
      ...segment("4d9b8338-29eb-4a06-8949-d13ad3f19e2b", ["user-feed"]),
      collapsed: false,
      hiddenFromHome: true,
    };
    const merged = mergeBuiltInCuratedDefaults([notYetDiscovered], [movedSegment, existingCuratedSegment]);

    expect(merged.segments.find((item) => item.id === movedSegment.id)).toEqual(movedSegment);
    const mergedCuratedSegment = merged.segments.find((item) => item.id === existingCuratedSegment.id);
    expect(mergedCuratedSegment).toMatchObject({
      id: existingCuratedSegment.id,
      library: existingCuratedSegment.library,
      name: existingCuratedSegment.name,
      collapsed: existingCuratedSegment.collapsed,
      hiddenFromHome: existingCuratedSegment.hiddenFromHome,
      createdAt: existingCuratedSegment.createdAt,
      updatedAt: existingCuratedSegment.updatedAt,
    });
    expect(mergedCuratedSegment?.feedIds).toEqual([
      "user-feed",
      "0a6cc89d-558d-42e7-8eb9-7033cb09ce03",
      "b385ecab-85b9-461a-85b6-573450537fce",
      "a9021b05-5b99-414a-a80c-b67f25bbb4ca",
      "dab84dcd-f994-4faa-9ac7-48ecd56f8b93",
      "09a55365-c7aa-41ff-88db-eb26b86aaf17",
    ]);
    expect(merged.feeds.filter((feed) => [
      "0a6cc89d-558d-42e7-8eb9-7033cb09ce03",
      "b385ecab-85b9-461a-85b6-573450537fce",
      "a9021b05-5b99-414a-a80c-b67f25bbb4ca",
      "dab84dcd-f994-4faa-9ac7-48ecd56f8b93",
      "09a55365-c7aa-41ff-88db-eb26b86aaf17",
    ].includes(feed.id))).toHaveLength(5);
    expect(merged.segments.filter((item) => item.feedIds.includes(notYetDiscovered.id))).toHaveLength(1);
  });

  it("adds only unassigned feeds, keeps the new segments visible, and is idempotent", () => {
    const overhyped = createFeed("OVERHYPED");
    overhyped.id = "c456f0dd-adf8-4acc-8394-d2467ab5dcf8";
    const underrated = segment("8e59f651-ff3e-4c02-8c41-0a5e93e359ae", [overhyped.id]);
    const unsegmented = segment(UNSEGMENTED_FEED_SEGMENT_ID, []);

    const installed = mergeBuiltInCuratedDefaults([overhyped], [underrated, unsegmented]);
    const installedAgain = mergeBuiltInCuratedDefaults(installed.feeds, installed.segments);
    const installedUnderrated = installed.segments.find((item) => item.id === underrated.id);
    const newSegments = installed.segments.filter((item) => [
      "2f90e87b-44b7-40ab-9fed-01d87241786d",
      "1c070ff0-0a91-4560-b9f7-cec880962c13",
      "4d9b8338-29eb-4a06-8949-d13ad3f19e2b",
      "950d6c3d-0164-4ccc-b405-1e570d88991f",
      "edff82e1-332d-41cb-83c7-59d069c39bec",
      "ef2778ad-4548-44a3-a8c3-4a4dca58c01b",
      "cb4ee3cc-d8a5-4fd0-9713-c1432691291b",
      "50ae704b-b926-4dba-8779-cc4d36f4bf53",
      "f3f55dfc-5c05-409a-94ef-5631caa09e09",
      "b6ce4d9f-992d-4090-8ba6-22a288e87282",
      "70c98c44-03d1-4e0b-b891-e0a41c0a48b8",
    ].includes(item.id));

    expect(installedUnderrated?.feedIds).toEqual([overhyped.id, "2f13f7fc-37f4-4049-938a-538ebb4ecf7a"]);
    expect(installed.segments.slice(-12).map((item) => item.id)).toEqual([
      "2f90e87b-44b7-40ab-9fed-01d87241786d",
      "1c070ff0-0a91-4560-b9f7-cec880962c13",
      "4d9b8338-29eb-4a06-8949-d13ad3f19e2b",
      "950d6c3d-0164-4ccc-b405-1e570d88991f",
      "edff82e1-332d-41cb-83c7-59d069c39bec",
      "ef2778ad-4548-44a3-a8c3-4a4dca58c01b",
      "cb4ee3cc-d8a5-4fd0-9713-c1432691291b",
      "50ae704b-b926-4dba-8779-cc4d36f4bf53",
      "f3f55dfc-5c05-409a-94ef-5631caa09e09",
      "b6ce4d9f-992d-4090-8ba6-22a288e87282",
      "70c98c44-03d1-4e0b-b891-e0a41c0a48b8",
      UNSEGMENTED_FEED_SEGMENT_ID,
    ]);
    expect(installed.segments.find((item) => item.id === UNSEGMENTED_FEED_SEGMENT_ID)?.feedIds).toEqual([]);
    expect(newSegments.every((item) => item.hiddenFromHome === false)).toBe(true);
    expect(installedAgain).toEqual(installed);
  });
});
