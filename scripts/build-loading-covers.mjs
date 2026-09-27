import { readFile, writeFile, mkdir, access, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

// Offline input is the verified top 100 from each normal Discover feed.
// This builds display assets only. It never calls a catalog pipeline.
const root = path.resolve(import.meta.dirname, '..');
const snapshot = JSON.parse(await readFile(path.join(root, 'scripts/assets/loading-cover-pools.json'), 'utf8'));
const output = path.join(root, 'public/loading-covers');
await mkdir(output, { recursive: true });
await mkdir(path.join(root, 'src/assets'), { recursive: true });
const unique = new Map(snapshot.pools.flatMap(pool => pool.picks.map(pick => [pick.cover, pick])));
const local = new Map();
const queue = [...unique.values()];
let completed = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const pick = queue.shift();
    const filename = `${pick.id}-${createHash('sha256').update(pick.cover).digest('hex').slice(0, 10)}.webp`;
    const target = path.join(output, filename);
    try { await access(target); } catch {
      let data;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(pick.cover, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error(`Cover ${pick.id}: HTTP ${response.status}`);
          data = await sharp(Buffer.from(await response.arrayBuffer())).resize(120, 167, { fit: 'cover' }).webp({ quality: 65 }).toBuffer();
          break;
        } catch (error) { if (attempt === 2) throw error; }
      }
      await writeFile(target, data);
    }
    local.set(pick.cover, filename);
    completed++;
    if (completed % 50 === 0) console.log(`${completed}/${unique.size} cover assets prepared`);
  }
}));
const pools = [];
for (const pool of snapshot.pools) {
  const picks = pool.picks.map(pick => ({ ...pick, cover: `loading-covers/${local.get(pick.cover)}` }));
  pools.push({ ...pool, picks });
}
await writeFile(path.join(root, 'src/assets/loadingCovers.generated.json'), JSON.stringify({ generatedAt: snapshot.generatedAt, pools }));
// Remove only generated thumbnails no longer referenced by the successful build.
const retained = new Set(local.values());
for (const filename of await readdir(output)) {
  if (/^\d+-[a-f0-9]{10}\.webp$/.test(filename) && !retained.has(filename)) {
    await unlink(path.join(output, filename));
  }
}
console.log(`Built ${pools.length} ranked sets with ${unique.size} real small covers. No substitute preview imagery.`);
