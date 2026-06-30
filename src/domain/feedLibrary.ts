import type { Feed, FeedFolder, HomeSource } from "./types";

export const MAX_FOLDER_DEPTH = 3;
export const MAX_FOLDERS_PER_PROFILE = 30;
export const DEFAULT_HOME_SOURCE: HomeSource = {
  kind: "unfiled",
  folderId: null,
  continuous: false,
};

export function createFeedFolder(name: string, parentId: string | null, order: number): FeedFolder {
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: name.trim(),
    parentId,
    childFolderIds: [],
    feedIds: [],
    order,
    createdAt: now,
    updatedAt: now,
  };
}

export function isFeedFolder(value: unknown): value is FeedFolder {
  if (!value || typeof value !== "object") return false;
  const folder = value as Partial<FeedFolder>;
  return (
    typeof folder.id === "string" &&
    typeof folder.name === "string" &&
    (typeof folder.parentId === "string" || folder.parentId === null) &&
    Array.isArray(folder.childFolderIds) &&
    Array.isArray(folder.feedIds)
  );
}

export function normalizeFeedFolders(values: unknown, feedIds: Set<string>): FeedFolder[] {
  if (!Array.isArray(values)) return [];
  const candidates = values.filter(isFeedFolder);
  const ids = new Set(candidates.map((folder) => folder.id));
  const normalized = candidates.map((folder, index) => ({
    ...folder,
    parentId: folder.parentId && ids.has(folder.parentId) ? folder.parentId : null,
    childFolderIds: [...new Set(folder.childFolderIds.filter((id) => ids.has(id) && id !== folder.id))],
    feedIds: [...new Set(folder.feedIds.filter((id) => feedIds.has(id)))],
    order: Number.isFinite(folder.order) ? folder.order : index,
  }));
  const byId = new Map(normalized.map((folder) => [folder.id, folder]));
  for (const folder of normalized) {
    if (folder.childFolderIds.length > 0) folder.feedIds = [];
    folder.childFolderIds = folder.childFolderIds.filter((id) => byId.get(id)?.parentId === folder.id);
  }
  return normalized;
}

