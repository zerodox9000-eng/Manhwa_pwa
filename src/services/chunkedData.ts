import { inflate } from "pako";
import type { HistoryMap, RecommendationFeature, SeriesCatalog, TagNode } from "../domain/types";
import { parseCatalogList, parseHistory, parseRecommendationFeatures, parseTags } from "../domain/validation";

const DATA_CONTRACT = "manhwa-frontend-data";
const SUPPORTED_SCHEMA_VERSION = 1;
const MAX_CHUNK_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 4;

type DatasetKind = "array" | "object";
type DatasetName = "catalog" | "tags" | "history" | "recommendations";

interface ChunkDescriptor {
  path: string;
  bytes: number;
  sha256: string;
  records: number;
}

interface DatasetDescriptor {
  kind: DatasetKind;
  count: number;
  chunks: ChunkDescriptor[];
}

export interface FrontendDataManifest {
  contract: typeof DATA_CONTRACT;
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  buildId: string;
  generatedAt: string;
  datasets: Record<DatasetName, DatasetDescriptor>;
}

export interface ChunkedFrontendData {
  buildId: string;
  catalog: SeriesCatalog[];
  tags: TagNode[];
  history: HistoryMap;
  recommendationFeatures: RecommendationFeature[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function parseChunk(value: unknown, buildId: string): ChunkDescriptor {
  if (!isRecord(value)) throw new Error("Chunk descriptor is not an object.");
  const chunkPath = typeof value.path === "string" ? value.path : "";
  const requiredPrefix = `builds/${buildId}/`;
  if (
    !chunkPath.startsWith(requiredPrefix) ||
    chunkPath.includes("..") ||
    chunkPath.startsWith("/") ||
    !chunkPath.endsWith(".json.gz")
  ) {
    throw new Error(`Unsafe chunk path: ${chunkPath || "(missing)"}`);
  }
  if (!positiveInteger(value.bytes) || Number(value.bytes) >= MAX_CHUNK_BYTES) {
    throw new Error(`Invalid chunk byte count for ${chunkPath}.`);
  }
  if (!positiveInteger(value.records)) {
    throw new Error(`Invalid chunk record count for ${chunkPath}.`);
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error(`Invalid chunk checksum for ${chunkPath}.`);
  }
  return {
    path: chunkPath,
    bytes: Number(value.bytes),
    records: Number(value.records),
    sha256: value.sha256,
  };
}

function parseDataset(value: unknown, name: DatasetName, buildId: string): DatasetDescriptor {
  if (!isRecord(value)) throw new Error(`Manifest dataset ${name} is missing.`);
  if (value.kind !== "array" && value.kind !== "object") {
    throw new Error(`Manifest dataset ${name} has an invalid kind.`);
  }
  if (!positiveInteger(value.count)) {
    throw new Error(`Manifest dataset ${name} has an invalid count.`);
  }
  if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
    throw new Error(`Manifest dataset ${name} has no chunks.`);
  }
  return {
    kind: value.kind,
    count: Number(value.count),
    chunks: value.chunks.map((chunk) => parseChunk(chunk, buildId)),
  };
}

export function parseFrontendDataManifest(value: unknown): FrontendDataManifest {
  if (!isRecord(value)) throw new Error("Frontend data manifest is not an object.");
  if (value.contract !== DATA_CONTRACT) throw new Error("Unknown frontend data contract.");
  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`Unsupported frontend data schema: ${String(value.schemaVersion)}`);
  }
  if (typeof value.buildId !== "string" || !/^v1-[a-f0-9]{16}$/.test(value.buildId)) {
    throw new Error("Invalid frontend data build id.");
  }
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) {
    throw new Error("Invalid frontend data generation date.");
  }
  if (!isRecord(value.datasets)) throw new Error("Frontend data manifest has no datasets.");

  const buildId = value.buildId;
  return {
    contract: DATA_CONTRACT,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    buildId,
    generatedAt: value.generatedAt,
    datasets: {
      catalog: parseDataset(value.datasets.catalog, "catalog", buildId),
      tags: parseDataset(value.datasets.tags, "tags", buildId),
      history: parseDataset(value.datasets.history, "history", buildId),
      recommendations: parseDataset(value.datasets.recommendations, "recommendations", buildId),
    },
  };
}

