// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { useUpdateCardSelection } from "./TrendsPage";
import { createTitleSelectionStore, TitleSelectionContext, type TitleSelectionValue } from "./titleSelection";

describe("Updates title selection", () => {
  it("starts the standard Add-to-MY-LIST collection flow on hold", () => {
    vi.useFakeTimers();
    const store = createTitleSelectionStore();
    const beginCollect = vi.fn((titleId: number) => store.replace({ kind: "collect" }, [titleId]));
    const value: TitleSelectionValue = {
      store,
      begin: vi.fn(),
      toggle: vi.fn(),
      beginCollect,
      toggleCollect: vi.fn(),
      clear: vi.fn(),
    };
    const wrapper = ({ children }: PropsWithChildren) => (
      <TitleSelectionContext.Provider value={value}>{children}</TitleSelectionContext.Provider>
    );
    const { result } = renderHook(() => useUpdateCardSelection(42, vi.fn()), { wrapper });

    act(() => {
      result.current.onPointerDown({ pointerType: "touch", button: 0, clientX: 20, clientY: 20 } as never);
      vi.advanceTimersByTime(320);
    });

    expect(beginCollect).toHaveBeenCalledWith(42);
    expect(store.getSnapshot().mode).toEqual({ kind: "collect" });
    expect(store.isSelected(42)).toBe(true);
    vi.useRealTimers();
  });

  it("prepares detail navigation on a normal click", () => {
    const store = createTitleSelectionStore();
    const onOpen = vi.fn();
    const value: TitleSelectionValue = {
      store,
      begin: vi.fn(),
      toggle: vi.fn(),
      beginCollect: vi.fn(),
      toggleCollect: vi.fn(),
      clear: vi.fn(),
    };
    const wrapper = ({ children }: PropsWithChildren) => (
      <TitleSelectionContext.Provider value={value}>{children}</TitleSelectionContext.Provider>
    );
    const { result } = renderHook(() => useUpdateCardSelection(42, onOpen), { wrapper });

    act(() => result.current.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() } as never));

    expect(onOpen).toHaveBeenCalledOnce();
  });
});
