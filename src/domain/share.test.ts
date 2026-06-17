import { describe, expect, it } from "vitest";
import { createFeed } from "./defaults";
import { decodeSharePayload, encodeSharePayload, findEquivalentFeed, findFeedNameConflict, getFeedFingerprint } from "./share";

describe("share codec", () => {
  it("round-trips compressed feed links", () => {
    const payload = { kind: "feed" as const, version: 2 as const, feed: createFeed("Reddit Rec List") };
    payload.feed.description = "Exact shared feed";
    payload.feed.showDescription = true;
    payload.feed.view.gridColumns = 4;
    payload.feed.view.metricSlots = ["year", "popularityGrowth", "fanFavouriteRaw"];
    const encoded = encodeSharePayload(payload);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(decodeSharePayload(encoded)).toEqual(payload);
  });

  it("round-trips compressed title links", () => {
    const payload = {
      kind: "title" as const,
      version: 2 as const,
      titleId: 514279,
      title: "Her Game of Go",
      description: "A Go prodigy story.",
    };
    expect(decodeSharePayload(encodeSharePayload(payload))).toEqual(payload);
  });

  it("fingerprints meaningful feed config without runtime ids", () => {
    const left = createFeed("Exact");
    const right = createFeed("Exact");
    left.description = right.description = "Same feed";
    left.showDescription = right.showDescription = true;
    left.view.metricSlots = ["year", "popularityGrowth", "fanFavouriteRaw"];
    right.view.metricSlots = ["year", "popularityGrowth", "fanFavouriteRaw"];
    left.sort = [{ id: "local-a", metric: "mangabakaLatestRank", direction: "asc" }];
    right.sort = [{ id: "shared-b", metric: "mangabakaLatestRank", direction: "asc" }];

    expect(getFeedFingerprint(left)).toBe(getFeedFingerprint(right));
    expect(findEquivalentFeed([left], right)?.id).toBe(left.id);

    right.view.metricSlots = ["fanFavouriteDiscoveryPercentile"];
    expect(findEquivalentFeed([left], right)).toBeNull();
    expect(findFeedNameConflict([left], right)?.id).toBe(left.id);
  });
});
