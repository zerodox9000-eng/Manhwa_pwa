import { resolveDisplayTitle } from "./catalog";
import type { SeriesCatalog } from "./types";

export function resolveVisibleTitle(item: SeriesCatalog, fallback?: SeriesCatalog) {
  return resolveDisplayTitle(item, fallback);
}
