/**
 * Business-code templates for `field ... Text @code("ORG-{YYYY}{MM}-{seq:4}")`.
 *
 * The grammar is intentionally small and closed so a pattern is validated when
 * the model is parsed (and again in `validateDatabaseIR`), never at request time:
 *
 *   {uuid}                  random UUID v4
 *   {YYYY} {YY} {MM} {DD}   calendar parts, rendered in QIY_CODE_TIMEZONE (UTC)
 *   {HH} {mm} {ss} {SSS}    clock parts (24h) and milliseconds
 *   {seq} {seq:4}           per entity/field/bucket sequence, zero padded to width
 *   {count+1} {count+1:4}   alias for {seq} / {seq:N} (also {$.count+1[:N]})
 *   {random:10}             ten characters from the default a-zA-Z0-9 charset
 *   {random:10:a-zA-Z0-9}   ten characters from an explicit charset
 *   {{ and }}               literal braces
 *
 * Everything else is a literal. When a pattern contains date/time tokens the
 * sequence is bucketed by those rendered parts (daily for `{YYYYMMDD}`), so the
 * first purchase order of a day is `PO-20261130-0001`.
 *
 * This module is the single source of truth for the grammar. The generated
 * server runtime (`api/src/generated-values.ts`, built by generate-server.ts)
 * carries the same renderer so codes can be rendered from the database-backed
 * sequence without importing the Qiy CLI, and the generated server test suite
 * exercises that copy end to end.
 */

export const CODE_TEMPLATE_DATE_PARTS = ["YYYY", "YY", "MM", "DD", "HH", "mm", "ss", "SSS"] as const;
export type CodeTemplateDatePart = (typeof CODE_TEMPLATE_DATE_PARTS)[number];

/** Canonical default random charset, matching the documented `{random:N}` form. */
export const CODE_TEMPLATE_DEFAULT_RANDOM_CHARSET = "a-zA-Z0-9";

export const CODE_TEMPLATE_MAX_PATTERN_LENGTH = 512;
export const CODE_TEMPLATE_MAX_SEQUENCE_WIDTH = 12;
export const CODE_TEMPLATE_MAX_RANDOM_LENGTH = 256;

export type CodeTemplateToken =
  | { kind: "literal"; value: string }
  | { kind: "uuid" }
  | { kind: "date"; part: CodeTemplateDatePart }
  | { kind: "sequence"; width: number; alias: boolean }
  | { kind: "random"; length: number; charset: string };

export interface CodeTemplate {
  pattern: string;
  tokens: CodeTemplateToken[];
  /** Date/time tokens in declaration order; together they form the sequence bucket key. */
  bucketParts: CodeTemplateDatePart[];
  /** Padding width of the first sequence token (1 when the pattern has none). */
  sequenceWidth: number;
  hasSequence: boolean;
  /** A UUID, sequence or random token exists, so two renders are (normally) distinct. */
  hasUniqueToken: boolean;
}

/** A template that violates the grammar. `position` is the byte offset in the pattern. */
export class QiyCodeTemplateError extends Error {
  readonly pattern: string;
  readonly position: number;

  constructor(pattern: string, position: number, message: string) {
    super(`invalid @code template ${JSON.stringify(pattern)} at offset ${position}: ${message}`);
    this.name = "QiyCodeTemplateError";
    this.pattern = pattern;
    this.position = position;
  }
}

const DATE_PARTS = new Set<string>(CODE_TEMPLATE_DATE_PARTS);

/**
 * Splits a concatenated date token such as `{YYYYMMDD}` or `{HHmmss}` into its
 * parts. Lengths are unambiguous (YYYY is four characters, SSS three, the rest
 * two), so a token can contain any ordered combination of them.
 */
export function codeTemplateDatePartSequence(body: string): CodeTemplateDatePart[] | undefined {
  const parts: CodeTemplateDatePart[] = [];
  let index = 0;
  while (index < body.length) {
    const rest = body.slice(index);
    if (rest.startsWith("YYYY")) { parts.push("YYYY"); index += 4; continue; }
    if (rest.startsWith("SSS")) { parts.push("SSS"); index += 3; continue; }
    const two = rest.slice(0, 2);
    if (two === "YY" || two === "MM" || two === "DD" || two === "HH" || two === "mm" || two === "ss") {
      parts.push(two);
      index += 2;
      continue;
    }
    return undefined;
  }
  return parts.length ? parts : undefined;
}


