import type { HistoryEntry, HistoryMap, SeriesCatalog } from "./types";

const PLACEHOLDER_TITLE = /^(unknown title|untitled|no title|n\/a|-)?$/i;

function cleanText(value?: string | null) {
  return (value ?? "").trim();
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
  const displayTitle = cleanText(item.display_title);

  return {
    display: displayTitle && !PLACEHOLDER_TITLE.test(displayTitle) ? [displayTitle] : [],
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
    tiers.flatMap((tier) => tier.display),
    tiers.flatMap((tier) => tier.englishPrimaryOfficial),
    tiers.flatMap((tier) => tier.englishPrimary),
    tiers.flatMap((tier) => tier.englishOfficial),
    tiers.flatMap((tier) => tier.englishAny),
    tiers.flatMap((tier) => tier.mangabaka),
    tiers.flatMap((tier) => tier.aliases),
    tiers.flatMap((tier) => tier.native),
    tiers.flatMap((tier) => tier.romanized),
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
    item.source?.anilist?.id != null ? `anilist:${item.source.anilist.id}` : "",
    item.source?.mangaupdates?.id ? `mangaupdates:${item.source.mangaupdates.id}` : "",
    item.source?.animeplanet?.id ? `animeplanet:${item.source.animeplanet.id}` : "",
  ].filter(Boolean);
}

