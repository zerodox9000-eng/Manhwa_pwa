import { describe, expect, it } from "vitest";
import { createProfileState, emptyProfileSession, profileStateFromLegacy } from "./profilePersistence";
import { DEFAULT_SETTINGS, createFeed } from "../domain/defaults";

describe("profile persistence model", () => {
  it("migrates a single legacy snapshot into User 1 state without sharing arrays", () => {
    const feed = createFeed("Saved feed");
    const legacy = {
      feeds: [feed],
      settings: DEFAULT_SETTINGS,
      activeFeedId: feed.id,
      lastRoute: "#/feeds",
    };

    const state = profileStateFromLegacy("profile-1", legacy, { feeds: [], settings: DEFAULT_SETTINGS });

    expect(state.profileId).toBe("profile-1");
    expect(state.feeds).toEqual([feed]);
    expect(state.activeFeedId).toBe(feed.id);
    expect(state.session.lastRoute).toBe("#/feeds");
    expect(state.session.searchHistory).toEqual([]);
  });

  it("carries legacy search and route state into the migrated profile", () => {
    const state = profileStateFromLegacy("profile-1", {}, {
      feeds: [],
      settings: DEFAULT_SETTINGS,
      session: {
        lastRoute: "/search",
        searchHistory: ["Bastard"],
        openedTitleIds: [12],
      },
    });

    expect(state.session.lastRoute).toBe("/search");
    expect(state.session.searchHistory).toEqual(["Bastard"]);
    expect(state.session.openedTitleIds).toEqual([12]);
  });

  it("creates isolated session collections", () => {
    const first = createProfileState("first", { feeds: [], settings: DEFAULT_SETTINGS });
    const second = createProfileState("second", { feeds: [], settings: DEFAULT_SETTINGS });
    first.session.searchHistory.push("Solo");
    first.session.scroll.home = 120;

    expect(second.session).toEqual(emptyProfileSession());
  });
});
