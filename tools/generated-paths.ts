import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

declare const __QIY_VERSION__: string;

export const GENERATED_MANIFEST_SCHEMA_VERSION = 1;
export const QIY_VERSION = typeof __QIY_VERSION__ === "string" ? __QIY_VERSION__ : packageMetadata.version;

export interface GeneratedManifest {
  schemaVersion: number;
  qiyVersion: string;
  projectName: string;
  mode: "standalone" | "integration";
  files: string[];
}

export function createGeneratedManifest(projectName: string, mode: GeneratedManifest["mode"], files: string[]): GeneratedManifest {
  return { schemaVersion: GENERATED_MANIFEST_SCHEMA_VERSION, qiyVersion: QIY_VERSION, projectName, mode, files };
}

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

export function readGeneratedManifest(value: unknown): GeneratedManifest | { files: string[] } {
  const files = manifestFiles(value);
  if (!("schemaVersion" in (value as object))) return { files };
  const manifest = value as Partial<GeneratedManifest>;
  if (manifest.schemaVersion !== GENERATED_MANIFEST_SCHEMA_VERSION) throw new Error(`Unsupported Qiy generated-file manifest schema: ${String(manifest.schemaVersion)}`);
  if (typeof manifest.qiyVersion !== "string" || !manifest.qiyVersion) throw new Error("Invalid Qiy generated-file manifest: expected qiyVersion");
  if (typeof manifest.projectName !== "string" || !manifest.projectName) throw new Error("Invalid Qiy generated-file manifest: expected projectName");
  if (manifest.mode !== "standalone" && manifest.mode !== "integration") throw new Error("Invalid Qiy generated-file manifest: expected standalone or integration mode");
  return manifest as GeneratedManifest;
}
