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
});
