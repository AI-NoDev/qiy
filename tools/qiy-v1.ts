/**
 * Minimal v1 friendly-syntax front end.
 *
 * v1 sources are translated to canonical v0 text before the existing parser
 * sees them, so the generator/runtime stay unchanged while users can write:
 *
 *   project shop
 *   database sqlite
 *   module Catalog {
 *     entity Product {
 *       name: text
 *       price: decimal(12, 2) nullable
 *     }
 *   }
 *
 * Scope of this preview: project/database/module/entity, `name: type` fields,
 * common modifiers (primary/nullable/unique), inline one relations
 * (`customer: Customer`), one-to-many relations (`lines: OrderLine[]`, backed by
 * a generated FK on the child) and comments. Includes and non-entity blocks are
 * intentionally rejected with a clear message.
 */

export function isQiyV1Source(source: string): boolean {
  for (const raw of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return /^qiy\s+v1\s*;/.test(line) || /^project\s+[A-Za-z_][A-Za-z0-9_-]*\s*$/.test(line);
  }
  return false;
}

const PRIMITIVES: Record<string, string> = {
  uuid: "UUID",
  text: "Text",
  integer: "Integer",
  int: "Integer",
  decimal: "Decimal",
  money: "Money",
  date: "Date",
  time: "Time",
  datetime: "DateTime",
  timestamp: "DateTime",
  boolean: "Boolean",
};

