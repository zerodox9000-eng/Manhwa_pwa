import { describe, expect, it } from "vitest";
import { formatMetricValue, metricValue } from "./metrics";
import type { SeriesCatalog } from "./types";

const series: SeriesCatalog = {
  id: 1,
  display_title: "Future Date",
  cover: null,
  year: 2999,
  status: "releasing",
  content_rating: "safe",
  total_chapters: null,
  tag_ids: [],
  stats: { popularity: 1, favourites: 1, meanScore: null },
  analytics: {},
  published: { start_date: "2999-01-01", end_date: "2999-12-31" },
};

describe("metrics", () => {
  it("does not expose future release or end dates as active metric values", () => {
    expect(metricValue(series, "releaseDate")).toBe(-Infinity);
    expect(metricValue(series, "endDate")).toBe(-Infinity);
    expect(formatMetricValue(series, "releaseDate")).toBe("n/a");
    expect(formatMetricValue(series, "endDate")).toBe("n/a");
  });

  it("uses estimated start dates internally and keeps estimated release display blank", () => {
    const fallbackSeries: SeriesCatalog = {
      ...series,
      id: 2,
      year: 2026,
      first_seen_at: "2026-06-07T04:00:00.000Z",
      first_seen_at_is_trusted: true,
      last_updated_at: "2026-06-08T04:00:00.000Z",
      published: {
        start_date: "2026-01-01",
        start_date_is_estimated: true,
        end_date: "2026-12-31",
        end_date_is_estimated: true,
      },
    };
    expect(metricValue(fallbackSeries, "releaseDate")).toBe(new Date("2026-01-01").getTime());
    expect(formatMetricValue(fallbackSeries, "releaseDate")).toBe("n/a");
    expect(metricValue(fallbackSeries, "endDate")).toBe(-Infinity);
    expect(formatMetricValue(fallbackSeries, "endDate")).toBe("n/a");
  });


  it("computes underrated score only above the rounded popularity cutoff", () => {
    const eligible: SeriesCatalog = {
      ...series,
      id: 4,
      analytics: {
        popularityPercentile: 70.4,
        fanFavouriteDiscoveryPercentile: 88.2,
      },
    };
    const filteredOut: SeriesCatalog = {
      ...series,
      id: 5,
      analytics: {
        popularityPercentile: 69.4,
        fanFavouriteDiscoveryPercentile: 88.2,
      },
    };

    expect(metricValue(eligible, "underratedScore")).toBeCloseTo(17.8);
    expect(formatMetricValue(eligible, "underratedScore")).toBe("18%");
    expect(metricValue(filteredOut, "underratedScore")).toBe(-Infinity);
    expect(formatMetricValue(filteredOut, "underratedScore")).toBe("n/a");
  });

  it("does not use untrusted first-seen or last-updated as release fallback when no start date exists", () => {
    const untrusted: SeriesCatalog = {
      ...series,
      id: 3,
      year: 2026,
      first_seen_at: "2026-06-07T04:00:00.000Z",
      first_seen_at_is_trusted: false,
      last_updated_at: "2026-06-08T04:00:00.000Z",
      published: {
        start_date: null,
        end_date: null,
      },
    };
    expect(metricValue(untrusted, "releaseDate")).toBe(-Infinity);
    expect(formatMetricValue(untrusted, "releaseDate")).toBe("n/a");
  });
});
