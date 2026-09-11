import { describe, expect, it } from "vitest";
import { readingPlatformName } from "./readingPlatforms";

describe("readingPlatformName", () => {
  it("uses friendly names for the previously raw hostnames", () => {
    expect(readingPlatformName("https://global.toptoon.com/content/123")).toBe("TOPTOON");
    expect(readingPlatformName("https://comikey.com/comics/id/123")).toBe("Comikey");
    expect(readingPlatformName("https://www.lalatoon.com/en/webtoon/123")).toBe("LaLatoon");
    expect(readingPlatformName("https://global.lalatoon.com/en/webtoon/123")).toBe("LaLatoon");
  });

  it("keeps existing friendly names and supports www aliases", () => {
    expect(readingPlatformName("https://www.tappytoon.com/en/comic/123")).toBe("Tappytoon");
    expect(readingPlatformName("https://www.toptoon.com/content/123")).toBe("TOPTOON");
    expect(readingPlatformName("https://global.toomics.com/en/webtoon/123")).toBe("Toomics");
    expect(readingPlatformName("https://www.toomics.net/en/webtoon/123")).toBe("Toomics");
  });

  it("returns a readable fallback only when no mapping exists", () => {
    expect(readingPlatformName("https://unknown.example/path")).toBe("unknown.example");
    expect(readingPlatformName("not a url")).toBe("Official English");
  });
});
