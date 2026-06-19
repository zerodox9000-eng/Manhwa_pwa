import type { HistoryEntry, HistoryMap, SeriesCatalog } from "./types";

const PLACEHOLDER_TITLE = /^(unknown title|untitled|no title|n\/a|-)?$/i;

function cleanText(value?: string | null) {
  return (value ?? "").trim();
}

function titleCaseSlug(value: string) {
  const minorWords = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "per", "the", "to", "vs", "via", "with"]);
  const words = decodeURIComponent(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  return words
    .map((word, index) => {
      const lower = word.toLocaleLowerCase();
      if (index > 0 && minorWords.has(lower)) return lower;
      return lower.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase());
    })
    .join(" ");
}

function lastUrlSegment(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) ?? null;
  } catch {
    return null;
  }
}

function candidateStrings(values: unknown[]) {
  return values
    .flatMap((candidate) => {
      if (typeof candidate === "string") return [candidate];
      if (candidate && typeof candidate === "object") return Object.values(candidate).filter((value): value is string => typeof value === "string");
      return [];
    })
    .map(cleanText)
    .filter((candidate) => candidate && !PLACEHOLDER_TITLE.test(candidate));
}

function sourceTitleCandidates(item: SeriesCatalog) {
  const candidates: string[] = [];
  const animePlanetSlug = item.source?.animeplanet?.id ?? lastUrlSegment(item.source?.animeplanet?.url);
  if (animePlanetSlug) candidates.push(titleCaseSlug(animePlanetSlug));

  const readSlug = lastUrlSegment(item.links?.read_en);
  if (readSlug && !/^(info|list|detail|series)$/i.test(readSlug)) candidates.push(titleCaseSlug(readSlug));

  return candidates;
}

function titleEntryGroups(item: SeriesCatalog) {
  const raw = item as SeriesCatalog & Record<string, unknown>;
  const titleValues: unknown[] = Array.isArray(raw.titles) ? raw.titles : [];
  const englishTitles = titleValues
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    .filter((title) => cleanText(typeof title.language === "string" ? title.language : typeof title.lang === "string" ? title.lang : null).toLocaleLowerCase() === "en")
    .map((title) => ({
      title: cleanText(typeof title.title === "string" ? title.title : typeof title.value === "string" ? title.value : typeof title.name === "string" ? title.name : null),
      traits: Array.isArray(title.traits) ? title.traits.map(String) : [],
      isPrimary: title.is_primary === true || title.isPrimary === true,
    }))
    .filter((title) => title.title && !PLACEHOLDER_TITLE.test(title.title));

  return {
    primaryOfficial: englishTitles.filter((title) => title.isPrimary && title.traits.includes("official")).map((title) => title.title),
    primary: englishTitles.filter((title) => title.isPrimary).map((title) => title.title),
    official: englishTitles.filter((title) => title.traits.includes("official")).map((title) => title.title),
    anyEnglish: englishTitles.map((title) => title.title),
  };
}

function preferredTitleCandidates(item: SeriesCatalog) {
  const raw = item as SeriesCatalog & Record<string, unknown>;
  const titleGroups = titleEntryGroups(item);
  const animePlanet = candidateStrings([
    item.animeplanet_title,
    raw.animeplanet_title,
    raw.animePlanetTitle,
    raw.animeplanetTitle,
  ]);
  const explicitEnglish = candidateStrings([
    raw.english_title,
    raw.title_english,
    raw.englishTitle,
    raw.titleEnglish,
    raw.nameEnglish,
  ]);
  const displayTitle = cleanText(item.display_title);
  const bestEnglishTitle = firstCandidate([
    titleGroups.primaryOfficial,
    titleGroups.primary,
    titleGroups.official,
    titleGroups.anyEnglish,
  ]);
  const rawTitles = new Set(
    candidateStrings([
      item.mangabaka_title,
      raw.mangabakaTitle,
      raw.series_title,
      raw.original_title,
      raw.title,
      raw.name,
      item.native_title,
      item.romanized_title,
    ]).map((title) => title.toLocaleLowerCase()),
  );
  const displayIsRawAlias = rawTitles.has(displayTitle.toLocaleLowerCase());
  const betterEnglishTitleExists = Boolean(
    bestEnglishTitle &&
      displayTitle &&
      bestEnglishTitle.toLocaleLowerCase() !== displayTitle.toLocaleLowerCase(),
  );

  return {
    animeplanet: animePlanet,
    display:
      displayTitle &&
      !PLACEHOLDER_TITLE.test(displayTitle) &&
      !(displayIsRawAlias && betterEnglishTitleExists)
        ? [displayTitle]
        : [],
    explicitEnglish,
    englishPrimaryOfficial: titleGroups.primaryOfficial,
    englishPrimary: titleGroups.primary,
    englishOfficial: titleGroups.official,
    englishAny: titleGroups.anyEnglish,
    mangabaka: candidateStrings([item.mangabaka_title, raw.mangabakaTitle, raw.series_title, raw.original_title, raw.title, raw.name]),
    aliases: (() => {
      const aliases = raw.aliases ?? raw.alternative_titles ?? raw.synonyms;
      const candidates: unknown[] = [raw.preferred_title, raw.main_title];
      if (Array.isArray(aliases)) candidates.push(...aliases);
      else if (aliases && typeof aliases === "object") candidates.push(...Object.values(aliases));
      return candidateStrings(candidates);
    })(),
    native: candidateStrings([item.native_title]),
    romanized: candidateStrings([item.romanized_title]),
    sources: sourceTitleCandidates(item),
  };
}

