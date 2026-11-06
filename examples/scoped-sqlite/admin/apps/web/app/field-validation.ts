import type { ResourceField } from "./resources";

export type FieldRules = NonNullable<ResourceField["rules"]>;
type Translate = (key: string, options?: Record<string, unknown>, defaultMessage?: string) => string;

/**
 * The form-side mirror of the server's @min/@max/@length/@pattern check. Empty
 * values are left to the `required` rule; the server stays the authority.
 */
export function fieldRuleMessage(value: unknown, rules: FieldRules, label: string, translate: Translate): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (rules.min !== undefined || rules.max !== undefined) {
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number)) {
      if (rules.min !== undefined && number < rules.min) return translate("qiy.validation.min", { label, min: rules.min }, `${label} must be at least ${rules.min}`);
      if (rules.max !== undefined && number > rules.max) return translate("qiy.validation.max", { label, max: rules.max }, `${label} must be at most ${rules.max}`);
    }
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (rules.minLength !== undefined && length < rules.minLength) return translate("qiy.validation.minLength", { label, min: rules.minLength }, `${label} must be at least ${rules.minLength} characters`);
    if (rules.maxLength !== undefined && length > rules.maxLength) return translate("qiy.validation.maxLength", { label, max: rules.maxLength }, `${label} must be at most ${rules.maxLength} characters`);
    if (rules.pattern !== undefined && !new RegExp(rules.pattern, "u").test(value)) return translate("qiy.validation.pattern", { label, example: rules.example ?? rules.pattern }, `${label} must match the format, for example ${rules.example ?? rules.pattern}`);
  }
  return undefined;
}

/** `@default` literals of the given fields, used as create-form initial values. */
export function createFormDefaults(fields: ResourceField[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => field.defaultValue === undefined ? [] : [[field.name, field.defaultValue]]));
}
