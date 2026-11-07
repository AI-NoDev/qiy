import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractReleaseNotes } from "../tools/release-notes";

const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");
const packageVersion = (
  JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")) as { version: string }
).version;

const fixture = `# Changelog

## [2.1.0] - 2027-01-02

### Added

- Second release body.

## [2.0.0] - 2027-01-01

- First release body.

[2.1.0]: https://example.test/v2.1.0
`;

test("extracts only the requested version section", () => {
  expect(extractReleaseNotes(fixture, "2.1.0")).toBe("### Added\n\n- Second release body.");
  const notes = extractReleaseNotes(fixture, "2.0.0");
  expect(notes).toContain("First release body.");
  expect(notes).not.toContain("Second release body.");
});

test("returns undefined for an unknown version", () => {
  expect(extractReleaseNotes(fixture, "99.99.99")).toBeUndefined();
  expect(extractReleaseNotes(changelog, "99.99.99")).toBeUndefined();
});

test("the current package version has curated release notes", () => {
  const notes = extractReleaseNotes(changelog, packageVersion);
  expect(notes).toBeDefined();
  expect(notes!.length).toBeGreaterThan(80);
});
