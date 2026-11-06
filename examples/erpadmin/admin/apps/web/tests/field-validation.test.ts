import { expect, test } from "bun:test";
import { createFormDefaults, fieldRuleMessage } from "../app/field-validation";
import type { ResourceField } from "../app/resources";

const translate = (key: string, options: Record<string, unknown> = {}) => key + ":" + JSON.stringify(options);

test("form rules mirror the server's @min/@max/@length/@pattern check", () => {
  expect(fieldRuleMessage(0, { min: 1, max: 5 }, "Priority", translate)).toBe('qiy.validation.min:{"label":"Priority","min":1}');
  expect(fieldRuleMessage("6", { min: 1, max: 5 }, "Priority", translate)).toBe('qiy.validation.max:{"label":"Priority","max":5}');
  expect(fieldRuleMessage(3, { min: 1, max: 5 }, "Priority", translate)).toBeUndefined();
  expect(fieldRuleMessage("ab", { minLength: 3, maxLength: 4 }, "Title", translate)).toBe('qiy.validation.minLength:{"label":"Title","min":3}');
  expect(fieldRuleMessage("abcde", { minLength: 3, maxLength: 4 }, "Title", translate)).toBe('qiy.validation.maxLength:{"label":"Title","max":4}');
  // Lengths count code points, like the server, so three emoji are three characters.
  expect(fieldRuleMessage("\u{1F600}\u{1F600}\u{1F600}", { minLength: 3, maxLength: 3 }, "Title", translate)).toBeUndefined();
  expect(fieldRuleMessage("Support", { pattern: "^[a-z]+$", example: "support" }, "Queue", translate)).toBe('qiy.validation.pattern:{"label":"Queue","example":"support"}');
  expect(fieldRuleMessage("", { minLength: 3 }, "Title", translate)).toBeUndefined();
});

test("create forms start from the declared @default literals", () => {
  const fields = [{ name: "priority", defaultValue: 3 }, { name: "title" }, { name: "urgent", defaultValue: false }] as ResourceField[];
  expect(createFormDefaults(fields)).toEqual({ priority: 3, urgent: false });
});
