import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { findQiyProjectRoot, readQiyProject, type QiyProjectLocation } from "./project";

/**
 * Canonical whitespace formatting for `.qiy` sources. This is deliberately
 * syntax-preserving: it normalizes indentation, trailing whitespace, blank-line
 * runs and the final newline, but never rewrites declarations, comments,
 * includes or ordering. `qiy add`/future v1 syntax can rely on `qiy fmt` as the
 * stable canonical output.
 */
export function formatQiySource(source: string): string {
  const withoutBom = source.replace(/^\uFEFF/, "");
  const lines = withoutBom.split(/\r?\n/);
  const output: string[] = [];
  let depth = 0;
  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/, "");
    const trimmed = line.trim();
    if (!trimmed) {
      if (output.length > 0 && output.at(-1) !== "") output.push("");
      continue;
    }
    const startsWithClose = trimmed.startsWith("}");
    const indentDepth = Math.max(0, depth - (startsWithClose ? 1 : 0));
    const indented = `${"  ".repeat(indentDepth)}${trimmed}`;
    output.push(indented);
    depth = Math.max(0, depth + braceDelta(indented));
  }
  while (output.at(-1) === "") output.pop();
  return `${output.join("\n")}\n`;
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

function modelFiles(project: QiyProjectLocation): string[] {
  const modelRoot = resolve(project.root, project.manifest.model);
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".qiy")) files.push(path);
    }
  };
  visit(resolve(modelRoot, ".."));
  return files.sort();
}

export interface FormatQiyFilesOptions {
  cwd?: string;
  check?: boolean;
  files?: string[];
}

export interface FormatQiyFilesResult {
  files: string[];
  changed: string[];
}

/** Formats project model files, or explicit `.qiy` paths; `check` never writes. */
export function formatQiyFiles(options: FormatQiyFilesOptions = {}): FormatQiyFilesResult {
  const cwd = options.cwd ?? process.cwd();
  let files: string[];
  if (options.files?.length) {
    files = options.files.map((file) => resolve(cwd, file));
    for (const file of files) {
      if (!existsSync(file)) throw new Error(`File not found: ${file}`);
      if (!file.endsWith(".qiy")) throw new Error(`qiy fmt only formats .qiy files: ${file}`);
    }
  } else {
    const root = findQiyProjectRoot(cwd);
    if (!root) throw new Error(`No qiy.project.json found in ${cwd} or its parents. Pass .qiy files or run inside a project.`);
    files = modelFiles(readQiyProject(root));
  }
  const changed: string[] = [];
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const after = formatQiySource(before);
    if (before === after) continue;
    changed.push(relative(cwd, file).replaceAll("\\", "/"));
    if (!options.check) writeFileSync(file, after);
  }
  return { files: files.map((file) => relative(cwd, file).replaceAll("\\", "/")), changed };
}
