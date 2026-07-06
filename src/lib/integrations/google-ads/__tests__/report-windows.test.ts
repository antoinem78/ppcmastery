import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { windowsSpec, normalizeCustomRange, parseReportRange } from "../reporting";

// The date-window math is the money path: a wrong Mon-Sun or month boundary
// silently produces a wrong client report. Frozen clock, known answers.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setToday = (iso: string) => vi.setSystemTime(new Date(iso));

describe("windowsSpec: mon_sun", () => {
  it("mid-week resolves to the last COMPLETE Mon-Sun week", () => {
    setToday("2026-07-01T12:00:00Z"); // a Wednesday
    const w = windowsSpec("Etc/UTC", { mode: "mon_sun" });
    expect(w).toEqual({ start: "2026-06-22", end: "2026-06-28", prevStart: "2026-06-15", prevEnd: "2026-06-21" });
  });
  it("on a Monday the week that just ended yesterday is complete", () => {
    setToday("2026-06-29T09:00:00Z"); // Monday
    const w = windowsSpec("Etc/UTC", { mode: "mon_sun" });
    expect(w.start).toBe("2026-06-22");
    expect(w.end).toBe("2026-06-28");
  });
  it("on a Sunday the CURRENT week is not complete — uses the prior one", () => {
    setToday("2026-06-28T09:00:00Z"); // Sunday (week ends today, not complete)
    const w = windowsSpec("Etc/UTC", { mode: "mon_sun" });
    expect(w.start).toBe("2026-06-15");
    expect(w.end).toBe("2026-06-21");
  });
});

describe("windowsSpec: month", () => {
  it("mid-July compares June vs May", () => {
    setToday("2026-07-15T12:00:00Z");
    const w = windowsSpec("Etc/UTC", { mode: "month" });
    expect(w).toEqual({ start: "2026-06-01", end: "2026-06-30", prevStart: "2026-05-01", prevEnd: "2026-05-31" });
  });
  it("January crosses the year boundary: December vs November", () => {
    setToday("2026-01-10T12:00:00Z");
    const w = windowsSpec("Etc/UTC", { mode: "month" });
    expect(w).toEqual({ start: "2025-12-01", end: "2025-12-31", prevStart: "2025-11-01", prevEnd: "2025-11-30" });
  });
  it("March handles the short February correctly", () => {
    setToday("2026-03-05T12:00:00Z");
    const w = windowsSpec("Etc/UTC", { mode: "month" });
    expect(w.start).toBe("2026-02-01");
    expect(w.end).toBe("2026-02-28"); // 2026 is not a leap year
    expect(w.prevEnd).toBe("2026-01-31");
  });
});

describe("windowsSpec: rolling + custom", () => {
  it("rolling 30 = last 30 days excluding today, vs the 30 before", () => {
    setToday("2026-07-01T12:00:00Z");
    const w = windowsSpec("Etc/UTC", { mode: "rolling", days: 30 });
    expect(w).toEqual({ start: "2026-06-01", end: "2026-06-30", prevStart: "2026-05-02", prevEnd: "2026-05-31" });
  });
  it("custom compares against the equal-length preceding period", () => {
    setToday("2026-07-01T12:00:00Z");
    const w = windowsSpec("Etc/UTC", { mode: "custom", start: "2026-05-01", end: "2026-05-31" });
    expect(w).toEqual({ start: "2026-05-01", end: "2026-05-31", prevStart: "2026-03-31", prevEnd: "2026-04-30" });
  });
  it("timezone shifts 'today' (23:30 UTC is already tomorrow in Sydney)", () => {
    setToday("2026-06-30T23:30:00Z"); // Jul 1 in Australia/Sydney
    const utc = windowsSpec("Etc/UTC", { mode: "rolling", days: 7 });
    const syd = windowsSpec("Australia/Sydney", { mode: "rolling", days: 7 });
    expect(utc.end).toBe("2026-06-29");
    expect(syd.end).toBe("2026-06-30");
  });
});

describe("normalizeCustomRange (public URL params — untrusted)", () => {
  it("accepts a valid pair and swaps a reversed one", () => {
    expect(normalizeCustomRange("2026-05-01", "2026-05-31")).toEqual({ start: "2026-05-01", end: "2026-05-31" });
    expect(normalizeCustomRange("2026-05-31", "2026-05-01")).toEqual({ start: "2026-05-01", end: "2026-05-31" });
  });
  it("rejects malformed / injected values", () => {
    expect(normalizeCustomRange("2026-05-01' OR 1=1", "2026-05-31")).toBeNull();
    expect(normalizeCustomRange("05/01/2026", "2026-05-31")).toBeNull();
    expect(normalizeCustomRange("", "2026-05-31")).toBeNull();
    expect(normalizeCustomRange(undefined, "2026-05-31")).toBeNull();
  });
  it("rejects impossible calendar dates", () => {
    expect(normalizeCustomRange("2026-02-30", "2026-03-01")).toBeNull();
    expect(normalizeCustomRange("2026-13-01", "2026-13-05")).toBeNull();
  });
  it("caps the span at 366 days", () => {
    expect(normalizeCustomRange("2024-01-01", "2026-01-01")).toBeNull();
    expect(normalizeCustomRange("2025-01-01", "2025-12-31")).not.toBeNull();
  });
});

describe("parseReportRange", () => {
  it("maps known keys and defaults everything else to mon_sun", () => {
    expect(parseReportRange("month")).toBe("month");
    expect(parseReportRange("30d")).toBe("30d");
    expect(parseReportRange("garbage")).toBe("mon_sun");
    expect(parseReportRange(undefined)).toBe("mon_sun");
  });
});
