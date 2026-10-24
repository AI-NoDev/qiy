import { beforeEach, beforeAll, expect, test } from "bun:test";
import { client } from "../src/db";
import {
  qiyCodeDateParts,
  qiyCodeTemplateBucket,
  qiyCreateWithGeneratedValues,
  qiyGenerateValues,
  qiyRenderCodeTemplate,
  qiyStripGeneratedValues,
  type QiyGeneratedField,
} from "../src/generated-values";

/** Probe rows exercise the real unique constraints through the create retry path. */
const PROBE_FIELDS: QiyGeneratedField[] = [
  { field: "code", kind: "code", template: "PRB-{YYYYMMDD}-{seq:4}" },
  { field: "externalId", kind: "uuid" },
];

beforeAll(async () => {
  client.exec('CREATE TABLE IF NOT EXISTS qiy_code_sequences ("entity" text NOT NULL, "field" text NOT NULL, "bucket" text NOT NULL, "value" integer NOT NULL, PRIMARY KEY ("entity", "field", "bucket"))');
  client.exec('CREATE TABLE IF NOT EXISTS qiy_generated_probe ("id" text PRIMARY KEY, "code" text NOT NULL UNIQUE, "externalId" text NOT NULL)');
});

beforeEach(async () => {
  client.exec("DELETE FROM qiy_code_sequences"); client.exec("DELETE FROM qiy_generated_probe");
});

test("renders literal, date, time, padding and escaped braces", () => {
  const now = new Date("2026-11-30T10:20:30.456Z");
  expect(qiyRenderCodeTemplate("ORG-{YYYY}{MM}-{seq:4}", { now, timeZone: "UTC", sequence: 7 })).toBe("ORG-202611-0007");
  expect(qiyRenderCodeTemplate("{YY}/{DD} {HH}:{mm}:{ss}.{SSS}", { now, timeZone: "UTC" })).toBe("26/30 10:20:30.456");
  expect(qiyRenderCodeTemplate("{seq:6}", { sequence: 42 })).toBe("000042");
  expect(qiyRenderCodeTemplate("{count+1:3}/{$.count+1}", { sequence: 5 })).toBe("005/5");
  expect(qiyRenderCodeTemplate("A{{B}}C", { now })).toBe("A{B}C");
  expect(qiyRenderCodeTemplate("{uuid}", { uuid: "00000000-0000-4000-8000-000000000001" })).toBe("00000000-0000-4000-8000-000000000001");
});

test("renders date parts in QIY_CODE_TIMEZONE", () => {
  const now = new Date("2026-11-30T23:30:00.000Z");
  expect(qiyCodeDateParts(now, "Asia/Shanghai").YYYY + qiyCodeDateParts(now, "Asia/Shanghai").DD).toBe("202601");
  expect(qiyRenderCodeTemplate("{YYYYMMDD}-{HH}{mm}", { now, timeZone: "Asia/Shanghai" })).toBe("20261201-0730");
  expect(qiyRenderCodeTemplate("{YYYYMMDD}", { now, timeZone: "UTC" })).toBe("20261130");
  expect(qiyCodeTemplateBucket("PO-{YYYYMMDD}-{seq:4}", now, "UTC")).toBe("20261130");
  expect(qiyCodeTemplateBucket("PO-{seq:4}", now, "UTC")).toBe("");
});

test("random tokens have the requested length and charset", () => {
  const alphanumeric = qiyRenderCodeTemplate("{random:10}", { now: new Date() });
  expect(alphanumeric).toHaveLength(10);
  expect(alphanumeric).toMatch(/^[0-9A-Za-z]{10}$/);
  const restricted = qiyRenderCodeTemplate("{random:8:A-F0-9}", { now: new Date() });
  expect(restricted).toMatch(/^[A-F0-9]{8}$/);
  const seen = new Set(Array.from({ length: 200 }, () => qiyRenderCodeTemplate("{random:10}", { now: new Date() })));
  expect(seen.size).toBe(200);
});

test("rejects malformed patterns instead of rendering them", () => {
  expect(() => qiyRenderCodeTemplate("{nope}", {})).toThrow("Unsupported token");
  expect(() => qiyRenderCodeTemplate("{YYYY", {})).toThrow("Unclosed token");
  expect(() => qiyRenderCodeTemplate("{random:0}", {})).toThrow("width");
});

test("sequences increment per date-part bucket and reset on a new bucket", async () => {
  const fields: QiyGeneratedField[] = [{ field: "code", kind: "code", template: "C-{YYYYMMDD}-{seq:3}" }];
  const first = await qiyGenerateValues("bucket-probe", fields, { now: new Date("2026-11-30T08:00:00Z"), timeZone: "UTC" });
  const second = await qiyGenerateValues("bucket-probe", fields, { now: new Date("2026-11-30T09:00:00Z"), timeZone: "UTC" });
  const nextDay = await qiyGenerateValues("bucket-probe", fields, { now: new Date("2026-12-01T00:00:01Z"), timeZone: "UTC" });
  const back = await qiyGenerateValues("bucket-probe", fields, { now: new Date("2026-11-30T23:59:59Z"), timeZone: "UTC" });
  expect(first.code).toBe("C-20261130-001");
  expect(second.code).toBe("C-20261130-002");
  expect(nextDay.code).toBe("C-20261201-001");
  expect(back.code).toBe("C-20261130-003");
});

test("generates a UUIDv4 for every uuid field", async () => {
  const values = await qiyGenerateValues("uuid-probe", [{ field: "externalId", kind: "uuid" }]);
  expect(String(values.externalId)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(await qiyGenerateValues("uuid-probe", [{ field: "externalId", kind: "uuid" }])).not.toEqual(values);
});

test("ignores client-supplied generated values and strips them without mutating", () => {
  const input: Record<string, unknown> = { code: "CLIENT", externalId: "client", name: "Example" };
  expect(qiyStripGeneratedValues(input, PROBE_FIELDS)).toEqual({ name: "Example" });
  expect(input.code).toBe("CLIENT");
});

test("creates unique codes under concurrent creation", async () => {
  const created = await Promise.all(Array.from({ length: 25 }, () => qiyCreateWithGeneratedValues("probe", PROBE_FIELDS, { code: "CLIENT-CODE", externalId: "client-uuid" }, (prepared: Record<string, unknown>) => { client.query("INSERT INTO qiy_generated_probe (id, code, externalId) VALUES (?, ?, ?)").run(crypto.randomUUID(), String(prepared.code), String(prepared.externalId)); return prepared; })));
  for (const record of created) {
    expect(String(record.code)).toMatch(/^PRB-\d{8}-\d{4}$/);
    expect(String(record.code)).not.toBe("CLIENT-CODE");
    expect(String(record.externalId)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  const codes = (client.query("SELECT code FROM qiy_generated_probe ORDER BY code").all() as Array<{ code: string }>).map((row) => row.code);
  expect(codes).toHaveLength(25);
  expect(new Set(codes).size).toBe(25);
  const suffixes = codes.map((code) => Number(code.slice(-4))).sort((left, right) => left - right);
  expect(suffixes).toEqual(Array.from({ length: 25 }, (_value, index) => index + 1));
});
