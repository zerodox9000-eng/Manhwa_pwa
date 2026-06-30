import { describe, expect, it } from "vitest";
import { createCustomFeed, createFeed } from "../domain/defaults";
import { MAX_CUSTOM_FEED_TITLES, normalizeFeed } from "./useAppStore";

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

  it("deduplicates and caps custom feed membership", () => {
    const feed = createCustomFeed("Saved custom feed");
    feed.customTitleIds = [1, 1, ...Array.from({ length: MAX_CUSTOM_FEED_TITLES + 10 }, (_, index) => index + 2)];

    const normalized = normalizeFeed(feed);

    expect(normalized.kind).toBe("custom");
    expect(normalized.customTitleIds).toHaveLength(MAX_CUSTOM_FEED_TITLES);
    expect(normalized.customTitleIds.slice(0, 3)).toEqual([1, 2, 3]);
  });
});
