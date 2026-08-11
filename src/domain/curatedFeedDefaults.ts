import defaultFeedSegmentsJson from "./defaultFeedSegments.generated.json";
import defaultFeedsJson from "./defaultFeeds.generated.json";
import type { Feed, FeedSegment } from "./types";

export const CURATED_DEFAULT_FEEDS_VERSION = "v3";

const UNDERRATED_SEGMENT_ID = "8e59f651-ff3e-4c02-8c41-0a5e93e359ae";
const UNSEGMENTED_SEGMENT_ID = "unsegmented";
const NOT_YET_DISCOVERED_FEED_ID = "2f13f7fc-37f4-4049-938a-538ebb4ecf7a";
const CURATED_SEGMENT_IDS = new Set([
  "2f90e87b-44b7-40ab-9fed-01d87241786d",
  "1c070ff0-0a91-4560-b9f7-cec880962c13",
  "4d9b8338-29eb-4a06-8949-d13ad3f19e2b",
  "950d6c3d-0164-4ccc-b405-1e570d88991f",
  "edff82e1-332d-41cb-83c7-59d069c39bec",
  "ef2778ad-4548-44a3-a8c3-4a4dca58c01b",
  "cb4ee3cc-d8a5-4fd0-9713-c1432691291b",
  "50ae704b-b926-4dba-8779-cc4d36f4bf53",
  "f3f55dfc-5c05-409a-94ef-5631caa09e09",
  "b6ce4d9f-992d-4090-8ba6-22a288e87282",
  "70c98c44-03d1-4e0b-b891-e0a41c0a48b8",
]);

const LEGACY_TAG_BASED_FEEDS_SEGMENT_ID = "ef724293-e9a6-4c7b-a1e0-c398c209afc5";
const LEGACY_TAG_BASED_FEED_IDS = [
  "2f7c754a-52ff-44d1-bdbd-e6ac47b07d75",
  "7804e1f1-f018-4ef8-a656-80e154c0dd86",
  "98e259c2-0a3b-4620-bd1c-9492c9c558dc",
  "a72e8925-645d-4a84-b16b-3e32d88f0da6",
  "8c52fcde-1df5-47b8-bb2e-9896fcac02e4",
  "d7f02dcb-2bc5-49c0-b6f2-4dd6cb7f1e32",
  "046cfd8e-57d2-4c70-b4c1-3ff382f61924",
  "18e2db15-8b71-4c2f-bb6a-e42c53232219",
  "1948e099-ba5f-43fb-96d2-f4dac85a87c1",
  "211b483c-036a-4cdd-a955-f82417efcd34",
  "0763db20-1b5a-429d-a1f3-9199d12e47b4",
  "afd31cfd-62fe-44ac-a76c-10a2f19a999c",
  "011887f7-9783-44e9-bd81-4858f446f7e5",
  "08ed70e2-ee5f-4edd-abed-0148efc0c1bb",
  "fa49d77a-7fbc-4833-bce0-df8e9cfe2b41",
  "6410e2cf-7dcc-4515-b701-7babb235d3ca",
  "b6fabf5c-5ae6-4c58-828f-085c871b43da",
  "1c3a6507-bb7f-4e8b-8618-99086836d5ed",
  "ad80f768-ab50-4753-9096-bf25f01222fd",
  "43e592cd-5f18-4470-b400-a5951c3558d2",
  "ec27fd3c-adbe-4cab-ac9c-0095d19258bf",
  "cb77f208-8e54-43cb-ac7b-23fb9da237d8",
  "b2e9d710-7a31-4b00-b126-c91011bbdbe0",
  "84018df9-5dd0-43fc-a7fc-b02fa621128c",
] as const;

function isUntouchedLegacyTagBasedSegment(segment: FeedSegment) {
  return segment.id === LEGACY_TAG_BASED_FEEDS_SEGMENT_ID
    && segment.library === "logic"
    && segment.name === "TAG BASED FEEDS"
    && segment.collapsed === true
    && segment.hiddenFromHome === false
    && segment.feedIds.length === LEGACY_TAG_BASED_FEED_IDS.length
    && segment.feedIds.every((feedId, index) => feedId === LEGACY_TAG_BASED_FEED_IDS[index]);
}

function retireUntouchedLegacyTagBasedDefaults(feeds: Feed[], segments: FeedSegment[]) {
  const legacyIndex = segments.findIndex((segment) => isUntouchedLegacyTagBasedSegment(segment));
  const unsegmentedIndex = segments.findIndex((segment) => segment.id === UNSEGMENTED_SEGMENT_ID);
  if (legacyIndex < 0 || unsegmentedIndex !== legacyIndex + 1) return { feeds, segments };

  const nextSegments = segments.filter((_, index) => index !== legacyIndex);
  const assignedFeedIds = new Set(nextSegments.flatMap((segment) => segment.feedIds ?? []));
  const nextFeeds = feeds.filter((feed) => !LEGACY_TAG_BASED_FEED_IDS.includes(feed.id as typeof LEGACY_TAG_BASED_FEED_IDS[number]) || assignedFeedIds.has(feed.id));
  return { feeds: nextFeeds, segments: nextSegments };
}

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
  const retired = retireUntouchedLegacyTagBasedDefaults(feeds, segments);
  const curatedFeeds = builtInCuratedFeeds();
  const existingFeedIds = new Set(retired.feeds.map((feed) => feed.id));
  const nextFeeds = [
    ...retired.feeds,
    ...curatedFeeds.filter((feed) => !existingFeedIds.has(feed.id)),
  ];
  const availableFeedIds = new Set(nextFeeds.map((feed) => feed.id));
  const assignedFeedIds = new Set(retired.segments.flatMap((segment) => segment.feedIds ?? []));
  let nextSegments = [...retired.segments];
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
    const feedIds = template.feedIds.filter((feedId) => availableFeedIds.has(feedId) && !assignedFeedIds.has(feedId));
    if (existingIndex >= 0) {
      if (feedIds.length) {
        const existing = nextSegments[existingIndex];
        nextSegments[existingIndex] = { ...existing, feedIds: [...existing.feedIds, ...feedIds] };
        feedIds.forEach((feedId) => assignedFeedIds.add(feedId));
      }
      continue;
    }
    nextSegments.splice(insertionIndex, 0, { ...template, library: "logic", feedIds });
    feedIds.forEach((feedId) => assignedFeedIds.add(feedId));
    insertionIndex += 1;
  }

  return { feeds: nextFeeds, segments: nextSegments };
}
