import { describe, expect, it } from "vitest";
import {
  builtInCreatorFavouriteFeeds,
  builtInCreatorFavouriteSegments,
  mergeBuiltInCreatorFavourites,
  normalizeBuiltInCreatorFavouriteMetadata,
} from "./creatorFavouritesDefaults";

describe("built-in creator favourites", () => {
  it("ships as a hidden MY LIST segment with fixed custom membership", () => {
    const [feed] = builtInCreatorFavouriteFeeds();
    const [segment] = builtInCreatorFavouriteSegments();

    expect(feed).toMatchObject({ kind: "custom", name: "MY FAVOURITES", orderMode: "manual" });
    expect(feed.titleIds).toHaveLength(69);
    expect(segment).toMatchObject({
      library: "custom",
      name: "CREATOR FAVOURITES",
      hiddenFromHome: true,
      feedIds: [feed.id],
    });
  });

  it("adds the package once without replacing an existing copy", () => {
    const first = mergeBuiltInCreatorFavourites([], []);
    const savedFeed = { ...first.feeds[0], name: "My renamed favourites", description: "My own description" };
    const savedSegment = { ...first.segments[0], collapsed: false };
    const second = mergeBuiltInCreatorFavourites([savedFeed], [savedSegment]);

    expect(second.feeds).toEqual([savedFeed]);
    expect(second.segments).toEqual([savedSegment]);
  });

  it("hides an untouched visible copy during the default migration", () => {
    const [feed] = builtInCreatorFavouriteFeeds();
    const [segment] = builtInCreatorFavouriteSegments();
    const migrated = mergeBuiltInCreatorFavourites([feed], [{ ...segment, hiddenFromHome: false }]);

    expect(migrated.segments[0]).toMatchObject({
      id: segment.id,
      hiddenFromHome: true,
    });
  });

  it("preserves customized creator segment visibility", () => {
    const [feed] = builtInCreatorFavouriteFeeds();
    const [segment] = builtInCreatorFavouriteSegments();
    const customized = { ...segment, name: "My favourites", hiddenFromHome: false };
    const merged = mergeBuiltInCreatorFavourites([feed], [customized]);

    expect(merged.segments).toEqual([customized]);
  });

  it("updates only the old supplied description without replacing saved settings", () => {
    const [feed] = builtInCreatorFavouriteFeeds();
    const saved = { ...feed, description: "Sorted by Personal Ratings ", newTitlePlacement: "top" as const };

    expect(normalizeBuiltInCreatorFavouriteMetadata([saved])[0]).toMatchObject({
      description: "Sorted by the Creator's Ratings",
      newTitlePlacement: "top",
      titleIds: feed.titleIds,
    });
  });
});
