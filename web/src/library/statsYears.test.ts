import { describe, expect, it } from "vitest";
import { statsYears } from "./statsYears";

describe("statistics year landscape", () => {
  it("keeps a valid landscape for a library entirely before 1965", () => {
    const graph = statsYears([{ year: 1940, tracks: 8 }, { year: 1960, tracks: 3 }]);
    expect(graph).not.toBeNull();
    expect(graph!.y0).toBe(1940);
    expect(graph!.y1).toBe(1960);
    expect(graph!.d).not.toMatch(/NaN|undefined|Infinity/);
    expect(graph!.pk).toEqual([1940, 8]);
    expect(graph!.X(1940)).toBe(0);
    expect(graph!.X(1960)).toBe(1000);
  });

  it("includes the oldest year in a mixed old and modern library", () => {
    const graph = statsYears([{ year: 1959, tracks: 20 }, { year: 2026, tracks: 4 }]);
    expect(graph!.X(graph!.pk[0])).toBeGreaterThanOrEqual(0);
    expect(graph!.sm[graph!.pk[0] - graph!.y0]).toBeGreaterThan(0);
  });

  it("leaves a single-year collection without a misleading curve", () => {
    expect(statsYears([])).toBeNull();
    expect(statsYears([{ year: 1960, tracks: 8 }])).toBeNull();
  });
});
