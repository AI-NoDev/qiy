import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractReleaseNotes } from "../tools/release-notes";

const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");
const packageVersion = (
  JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")) as { version: string }
).version;

test("extracts only the requested version section", () => {
  const notes = extractReleaseNotes(changelog, "0.2.1");
  expect(notes).toContain("Complete the official Agent Skill");
  expect(notes).not.toContain("Complete Chinese DSL reference");
  // Link definitions and older releases must not leak into a release body.
  expect(notes).not.toContain("[0.2.1]: https://");
});

test("returns undefined for an unknown version", () => {
  expect(extractReleaseNotes(changelog, "99.99.99")).toBeUndefined();
});

test("the current package version has curated release notes", () => {
  const notes = extractReleaseNotes(changelog, packageVersion);
  expect(notes).toBeDefined();
  expect(notes!.length).toBeGreaterThan(80);
});
