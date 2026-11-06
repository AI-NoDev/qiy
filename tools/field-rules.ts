import type { DatabaseIR, FieldIR } from "./database-ir";

/** The declared value constraints of one field, in the shape the generated server and form consume. */
export interface FieldRules {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  example?: string;
}

const numericTypes = new Set(["Integer", "Decimal", "Money"]);
const textTypes = new Set(["Text", "Email", "URL"]);
const decimalLiteral = /^-?\d+(\.\d+)?$/;
// The shortest valid value of each text type, so `@length` cannot exclude every value.
const shortestText: Record<string, string> = { Text: "x", Email: "a@b.co", URL: "https://a.co" };

export function fieldRulesOf(field: FieldIR): FieldRules | undefined {
  const rules: FieldRules = {
    ...(field.min !== undefined && { min: field.min }),
    ...(field.max !== undefined && { max: field.max }),
    ...(field.minLength !== undefined && { minLength: field.minLength }),
    ...(field.maxLength !== undefined && { maxLength: field.maxLength }),
    ...(field.pattern && { pattern: field.pattern.source, example: field.pattern.example }),
  };
  return Object.keys(rules).length ? rules : undefined;
}

/** Mirrors the generated `api/src/field-rules.ts` check so models are rejected before generation. */
export function fieldRuleViolation(value: unknown, rules: FieldRules): string | undefined {
  if (rules.min !== undefined || rules.max !== undefined) {
    const number = typeof value === "number" ? value : typeof value === "string" && decimalLiteral.test(value) ? Number(value) : Number.NaN;
    if (!Number.isFinite(number)) return "must be a number";
    if (rules.min !== undefined && number < rules.min) return `must be at least ${rules.min}`;
    if (rules.max !== undefined && number > rules.max) return `must be at most ${rules.max}`;
  }
  if (rules.minLength !== undefined || rules.maxLength !== undefined || rules.pattern !== undefined) {
    if (typeof value !== "string") return "must be a string";
    const length = [...value].length;
    if (rules.minLength !== undefined && length < rules.minLength) return `must be at least ${rules.minLength} characters`;
    if (rules.maxLength !== undefined && length > rules.maxLength) return `must be at most ${rules.maxLength} characters`;
    if (rules.pattern !== undefined && !new RegExp(rules.pattern, "u").test(value)) return `must match ${rules.pattern}`;
  }
  return undefined;
}

function decimalPlaces(value: number): number {
  return String(value).split(".")[1]?.length ?? 0;
}

function enumValuesOf(field: FieldIR, database: Pick<DatabaseIR, "enums">): string[] {
  return database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values.map((value) => value.name) ?? [];
}

