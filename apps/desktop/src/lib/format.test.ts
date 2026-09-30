import { describe, expect, it, vi, afterEach } from "vitest";
import { cost, count, duration, relativeTime, timestamp } from "./format";

describe("count", () => {
  it("shows small numbers exactly", () => {
    expect(count(0)).toBe("0");
    expect(count(9_999)).toBe(new Intl.NumberFormat().format(9_999));
  });


  it("compacts large numbers so columns stay narrow", () => {
    const compact = count(1_500_000);
    expect(compact).not.toBe(count(1_499));
    expect(compact).toBe(new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(1_500_000));
    expect(compact).not.toBe(new Intl.NumberFormat().format(1_500_000));
  });
});

describe("cost", () => {
  it("shows nothing spent as a clean zero", () => {
    expect(cost(0)).toBe("$0.00");
  });


  it("keeps precision below a cent", () => {
    expect(cost(0.0004)).toBe("$0.0004");
  });

  it("uses ordinary currency formatting above a cent", () => {
    expect(cost(12.3456)).toBe("$12.35");
  });
});

describe("duration", () => {
  it("uses milliseconds below a second", () => {
    expect(duration(840)).toBe("840ms");
  });

  it("switches to seconds above one", () => {
    expect(duration(1_240)).toBe("1.2s");
  });
});

describe("relativeTime", () => {
  afterEach(() => vi.useRealTimers());

  it("reports never when there is nothing to report", () => {
    expect(relativeTime(null)).toBe("never");
    expect(relativeTime(undefined)).toBe("never");
  });

  it("treats the last few seconds as now", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const tenSecondsAgo = Math.floor(Date.now() / 1000) - 10;
    expect(relativeTime(tenSecondsAgo)).toBe("just now");
  });

  it("scales to the largest sensible unit", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const now = Math.floor(Date.now() / 1000);

    const local = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    expect(relativeTime(now - 300)).toBe(local.format(-5, "minute"));
    expect(relativeTime(now - 7_200)).toBe(local.format(-2, "hour"));
    expect(relativeTime(now - 172_800)).toBe(local.format(-2, "day"));
  });
});

describe("timestamp", () => {
  it("renders a real local date rather than a raw number", () => {
    const formatted = timestamp(1_767_268_800);
    expect(formatted).not.toMatch(/^\d+$/);
    expect(formatted.length).toBeGreaterThan(8);
  });
});
