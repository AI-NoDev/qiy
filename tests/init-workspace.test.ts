import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initApp } from "../tools/commands/init";

const catalogSource = `qiy v0;
application catalog {
  database sqlite {}
  workspace {
    name admin;
    aliases { server ops-api; web ops-console; deploy ops-admin; }
    packages { server "@host/ops-api"; web "@host/ops-console"; }
  }
  entity products {
    field id UUID @id;
    field title Text;
  }
}`;

test("mounts a Qiy admin into a Bun workspace with aliases and preserves host files on sync", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-init-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "host-app", private: true, packageManager: "bun@1.3.13", workspaces: ["packages/*"], scripts: { dev: "bun run src/index.ts" } }, null, 2));
  writeFileSync(join(root, ".gitignore"), "coverage/\n");
  writeFileSync(join(root, ".env"), "HOST_ENV=keep-root-env\n");
  writeFileSync(join(root, ".env.example"), "HOST_EXAMPLE=keep-root-example\n");
  writeFileSync(join(root, ".env.development"), "HOST_DEVELOPMENT=keep-root-development\n");
  writeFileSync(join(root, "admin.qiy"), catalogSource);
  await initApp({ root, source: "admin.qiy" });

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { workspaces: string[]; scripts: Record<string, string> };
  expect(packageJson.workspaces).toEqual(["packages/*", "apps/*"]);
  expect(packageJson.scripts["qiy:admin:dev:server"]).toBe("bun run --cwd apps/ops-api dev");
  expect(JSON.parse(readFileSync(join(root, "apps/ops-api/package.json"), "utf8")).name).toBe("@host/ops-api");
  expect(JSON.parse(readFileSync(join(root, "apps/ops-console/package.json"), "utf8")).name).toBe("@host/ops-console");
  expect(readFileSync(join(root, "apps/ops-api/src/server.ts"), "utf8")).toContain("../../ops-console/build/client");
  expect(existsSync(join(root, "ops-admin.Dockerfile"))).toBe(true);
  expect(readFileSync(join(root, "ops-admin.Dockerfile"), "utf8")).not.toContain("turbo.json");
  expect(existsSync(join(root, "docker-compose.ops-admin.yml"))).toBe(true);
  expect(readFileSync(join(root, "docker-compose.ops-admin.yml"), "utf8")).toContain("  ops-admin:");
  expect(readFileSync(join(root, "docker-compose.ops-admin.yml"), "utf8")).toContain("./apps/ops-api/.env.production");
  expect(readFileSync(join(root, "docker-compose.ops-admin.yml"), "utf8")).not.toContain("./apps/server/.env.production");
  expect(existsSync(join(root, "apps/ops-api/.env.development"))).toBe(true);
  expect(existsSync(join(root, "apps/ops-api/.env.production"))).toBe(true);
  expect(existsSync(join(root, "apps/ops-api/.env.example"))).toBe(true);
  expect(existsSync(join(root, "apps/ops-console/.env.development"))).toBe(true);
  expect(readFileSync(join(root, ".env"), "utf8")).toBe("HOST_ENV=keep-root-env\n");
  expect(readFileSync(join(root, ".env.example"), "utf8")).toBe("HOST_EXAMPLE=keep-root-example\n");
  expect(readFileSync(join(root, ".env.development"), "utf8")).toBe("HOST_DEVELOPMENT=keep-root-development\n");
  expect(readFileSync(join(root, "deploy/ops-admin/nginx.conf"), "utf8")).toContain("http://ops-admin:3000");
  expect(existsSync(join(root, "deploy/ops-admin/nginx.conf"))).toBe(true);
  expect(existsSync(join(root, "turbo.json"))).toBe(false);
  expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("coverage/");
  expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("apps/ops-console/build/");

  writeFileSync(join(root, "apps/ops-api/src/host-extension.ts"), "export const hostExtension = true;\n");
  writeFileSync(join(root, "apps/ops-api/.env.development"), "DATABASE_URL=postgres://private-host/qiy\nCUSTOM_ENV=preserve\n");
  await initApp({ root, source: "admin.qiy", sync: true });
  expect(readFileSync(join(root, "apps/ops-api/src/host-extension.ts"), "utf8")).toContain("hostExtension");
  expect(readFileSync(join(root, "apps/ops-api/.env.development"), "utf8")).toContain("DATABASE_URL=postgres://private-host/qiy");
  expect(readFileSync(join(root, "apps/ops-api/.env.development"), "utf8")).toContain("CUSTOM_ENV=preserve");
});

test("requires a Bun project root before writing integration files", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-init-invalid-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "host-app", packageManager: "pnpm@10.0.0" }));
  writeFileSync(join(root, "admin.qiy"), catalogSource);
  await expect(initApp({ root, source: "admin.qiy" })).rejects.toThrow("packageManager to declare Bun");
  expect(existsSync(join(root, "apps"))).toBe(false);
});
