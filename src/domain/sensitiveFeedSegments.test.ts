import { describe, expect, it } from "vitest";
import {
  builtInSensitiveFeeds,
  builtInSensitiveSegments,
  isBuiltInSensitiveSegmentVisible,
  mergeBuiltInSensitiveDefaults,
} from "./sensitiveFeedSegments";

describe("built-in sensitive feed segments", () => {
  const [smut, relationship, combined] = builtInSensitiveSegments();

  it("shows exactly the segment matching the two search content toggles", () => {
    expect(isBuiltInSensitiveSegmentVisible(smut, { searchAdultTags: false, searchRelationshipTags: false })).toBe(false);
    expect(isBuiltInSensitiveSegmentVisible(relationship, { searchAdultTags: false, searchRelationshipTags: false })).toBe(false);
    expect(isBuiltInSensitiveSegmentVisible(combined, { searchAdultTags: false, searchRelationshipTags: false })).toBe(false);
    expect(isBuiltInSensitiveSegmentVisible(smut, { searchAdultTags: true, searchRelationshipTags: false })).toBe(true);
    expect(isBuiltInSensitiveSegmentVisible(relationship, { searchAdultTags: false, searchRelationshipTags: true })).toBe(true);
    expect(isBuiltInSensitiveSegmentVisible(combined, { searchAdultTags: true, searchRelationshipTags: true })).toBe(true);
    expect(isBuiltInSensitiveSegmentVisible(smut, { searchAdultTags: true, searchRelationshipTags: true })).toBe(false);
    expect(isBuiltInSensitiveSegmentVisible(relationship, { searchAdultTags: true, searchRelationshipTags: true })).toBe(false);
  });

  it("adds the supplied defaults without duplicating an existing library", () => {
    const first = mergeBuiltInSensitiveDefaults([], []);
    const second = mergeBuiltInSensitiveDefaults(first.feeds, first.segments);
    expect(first.feeds).toHaveLength(builtInSensitiveFeeds().length);
    expect(first.segments).toHaveLength(3);
    expect(second.feeds).toHaveLength(first.feeds.length);
    expect(second.segments).toHaveLength(first.segments.length);
    expect(first.segments.every((segment) => segment.hiddenFromHome && segment.collapsed)).toBe(true);
  });

  it("adds newly shipped feeds to an existing sensitive segment without changing its Home visibility", () => {
    const [smut] = builtInSensitiveSegments();
    const existing = { ...smut, feedIds: smut.feedIds.slice(0, -1), hiddenFromHome: true, collapsed: false };

    const merged = mergeBuiltInSensitiveDefaults(builtInSensitiveFeeds(), [existing]);
    const mergedSmut = merged.segments.find((segment) => segment.id === smut.id);

    expect(mergedSmut?.feedIds).toEqual(smut.feedIds);
    expect(mergedSmut?.hiddenFromHome).toBe(true);
    expect(mergedSmut?.collapsed).toBe(false);
  });
});
