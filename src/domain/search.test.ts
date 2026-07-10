import { describe, expect, it } from "vitest";
import type { SeriesCatalog } from "./types";
import { matchesSearchWords } from "./search";

const series: SeriesCatalog = {
  id: 1,
  display_title: "Social Beginner",
  cover: null,
  year: null,
  status: null,
  content_rating: "safe",
  total_chapters: null,
  tag_ids: [],
  stats: { popularity: null, favourites: null, meanScore: null },
  analytics: {},
  titles: [{ language: "en", title: "Social Beginner Cat", traits: [], is_primary: false }],
  authors: ["Example Writer"],
  artists: ["Example Artist"],
};

describe("matchesSearchWords", () => {
  it("matches title words in any order across title aliases", () => {
    expect(matchesSearchWords(series, "Cat Social")).toBe(true);
  });

  it("matches creator-name words in any order", () => {
    expect(matchesSearchWords(series, "Writer Example")).toBe(true);
  });
});
