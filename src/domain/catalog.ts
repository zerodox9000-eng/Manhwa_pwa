import type { HistoryEntry, HistoryMap, SeriesCatalog } from "./types";

const PLACEHOLDER_TITLE = /^(unknown title|untitled|no title|n\/a|-)?$/i;

function cleanText(value?: string | null) {
  return (value ?? "").trim();
}

function normalizedTitle(value?: string | null) {
  return cleanText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizedCover(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().toLocaleLowerCase();
  } catch {
    return value.split("?")[0].toLocaleLowerCase();
  }
}

function sourceKeys(item: SeriesCatalog) {
  return [
    item.source?.anilist?.id ? `anilist:${item.source.anilist.id}` : "",
    item.source?.mangaupdates?.id ? `mangaupdates:${item.source.mangaupdates.id}` : "",
    item.source?.animeplanet?.id ? `animeplanet:${item.source.animeplanet.id}` : "",
  ].filter(Boolean);
}

function recordScore(item: SeriesCatalog) {
  let score = 0;
  if (!PLACEHOLDER_TITLE.test(cleanText(item.display_title))) score += 100;
  if (item.cover) score += 20;
  if (item.source?.anilist) score += 12;
  if (item.source?.mangaupdates) score += 6;
  if (item.source?.animeplanet) score += 4;
  score += item.tag_ids?.length ?? 0;
  if (item.authors?.length) score += 4;
  if (item.published?.start_date) score += 3;
  return score;
}

function newestNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  preferRight: boolean,
): number | null {
  return (preferRight ? right ?? left : left ?? right) ?? null;
}

function unique<T>(values: (T | null | undefined)[]) {
  return [...new Set(values.filter((value): value is T => value != null))];
}

function mergeRecord(left: SeriesCatalog, right: SeriesCatalog) {
  const rightIsNewer =
    new Date(right.last_updated_at ?? 0).getTime() >= new Date(left.last_updated_at ?? 0).getTime();
  const preferred = recordScore(right) > recordScore(left) ? right : left;
  const secondary = preferred === right ? left : right;
  return {
    ...secondary,
    ...preferred,
    id: preferred.id,
    merged_ids: unique([
      left.id,
      right.id,
      ...(left.merged_ids ?? []),
      ...(right.merged_ids ?? []),
    ]),
    display_title: PLACEHOLDER_TITLE.test(cleanText(preferred.display_title))
      ? secondary.display_title
      : preferred.display_title,
    stats: {
      popularity: newestNumber(left.stats?.popularity, right.stats?.popularity, rightIsNewer),
      favourites: newestNumber(left.stats?.favourites, right.stats?.favourites, rightIsNewer),
      meanScore: newestNumber(left.stats?.meanScore, right.stats?.meanScore, rightIsNewer),
    },
    analytics: {
      ...(rightIsNewer ? left.analytics : right.analytics),
      ...(rightIsNewer ? right.analytics : left.analytics),
    },
    tag_ids: unique([...(left.tag_ids ?? []), ...(right.tag_ids ?? [])]),
    authors: unique([...(left.authors ?? []), ...(right.authors ?? [])]),
    artists: unique([...(left.artists ?? []), ...(right.artists ?? [])]),
    links: { ...(left.links ?? {}), ...(right.links ?? {}) },
    source: {
      ...(left.source ?? {}),
      ...(right.source ?? {}),
    },
    published: {
      ...(left.published ?? {}),
      ...(right.published ?? {}),
    },
    last_updated_at: rightIsNewer ? right.last_updated_at ?? left.last_updated_at : left.last_updated_at,
  } satisfies SeriesCatalog;
}

function mergeHistoryEntries(groups: HistoryEntry[][]) {
  const byDate = new Map<string, HistoryEntry>();
  for (const entry of groups.flat()) {
    const existing = byDate.get(entry.d);
    if (!existing || entry.p > existing.p || entry.f > existing.f) byDate.set(entry.d, entry);
  }
  return [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d));
}

export function normalizeCatalog(
  catalog: SeriesCatalog[],
  history: HistoryMap,
): { catalog: SeriesCatalog[]; history: HistoryMap } {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    const value = parent.get(id) ?? id;
    if (value === id) return id;
    const root = find(value);
    parent.set(id, root);
    return root;
  };
  const union = (a: number, b: number) => {
    const ar = find(a);
    const br = find(b);
    if (ar !== br) parent.set(br, ar);
  };
  const keyOwner = new Map<string, number>();

  for (const item of catalog) {
    parent.set(item.id, item.id);
    const title = normalizedTitle(item.display_title);
    const cover = normalizedCover(item.cover);
    const keys = [
      ...sourceKeys(item),
      cover ? `cover:${cover}` : "",
      title && !PLACEHOLDER_TITLE.test(item.display_title) ? `title:${title}` : "",
    ].filter(Boolean);
    for (const key of keys) {
      const owner = keyOwner.get(key);
      if (owner != null) union(item.id, owner);
      else keyOwner.set(key, item.id);
    }
  }

  const groups = new Map<number, SeriesCatalog[]>();
  for (const item of catalog) {
    const root = find(item.id);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  }

  const normalizedHistory: HistoryMap = {};
  const normalizedCatalog = [...groups.values()].map((records) => {
    const merged = records.reduce(mergeRecord);
    const ids = unique(records.flatMap((record) => [record.id, ...(record.merged_ids ?? [])]));
    const entries = mergeHistoryEntries(ids.map((id) => history[String(id)] ?? []));
    const firstSeen =
      entries[0]?.d ??
      merged.first_seen_at?.slice(0, 10) ??
      merged.created_at?.slice(0, 10) ??
      merged.added_at?.slice(0, 10) ??
      null;
    const published = { ...(merged.published ?? {}) };
    if (!published.start_date || published.start_date_is_estimated) {
      published.start_date = firstSeen ?? published.start_date ?? null;
      published.start_date_is_estimated = Boolean(firstSeen);
    }
    const canonical = {
      ...merged,
      merged_ids: ids,
      first_seen_at: firstSeen,
      published,
      year: published.start_date ? Number(published.start_date.slice(0, 4)) : merged.year,
    };
    normalizedHistory[String(canonical.id)] = entries;
    return canonical;
  });

  return {
    catalog: normalizedCatalog.sort((a, b) => a.id - b.id),
    history: normalizedHistory,
  };
}
