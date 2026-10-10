import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function generatedPath(output: string, relativePath: string): string {
  if (!relativePath || relativePath.includes("\\") || relativePath.includes(":") || relativePath.includes("\0") || relativePath.startsWith("/")) {
    throw new Error("Invalid generated file path");
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part))) {
    throw new Error("Invalid generated file path");
  }
  const path = join(resolve(output), ...parts);
  let current = path;
  while (true) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error("Generated file path traverses a symbolic link");
    if (current === path && stat && !stat.isFile()) throw new Error("Generated file target is not a regular file");
    if (current !== path && stat && !stat.isDirectory()) throw new Error("Generated file parent is not a directory");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path;
}

export function manifestFiles(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("files" in value) || !Array.isArray(value.files) || value.files.some((file) => typeof file !== "string")) {
    throw new Error("Invalid Qiy generated-file manifest: expected a files array of strings");
  }
  return value.files;
}
