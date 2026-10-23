import { expect, test } from "bun:test";
import { decodeRow, decodeValue, encodeRow, encodeValue } from "../src/backup-codec";

test("round-trips values that JSON cannot carry faithfully", () => {
  const when = new Date("2026-02-03T04:05:06.789Z");
  const bytes = new Uint8Array([0, 1, 250, 255]);
  expect(encodeValue(when)).toEqual({ $qiy: "date", value: "2026-02-03T04:05:06.789Z" });
  expect(decodeValue(encodeValue(when), "date")).toEqual(when);
  expect(encodeValue(bytes)).toEqual({ $qiy: "bytes", value: Buffer.from(bytes).toString("base64") });
  expect(Array.from(decodeValue(encodeValue(bytes), "buffer") as Uint8Array)).toEqual([0, 1, 250, 255]);
  expect(encodeValue(9007199254740993n)).toEqual({ $qiy: "bigint", value: "9007199254740993" });
  expect(decodeValue(encodeValue(9007199254740993n), "bigint")).toBe(9007199254740993n);
  expect(encodeValue(null)).toBeNull();
  expect(encodeValue(undefined)).toBeNull();
  expect(encodeValue("text")).toBe("text");
  expect(encodeValue(12.5)).toBe(12.5);
  expect(encodeValue({ nested: when })).toEqual({ nested: { $qiy: "date", value: "2026-02-03T04:05:06.789Z" } });
  for (const value of [when, bytes, 9007199254740993n, { nested: when }]) expect(() => JSON.stringify(encodeValue(value))).not.toThrow();
});

test("decodes rows using the declared column types", () => {
  const row = { id: "one", placedAt: { $qiy: "date", value: "2026-02-03T04:05:06.789Z" }, amount: "10.50", note: null };
  const decoded = decodeRow(row, { id: "string", placedAt: "date", amount: "string", note: "string" });
  expect(decoded.id).toBe("one");
  expect(decoded.placedAt).toEqual(new Date("2026-02-03T04:05:06.789Z"));
  expect(decoded.amount).toBe("10.50");
  expect(decoded.note).toBeNull();
  // A string timestamp for a date column is coerced, an unparsable one is kept as-is.
  expect(decodeValue("2026-02-03T04:05:06.789Z", "date")).toEqual(new Date("2026-02-03T04:05:06.789Z"));
  expect(decodeValue("not-a-date", "date")).toBe("not-a-date");
  expect(decodeRow(encodeRow({ when: new Date("2026-02-03T04:05:06.789Z") }), { when: "date" }).when).toEqual(new Date("2026-02-03T04:05:06.789Z"));
});
