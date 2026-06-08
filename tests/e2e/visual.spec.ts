import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";

async function mockBackendData(page: Page) {
  const gzipJson = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value)));
  const catalog = [
    {
      id: 1252,
      display_title: "Solo Leveling: Ragnarok",
      cover: null,
      year: 2024,
      status: "releasing",
      content_rating: "safe",
      total_chapters: "68",
      tag_ids: [1, 2],
      stats: { popularity: 30298, favourites: 1147, meanScore: 76 },
      analytics: {
        fanFavouriteRaw: 3.7857,
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
      tag_ids: [1],
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
      id: 77,
      display_title: "No AniList Gem",
      cover: null,
      year: 2026,
      status: "completed",
      content_rating: "safe",
      total_chapters: "24",
      tag_ids: [1, 2],
      stats: { popularity: null, favourites: null, meanScore: null },
      analytics: {},
      published: { start_date: "2026-05-08", end_date: "2026-06-01", start_date_is_estimated: true },
      links: { mangabaka: "https://mangabaka.org/77" },
      source: { mangaupdates: { id: "mu77", url: "https://www.mangaupdates.com/series/mu77" } },
    },
  ];

  await page.route("**/data/query-index.json.gz", async (route) => {
    await route.fulfill({ status: 200, body: gzipJson(catalog), headers: { "content-type": "application/gzip" } });
  });
  await page.route("**/series/all.json.gz", async (route) => {
    await route.fulfill({ status: 200, body: gzipJson(catalog), headers: { "content-type": "application/gzip" } });
  });
  await page.route("**/details/*.json", async (route) => {
    const id = Number(route.request().url().match(/details\/(\d+)\.json/)?.[1]);
    const item = catalog.find((series) => series.id === id);
    await route.fulfill({
      status: item ? 200 : 404,
      json: item
        ? { ...item, description: "QA detail description with enough length to validate spacing and wrapping on the mobile detail page." }
        : { error: "missing" },
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
        "1252": [{ d: "2026-05-01", p: 29000, f: 1000, s: 75, r: 3.44, rp: 80, pp: 98, ds: 86, dp: 92 }],
        "4": [{ d: "2026-05-01", p: 900, f: 30, s: 68, r: 3.33, rp: 40, pp: 60, ds: 70, dp: 55 }],
        "77": [{ d: "2026-06-01", p: 0, f: 0, s: null, r: 0, rp: 0, pp: 0, ds: 0, dp: 0 }],
      }),
      headers: { "content-type": "application/gzip" },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockBackendData(page);
  await page.addInitScript(() => {
    localStorage.clear();
    indexedDB.deleteDatabase("manhwa-library");
  });
});

for (const viewport of [
  { name: "mobile", width: 393, height: 852 },
  { name: "desktop", width: 1280, height: 900 },
] as const) {
  test(`${viewport.name} visual smoke has no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await page.waitForSelector("[data-testid='title-card']");
    await expect(page.locator("body")).not.toContainText("Folders");
    await expect(page.locator(".compact-metrics").first()).toContainText("Fan%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/visual/${viewport.name}-home.png`, fullPage: true });

    await page.getByRole("link", { name: "Feeds" }).click();
    await expect(page.locator(".feed-cover-card").first()).toBeVisible();
    await expect(page.locator(".feed-cover-card .mosaic-cover").first()).toHaveCSS("aspect-ratio", "0.72 / 1");
    await page.screenshot({ path: `test-results/visual/${viewport.name}-feeds.png`, fullPage: true });

    await page.getByRole("link", { name: "Search" }).click();
    await page.getByPlaceholder("Search titles").fill("Solo");
    await page.screenshot({ path: `test-results/visual/${viewport.name}-search.png`, fullPage: true });

    await page.getByTestId("title-card").first().click();
    await expect(page.locator(".detail-stat-grid")).toContainText("30,298");
    await expect(page.locator(".detail-page")).not.toContainText("Folders");
    await page.screenshot({ path: `test-results/visual/${viewport.name}-detail.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}
