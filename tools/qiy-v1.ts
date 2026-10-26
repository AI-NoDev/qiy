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
 * common modifiers (primary/nullable/unique), one-to-one inline relations
 * (`customer: Customer`), and comments. Includes, many relations and non-entity
 * blocks are intentionally rejected with a clear message.
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
  fields: string[];
  fieldNames: Set<string>;
  hasId: boolean;
  relations: Array<{ name: string; fromField: string; to: string }>;
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

function parseType(raw: string): string {
  const match = /^([A-Za-z][A-Za-z0-9]*)(\([^)]*\))?$/.exec(raw);
  if (!match) throw new Error(`Invalid field type "${raw}".`);
  const base = match[1]!;
  const primitive = PRIMITIVES[base.toLowerCase()];
  if (!primitive) return base;
  return `${primitive}${match[2] ?? ""}`;
}

export function translateQiyV1(source: string): string {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  let projectName: string | undefined;
  let database = "sqlite";
  const topComments: string[] = [];
  const entities: V1Entity[] = [];
  const relations: string[] = [];
  let currentEntity: V1Entity | undefined;
  let mode: "top" | "module" | "entity" = "top";

  const finishEntity = (): void => {
    if (!currentEntity) return;
    entities.push(currentEntity);
    currentEntity = undefined;
    mode = "module";
  };

  const startEntity = (friendly: string): void => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(friendly)) throw new Error(`Invalid entity name "${friendly}".`);
    if (entities.some((entity) => entity.friendly === friendly)) throw new Error(`Duplicate entity ${friendly}.`);
    currentEntity = {
      friendly,
      table: v1TableName(friendly),
      fields: [],
      fieldNames: new Set(),
      hasId: false,
      relations: [],
    };
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
      const databaseLine = /^database\s+([A-Za-z]+)(?:\s*\{\s*\})?\s*$/.exec(line);
      if (databaseLine) {
        const dialect = databaseLine[1]!.toLowerCase();
        if (!["sqlite", "postgresql", "mysql"].includes(dialect)) throw new Error(`v1 line ${lineNumber}: unsupported database "${databaseLine[1]}".`);
        database = dialect;
        continue;
      }
      const module = /^module\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/.exec(line);
      if (module) {
        mode = "module";
        continue;
      }
      if (/^include\s+/.test(line)) throw new Error(`v1 line ${lineNumber}: include is not supported in v1 preview; use module blocks.`);
      if (/^entity\s+[A-Za-z_][A-Za-z0-9_]*\s*\{$/.test(line)) {
        startEntity(/^entity\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)![1]!);
        continue;
      }
      throw new Error(`v1 line ${lineNumber}: unsupported declaration "${line}".`);
    }
    if (mode === "module") {
      if (line === "}") {
        mode = "top";
        continue;
      }
      const entity = /^entity\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/.exec(line);
      if (entity) {
        startEntity(entity[1]!);
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
    const modifierWords = modifiers.split(/\s+/).filter(Boolean);
    for (const word of modifierWords) {
      if (!["primary", "nullable", "unique"].includes(word)) throw new Error(`v1 line ${lineNumber}: unsupported field modifier "${word}".`);
    }
    if (rawType!.endsWith("[]")) {
      throw new Error(`v1 line ${lineNumber}: many relations (${rawType}) are not supported in the v1 preview; declare an explicit relation or join entity in v0.`);
    }
    const isPrimitive = PRIMITIVES[rawType!.toLowerCase()] !== undefined;
    if (/^[A-Z]/.test(rawType!) && !isPrimitive) {
      // Inline one-to-one relation: customer: Customer -> customerId + relation.
      const target = v1TableName(rawType!);
      const fk = `${lowerFirst(rawType!)}Id`;
      if (currentEntity.fieldNames.has(fk)) throw new Error(`v1 line ${lineNumber}: relation field ${fk} already exists.`);
      currentEntity.fieldNames.add(fk);
      currentEntity.fields.push(`  field ${fk} UUID${modifierWords.includes("nullable") ? " @nullable" : ""};`);
      relations.push(`  relation ${currentEntity.table}${rawType} ${currentEntity.table} ${fk} ${target} id one;`);
      continue;
    }
    const type = parseType(rawType!);
    const annotations = [
      modifierWords.includes("primary") ? "@id" : "",
      modifierWords.includes("unique") ? "@unique" : "",
      modifierWords.includes("nullable") ? "@nullable" : "",
    ].filter(Boolean);
    currentEntity.fields.push(`  field ${name} ${type}${annotations.length ? " " + annotations.join(" ") : ""};`);
    currentEntity.fieldNames.add(name!);
    if (name === "id") currentEntity.hasId = true;
  }
  if ((mode as string) === "entity") throw new Error("v1: unterminated entity block.");
  if (mode === "module") throw new Error("v1: unterminated module block.");
  if (!projectName) throw new Error("v1: missing `project <name>` declaration.");

  const body: string[] = [`  database ${database} {}`];
  for (const entity of entities) {
    if (!entity.hasId) entity.fields.unshift("  field id UUID @id;");
    body.push("", `  entity ${entity.table} {`, ...entity.fields, "  }");
  }
  if (relations.length) body.push("", ...relations);
  return ["qiy v0;", ...topComments, `application ${projectName} {`, ...body, "}", ""].join("\n");
}
