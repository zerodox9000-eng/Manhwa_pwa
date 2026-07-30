import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";

const LONG_DETAIL_TITLE = "The Hero Who Returned From Another World With an Extremely Long Title That Must Stay Completely Visible";
const LONG_DETAIL_AUTHORS = ["Alexandria Verylongcreatorname", "Bartholomew Anotherlongcreatorname"];
const LONG_DETAIL_ARTISTS = ["Chrysanthemum Thirdcreatorname"];
const MANY_DETAIL_CREATORS = ["Alexandria Verylongcreatorname", "Bartholomew Anotherlongcreatorname", "Chrysanthemum Thirdcreatorname", "Demetrius Fourthcreatorname", "Evangeline Fifthcreatorname"];

async function mockBackendData(page: Page) {
  const gzipJson = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value)));
  const detailAttempts = new Map<number, number>();
  const catalog = [
    {
      id: 1252,
      display_title: "Solo Leveling: Ragnarok",
      cover: null,
      year: 2024,
      status: "hiatus",
      content_rating: "safe",
      total_chapters: "68",
      tag_ids: [1, 2],
      stats: { popularity: 30298, favourites: 1147, meanScore: 76 },
      analytics: {
        fanFavouriteRaw: 3.7857,
        fanRatioPercentile: 92.0655,
        popularityPercentile: 99.744,
        fanFavouriteDiscoveryScore: 91.9459,
        fanFavouriteDiscoveryPercentile: 95.9668,
      },
      published: { start_date: "2024-07-31", end_date: null },
      last_updated_at: "2026-05-24T02:31:20.226Z",
      authors: ["Daul", "Do Dang"],
      artists: ["JIN", "REDICE"],
      links: { mangabaka: "https://mangabaka.org/1252" },
      source: { anilist: { id: 179445, rating: 76, url: "https://anilist.co/manga/179445" } },
    },
    {
      id: 4,
      display_title: "High School Boy",
      cover: null,
      year: 2023,
      status: "releasing",
      content_rating: "suggestive",
      total_chapters: "102",
      tag_ids: [1, 2],
      stats: { popularity: 999, favourites: 35, meanScore: 69 },
      analytics: { fanFavouriteRaw: 3.5035, fanFavouriteDiscoveryScore: 89.7064 },
      published: { start_date: "2023-12-24", end_date: null },
      last_updated_at: "2026-05-23T16:34:11.462Z",
      authors: ["Bakji"],
      artists: ["Bakji"],
      links: { mangabaka: "https://mangabaka.org/4" },
      source: { anilist: { id: 179451, rating: 69, url: "https://anilist.co/manga/179451" } },
    },
    {
      id: 999,
      display_title: LONG_DETAIL_TITLE,
      cover: null,
      year: 2026,
      status: "releasing",
      content_rating: "safe",
      total_chapters: "123",
      tag_ids: [1, 2],
      stats: { popularity: 123456789, favourites: 987654, meanScore: 88 },
      analytics: { fanFavouriteRaw: 3.9, fanFavouriteDiscoveryScore: 97 },
      published: { start_date: "2026-01-01", end_date: null },
      last_updated_at: "2026-07-30T00:00:00.000Z",
      authors: LONG_DETAIL_AUTHORS,
      artists: LONG_DETAIL_ARTISTS,
      links: {},
      source: { anilist: { id: 999, rating: 88, url: "https://anilist.co/manga/999" } },
    },
    {
      id: 998,
      display_title: "Short Title",
      cover: null,
      year: 2026,
      status: "releasing",
      content_rating: "safe",
      total_chapters: "12",
      tag_ids: [1, 2],
      stats: { popularity: 998, favourites: 42, meanScore: 82 },
      analytics: { fanFavouriteRaw: 3.7, fanFavouriteDiscoveryScore: 91 },
      published: { start_date: "2026-01-01", end_date: null },
      last_updated_at: "2026-07-30T00:00:00.000Z",
      authors: MANY_DETAIL_CREATORS,
      artists: [],
      links: {},
      source: { anilist: { id: 998, rating: 82, url: "https://anilist.co/manga/998" } },
    },
  ];
  await page.route("**/data/query-index.json.gz", async (route) => {
    await route.fulfill({
      status: 200,
      body: gzipJson(catalog),
      headers: { "content-type": "application/gzip" },
    });
  });
  await page.route("**/series/all.json.gz", async (route) => {
    await route.fulfill({
      status: 200,
      body: gzipJson(catalog),
      headers: { "content-type": "application/gzip" },
    });
  });
  await page.route("**/details/*.json", async (route) => {
    const id = Number(route.request().url().match(/details\/(\d+)\.json/)?.[1]);
    const item = catalog.find((series) => series.id === id);
    const attempt = (detailAttempts.get(id) ?? 0) + 1;
    detailAttempts.set(id, attempt);
    const description = id === 1252 && attempt === 1 ? null : "QA detail description.";
    await route.fulfill({
      status: item ? 200 : 404,
      json: item ? { ...item, description } : { error: "missing" },
    });
  });
  await page.route("**/meta/tags.json.gz", async (route) => {
    await route.fulfill({
      status: 200,
      body: gzipJson({
        "1": { id: 1, name: "Action", path: "Genres > Action", is_genre: true, parent_id: null, level: 1 },
        "2": { id: 2, name: "Fantasy", path: "Genres > Fantasy", is_genre: true, parent_id: null, level: 1 },
        "3": { id: 3, name: "Hentai", path: "Genres > Hentai", is_genre: true, parent_id: null, level: 1 },
      }),
      headers: { "content-type": "application/gzip" },
    });
  });
  await page.route("**/stats/history.json.gz", async (route) => {
    await route.fulfill({
      status: 200,
      body: gzipJson({
        "1252": [
          { d: "2026-05-01", p: 29000, f: 1000, s: 75, r: 3.44, rp: 80, pp: 98, ds: 86, dp: 92 },
          { d: "2026-06-01", p: 30200, f: 1130, s: 76, r: 3.74, rp: 92, pp: 99, ds: 91, dp: 95 },
        ],
        "4": [
          { d: "2026-05-01", p: 900, f: 30, s: 68, r: 3.33, rp: 40, pp: 60, ds: 70, dp: 55 },
        ],
      }),
      headers: { "content-type": "application/gzip" },
    });
  });
  await page.route("**/recommendations/features.json.gz", async (route) => {
    await route.fulfill({
      status: 200,
      body: gzipJson([
        {
          id: 1252,
          profileGroups: ["game-system"],
          primaryAnchors: ["game-system"],
          tagFeatures: { "tag:1": 1, "tag:2": 1 },
          textFeatures: { solo: 1, leveling: 1, ragnarok: 1 },
          quality: { discPct: 95.9668, fanPct: 3.7857, popularity: 30298 },
        },
        {
          id: 4,
          profileGroups: ["game-system"],
          primaryAnchors: ["game-system"],
          tagFeatures: { "tag:1": 1, "tag:2": 1 },
          textFeatures: { high: 1, school: 1, boy: 1 },
          quality: { discPct: 55, fanPct: 3.5035, popularity: 999 },
        },
      ]),
      headers: { "content-type": "application/gzip" },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockBackendData(page);
  await page.addInitScript(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("manhwa-library");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
});

test("detail identity keeps its spacing while fitting full long text", async ({ page }) => {
  const creatorLine = [...LONG_DETAIL_AUTHORS, ...LONG_DETAIL_ARTISTS].join(" / ");
  const noHorizontalOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/#/title/999?shared=1");
  await expect(page.locator(".detail-title-copy")).toHaveText(LONG_DETAIL_TITLE);
  await expect(page.locator(".detail-creators")).toHaveText(creatorLine);
  await expect(page.locator(".detail-copy-fitted")).toHaveClass(/is-title-fitted/);

  const compactLayout = await page.evaluate(() => {
    const identity = document.querySelector<HTMLElement>(".detail-identity")!;
    const cover = document.querySelector<HTMLElement>(".detail-cover")!;
    const copy = document.querySelector<HTMLElement>(".detail-copy-fitted")!;
    const content = document.querySelector<HTMLElement>(".detail-copy-inner")!;
    const title = document.querySelector<HTMLElement>(".detail-title")!;
    const creators = document.querySelector<HTMLElement>(".detail-creators")!;
    const meta = document.querySelector<HTMLElement>(".detail-meta-strip")!;
    const statusValue = document.querySelectorAll<HTMLElement>(".detail-meta-chip strong")[1];
    const copyBox = copy.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    const metaBox = meta.getBoundingClientRect();
    const titleStyle = getComputedStyle(title);
    const copyStyle = getComputedStyle(copy);
    const topInset = Number.parseFloat(copyStyle.paddingTop);
    const bottomInset = Number.parseFloat(copyStyle.paddingBottom);
    return {
      fixedCoverWidth: Math.abs(cover.getBoundingClientRect().width - 116) <= 1,
      originalGap: Math.abs(Number.parseFloat(getComputedStyle(identity).columnGap) - 14) <= 0.5,
      copyMatchesCoverHeight: Math.abs(copyBox.height - cover.getBoundingClientRect().height) <= 1,
      fullContentInsideCopy: contentBox.top >= copyBox.top + topInset - 1 && contentBox.bottom <= copyBox.bottom - bottomInset + 1,
      metaInsideCopy: metaBox.left >= copyBox.left - 1 && metaBox.right <= copyBox.right + 1,
      naturalTitleWrap: titleStyle.textWrap !== "balance" && titleStyle.webkitLineClamp === "none",
      titleWasReduced: Number.parseFloat(titleStyle.fontSize) < 24,
      creatorsVisible: creators.scrollHeight <= creators.clientHeight + 1 && creators.scrollWidth <= creators.clientWidth + 1,
      statusVisible: statusValue.scrollWidth <= statusValue.clientWidth + 1 && getComputedStyle(statusValue).textOverflow !== "ellipsis",
    };
  });
  expect(compactLayout).toEqual({
    fixedCoverWidth: true,
    originalGap: true,
    copyMatchesCoverHeight: true,
    fullContentInsideCopy: true,
    metaInsideCopy: true,
    naturalTitleWrap: true,
    titleWasReduced: true,
    creatorsVisible: true,
    statusVisible: true,
  });
  expect(await noHorizontalOverflow()).toBe(true);

  await page.setViewportSize({ width: 1024, height: 900 });
  await expect.poll(() => page.evaluate(() => {
    const copy = document.querySelector<HTMLElement>(".detail-copy-fitted")!.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>(".detail-copy-inner")!.getBoundingClientRect();
    return content.top >= copy.top - 1 && content.bottom <= copy.bottom + 1;
  })).toBe(true);

  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/#/title/998?shared=1");
  await expect(page.locator(".detail-creators")).toHaveText(MANY_DETAIL_CREATORS.join(" / "));
  await expect(page.locator(".detail-copy-fitted")).toHaveClass(/is-creators-fitted/);
  await expect(page.locator(".detail-copy-fitted")).not.toHaveClass(/is-title-fitted/);
  expect(await page.locator(".detail-title").evaluate((title) => Math.abs(Number.parseFloat(getComputedStyle(title).fontSize) - 24) <= 0.5)).toBe(true);

  await page.goto("/#/title/1252?shared=1");
  await expect(page.locator(".detail-title-copy")).toHaveText("Solo Leveling: Ragnarok");
  await expect(page.locator(".detail-copy-fitted")).not.toHaveClass(/is-title-fitted|is-creators-fitted/);
  expect(await page.evaluate(() => {
    const identity = document.querySelector<HTMLElement>(".detail-identity")!;
    const meta = document.querySelector<HTMLElement>(".detail-meta-strip")!;
    const copy = document.querySelector<HTMLElement>(".detail-copy-fitted")!;
    return Math.abs(Number.parseFloat(getComputedStyle(identity).columnGap) - 14) <= 0.5
      && meta.getBoundingClientRect().width < copy.getBoundingClientRect().width;
  })).toBe(true);
});

test("mobile feeds, search, detail, recommendations, and navigation state work", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Trending Mainstream" })).toBeVisible();
  await expect(page.getByTestId("title-card").first()).toBeVisible();
  await expect(page.locator(".compact-metrics").first()).toContainText("Fan Rank");
  await expect(page.locator(".bottom-nav")).not.toContainText("Folders");

  await page.getByRole("link", { name: "Search" }).click();
  const searchInput = page.getByPlaceholder("Search titles");
  await searchInput.fill("Solo Leveling");
  await expect(searchInput).toBeFocused();
  await expect(page.getByTestId("title-card").first()).toBeVisible();
  await searchInput.press("Enter");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page.getByPlaceholder("Search titles")).toHaveValue("Solo Leveling");
  await page.getByPlaceholder("Search titles").fill("");
  await expect(page.getByRole("button", { name: "Solo Leveling" })).toBeVisible();
  await page.getByRole("button", { name: "Solo Leveling" }).click();
  await page.getByTestId("title-card").first().click();
  await expect(page.getByRole("heading", { name: "Solo Leveling: Ragnarok" })).toBeVisible();
  await expect(page.locator(".detail-stat-grid")).toContainText("30,298");
  await page.getByRole("button", { name: "Detail settings" }).click();
  await expect(page.getByText("Show the full available synopsis.")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("QA detail description.")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByPlaceholder("Search titles")).toHaveValue("Solo Leveling");

  await page.getByRole("link", { name: "Recs" }).click();
  await page.getByLabel("Base title").fill("Solo");
  await page.locator(".recommendation-pick").first().click();
  await expect(page.getByText("Most loved matches")).toBeVisible();
  await expect(page.getByTestId("title-card").first()).toBeVisible();

  await page.getByRole("link", { name: "Feeds" }).click();
  await expect(page.locator(".feed-cover-card").first()).toBeVisible();
  await expect(page.locator(".mosaic-cover").first()).toHaveCSS("aspect-ratio", "0.72 / 1");
});