function firstCandidate(groups: string[][]) {
  const seen = new Set<string>();
  for (const group of groups) {
    for (const candidate of group) {
      const key = candidate.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        return candidate;
      }
    }
  }
  return null;
}

export function resolveDisplayTitle(item: SeriesCatalog, fallback?: SeriesCatalog) {
  const records = fallback ? [fallback, item] : [item];
  const tiers = records.map(preferredTitleCandidates);
  const title = firstCandidate([
    tiers.flatMap((tier) => tier.animeplanet),
    tiers.flatMap((tier) => tier.display),
    tiers.flatMap((tier) => tier.explicitEnglish),
    tiers.flatMap((tier) => tier.englishPrimaryOfficial),
    tiers.flatMap((tier) => tier.englishPrimary),
    tiers.flatMap((tier) => tier.englishOfficial),
    tiers.flatMap((tier) => tier.englishAny),
    tiers.flatMap((tier) => tier.mangabaka),
    tiers.flatMap((tier) => tier.aliases),
    tiers.flatMap((tier) => tier.native),
    tiers.flatMap((tier) => tier.romanized),
    tiers.flatMap((tier) => tier.sources),
    [cleanText(item.display_title)],
  ]);
  return title || "Unknown Title";
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
    animeplanet_title: preferred.animeplanet_title ?? secondary.animeplanet_title ?? null,
    mangabaka_title: preferred.mangabaka_title ?? secondary.mangabaka_title ?? null,
    native_title: preferred.native_title ?? secondary.native_title ?? null,
    romanized_title: preferred.romanized_title ?? secondary.romanized_title ?? null,
    anilist_first_seen_at: preferred.anilist_first_seen_at ?? secondary.anilist_first_seen_at ?? null,
    display_title: resolveDisplayTitle(secondary, preferred),
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
    first_seen_at: left.first_seen_at ?? right.first_seen_at ?? null,
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

function datePart(value?: string | null) {
  return value?.slice(0, 10) ?? null;
}

function previousRecordForIds(records: number[], previousCatalog?: Map<number, SeriesCatalog>) {
  if (!previousCatalog) return null;
  for (const id of records) {
    const item = previousCatalog.get(id);
    if (item) return item;
  }
  return null;
}

export function normalizeCatalog(
  catalog: SeriesCatalog[],
  history: HistoryMap,
  previousCatalog?: Map<number, SeriesCatalog>,
  syncTimestamp?: string | null,
): { catalog: SeriesCatalog[]; history: HistoryMap } {
  const globalHistoryFirstDate =
    Object.values(history)
      .flatMap((entries) => entries.map((entry) => entry.d))
      .sort()[0] ?? null;
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
    const cover = normalizedCover(item.cover);
    const keys = [
      ...sourceKeys(item),
      cover ? `cover:${cover}` : "",
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
    const previous = previousRecordForIds(ids, previousCatalog);
    const explicitFirstSeen =
      datePart(merged.first_seen_at) ??
      datePart(merged.created_at) ??
      datePart(merged.added_at) ??
      null;
    const historyFirstSeen = entries[0]?.d && entries[0].d !== globalHistoryFirstDate ? entries[0].d : null;
    const lastUpdatedDate = datePart(merged.last_updated_at);
    const firstSeen = explicitFirstSeen ?? historyFirstSeen ?? lastUpdatedDate;
    const currentAniListSeen = datePart(merged.anilist_first_seen_at);
    const previousAniListSeen = datePart(previous?.anilist_first_seen_at);
    const hadAniListBefore = Boolean(previous?.source?.anilist);
    const hasAniListNow = Boolean(merged.source?.anilist);
    const anilistFirstSeen =
      currentAniListSeen ??
      previousAniListSeen ??
      (hasAniListNow && !hadAniListBefore ? datePart(syncTimestamp) : null) ??
      (hasAniListNow ? firstSeen : null);
    const published = { ...(merged.published ?? {}) };
    const hasActualStartDate = Boolean(published.start_date && !published.start_date_is_estimated);
    if (!hasActualStartDate) {
      published.start_date = firstSeen ?? lastUpdatedDate ?? null;
      published.start_date_is_estimated = Boolean(firstSeen);
    }
    if (published.end_date_is_estimated) {
      published.end_date = null;
      published.end_date_is_estimated = false;
    }
    const canonical = {
      ...merged,
      merged_ids: ids,
      display_title: resolveDisplayTitle(merged),
      animeplanet_title: merged.animeplanet_title ?? null,
      first_seen_at: firstSeen,
      anilist_first_seen_at: anilistFirstSeen,
      published,
      year: hasActualStartDate ? Number(published.start_date!.slice(0, 4)) : merged.year,
    };
    normalizedHistory[String(canonical.id)] = entries;
    return canonical;
  });

  return {
    catalog: normalizedCatalog.sort((a, b) => a.id - b.id),
    history: normalizedHistory,
  };
}
