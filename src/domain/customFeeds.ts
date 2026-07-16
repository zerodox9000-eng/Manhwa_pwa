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

export function moveCustomTitleIds(
  sourceIds: number[],
  destinationIds: number[],
  selectedIds: number[],
  placement: CustomFeedPlacement,
) {
  const source = normalizeCustomTitleIds(sourceIds);
  const selected = new Set(normalizeCustomTitleIds(selectedIds));
  const selectedFromSource = source.filter((id) => selected.has(id));
  const inserted = insertCustomTitleIds(destinationIds, selectedFromSource, placement);
  const destinationAfterMove = new Set(inserted.titleIds);
  const movedIds = new Set(selectedFromSource.filter((id) => destinationAfterMove.has(id)));

  return {
    sourceTitleIds: source.filter((id) => !movedIds.has(id)),
    destinationTitleIds: inserted.titleIds,
    moved: movedIds.size,
    added: inserted.added,
    duplicates: inserted.duplicates,
    full: inserted.full,
  };
}

export function mergeReorderedVisibleIds(allIds: number[], orderedVisibleIds: number[]) {
  const visible = new Set(orderedVisibleIds);
  let visibleIndex = 0;
  return allIds.map((id) => visible.has(id) ? orderedVisibleIds[visibleIndex++] ?? id : id);
}
