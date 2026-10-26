import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { explainQiyFile } from "./explain";
import { requireQiyProject, type QiyProjectLocation } from "../project";
import { isQiyV1Source, v1TableName } from "../qiy-v1";

export interface AddEntityOptions {
  cwd?: string;
  module?: string;
  fields?: string[];
  label?: string;
  icon?: string;
  nullable?: boolean;
  unique?: boolean;
  code?: string;
}

export interface AddFieldOptions {
  cwd?: string;
  module?: string;
  nullable?: boolean;
  unique?: boolean;
  code?: string;
}

const ENTITY_NAME = /^[a-z][a-z0-9_]*$/;
const FIELD_NAME = /^[a-z][A-Za-z0-9_]*$/;
const TYPE = /^[A-Za-z][A-Za-z0-9]*(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?$/;

function modelFiles(project: QiyProjectLocation): string[] {
  const modelRoot = join(project.root, project.manifest.model);
  const directory = dirname(modelRoot);
  const files: string[] = [];
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith(".qiy")) files.push(child);
    }
  };
  visit(directory);
  return files;
}

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

interface EntityBlock {
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  indent: string;
  singleLine: boolean;
}

function findEntity(project: QiyProjectLocation, name: string): EntityBlock | undefined {
  for (const file of modelFiles(project)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let start = 0; start < lines.length; start += 1) {
      const match = /^\s*entity\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(lines[start]!);
      if (!match || match[1] !== name) continue;
      const indent = lines[start]!.match(/^\s*/)?.[0] ?? "";
      let depth = 0;
      let opened = false;
      for (let end = start; end < lines.length; end += 1) {
        const delta = braceDelta(lines[end]!);
        if (delta !== 0) opened = true;
        depth += delta;
        if (opened && depth === 0) {
          return { file, name, startLine: start, endLine: end, indent, singleLine: end === start };
        }
      }
      throw new Error(`Entity ${name}: unterminated block at ${relative(project.root, file)}:${start + 1}`);
    }
  }
  return undefined;
}

function entityNames(project: QiyProjectLocation): Set<string> {
  const names = new Set<string>();
  for (const file of modelFiles(project)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*entity\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
      if (match) names.add(match[1]!);
    }
  }
  return names;
}

function targetModule(project: QiyProjectLocation, requested: string | undefined): string {
  if (requested) {
    const candidate = requested.endsWith(".qiy") ? requested : `${requested}.qiy`;
    const file = /[\\/]/.test(candidate) ? join(project.root, candidate) : join(project.root, "model/modules", candidate);
    if (!existsSync(file)) throw new Error(`Module not found: ${relative(project.root, file)}. Create it first or pass an existing --module.`);
    return file;
  }
  const catalog = join(project.root, "model/modules/10-catalog.qiy");
  if (existsSync(catalog)) return catalog;
  const candidate = modelFiles(project).find((file) => /^\s*entity\s+/m.test(readFileSync(file, "utf8")));
  if (!candidate) throw new Error("No module with entities found. Add an entity module under model/modules/ first.");
  return candidate;
}

function fieldLine(name: string, type: string, options: AddFieldOptions | AddEntityOptions, indent: string): string {
  if (!FIELD_NAME.test(name)) throw new Error(`Invalid field name "${name}": use a lowercase first letter, letters, digits and underscores.`);
  if (!TYPE.test(type)) throw new Error(`Invalid field type "${type}".`);
  const extras: string[] = [];
  if (options.unique) extras.push("@unique");
  if (options.code) extras.push(`@code(${JSON.stringify(options.code)})`);
  if (options.nullable) extras.push("@nullable");
  return `${indent}field ${name} ${type}${extras.length ? " " + extras.join(" ") : ""};`;
}

function parseFieldSpec(spec: string): { name: string; type: string } {
  const separator = spec.indexOf(":");
  if (separator <= 0 || separator === spec.length - 1) throw new Error(`Invalid field spec "${spec}": expected name:Type (for example name:Text).`);
  return { name: spec.slice(0, separator).trim(), type: spec.slice(separator + 1).trim() };
}

