// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverRetryUrl, ResilientCoverImage } from "./ResilientCoverImage";

describe("ResilientCoverImage", () => {
  const deleteCover = vi.fn().mockResolvedValue(true);
  const openCache = vi.fn().mockResolvedValue({ delete: deleteCover });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { open: openCache },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "caches");
    deleteCover.mockClear();
    openCache.mockClear();
  });

  it("evicts a failed cover and retries it with a fresh cache key", async () => {
    render(<ResilientCoverImage src="https://cdn.mangabaka.dev/cover.jpg" alt="Cover" />);

    fireEvent.error(screen.getByRole("img"));
    await act(async () => Promise.resolve());
    expect(openCache).toHaveBeenCalledWith("manhwa-covers");
    expect(deleteCover).toHaveBeenCalledWith("https://cdn.mangabaka.dev/cover.jpg", { ignoreSearch: true });

    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole("img").getAttribute("src")).toContain("aeonCoverRetry=");
  });

  it("shows a fallback only after both retries fail", () => {
    render(<ResilientCoverImage src="https://cdn.mangabaka.dev/cover.jpg" alt="Cover" fallback={<span>AB</span>} />);

    fireEvent.error(screen.getByRole("img"));
    act(() => vi.advanceTimersByTime(250));
    fireEvent.error(screen.getByRole("img"));
    act(() => vi.advanceTimersByTime(800));
    fireEvent.error(screen.getByRole("img"));

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("AB")).toBeTruthy();
  });

  it("tries again after connectivity returns", () => {
    render(<ResilientCoverImage src="https://cdn.mangabaka.dev/cover.jpg" alt="Cover" fallback={<span>AB</span>} />);

    fireEvent.error(screen.getByRole("img"));
    act(() => vi.advanceTimersByTime(250));
    fireEvent.error(screen.getByRole("img"));
    act(() => vi.advanceTimersByTime(800));
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("AB")).toBeTruthy();

    act(() => window.dispatchEvent(new Event("online")));
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole("img").getAttribute("src")).toContain("aeonCoverRetry=");
  });

  it("preserves existing query parameters when creating a retry URL", () => {
    const retried = new URL(coverRetryUrl("https://cdn.mangabaka.dev/cover.jpg?size=350", "retry-1"));
    expect(retried.searchParams.get("size")).toBe("350");
    expect(retried.searchParams.get("aeonCoverRetry")).toBe("retry-1");
  });
});
