// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { initializePwaInstall, requestPwaInstall } from "./pwaInstall";

describe("Settings-only PWA install", () => {
  it("captures an early event without prompting and requests installation only on user action", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn() }));
    initializePwaInstall();
    const event = new Event("beforeinstallprompt", { cancelable: true });
    const prompt = vi.fn().mockResolvedValue(undefined);
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(await requestPwaInstall()).toBe("accepted");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(await requestPwaInstall()).toBe("manual");
    vi.unstubAllGlobals();
  });
});
