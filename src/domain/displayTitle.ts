import { resolveDisplayTitle } from "./catalog";
import type { SeriesCatalog } from "./types";

export type TitleOverrideMap = Record<number, string | null | undefined>;

export function resolveVisibleTitle(item: SeriesCatalog, overrides?: TitleOverrideMap, fallback?: SeriesCatalog) {
  const override = overrides?.[item.id]?.trim();
  if (override) return override;
  return resolveDisplayTitle(item, fallback);
}