export function catalogMergeKeys(item: SeriesCatalog) {
  const keys = sourceKeys(item);
  // A cover is only a safe duplicate key when there is no stronger source
  // identity. Different MangaBaka titles often reuse the same cover image.
  const cover = normalizedCover(item.cover);
  if (keys.length === 0 && cover) keys.push(`cover:${cover}`);
  return keys;
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

function nonBlank(value?: string | null) {
  const text = value?.trim();
  return text ? text : null;
}

function firstValue<T>(primary: T | null | undefined, fallback: T | null | undefined) {
  return primary ?? fallback ?? null;
}

function uniqueStrings(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mergeSourceEntry(left: unknown, right: unknown, preferRight: boolean) {
  const leftObject = objectValue(left);
  const rightObject = objectValue(right);
  if (!leftObject && !rightObject) return null;
  const primary = preferRight ? rightObject : leftObject;
  const fallback = preferRight ? leftObject : rightObject;
  return {
    ...(fallback ?? {}),
    ...(primary ?? {}),
    id: primary?.id ?? fallback?.id,
    rating: primary?.rating ?? fallback?.rating ?? null,
    url: primary?.url ?? fallback?.url ?? null,
  };
}

export function mergeCatalogSources(
  left: SeriesCatalog["source"],
  right: SeriesCatalog["source"],
  preferRight = true,
) {
  const leftObject = objectValue(left);
  const rightObject = objectValue(right);
  if (!leftObject && !rightObject) return null;
  const merged: Record<string, unknown> = {
    ...(leftObject ?? {}),
    ...(rightObject ?? {}),
  };
  for (const key of ["anilist", "animeplanet", "mangaupdates"]) {
    if (leftObject?.[key] !== undefined || rightObject?.[key] !== undefined) {
      merged[key] = mergeSourceEntry(leftObject?.[key], rightObject?.[key], preferRight);
    }
  }
  return merged as SeriesCatalog["source"];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function mergeCatalogLinks(
  left: SeriesCatalog["links"],
  right: SeriesCatalog["links"],
  canonicalId?: number,
  preferRight = true,
) {
  const leftObject = objectValue(left);
  const rightObject = objectValue(right);
  if (!leftObject && !rightObject) return undefined;
  const primary = preferRight ? rightObject : leftObject;
  const fallback = preferRight ? leftObject : rightObject;
  const readLinks = uniqueStrings([
    ...stringArray(fallback?.read_en_all),
    fallback?.read_en,
    ...stringArray(primary?.read_en_all),
    primary?.read_en,
  ]);
  const selectedReadLink = nonBlank(
    typeof primary?.read_en === "string" ? primary.read_en : null,
  ) ?? nonBlank(
    typeof fallback?.read_en === "string" ? fallback.read_en : null,
  ) ?? readLinks[0] ?? null;
  const mangabaka = nonBlank(
    typeof primary?.mangabaka === "string" ? primary.mangabaka : null,
  ) ?? nonBlank(
    typeof fallback?.mangabaka === "string" ? fallback.mangabaka : null,
  );
  const merged: Record<string, unknown> = {
    ...(fallback ?? {}),
    ...(primary ?? {}),
    mangabaka: mangabaka && canonicalId != null ? `https://mangabaka.org/${canonicalId}` : mangabaka,
    read_en: selectedReadLink,
    read_en_all: uniqueStrings([...readLinks, selectedReadLink]),
    official_en: nonBlank(
      typeof primary?.official_en === "string" ? primary.official_en : null,
    ) ?? nonBlank(
      typeof fallback?.official_en === "string" ? fallback.official_en : null,
    ),
  };
  return merged as SeriesCatalog["links"];
}

function mergeTitles(left?: SeriesCatalog["titles"], right?: SeriesCatalog["titles"], preferRight = true) {
  const primary = preferRight ? right : left;
  const fallback = preferRight ? left : right;
  const seen = new Set<string>();
  return [...(primary ?? []), ...(fallback ?? [])].filter((title) => {
    const key = [title.language, title.title, ...title.traits, title.is_primary, title.note].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeAnalytics(left: SeriesCatalog["analytics"], right: SeriesCatalog["analytics"], preferRight: boolean) {
  const merged: Record<string, unknown> = {
    ...(left ?? {}),
    ...(right ?? {}),
  };
  const primary = preferRight ? right : left;
  const fallback = preferRight ? left : right;
  for (const key of [
    "fanFavouriteRaw",
    "fanRatioPercentile",
    "popularityPercentile",
    "fanFavouriteDiscoveryScore",
    "fanFavouriteDiscoveryPercentile",
    "fanFavouriteWeighted",
    "fanFavouritePercentile",
  ] as const) {
    if (primary?.[key] !== undefined || fallback?.[key] !== undefined) {
      merged[key] = firstValue(primary?.[key], fallback?.[key]);
    }
  }
  return merged;
}

function mergePublished(left: SeriesCatalog["published"], right: SeriesCatalog["published"], preferRight: boolean) {
  const merged: Record<string, unknown> = {
    ...(left ?? {}),
    ...(right ?? {}),
  };
  const primary = preferRight ? right : left;
  const fallback = preferRight ? left : right;
  for (const key of ["start_date", "end_date", "start_date_is_estimated", "end_date_is_estimated"] as const) {
    if (primary?.[key] !== undefined || fallback?.[key] !== undefined) {
      merged[key] = firstValue(primary?.[key], fallback?.[key]);
    }
  }
  return merged;
}

function chooseDate(left?: string | null, right?: string | null, mode: "earliest" | "latest" = "earliest") {
  const values = [left, right].filter((value): value is string => Boolean(value?.trim()));
  if (values.length < 2) return values[0] ?? null;
  const [leftTime, rightTime] = values.map((value) => Date.parse(value));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return mode === "earliest"
      ? (leftTime <= rightTime ? values[0] : values[1])
      : (leftTime >= rightTime ? values[0] : values[1]);
  }
  return mode === "earliest"
    ? (values[0] <= values[1] ? values[0] : values[1])
    : (values[0] >= values[1] ? values[0] : values[1]);
}

function mergeContentRating(left: SeriesCatalog["content_rating"], right: SeriesCatalog["content_rating"]) {
  const ratings = [left, right]
    .map((value) => nonBlank(value))
    .filter((value): value is string => Boolean(value));
  if (ratings.length === 0) return null;
  const rank = new Map([["safe", 0], ["suggestive", 1], ["erotica", 2], ["pornographic", 3]]);
  return ratings.sort((a, b) => (rank.get(b.toLocaleLowerCase()) ?? -1) - (rank.get(a.toLocaleLowerCase()) ?? -1))[0];
}

function mergeType(left: SeriesCatalog["type"], right: SeriesCatalog["type"], preferred: SeriesCatalog, secondary: SeriesCatalog) {
  if ([left, right].some((value) => value?.toLocaleLowerCase() === "oel")) return "oel";
  return firstValue(preferred.type, secondary.type);
}

export function mergeCatalogRecords(left: SeriesCatalog, right: SeriesCatalog) {
  const rightIsNewer =
    new Date(right.last_updated_at ?? 0).getTime() >= new Date(left.last_updated_at ?? 0).getTime();
  const preferred = recordScore(right) > recordScore(left) ? right : left;
  const secondary = preferred === right ? left : right;
  const titles = mergeTitles(left.titles, right.titles, preferred === right);
  const links = mergeCatalogLinks(left.links, right.links, preferred.id, rightIsNewer);
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
    mangabaka_title: preferred.mangabaka_title ?? secondary.mangabaka_title ?? null,
    native_title: preferred.native_title ?? secondary.native_title ?? null,
    romanized_title: preferred.romanized_title ?? secondary.romanized_title ?? null,
    titles,
    anilist_first_seen_at: chooseDate(left.anilist_first_seen_at, right.anilist_first_seen_at),
    display_title: resolveDisplayTitle(
      { ...secondary, titles } satisfies SeriesCatalog,
      { ...preferred, titles } satisfies SeriesCatalog,
    ),
    stats: {
      popularity: newestNumber(left.stats?.popularity, right.stats?.popularity, rightIsNewer),
      favourites: newestNumber(left.stats?.favourites, right.stats?.favourites, rightIsNewer),
      meanScore: newestNumber(left.stats?.meanScore, right.stats?.meanScore, rightIsNewer),
    },
    analytics: mergeAnalytics(left.analytics, right.analytics, rightIsNewer),
    tag_ids: unique([...(left.tag_ids ?? []), ...(right.tag_ids ?? [])]),
    ...(left.tag_weights || right.tag_weights
      ? {
          tag_weights: {
            ...(rightIsNewer ? left.tag_weights ?? {} : right.tag_weights ?? {}),
            ...(rightIsNewer ? right.tag_weights ?? {} : left.tag_weights ?? {}),
          },
        }
      : {}),
    authors: unique([...(preferred.authors ?? []), ...(secondary.authors ?? [])]),
    artists: unique([...(preferred.artists ?? []), ...(secondary.artists ?? [])]),
    links,
    source: mergeCatalogSources(left.source, right.source, rightIsNewer),
    content_rating: mergeContentRating(left.content_rating, right.content_rating),
    type: mergeType(left.type, right.type, preferred, secondary),
    published: mergePublished(left.published, right.published, rightIsNewer),
    first_seen_at: chooseDate(left.first_seen_at, right.first_seen_at),
    created_at: chooseDate(left.created_at, right.created_at),
    added_at: chooseDate(left.added_at, right.added_at),
    first_seen_at_is_trusted: Boolean(left.first_seen_at_is_trusted || right.first_seen_at_is_trusted),
    last_updated_at: chooseDate(left.last_updated_at, right.last_updated_at, "latest"),
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
    if (!parent.has(item.id)) parent.set(item.id, item.id);
    for (const mergedId of item.merged_ids ?? []) {
      if (!parent.has(mergedId)) parent.set(mergedId, mergedId);
      union(item.id, mergedId);
    }
    const keys = catalogMergeKeys(item);
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
    const merged = records.reduce(mergeCatalogRecords);
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
    // A supplied estimated date is still the title's release placement.
    // Discovery/update timestamps are catalogue metadata, never release-date fallbacks.
    const hasStartDate = Boolean(published.start_date);
    const hasActualStartDate = Boolean(published.start_date && !published.start_date_is_estimated);
    if (!hasStartDate) {
      published.start_date = null;
      published.start_date_is_estimated = false;
    }
    if (published.end_date_is_estimated) {
      published.end_date = null;
      published.end_date_is_estimated = false;
    }
    const canonical = {
      ...merged,
      merged_ids: ids,
      display_title: resolveDisplayTitle(merged),
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
