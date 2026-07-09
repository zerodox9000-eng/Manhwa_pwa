import { describe, expect, it } from "vitest";
import { createFeed } from "../domain/defaults";
import type { FeedSegment } from "../domain/types";
import { addNewFeedToUnsegmentedSegment, normalizeFeed, UNSEGMENTED_FEED_SEGMENT_ID } from "./useAppStore";

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