async function validateProject(project: QiyProjectLocation): Promise<void> {
  const explanation = await explainQiyFile(project.modelPath);
  if (explanation.counts.entities === 0) throw new Error("Model has no entities after the edit.");
}

async function commitChange(project: QiyProjectLocation, file: string, before: string, next: string): Promise<void> {
  writeFileSync(file, next);
  try {
    await validateProject(project);
  } catch (error) {
    writeFileSync(file, before);
    throw error;
  }
}

/** `qiy add entity`: append an entity to a module and validate the project. */
function v1FieldType(type: string): string {
  const match = /^([A-Za-z][A-Za-z0-9]*)(\(.*\))?$/.exec(type);
  if (!match) throw new Error(`Invalid field type "${type}".`);
  const primitives: Record<string, string> = {
    UUID: "uuid", Text: "text", Integer: "integer", Decimal: "decimal", Money: "money",
    Date: "date", Time: "time", DateTime: "datetime", File: "file", Files: "files", Vector: "vector",
  };
  return `${primitives[match[1]!] ?? match[1]!.charAt(0).toLowerCase() + match[1]!.slice(1)}${match[2] ?? ""}`;
}

function v1FieldLine(name: string, type: string, options: AddFieldOptions | AddEntityOptions, indent: string): string {
  if (!FIELD_NAME.test(name)) throw new Error(`Invalid field name "${name}": use a lowercase first letter, letters, digits and underscores.`);
  const words = [options.unique ? "unique" : "", options.nullable ? "nullable" : ""].filter(Boolean);
  return `${indent}${name}: ${v1FieldType(type)}${words.length ? " " + words.join(" ") : ""}`;
}

function findV1Entity(source: string, name: string): EntityBlock | undefined {
  const lines = source.split(/\r?\n/);
  for (let start = 0; start < lines.length; start += 1) {
    const match = /^\s*entity\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(lines[start]!);
    if (!match || (match[1] !== name && v1TableName(match[1]!) !== name)) continue;
    const indent = lines[start]!.match(/^\s*/)?.[0] ?? "";
    let depth = 0;
    let opened = false;
    for (let end = start; end < lines.length; end += 1) {
      const delta = braceDelta(lines[end]!);
      if (delta !== 0) opened = true;
      depth += delta;
      if (opened && depth === 0) return { file: "", name: match[1]!, startLine: start, endLine: end, indent, singleLine: end === start };
    }
    throw new Error(`v1 entity ${name}: unterminated block.`);
  }
  return undefined;
}

async function addV1Entity(project: QiyProjectLocation, source: string, name: string, options: AddEntityOptions): Promise<void> {
  if (options.module) throw new Error("qiy add entity --module is a v0 feature; the v1 preview keeps entities in its single entry file.");
  if (options.label || options.icon || options.code) throw new Error("qiy add entity label/icon/code is not supported in the v1 preview; edit the v1 file or use v0.");
  const fields = options.fields ?? ["name:Text"];
  const rendered = fields.map((spec) => {
    const parsed = parseFieldSpec(spec);
    return v1FieldLine(parsed.name, parsed.type, options, "  ");
  });
  const block = `entity ${name} {\n${rendered.join("\n")}\n}`;
  const before = source;
  const next = `${source.replace(/\s*$/, "")}\n\n${block}\n`;
  writeFileSync(project.modelPath, next);
  try {
    await validateProject(project);
  } catch (error) {
    writeFileSync(project.modelPath, before);
    throw error;
  }
  console.log(`Added v1 entity ${name} to ${project.manifest.model}`);
  console.log("Next: qiy dev --watch   # or qiy check && qiy generate");
}

