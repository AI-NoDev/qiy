export type QiyTemporalFieldType = "Date" | "Time";

export class QiyTemporalValueError extends Error {
  readonly field: string;
  readonly type: QiyTemporalFieldType;

  constructor(field: string, type: QiyTemporalFieldType, value: unknown) {
    const expected = type === "Date" ? "YYYY-MM-DD" : "HH:mm:ss";
    super("Invalid " + type + " value for " + field + " (" + JSON.stringify(value ?? null) + "); expected " + expected);
    this.name = "QiyTemporalValueError";
    this.field = field;
    this.type = type;
  }
}

/** A calendar-valid date in the stored `YYYY-MM-DD` form. */
export function isValidDateValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Normalizes `HH:mm` or `HH:mm:ss` to the stored `HH:mm:ss` form; undefined when invalid. */
export function normalizeTimeValue(value: string): string | undefined {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/.exec(value);
  return match ? match[1] + ":" + match[2] + ":" + (match[3] ?? "00") : undefined;
}

/**
 * Validates and normalizes the declared Date/Time fields of one write payload.
 * Absent, null and empty values are left untouched so nullable fields and PATCH
 * bodies keep working; an invalid value throws QiyTemporalValueError (400).
 */
export function normalizeTemporalValues<T extends Record<string, unknown>>(values: T, types: Record<string, QiyTemporalFieldType>): T {
  let next: Record<string, unknown> | undefined;
  for (const [field, type] of Object.entries(types)) {
    if (!Object.hasOwn(values, field)) continue;
    const value = values[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string") throw new QiyTemporalValueError(field, type, value);
    if (type === "Date") {
      if (!isValidDateValue(value)) throw new QiyTemporalValueError(field, type, value);
      continue;
    }
    const normalized = normalizeTimeValue(value);
    if (!normalized) throw new QiyTemporalValueError(field, type, value);
    if (normalized !== value) {
      next ??= { ...values };
      next[field] = normalized;
    }
  }
  return (next ?? values) as T;
}