/** Expands a charset range string (`a-zA-Z0-9`) into its characters. */
function expandCharset(pattern: string, position: number, charset: string): string {
  if (!charset) throw new QiyCodeTemplateError(pattern, position, "a random charset must not be empty");
  const characters: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < charset.length; index++) {
    const current = charset[index]!;
    const next = charset[index + 1];
    if (next === "-") {
      const end = charset[index + 2];
      if (!end) throw new QiyCodeTemplateError(pattern, position, `charset range ${JSON.stringify(current + "-")} is missing its end character`);
      if (!/[0-9A-Za-z]/.test(current) || !/[0-9A-Za-z]/.test(end) || end.charCodeAt(0) <= current.charCodeAt(0)) {
        throw new QiyCodeTemplateError(pattern, position, `charset range ${JSON.stringify(current + "-" + end)} must be two increasing ASCII alphanumerics`);
      }
      for (let code = current.charCodeAt(0); code <= end.charCodeAt(0); code++) {
        const character = String.fromCharCode(code);
        if (!seen.has(character)) { seen.add(character); characters.push(character); }
      }
      index += 2;
      continue;
    }
    if (!/[0-9A-Za-z]/.test(current)) throw new QiyCodeTemplateError(pattern, position, `random charset characters must be ASCII alphanumerics; received ${JSON.stringify(current)}`);
    if (!seen.has(current)) { seen.add(current); characters.push(current); }
  }
  if (!characters.length) throw new QiyCodeTemplateError(pattern, position, "a random charset must contain at least one character");
  return characters.join("");
}

function positiveWidth(pattern: string, position: number, raw: string): number {
  if (!/^\d+$/.test(raw)) throw new QiyCodeTemplateError(pattern, position, `a sequence width must be a decimal integer such as {seq:4}; received {${raw}}`);
  const width = Number(raw);
  if (width < 1 || width > CODE_TEMPLATE_MAX_SEQUENCE_WIDTH) throw new QiyCodeTemplateError(pattern, position, `a sequence width must be between 1 and ${CODE_TEMPLATE_MAX_SEQUENCE_WIDTH}`);
  return width;
}

function randomLength(pattern: string, position: number, raw: string): number {
  if (!/^\d+$/.test(raw)) throw new QiyCodeTemplateError(pattern, position, `a random length must be a decimal integer such as {random:10}; received ${JSON.stringify(raw)}`);
  const length = Number(raw);
  if (length < 1 || length > CODE_TEMPLATE_MAX_RANDOM_LENGTH) throw new QiyCodeTemplateError(pattern, position, `a random length must be between 1 and ${CODE_TEMPLATE_MAX_RANDOM_LENGTH}`);
  return length;
}

/**
 * Parses the natural form `{random a-z/A-Z/0-9 length 10}` the request mentioned.
 * Returns undefined when the body does not use that shape. `/` separates charset
 * groups in this form; the canonical `{random:10:a-zA-Z0-9}` form does not use it.
 */
function parseNaturalRandom(pattern: string, position: number, body: string): { length: number; charset: string } | undefined {
  const match = /^random(?:\s+([^\s]+))?\s+length\s+(\d+)$/.exec(body.trim());
  if (!match) return undefined;
  const charset = expandCharset(pattern, position, (match[1] ?? CODE_TEMPLATE_DEFAULT_RANDOM_CHARSET).replaceAll("/", ""));
  return { length: randomLength(pattern, position, match[2]!), charset };
}

function parseTokenBody(pattern: string, position: number, body: string): CodeTemplateToken {
  const trimmed = body.trim();
  if (trimmed === "uuid") return { kind: "uuid" };
  if (DATE_PARTS.has(trimmed)) return { kind: "date", part: trimmed as CodeTemplateDatePart };

  // `{seq}`, `{seq:4}`, and the user-requested `{count+1}` aliases.
  const sequence = /^(\$\.)?(seq|count\+1)(?::(\d+))?$/.exec(trimmed);
  if (sequence) {
    return { kind: "sequence", width: sequence[3] ? positiveWidth(pattern, position, sequence[3]) : 1, alias: sequence[2] === "count+1" };
  }

  // Canonical `{random:10}` / `{random:10:a-zA-Z0-9}`.
  const random = /^random:(\d+)(?::(.*))?$/.exec(trimmed);
  if (random) {
    const length = randomLength(pattern, position, random[1]!);
    const charset = expandCharset(pattern, position, random[2] ?? CODE_TEMPLATE_DEFAULT_RANDOM_CHARSET);
    return { kind: "random", length, charset };
  }

  const natural = parseNaturalRandom(pattern, position, body);
  if (natural) return { kind: "random", ...natural };

  throw new QiyCodeTemplateError(
    pattern,
    position,
    `unknown token {${body}}; allowed tokens are {uuid}, ${CODE_TEMPLATE_DATE_PARTS.map((part) => `{${part}}`).join(", ")}, {seq}, {seq:N}, {count+1}, {count+1:N}, {random:N} and {random:N:charset}. Escape a literal brace as {{ or }}`,
  );
}

