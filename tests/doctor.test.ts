import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatDoctorReport, runDoctor } from "../tools/commands/doctor";

test("doctor reports template readiness and Bun workspace compatibility", () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-doctor-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ packageManager: "bun@1.3.13" }));
  const report = runDoctor(root);
  expect(report.ok).toBe(true);
  expect(report.checks).toContainEqual(expect.objectContaining({ name: "template", status: "ok" }));
  expect(report.checks).toContainEqual(expect.objectContaining({ name: "workspace", status: "ok" }));
  expect(formatDoctorReport(report)).toContain("Qiy doctor: ready");
});

test("doctor warns rather than fails outside a Bun workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-doctor-empty-"));
  const report = runDoctor(root);
  expect(report.ok).toBe(true);
  expect(report.checks).toContainEqual(expect.objectContaining({ name: "workspace", status: "warning" }));
});