interface V1Entity {
  friendly: string;
  table: string;
  annotations?: string;
  fields: string[];
  fieldNames: Set<string>;
  hasId: boolean;
}

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function pluralize(value: string): string {
  if (/[^aeiou]y$/.test(value)) return `${value.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(value)) return `${value}es`;
  return `${value}s`;
}

export function v1TableName(friendly: string): string {
  const snake = snakeCase(friendly);
  return /^[A-Z]/.test(friendly) ? pluralize(snake) : snake;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function splitFieldSuffix(raw: string): { words: string[]; annotations: string[]; relationName?: string } {
  const annotations: string[] = [];
  let plain = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "@") { plain += raw[index]; continue; }
    let end = index + 1;
    while (/[A-Za-z0-9_]/.test(raw[end] ?? "")) end += 1;
    if (raw[end] === "(") {
      let depth = 1;
      let quote: string | undefined;
      end += 1;
      for (; end < raw.length; end += 1) {
        const char = raw[end]!;
        if (quote) { if (char === quote && raw[end - 1] !== "\\") quote = undefined; continue; }
        if (char === '"' || char === "'") { quote = char; continue; }
        if (char === "(") depth += 1;
        else if (char === ")") { depth -= 1; if (depth === 0) { end += 1; break; } }
      }
    }
    annotations.push(raw.slice(index, end));
    index = end - 1;
  }
  const tokens = plain.split(/\s+/).filter(Boolean);
  let relationName: string | undefined;
  const words: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "as") {
      const name = tokens[index + 1];
      if (!name || relationName) throw new Error("v1: `as <relationName>` needs one unique relation name.");
      relationName = name;
      index += 1;
      continue;
    }
    words.push(token);
  }
  return { words, annotations, ...(relationName ? { relationName } : {}) };
}

function parseType(raw: string): string {
  const match = /^([A-Za-z][A-Za-z0-9]*)(\([^)]*\))?$/.exec(raw);
  if (!match) throw new Error(`Invalid field type "${raw}".`);
  const base = match[1]!;
  const primitive = PRIMITIVES[base.toLowerCase()];
  if (!primitive) return base;
  return `${primitive}${match[2] ?? ""}`;
}

const PRE_BLOCKS: Record<string, number> = {
  workspace: 10, ui: 20, api: 30, features: 40, realtime: 50, elysia: 60, storage: 70, auth: 80, env: 90, messages: 100, permission: 110, workflow: 120, enum: 130,
};
const POST_BLOCKS: Record<string, number> = { menu: 10, dashboard: 20, chart: 30, dataflow: 40, action: 50 };

function braceDelta(line: string): number {
  let depth = 0;
  let quote = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"' && line[index - 1] !== "\\") quote = !quote;
    if (quote) continue;
    if (char === "#") break;
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
  }
  return depth;
}

function captureBlock(lines: string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let index = start; index < lines.length; index += 1) {
    const delta = braceDelta(lines[index]!);
    if (delta !== 0) opened = true;
    depth += delta;
    if (opened && depth === 0) return index;
  }
  throw new Error(`v1: unterminated block starting at line ${start + 1}.`);
}

function indentRawBlock(text: string[]): string[] {
  return text.map((line) => `  ${line.trim()}`);
}

export function translateQiyV1(source: string): string {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  let projectName: string | undefined;
  let database = "sqlite";
  const topComments: string[] = [];
  const entities: V1Entity[] = [];
  const relations: string[] = [];
  const pendingMany: Array<{ parent: V1Entity; targetType: string; lineNumber: number; annotations: string[]; relationName?: string }> = [];
  const preBlocks: Array<{ order: number; text: string[] }> = [];
  const postBlocks: Array<{ order: number; text: string[] }> = [];
  let currentEntity: V1Entity | undefined;
  let entityParent: "top" | "module" = "module";
  let mode: "top" | "module" | "entity" = "top";

  const finishEntity = (): void => {
    if (!currentEntity) return;
    entities.push(currentEntity);
    currentEntity = undefined;
    mode = entityParent;
  };

  const startEntity = (friendly: string, annotations = ""): void => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(friendly)) throw new Error(`Invalid entity name "${friendly}".`);
    if (entities.some((entity) => entity.friendly === friendly)) throw new Error(`Duplicate entity ${friendly}.`);
    currentEntity = {
      friendly,
      table: v1TableName(friendly),
      ...(annotations ? { annotations } : {}),
      fields: [],
      fieldNames: new Set(),
      hasId: false,
    };
    entityParent = mode as "top" | "module";
    mode = "entity";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = lines[index]!;
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if ((mode as string) === "entity" && currentEntity) currentEntity.fields.push(`  ${line}`);
      else if (mode === "top") topComments.push(line);
      continue;
    }
    if (mode === "top") {
      if (/^qiy\s+v1\s*;/.test(line)) continue;
      const project = /^project\s+([A-Za-z_][A-Za-z0-9_-]*)\s*$/.exec(line);
      if (project) {
        if (projectName) throw new Error(`v1 line ${lineNumber}: project is already declared.`);
        projectName = project[1]!;
        continue;
      }
      const databaseLine = /^database\s+([A-Za-z]+)(?:\s*\{\s*\})?\s*;?\s*$/.exec(line);
      if (databaseLine) {
        const dialect = databaseLine[1]!.toLowerCase();
        if (!["sqlite", "postgresql", "mysql"].includes(dialect)) throw new Error(`v1 line ${lineNumber}: unsupported database "${databaseLine[1]}".`);
        database = dialect;
        continue;
      }
      const firstWord = /^([A-Za-z][A-Za-z0-9]*)\b/.exec(line)?.[1];
      if (firstWord && (firstWord in PRE_BLOCKS || firstWord in POST_BLOCKS)) {
        const text: string[] = [];
        if (line.includes("{")) {
          const end = captureBlock(lines, index);
          for (let cursor = index; cursor <= end; cursor += 1) text.push(lines[cursor]!);
          index = end;
        } else {
          text.push(line);
        }
        if (firstWord in PRE_BLOCKS) preBlocks.push({ order: PRE_BLOCKS[firstWord]!, text });
        else postBlocks.push({ order: POST_BLOCKS[firstWord]!, text });
        continue;
      }
      const module = /^module\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/.exec(line);
      if (module) {
        mode = "module";
        continue;
      }
      if (/^include\s+/.test(line)) throw new Error(`v1 line ${lineNumber}: include is not supported in v1 preview; use module blocks.`);
      const topEntity = /^entity\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*?)\s*\{$/.exec(line);
      if (topEntity) {
        startEntity(topEntity[1]!, topEntity[2]?.trim());
        continue;
      }
      throw new Error(`v1 line ${lineNumber}: unsupported declaration "${line}".`);
    }
    if (mode === "module") {
      if (line === "}") {
        mode = "top";
        continue;
      }
      const entity = /^entity\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*?)\s*\{$/.exec(line);
      if (entity) {
        startEntity(entity[1]!, entity[2]?.trim());
        continue;
      }
      if (line.startsWith("#")) continue;
      throw new Error(`v1 line ${lineNumber}: expected entity inside module, got "${line}".`);
    }
    // mode === "entity"
    if (line === "}") {
      finishEntity();
      continue;
    }
    const field = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z][A-Za-z0-9]*(?:\([^)]*\))?(?:\[\])?)(?:\s+(.*))?$/.exec(line);
    if (!field || !currentEntity) throw new Error(`v1 line ${lineNumber}: expected "name: type" field, got "${line}".`);
    const [, name, rawType, modifiers = ""] = field;
    if (!/^[a-z][A-Za-z0-9_]*$/.test(name!)) throw new Error(`v1 line ${lineNumber}: invalid field name "${name}".`);
    if (currentEntity.fieldNames.has(name!)) throw new Error(`v1 line ${lineNumber}: duplicate field ${name} in ${currentEntity.friendly}.`);
    const suffix = splitFieldSuffix(modifiers);
    const modifierWords = suffix.words;
    for (const word of modifierWords) {
      if (!["primary", "nullable", "unique"].includes(word)) throw new Error(`v1 line ${lineNumber}: unsupported field modifier "${word}".`);
    }
    if (rawType!.endsWith("[]")) {
      pendingMany.push({ parent: currentEntity, targetType: rawType!.slice(0, -2), lineNumber, annotations: suffix.annotations, ...(suffix.relationName ? { relationName: suffix.relationName } : {}) });
      continue;
    }
    const isPrimitive = PRIMITIVES[rawType!.toLowerCase()] !== undefined;
    if (/^[A-Z]/.test(rawType!) && !isPrimitive) {
      // Inline one-to-one relation: customer: Customer -> customerId + relation.
      const target = v1TableName(rawType!);
      const fk = `${lowerFirst(rawType!)}Id`;
      if (currentEntity.fieldNames.has(fk)) throw new Error(`v1 line ${lineNumber}: relation field ${fk} already exists.`);
      currentEntity.fieldNames.add(fk);
      currentEntity.fields.push(`  field ${fk} UUID${modifierWords.includes("nullable") ? " @nullable" : ""};`);
      const relationName = suffix.relationName ?? `${currentEntity.table}${rawType}`;
      relations.push(`  relation ${relationName} ${currentEntity.table} ${fk} ${target} id one${suffix.annotations.length ? " " + suffix.annotations.join(" ") : ""};`);
      continue;
    }
    if (suffix.relationName) throw new Error(`v1 line ${lineNumber}: \`as\` is only valid on an inline relation field.`);
    const type = parseType(rawType!);
    const annotations = [
      modifierWords.includes("primary") ? "@id" : "",
      modifierWords.includes("unique") ? "@unique" : "",
      modifierWords.includes("nullable") ? "@nullable" : "",
      ...suffix.annotations,
    ].filter(Boolean);
    currentEntity.fields.push(`  field ${name} ${type}${annotations.length ? " " + annotations.join(" ") : ""};`);
    currentEntity.fieldNames.add(name!);
    if (name === "id") currentEntity.hasId = true;
  }
  if ((mode as string) === "entity") throw new Error("v1: unterminated entity block.");
  if (mode === "module") throw new Error("v1: unterminated module block.");
  if (!projectName) throw new Error("v1: missing `project <name>` declaration.");

  const resolved = pendingMany.map((pending, index) => {
    const targetTable = v1TableName(pending.targetType);
    const target = entities.find((entity) => entity.table === targetTable || entity.friendly === pending.targetType);
    if (!target) throw new Error(`v1 line ${pending.lineNumber}: many relation target ${pending.targetType} is not declared.`);
    if (target === pending.parent) throw new Error(`v1 line ${pending.lineNumber}: self many relations are not supported in the v1 preview.`);
    return { pending, target, index };
  });
  const consumed = new Set<number>();
  const joinEntities: V1Entity[] = [];
  const joinTable = (base: string): string => {
    let table = base;
    let suffix = 2;
    while (entities.some((entity) => entity.table === table) || joinEntities.some((entity) => entity.table === table)) {
      table = `${base}_${suffix}`;
      suffix += 1;
    }
    return table;
  };
  for (const item of resolved) {
    if (consumed.has(item.index)) continue;
    // Reciprocal `tags: Tag[]` + `products: Product[]` is a many-to-many; generate
    // an explicit join entity because the Qiy generator requires one.
    const reciprocal = resolved.find((candidate) => candidate.index !== item.index && candidate.pending.parent === item.target && candidate.target === item.pending.parent && !consumed.has(candidate.index));
    if (reciprocal) {
      if (item.pending.relationName || reciprocal.pending.relationName || item.pending.annotations.length || reciprocal.pending.annotations.length) {
        throw new Error(`v1 line ${item.pending.lineNumber}: custom relation names/annotations are not supported on many-to-many arrays; use an explicit join entity.`);
      }
      consumed.add(item.index);
      consumed.add(reciprocal.index);
      const table = joinTable([item.pending.parent.table, item.target.table].sort().join("_"));
      const parentFk = `${lowerFirst(item.pending.parent.friendly)}Id`;
      const targetFk = `${lowerFirst(item.target.friendly)}Id`;
      joinEntities.push({
        friendly: table,
        table,
        fields: [`  field ${parentFk} UUID;`, `  field ${targetFk} UUID;`],
        fieldNames: new Set([parentFk, targetFk]),
        hasId: false,
      });
      relations.push(`  relation ${table}${item.pending.parent.friendly} ${table} ${parentFk} ${item.pending.parent.table} id one;`);
      relations.push(`  relation ${table}${item.target.friendly} ${table} ${targetFk} ${item.target.table} id one;`);
      continue;
    }
    const fk = `${lowerFirst(item.pending.parent.friendly)}Id`;
    if (item.target.fieldNames.has(fk)) {
      throw new Error(`v1 line ${item.pending.lineNumber}: ${item.target.table}.${fk} already exists; remove the duplicate relation or use an explicit v0 relation.`);
    }
    item.target.fieldNames.add(fk);
    item.target.fields.push(`  field ${fk} UUID @nullable;`);
    const relationName = item.pending.relationName ?? `${item.target.table}${item.pending.parent.friendly}`;
    relations.push(`  relation ${relationName} ${item.target.table} ${fk} ${item.pending.parent.table} id one${item.pending.annotations.length ? " " + item.pending.annotations.join(" ") : ""};`);
  }
  entities.push(...joinEntities);

  const body: string[] = [`  database ${database} {}`];
  for (const block of preBlocks.sort((left, right) => left.order - right.order)) body.push("", ...indentRawBlock(block.text));
  for (const entity of entities) {
    if (!entity.hasId) entity.fields.unshift("  field id UUID @id;");
    body.push("", `  entity ${entity.table}${entity.annotations ? " " + entity.annotations : ""} {`, ...entity.fields, "  }");
  }
  if (relations.length) body.push("", ...relations);
  for (const block of postBlocks.sort((left, right) => left.order - right.order)) body.push("", ...indentRawBlock(block.text));
  return ["qiy v0;", ...topComments, `application ${projectName} {`, ...body, "}", ""].join("\n");
}
