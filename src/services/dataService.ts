import { inflate } from "pako";
import { db, saveSyncMeta } from "../db/appDb";
import { DATA_SOURCE_CANDIDATES } from "../domain/defaults";
import { normalizeCatalog, resolveDisplayTitle } from "../domain/catalog";
import type { HistoryMap, RecommendationFeature, SeriesCatalog, SeriesDetail, SyncMeta, TagNode } from "../domain/types";

const detailRequestCache = new Map<string, Promise<SeriesDetail>>();

function bytesToText(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

function decodeJsonBytes(bytes: Uint8Array) {
  try {
    return bytesToText(inflate(bytes));
  } catch {
    return bytesToText(bytes);
  }
}

async function fetchJson<T>(base: string, path: string, preferGzip = true): Promise<T> {
  const targets = preferGzip ? [`${path}.gz`, path] : [path];
  let lastError: unknown;

  for (const target of targets) {
    try {
      const response = await fetch(`${base}/${target}`, { cache: "no-cache" });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      if (target.endsWith(".gz")) {
        const buffer = await response.arrayBuffer();
        return JSON.parse(decodeJsonBytes(new Uint8Array(buffer))) as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function fetchLocalJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`, {
      cache: "no-cache",
    });

    if (!response.ok) return null;

    if (path.endsWith(".gz")) {
      const buffer = await response.arrayBuffer();
      return JSON.parse(decodeJsonBytes(new Uint8Array(buffer))) as T;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function fixMangaBakaLink<T extends SeriesCatalog>(item: T): T {
  if (item.links?.mangabaka?.includes("/series/")) {
    return { ...item, links: { ...item.links, mangabaka: `https://mangabaka.org/${item.id}` } };
  }
  if (item.links?.mangabaka) return item;
  return { ...item, links: { ...(item.links ?? {}), mangabaka: `https://mangabaka.org/${item.id}` } };
}

function mergeLiveCatalog(liveCatalog: SeriesCatalog[], enrichedCatalog: SeriesCatalog[] | null) {
  const enrichedById = new Map((enrichedCatalog ?? []).map((item) => [item.id, fixMangaBakaLink(item)]));
  const liveIds = new Set<number>();
  const merged = liveCatalog.map((live) => {
    liveIds.add(live.id);
    const enriched = enrichedById.get(live.id);
    const fixedLive = fixMangaBakaLink(live);
    if (!enriched) return fixedLive;
    const livePublished = fixedLive.published;
    return fixMangaBakaLink({
      ...enriched,
      ...fixedLive,
      stats: fixedLive.stats ?? enriched.stats,
      analytics: fixedLive.analytics ?? enriched.analytics,
      source: fixedLive.source ?? enriched.source,
      published: livePublished?.start_date || livePublished?.end_date ? livePublished : enriched.published,
      last_updated_at: fixedLive.last_updated_at ?? enriched.last_updated_at,
      display_title: resolveDisplayTitle(enriched, fixedLive),
      mangabaka_title: fixedLive.mangabaka_title ?? enriched.mangabaka_title,
      native_title: fixedLive.native_title ?? enriched.native_title,
      romanized_title: fixedLive.romanized_title ?? enriched.romanized_title,
      authors: fixedLive.authors?.length ? fixedLive.authors : enriched.authors,
      artists: fixedLive.artists?.length ? fixedLive.artists : enriched.artists,
      links: { ...(enriched.links ?? {}), ...(fixedLive.links ?? {}) },
    });
  });
  for (const enriched of enrichedById.values()) {
    if (!liveIds.has(enriched.id)) merged.push(enriched);
  }
  return merged;
}

export async function resolveDataSource(preferred?: string) {
  const candidates = [preferred, ...DATA_SOURCE_CANDIDATES].filter(Boolean) as string[];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    try {
      const response = await fetch(
        `${candidate}/series/all.json.gz`,
        { cache: "no-cache" }
      );

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return candidate;
    } catch {
      // Try next source
    }
  }

  throw new Error("No working data source found.");
}

export async function syncFrontendData(
  preferredSource: string,
  onProgress?: (message: string) => void
) {
  const source = await resolveDataSource(preferredSource);

  onProgress?.("Loading current backend catalog");

  const liveCatalog = await fetchJson<SeriesCatalog[]>(
    source,
    "series/all.json",
    true
  );

  onProgress?.("Merging query-ready fields");

  const localCatalog = await fetchLocalJson<SeriesCatalog[]>(
    "data/query-index.json.gz"
  );

  const mergedCatalog = mergeLiveCatalog(liveCatalog, localCatalog);

  onProgress?.("Downloading tags");

  const rawTags = await fetchJson<Record<string, TagNode> | TagNode[]>(
    source,
    "meta/tags.json",
    true
  );

  const tags = Array.isArray(rawTags)
    ? rawTags
    : Object.values(rawTags);

  onProgress?.("Downloading history");

  const rawHistory = await fetchJson<HistoryMap>(
    source,
    "stats/history.json",
    true
  );

  onProgress?.("Downloading recommendation features");

  let recommendationFeatures: RecommendationFeature[] = [];
  try {
    recommendationFeatures = await fetchJson<RecommendationFeature[]>(
      source,
      "recommendations/features.json",
      true
    );
  } catch {
    recommendationFeatures = [];
  }

  onProgress?.("Saving offline data");

  const normalized = normalizeCatalog(mergedCatalog, rawHistory);
  const catalog = normalized.catalog;
  const history = normalized.history;

  const historyDates = [
    ...new Set(
      Object.values(history).flatMap((entries) =>
        entries.map((entry) => entry.d)
      )
    ),
  ].sort();

  await db.transaction(
    "rw",
    [db.catalog, db.tags, db.details, db.recommendationFeatures, db.history],
    async () => {
      await db.catalog.clear();
      await db.tags.clear();
      await db.recommendationFeatures.clear();
      await db.history.clear();
      await db.details.clear();

      await db.catalog.bulkPut(catalog);
      await db.tags.bulkPut(tags);
      if (recommendationFeatures.length > 0) {
        await db.recommendationFeatures.bulkPut(recommendationFeatures);
      }

      await db.history.bulkPut(
        Object.entries(history).map(([id, entries]) => ({
          id,
          entries,
        }))
      );
    }
  );

  const meta: SyncMeta = {
    lastSync: new Date().toISOString(),
    totalSeries: catalog.length,
    historyFirstDate: historyDates[0] ?? null,
    historyLastDate: historyDates.at(-1) ?? null,
    versionHash: `live-merged-${catalog.length}-${historyDates.at(-1) ?? "no-history"}`,
    source,
  };

  await saveSyncMeta(meta);

  return { catalog, tags, history, recommendationFeatures, meta };
}

export async function loadCachedData() {
  const [catalog, tags, historyRows, recommendationFeatures] = await Promise.all([
    db.catalog.toArray(),
    db.tags.toArray(),
    db.history.toArray(),
    db.recommendationFeatures.toArray(),
  ]);

  const history = Object.fromEntries(
    historyRows.map((row) => [row.id, row.entries])
  ) as HistoryMap;

  return { catalog, tags, history, recommendationFeatures };
}

export async function loadBundledCatalog() {
  const catalog = await fetchLocalJson<SeriesCatalog[]>(
    "data/query-index.json.gz"
  );
  if (!catalog?.length) return [];
  return normalizeCatalog(catalog, {}).catalog;
}

export async function fetchSeriesDetail(source: string, id: number) {
  const cached = await db.details.get(id);
  if (cached) {
    void fetchJson<SeriesDetail>(source, `details/${id}.json`, false)
      .then((detail) => db.details.put(fixMangaBakaLink(detail)))
      .catch(() => {
        // Cached detail keeps route changes instant; refresh failures can wait for the next sync.
      });
    return cached;
  }
  const cacheKey = `${source}:${id}`;
  const existing = detailRequestCache.get(cacheKey);
  if (existing) return existing;

  const request = (async () => {
    try {
      const detail = fixMangaBakaLink(
        await fetchJson<SeriesDetail>(
          source,
          `details/${id}.json`,
          false
        )
      );
      await db.details.put(detail);
      return detail;
    } finally {
      detailRequestCache.delete(cacheKey);
    }
  })();
  detailRequestCache.set(cacheKey, request);
  return request;
}

export function preloadSeriesDetail(source: string, id: number) {
  return fetchSeriesDetail(source, id).catch(() => null);
}