/** Parses and validates a code template, throwing `QiyCodeTemplateError`. */
export function parseCodeTemplate(pattern: string): CodeTemplate {
  if (typeof pattern !== "string" || pattern.length === 0) throw new QiyCodeTemplateError(String(pattern), 0, "the pattern must be a non-empty string");
  if (pattern.length > CODE_TEMPLATE_MAX_PATTERN_LENGTH) throw new QiyCodeTemplateError(pattern, CODE_TEMPLATE_MAX_PATTERN_LENGTH, `the pattern must be at most ${CODE_TEMPLATE_MAX_PATTERN_LENGTH} characters`);
  const tokens: CodeTemplateToken[] = [];
  const bucketParts: CodeTemplateDatePart[] = [];
  const pushLiteral = (value: string) => {
    if (!value) return;
    const previous = tokens[tokens.length - 1];
    if (previous?.kind === "literal") previous.value += value;
    else tokens.push({ kind: "literal", value });
  };
  let index = 0;
  let literal = "";
  let sequenceWidth: number | undefined;
  let hasSequence = false;
  let hasUniqueToken = false;
  while (index < pattern.length) {
    const character = pattern[index]!;
    if (character === "{") {
      if (pattern[index + 1] === "{") { literal += "{"; index += 2; continue; }
      const end = pattern.indexOf("}", index + 1);
      if (end === -1) {
        pushLiteral(literal);
        literal = "";
        throw new QiyCodeTemplateError(pattern, index, "unclosed token; write a matching } or escape the brace as {{");
      }
      const body = pattern.slice(index + 1, end);
      if (body.includes("{")) throw new QiyCodeTemplateError(pattern, index, `nested braces are not supported; received {${body}}`);
      const dateParts = codeTemplateDatePartSequence(body.trim());
      if (dateParts) {
        pushLiteral(literal);
        literal = "";
        for (const part of dateParts) {
          tokens.push({ kind: "date", part });
          bucketParts.push(part);
        }
        index = end + 1;
        continue;
      }
      const token = parseTokenBody(pattern, index, body);
      pushLiteral(literal);
      literal = "";
      tokens.push(token);      if (token.kind === "date") bucketParts.push(token.part);
      else if (token.kind === "sequence") {
        hasSequence = true;
        hasUniqueToken = true;
        sequenceWidth ??= token.width;
      } else hasUniqueToken = true;
      index = end + 1;
      continue;
    }
    if (character === "}") {
      if (pattern[index + 1] === "}") { literal += "}"; index += 2; continue; }
      pushLiteral(literal);
      literal = "";
      throw new QiyCodeTemplateError(pattern, index, "unescaped }; write }} for a literal closing brace");
    }
    literal += character;
    index += 1;
  }
  pushLiteral(literal);
  if (!tokens.length) throw new QiyCodeTemplateError(pattern, 0, "the pattern renders no value");
  if (!tokens.some((token) => token.kind !== "literal")) throw new QiyCodeTemplateError(pattern, 0, "the pattern must contain at least one {…} token");
  return { pattern, tokens, bucketParts, sequenceWidth: sequenceWidth ?? 1, hasSequence, hasUniqueToken };
}

/**
 * Returns validation messages for a template; an empty array means it is valid.
 * This is the generation-time check: a business code additionally needs a unique
 * token, because a pattern made only of date parts renders duplicate codes.
 */
export function validateCodeTemplate(pattern: string): string[] {
  try {
    const template = parseCodeTemplate(pattern);
    return template.hasUniqueToken ? [] : [`invalid @code template ${JSON.stringify(pattern)}: the pattern needs {seq}, {count+1}, {random:…} or {uuid} so generated codes stay unique`];
  } catch (error) {
    if (error instanceof QiyCodeTemplateError) return [error.message];
    throw error;
  }
}

