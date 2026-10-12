import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve, win32 } from "node:path";

function includeError(file: string, source: string, offset: number, message: string): Error {
  const line = source.slice(0, offset).split("\n").length;
  return new Error(`${file}:${line}: ${message}`);
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_-]/.test(value);
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function readQuotedValue(source: string, start: number, file: string): { value: string; end: number } {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") throw includeError(file, source, start, "include path must be quoted");
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const current = source[index]!;
    if (current === quote) return { value, end: index + 1 };
    if (current !== "\\") {
      value += current;
      index += 1;
      continue;
    }
    const escaped = source[index + 1];
    if (escaped === undefined) break;
    const decoded: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"' };
    if (!Object.hasOwn(decoded, escaped)) throw includeError(file, source, index, `Unsupported escape sequence \\${escaped} in include path`);
    value += decoded[escaped]!;
    index += 2;
  }
  throw includeError(file, source, start, "Unterminated include path");
}

function skipQuotedValue(source: string, start: number, file: string): number {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === quote) return index + 1;
    if (source[index] === "\\") {
      index += 2;
      continue;
    }
    index += 1;
  }
  throw includeError(file, source, start, "Unterminated string literal");
}

function readIncludeStatement(source: string, start: number, file: string): { path: string; selector?: string; end: number } {
  let index = start + "include".length;
  while (/\s/.test(source[index] ?? "")) index += 1;
  const quoted = readQuotedValue(source, index, file);
  index = quoted.end;
  while (/\s/.test(source[index] ?? "")) index += 1;
  let selector: string | undefined;
  if (source[index] === "@") {
    const selectorStart = index;
    index += 1;
    const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(source.slice(index));
    if (!match) throw includeError(file, source, selectorStart, "include selector must be an identifier such as @messages");
    selector = match[0];
    index += selector.length;
    while (/\s/.test(source[index] ?? "")) index += 1;
  }
  if (source[index] !== ";") throw includeError(file, source, index, "Expected ; after include path");
  return { path: quoted.value, ...(selector && { selector }), end: index + 1 };
}

function readBalancedBlockEnd(source: string, open: number, file: string): number {
  let depth = 1;
  let index = open + 1;
  while (index < source.length) {
    const current = source[index]!;
    if (current === "#" || (current === "/" && source[index + 1] === "/")) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (current === '"' || current === "'") {
      index = skipQuotedValue(source, index, file);
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  throw includeError(file, source, open, "Unterminated selected block");
}

function selectIncludedFragment(source: string, selector: string, file: string): string {
  const blockName = selector === "message" ? "messages" : selector;
  if (blockName !== "messages") {
    throw new Error(`${file}: unsupported include selector @${selector}; currently only @message and @messages are implemented`);
  }
  const blocks: string[] = [];
  let depth = 0;
  let index = 0;
  while (index < source.length) {
    const current = source[index]!;
    if (current === "#" || (current === "/" && source[index + 1] === "/")) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (current === '"' || current === "'") {
      index = skipQuotedValue(source, index, file);
      continue;
    }
    if (depth === 0 && source.startsWith(blockName, index) && !isWordCharacter(source[index - 1]) && !isWordCharacter(source[index + blockName.length])) {
      let open = index + blockName.length;
      while (/\s/.test(source[open] ?? "")) open += 1;
      if (source[open] !== "{") throw includeError(file, source, open, `Expected { after selected ${blockName}`);
      const end = readBalancedBlockEnd(source, open, file);
      blocks.push(source.slice(index, end));
      index = end;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}") depth -= 1;
    index += 1;
  }
  if (blocks.length === 0) throw new Error(`${file}: include selector @${selector} did not find a top-level ${blockName} block`);
  if (blocks.length > 1) throw new Error(`${file}: include selector @${selector} matched multiple top-level ${blockName} blocks`);
  return blocks[0]!;
}

function validateIncludePath(target: string, file: string, source: string, offset: number): void {
  if (!target) throw includeError(file, source, offset, "include path cannot be empty");
  if (!target.endsWith(".qiy")) throw includeError(file, source, offset, "include path must reference a .qiy file");
  if (isAbsolute(target) || win32.isAbsolute(target) || posix.isAbsolute(target)) {
    throw includeError(file, source, offset, "include path must be relative to the current .qiy file");
  }
  if (target.replace(/\\/g, "/").split("/").includes("..")) {
    throw includeError(file, source, offset, "include path cannot contain ..");
  }
}

interface IncludeState {
  root: string;
  stack: string[];
}

function expandQiyFile(file: string, state: IncludeState, fragment: boolean): string {
  if (!existsSync(file)) throw new Error(`Qiy include file does not exist: ${file}`);
  const realFile = realpathSync(file);
  if (!isInside(state.root, realFile)) throw new Error(`Qiy include resolves outside the project root: ${file}`);
  const cycleStart = state.stack.indexOf(realFile);
  if (cycleStart !== -1) throw new Error(`Qiy include cycle detected: ${[...state.stack.slice(cycleStart), realFile].join(" -> ")}`);

  const source = readFileSync(realFile, "utf8");
  const includeDepth = fragment ? 0 : 1;
  const nextState: IncludeState = { ...state, stack: [...state.stack, realFile] };
  let depth = 0;
  let index = 0;
  let result = "";
  while (index < source.length) {
    const current = source[index]!;
    if (current === "#" || (current === "/" && source[index + 1] === "/")) {
      const end = source.indexOf("\n", index);
      const commentEnd = end === -1 ? source.length : end;
      result += source.slice(index, commentEnd);
      index = commentEnd;
      continue;
    }
    if (current === '"' || current === "'") {
      const end = skipQuotedValue(source, index, realFile);
      result += source.slice(index, end);
      index = end;
      continue;
    }
    if (source.startsWith("include", index) && !isWordCharacter(source[index - 1]) && !isWordCharacter(source[index + "include".length])) {
      if (depth !== includeDepth) throw includeError(realFile, source, index, "include statements must be direct children of the application or fragment");
      const statement = readIncludeStatement(source, index, realFile);
      validateIncludePath(statement.path, realFile, source, index);
      const requested = resolve(dirname(realFile), statement.path);
      if (!isInside(state.root, requested)) throw includeError(realFile, source, index, "include path escapes the project root");
      if (!existsSync(requested)) throw includeError(realFile, source, index, `Included file does not exist: ${statement.path}`);
      const expanded = expandQiyFile(requested, nextState, true);
      result += `\n${statement.selector ? selectIncludedFragment(expanded, statement.selector, requested) : expanded}\n`;
      index = statement.end;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}") depth -= 1;
    result += current;
    index += 1;
  }
  return result;
}

/** Loads a Qiy project and expands top-level application-fragment includes. */
export async function loadQiyProjectSource(entryPath: string): Promise<string> {
  const entry = resolve(entryPath);
  if (!entry.endsWith(".qiy")) throw new Error(`Expected a .qiy source file: ${entryPath}`);
  if (!existsSync(entry)) throw new Error(`Qiy source file does not exist: ${entry}`);
  const realEntry = realpathSync(entry);
  return expandQiyFile(realEntry, { root: dirname(realEntry), stack: [] }, false);
}
