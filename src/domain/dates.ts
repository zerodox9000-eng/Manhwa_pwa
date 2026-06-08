import type { RollingWindow } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayKey() {
  const now = new Date();
  return toDateKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function isFutureDate(value?: string | null) {
  const date = parseDate(value);
  const today = parseDate(todayKey());
  if (!date || !today) return false;
  return date.getTime() > today.getTime();
}

export function addDuration(date: Date, amount: number, unit: RollingWindow["unit"], direction = 1) {
  const copy = new Date(date);
  const value = amount * direction;
  if (unit === "days") copy.setUTCDate(copy.getUTCDate() + value);
  if (unit === "weeks") copy.setUTCDate(copy.getUTCDate() + value * 7);
  if (unit === "months") copy.setUTCMonth(copy.getUTCMonth() + value);
  if (unit === "years") copy.setUTCFullYear(copy.getUTCFullYear() + value);
  return copy;
}

export function resolveRollingWindow(window: RollingWindow, latestHistoryDate?: string | null) {
  if (window.mode === "none") return null;
  if (window.mode === "fixed" && window.from && window.to) {
    return {
      from: window.from,
      to: window.to,
    };
  }

  const anchor = latestHistoryDate ? parseDate(latestHistoryDate) : new Date();
  const to = anchor ?? new Date();
  const from = addDuration(to, Math.max(1, window.amount), window.unit, -1);
  return {
    from: toDateKey(from),
    to: toDateKey(to),
  };
}

export function isDateWithin(dateValue: string | null | undefined, from: string, to: string) {
  const date = parseDate(dateValue);
  const start = parseDate(from);
  const end = parseDate(to);
  if (!date || !start || !end) return false;
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime() + DAY_MS - 1;
}
