import { createContext, useContext } from "react";
import type { Feed } from "./domain/types";

export type TitleSelectionMode = { kind: "collect" } | { kind: "remove"; feedId: string };
export interface TitleSelectionSnapshot {
  mode: TitleSelectionMode | null;
  selectedIds: ReadonlySet<number>;
}
export interface TitleSelectionStore {
  getSnapshot: () => TitleSelectionSnapshot;
  isSelected: (titleId: number) => boolean;
  subscribe: (titleId: number, listener: () => void) => () => void;
  subscribeAll: (listener: () => void) => () => void;
  replace: (mode: TitleSelectionMode, titleIds: Iterable<number>) => void;
  toggle: (titleId: number) => void;
  clear: () => void;
}
export interface TitleSelectionValue {
  store: TitleSelectionStore;
  begin: (feed: Feed, titleId: number) => void;
  toggle: (feed: Feed, titleId: number) => void;
  beginCollect: (titleId: number) => void;
  toggleCollect: (titleId: number) => void;
  clear: () => void;
}

export function createTitleSelectionStore(): TitleSelectionStore {
  let snapshot: TitleSelectionSnapshot = { mode: null, selectedIds: new Set() };
  const titleListeners = new Map<number, Set<() => void>>();
  const allListeners = new Set<() => void>();
  const publish = (next: TitleSelectionSnapshot) => {
    const changedIds = new Set<number>([...snapshot.selectedIds, ...next.selectedIds]);
    for (const titleId of [...changedIds]) {
      if (snapshot.selectedIds.has(titleId) === next.selectedIds.has(titleId)) changedIds.delete(titleId);
    }
    snapshot = next;
    for (const titleId of changedIds) for (const listener of titleListeners.get(titleId) ?? []) listener();
    for (const listener of allListeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    isSelected: (titleId) => snapshot.selectedIds.has(titleId),
    subscribe: (titleId, listener) => {
      const listeners = titleListeners.get(titleId) ?? new Set<() => void>();
      listeners.add(listener);
      titleListeners.set(titleId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) titleListeners.delete(titleId);
      };
    },
    subscribeAll: (listener) => {
      allListeners.add(listener);
      return () => allListeners.delete(listener);
    },
    replace: (mode, titleIds) => publish({ mode, selectedIds: new Set(titleIds) }),
    toggle: (titleId) => {
      const selectedIds = new Set(snapshot.selectedIds);
      if (selectedIds.has(titleId)) selectedIds.delete(titleId);
      else selectedIds.add(titleId);
      publish({ ...snapshot, selectedIds });
    },
    clear: () => publish({ mode: null, selectedIds: new Set() }),
  };
}

export const TitleSelectionContext = createContext<TitleSelectionValue | null>(null);

export function useTitleSelection() {
  const value = useContext(TitleSelectionContext);
  if (!value) throw new Error("Title selection must be used inside AppFrame");
  return value;
}
