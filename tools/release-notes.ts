#!/usr/bin/env bun
/**
 * Prints the CHANGELOG section for a version so the release workflow can attach
 * curated notes to the GitHub release. Falls back to auto-generated notes when
 * the section is missing (the workflow handles the non-zero exit).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CHANGELOG_PATH = resolve(import.meta.dir, "../CHANGELOG.md");

export function extractReleaseNotes(markdown: string, version: string): string | undefined {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## \\[?${escaped}\\]?(?:\\s+-\\s+.*)?$`, "m");
  const match = heading.exec(markdown);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = /^## /m.exec(rest);
  const body = (next ? rest.slice(0, next.index) : rest).trim();
  return body || undefined;
}

function currentVersion(): string {
  const packageJson = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")) as { version: string };
  return packageJson.version;
}

if (import.meta.main) {
  const version = process.argv[2] ?? currentVersion();
  const notes = extractReleaseNotes(readFileSync(CHANGELOG_PATH, "utf8"), version);
  if (!notes) {
    console.error(`No CHANGELOG section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
