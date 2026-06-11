import { describe, expect, it } from "vitest";
import { rankRecommendations } from "./recommendations";
import type { RecommendationFeature, SeriesCatalog, TagNode } from "./types";

function series(id: number, title: string): SeriesCatalog {
  return {
    id,
    display_title: title,
    cover: null,
    year: 2024,
    status: "releasing",
    content_rating: "safe",
    total_chapters: "40",
    tag_ids: [],
    stats: { popularity: 5000, favourites: 200, meanScore: 75 },
    analytics: { fanFavouriteDiscoveryPercentile: 80, fanFavouriteRaw: 4 },
    published: { start_date: "2024-01-01", end_date: null },
  };
}

function taggedSeries(id: number, title: string, tagIds: number[], discPct = 80): SeriesCatalog {
  return {
    ...series(id, title),
    tag_ids: tagIds,
    analytics: { fanFavouriteDiscoveryPercentile: discPct, fanFavouriteRaw: 4 },
  };
}

function tag(id: number, name: string, path: string, options: Partial<TagNode> = {}): TagNode {
  return {
    id,
    name,
    path,
    is_genre: false,
    parent_id: null,
    level: path.split(" > ").length,
    ...options,
  };
}

function feature(
  id: number,
  profileGroups: string[],
  textFeatures: Record<string, number>,
  discPct = 80,
): RecommendationFeature {
  return {
    id,
    profileGroups,
    primaryAnchors: profileGroups.filter((group) =>
      [
        "business-career-regression",
        "corporate-workplace",
        "korean-business",
        "office-romance",
        "game-system",
        "murim-wuxia",
      ].includes(group),
    ),
    tagFeatures: Object.fromEntries(profileGroups.map((group) => [`profile:${group}`, 1])),
    textFeatures,
    quality: {
      discPct,
      fanPct: 4,
      popularity: 5000,
    },
  };
}

const shelf = {
  id: "similar-loved",
  name: "Most loved matches",
  statusMode: "any" as const,
  dateMode: "any" as const,
  sourceModes: ["anilist" as const],
  sort: [{ id: "disc", metric: "fanFavouriteDiscoveryPercentile" as const, direction: "desc" as const }],
  metricRanges: [],
};

const titles = [
  series(189, "Reborn Rich"),
  series(45119, "A Man's Man"),
  series(67834, "Sinip Sawon Kim Cheolsu"),
  series(49377, "Return of the Mad Demon"),
  series(1451, "SSS-Class Revival Hunter"),
  series(41002, "Positively Yours"),
  series(3671, "Daytime Star"),
];

const features = [
  feature(
    189,
    ["business-career-regression", "corporate-workplace", "korean-business", "business-career", "regression-return", "modern-workplace", "modern-korea"],
    { corporate: 3, business: 2, conglomerate: 3, betrayal: 2, revenge: 2, employee: 2, takeover: 3, regression: 2 },
    89,
  ),
  feature(
    45119,
    ["business-career-regression", "corporate-workplace", "korean-business", "business-career", "regression-return", "modern-workplace", "modern-korea", "sports-career"],
    { company: 3, ceo: 3, career: 3, employee: 2, corporate: 2, workplace: 2, regression: 2, past: 2 },
    95,
  ),
  feature(
    67834,
    ["business-career-regression", "corporate-workplace", "korean-business", "business-career", "regression-return", "modern-workplace", "modern-korea"],
    { company: 3, employee: 3, trading: 2, ceo: 3, career: 3, success: 2, regression: 2, workplace: 2 },
    47,
  ),
  feature(
    49377,
    ["murim-wuxia", "regression-return"],
    { murim: 3, martial: 3, sect: 2, sword: 2, revenge: 1, regression: 1 },
    99,
  ),
  feature(
    1451,
    ["game-system", "regression-return"],
    { dungeon: 3, hunter: 3, level: 2, tower: 2, game: 2, regression: 1 },
    100,
  ),
  feature(
    41002,
    ["office-romance", "romance-core", "modern-workplace", "modern-korea"],
    { romance: 3, pregnancy: 3, ceo: 1, workplace: 1, dating: 2, marriage: 2 },
    96,
  ),
  feature(
    3671,
    ["office-romance", "romance-core", "modern-workplace", "showbiz-career", "modern-korea"],
    { romance: 3, celebrity: 2, office: 1, love: 2, dating: 2 },
    98,
  ),
];

function rankedIds(baseId: number) {
  const base = titles.find((item) => item.id === baseId)!;
  return rankRecommendations({
    base,
    candidates: titles.filter((item) => item.id !== baseId),
    tags: [],
    features,
    shelf,
    history: {},
    latestDate: null,
  }).map((item) => item.id);
}

function expectPreferredOver(ranked: number[], preferred: number, bad: number) {
  const preferredIndex = ranked.indexOf(preferred);
  const badIndex = ranked.indexOf(bad);
  expect(preferredIndex).toBeGreaterThanOrEqual(0);
  if (badIndex >= 0) expect(preferredIndex).toBeLessThan(badIndex);
}

