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

export function matchesSearchWords(series: SeriesCatalog, query: string) {
  return matchesSearchTextWords(seriesSearchText(series), searchWords(query));
}

export function searchWordPosition(series: SeriesCatalog, query: string) {
  return searchTextWordPosition(seriesSearchText(series), searchWords(query));
}
