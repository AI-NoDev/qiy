import dayjs, { type Dayjs } from "dayjs";

/**
 * Date, Time and DateTime form contracts.
 *
 * The generated API stores all three as strings:
 *   Date     -> `YYYY-MM-DD` (PostgreSQL/MySQL `date`, SQLite text)
 *   Time     -> `HH:mm:ss`    (PostgreSQL/MySQL `time`, SQLite text)
 *   DateTime -> ISO date-time (timestamp column, unchanged behaviour)
 *
 * Ant Design pickers work with dayjs values, so forms convert in both
 * directions here. The functions are pure so they can be unit tested without a
 * DOM, and the same formatter feeds list cells, detail pages and display
 * templates so every date-like value renders consistently.
 */
export type DateFieldType = "Date" | "Time" | "DateTime";

export const dateFieldTypes: ReadonlySet<string> = new Set<DateFieldType>(["Date", "Time", "DateTime"]);

export function isDateFieldType(type: string | undefined): type is DateFieldType {
  return type === "Date" || type === "Time" || type === "DateTime";
}

/** Ant Design picker formats; the stored contract is narrower (see `toPayloadValue`). */
export const fieldPickerFormat: Record<DateFieldType, string> = {
  Date: "YYYY-MM-DD",
  Time: "HH:mm:ss",
  DateTime: "YYYY-MM-DD HH:mm:ss",
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/**
 * Converts a stored value into the dayjs value an Ant Design picker expects.
 * Unparsable values become `null` so the picker stays empty instead of
 * rendering an invalid date; edit forms never crash on legacy text.
 */
export function toFormValue(type: DateFieldType, stored: unknown): Dayjs | null {
  if (stored === null || stored === undefined || stored === "") return null;
  if (typeof stored !== "string") return null;
  if (type === "Date") {
    // dayjs rolls 2026-13-01 over to 2027-01-01; an out-of-range month/day must
    // stay invalid so the picker shows empty instead of silently changing data.
    if (!datePattern.test(stored)) return null;
    const parsed = dayjs(stored);
    return parsed.isValid() && parsed.format("YYYY-MM-DD") === stored ? parsed : null;
  }
  if (type === "Time") {
    const match = timePattern.exec(stored);
    return match ? dayjs(`1970-01-01T${match[1]}:${match[2]}:${match[3] ?? "00"}`) : null;
  }
  const parsed = dayjs(stored);
  return parsed.isValid() ? parsed : null;
}

/**
 * Converts a picker value back to the stored contract. Strings are already in
 * the contract (for example a `form.setFieldsValue` call), so they pass through
 * untouched; an empty picker produces `null` for nullable columns.
 */
export function toPayloadValue(type: DateFieldType, value: Dayjs | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (!dayjs.isDayjs(value) || !value.isValid()) return null;
  if (type === "Date") return value.format("YYYY-MM-DD");
  if (type === "Time") return value.format("HH:mm:ss");
  return value.toISOString();
}

/**
 * Localized display text for a date-like value. `Intl.DateTimeFormat` uses the
 * current language, and anything unparsable falls back to the raw stored string
 * so data is never silently hidden.
 */
export function formatFieldValue(type: string | undefined, value: unknown, locale?: string): string {
  if (type === "Array") return Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value);
  if (type === "JSON") {
    if (value === null || value === undefined || value === "") return "";
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  const raw = value === null || value === undefined || value === "" ? "" : String(value);
  if (!raw || !isDateFieldType(type)) return raw;
  const parsed = toFormValue(type, raw);
  if (!parsed) return raw;
  const resolvedLocale = locale || undefined;
  try {
    if (type === "Time") return new Intl.DateTimeFormat(resolvedLocale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(parsed.toDate());
    if (type === "DateTime") return new Intl.DateTimeFormat(resolvedLocale, { dateStyle: "medium", timeStyle: "medium" }).format(parsed.toDate());
    return new Intl.DateTimeFormat(resolvedLocale, { dateStyle: "medium" }).format(parsed.toDate());
  } catch {
    return raw;
  }
}
