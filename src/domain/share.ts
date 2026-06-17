import { deflate, inflate } from "pako";
import type { AppStateSnapshot, Feed, Folder, UserLabel, AppSettings } from "./types";

export type SharePayload =
  | { kind: "feed"; version: 2; feed: Feed }
  | { kind: "title"; version: 2; titleId: number; title?: string; description?: string }
  | { kind: "folder"; version: 2; folder: Folder }
  | { kind: "settings"; version: 2; settings: Partial<AppSettings> }
  | { kind: "labels"; version: 2; labels: UserLabel[] }
  | { kind: "full"; version: 2; snapshot: AppStateSnapshot };

type CompactPayload =
  | { v: 2; k: "f"; f: unknown }
  | { v: 2; k: "t"; t: unknown }
  | { v: 2; k: "d"; d: unknown }
  | { v: 2; k: "s"; s: unknown }
  | { v: 2; k: "l"; l: unknown }
  | { v: 2; k: "a"; a: unknown };

function compact(payload: SharePayload): CompactPayload {
  if (payload.kind === "feed") return { v: 2, k: "f", f: payload.feed };
  if (payload.kind === "title") return { v: 2, k: "t", t: { id: payload.titleId, title: payload.title, description: payload.description } };
  if (payload.kind === "folder") return { v: 2, k: "d", d: payload.folder };
  if (payload.kind === "settings") return { v: 2, k: "s", s: payload.settings };
  if (payload.kind === "labels") return { v: 2, k: "l", l: payload.labels };
  return { v: 2, k: "a", a: payload.snapshot };
}

function expand(payload: CompactPayload): SharePayload {
  if (payload.v !== 2) throw new Error("Unsupported share payload");
  if (payload.k === "f") return { kind: "feed", version: 2, feed: payload.f as Feed };
  if (payload.k === "t") {
    const titlePayload = payload.t as { id: number; title?: string; description?: string };
    return { kind: "title", version: 2, titleId: titlePayload.id, title: titlePayload.title, description: titlePayload.description };
  }
  if (payload.k === "d") return { kind: "folder", version: 2, folder: payload.d as Folder };
  if (payload.k === "s") return { kind: "settings", version: 2, settings: payload.s as Partial<AppSettings> };
  if (payload.k === "l") return { kind: "labels", version: 2, labels: payload.l as UserLabel[] };
  return { kind: "full", version: 2, snapshot: payload.a as AppStateSnapshot };
}

function stableSortRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSortRecord);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableSortRecord(record[key])]),
  );
}

export function canonicalizeFeedForShare(feed: Feed) {
  return stableSortRecord({
    name: feed.name,
    description: feed.description ?? "",
    showDescription: Boolean(feed.showDescription),
    filters: {
      ...feed.filters,
      sourceModes: [...(feed.filters.sourceModes ?? [])].sort(),
      contentRatings: [...(feed.filters.contentRatings ?? [])].sort(),
      statuses: [...(feed.filters.statuses ?? [])].sort(),
      includeTagIds: [...(feed.filters.includeTagIds ?? [])].sort((a, b) => a - b),
      excludeTagIds: [...(feed.filters.excludeTagIds ?? [])].sort((a, b) => a - b),
      labelIds: [...(feed.filters.labelIds ?? [])].sort(),
      metricRanges: [...(feed.filters.metricRanges ?? [])]
        .map((range) => ({ metric: range.metric, min: range.min, max: range.max }))
        .sort((a, b) => a.metric.localeCompare(b.metric)),
    },
    sort: [...(feed.sort ?? [])].map((rule) => ({ metric: rule.metric, direction: rule.direction })),
    view: feed.view,
    coverTitleIds: [...(feed.coverTitleIds ?? [])].sort((a, b) => a - b),
  });
}

export function getFeedFingerprint(feed: Feed) {
  return JSON.stringify(canonicalizeFeedForShare(feed));
}

export function findEquivalentFeed(feeds: Feed[], incoming: Feed) {
  const fingerprint = getFeedFingerprint(incoming);
  return feeds.find((feed) => getFeedFingerprint(feed) === fingerprint) ?? null;
}

export function findFeedNameConflict(feeds: Feed[], incoming: Feed) {
  const incomingName = incoming.name.trim().toLocaleLowerCase();
  return feeds.find((feed) => feed.name.trim().toLocaleLowerCase() === incomingName && getFeedFingerprint(feed) !== getFeedFingerprint(incoming)) ?? null;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function encodeSharePayload(payload: SharePayload) {
  const text = JSON.stringify(compact(payload));
  return toBase64Url(deflate(text));
}

export function decodeSharePayload(encoded: string): SharePayload {
  const inflated = inflate(fromBase64Url(encoded), { to: "string" });
  return expand(JSON.parse(inflated) as CompactPayload);
}

export function makeShareUrl(payload: SharePayload) {
  const encoded = encodeSharePayload(payload);
  const url = new URL(window.location.href);
  url.hash = `#/import?p=${encoded}`;
  return url.toString();
}

export function exportCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}
