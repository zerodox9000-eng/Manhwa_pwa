import { db, saveSyncMeta } from "../db/appDb";
import { DATA_SOURCE_CANDIDATES } from "../domain/defaults";
import { catalogMergeKeys, mergeCatalogRecords, normalizeCatalog } from "../domain/catalog";
import type { RecommendationFeature, SeriesCatalog, SeriesDetail, SyncMeta } from "../domain/types";
import { parseCatalogList, parseDetail, parseHistory, parseTags } from "../domain/validation";
import { decodeJsonBytes, fetchChunkedFrontendData, parseFrontendDataManifest } from "./chunkedData";

// Bump only when stored catalogue records need a one-time repair after a frontend rule change.
export const CATALOG_NORMALIZATION_VERSION = 5;
const TAG_WEIGHT_EXPORT_PATH = "meta/mangabaka-tag-weights.safe-suggestive-anilist.json";

export function needsCatalogNormalizationRepair(meta: Pick<SyncMeta, "catalogNormalizationVersion"> | null | undefined) {
  return meta?.catalogNormalizationVersion !== CATALOG_NORMALIZATION_VERSION;
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

async function fetchJsonValidated<T>(base: string, path: string, parser: (value: unknown) => T, preferGzip = true): Promise<T> {
  const raw = await fetchJson<unknown>(base, path, preferGzip);
  return parser(raw);
}

function fixMangaBakaLink<T extends SeriesCatalog>(item: T): T {
  const mangaBakaLink = item.links?.mangabaka?.trim();
  const needsCanonicalMangaBakaLink = Boolean(
    mangaBakaLink && (
      mangaBakaLink.includes("/series/") ||
      /mangabaka\.org\/\d+\/?$/i.test(mangaBakaLink) && !mangaBakaLink.endsWith(`/${item.id}`)
    ),
  );
  if (needsCanonicalMangaBakaLink) {
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

function indexCatalogIdentities(catalog: SeriesCatalog[] | null | undefined) {
  const index = new Map<string, SeriesCatalog>();
  for (const item of catalog ?? []) {
    for (const key of catalogMergeKeys(item)) {
      if (!index.has(key)) index.set(key, item);
    }
  }
  return index;
}

function uniqueIds(values: (number | null | undefined)[]) {
  return [...new Set(values.filter((value): value is number => Number.isSafeInteger(value)))];
}

function isAniListBacked(item: SeriesCatalog) {
  return item.source?.anilist?.id != null;
}

function parseTagWeightExport(value: unknown) {
  const weightsBySeriesId = new Map<number, Record<number, number | string>>();
  if (!Array.isArray(value)) return weightsBySeriesId;

  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const seriesId = Number((row as { id?: unknown }).id);
    const rawWeights = (row as { tag_weights?: unknown }).tag_weights;
    if (!Number.isSafeInteger(seriesId) || !rawWeights || typeof rawWeights !== "object" || Array.isArray(rawWeights)) continue;

    const tagWeights: Record<number, number | string> = {};
    for (const [rawTagId, weight] of Object.entries(rawWeights)) {
      const tagId = Number(rawTagId);
      if (Number.isSafeInteger(tagId) && (typeof weight === "number" || typeof weight === "string")) {
        tagWeights[tagId] = weight;
      }
    }
    if (Object.keys(tagWeights).length > 0) weightsBySeriesId.set(seriesId, tagWeights);
  }

  return weightsBySeriesId;
}

export function applyTagWeightExport(catalog: SeriesCatalog[], value: unknown) {
  const weightsBySeriesId = parseTagWeightExport(value);
  return catalog.map((item) => {
    if (!isAniListBacked(item)) return item;
    const candidateIds = [item.id, ...(item.merged_ids ?? [])];
    const exportedWeights = Object.assign(
      {},
      ...candidateIds
        .slice()
        .reverse()
        .map((id) => weightsBySeriesId.get(id) ?? {}),
    );
    const mergedWeights = {
      ...exportedWeights,
      ...(item.tag_weights ?? {}),
    };
    if (Object.keys(mergedWeights).length === 0) return item;
    return {
      ...item,
      tag_weights: mergedWeights,
    };
  });
}

async function fetchOptionalTagWeightExport(preferredSource: string) {
  const candidates = DATA_SOURCE_CANDIDATES.includes(preferredSource)
    ? detailSourceCandidates(preferredSource)
    : [preferredSource];
  for (const candidate of candidates) {
    try {
      const value = await fetchJson<unknown>(candidate, TAG_WEIGHT_EXPORT_PATH, true);
      if (parseTagWeightExport(value).size > 0) return value;
    } catch {
      // Older or custom frontend exports may not include the optional weight dataset.
    }
  }
  return null;
}

export function mergeLiveCatalog(
  liveCatalog: SeriesCatalog[],
  previousCatalog: SeriesCatalog[] | null,
) {
  const previousById = indexCatalog(previousCatalog);
  const previousByIdentity = indexCatalogIdentities(previousCatalog);
  const liveIds = new Set(liveCatalog.map((item) => item.id));
  return liveCatalog.map((live) => {
    const previousCandidate = previousById.get(live.id) ?? catalogMergeKeys(live)
      .map((key) => previousByIdentity.get(key))
      .find((item): item is SeriesCatalog => Boolean(item));
    // A previous cache may contain a false cover-based merge. If more than one
    // of that old group's IDs is present in the current export, let the current
    // source identities rebuild the group instead of reintroducing the stale
    // alias set and its links.
    const hasCurrentAliasSibling = Boolean(
      previousCandidate?.merged_ids?.some((id) => id !== live.id && liveIds.has(id)),
    );
    const previous = hasCurrentAliasSibling ? null : previousCandidate;
    const fixedLive = fixMangaBakaLink(live);
    const continuity = previous ? mergeCatalogRecords(previous, fixedLive) : fixedLive;
    const { tag_weights: liveTagWeights, ...catalog } = fixedLive;
    delete catalog.animeplanet_title;
    const carriedMergedIds = uniqueIds([
      ...(live.merged_ids ?? []),
      ...(!hasCurrentAliasSibling ? previousCandidate?.merged_ids ?? [] : []),
      ...(!hasCurrentAliasSibling && previousCandidate && previousCandidate.id !== live.id ? [previousCandidate.id] : []),
    ]);
    const continuityLinks = previous ? continuity.links : fixedLive.links;
    const continuitySource = previous ? continuity.source : fixedLive.source;
    const continuityTitles = previous ? continuity.titles : fixedLive.titles;
    const continuityAuthors = previous ? continuity.authors : fixedLive.authors;
    const continuityArtists = previous ? continuity.artists : fixedLive.artists;
    const continuityType = fixedLive.type ?? previous?.type ?? null;
    const liveWithContinuity = fixMangaBakaLink({
      ...catalog,
      ...(continuityLinks ? { links: continuityLinks } : {}),
      ...(continuitySource ? { source: continuitySource } : {}),
      ...(continuityTitles ? { titles: continuityTitles } : {}),
      ...(continuityAuthors ? { authors: continuityAuthors } : {}),
      ...(continuityArtists ? { artists: continuityArtists } : {}),
      type: [fixedLive.type, previous?.type].some((value) => value?.toLocaleLowerCase() === "oel")
        ? "oel"
        : continuityType,
    });
    return {
      ...liveWithContinuity,
      ...(carriedMergedIds.length > 0 ? { merged_ids: uniqueIds([live.id, ...carriedMergedIds]) } : {}),
      anilist_first_seen_at: fixedLive.anilist_first_seen_at ?? previous?.anilist_first_seen_at ?? null,
      // Weight exports are optional and authoritative for the current sync. Do not
      // carry old classifications into a newer catalogue/export. Omit the field
      // when no weights exist so older validators and caches keep the row intact.
      ...(liveTagWeights ? { tag_weights: liveTagWeights } : {}),
    };
  });
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

  const cachedCatalog = parseCatalogList(await db.catalog.toArray());
  const cachedIndex = indexCatalog(cachedCatalog);

  const mergedCatalog = mergeLiveCatalog(liveCatalog, cachedCatalog);

  onProgress?.("Loading tag weights");
  const catalogWithWeights = applyTagWeightExport(
    mergedCatalog,
    await fetchOptionalTagWeightExport(source),
  );

  onProgress?.("Preparing search fields");

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

  const normalized = normalizeCatalog(catalogWithWeights, rawHistory, cachedIndex, syncTimestamp);
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
    catalogNormalizationVersion: CATALOG_NORMALIZATION_VERSION,
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

export async function fetchSeriesDetail(
  source: string,
  id: number,
  onRefresh?: (detail: SeriesDetail) => void,
) {
  const cached = await db.details.get(id);
  if (cached) {
    if (!hasDetailDescription(cached)) {
      return fetchFreshSeriesDetail(source, id, 3, true);
    }
    // Catalogues are refreshed before details. Keep a cached detail's title aligned
    // with the catalogue instead of letting an old detail response win indefinitely.
    const catalogRecord = await db.catalog.get(id);
    const detail = catalogRecord?.display_title && cached.display_title !== catalogRecord.display_title
      ? { ...cached, display_title: catalogRecord.display_title }
      : cached;
    if (detail !== cached) await db.details.put(detail);
    void fetchFreshSeriesDetail(source, id, 1)
      .then((freshDetail) => onRefresh?.(freshDetail))
      .catch(() => {
        // Cached detail keeps route changes instant; refresh failures can wait for the next sync.
      });
    return detail;
  }
  return fetchFreshSeriesDetail(source, id, 3, true);
}
