import { afterEach, describe, expect, it, vi } from "vitest";
import { makeId } from "./defaults";

describe("local IDs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an ID when randomUUID is unavailable on an HTTP LAN origin", () => {
    vi.stubGlobal("crypto", {});

    expect(makeId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
