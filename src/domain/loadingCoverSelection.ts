import { DEFAULT_SETTINGS } from "./defaults";
import { runFeedQuery } from "./query";
import type { Feed, HistoryMap, SeriesCatalog, TagNode } from "./types";

export const LOADING_COVER_COUNT = 50;

export function selectLoadingCoverTitles(feed: Feed, series: SeriesCatalog[], tags: TagNode[], history: HistoryMap, latestHistoryDate?: string | null) {
  // Shipped JSON predates Feed.kind. The app normalizes Trending feeds as logic feeds.
  // Raw JSON must never bypass rating, source, or excluded-tag filters here.
  const result = runFeedQuery({
    feed: { ...feed, kind: "logic" }, series, tags, history, labels: [], settings: DEFAULT_SETTINGS,
    metaHistoryLast: latestHistoryDate,
  });
  const items = result.items.slice(0, LOADING_COVER_COUNT);
  for (const item of items) {
    if (!["safe", "suggestive"].includes(item.content_rating ?? "")
      || item.tag_ids.some(id => feed.filters.excludeTagIds.includes(id))) {
      throw new Error(`Unsafe loading cover in ${feed.name}: ${item.id} ${item.display_title}`);
    }
  }
  return { items, feedCount: result.items.length };
}
