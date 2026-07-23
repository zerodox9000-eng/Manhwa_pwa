export type PopularityBandId = "underground" | "upcoming" | "mainstream" | "top1";

export interface PopularityBand {
  id: PopularityBandId;
  label: string;
  shortLabel: string;
  min: number;
  max: number | null;
}

// These are the canonical displayed-percentile ranges used by the Discover feeds.
export const POPULARITY_BANDS: readonly PopularityBand[] = [
  { id: "underground", label: "Underground", shortLabel: "Underground", min: 70, max: 79 },
  { id: "upcoming", label: "Upcoming", shortLabel: "Upcoming", min: 80, max: 89 },
  { id: "mainstream", label: "Mainstream", shortLabel: "Mainstream", min: 90, max: 98 },
  { id: "top1", label: "Top 1%", shortLabel: "Top 1%", min: 99, max: null },
] as const;

export function popularityBandForDisplayedPercentile(value: number | null | undefined): PopularityBandId | null {
  if (value == null || !Number.isFinite(value)) return null;
  const displayed = Math.round(value);
  return POPULARITY_BANDS.find((band) => displayed >= band.min && (band.max == null || displayed <= band.max))?.id ?? null;
}

export function popularityBandIndex(value: PopularityBandId | null) {
  return value == null ? -1 : POPULARITY_BANDS.findIndex((band) => band.id === value);
}
