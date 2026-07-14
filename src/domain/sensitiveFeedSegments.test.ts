import { describe, expect, it } from "vitest";
import {
  builtInSensitiveFeeds,
  builtInSensitiveSegments,
  isBuiltInSensitiveSegmentVisible,
  mergeBuiltInSensitiveDefaults,
  normalizeBuiltInSensitiveNames,
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
    const existingFeed = { ...builtInSensitiveFeeds().find((feed) => feed.id === "0d3c8a76-188e-4cd8-b735-71c26d0b84ef")!, name: "Erotica " };
    const existing = { ...smut, name: "SMUT", feedIds: smut.feedIds.slice(0, -1), hiddenFromHome: true, collapsed: false };

    const merged = mergeBuiltInSensitiveDefaults(
      builtInSensitiveFeeds().map((feed) => feed.id === existingFeed.id ? existingFeed : feed),
      [existing],
    );
    const mergedSmut = merged.segments.find((segment) => segment.id === smut.id);
    const mergedErotica = merged.feeds.find((feed) => feed.id === existingFeed.id);

    expect(mergedSmut?.feedIds).toEqual(smut.feedIds);
    expect(mergedSmut?.name).toBe("SMUT/EROTICA");
    expect(mergedSmut?.hiddenFromHome).toBe(true);
    expect(mergedSmut?.collapsed).toBe(false);
    expect(mergedErotica?.name).toBe("EROTICA");
  });

  it("normalizes built-in display names even after the one-time install migration", () => {
    const feeds = builtInSensitiveFeeds().map((feed) => feed.id === "0d3c8a76-188e-4cd8-b735-71c26d0b84ef" ? { ...feed, name: "Erotica " } : feed);
    const segments = builtInSensitiveSegments().map((segment) => segment.id === "e362a18b-4a6c-42d7-85f8-f499ba2d195e" ? { ...segment, name: "SMUT", collapsed: false } : segment);

    const normalized = normalizeBuiltInSensitiveNames(feeds, segments);

    expect(normalized.feeds.find((feed) => feed.id === "0d3c8a76-188e-4cd8-b735-71c26d0b84ef")?.name).toBe("EROTICA");
    expect(normalized.segments.find((segment) => segment.id === "e362a18b-4a6c-42d7-85f8-f499ba2d195e")).toMatchObject({
      name: "SMUT/EROTICA",
      collapsed: false,
    });
  });
});
