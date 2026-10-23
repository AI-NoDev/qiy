/** Portable logical backup document written by db:backup and read by db:restore. */
export interface QiyBackupDocument {
  version: 1;
  dialect: string;
  createdAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

/** Values that JSON cannot carry faithfully are tagged so restore can rebuild them. */
export function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return { $qiy: "date", value: value.toISOString() };
  if (value instanceof Uint8Array) return { $qiy: "bytes", value: Buffer.from(value).toString("base64") };
  if (typeof value === "bigint") return { $qiy: "bigint", value: value.toString() };
  if (Array.isArray(value)) return value.map((item) => encodeValue(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeValue(item)]));
  return value;
}

export function decodeValue(value: unknown, dataType: string): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "$qiy" in (value as Record<string, unknown>)) {
    const tagged = value as { $qiy: string; value: string };
    if (tagged.$qiy === "date") return new Date(tagged.value);
    if (tagged.$qiy === "bytes") return Buffer.from(tagged.value, "base64");
    if (tagged.$qiy === "bigint") return BigInt(tagged.value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, dataType));
  // A driver that returns timestamps as strings still has to satisfy a date column.
  if (dataType === "date" && typeof value === "string") { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed; }
  return value;
}

export function encodeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encodeValue(value)]));
}

export function decodeRow(row: Record<string, unknown>, columnTypes: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodeValue(value, columnTypes[key] ?? "unknown")]));
}
