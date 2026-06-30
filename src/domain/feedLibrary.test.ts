import { describe, expect, it } from "vitest";
import { createFeed } from "./defaults";
import {
  canMoveFolder,
  folderDepth,
  orderedFolderTree,
  resolveHomeFeeds,
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
      .toEqual(["c", "a", "b", "d"]);
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
});
