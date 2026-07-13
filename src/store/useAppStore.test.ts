import { describe, expect, it } from "vitest";
import { createFeed } from "../domain/defaults";
import type { FeedSegment } from "../domain/types";
import { addNewFeedToUnsegmentedSegment, correctDefaultFeedDescriptions, normalizeFeed, UNSEGMENTED_FEED_SEGMENT_ID } from "./useAppStore";

const now = "2026-07-10T00:00:00.000Z";

function segment(id: string, feedIds: string[]): FeedSegment {
  return { id, name: id, feedIds, collapsed: false, hiddenFromHome: false, createdAt: now, updatedAt: now };
}

describe("normalizeFeed", () => {
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

    const normalized = normalizeFeed(feed, { preserveMetricSlots: true });

    expect(normalized.view.metricSlots).toEqual(["mangabakaLatestRank", "popularity", "favourites"]);
  });

  it("preserves an explicitly cleared sensitive exclusion list", () => {
    const feed = createFeed("allow sensitive tags");
    feed.filters.excludeTagIds = [];

    expect(normalizeFeed(feed).filters.excludeTagIds).toEqual([]);
  });

  it("keeps existing sensitive exclusions unchanged", () => {
    const feed = createFeed("safe feed");
    const savedExclusions = [...feed.filters.excludeTagIds];

    expect(normalizeFeed(feed).filters.excludeTagIds).toEqual(savedExclusions);
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
