import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { chromium } from "@playwright/test";

const backend = path.join(process.env.TEMP, "manhwa_db_export", "db", "exports", "frontend");
const all = JSON.parse(fs.readFileSync(path.join(backend, "series", "all.json"), "utf8"));
const detailDir = path.join(backend, "details");
const byId = new Map(all.map((item) => [item.id, item]));
const output = [];
const apCache = new Map();
const scrapeAnimePlanetTitles = process.env.AP_TITLE_SCRAPE === "1";

function cleanText(value) {
  return (value ?? "").trim();
}

function titleCaseSlug(value) {
  const minorWords = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "per", "the", "to", "vs", "via", "with"]);
  const words = decodeURIComponent(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && minorWords.has(lower)) return lower;
      return lower.replace(/^\p{L}/u, (letter) => letter.toUpperCase());
    })
    .join(" ");
}

function isPlaceholderTitle(value) {
  return /^(unknown title|untitled|no title|n\/a|-)?$/i.test(cleanText(value));
}

function animePlanetSourceUrl(item) {
  return item?.source?.animeplanet?.url ?? (item?.source?.animeplanet?.id ? `https://www.anime-planet.com/manga/${item.source.animeplanet.id}` : null);
}

function deriveAnimePlanetTitle(item) {
  const slug = item?.source?.animeplanet?.id ?? animePlanetSourceUrl(item)?.split("/").filter(Boolean).at(-1) ?? "";
  if (!slug) return null;
  const title = titleCaseSlug(slug);
  return isPlaceholderTitle(title) ? null : title;
}

async function scrapeAnimePlanetTitle(url) {
  if (!url) return null;
  if (apCache.has(url)) return apCache.get(url);

  let title = null;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1200 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    });
    page.setDefaultTimeout(15000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    const raw = cleanText(await page.title());
    title = raw
      .replace(/\s*[\-|–|—]\s*Anime-Planet.*$/i, "")
      .replace(/\s*Manga\s*$/i, "")
      .trim();
    if (isPlaceholderTitle(title)) title = null;
  } catch {
    title = null;
  } finally {
    await browser?.close().catch(() => {});
  }

  apCache.set(url, title);
  return title;
}

async function resolveAnimePlanetTitle(item) {
  const url = animePlanetSourceUrl(item);
  if (!url) return null;
  if (scrapeAnimePlanetTitles) {
    const scraped = await scrapeAnimePlanetTitle(url);
    if (scraped) return scraped;
  }
  return deriveAnimePlanetTitle(item);
}

for (const file of fs.readdirSync(detailDir)) {
  if (!file.endsWith(".json")) continue;
  const detail = JSON.parse(fs.readFileSync(path.join(detailDir, file), "utf8"));
  const base = byId.get(detail.id) ?? {};
  const links = { ...(detail.links ?? {}) };
  links.mangabaka = `https://mangabaka.org/${detail.id}`;
  const animeplanet_title = (await resolveAnimePlanetTitle(detail)) ?? (await resolveAnimePlanetTitle(base)) ?? base.animeplanet_title ?? detail.animeplanet_title ?? null;
  output.push({
    ...base,
    id: detail.id,
    display_title: detail.display_title,
    animeplanet_title,
    tag_weights: detail.tag_weights ?? base.tag_weights ?? null,
    cover: detail.cover ?? base.cover ?? null,
    year: detail.year ?? base.year ?? null,
    status: detail.status ?? base.status ?? null,
    content_rating: detail.content_rating ?? base.content_rating ?? null,
    total_chapters: detail.total_chapters ?? base.total_chapters ?? null,
    tag_ids: detail.tag_ids ?? base.tag_ids ?? [],
    stats: detail.stats ?? base.stats ?? { popularity: null, favourites: null, meanScore: null },
    analytics: detail.analytics ?? base.analytics ?? {},
    published: detail.published ?? null,
    first_seen_at: detail.first_seen_at ?? base.first_seen_at ?? null,
    first_seen_at_is_trusted: detail.first_seen_at_is_trusted ?? base.first_seen_at_is_trusted ?? false,
    last_updated_at: detail.last_updated_at ?? base.last_updated_at ?? null,
    mangabaka_latest_rank: detail.mangabaka_latest_rank ?? base.mangabaka_latest_rank ?? null,
    mangabaka_latest_snapshot_at: detail.mangabaka_latest_snapshot_at ?? base.mangabaka_latest_snapshot_at ?? null,
    authors: detail.authors ?? [],
    artists: detail.artists ?? [],
    links,
    source: detail.source ?? null,
  });
}

output.sort((a, b) => a.id - b.id);
const json = JSON.stringify(output);
fs.writeFileSync("public/data/query-index.json.gz", zlib.gzipSync(json, { level: 9 }));
fs.writeFileSync(
  "public/data/query-index-meta.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), totalSeries: output.length, animePlanetTitles: true, scraped: scrapeAnimePlanetTitles }, null, 2),
);
console.log(`Generated ${output.length} query-index records (${Buffer.byteLength(json)} bytes json).`);