export function folderDepth(folderId: string, folders: FeedFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let depth = 1;
  let current = byId.get(folderId);
  const seen = new Set<string>();
  while (current?.parentId) {
    if (seen.has(current.id)) return Number.POSITIVE_INFINITY;
    seen.add(current.id);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

export function descendantFolderIds(folderId: string, folders: FeedFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const result: string[] = [];
  const visit = (id: string) => {
    const folder = byId.get(id);
    if (!folder) return;
    for (const childId of orderedChildIds(folder, byId)) {
      result.push(childId);
      visit(childId);
    }
  };
  visit(folderId);
  return result;
}

export function orderedFolderTree(folders: FeedFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const result: FeedFolder[] = [];
  const visit = (folder: FeedFolder) => {
    result.push(folder);
    orderedChildIds(folder, byId).forEach((id) => {
      const child = byId.get(id);
      if (child) visit(child);
    });
  };
  folders
    .filter((folder) => !folder.parentId)
    .sort((left, right) => left.order - right.order)
    .forEach(visit);
  return result;
}

export function canMoveFolder(folderId: string, parentId: string | null, folders: FeedFolder[]) {
  if (folderId === parentId) return false;
  if (parentId && descendantFolderIds(folderId, folders).includes(parentId)) return false;
  if (!parentId) return true;
  const parent = folders.find((folder) => folder.id === parentId);
  if (!parent || parent.feedIds.length > 0) return false;
  const movingDepth = maxSubtreeDepth(folderId, folders);
  return folderDepth(parentId, folders) + movingDepth <= MAX_FOLDER_DEPTH;
}

export function canMoveFeedToFolder(folderId: string | null, folders: FeedFolder[]) {
  if (!folderId) return true;
  const folder = folders.find((item) => item.id === folderId);
  return Boolean(folder && folder.childFolderIds.length === 0);
}

export function feedLocation(feedId: string, folders: FeedFolder[]) {
  return folders.find((folder) => folder.feedIds.includes(feedId))?.id ?? null;
}

export function moveFeedReference(
  folders: FeedFolder[],
  feedId: string,
  destinationId: string | null,
  targetIndex?: number,
) {
  return folders.map((folder) => {
    const without = folder.feedIds.filter((id) => id !== feedId);
    if (folder.id !== destinationId) {
      return without.length === folder.feedIds.length ? folder : { ...folder, feedIds: without };
    }
    const index = Math.max(0, Math.min(targetIndex ?? without.length, without.length));
    const feedIds = [...without];
    feedIds.splice(index, 0, feedId);
    return { ...folder, feedIds, updatedAt: new Date().toISOString() };
  });
}

export function removeFolderSubtree(folders: FeedFolder[], folderId: string) {
  const removedFolderIds = new Set([folderId, ...descendantFolderIds(folderId, folders)]);
  const candidateFeedIds = new Set(
    folders.filter((folder) => removedFolderIds.has(folder.id)).flatMap((folder) => folder.feedIds),
  );
  const remainingFolders = folders
    .filter((folder) => !removedFolderIds.has(folder.id))
    .map((folder) => ({
      ...folder,
      childFolderIds: folder.childFolderIds.filter((childId) => !removedFolderIds.has(childId)),
    }));
  const retainedFeedIds = new Set(remainingFolders.flatMap((folder) => folder.feedIds));
  const orphanedFeedIds = [...candidateFeedIds].filter((id) => !retainedFeedIds.has(id));
  return { remainingFolders, removedFolderIds, orphanedFeedIds };
}

export function unfiledFeeds(feeds: Feed[], folders: FeedFolder[]) {
  const filed = new Set(folders.flatMap((folder) => folder.feedIds));
  return feeds.filter((feed) => !filed.has(feed.id));
}

export function resolveHomeFeeds(feeds: Feed[], folders: FeedFolder[], source: HomeSource) {
  if (source.kind === "unfiled") return unfiledFeeds(feeds, folders);
  const selected = source.folderId ? folders.find((folder) => folder.id === source.folderId) : null;
  if (!selected) return unfiledFeeds(feeds, folders);

  const orderedLeaves = orderedLeafFolders(folders);
  const selectedIds = new Set([selected.id, ...descendantFolderIds(selected.id, folders)]);
  const branchLeaves = orderedLeaves.filter((folder) => selectedIds.has(folder.id));
  const branchFeedIds = branchLeaves.flatMap((folder) => folder.feedIds);
  if (!source.continuous) return feedsByIds(feeds, branchFeedIds);

  return feedsByIds(feeds, [
    ...orderedLeaves.flatMap((folder) => folder.feedIds),
    ...unfiledFeeds(feeds, folders).map((feed) => feed.id),
  ]);
}

export function resolveHomeStartFeed(feeds: Feed[], folders: FeedFolder[], source: HomeSource) {
  return resolveHomeFeeds(feeds, folders, { ...source, continuous: false })[0]
    ?? resolveHomeFeeds(feeds, folders, source)[0]
    ?? null;
}

export function validateFolderTree(folders: FeedFolder[]) {
  const ids = new Set(folders.map((folder) => folder.id));
  if (ids.size !== folders.length) return false;
  for (const folder of folders) {
    if (folder.childFolderIds.length > 0 && folder.feedIds.length > 0) return false;
    if (folder.parentId && !ids.has(folder.parentId)) return false;
    if (folderDepth(folder.id, folders) > MAX_FOLDER_DEPTH) return false;
  }
  return true;
}

function orderedChildIds(folder: FeedFolder, byId: Map<string, FeedFolder>) {
  return folder.childFolderIds
    .map((id) => byId.get(id))
    .filter((item): item is FeedFolder => Boolean(item))
    .sort((left, right) => left.order - right.order)
    .map((item) => item.id);
}

function orderedLeafFolders(folders: FeedFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const result: FeedFolder[] = [];
  const visit = (folder: FeedFolder) => {
    const childIds = orderedChildIds(folder, byId);
    if (childIds.length === 0) {
      result.push(folder);
      return;
    }
    childIds.forEach((id) => {
      const child = byId.get(id);
      if (child) visit(child);
    });
  };
  folders
    .filter((folder) => !folder.parentId)
    .sort((left, right) => left.order - right.order)
    .forEach(visit);
  return result;
}

function maxSubtreeDepth(folderId: string, folders: FeedFolder[]) {
  const baseDepth = folderDepth(folderId, folders);
  const depths = [folderId, ...descendantFolderIds(folderId, folders)].map((id) => folderDepth(id, folders) - baseDepth + 1);
  return Math.max(...depths);
}

function feedsByIds(feeds: Feed[], ids: string[]) {
  const byId = new Map(feeds.map((feed) => [feed.id, feed]));
  return [...new Set(ids)].flatMap((id) => {
    const feed = byId.get(id);
    return feed ? [feed] : [];
  });
}
