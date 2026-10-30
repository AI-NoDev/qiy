import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Builds a stable versioned archive of the docs under `/v<minor>/` and copies
 * it into the main VitePress output. The version is pinned per minor release
 * (currently 0.6) so the archive stays stable while `latest` keeps moving.
 */
const root = resolve(import.meta.dir, "..");
const docs = join(root, "docs");
const dist = join(docs, ".vitepress", "dist");
const staging = join(docs, ".vitepress", "dist-version");
const version = process.env.QIY_DOCS_ARCHIVE_VERSION ?? "v0.6";
const siteUrl = (process.env.QIY_DOCS_SITE_URL ?? "https://ai-nodev.github.io/qiy").replace(/\/$/, "");
const latestBase = (process.env.VITEPRESS_BASE ?? "/qiy/").replace(/\/?$/, "/");
const base = process.env.QIY_DOCS_ARCHIVE_BASE ?? `${latestBase}${version}/`;
const archiveUrl = `${siteUrl}/${version}`;

function run(command: string[]): void {
  const child = Bun.spawnSync(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, VITEPRESS_BASE: base, QIY_DOCS_SITE_URL: archiveUrl, QIY_DOCS_LATEST_URL: siteUrl },
  });
  if (child.exitCode !== 0) throw new Error(`${command.join(" ")} failed (${child.exitCode})`);
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
try {
  run([process.execPath, "x", "vitepress", "build", docs, "--outDir", staging]);
  const target = join(dist, version);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync(staging, target, { recursive: true });
  console.log(`Docs version archive: ${version} -> ${target} (base ${base})`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
if (!existsSync(join(dist, version, "index.html"))) throw new Error(`Version archive ${version} was not created`);
