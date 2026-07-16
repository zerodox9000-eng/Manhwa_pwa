import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

const root = new URL("../", import.meta.url);
const backendRoot = new URL("../manhwa_db/", root);
const manifestPath = new URL("db/exports/frontend/meta/data-manifest.json", backendRoot);
const tagsSourcePath = new URL("db/exports/frontend/meta/tags.json.gz", backendRoot);
const outputFlagIndex = process.argv.indexOf("--output-dir");
if (outputFlagIndex >= 0 && !process.argv[outputFlagIndex + 1]) {
  throw new Error("--output-dir requires a directory path.");
}
const outputPath = path.resolve(
  outputFlagIndex >= 0
    ? process.argv[outputFlagIndex + 1]
    : path.join(process.env.TEMP ?? process.cwd(), "aeon-wiki-assets"),
);
const outputDir = pathToFileURL(`${outputPath}${path.sep}`);
const generatedAt = new Date().toISOString().slice(0, 10);

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const catalogChunks = manifest.datasets?.catalog?.chunks;
if (!Array.isArray(catalogChunks) || catalogChunks.length === 0) {
  throw new Error("Frontend data manifest has no catalog chunks.");
}
const catalogueChunks = await Promise.all(catalogChunks.map(async ({ path }) =>
  JSON.parse(zlib.gunzipSync(await fs.readFile(new URL(`db/exports/frontend/${path}`, backendRoot)))),
));
const catalogue = catalogueChunks.flat();
if (catalogue.length !== manifest.datasets.catalog.count) {
  throw new Error(`Catalog chunk count mismatch: expected ${manifest.datasets.catalog.count}, received ${catalogue.length}.`);
}
const tagCatalogue = JSON.parse(zlib.gunzipSync(await fs.readFile(tagsSourcePath)));
const rows = Object.values(catalogue);
const tags = Array.isArray(tagCatalogue) ? tagCatalogue : Object.values(tagCatalogue);
const hasNumber = (value) => Number.isFinite(value);
const sensitiveRootNames = new Set(["boys love", "girls love", "yaoi", "yuri", "smut", "hentai"]);
const sensitiveRootIds = new Set(
  tags
    .filter((tag) => sensitiveRootNames.has(String(tag.name ?? "").trim().toLocaleLowerCase()))
    .map((tag) => tag.id),
);
const tagChildren = new Map();
for (const tag of tags) {
  if (tag.parent_id == null) continue;
  const children = tagChildren.get(tag.parent_id) ?? [];
  children.push(tag.id);
  tagChildren.set(tag.parent_id, children);
}
const sensitiveTagIds = new Set(sensitiveRootIds);
const pendingSensitiveRoots = [...sensitiveRootIds];
while (pendingSensitiveRoots.length > 0) {
  const parentId = pendingSensitiveRoots.shift();
  for (const childId of tagChildren.get(parentId) ?? []) {
    if (sensitiveTagIds.has(childId)) continue;
    sensitiveTagIds.add(childId);
    pendingSensitiveRoots.push(childId);
  }
}
const chartRows = rows.filter((item) =>
  hasNumber(item.analytics?.fanFavouriteDiscoveryPercentile) &&
  hasNumber(item.analytics?.popularityPercentile),
);
const normalRows = rows.filter((item) =>
  item?.source?.anilist?.id &&
  item.content_rating === "safe" &&
  !(item.tag_ids ?? []).some((tagId) => sensitiveTagIds.has(tagId)) &&
  hasNumber(item.stats?.popularity) &&
  hasNumber(item.stats?.favourites) &&
  hasNumber(item.analytics?.fanFavouriteDiscoveryPercentile) &&
  hasNumber(item.analytics?.popularityPercentile),
);

const fanPercentRows = rows.filter((item) =>
  hasNumber(item.stats?.popularity) &&
  item.stats.popularity > 0 &&
  hasNumber(item.stats?.favourites),
);
const popularityRows = rows.filter((item) => hasNumber(item.stats?.popularity));
const favouritesRows = rows.filter((item) => hasNumber(item.stats?.favourites));
const fanRankUnavailable = rows.length - chartRows.length;
const bin = (value) => Math.max(0, Math.min(9, Math.floor(value / 10)));

const histogram = (values, thresholds, labels) => labels.map((label, index) => ({
  label,
  titles: values.filter((value) => value >= thresholds[index] && (index === thresholds.length - 1 || value < thresholds[index + 1])).length,
}));
const popularityDistribution = histogram(
  popularityRows.map((item) => item.stats.popularity),
  [0, 10, 25, 50, 100, 250, 500, 1000, 10000, 100000],
  ["0-10", "10-25", "25-50", "50-100", "100-250", "250-500", "500-1K", "1K-10K", "10K-100K", "100K+"],
);
const favouritesDistribution = histogram(
  favouritesRows.map((item) => item.stats.favourites),
  [0, 10, 25, 50, 100, 250, 500, 1000, 10000],
  ["0-10", "10-25", "25-50", "50-100", "100-250", "250-500", "500-1K", "1K-10K", "10K+"],
);
const fanPercentDistribution = histogram(
  fanPercentRows.map((item) => (item.stats.favourites / item.stats.popularity) * 100),
  [0, 1, 2, 3, 4, 5, 10],
  ["0-1%", "1%", "2%", "3%", "4%", "5-10%", "10%+"],
);

