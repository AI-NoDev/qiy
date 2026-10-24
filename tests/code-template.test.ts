import { describe, expect, test } from "bun:test";
import {
  CODE_TEMPLATE_DEFAULT_RANDOM_CHARSET,
  codeTemplateBucket,
  codeTemplateDatePartSequence,
  codeTemplateDateParts,
  codeTemplateTimeZone,
  isValidCodeTemplate,
  parseCodeTemplate,
  renderCodeTemplate,
  validateCodeTemplate,
} from "../tools/code-template";

describe("code template grammar", () => {
  test("parses literals, date tokens, sequences, random tokens and uuid", () => {
    const template = parseCodeTemplate("ORG-{YYYYMMDD}-{seq:4}-{random:10}-{uuid}");
    expect(template.bucketParts).toEqual(["YYYY", "MM", "DD"]);
    expect(template.sequenceWidth).toBe(4);
    expect(template.hasSequence).toBe(true);
    expect(template.hasUniqueToken).toBe(true);
    expect(template.tokens).toEqual([
      { kind: "literal", value: "ORG-" },
      { kind: "date", part: "YYYY" },
      { kind: "date", part: "MM" },
      { kind: "date", part: "DD" },
      { kind: "literal", value: "-" },
      { kind: "sequence", width: 4, alias: false },
      { kind: "literal", value: "-" },
      { kind: "random", length: 10, charset: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" },
      { kind: "literal", value: "-" },
      { kind: "uuid" },
    ]);
  });

  test("accepts concatenated date and time tokens", () => {
    expect(codeTemplateDatePartSequence("YYYYMMDD")).toEqual(["YYYY", "MM", "DD"]);
    expect(codeTemplateDatePartSequence("HHmmss")).toEqual(["HH", "mm", "ss"]);
    expect(codeTemplateDatePartSequence("YYMMDDHHmmssSSS")).toEqual(["YY", "MM", "DD", "HH", "mm", "ss", "SSS"]);
    expect(codeTemplateDatePartSequence("YYYYMMDDHHmmss")).toEqual(["YYYY", "MM", "DD", "HH", "mm", "ss"]);
    expect(codeTemplateDatePartSequence("abc")).toBeUndefined();
  });

  test("treats count+1 forms as sequence aliases", () => {
    for (const pattern of ["{seq:4}", "{count+1:4}", "{$.count+1:4}"]) {
      const template = parseCodeTemplate(pattern);
      expect(template.sequenceWidth).toBe(4);
      expect(renderCodeTemplate(template, { sequence: 12 })).toBe("0012");
    }
    expect(parseCodeTemplate("{count+1}").tokens[0]).toMatchObject({ kind: "sequence", width: 1, alias: true });
  });

  test("expands random charsets and the natural form", () => {
    const canonical = parseCodeTemplate("{random:8:a-zA-Z0-9}");
    expect(canonical.tokens[0]).toMatchObject({ kind: "random", length: 8, charset: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
    expect(parseCodeTemplate("{random:10}").tokens[0]).toMatchObject({ kind: "random", length: 10, charset: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
    const natural = parseCodeTemplate("{random a-z/A-Z/0-9 length 6}");
    expect(natural.tokens[0]).toMatchObject({ kind: "random", length: 6, charset: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
    expect(parseCodeTemplate("{random A-F0-9 length 4}").tokens[0]).toMatchObject({ kind: "random", length: 4, charset: "ABCDEF0123456789" });
    expect(CODE_TEMPLATE_DEFAULT_RANDOM_CHARSET).toBe("a-zA-Z0-9");
  });

  test("escapes literal braces", () => {
    expect(parseCodeTemplate("A{{B}}C-{seq}")).toBeTruthy();
    expect(renderCodeTemplate("A{{B}}C-{seq}", { sequence: 1 })).toBe("A{B}C-1");
    expect(renderCodeTemplate("{{YYYY}}-{YYYY}", { now: new Date("2026-11-30T00:00:00Z"), timeZone: "UTC" })).toBe("{YYYY}-2026");
  });
});

describe("code template rendering", () => {
  const now = new Date("2026-11-30T10:20:30.456Z");

  test("renders date and clock parts", () => {
    expect(renderCodeTemplate("{YYYY}{YY}{MM}{DD}", { now, timeZone: "UTC" })).toBe("2026261130");
    expect(renderCodeTemplate("{HH}:{mm}:{ss}.{SSS}", { now, timeZone: "UTC" })).toBe("10:20:30.456");
  });

  test("renders in the configured timezone and defaults to UTC", () => {
    const lateUtc = new Date("2026-11-30T23:30:00.000Z");
    expect(renderCodeTemplate("{YYYYMMDD}-{HH}{mm}", { now: lateUtc, timeZone: "Asia/Shanghai" })).toBe("20261201-0730");
    expect(renderCodeTemplate("{YYYYMMDD}", { now: lateUtc, timeZone: "UTC" })).toBe("20261130");
    expect(codeTemplateTimeZone({})).toBe("UTC");
    expect(codeTemplateTimeZone({ QIY_CODE_TIMEZONE: "Asia/Shanghai" })).toBe("Asia/Shanghai");
    expect(codeTemplateTimeZone({ QIY_CODE_TIMEZONE: "  " })).toBe("UTC");
    expect(() => codeTemplateDateParts(now, "Not/AZone")).toThrow("not a valid IANA timezone");
  });

  test("renders a shared sequence with per-token padding", () => {
    expect(renderCodeTemplate("{seq:4}-{seq:2}", { sequence: 7 })).toBe("0007-07");
    expect(renderCodeTemplate("{count+1}/{$.count+1:3}", { sequence: 12 })).toBe("12/012");
  });

  test("renders uuid and random values with injected sources", () => {
    expect(renderCodeTemplate("{uuid}", { uuid: "00000000-0000-4000-8000-000000000009" })).toBe("00000000-0000-4000-8000-000000000009");
    expect(renderCodeTemplate("{random:5}", { random: (length, charset) => `${length}:${charset.slice(0, 3)}` })).toBe("5:abc");
    expect(renderCodeTemplate("{uuid}")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const random = renderCodeTemplate("{random:12}");
    expect(random).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(new Set(Array.from({ length: 100 }, () => renderCodeTemplate("{random:12}"))).size).toBe(100);
  });

  test("builds the sequence bucket from the rendered date parts", () => {
    expect(codeTemplateBucket("PO-{YYYYMMDD}-{seq:4}", now, "UTC")).toBe("20261130");
    expect(codeTemplateBucket("M-{YYYY}{MM}-{seq}", now, "UTC")).toBe("202611");
    expect(codeTemplateBucket("T-{HH}{mm}{ss}-{seq}", now, "UTC")).toBe("102030");
    expect(codeTemplateBucket("PO-{seq:4}", now, "UTC")).toBe("");
  });
});

describe("code template validation", () => {
  test("accepts documented patterns", () => {
    for (const pattern of [
      "ORG-{YYYY}{MM}-{seq:4}",
      "CUS-{YYYYMMDD}-{seq:4}",
      "DD_{YYYYMMDD}{HHmmss}-{seq:4}-{random:10}",
      "PO-{count+1:4}",
      "{uuid}",
      "{{literal}}-{random A-Z0-9 length 8}",
    ]) {
      expect(validateCodeTemplate(pattern)).toEqual([]);
      expect(isValidCodeTemplate(pattern)).toBe(true);
    }
  });

  test("rejects malformed patterns with a precise message", () => {
    expect(validateCodeTemplate("{nope}")[0]).toContain("unknown token {nope}");
    expect(validateCodeTemplate("{nope}")[0]).toContain("offset 0");
    expect(validateCodeTemplate("{YYYY")[0]).toContain("unclosed token");
    expect(validateCodeTemplate("A}B")[0]).toContain("unescaped }");
    expect(validateCodeTemplate("")[0]).toContain("non-empty string");
    expect(validateCodeTemplate("literal-only")[0]).toContain("at least one");
    expect(validateCodeTemplate("{YYYY}-{MM}")[0]).toContain("needs {seq}");
    expect(parseCodeTemplate("{YYYY}-{MM}").hasUniqueToken).toBe(false);
    expect(renderCodeTemplate("{YYYY}-{MM}", { now: new Date("2026-11-30T00:00:00Z"), timeZone: "UTC" })).toBe("2026-11");
    expect(validateCodeTemplate("{seq:0}")[0]).toContain("between 1 and 12");
    expect(validateCodeTemplate("{seq:13}")[0]).toContain("between 1 and 12");
    expect(validateCodeTemplate("{random:0}")[0]).toContain("between 1 and 256");
    expect(validateCodeTemplate("{random:10:z-a}")[0]).toContain("increasing ASCII alphanumerics");
    expect(validateCodeTemplate("{random:10:a!b}")[0]).toContain("ASCII alphanumerics");
    expect(validateCodeTemplate("{random:10:}")[0]).toContain("must not be empty");
    expect(() => parseCodeTemplate("{nested{brace}}")).toThrow("nested braces");
  });
});
