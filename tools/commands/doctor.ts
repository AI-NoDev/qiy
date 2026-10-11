import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderAdminTemplate } from "../admin-template";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  root: string;
  bunVersion: string;
  checks: DoctorCheck[];
}

export function runDoctor(root = process.cwd()): DoctorReport {
  const resolvedRoot = resolve(root);
  const checks: DoctorCheck[] = [{ name: "bun", status: "ok", message: `Bun ${Bun.version}` }];
  try {
    const template = renderAdminTemplate("qiy-doctor", "items");
    if (!template["apps/web/app/root.tsx"] || !template["apps/server/src/http.ts"]) throw new Error("required application files are missing");
    checks.push({ name: "template", status: "ok", message: "Embedded admin template is available" });
  } catch (error) {
    checks.push({ name: "template", status: "error", message: error instanceof Error ? error.message : String(error) });
  }
  const packagePath = resolve(resolvedRoot, "package.json");
  if (!existsSync(packagePath)) {
    checks.push({ name: "workspace", status: "warning", message: "No package.json in the current directory; qiy init requires a Bun project root." });
  } else {
    try {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { packageManager?: unknown };
      if (typeof packageJson.packageManager === "string" && packageJson.packageManager.startsWith("bun@")) {
        checks.push({ name: "workspace", status: "ok", message: `Bun workspace declared as ${packageJson.packageManager}` });
      } else {
        checks.push({ name: "workspace", status: "warning", message: "package.json does not declare packageManager: bun@<version>; qiy init will refuse this directory." });
      }
    } catch {
      checks.push({ name: "workspace", status: "error", message: "package.json is not valid JSON." });
    }
  }
  return { ok: !checks.some((check) => check.status === "error"), root: resolvedRoot, bunVersion: Bun.version, checks };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`Qiy doctor: ${report.ok ? "ready" : "failed"}`, `Root: ${report.root}`];
  for (const check of report.checks) lines.push(`[${check.status.toUpperCase()}] ${check.name}: ${check.message}`);
  return `${lines.join("\n")}\n`;
}
