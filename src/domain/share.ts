import { deflate, inflate } from "pako";
import type { AppStateSnapshot, Feed, Folder, UserLabel, AppSettings } from "./types";

export type SharePayload =
  | { kind: "feed"; version: 2 | 3; feed: Feed }
  | { kind: "folder"; version: 2 | 3; folder: Folder }
  | { kind: "settings"; version: 2 | 3; settings: Partial<AppSettings> }
  | { kind: "labels"; version: 2 | 3; labels: UserLabel[] }
  | { kind: "full"; version: 2 | 3; snapshot: AppStateSnapshot };

type CompactPayload =
  | { v: 2 | 3; k: "f"; f: unknown }
  | { v: 2 | 3; k: "d"; d: unknown }
  | { v: 2 | 3; k: "s"; s: unknown }
  | { v: 2 | 3; k: "l"; l: unknown }
  | { v: 2 | 3; k: "a"; a: unknown };

function compact(payload: SharePayload): CompactPayload {
  if (payload.kind === "feed") return { v: payload.version, k: "f", f: payload.feed };
  if (payload.kind === "folder") return { v: payload.version, k: "d", d: payload.folder };
  if (payload.kind === "settings") return { v: payload.version, k: "s", s: payload.settings };
  if (payload.kind === "labels") return { v: payload.version, k: "l", l: payload.labels };
  return { v: payload.version, k: "a", a: payload.snapshot };
}

function expand(payload: CompactPayload): SharePayload {
  if (payload.v !== 2 && payload.v !== 3) throw new Error("Unsupported share payload");
  if (payload.k === "f") return { kind: "feed", version: payload.v, feed: payload.f as Feed };
  if (payload.k === "d") return { kind: "folder", version: payload.v, folder: payload.d as Folder };
  if (payload.k === "s") return { kind: "settings", version: payload.v, settings: payload.s as Partial<AppSettings> };
  if (payload.k === "l") return { kind: "labels", version: payload.v, labels: payload.l as UserLabel[] };
  return { kind: "full", version: payload.v, snapshot: payload.a as AppStateSnapshot };
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
  const result = url.toString();
  return result.length <= 8192 ? result : null;
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
