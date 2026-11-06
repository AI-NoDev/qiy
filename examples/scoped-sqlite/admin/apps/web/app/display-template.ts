import type { ResourceDefinition, ResourceField } from "./resources";
import { formatFieldValue, isDateFieldType } from "./date-fields";

/**
 * Entity display templates (`@display`, `@tableDisplay`, `@relationDetail`) are
 * written in a deliberately tiny language: literal text, `{$.field}`
 * placeholders, and a whitelisted set of presentation tags. The DSL validates
 * templates at generation time; this module is the render-time half of the same
 * contract. It escapes every interpolated value and re-checks the tag whitelist
 * so a hand-edited `resources.ts` still cannot inject markup or script.
 */
export const displayTemplateTags = ["br", "b", "strong", "i", "em", "span", "small", "p", "div"] as const;
const allowedTags = new Set<string>(displayTemplateTags);
const blockTags = new Set(["br", "p", "div"]);
const tokenPattern = /\{\$\.([a-zA-Z_][a-zA-Z0-9_]*)\}|<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\/?)>/g;

/** Refine's translate function shape; only the parts display templates use. */
export type DisplayTranslate = (key: string, options?: Record<string, unknown>, fallback?: string) => string;

export interface DisplayTemplateOptions {
  /** Field metadata used to translate enum values and normalize values. */
  fields?: ResourceField[];
  /** Translate function, usually Refine's `translate` from `useTranslation()`. */
  translate?: DisplayTranslate;
  /** Inserted when a placeholder resolves to null, undefined or an empty string. Defaults to an empty string. */
  empty?: string;
  /** Current UI locale used for localized Date/Time/DateTime placeholder text. */
  locale?: string;
}

export type DisplayTemplateToken =
  | { kind: "text"; value: string }
  | { kind: "tag"; name: string; closing: boolean }
  | { kind: "placeholder"; name: string };

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function tokenize(template: string): DisplayTemplateToken[] {
  const tokens: DisplayTemplateToken[] = [];
  let last = 0;
  for (const match of template.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "text", value: template.slice(last, index) });
    if (match[1] !== undefined) tokens.push({ kind: "placeholder", name: match[1] });
    else tokens.push({ kind: "tag", name: (match[3] ?? "").toLowerCase(), closing: match[2] === "/" });
    last = index + match[0].length;
  }
  if (last < template.length) tokens.push({ kind: "text", value: template.slice(last) });
  return tokens;
}

/** Resolves one placeholder to display text, translating enum values and joining arrays. */
export function displayFieldValue(fieldName: string, record: Record<string, unknown> | undefined, options: DisplayTemplateOptions = {}): string | undefined {
  const value = record?.[fieldName];
  if (value === undefined || value === null || value === "") return undefined;
  const field = options.fields?.find((candidate) => candidate.name === fieldName);
  if (field?.enumValues?.length) {
    const item = field.enumValues.find((candidate) => candidate.name === String(value));
    if (item) return options.translate ? options.translate(item.labelKey, {}, item.label ?? item.name) : item.label ?? item.name;
  }
  // Date, Time and DateTime placeholders go through the same formatter as list
  // and detail pages, so a template never prints a raw timestamp.
  if (field && isDateFieldType(field.type)) return formatFieldValue(field.type, value, options.locale);
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (field?.type === "Money" || field?.type === "Decimal") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

/** Renders a template as safe HTML: every interpolated value is escaped and only whitelisted tags survive. */
export function renderTemplate(template: string | undefined, record: Record<string, unknown> | undefined, options: DisplayTemplateOptions = {}): string {
  if (!template) return "";
  const parts: string[] = [];
  for (const token of tokenize(template)) {
    if (token.kind === "text") {
      parts.push(escapeHtml(token.value));
      continue;
    }
    if (token.kind === "tag") {
      if (!allowedTags.has(token.name)) continue;
      if (token.name === "br") parts.push("<br>");
      else parts.push(token.closing ? "</" + token.name + ">" : "<" + token.name + ">");
      continue;
    }
    const value = displayFieldValue(token.name, record, options);
    parts.push(escapeHtml(value ?? options.empty ?? ""));
  }
  return parts.join("");
}

/** Renders a template as plain text for select options, cell text, tooltips and titles. */
export function plainTextTemplate(template: string | undefined, record: Record<string, unknown> | undefined, options: DisplayTemplateOptions = {}): string {
  if (!template) return "";
  const parts: string[] = [];
  for (const token of tokenize(template)) {
    if (token.kind === "text") {
      parts.push(token.value);
      continue;
    }
    if (token.kind === "tag") {
      if (blockTags.has(token.name)) parts.push(" ");
      continue;
    }
    const value = displayFieldValue(token.name, record, options);
    if (value !== undefined) parts.push(value);
    else if (options.empty) parts.push(options.empty);
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

/**
 * Record display text for an entity: its `@tableDisplay`/`@display` template,
 * then the related label field, then the id. Used for FK cells, drawer titles,
 * select options and related lists.
 */
export function recordDisplayText(resource: ResourceDefinition | undefined, record: Record<string, unknown> | undefined, options: DisplayTemplateOptions = {}, labelField?: string): string {
  if (!record) return "";
  const resolved: DisplayTemplateOptions = { ...options, fields: options.fields ?? resource?.fields };
  const template = resource?.tableDisplayTemplate ?? resource?.displayTemplate;
  if (template) {
    const text = plainTextTemplate(template, record, resolved);
    if (text) return text;
  }
  const fallback = labelField && resource?.fields.find((field) => field.name === labelField);
  if (fallback) {
    const fallbackValue = record[fallback.name];
    if (fallbackValue !== undefined && fallbackValue !== null && fallbackValue !== "") return displayFieldValue(fallback.name, record, resolved) ?? String(fallbackValue);
  }
  const natural = resource?.fields.find((field) => ["name", "title", "displayName", "code", "number", "sku", "email", "label", "inventoryKey"].includes(field.name));
  const naturalValue = natural ? record[natural.name] : undefined;
  if (natural && naturalValue !== undefined && naturalValue !== null && naturalValue !== "") return displayFieldValue(natural.name, record, resolved) ?? String(naturalValue);
  return record.id === undefined || record.id === null ? "" : String(record.id);
}

/** Renders the FK detail drawer body from `@relationDetail`, or the empty string when the model declares none. */
export function relationDetailHtml(resource: ResourceDefinition | undefined, record: Record<string, unknown> | undefined, options: DisplayTemplateOptions = {}): string {
  if (!record || !resource?.relationDetailTemplate) return "";
  return renderTemplate(resource.relationDetailTemplate, record, { ...options, fields: options.fields ?? resource.fields });
}