export function bytesToText(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

export function decodeJsonBytes(bytes: Uint8Array) {
  try {
    return bytesToText(inflate(bytes));
  } catch {
    return bytesToText(bytes);
  }
}

async function sha256(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) return null;
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function downloadChunk(base: string, chunk: ChunkDescriptor) {
  const response = await fetch(`${base}/${chunk.path}`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${chunk.path}: ${response.status} ${response.statusText}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== chunk.bytes) throw new Error(`${chunk.path}: byte count mismatch`);
  const checksum = await sha256(bytes);
  if (checksum && checksum !== chunk.sha256) throw new Error(`${chunk.path}: checksum mismatch`);

  return JSON.parse(decodeJsonBytes(bytes)) as unknown;
}

async function loadDataset(base: string, name: DatasetName, descriptor: DatasetDescriptor) {
  const chunks = await mapWithConcurrency(
    descriptor.chunks,
    DOWNLOAD_CONCURRENCY,
    (chunk) => downloadChunk(base, chunk),
  );
  const combined: unknown[] | Record<string, unknown> = descriptor.kind === "array" ? [] : {};
  let records = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const expected = descriptor.chunks[index];
    if (descriptor.kind === "array") {
      if (!Array.isArray(chunk)) throw new Error(`${expected.path}: expected an array`);
      if (chunk.length !== expected.records) throw new Error(`${expected.path}: record count mismatch`);
      records += chunk.length;
      (combined as unknown[]).push(...chunk);
      continue;
    }

    if (!isRecord(chunk)) throw new Error(`${expected.path}: expected an object`);
    const entries = Object.entries(chunk);
    if (entries.length !== expected.records) throw new Error(`${expected.path}: record count mismatch`);
    records += entries.length;
    for (const [key, value] of entries) {
      if (key in combined) throw new Error(`${expected.path}: duplicate key ${key}`);
      (combined as Record<string, unknown>)[key] = value;
    }
  }

  if (records !== descriptor.count) {
    throw new Error(`${name}: expected ${descriptor.count} records, received ${records}`);
  }
  return combined;
}

export async function fetchChunkedFrontendData(
  base: string,
  onProgress?: (message: string) => void,
): Promise<ChunkedFrontendData> {
  const manifestResponse = await fetch(`${base}/meta/data-manifest.json`, { cache: "no-cache" });
  if (!manifestResponse.ok) {
    throw new Error(`Manifest: ${manifestResponse.status} ${manifestResponse.statusText}`);
  }
  const manifest = parseFrontendDataManifest(await manifestResponse.json());

  onProgress?.("Downloading chunked catalog");
  const rawCatalog = await loadDataset(base, "catalog", manifest.datasets.catalog);
  const catalog = parseCatalogList(rawCatalog);
  if (catalog.length !== manifest.datasets.catalog.count) {
    throw new Error("Catalog validation dropped one or more records.");
  }

  onProgress?.("Downloading chunked tags");
  const rawTags = await loadDataset(base, "tags", manifest.datasets.tags);
  const tags = parseTags(rawTags);
  if (tags.length !== manifest.datasets.tags.count) {
    throw new Error("Tag validation dropped one or more records.");
  }

  onProgress?.("Downloading chunked history");
  const history = parseHistory(await loadDataset(base, "history", manifest.datasets.history));
  if (Object.keys(history).length !== manifest.datasets.history.count) {
    throw new Error("History validation dropped one or more tracks.");
  }

  onProgress?.("Downloading chunked recommendation features");
  const recommendationFeatures = parseRecommendationFeatures(
    await loadDataset(base, "recommendations", manifest.datasets.recommendations),
  );
  if (recommendationFeatures.length !== manifest.datasets.recommendations.count) {
    throw new Error("Recommendation validation dropped one or more records.");
  }

  return {
    buildId: manifest.buildId,
    catalog,
    tags,
    history,
    recommendationFeatures,
  };
}
