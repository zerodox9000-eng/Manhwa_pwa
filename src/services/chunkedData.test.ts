import { gzip } from "pako";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchChunkedFrontendData, parseFrontendDataManifest } from "./chunkedData";

const base = "https://example.test/frontend";

async function hash(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function fixture() {
  const buildId = "v1-0123456789abcdef";
  const values = {
    catalog: [{
      id: 1,
      display_title: "Example",
      cover: null,
      year: 2026,
      status: "releasing",
      content_rating: "safe",
      total_chapters: "1",
      tag_ids: [10],
      stats: { popularity: 10, favourites: 1, meanScore: 70 },
      analytics: { fanFavouriteRaw: 10 },
    }],
    tags: {
      "10": {
        id: 10,
        name: "Action",
        path: "Genres > Action",
        is_genre: true,
        parent_id: null,
        level: 1,
      },
    },
    history: {
      "1": [{ d: "2026-06-28", p: 10, f: 1, s: 70, r: 10, rp: 50, pp: 50, ds: 50, dp: 50 }],
    },
    recommendations: [{ id: 1, context: {} }],
  };
  const files = new Map<string, Uint8Array>();
  const datasets: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(values)) {
    const bytes = gzip(JSON.stringify(value));
    const chunkPath = `builds/${buildId}/${name}/0001.json.gz`;
    files.set(`${base}/${chunkPath}`, bytes);
    datasets[name] = {
      kind: Array.isArray(value) ? "array" : "object",
      count: Array.isArray(value) ? value.length : Object.keys(value).length,
      chunks: [{
        path: chunkPath,
        bytes: bytes.byteLength,
        sha256: await hash(bytes),
        records: Array.isArray(value) ? value.length : Object.keys(value).length,
      }],
    };
  }

  const manifest = {
    contract: "manhwa-frontend-data",
    schemaVersion: 1,
    buildId,
    generatedAt: "2026-06-28T00:00:00.000Z",
    datasets,
  };
  return { files, manifest };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chunked frontend data", () => {
  it("reconstructs and validates every manifest dataset", async () => {
    const { files, manifest } = await fixture();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith("/meta/data-manifest.json")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      const body = files.get(href);
      return body
        ? new Response(new Uint8Array(body).buffer, { status: 200 })
        : new Response("missing", { status: 404 });
    }));

    const data = await fetchChunkedFrontendData(base);
    expect(data.buildId).toBe(manifest.buildId);
    expect(data.catalog.map((item) => item.id)).toEqual([1]);
    expect(data.tags.map((tag) => tag.id)).toEqual([10]);
    expect(Object.keys(data.history)).toEqual(["1"]);
    expect(data.recommendationFeatures.map((item) => item.id)).toEqual([1]);
  });

  it("skips recommendation chunks when the feature is suspended", async () => {
    const { files, manifest } = await fixture();
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith("/meta/data-manifest.json")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      const body = files.get(href);
      return body
        ? new Response(new Uint8Array(body).buffer, { status: 200 })
        : new Response("missing", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const progress: number[] = [];
    const data = await fetchChunkedFrontendData(
      base,
      undefined,
      { includeRecommendations: false },
      (value) => progress.push(value),
    );
    expect(data.recommendationFeatures).toEqual([]);
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some((url) => url.includes("/recommendations/"))).toBe(false);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it("rejects unsafe chunk paths before downloading them", async () => {
    const { manifest } = await fixture();
    const invalid = structuredClone(manifest);
    const catalog = invalid.datasets.catalog as {
      chunks: Array<{ path: string }>;
    };
    catalog.chunks[0].path = "../series.json.gz";
    expect(() => parseFrontendDataManifest(invalid)).toThrow("Unsafe chunk path");
  });

  it("rejects a chunk whose checksum does not match", async () => {
    const { files, manifest } = await fixture();
    const catalog = manifest.datasets.catalog as {
      chunks: Array<{ sha256: string }>;
    };
    catalog.chunks[0].sha256 = "0".repeat(64);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith("/meta/data-manifest.json")) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      const body = files.get(href);
      return body
        ? new Response(new Uint8Array(body).buffer, { status: 200 })
        : new Response("missing", { status: 404 });
    }));

    await expect(fetchChunkedFrontendData(base)).rejects.toThrow("checksum mismatch");
  });
});
