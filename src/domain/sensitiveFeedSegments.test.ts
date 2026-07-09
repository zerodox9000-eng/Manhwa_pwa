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
});