describe("rankRecommendations", () => {
  it("keeps the business career regression golden cluster at the top", () => {
    for (const baseId of [189, 45119, 67834]) {
      const ranked = rankedIds(baseId);
      const cluster = [189, 45119, 67834].filter((id) => id !== baseId);
      for (const expectedId of cluster) {
        expect(ranked.indexOf(expectedId)).toBeGreaterThanOrEqual(0);
        expect(ranked.indexOf(expectedId)).toBeLessThan(5);
      }
    }
  });

  it("does not let high quality murim, game, or pure romance titles outrank the business cluster", () => {
    const ranked = rankedIds(189);
    expectPreferredOver(ranked, 45119, 49377);
    expectPreferredOver(ranked, 67834, 1451);
    expectPreferredOver(ranked, 45119, 41002);
  });

  it("uses dominant game-system context instead of incidental romance or sword tags", () => {
    const localTags = [
      tag(1, "Dungeon", "Settings > Dungeon"),
      tag(2, "Level System", "Settings > Level System"),
      tag(3, "Romance", "Genres > Romance", { is_genre: true }),
      tag(4, "Office Worker", "Occupations > Office Worker"),
      tag(5, "Martial Arts", "Activities > Martial Arts"),
      tag(6, "Cultivation", "Settings > Cultivation"),
      tag(7, "Hunter", "Character Types > Hunter"),
    ];
    const localTitles = [
      taggedSeries(100, "Solo Leveling", [1, 2, 3], 100),
      taggedSeries(101, "Solo Leveling: Ragnarok", [1, 2, 7], 92),
      taggedSeries(102, "Executive Office Romance", [3, 4], 100),
      taggedSeries(103, "Martial God Returns", [5, 6], 100),
    ];
    const localFeatures = [
      feature(100, ["game-system", "romance-core", "murim-wuxia", "business-career"], { dungeon: 3, hunter: 2, level: 3, romance: 2 }, 100),
      feature(101, ["game-system"], { dungeon: 3, hunter: 3, level: 2 }, 92),
      feature(102, ["office-romance", "romance-core", "modern-workplace"], { romance: 3, office: 2, dating: 2 }, 100),
      feature(103, ["murim-wuxia"], { murim: 3, martial: 3, cultivation: 3 }, 100),
    ];
    const ranked = rankRecommendations({
      base: localTitles[0],
      candidates: localTitles.slice(1),
      tags: localTags,
      features: localFeatures,
      shelf,
      history: {},
      latestDate: null,
    }).map((item) => item.id);

    expect(ranked[0]).toBe(101);
    expect(ranked).not.toContain(102);
    expect(ranked).not.toContain(103);
  });

  it("keeps the modern Korean business-regression cluster ahead of fantasy, murim, and CEO-romance noise", () => {
    const localTags = [
      tag(1, "Economics", "Themes > Economics"),
      tag(2, "Working", "Activities > Working"),
      tag(3, "Company", "Locations > Company"),
      tag(4, "CEOs", "Occupations > CEOs"),
      tag(5, "Office Worker", "Occupations > Office Worker"),
      tag(6, "South Korea", "Locations > Asia > South Korea"),
      tag(7, "Time Rewind", "Narrative Tropes > Time Manipulation > Time Rewind"),
      tag(8, "Time Travel", "Narrative Tropes > Time Manipulation > Time Travel"),
      tag(9, "Based on a Novel", "Derivative Work > Based On > Based on Literature > Based on a Novel"),
      tag(10, "Seinen", "Audience Demographics > Male Oriented > Seinen"),
      tag(11, "Fantasy", "Genres > Fantasy", { is_genre: true }),
      tag(12, "Dungeon", "Settings > Dungeon"),
      tag(13, "Level System", "Settings > Level System"),
      tag(14, "Martial Arts", "Activities > Martial Arts"),
      tag(15, "Murim", "Settings > Murim"),
      tag(16, "Romance", "Genres > Romance", { is_genre: true }),
    ];
    const localTitles = [
      taggedSeries(201, "Reborn Rich", [1, 2, 6, 7, 8, 9, 10], 89),
      taggedSeries(202, "A Man's Man", [1, 2, 3, 4, 5, 6, 7, 9, 10], 95),
      taggedSeries(203, "Sinip Sawon Kim Cheolsu", [1, 2, 3, 5, 6, 7, 9, 10], 47),
      taggedSeries(204, "Fantasy Tower Returner", [11, 12, 13, 7], 100),
      taggedSeries(205, "Return of the Martial God", [14, 15, 7], 100),
      taggedSeries(206, "CEO Contract Romance", [4, 5, 16], 100),
    ];
    const localFeatures = [
      feature(201, ["business-career-regression", "corporate-workplace", "korean-business", "romance-core", "game-system"], { corporate: 3, business: 2, revenge: 2, regression: 2 }, 89),
      feature(202, ["business-career-regression", "corporate-workplace", "korean-business", "sports-career"], { company: 3, ceo: 3, career: 3, regression: 2 }, 95),
      feature(203, ["business-career-regression", "corporate-workplace", "korean-business"], { company: 3, employee: 3, trading: 2, regression: 2 }, 47),
      feature(204, ["game-system", "regression-return"], { dungeon: 3, tower: 3, level: 2 }, 100),
      feature(205, ["murim-wuxia", "regression-return"], { murim: 3, martial: 3, sect: 2 }, 100),
      feature(206, ["office-romance", "romance-core", "modern-workplace"], { romance: 3, ceo: 2, contract: 2 }, 100),
    ];
    const ranked = rankRecommendations({
      base: localTitles[0],
      candidates: localTitles.slice(1),
      tags: localTags,
      features: localFeatures,
      shelf,
      history: {},
      latestDate: null,
    }).map((item) => item.id);

    expect(ranked.slice(0, 2).sort()).toEqual([202, 203]);
    expect(ranked).not.toContain(204);
    expect(ranked).not.toContain(205);
    expect(ranked).not.toContain(206);
  });
});
