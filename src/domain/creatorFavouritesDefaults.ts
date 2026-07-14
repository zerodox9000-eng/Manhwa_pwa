import creatorFavouritesJson from "./defaultCreatorFavouritesSegment.generated.json";
import type { Feed, FeedSegment } from "./types";

interface CreatorFavouritesSource {
  feeds: Feed[];
  feedSegments: FeedSegment[];
}

const source = creatorFavouritesJson as unknown as CreatorFavouritesSource;
const creatorFavouriteFeedId = "d5593838-86b2-4c0b-a18b-87ec70ed2749";
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

export function mergeBuiltInCreatorFavourites(feeds: Feed[], segments: FeedSegment[]) {
  const canonicalFeeds = normalizeBuiltInCreatorFavouriteMetadata(feeds);
  const feedIds = new Set(canonicalFeeds.map((feed) => feed.id));
  const segmentIds = new Set(segments.map((segment) => segment.id));
  return {
    feeds: [...canonicalFeeds, ...builtInCreatorFavouriteFeeds().filter((feed) => !feedIds.has(feed.id))],
    segments: [...segments, ...builtInCreatorFavouriteSegments().filter((segment) => !segmentIds.has(segment.id))],
  };
}