const safeHighFanRows = normalRows
  .filter((item) => item.analytics.fanFavouriteDiscoveryPercentile >= 90)
  .filter((item) => item.analytics.popularityPercentile >= 70)
  .filter((item) => String(item.display_title).trim().toLocaleLowerCase() !== "jib-i eopseo")
const stableShuffle = (items) => items
  .map((item) => ({ item, key: ((Number(item.id) * 2654435761) >>> 0) }))
  .sort((a, b) => a.key - b.key)
  .map(({ item }) => item);
const fanExampleRanges = [[90, 95], [95, 100], [100, Infinity]];
const selectedExamples = [];
for (const popularityBand of [7, 8, 9]) {
  for (const [minFan, maxFan] of fanExampleRanges) {
    const candidate = stableShuffle(safeHighFanRows.filter((item) =>
      bin(item.analytics.popularityPercentile) === popularityBand &&
      item.analytics.fanFavouriteDiscoveryPercentile >= minFan &&
      item.analytics.fanFavouriteDiscoveryPercentile < maxFan,
    ))[0];
    if (candidate) selectedExamples.push(candidate);
  }
}
const examples = selectedExamples.concat(stableShuffle(safeHighFanRows).filter((item) => !selectedExamples.includes(item)))
  .slice(0, 12)
  .map((item) => ({
    id: item.id,
    title: item.display_title,
    fanRank: Math.round(item.analytics.fanFavouriteDiscoveryPercentile),
    popularityPercentile: Math.round(item.analytics.popularityPercentile),
    fanPercent: Math.round((item.stats.favourites / item.stats.popularity) * 1000) / 10,
    popularity: item.stats.popularity,
    favourites: item.stats.favourites,
  }));

const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const chartShell = (title, subtitle, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 430" role="img" aria-labelledby="title desc">
  <title id="title">${esc(title)}</title>
  <desc id="desc">${esc(subtitle)}</desc>
  <rect width="900" height="430" rx="18" fill="#10131b"/>
  <text x="48" y="54" fill="#f3f5fb" font-family="Arial, sans-serif" font-size="24" font-weight="700">${esc(title)}</text>
  <text x="48" y="82" fill="#aeb7c9" font-family="Arial, sans-serif" font-size="14">${esc(subtitle)}</text>
  ${body}
</svg>`;

const distributionBars = (distribution, color) => {
  const max = Math.max(...distribution.map((item) => item.titles), 1);
  const left = 72;
  const bottom = 350;
  const width = 760;
  const slot = width / distribution.length;
  const barWidth = slot - 10;
  return distribution.map((item, index) => {
    const height = Math.round((item.titles / max) * 230);
    const x = left + index * slot + 5;
    const y = bottom - height;
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="5" fill="${color}"/><text x="${x + barWidth / 2}" y="${bottom + 24}" text-anchor="middle" fill="#c8d0df" font-family="Arial, sans-serif" font-size="12">${esc(item.label)}</text><text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" fill="#f3f5fb" font-family="Arial, sans-serif" font-size="11">${item.titles.toLocaleString()}</text>`;
  }).join("");
};
const distributionSvg = (title, subtitle, distribution, color) => chartShell(title, subtitle, `<line x1="72" y1="350" x2="840" y2="350" stroke="#596276"/><line x1="72" y1="120" x2="72" y2="350" stroke="#596276"/>${distributionBars(distribution, color)}<text x="450" y="410" text-anchor="middle" fill="#aeb7c9" font-family="Arial, sans-serif" font-size="13">Catalogue value band</text>`);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(new URL("fan-rank-chart-data.json", outputDir), JSON.stringify({ generatedAt, catalogueTitles: rows.length, metricAvailableTitles: chartRows.length, metricUnavailableTitles: fanRankUnavailable, popularityTitles: popularityRows.length, favouritesTitles: favouritesRows.length, fanPercentTitles: fanPercentRows.length, safeNormalEligibleTitles: normalRows.length, popularityDistribution, favouritesDistribution, fanPercentDistribution, examples }, null, 2) + "\n");
const catalogueSummary = `Full catalogue snapshot: ${rows.length.toLocaleString()} titles. Popularity values: ${popularityRows.length.toLocaleString()}; favourites values: ${favouritesRows.length.toLocaleString()}; Fan% values: ${fanPercentRows.length.toLocaleString()}. Export: ${generatedAt}.`;
await fs.writeFile(new URL("popularity-distribution.svg", outputDir), distributionSvg("Popularity distribution", catalogueSummary, popularityDistribution, "#22c6d8"));
await fs.writeFile(new URL("favourites-distribution.svg", outputDir), distributionSvg("Favourites distribution", catalogueSummary, favouritesDistribution, "#ffb86b"));
await fs.writeFile(new URL("fan-percent-distribution.svg", outputDir), distributionSvg("Fan% distribution", catalogueSummary, fanPercentDistribution, "#b18cff"));
for (const oldName of ["fan-rank-distribution.svg", "fan-rank-popularity-comparison.svg"]) {
  await fs.rm(new URL(oldName, outputDir), { force: true });
}
console.log(JSON.stringify({ generatedAt, catalogueTitles: rows.length, popularityTitles: popularityRows.length, favouritesTitles: favouritesRows.length, fanPercentTitles: fanPercentRows.length, safeNormalEligibleTitles: normalRows.length, examples }, null, 2));
