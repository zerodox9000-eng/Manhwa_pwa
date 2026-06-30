import { describe, expect, it } from "vitest";
import { createFeed } from "./defaults";
import {
  canMoveFolder,
  canGroupFoldersInNewParent,
  duplicateFeedRecord,
  duplicateFolderSubtree,
  folderDepth,
  moveFeedReference,
  orderedFolderTree,
  removeFolderSubtree,
  resolveHomeFeeds,
  resolveHomeStartFeed,
  resolveHomeViewFeeds,
  validateFolderTree,
} from "./feedLibrary";
import type { FeedFolder } from "./types";

function folder(id: string, parentId: string | null, childFolderIds: string[], feedIds: string[], order = 0): FeedFolder {
  return { id, name: id, parentId, childFolderIds, feedIds, order, createdAt: "", updatedAt: "" };
}

describe("feed folder tree", () => {
  it("enforces depth, cycles, and homogeneous contents", () => {
    const folders = [
      folder("root", null, ["child"], []),
      folder("child", "root", ["leaf"], []),
      folder("leaf", "child", [], ["a"]),
    ];
    expect(folderDepth("leaf", folders)).toBe(3);
    expect(canMoveFolder("root", "leaf", folders)).toBe(false);
    expect(canGroupFoldersInNewParent(["root"], null, folders)).toBe(false);
    expect(canGroupFoldersInNewParent(["leaf"], null, folders)).toBe(true);
    expect(validateFolderTree(folders)).toBe(true);
    expect(validateFolderTree([folder("mixed", null, ["child"], ["a"]), folder("child", "mixed", [], [])])).toBe(false);
  });

  it("resolves branch and continuous Home traversal without duplicates", () => {
    const feeds = ["a", "b", "c", "d"].map((id) => ({ ...createFeed(id), id }));
    const folders = [
      folder("root", null, ["first", "second"], [], 0),
      folder("first", "root", [], ["a", "b"], 0),
      folder("second", "root", [], ["c"], 1),
    ];
    expect(resolveHomeFeeds(feeds, folders, { kind: "folder", folderId: "first", continuous: false }).map((feed) => feed.id))
      .toEqual(["a", "b"]);
    expect(resolveHomeFeeds(feeds, folders, { kind: "folder", folderId: "first", continuous: true }).map((feed) => feed.id))
      .toEqual(["a", "b", "c", "d"]);
    expect(resolveHomeFeeds(feeds, folders, { kind: "folder", folderId: "second", continuous: true }).map((feed) => feed.id))
      .toEqual(["a", "b", "c", "d"]);
    expect(resolveHomeStartFeed(feeds, folders, { kind: "folder", folderId: "second", continuous: true })?.id)
      .toBe("c");
  });

  it("flattens nested folders in visual tree order", () => {
    const rootA = folder("root-a", null, ["child-a2", "child-a1"], [], 0);
    const rootB = folder("root-b", null, [], [], 1);
    const childA1 = folder("child-a1", "root-a", [], [], 0);
    const childA2 = folder("child-a2", "root-a", [], [], 1);

    expect(orderedFolderTree([childA2, rootB, childA1, rootA]).map((item) => item.id)).toEqual([
      "root-a",
      "child-a1",
      "child-a2",
      "root-b",
    ]);
  });

  it("moves a feed atomically and does not delete it with its old folder", () => {
    const oldFolder = folder("old", null, [], ["feed-a"]);
    const newFolder = folder("new", null, [], []);
    const moved = moveFeedReference([oldFolder, newFolder], "feed-a", "new");

    expect(moved.find((item) => item.id === "old")?.feedIds).toEqual([]);
    expect(moved.find((item) => item.id === "new")?.feedIds).toEqual(["feed-a"]);

    const deleted = removeFolderSubtree(moved, "old");
    expect(deleted.orphanedFeedIds).toEqual([]);
    expect(deleted.remainingFolders.find((item) => item.id === "new")?.feedIds).toEqual(["feed-a"]);
  });

  it("duplicates a folder subtree without leaking copied feeds into Unfiled", () => {
    const feeds = ["a", "b"].map((id) => ({ ...createFeed(id), id }));
    const folders = [
      folder("root", null, ["child"], []),
      folder("child", "root", [], ["a", "b"]),
    ];
    let nextId = 0;
    const copied = duplicateFolderSubtree(feeds, folders, "root", () => `copy-${++nextId}`, "2026-06-30");
    const copiedFolderIds = new Set([copied.rootFolder.id, ...copied.rootFolder.childFolderIds]);
    const filedIds = new Set(
      copied.folders.filter((item) => copiedFolderIds.has(item.id)).flatMap((item) => item.feedIds),
    );

    expect(filedIds).toEqual(copied.copiedFeedIds);
    expect(copied.feeds.filter((feed) => copied.copiedFeedIds.has(feed.id))).toHaveLength(2);
    expect(resolveHomeFeeds(copied.feeds, copied.folders, { kind: "unfiled", folderId: null, continuous: false }).map((feed) => feed.id))
      .toEqual([]);

    const deleted = removeFolderSubtree(copied.folders, copied.rootFolder.id);
    expect(new Set(deleted.orphanedFeedIds)).toEqual(copied.copiedFeedIds);
    expect(deleted.remainingFolders).toEqual(folders);
  });

  it("keeps a transient opened feed without changing the configured Home source", () => {
    const feeds = ["a", "b"].map((id) => ({ ...createFeed(id), id }));
    const folders = [folder("home", null, [], ["a"])];
    const source = { kind: "folder", folderId: "home", continuous: false } as const;

    expect(resolveHomeViewFeeds(feeds, folders, source, "b").map((feed) => feed.id)).toEqual(["b", "a"]);
    expect(resolveHomeStartFeed(feeds, folders, source)?.id).toBe("a");
  });

  it("bulk-duplicates distinct feeds from the latest library state", () => {
    const first = { ...createFeed("First"), id: "first", description: "first-content" };
    const second = { ...createFeed("Second"), id: "second", description: "second-content" };
    first.filters.includeTagIds = [101];
    second.filters.includeTagIds = [202];
    const filed = folder("filed", null, [], ["first", "second"]);
    const firstCopy = duplicateFeedRecord([first, second], [filed], "first", () => "first-copy");
    const secondCopy = duplicateFeedRecord(firstCopy.feeds, firstCopy.folders, "second", () => "second-copy");

    expect(secondCopy.feeds.find((feed) => feed.id === "first-copy")?.description).toBe("first-content");
    expect(secondCopy.feeds.find((feed) => feed.id === "second-copy")?.description).toBe("second-content");
    expect(secondCopy.feeds.find((feed) => feed.id === "first-copy")?.filters.includeTagIds).toEqual([101]);
    expect(secondCopy.feeds.find((feed) => feed.id === "second-copy")?.filters.includeTagIds).toEqual([202]);
    expect(secondCopy.folders[0].feedIds).toEqual(["first", "second", "first-copy", "second-copy"]);
  });
});
