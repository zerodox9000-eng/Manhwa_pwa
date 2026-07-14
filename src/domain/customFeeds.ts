import type { CustomFeedPlacement } from "./types";

export const CUSTOM_FEED_MAX_TITLES = 500;

export function normalizeCustomTitleIds(ids: number[]) {
  return [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, CUSTOM_FEED_MAX_TITLES);
}

export function insertCustomTitleIds(existingIds: number[], incomingIds: number[], placement: CustomFeedPlacement) {
  const existing = normalizeCustomTitleIds(existingIds);
  const existingSet = new Set(existing);
  const incoming = normalizeCustomTitleIds(incomingIds);
  const fresh = incoming.filter((id) => !existingSet.has(id));
  const accepted = fresh.slice(0, Math.max(0, CUSTOM_FEED_MAX_TITLES - existing.length));
  return {
    titleIds: placement === "bottom" ? [...existing, ...accepted] : [...accepted, ...existing],
    added: accepted.length,
    duplicates: incoming.length - fresh.length,
    full: fresh.length - accepted.length,
  };
}

export function mergeReorderedVisibleIds(allIds: number[], orderedVisibleIds: number[]) {
  const visible = new Set(orderedVisibleIds);
  let visibleIndex = 0;
  return allIds.map((id) => visible.has(id) ? orderedVisibleIds[visibleIndex++] ?? id : id);
}
