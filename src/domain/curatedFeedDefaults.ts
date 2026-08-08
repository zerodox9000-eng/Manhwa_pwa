import defaultFeedSegmentsJson from "./defaultFeedSegments.generated.json";
import defaultFeedsJson from "./defaultFeeds.generated.json";
import type { Feed, FeedSegment } from "./types";

export const CURATED_DEFAULT_FEEDS_VERSION = "v1";

const UNDERRATED_SEGMENT_ID = "8e59f651-ff3e-4c02-8c41-0a5e93e359ae";
const UNSEGMENTED_SEGMENT_ID = "unsegmented";
const NOT_YET_DISCOVERED_FEED_ID = "2f13f7fc-37f4-4049-938a-538ebb4ecf7a";
const CURATED_SEGMENT_IDS = new Set([
  "2f90e87b-44b7-40ab-9fed-01d87241786d",
  "1c070ff0-0a91-4560-b9f7-cec880962c13",
  "ef724293-e9a6-4c7b-a1e0-c398c209afc5",
]);

const defaultFeeds = defaultFeedsJson as unknown as Feed[];
const defaultSegments = defaultFeedSegmentsJson as unknown as FeedSegment[];

export function builtInCuratedFeeds() {
  const curatedFeedIds = new Set([
    NOT_YET_DISCOVERED_FEED_ID,
    ...defaultSegments
      .filter((segment) => CURATED_SEGMENT_IDS.has(segment.id))
      .flatMap((segment) => segment.feedIds),
  ]);
  return defaultFeeds.filter((feed) => curatedFeedIds.has(feed.id));
}

export function builtInCuratedSegments() {
  return defaultSegments.filter((segment) => CURATED_SEGMENT_IDS.has(segment.id));
}

export function mergeBuiltInCuratedDefaults(feeds: Feed[], segments: FeedSegment[]) {
  const curatedFeeds = builtInCuratedFeeds();
  const existingFeedIds = new Set(feeds.map((feed) => feed.id));
  const nextFeeds = [
    ...feeds,
    ...curatedFeeds.filter((feed) => !existingFeedIds.has(feed.id)),
  ];
  const availableFeedIds = new Set(nextFeeds.map((feed) => feed.id));
  const assignedFeedIds = new Set(segments.flatMap((segment) => segment.feedIds ?? []));
  let nextSegments = [...segments];
  let underratedIndex = nextSegments.findIndex((segment) => segment.id === UNDERRATED_SEGMENT_ID);
  if (underratedIndex < 0) {
    const unsegmentedIndex = nextSegments.findIndex((segment) => segment.id === UNSEGMENTED_SEGMENT_ID);
    const now = new Date().toISOString();
    const created = {
      id: UNDERRATED_SEGMENT_ID,
      library: "logic" as const,
      name: "UNDERRATED",
      feedIds: [],
      collapsed: true,
      hiddenFromHome: false,
      createdAt: now,
      updatedAt: now,
    };
    nextSegments = [...nextSegments];
    nextSegments.splice(unsegmentedIndex >= 0 ? unsegmentedIndex : nextSegments.length, 0, created);
    underratedIndex = nextSegments.findIndex((segment) => segment.id === UNDERRATED_SEGMENT_ID);
  }

  if (underratedIndex >= 0 && availableFeedIds.has(NOT_YET_DISCOVERED_FEED_ID) && !assignedFeedIds.has(NOT_YET_DISCOVERED_FEED_ID)) {
    const underrated = nextSegments[underratedIndex];
    nextSegments[underratedIndex] = { ...underrated, feedIds: [...underrated.feedIds, NOT_YET_DISCOVERED_FEED_ID] };
    assignedFeedIds.add(NOT_YET_DISCOVERED_FEED_ID);
  }

  let insertionIndex = nextSegments.findIndex((segment) => segment.id === UNSEGMENTED_SEGMENT_ID);
  if (insertionIndex < 0) insertionIndex = nextSegments.length;
  for (const template of builtInCuratedSegments()) {
    const existingIndex = nextSegments.findIndex((segment) => segment.id === template.id);
    if (existingIndex >= 0) continue;
    const feedIds = template.feedIds.filter((feedId) => availableFeedIds.has(feedId) && !assignedFeedIds.has(feedId));
    nextSegments.splice(insertionIndex, 0, { ...template, library: "logic", feedIds });
    feedIds.forEach((feedId) => assignedFeedIds.add(feedId));
    insertionIndex += 1;
  }

  return { feeds: nextFeeds, segments: nextSegments };
}
