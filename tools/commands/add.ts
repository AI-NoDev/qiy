import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { explainQiyFile } from "./explain";
import { requireQiyProject, type QiyProjectLocation } from "../project";

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
export async function addEntity(name: string, options: AddEntityOptions = {}): Promise<void> {
  if (!ENTITY_NAME.test(name)) throw new Error(`Invalid entity name "${name}": use lowercase letters, digits and underscores (for example: suppliers).`);
  const project = requireQiyProject(options.cwd ?? process.cwd());
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
export async function addField(entityName: string, spec: string, options: AddFieldOptions = {}): Promise<void> {
  const project = requireQiyProject(options.cwd ?? process.cwd());
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
