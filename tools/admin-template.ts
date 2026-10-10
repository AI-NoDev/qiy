import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ADMIN_TEMPLATE_FILES } from "./admin-template.data";

/**
 * Reads `templates/admin/` when a source checkout is available so template
 * edits take effect immediately, and otherwise falls back to the inlined
 * snapshot so the compiled `qiy` executable works without the repository.
 */
function readTemplate(): Record<string, string> {
  const root = resolve(import.meta.dir, "../templates/admin");
  if (!existsSync(root)) {
    if (Object.keys(ADMIN_TEMPLATE_FILES).length === 0) {
      throw new Error("Admin template is missing: neither templates/admin/ nor the inlined snapshot is available.");
    }
    return { ...ADMIN_TEMPLATE_FILES };
  }
  const files: Record<string, string> = {};
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const key = relative(root, path).replaceAll("\\", "/");
        files[key] = readFileSync(path, "utf8");
      }
    }
  }
  visit(root);
  return files;
}

export function renderAdminTemplate(name: string, firstResource: string): Record<string, string> {
  return Object.fromEntries(Object.entries(readTemplate()).map(([path, content]) => [
    path, content.replaceAll("__QIY_APP_NAME__", name).replaceAll("__QIY_FIRST_RESOURCE__", firstResource).replace("__QIY_AUTH_IMPORT__", "").replace("__QIY_AUTH_PROPS__", ""),
  ]));
}

export function renderAppTemplate(app: "server" | "web", output: "api" | "web"): Record<string, string> {
  const prefix = `apps/${app}/`;
  return Object.fromEntries(Object.entries(readTemplate())
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, content]) => [output + "/" + path.slice(prefix.length), content]));
}

export function renderWorkspaceTemplate(name: string, firstResource: string): Record<string, string> {
  const files = readTemplate();
  return Object.fromEntries(Object.entries(files)
    .filter(([path]) => !path.startsWith("apps/"))
    .map(([path, content]) => [
      path,
      content.replaceAll("__QIY_APP_NAME__", name).replaceAll("__QIY_FIRST_RESOURCE__", firstResource),
    ]));
}
