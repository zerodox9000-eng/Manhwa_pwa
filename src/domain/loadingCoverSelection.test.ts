import { describe, expect, it } from "vitest";
import rawFeeds from "./defaultFeeds.generated.json";
import { DEFAULT_SETTINGS } from "./defaults";
import { runFeedQuery } from "./query";
import { selectLoadingCoverTitles } from "./loadingCoverSelection";
import type { Feed, SeriesCatalog, TagNode } from "./types";

const feed = rawFeeds.find(item => item.name.trim() === "TOP 1% TRENDING") as Feed;
const tags: TagNode[] = [
  { id: 4, name: "Girls Love", path: "Girls Love", parent_id: null, level: 1, is_genre: true },
  { id: 180, name: "Hentai", path: "Hentai", parent_id: null, level: 1, is_genre: true },
  { id: 41, name: "Smut", path: "Smut", parent_id: null, level: 1, is_genre: true },
  { id: 10, name: "Boys Love", path: "Boys Love", parent_id: null, level: 1, is_genre: true },
];
function title(id: number, rating = "safe", tagIds: number[] = [], type = "manhwa"): SeriesCatalog {
  return {
    id, display_title: `Title ${id}`, content_rating: rating, tag_ids: tagIds, type,
    cover: "https://example.com/cover.webp", year: 2024, status: "releasing", total_chapters: 30,
    stats: { popularity: 100, favourites: 20, meanScore: 80 },
    analytics: { popularityPercentile: 99.9, fanFavouriteDiscoveryPercentile: 100 - id / 10 },
    source: { anilist: { id } },
  };
}
describe("packaged normal Trending covers", () => {
  it("applies the actual default Trending filters and growth sort even when shipped JSON omits kind", () => {
    expect(feed.kind).toBeUndefined();
    const series = [title(1), title(2, "safe", [4]), title(3, "suggestive", [180]),
      title(4, "safe", [41]), title(5, "safe", [10]), title(6, "erotica"),
      title(7, "pornographic"), title(8, "safe", [], "oel"), title(9, "suggestive")];
    const picked = selectLoadingCoverTitles(feed, series, tags, {}).items;
    expect(picked.map(item => item.id).sort()).toEqual([1, 9]);
    const actual = runFeedQuery({ feed: { ...feed, kind: "logic" }, series, tags,
      history: {}, labels: [], settings: DEFAULT_SETTINGS });
    expect(picked).toEqual(actual.items.slice(0, 50));
  });
  it("keeps only the top 50 results of the shipped feed query", () => {
    const series = Array.from({ length: 51 }, (_, index) => title(index + 1));
    const result = selectLoadingCoverTitles(feed, series, tags, {});
    const actual = runFeedQuery({ feed: { ...feed, kind: "logic" }, series, tags,
      history: {}, labels: [], settings: DEFAULT_SETTINGS });
    expect(result.feedCount).toBe(51);
    expect(result.items.map(item => item.id)).toEqual(actual.items.slice(0, 50).map(item => item.id));
  });
  it("fails closed rather than packaging a selected entry with an unknown rating", () => {
    const unknown = { ...title(1), content_rating: null };
    expect(() => selectLoadingCoverTitles(feed, [unknown], tags, {}))
      .toThrow("Unsafe loading cover");
  });
});
