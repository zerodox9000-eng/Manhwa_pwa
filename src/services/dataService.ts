import { db, saveSyncMeta } from "../db/appDb";
import { DATA_SOURCE_CANDIDATES } from "../domain/defaults";
import { normalizeCatalog, resolveDisplayTitle } from "../domain/catalog";
import type { RecommendationFeature, SeriesCatalog, SeriesDetail, SyncMeta } from "../domain/types";
import { parseCatalogList, parseDetail, parseHistory, parseTags } from "../domain/validation";
import { decodeJsonBytes, fetchChunkedFrontendData, parseFrontendDataManifest } from "./chunkedData";

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

async function fetchJsonValidated<T>(base: string, path: string, parser: (value: unknown) => T, preferGzip = true): Promise<T> {
  const raw = await fetchJson<unknown>(base, path, preferGzip);
  return parser(raw);
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

function indexCatalog(catalog: SeriesCatalog[] | null | undefined) {
  const index = new Map<number, SeriesCatalog>();
  for (const item of catalog ?? []) {
    index.set(item.id, item);
    for (const mergedId of item.merged_ids ?? []) index.set(mergedId, item);
  }
  return index;
}

function mergeLiveCatalog(
  liveCatalog: SeriesCatalog[],
  enrichedCatalog: SeriesCatalog[] | null,
  previousCatalog: SeriesCatalog[] | null,
) {
  const enrichedById = new Map((enrichedCatalog ?? []).map((item) => [item.id, fixMangaBakaLink(item)]));
  const previousById = indexCatalog(previousCatalog);
  const liveIds = new Set<number>();
  const merged = liveCatalog.map((live) => {
    liveIds.add(live.id);
    const enriched = enrichedById.get(live.id);
    const previous = previousById.get(live.id);
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
      anilist_first_seen_at: fixedLive.anilist_first_seen_at ?? enriched.anilist_first_seen_at ?? previous?.anilist_first_seen_at ?? null,
      display_title: resolveDisplayTitle(enriched, fixedLive),
      animeplanet_title: fixedLive.animeplanet_title ?? enriched.animeplanet_title,
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
  const uniqueCandidates = candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });

  for (const candidate of uniqueCandidates) {
    try {
      const response = await fetch(
        `${candidate}/meta/data-manifest.json`,
        { cache: "no-cache" }
      );

      if (response.ok) return candidate;
    } catch {
      // Try all manifest-capable sources before falling back to legacy files.
    }
  }

  for (const candidate of uniqueCandidates) {
    try {
      const response = await fetch(
        `${candidate}/series/all.json.gz`,
        { cache: "no-cache" }
      );
      if (response.ok) return candidate;
    } catch {
      // Try next source.
    }
  }

  throw new Error("No working data source found.");
}

export function detailSourceCandidates(preferred?: string) {
  return [...new Set([preferred, ...DATA_SOURCE_CANDIDATES].filter(Boolean) as string[])];
}

export async function checkFrontendDataVersion(preferred?: string) {
  const candidates = [preferred, ...DATA_SOURCE_CANDIDATES].filter(Boolean) as string[];
  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });

  for (const candidate of uniqueCandidates) {
    try {
      const response = await fetch(`${candidate}/meta/data-manifest.json`, { cache: "no-cache" });
      if (response.ok) {
        const manifest = parseFrontendDataManifest(await response.json());
        return {
          source: candidate,
          versionHash: `chunked-${manifest.buildId}`,
          generatedAt: manifest.generatedAt,
        };
      }
    } catch {
      // Try all manifest-capable sources before falling back to legacy files.
    }
  }

  for (const candidate of uniqueCandidates) {
    try {
      const response = await fetch(`${candidate}/series/all.json.gz`, { cache: "no-cache" });
      if (response.ok) return { source: candidate, versionHash: null, generatedAt: null };
    } catch {
      // Try next source.
    }
  }

  throw new Error("No working data source found.");
}

