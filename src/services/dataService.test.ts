import { describe, expect, it } from "vitest";
import { CATALOG_NORMALIZATION_VERSION, detailSourceCandidates, needsCatalogNormalizationRepair } from "./dataService";

describe("detailSourceCandidates", () => {
  it("keeps the preferred detail source first and falls back to configured sources", () => {
    const sources = detailSourceCandidates("https://preferred.example/frontend");

    expect(sources[0]).toBe("https://preferred.example/frontend");
    expect(sources).toContain("https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend");
  });

  it("does not retry the same detail source twice", () => {
    const sources = detailSourceCandidates("https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend");

    expect(sources.filter((source) => source.includes("raw.githubusercontent.com"))).toHaveLength(1);
  });
});

describe("catalog normalization repair", () => {
  it("repairs only caches from before the current normalization rule", () => {
    expect(needsCatalogNormalizationRepair(null)).toBe(true);
    expect(needsCatalogNormalizationRepair({ catalogNormalizationVersion: CATALOG_NORMALIZATION_VERSION - 1 })).toBe(true);
    expect(needsCatalogNormalizationRepair({ catalogNormalizationVersion: CATALOG_NORMALIZATION_VERSION })).toBe(false);
  });
});