/** Model errors for `@min`, `@max`, `@length`, `@pattern` and `@default`, without the `entity.field:` prefix. */
export function fieldRuleErrors(field: FieldIR, database: Pick<DatabaseIR, "enums">): string[] {
  const errors: string[] = [];
  const numeric = numericTypes.has(field.type);
  const text = textTypes.has(field.type) && !field.enumName;
  if (field.min !== undefined || field.max !== undefined) {
    if (!numeric) errors.push("@min/@max require an Integer, Decimal or Money field");
    for (const [name, bound] of [["@min", field.min], ["@max", field.max]] as const) {
      if (bound === undefined) continue;
      if (!Number.isFinite(bound)) errors.push(`${name} must be a finite number`);
      else if (field.type === "Integer" && !Number.isSafeInteger(bound)) errors.push(`${name} must be an integer on Integer fields`);
      else if ((field.type === "Decimal" || field.type === "Money") && decimalPlaces(bound) > (field.scale ?? 0)) errors.push(`${name} has more decimal places than the field scale ${field.scale ?? 0}`);
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) errors.push("@min cannot be greater than @max");
  }
  if (field.minLength !== undefined || field.maxLength !== undefined) {
    if (!text) errors.push("@length requires a Text, Email or URL field without an enum");
    if (field.minLength !== undefined && (!Number.isSafeInteger(field.minLength) || field.minLength < 0)) errors.push("@length minimum must be a non-negative integer");
    if (field.maxLength !== undefined && (!Number.isSafeInteger(field.maxLength) || field.maxLength < 1)) errors.push("@length maximum must be a positive integer");
    if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) errors.push("@length minimum cannot be greater than the maximum");
    const shortest = shortestText[field.type];
    if (text && shortest && field.maxLength !== undefined && field.maxLength < shortest.length) errors.push(`@length maximum must be at least ${shortest.length} for ${field.type} fields`);
  }
  if (field.pattern) {
    if (field.type !== "Text" || field.enumName) errors.push("@pattern requires a Text field without an enum");
    if (field.codeTemplate !== undefined || field.computed !== undefined) errors.push("@pattern cannot be combined with @code or @computed");
    let compiled = true;
    try { new RegExp(field.pattern.source, "u"); } catch (error) {
      compiled = false;
      errors.push(`@pattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (compiled) {
      const violation = fieldRuleViolation(field.pattern.example, fieldRulesOf(field)!);
      if (violation) errors.push(`@pattern example ${JSON.stringify(field.pattern.example)} ${violation}`);
    }
  }
  const rules = fieldRulesOf(field);
  if (rules && (field.primaryKey || field.computed !== undefined || field.codeTemplate !== undefined || field.generatedValue !== undefined)) {
    errors.push("value constraints cannot be declared on primary keys, @computed, @code or @generated fields");
  }
  if (field.defaultValue) errors.push(...defaultValueErrors(field, database, rules));
  return errors;
}

function defaultValueErrors(field: FieldIR, database: Pick<DatabaseIR, "enums">, rules: FieldRules | undefined): string[] {
  const value = field.defaultValue!;
  if (field.primaryKey || field.computed !== undefined || field.codeTemplate !== undefined || field.generatedValue !== undefined || field.softDelete || field.tenantClaim !== undefined) {
    return ["@default cannot be declared on primary keys, @computed, @code, @generated, @softDelete or @tenant fields"];
  }
  if (value.kind === "now") return field.type === "DateTime" ? [] : ["@default(now) requires a DateTime field"];
  const literal = value.value;
  if (field.enumName) {
    const members = enumValuesOf(field, database);
    return typeof literal === "string" && members.includes(literal) ? [] : [`@default must be one of the ${field.enumName} values: ${members.join(", ")}`];
  }
  const mismatch = (() => {
    switch (field.type) {
      case "Text":
      case "Email":
      case "URL": return typeof literal !== "string";
      case "Integer": return typeof literal !== "number" || !Number.isSafeInteger(literal);
      case "Decimal":
      case "Money": return typeof literal !== "string" || !decimalLiteral.test(literal) || (literal.split(".")[1]?.length ?? 0) > (field.scale ?? 0);
      case "Boolean": return typeof literal !== "boolean";
      case "Date": return typeof literal !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(literal) || Number.isNaN(Date.parse(`${literal}T00:00:00Z`));
      case "Time": return typeof literal !== "string" || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(literal);
      case "DateTime": return "@default on DateTime fields only supports now";
      default: return `@default is not supported on ${field.type} fields`;
    }
  })();
  if (typeof mismatch === "string") return [mismatch];
  if (mismatch) return [`@default ${JSON.stringify(literal)} does not match the ${field.type} field type`];
  const violation = rules ? fieldRuleViolation(literal, rules) : undefined;
  return violation ? [`@default ${JSON.stringify(literal)} ${violation}`] : [];
}

function decimalText(value: number, field: FieldIR): string {
  return value.toFixed(field.scale ?? 0);
}

/**
 * A fixture value that satisfies the field's declared constraints, or undefined
 * when the field has none (callers then keep their usual fixture). Generated
 * tests write these through the service, which enforces the same rules.
 */
export function ruleSample(field: FieldIR): string | number | undefined {
  const rules = fieldRulesOf(field);
  if (!rules) return undefined;
  if (rules.example !== undefined) return rules.example;
  if (numericTypes.has(field.type)) {
    const bounded = Math.min(Math.max(1, rules.min ?? 1), rules.max ?? 1);
    return field.type === "Integer" ? bounded : decimalText(bounded, field);
  }
  const base = field.type === "Email" ? "user@example.com" : field.type === "URL" ? "https://example.com" : "Example";
  const length = [...base].length;
  if (rules.maxLength !== undefined && length > rules.maxLength) {
    return field.type === "Text" ? [...base].slice(0, rules.maxLength).join("") : shortestText[field.type]!;
  }
  if (rules.minLength !== undefined && length < rules.minLength) {
    const padding = "x".repeat(rules.minLength - length);
    return field.type === "Email" ? padding + base : field.type === "URL" ? `${base}/${padding.slice(1)}` : base + padding;
  }
  return base;
}

/** One value per declared rule that the generated server must reject, for the route tests. */
export function ruleViolations(field: FieldIR): Array<{ rule: string; value: string | number }> {
  const rules = fieldRulesOf(field);
  if (!rules) return [];
  const numberValue = (value: number) => field.type === "Integer" ? value : decimalText(value, field);
  const step = field.type === "Integer" ? 1 : 10 ** -(field.scale ?? 0);
  const valid = ruleSample(field)!;
  const violations: Array<{ rule: string; value: string | number }> = [];
  if (rules.min !== undefined) violations.push({ rule: "min", value: numberValue(rules.min - step) });
  if (rules.max !== undefined) violations.push({ rule: "max", value: numberValue(rules.max + step) });
  if (rules.minLength !== undefined && rules.minLength > 1) {
    // Email and URL keep a well-formed value so the length rule, not the format, rejects it.
    const short = field.type === "Text" ? [...String(valid)].slice(0, rules.minLength - 1).join("") : shortestText[field.type]!;
    if ([...short].length < rules.minLength) violations.push({ rule: "minLength", value: short });
  }
  if (rules.maxLength !== undefined) violations.push({ rule: "maxLength", value: String(valid) + "x".repeat(rules.maxLength + 1 - [...String(valid)].length) });
  if (rules.pattern !== undefined) {
    const candidate = ["!", "x", "0", " ", "invalid value"].find((value) => !new RegExp(rules.pattern!, "u").test(value));
    if (candidate !== undefined) violations.push({ rule: "pattern", value: candidate });
  }
  return violations;
}

/** The runtime module behind service-level validation: one check for REST, GraphQL and CSV imports. */
export function renderFieldRulesModule(): string {
  return `export interface QiyFieldRules {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  example?: string;
}

export class QiyFieldRuleError extends Error {
  readonly field: string;
  readonly rule: keyof QiyFieldRules | "type";
  readonly errorKey: string;
  /** graphql-js copies an original error's extensions into the GraphQL response. */
  readonly extensions: { status: 400; errorKey: string; field: string };

  constructor(field: string, rule: keyof QiyFieldRules | "type", message: string) {
    super(field + " " + message);
    this.name = "QiyFieldRuleError";
    this.field = field;
    this.rule = rule;
    this.errorKey = "validation." + rule;
    this.extensions = { status: 400, errorKey: this.errorKey, field };
  }
}

const decimal = /^-?\\d+(\\.\\d+)?$/;
const patterns = new Map<string, RegExp>();
const compiled = (source: string) => {
  let pattern = patterns.get(source);
  if (!pattern) { pattern = new RegExp(source, "u"); patterns.set(source, pattern); }
  return pattern;
};

/**
 * Checks the declared @min/@max/@length/@pattern rules of one write payload.
 * Absent and null values are skipped so nullable fields and PATCH bodies keep
 * working; a violation throws QiyFieldRuleError (400).
 */
export function checkFieldRules(values: Record<string, unknown>, rules: Record<string, QiyFieldRules>): void {
  for (const [field, rule] of Object.entries(rules)) {
    if (!Object.hasOwn(values, field)) continue;
    const value = values[field];
    if (value === null || value === undefined) continue;
    if (rule.min !== undefined || rule.max !== undefined) {
      const number = typeof value === "number" ? value : typeof value === "string" && decimal.test(value) ? Number(value) : Number.NaN;
      if (!Number.isFinite(number)) throw new QiyFieldRuleError(field, "type", "must be a number");
      if (rule.min !== undefined && number < rule.min) throw new QiyFieldRuleError(field, "min", "must be at least " + rule.min);
      if (rule.max !== undefined && number > rule.max) throw new QiyFieldRuleError(field, "max", "must be at most " + rule.max);
    }
    if (rule.minLength !== undefined || rule.maxLength !== undefined || rule.pattern !== undefined) {
      if (typeof value !== "string") throw new QiyFieldRuleError(field, "type", "must be a string");
      const length = [...value].length;
      if (rule.minLength !== undefined && length < rule.minLength) throw new QiyFieldRuleError(field, "minLength", "must be at least " + rule.minLength + " characters");
      if (rule.maxLength !== undefined && length > rule.maxLength) throw new QiyFieldRuleError(field, "maxLength", "must be at most " + rule.maxLength + " characters");
      if (rule.pattern !== undefined && !compiled(rule.pattern).test(value)) throw new QiyFieldRuleError(field, "pattern", "must match the format " + (rule.example ?? rule.pattern));
    }
  }
}
`;
}

/**
 * The Drizzle column modifier for `@default`. MySQL TEXT columns cannot carry a
 * literal default, so MySQL text values (and every `now`) are filled by Drizzle
 * on insert instead of by the column definition.
 */
export function drizzleDefault(field: FieldIR, dialect: DatabaseIR["dialect"]): string {
  if (field.version) return ".default(1)";
  const value = field.defaultValue;
  if (!value) return "";
  if (value.kind === "now") return dialect === "postgresql" ? ".defaultNow()" : ".$defaultFn(() => new Date())";
  const literal = dialect === "sqlite" && (field.type === "Decimal" || field.type === "Money") ? Number(value.value) : value.value;
  if (dialect === "mysql" && textTypes.has(field.type)) return `.$defaultFn(() => ${JSON.stringify(literal)})`;
  return `.default(${JSON.stringify(literal)})`;
}

/** The value a create form starts with; `now` stays empty because the server fills it. */
export function formDefault(field: FieldIR): string | number | boolean | undefined {
  return field.defaultValue?.kind === "literal" ? field.defaultValue.value : undefined;
}

/** The declared rules of an entity's writable fields, keyed by field name. */
export function entityFieldRules(fields: FieldIR[]): Record<string, FieldRules> {
  return Object.fromEntries(fields.flatMap((field) => {
    const rules = fieldRulesOf(field);
    return rules ? [[field.name, rules]] : [];
  }));
}
