import { describe, expect, it } from "vitest";
import { createFeed } from "./defaults";
import { decodeSharePayload, encodeSharePayload } from "./share";

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
});
