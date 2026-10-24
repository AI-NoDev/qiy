import { describe, expect, test } from "bun:test";
import dayjs from "dayjs";
import { formatFieldValue, isDateFieldType, toFormValue, toPayloadValue } from "../app/date-fields";

describe("Date/Time/DateTime form contracts", () => {
  test("converts stored contract strings into picker values", () => {
    expect(toFormValue("Date", "2026-11-30")?.format("YYYY-MM-DD")).toBe("2026-11-30");
    expect(toFormValue("Time", "14:30:05")?.format("HH:mm:ss")).toBe("14:30:05");
    expect(toFormValue("Time", "14:30")?.format("HH:mm:ss")).toBe("14:30:00");
    expect(toFormValue("DateTime", "2026-11-30T08:30:00.000Z")?.toISOString()).toBe("2026-11-30T08:30:00.000Z");
    expect(toFormValue("Date", null)).toBeNull();
  });

  test("converts picker values back to the API contract", () => {
    expect(toPayloadValue("Date", dayjs("2026-11-30"))).toBe("2026-11-30");
    expect(toPayloadValue("Time", dayjs("1970-01-01T14:30:05"))).toBe("14:30:05");
    expect(toPayloadValue("DateTime", dayjs("2026-11-30T08:30:00.000Z"))).toBe("2026-11-30T08:30:00.000Z");
    expect(toPayloadValue("Date", null)).toBeNull();
    expect(toPayloadValue("Time", undefined)).toBeNull();
    // Values already in the contract (form.setFieldsValue) pass through unchanged.
    expect(toPayloadValue("Date", "2026-11-30")).toBe("2026-11-30");
  });

  test("invalid stored input never becomes an invalid picker value", () => {
    expect(toFormValue("Date", "not-a-date")).toBeNull();
    expect(toFormValue("Date", "2026-13-01")).toBeNull();
    expect(toFormValue("Time", "25:00:00")).toBeNull();
    expect(toFormValue("Time", "08:30:00Z")).toBeNull();
    expect(toFormValue("DateTime", "tomorrow")).toBeNull();
  });

  test("formats display text with Intl and falls back to the raw string", () => {
    expect(formatFieldValue("Date", "2026-11-30", "en-US")).toContain("2026");
    expect(formatFieldValue("Date", "2026-11-30", "zh-CN")).toContain("2026");
    expect(formatFieldValue("Time", "08:30:00", "zh-CN")).toBe("08:30:00");
    expect(formatFieldValue("Time", "08:30:00", "en-US")).toMatch(/8:30:00/);
    expect(formatFieldValue("DateTime", "2026-11-30T08:30:00.000Z", "en-US")).toContain("2026");
    expect(formatFieldValue("Date", "not-a-date", "en-US")).toBe("not-a-date");
    expect(formatFieldValue("Date", "2026-13-01", "en-US")).toBe("2026-13-01");
    expect(formatFieldValue("Text", "plain")).toBe("plain");
    expect(formatFieldValue("Date", null)).toBe("");
    expect(isDateFieldType("DateTime")).toBe(true);
    expect(isDateFieldType("Text")).toBe(false);
  });
});
