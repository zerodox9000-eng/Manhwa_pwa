// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AeonLoadingScreen, chooseLoadingPool, chooseLoadingStartIndex, loadingCoverOrder, loadingProgressTarget, LOADING_BACKGROUNDS } from "./AeonLoadingScreen";
import { parseSettings } from "../domain/validation";
import data from "../assets/loadingCovers.generated.json";
import rankedSnapshot from "../../scripts/assets/loading-cover-pools.json";

const motionAnimations: { currentTime: number; cancel: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  sessionStorage.clear();
  motionAnimations.length = 0;
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: vi.fn(() => {
    let start = performance.now();
    const animation = {
      get currentTime() { return performance.now() - start; },
      set currentTime(value: number) { start = performance.now() - value; },
      cancel: vi.fn(),
    };
    motionAnimations.push(animation);
    return animation as unknown as Animation;
  }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); Reflect.deleteProperty(HTMLElement.prototype, "animate"); });

describe("loading cover sets and settings", () => {
  it("has exactly 50 unique sequentially ranked titles in every Trending set", () => {
    expect(data.pools).toHaveLength(5);
    for (const pool of data.pools) {
      expect(pool.picks).toHaveLength(50);
      expect(new Set(pool.picks.map(pick => pick.id)).size).toBe(50);
      expect(pool.picks.map(pick => pick.feedRank)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      expect(pool.picks.every(pick => pick.cover.startsWith("loading-covers/"))).toBe(true);
      expect("preview" in pool).toBe(false);
    }
    for (const pool of data.pools) {
      const source = rankedSnapshot.pools.find(item => item.id === pool.id)!;
      expect(pool.picks.map(pick => [pick.id, pick.title, pick.fanRank, pick.feedRank]))
        .toEqual(source.picks.map(pick => [pick.id, pick.title, pick.fanRank, pick.feedRank]));
    }
  });
  it("preserves fixed choices and avoids the previous random set", () => {
    for (const option of LOADING_BACKGROUNDS.slice(1)) {
      expect(chooseLoadingPool(option.id, option.id, () => .8).id).toBe(option.id);
      expect(parseSettings({ loadingBackground: option.id })?.loadingBackground).toBe(option.id);
    }
    expect(chooseLoadingPool("random", "top-1", () => 0).id).not.toBe("top-1");
    expect(parseSettings({ appName: "Old backup" })).toEqual({ appName: "Old backup" });
  });
  it("never reaches 100% before real readiness", () => {
    expect(loadingProgressTarget(1, 999999, false)).toBeLessThan(1);
    expect(loadingProgressTarget(0, 10000, false)).toBeGreaterThan(loadingProgressTarget(0, 0, false));
    expect(loadingProgressTarget(null, 0, true)).toBe(1);
  });
  it("can start from any of the 50 ranks without breaking the closed ranked sequence", () => {
    const starts = Array.from({ length: 50 }, (_, index) => chooseLoadingStartIndex(50, null, () => (index + .01) / 50));
    expect(new Set(starts).size).toBe(50);
    expect(chooseLoadingStartIndex(50, 24, () => 24 / 49)).not.toBe(24);
    const order = loadingCoverOrder(Array.from({ length: 50 }, (_, i) => i + 1), 24);
    expect(order).toEqual([...Array.from({ length: 26 }, (_, i) => i + 25), ...Array.from({ length: 24 }, (_, i) => i + 1)]);
  });
});

describe("background reveal", () => {
  it("starts with the real moving conveyor and genuinely empty unloaded slots, never a substitute poster", () => {
    const { container } = render(<AeonLoadingScreen background="top-1" appName="Aeon" complete={false} progress={.2} />);
    expect(container.querySelector(".aeon-loading-poster")).toBeNull();
    expect(container.querySelector(".aeon-loading-ghost")).toBeNull();
    expect(container.querySelectorAll(".aeon-loading-cover")).toHaveLength(100);
    expect(new Set(Array.from(container.querySelectorAll(".aeon-loading-cover")).map(tile => tile.getAttribute("data-title"))).size).toBe(50);
    expect(container.querySelectorAll(".has-cover")).toHaveLength(0);
    expect(Array.from(container.querySelectorAll<HTMLImageElement>(".aeon-loading-cover img")).every(image => image.src.includes("/loading-covers/"))).toBe(true);
    expect(motionAnimations).toHaveLength(7);
  });
  it("places a randomly selected ranked title at the center-left starting lane", () => {
    vi.spyOn(Math, "random").mockReturnValue(.49);
    const { container } = render(<AeonLoadingScreen background="top-1" appName="Aeon" complete={false} progress={.2} />);
    const frame = container.querySelector<HTMLElement>(".aeon-loading-screen")!;
    expect(frame.dataset.startRank).toBe("25");
    expect(frame.querySelectorAll(".aeon-loading-lane")).toHaveLength(7);
    expect(frame.querySelectorAll(".aeon-loading-lane")[2].querySelector("[data-rank='25']")).not.toBeNull();
  });
  it("keeps the requested app-owned conveyor moving even with a device reduced-motion setting", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<AeonLoadingScreen background="top-1" appName="Aeon" complete={false} progress={.2} />);
    expect(motionAnimations).toHaveLength(7);
    const before = motionAnimations[0].currentTime;
    act(() => vi.advanceTimersByTime(200));
    expect(motionAnimations[0].currentTime).toBeGreaterThan(before);
  });
  it("keeps the real conveyor blurred until all decodes finish, without replacing nodes or restarting movement", async () => {
    const { container } = render(<AeonLoadingScreen background="top-1" appName="Aeon" complete={false} progress={.2} />);
    const images = Array.from(container.querySelectorAll<HTMLImageElement>(".aeon-loading-cover img"));
    expect(images).toHaveLength(100);
    const originalCover = container.querySelector("[data-rank='1']");
    const originalAnimation = motionAnimations[0];
    let finishLast: (() => void) | undefined;
    for (const [index, image] of images.entries()) {
      image.decode = index === 99 ? () => new Promise(resolve => { finishLast = resolve; }) : () => Promise.resolve();
      fireEvent.load(image);
    }
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector(".covers-ready")).toBeNull();
    await act(async () => { finishLast?.(); await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(20));
    expect(container.querySelector(".covers-ready")).not.toBeNull();
    expect(container.querySelector("[data-rank='1']")).toBe(originalCover);
    expect(motionAnimations).toHaveLength(7);
    expect(motionAnimations[0]).toBe(originalAnimation);
    expect(originalAnimation.cancel).not.toHaveBeenCalled();
  });
  it("retries stalled covers instead of revealing gaps or completing the app", () => {
    const complete = vi.fn();
    const { container } = render(<AeonLoadingScreen background="top-1" appName="Aeon" complete={false} progress={1} onVisualComplete={complete} />);
    const image = container.querySelector<HTMLImageElement>(".aeon-loading-cover img")!;
    const originalUrl = image.src;
    act(() => vi.advanceTimersByTime(3020));
    expect(image.src).not.toBe(originalUrl);
    expect(image.src).toContain("?retry=1");
    expect(container.querySelector(".covers-ready")).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".has-cover")).toHaveLength(0);
  });
  it("retries failed covers quickly and reveals only after every cover decodes", async () => {
    const { container } = render(<AeonLoadingScreen background="top-1" appName="Aeon" complete={false} progress={.2} />);
    const images = Array.from(container.querySelectorAll<HTMLImageElement>(".aeon-loading-cover img"));
    const failed = images[0];
    const originalUrl = failed.src;
    act(() => fireEvent.error(failed));
    act(() => vi.advanceTimersByTime(270));
    expect(failed.src).not.toBe(originalUrl);
    for (const image of images.slice(1)) {
      image.decode = () => Promise.resolve();
      fireEvent.load(image);
    }
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelectorAll(".has-cover")).toHaveLength(99);
    expect(container.querySelector(".covers-ready")).toBeNull();
    failed.decode = () => Promise.resolve();
    fireEvent.load(failed);
    await act(async () => { await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(20));
    expect(container.querySelectorAll(".has-cover")).toHaveLength(100);
    expect(container.querySelector(".covers-ready")).not.toBeNull();
  });
  it("finishes on real readiness even if no cover loaded", () => {
    const complete = vi.fn();
    const { rerender, unmount } = render(<AeonLoadingScreen background="mainstream" appName="Aeon" complete={false} progress={.8} onVisualComplete={complete} />);
    act(() => vi.advanceTimersByTime(100));
    expect(complete).not.toHaveBeenCalled();
    rerender(<AeonLoadingScreen background="mainstream" appName="Aeon" complete={true} progress={1} onVisualComplete={complete} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(complete).toHaveBeenCalledTimes(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
