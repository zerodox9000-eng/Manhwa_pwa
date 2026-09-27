import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

// Use the shipped query implementation, not a second ranking/filter algorithm.
const root = path.resolve(import.meta.dirname, '..');
const snapshotPath = path.join(root, 'scripts/assets/loading-cover-pools.json');
const previous = JSON.parse(await readFile(snapshotPath, 'utf8'));
const server = await createServer({
  root, configFile: false, appType: 'custom', server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options = {}) => originalFetch(url, {
  ...options,
  signal: options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
    : AbortSignal.timeout(20000),
});
try {
  const [{ fetchChunkedFrontendData }, { runFeedQuery }, { normalizeCatalog }, { DEFAULT_SETTINGS }] = await Promise.all([
    server.ssrLoadModule('/src/services/chunkedData.ts'),
    server.ssrLoadModule('/src/domain/query.ts'),
    server.ssrLoadModule('/src/domain/catalog.ts'),
    server.ssrLoadModule('/src/domain/defaults.ts'),
  ]);
  const data = await fetchChunkedFrontendData(
    'https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend',
    console.log, { includeRecommendations: false },
  );
  const normalized = normalizeCatalog(data.catalog, data.history);
  const feeds = JSON.parse(await readFile(path.join(root, 'src/domain/defaultFeeds.generated.json'), 'utf8'));
  const pools = previous.pools.map(pool => {
    const feed = feeds.find(item => item.id === pool.feedId);
    if (!feed) throw new Error(`Missing shipped Discover feed: ${pool.feedId}`);
    const result = runFeedQuery({
      feed, series: normalized.catalog, history: normalized.history,
      tags: data.tags, labels: [], settings: DEFAULT_SETTINGS,
    });
    // Do not silently substitute lower-ranked entries when a top cover is missing.
    const picks = result.items.slice(0, 100).map((item, index) => {
      if (!item.cover || !Number.isFinite(item.analytics?.fanFavouriteDiscoveryPercentile)) {
        throw new Error(`Invalid ranked cover in ${pool.id}: ${item.id}`);
      }
      return {
        id: item.id, title: item.display_title, cover: item.cover,
        fanRank: item.analytics.fanFavouriteDiscoveryPercentile, feedRank: index + 1,
      };
    });
    if (picks.length !== 100 || new Set(picks.map(pick => pick.id)).size !== 100) {
      throw new Error(`${pool.id} must contain exactly 100 distinct ranked titles`);
    }
    console.log(`${feed.name}: ${result.items.length} entries, top 100 prepared`);
    return { id: pool.id, name: feed.name, feedId: feed.id, feedCount: result.items.length, picks };
  });
  await writeFile(snapshotPath, JSON.stringify({ generatedAt: new Date().toISOString(), buildId: data.buildId, pools }));
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