export async function addEntity(name: string, options: AddEntityOptions = {}): Promise<void> {
  if (!ENTITY_NAME.test(name)) throw new Error(`Invalid entity name "${name}": use lowercase letters, digits and underscores (for example: suppliers).`);
  const project = requireQiyProject(options.cwd ?? process.cwd());
  const source = readFileSync(project.modelPath, "utf8");
  if (isQiyV1Source(source)) {
    await addV1Entity(project, source, name, options);
    return;
  }
  if (entityNames(project).has(name)) throw new Error(`Entity ${name} already exists.`);
  const file = targetModule(project, options.module);
  const before = readFileSync(file, "utf8");
  const lines = before.split(/\r?\n/);
  let insertAt = lines.length;
  let indent = "";
  let lastEntity: EntityBlock | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*entity\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(lines[index]!);
    if (!match) continue;
    const found = findEntityInFile(file, match[1]!);
    if (found && (!lastEntity || found.endLine > lastEntity.endLine)) lastEntity = found;
  }
  if (lastEntity) {
    insertAt = lastEntity.endLine + 1;
    indent = lastEntity.indent;
  } else {
    indent = "";
  }
  const fields = options.fields ?? ["name:Text"];
  const rendered: string[] = [];
  if (!fields.some((spec) => parseFieldSpec(spec).name === "id")) rendered.push(`${indent}  field id UUID @id;`);
  for (const spec of fields) {
    const parsed = parseFieldSpec(spec);
    rendered.push(fieldLine(parsed.name, parsed.type, options, `${indent}  `));
  }
  const header = `${indent}entity ${name}${options.label ? ` @label(${JSON.stringify(options.label)})` : ""}${options.icon ? ` @icon(${options.icon})` : ""} {`;
  const block = [header, ...rendered, `${indent}}`].join("\n");
  const nextLines = lines.slice();
  if (lastEntity) nextLines.splice(insertAt, 0, "", ...block.split("\n"));
  else nextLines.push(...(before.endsWith("\n") ? [] : [""]), ...block.split("\n"));
  const next = `${nextLines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
  await commitChange(project, file, before, next);
  console.log(`Added entity ${name} to ${relative(project.root, file)}`);
  console.log("Next: qiy dev --watch   # or qiy check && qiy generate");
}

function findEntityInFile(file: string, name: string): EntityBlock | undefined {
  const project = { file, name } as { file: string; name: string };
  const lines = readFileSync(project.file, "utf8").split(/\r?\n/);
  for (let start = 0; start < lines.length; start += 1) {
    const match = /^\s*entity\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(lines[start]!);
    if (!match || match[1] !== name) continue;
    const indent = lines[start]!.match(/^\s*/)?.[0] ?? "";
    let depth = 0;
    let opened = false;
    for (let end = start; end < lines.length; end += 1) {
      const delta = braceDelta(lines[end]!);
      if (delta !== 0) opened = true;
      depth += delta;
      if (opened && depth === 0) return { file, name, startLine: start, endLine: end, indent, singleLine: end === start };
    }
    return undefined;
  }
  return undefined;
}

/** `qiy add field`: insert a field into an existing entity and validate the project. */
async function addV1Field(project: QiyProjectLocation, source: string, entityName: string, parsed: { name: string; type: string }, options: AddFieldOptions): Promise<void> {
  const block = findV1Entity(source, entityName);
  if (!block) throw new Error(`Entity ${entityName} not found.`);
  if (block.singleLine) throw new Error(`Entity ${entityName} is written on one line. Split its fields onto separate lines before qiy add field.`);
  const lines = source.split(/\r?\n/);
  lines.splice(block.endLine, 0, v1FieldLine(parsed.name, parsed.type, options, `${block.indent}  `));
  const before = source;
  writeFileSync(project.modelPath, `${lines.join("\n")}\n`);
  try {
    await validateProject(project);
  } catch (error) {
    writeFileSync(project.modelPath, before);
    throw error;
  }
  console.log(`Added v1 field ${parsed.name}:${v1FieldType(parsed.type)} to entity ${entityName}`);
  console.log("Next: qiy dev --watch   # or qiy check && qiy generate");
}

export async function addField(entityName: string, spec: string, options: AddFieldOptions = {}): Promise<void> {
  const project = requireQiyProject(options.cwd ?? process.cwd());
  const source = readFileSync(project.modelPath, "utf8");
  if (isQiyV1Source(source)) {
    await addV1Field(project, source, entityName, parseFieldSpec(spec), options);
    return;
  }
  const parsed = parseFieldSpec(spec);
  const block = findEntity(project, entityName);
  if (!block) throw new Error(`Entity ${entityName} not found.`);
  if (block.singleLine) throw new Error(`Entity ${entityName} is written on one line. Split its fields onto separate lines before qiy add field.`);
  const before = readFileSync(block.file, "utf8");
  const lines = before.split(/\r?\n/);
  const indent = `${block.indent}  `;
  const line = fieldLine(parsed.name, parsed.type, options, indent);
  const nextLines = lines.slice();
  nextLines.splice(block.endLine, 0, line);
  await commitChange(project, block.file, before, `${nextLines.join("\n")}\n`);
  console.log(`Added field ${parsed.name}:${parsed.type} to entity ${entityName}`);
  console.log("Next: qiy dev --watch   # or qiy check && qiy generate");
}

export type AddModuleKind = "entities" | "ui" | "permissions" | "dataflows" | "messages";

export interface AddModuleOptions {
  cwd?: string;
  kind?: AddModuleKind;
}

export interface AddFeatureOptions {
  cwd?: string;
}

const MODULE_INCLUDE_AFTER: Record<AddModuleKind, RegExp> = {
  permissions: /include\s+"[^"]*(messages|permissions)[^"]*"/,
  messages: /include\s+"[^"]*(messages|permissions)[^"]*"/,
  entities: /include\s+"[^"]*(relations|pages|menu|ui|charts?|dataflows?|actions?)[^"]*"/,
  ui: /include\s+"[^"]*(charts?|dataflows?|actions?)[^"]*"/,
  dataflows: /include\s+"[^"]*actions?[^"]*"/,
};

function nextModulePrefix(directory: string): string {
  let maximum = 0;
  if (existsSync(directory)) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".qiy")) continue;
      const match = /^(\d+)-/.exec(entry.name);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
  }
  return String(Math.max(10, maximum + 10)).padStart(2, "0");
}

function includeLine(file: string): string {
  return `  include "modules/${file}";`;
}

function insertInclude(source: string, kind: AddModuleKind, file: string): string {
  const lines = source.split(/\r?\n/);
  const include = includeLine(file);
  const includeIndexes = lines.map((line, index) => (/^\s*include\s+"/.test(line) ? index : -1)).filter((index) => index >= 0);
  const closing = lines.findIndex((line, index) => index > 0 && /^}\s*$/.test(line) && lines.slice(0, index).some((candidate) => /application\s+/.test(candidate)));
  const fallback = closing >= 0 ? closing : lines.length;
  let insertAt: number;
  if (kind === "messages") {
    insertAt = includeIndexes[0] ?? fallback;
  } else if (kind === "permissions") {
    const messages = includeIndexes.find((index) => /include\s+"[^"]*messages[^"]*"/.test(lines[index]!));
    const firstEntity = includeIndexes.find((index) => !/include\s+"[^"]*(messages|permissions)[^"]*"/.test(lines[index]!));
    insertAt = messages !== undefined ? messages + 1 : firstEntity ?? fallback;
  } else {
    const anchor = includeIndexes.find((index) => MODULE_INCLUDE_AFTER[kind].test(lines[index]!));
    insertAt = anchor ?? fallback;
  }
  lines.splice(insertAt, 0, include);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/** `qiy add module`: create a model fragment and wire its include into app.qiy. */
export async function addModule(name: string, options: AddModuleOptions = {}): Promise<void> {
  if (!ENTITY_NAME.test(name)) throw new Error(`Invalid module name "${name}": use lowercase letters, digits and underscores.`);
  const kind = options.kind ?? "entities";
  const project = requireQiyProject(options.cwd ?? process.cwd());
  if (isQiyV1Source(readFileSync(project.modelPath, "utf8"))) {
    throw new Error("qiy add module is a v0 feature; v1 preview keeps entities in its single entry file.");
  }
  const modulesDirectory = join(project.root, "model/modules");
  const prefix = nextModulePrefix(modulesDirectory);
  const file = `${prefix}-${name}.qiy`;
  const target = join(modulesDirectory, file);
  if (existsSync(target)) throw new Error(`Module already exists: ${relative(project.root, target)}`);
  const modelFile = project.modelPath;
  const beforeModel = readFileSync(modelFile, "utf8");
  const beforeTarget = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  writeFileSync(target, `# ${name} module. Included from model/app.qiy; keep the Qiy declaration order.\n`);
  writeFileSync(modelFile, insertInclude(beforeModel, kind, file));
  try {
    await validateProject(project);
  } catch (error) {
    writeFileSync(modelFile, beforeModel);
    if (beforeTarget === undefined) rmSync(target, { force: true });
    else writeFileSync(target, beforeTarget);
    throw error;
  }
  console.log(`Created module ${relative(project.root, target)} (${kind})`);
  console.log(kind === "entities" ? `Next: add entities with qiy add entity --module ${file.replace(/\.qiy$/, "")}` : `Next: edit ${relative(project.root, target)} and run qiy check`);
}

