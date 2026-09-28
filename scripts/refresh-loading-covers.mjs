import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

// Use the shipped query implementation, not a second ranking/filter algorithm.
const root = path.resolve(import.meta.dirname, '..');
const snapshotPath = path.join(root, 'scripts/assets/loading-cover-pools.json');
const trendingFeeds = [
  { id: 'top-1', feedId: '3557ab43-3ca8-4214-a4e8-fae07f1571b6', name: 'TOP 1% TRENDING' },
  { id: 'mainstream', feedId: 'default-feed-5', name: 'TRENDING MAINSTREAM' },
  { id: 'upcoming', feedId: 'default-feed-6', name: 'TRENDING UPCOMING' },
  { id: 'underground', feedId: 'default-feed-7', name: 'TRENDING UNDERGROUND' },
  { id: 'deep-cut', feedId: 'default-feed-8', name: 'TRENDING DEEP CUT' },
];
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
  const [{ fetchChunkedFrontendData }, { selectLoadingCoverTitles, LOADING_COVER_COUNT }, { normalizeCatalog }] = await Promise.all([
    server.ssrLoadModule('/src/services/chunkedData.ts'),
    server.ssrLoadModule('/src/domain/loadingCoverSelection.ts'),
    server.ssrLoadModule('/src/domain/catalog.ts'),
  ]);
  const data = await fetchChunkedFrontendData(
    'https://raw.githubusercontent.com/zerodox9000-eng/manhwa_db/main/db/exports/frontend',
    console.log, { includeRecommendations: false },
  );
  const normalized = normalizeCatalog(data.catalog, data.history);
  let latestHistoryDate = '';
  for (const entries of Object.values(normalized.history)) {
    for (const entry of entries) if (entry.d > latestHistoryDate) latestHistoryDate = entry.d;
  }
  const feeds = JSON.parse(await readFile(path.join(root, 'src/domain/defaultFeeds.generated.json'), 'utf8'));
  const pools = trendingFeeds.map(pool => {
    const feed = feeds.find(item => item.id === pool.feedId);
    if (!feed || feed.name.trim() !== pool.name) throw new Error(`Missing shipped Trending feed: ${pool.feedId}`);
    const result = selectLoadingCoverTitles(feed, normalized.catalog, data.tags, normalized.history, latestHistoryDate);
    // Do not silently substitute lower-ranked entries when a top cover is missing.
    const picks = result.items.map((item, index) => {
      if (!item.cover) {
        throw new Error(`Invalid ranked cover in ${pool.id}: ${item.id}`);
      }
      return {
        id: item.id, title: item.display_title, cover: item.cover,
        fanRank: item.analytics?.fanFavouriteDiscoveryPercentile ?? null, feedRank: index + 1,
      };
    });
    if (picks.length !== LOADING_COVER_COUNT || new Set(picks.map(pick => pick.id)).size !== LOADING_COVER_COUNT) {
      throw new Error(`${pool.id} must contain exactly ${LOADING_COVER_COUNT} distinct ranked titles`);
    }
    console.log(`${feed.name}: ${result.feedCount} eligible entries, top ${LOADING_COVER_COUNT} safety-checked`);
    console.log(`First five: ${picks.slice(0, 5).map(pick => pick.title).join(' | ')}`);
    return { id: pool.id, name: feed.name, feedId: feed.id, feedCount: result.feedCount, picks };
  });
  await writeFile(snapshotPath, JSON.stringify({ generatedAt: new Date().toISOString(), buildId: data.buildId, pools }));
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
