import smutSegmentJson from "./defaultSmutSegment.generated.json";
import smutYuriYaoiSegmentJson from "./defaultSmutYuriYaoiSegment.generated.json";
import yuriYaoiSegmentJson from "./defaultYuriYaoiSegment.generated.json";
import type { Feed, FeedSegment } from "./types";

type SensitiveSegmentMode = "adult" | "relationship" | "combined";

interface SensitiveSegmentSource {
  feeds: Feed[];
  feedSegments: FeedSegment[];
}

const sensitiveSegmentSources: Array<{ mode: SensitiveSegmentMode; source: SensitiveSegmentSource }> = [
  { mode: "adult", source: smutSegmentJson as SensitiveSegmentSource },
  { mode: "relationship", source: yuriYaoiSegmentJson as SensitiveSegmentSource },
  { mode: "combined", source: smutYuriYaoiSegmentJson as SensitiveSegmentSource },
];

const sensitiveSegmentModeById = new Map(
  sensitiveSegmentSources.flatMap(({ mode, source }) => source.feedSegments.map((segment) => [segment.id, mode] as const)),
);

export function builtInSensitiveFeeds() {
  return sensitiveSegmentSources.flatMap(({ source }) => source.feeds);
}

export function builtInSensitiveSegments() {
  return sensitiveSegmentSources.flatMap(({ source }) =>
    source.feedSegments.map((segment) => ({ ...segment, collapsed: true, hiddenFromHome: true })),
  );
}

export function isBuiltInSensitiveSegment(segment: Pick<FeedSegment, "id">) {
  return sensitiveSegmentModeById.has(segment.id);
}

export function isBuiltInSensitiveSegmentVisible(
  segment: Pick<FeedSegment, "id">,
  settings: Pick<{ searchRelationshipTags: boolean; searchAdultTags: boolean }, "searchRelationshipTags" | "searchAdultTags">,
) {
  const mode = sensitiveSegmentModeById.get(segment.id);
  if (!mode) return true;
  if (mode === "adult") return settings.searchAdultTags && !settings.searchRelationshipTags;
  if (mode === "relationship") return settings.searchRelationshipTags && !settings.searchAdultTags;
  return settings.searchRelationshipTags && settings.searchAdultTags;
}

export function mergeBuiltInSensitiveDefaults(feeds: Feed[], segments: FeedSegment[]) {
  const existingFeedIds = new Set(feeds.map((feed) => feed.id));
  const nextFeeds = [...feeds, ...builtInSensitiveFeeds().filter((feed) => !existingFeedIds.has(feed.id))];
  const defaultSegmentsById = new Map(builtInSensitiveSegments().map((segment) => [segment.id, segment]));
  const mergedSegments = segments.map((segment) => {
    const builtIn = defaultSegmentsById.get(segment.id);
    if (!builtIn) return segment;
    const feedIds = new Set(segment.feedIds);
    return {
      ...segment,
      feedIds: [...segment.feedIds, ...builtIn.feedIds.filter((feedId) => !feedIds.has(feedId))],
    };
  });
  const existingSegmentIds = new Set(mergedSegments.map((segment) => segment.id));
  const nextSegments = [
    ...mergedSegments,
    ...builtInSensitiveSegments().filter((segment) => !existingSegmentIds.has(segment.id)),
  ];
  return { feeds: nextFeeds, segments: nextSegments };
}
