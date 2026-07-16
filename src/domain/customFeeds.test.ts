import { describe, expect, it } from "vitest";
import { CUSTOM_FEED_MAX_TITLES, insertCustomTitleIds, mergeReorderedVisibleIds, moveCustomTitleIds, normalizeCustomTitleIds } from "./customFeeds";

describe("custom feed membership", () => {
  it("deduplicates and caps membership", () => {
    const ids = Array.from({ length: CUSTOM_FEED_MAX_TITLES + 20 }, (_, index) => index + 1);
    expect(normalizeCustomTitleIds([1, 1, ...ids])).toHaveLength(CUSTOM_FEED_MAX_TITLES);
  });

  it("inserts new titles at either edge and reports duplicates", () => {
    expect(insertCustomTitleIds([2, 3], [1, 2], "top")).toEqual({ titleIds: [1, 2, 3], added: 1, duplicates: 1, full: 0 });
    expect(insertCustomTitleIds([2, 3], [1], "bottom").titleIds).toEqual([2, 3, 1]);
  });

  it("reorders visible titles while hidden slots remain fixed", () => {
    expect(mergeReorderedVisibleIds([1, 2, 3, 4, 5], [5, 1, 3])).toEqual([5, 2, 1, 4, 3]);
  });

  it("moves titles already present at the destination out of the source", () => {
    expect(moveCustomTitleIds([1, 2, 3], [2, 4], [1, 2], "bottom")).toEqual({
      sourceTitleIds: [3],
      destinationTitleIds: [2, 4, 1],
      moved: 2,
      added: 1,
      duplicates: 1,
      full: 0,
    });
  });

  it("keeps titles in the source when a full destination cannot accept them", () => {
    const destination = Array.from({ length: CUSTOM_FEED_MAX_TITLES }, (_, index) => index + 10);
    const result = moveCustomTitleIds([1, 2], destination, [1, 2], "top");

    expect(result.sourceTitleIds).toEqual([1, 2]);
    expect(result.destinationTitleIds).toEqual(destination);
    expect(result.moved).toBe(0);
    expect(result.full).toBe(2);
  });
});
