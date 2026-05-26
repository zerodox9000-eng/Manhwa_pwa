import { inflate } from "pako";
import { db, saveSyncMeta } from "../db/appDb";
import { DATA_SOURCE_CANDIDATES } from "../domain/defaults";
import type { HistoryMap, SeriesCatalog, SeriesDetail, SyncMeta, TagNode } from "../domain/types";

function bytesToText(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
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
        return JSON.parse(bytesToText(inflate(new Uint8Array(buffer)))) as T;
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
      return JSON.parse(bytesToText(inflate(new Uint8Array(buffer)))) as T;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
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

  onProgress?.("Loading query-ready catalog");

  const localCatalog = await fetchLocalJson<SeriesCatalog[]>(
    "data/query-index.json.gz"
  );

  const catalog =
    localCatalog ??
    (await fetchJson<SeriesCatalog[]>(source, "series/all.json", true));

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

  const history = await fetchJson<HistoryMap>(
    source,
    "stats/history.json",
    true
  );

  onProgress?.("Saving offline data");

  const historyDates = [
    ...new Set(
      Object.values(history).flatMap((entries) =>
        entries.map((entry) => entry.d)
      )
    ),
  ].sort();

  await db.transaction(
    "rw",
    db.catalog,
    db.tags,
    db.history,
    db.meta,
    async () => {
      await db.catalog.clear();
      await db.tags.clear();
      await db.history.clear();

      await db.catalog.bulkPut(catalog);
      await db.tags.bulkPut(tags);

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
    versionHash: `${catalog.length}-${historyDates.at(-1) ?? "no-history"}`,
    source,
  };

  await saveSyncMeta(meta);

  return { catalog, tags, history, meta };
}

export async function loadCachedData() {
  const [catalog, tags, historyRows] = await Promise.all([
    db.catalog.toArray(),
    db.tags.toArray(),
    db.history.toArray(),
  ]);

  const history = Object.fromEntries(
    historyRows.map((row) => [row.id, row.entries])
  ) as HistoryMap;

  return { catalog, tags, history };
}

export async function fetchSeriesDetail(source: string, id: number) {
  const cached = await db.details.get(id);

  if (cached) return cached;

  const detail = await fetchJson<SeriesDetail>(
    source,
    `details/${id}.json`,
    false
  );

  if (detail.links?.mangabaka?.includes("/series/")) {
    detail.links.mangabaka = `https://mangabaka.org/${detail.id}`;
  }

  await db.details.put(detail);

  return detail;
}
