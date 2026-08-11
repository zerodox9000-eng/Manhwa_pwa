import creatorFavouritesJson from "./defaultCreatorFavouritesSegment.generated.json";
import type { Feed, FeedSegment } from "./types";

interface CreatorFavouritesSource {
  feeds: Feed[];
  feedSegments: FeedSegment[];
}

const source = creatorFavouritesJson as unknown as CreatorFavouritesSource;
const creatorFavouriteFeedId = "d5593838-86b2-4c0b-a18b-87ec70ed2749";
const creatorFavouriteSegmentId = "f8e12682-7de3-43c4-b1b4-ea093e060671";
const creatorFavouriteSegmentName = "CREATOR FAVOURITES";
const oldDescriptions = new Set(["Sorted by Personal Ratings"]);

export function builtInCreatorFavouriteFeeds() {
  return source.feeds;
}

export function builtInCreatorFavouriteSegments() {
  return source.feedSegments;
}

export function normalizeBuiltInCreatorFavouriteMetadata(feeds: Feed[]) {
  return feeds.map((feed) => feed.id === creatorFavouriteFeedId && oldDescriptions.has(feed.description.trim())
    ? { ...feed, description: "Sorted by the Creator's Ratings" }
    : feed);
}

function hideUntouchedVisibleCreatorFavouriteSegment(segment: FeedSegment) {
  const isUntouchedVisibleDefault = segment.id === creatorFavouriteSegmentId
    && segment.library === "custom"
    && segment.name === creatorFavouriteSegmentName
    && segment.collapsed
    && !segment.hiddenFromHome
    && segment.feedIds.length === 1
    && segment.feedIds[0] === creatorFavouriteFeedId;
  return isUntouchedVisibleDefault ? { ...segment, hiddenFromHome: true } : segment;
}

export function mergeBuiltInCreatorFavourites(feeds: Feed[], segments: FeedSegment[]) {
  const canonicalFeeds = normalizeBuiltInCreatorFavouriteMetadata(feeds);
  const feedIds = new Set(canonicalFeeds.map((feed) => feed.id));
  const segmentIds = new Set(segments.map((segment) => segment.id));
  const canonicalSegments = segments.map(hideUntouchedVisibleCreatorFavouriteSegment);
  return {
    feeds: [...canonicalFeeds, ...builtInCreatorFavouriteFeeds().filter((feed) => !feedIds.has(feed.id))],
    segments: [...canonicalSegments, ...builtInCreatorFavouriteSegments().filter((segment) => !segmentIds.has(segment.id))],
  };
}