/** True when `value` is a valid code template. */
export function isValidCodeTemplate(pattern: string): boolean {
  return validateCodeTemplate(pattern).length === 0;
}

export interface CodeTemplateRenderOptions {
  /** Instant the date/time tokens are rendered from; defaults to `new Date()`. */
  now?: Date;
  /** IANA timezone used by date/time tokens; defaults to `QIY_CODE_TIMEZONE` or `UTC`. */
  timeZone?: string;
  /** Next sequence value; sequences without one render as zero. */
  sequence?: number;
  /** UUIDv4 used by `{uuid}`; generated when omitted. */
  uuid?: string;
  /** Random string source (used by tests); defaults to `crypto`. */
  random?: (length: number, charset: string) => string;
}

/** Resolves the configured timezone, defaulting to UTC. */
export function codeTemplateTimeZone(environment: Record<string, string | undefined> = typeof Bun !== "undefined" ? Bun.env : {}): string {
  const configured = environment.QIY_CODE_TIMEZONE?.trim();
  return configured && configured.length > 0 ? configured : "UTC";
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatterCache.get(timeZone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch {
    throw new Error(`QIY_CODE_TIMEZONE is not a valid IANA timezone: ${JSON.stringify(timeZone)}`);
  }
  dateFormatterCache.set(timeZone, formatter);
  return formatter;
}

/** Renders the date/time parts of `now` in `timeZone`, including milliseconds. */
export function codeTemplateDateParts(now: Date, timeZone = codeTemplateTimeZone()): Record<CodeTemplateDatePart, string> {
  const values: Record<string, string> = {};
  for (const part of dateFormatter(timeZone).formatToParts(now)) if (part.type !== "literal") values[part.type] = part.value;
  const year = values.year ?? "0000";
  return {
    YYYY: year,
    YY: year.slice(-2),
    MM: values.month ?? "00",
    DD: values.day ?? "00",
    HH: values.hour ?? "00",
    mm: values.minute ?? "00",
    ss: values.second ?? "00",
    SSS: String(now.getMilliseconds()).padStart(3, "0"),
  };
}

function randomFromCharset(length: number, charset: string): string {
  // Rejection sampling keeps the character distribution uniform instead of
  // biasing the low characters through a naive modulo.
  const maximum = 256 - (256 % charset.length);
  let result = "";
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (const byte of bytes) {
      if (byte >= maximum) continue;
      result += charset[byte % charset.length]!;
      if (result.length === length) break;
    }
  }
  return result;
}

/**
 * Renders a parsed template. Date/time tokens come from `now`, sequence tokens
 * from `sequence` (every sequence token shares the same allocated number), and
 * random tokens from `random`.
 */
export function renderCodeTemplate(template: string | CodeTemplate, options: CodeTemplateRenderOptions = {}): string {
  const parsed = typeof template === "string" ? parseCodeTemplate(template) : template;
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? codeTemplateTimeZone();
  const dateParts = parsed.bucketParts.length ? codeTemplateDateParts(now, timeZone) : undefined;
  const sequence = options.sequence ?? 0;
  const uuid = options.uuid ?? crypto.randomUUID();
  const random = options.random ?? randomFromCharset;
  let rendered = "";
  for (const token of parsed.tokens) {
    switch (token.kind) {
      case "literal": rendered += token.value; break;
      case "uuid": rendered += uuid; break;
      case "date": rendered += dateParts?.[token.part] ?? codeTemplateDateParts(now, timeZone)[token.part]; break;
      case "sequence": rendered += String(sequence).padStart(token.width, "0"); break;
      case "random": rendered += random(token.length, token.charset); break;
    }
  }
  return rendered;
}

/** The sequence bucket for one render: rendered date/time parts, or `""` without one. */
export function codeTemplateBucket(template: string | CodeTemplate, now: Date = new Date(), timeZone: string = codeTemplateTimeZone()): string {
  const parsed = typeof template === "string" ? parseCodeTemplate(template) : template;
  if (!parsed.bucketParts.length) return "";
  const parts = codeTemplateDateParts(now, timeZone);
  return parsed.bucketParts.map((part) => parts[part]).join("");
}