function insertFeature(source: string, feature: "overview" | "apiDocs" | "apiKeys"): string {
  const lines = source.split(/\r?\n/);
  const blockStart = lines.findIndex((line) => /^\s*features\s*\{/.test(line));
  if (blockStart >= 0) {
    let end = blockStart + 1;
    let depth = 1;
    for (; end < lines.length; end += 1) {
      depth += braceDelta(lines[end]!);
      if (depth === 0) break;
    }
    const indent = `${lines[blockStart]!.match(/^\s*/)?.[0] ?? ""}  `;
    const keyPattern = new RegExp(`^(\\s*)${feature}\\s+\\w+;`);
    for (let index = blockStart + 1; index < end; index += 1) {
      const match = keyPattern.exec(lines[index]!);
      if (match) {
        lines[index] = `${match[1]}${feature} true;`;
        return `${lines.join("\n")}\n`;
      }
    }
    lines.splice(end, 0, `${indent}${feature} true;`);
    return `${lines.join("\n")}\n`;
  }
  const afterConfig = lines.findIndex((line) => /^\s*(include|realtime|elysia|storage|auth|env|messages|permission|workflow|enum|entity|relation|scope|restrict|pages|menu|dashboard|chart|dataflow|action)\b/.test(line));
  const closing = lines.findIndex((line, index) => index > 0 && /^}\s*$/.test(line) && lines.slice(0, index).some((candidate) => /application\s+/.test(candidate)));
  const insertAt = afterConfig >= 0 ? afterConfig : closing >= 0 ? closing : lines.length;
  lines.splice(insertAt, 0, "  features {", `    ${feature} true;`, "  }", "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/** `qiy add feature`: enable a system developer page/feature in app.qiy. */
export async function addFeature(feature: "overview" | "apiDocs" | "apiKeys", options: AddFeatureOptions = {}): Promise<void> {
  const project = requireQiyProject(options.cwd ?? process.cwd());
  const before = readFileSync(project.modelPath, "utf8");
  if (isQiyV1Source(before)) throw new Error("qiy add feature is a v0 feature; v1 preview does not support config blocks yet.");
  writeFileSync(project.modelPath, insertFeature(before, feature));
  try {
    await validateProject(project);
  } catch (error) {
    writeFileSync(project.modelPath, before);
    throw error;
  }
  console.log(`Enabled feature ${feature} in ${project.manifest.model}`);
  console.log("Next: qiy dev --watch   # or qiy check && qiy generate");
}
