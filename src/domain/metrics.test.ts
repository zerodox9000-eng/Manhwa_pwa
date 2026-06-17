import { describe, expect, it } from "vitest";
import { formatMetricValue, listedDate, metricValue } from "./metrics";
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

  it("keeps estimated start dates out of release metrics but exposes listed date separately", () => {
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
    expect(metricValue(fallbackSeries, "releaseDate")).toBe(-Infinity);
    expect(listedDate(fallbackSeries)).toBe("2026-06-07");
    expect(formatMetricValue(fallbackSeries, "releaseDate")).toBe("n/a");
    expect(metricValue(fallbackSeries, "endDate")).toBe(-Infinity);
    expect(formatMetricValue(fallbackSeries, "endDate")).toBe("n/a");
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