export async function syncFrontendData(
  preferredSource: string,
  onProgress?: (message: string) => void,
  onDownloadProgress?: (progress: number) => void,
) {
  const source = await resolveDataSource(preferredSource);
  const syncTimestamp = new Date().toISOString();
  let chunkedData: Awaited<ReturnType<typeof fetchChunkedFrontendData>> | null = null;

  try {
    onProgress?.("Loading versioned backend data");
    chunkedData = await fetchChunkedFrontendData(
      source,
      onProgress,
      { includeRecommendations: false },
      onDownloadProgress,
    );
  } catch {
    onProgress?.("Using compatible backend data");
  }

  onProgress?.("Loading current backend catalog");
  const liveCatalog =
    chunkedData?.catalog ??
    await fetchJsonValidated(source, "series/all.json", parseCatalogList, true);

  onProgress?.("Merging query-ready fields");

  const localCatalog = parseCatalogList(await fetchLocalJson<unknown>("data/query-index.json.gz"));
  const cachedCatalog = parseCatalogList(await db.catalog.toArray());
  const cachedIndex = indexCatalog(cachedCatalog);

  const mergedCatalog = mergeLiveCatalog(liveCatalog, localCatalog, cachedCatalog);

  onProgress?.("Downloading tags");

  const tags =
    chunkedData?.tags ??
    parseTags(await fetchJson<unknown>(source, "meta/tags.json", true));

  onProgress?.("Downloading history");

  const rawHistory =
    chunkedData?.history ??
    parseHistory(await fetchJson<unknown>(source, "stats/history.json", true));

  const recommendationFeatures: RecommendationFeature[] = [];

  onProgress?.("Saving offline data");

  const normalized = normalizeCatalog(mergedCatalog, rawHistory, cachedIndex, syncTimestamp);
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
    [db.catalog, db.tags, db.recommendationFeatures, db.history],
    async () => {
      await db.catalog.clear();
      await db.tags.clear();
      await db.recommendationFeatures.clear();
      await db.history.clear();
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
    versionHash: chunkedData
      ? `chunked-${chunkedData.buildId}`
      : `live-merged-${catalog.length}-${historyDates.at(-1) ?? "no-history"}`,
    source,
  };

  await saveSyncMeta(meta);

  return { catalog, tags, history, recommendationFeatures, meta };
}

export async function loadCachedData() {
  const [catalog, tags, historyRows] = await Promise.all([
    db.catalog.toArray(),
    db.tags.toArray(),
    db.history.toArray(),
  ]);

  const history = parseHistory(Object.fromEntries(historyRows.map((row) => [row.id, row.entries])));

  return {
    catalog: parseCatalogList(catalog),
    tags: parseTags(tags),
    history,
    recommendationFeatures: [],
  };
}

export async function loadBundledCatalog() {
  const catalog = parseCatalogList(await fetchLocalJson<unknown>("data/query-index.json.gz"));
  if (!catalog?.length) return [];
  return normalizeCatalog(catalog, {}).catalog;
}

function hasDetailDescription(detail: SeriesDetail | null | undefined) {
  return Boolean(detail?.description?.trim());
}

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function fetchRawDetail(source: string, id: number, attempt: number) {
  const suffix = attempt > 0 ? `?detailRetry=${Date.now()}-${attempt}` : "";
  const response = await fetch(`${source}/details/${id}.json${suffix}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<unknown>;
}

async function fetchFreshSeriesDetail(source: string, id: number, attempts = 3, requireDescription = false) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const candidate of detailSourceCandidates(source)) {
      try {
        const rawDetail = await fetchRawDetail(candidate, id, attempt);
        const detail = fixMangaBakaLink(parseDetail(rawDetail) ?? (rawDetail as SeriesDetail));
        if (requireDescription && !hasDetailDescription(detail) && attempt < attempts - 1) {
          lastError = new Error("Description missing from detail response");
          continue;
        }
        await db.details.put(detail);
        return detail;
      } catch (error) {
        lastError = error;
      }
    }
    if (attempt < attempts - 1) await delay(attempt === 0 ? 250 : 700);
  }
  throw lastError;
}

export async function fetchSeriesDetail(source: string, id: number) {
  const cached = await db.details.get(id);
  if (cached) {
    if (!hasDetailDescription(cached)) {
      return fetchFreshSeriesDetail(source, id, 3, true);
    }
    void fetchFreshSeriesDetail(source, id, 1)
      .catch(() => {
        // Cached detail keeps route changes instant; refresh failures can wait for the next sync.
      });
    return cached;
  }
  return fetchFreshSeriesDetail(source, id, 3, true);
}
