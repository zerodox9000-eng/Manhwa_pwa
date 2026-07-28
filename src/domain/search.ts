import type { SeriesCatalog } from "./types";

export function seriesSearchText(series: SeriesCatalog) {
  return [
    series.display_title,
    series.mangabaka_title,
    series.native_title,
    series.romanized_title,
    ...(series.titles ?? []).map((title) => title.title),
    ...(series.authors ?? []),
    ...(series.artists ?? []),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .toLocaleLowerCase();
}

export function searchWords(query: string) {
  return [...new Set(query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean))];
}

export function matchesSearchTextWords(text: string, words: string[]) {
  return words.length > 0 && words.every((word) => text.includes(word));
}

export function searchTextWordPosition(text: string, words: string[]) {
  return words.reduce((score, word) => score + Math.max(0, text.indexOf(word)), 0);
}

export function rankedDirectSearchMatches<T extends { id: number }>(
  items: T[],
  textById: ReadonlyMap<number, string>,
  words: string[],
  limit: number,
) {
  if (words.length === 0 || limit <= 0) return [];
  const ranked: { item: T; score: number }[] = [];
  for (const item of items) {
    const text = textById.get(item.id) ?? "";
    if (!matchesSearchTextWords(text, words)) continue;
    const score = searchTextWordPosition(text, words);
    let low = 0;
    let high = ranked.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranked[middle].score <= score) low = middle + 1;
      else high = middle;
    }
    ranked.splice(low, 0, { item, score });
    if (ranked.length > limit) ranked.pop();
  }
  return ranked.map(({ item }) => item);
}

export function matchesSearchWords(series: SeriesCatalog, query: string) {
  return matchesSearchTextWords(seriesSearchText(series), searchWords(query));
}

export function searchWordPosition(series: SeriesCatalog, query: string) {
  return searchTextWordPosition(seriesSearchText(series), searchWords(query));
}
