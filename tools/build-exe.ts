/**
 * Builds standalone `qiy` executables with Bun's bundler.
 *
 *   bun run build:exe                 # host platform (windows-x64 here)
 *   bun run build:exe -- --all        # windows, linux and darwin builds
 *
 * See https://bun.com/docs/bundler/executables.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import "./build-skill";

const root = resolve(import.meta.dir, "..");
const outdir = join(root, "dist");
const version = (await Bun.file(join(root, "package.json")).json()).version as string;
const all = Bun.argv.includes("--all");

const platformName: Record<string, string> = { win32: "windows", darwin: "darwin", linux: "linux" };
const hostPlatform = platformName[process.platform] ?? process.platform;

/** @type {{ target: string; outfile: string }[]} */
const targets = all
  ? [
      { target: "bun-windows-x64", outfile: join(outdir, `qiy-${version}-windows-x64.exe`) },
      { target: "bun-linux-x64", outfile: join(outdir, `qiy-${version}-linux-x64`) },
      { target: "bun-linux-arm64", outfile: join(outdir, `qiy-${version}-linux-arm64`) },
      { target: "bun-darwin-x64", outfile: join(outdir, `qiy-${version}-darwin-x64`) },
      { target: "bun-darwin-arm64", outfile: join(outdir, `qiy-${version}-darwin-arm64`) },
    ]
  : [{ target: `bun-${hostPlatform}-${process.arch}`, outfile: join(outdir, `qiy-${version}-${hostPlatform}-${process.arch}${hostPlatform === "windows" ? ".exe" : ""}`) }];

if (!existsSync(join(root, "tools/admin-template.data.ts")) || Bun.file(join(root, "tools/admin-template.data.ts")).size < 1024) {
  throw new Error("Template snapshot is empty. Run `bun run template:build` before packaging.");
}

mkdirSync(outdir, { recursive: true });
for (const { target, outfile } of targets) {
  const args = [
    "build",
    "tools/cli.ts",
    "--compile",
    `--target=${target}`,
    `--outfile=${outfile}`,
    `--define=__QIY_VERSION__=${JSON.stringify(version)}`,
    "--minify",
    "--sourcemap=external",
  ];
  if (target.includes("windows") && process.platform === "win32") {
    args.push("--windows-hide-console", "--windows-title", "Qiy CLI", "--windows-publisher", "Qiy");
  }
  console.log(`bun ${args.join(" ")}`);
  const result = Bun.spawnSync([process.execPath, ...args], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`bun build failed for ${target} with exit code ${result.exitCode}`);
  console.log(`Built ${outfile}`);
}

console.log(`\nExecutables written to ${outdir}`);
