#!/usr/bin/env bun
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { publishHonor } from "./platforms/honor";
import { publishHuawei } from "./platforms/huawei";
import { publishOppo } from "./platforms/oppo";
import { publishTencent } from "./platforms/tencent";
import { publishVivo } from "./platforms/vivo";
import { publishXiaomi } from "./platforms/xiaomi";
import { validateArtifact } from "./shared";
import { platformNames, type DistributionConfig, type DistributionContext, type DistributionPlatform, type DistributionResult, type ReleaseArtifact, type StoreAdapter } from "./types";

const adapters: Record<DistributionPlatform, StoreAdapter> = {
  huawei: publishHuawei,
  xiaomi: publishXiaomi,
  oppo: publishOppo,
  vivo: publishVivo,
  tencent: publishTencent,
  honor: publishHonor,
};

export interface DeploymentRequest {
  config: DistributionConfig;
  artifact: ReleaseArtifact;
  platforms: DistributionPlatform[];
  dryRun: boolean;
}

export async function runDeployment(request: DeploymentRequest): Promise<DistributionResult[]> {
  if (!request.platforms.length) throw new Error("Choose at least one distribution platform");
  const context: DistributionContext = { config: request.config, artifact: validateArtifact(request.artifact), dryRun: request.dryRun };
  const results: DistributionResult[] = [];
  for (const platform of request.platforms) results.push(await adapters[platform](context));
  return results;
}

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function selectedPlatforms(args: string[]): DistributionPlatform[] {
  if (args.includes("--all")) return [...platformNames];
  const raw = value(args, "--platform");
  if (!raw) throw new Error("Use --platform huawei,xiaomi or --all");
  const selected = raw.split(",").map((item) => item.trim()).filter(Boolean);
  const invalid = selected.filter((item) => !platformNames.includes(item as DistributionPlatform));
  if (invalid.length) throw new Error(`Unknown distribution platform: ${invalid.join(", ")}`);
  return [...new Set(selected)] as DistributionPlatform[];
}

async function loadConfig(file: string): Promise<DistributionConfig> {
  const path = resolve(file);
  const loaded = await import(pathToFileURL(path).href);
  const config = (loaded.default ?? loaded.deployConfig) as DistributionConfig | undefined;
  if (!config?.app || !config.stores) throw new Error(`Deployment config ${path} must export default DistributionConfig`);
  return config;
}

const usage = `Qiy Android distribution CLI

Usage:
  bun run deploy/index.ts --platform huawei,xiaomi --artifact app-release.apk [options]

Options:
  --platform <list>      Comma-separated: ${platformNames.join(", ")}
  --all                  Select all configured platforms
  --artifact <path>      Required .apk or .aab file
  --second-apk <path>    Optional secondary APK for Xiaomi
  --download-url <url>   HTTPS artifact URL required by Huawei's by-URL submission
  --config <path>        Defaults to deploy/config.ts
  --dry-run              Print the selected release plan without sending it
  --confirm              Submit selected releases (required for network publication)
  -h, --help             Show this help

Secrets are always loaded from env:NAME references in deploy/config.ts; never place access keys in the config file.`;

async function main(args: string[]): Promise<void> {
  if (!args.length || args.includes("-h") || args.includes("--help")) return void console.log(usage);
  const artifactPath = value(args, "--artifact");
  if (!artifactPath) throw new Error("--artifact <path> is required\n\n" + usage);
  const dryRun = args.includes("--dry-run") || !args.includes("--confirm");
  if (!dryRun && args.includes("--dry-run")) throw new Error("Choose either --dry-run or --confirm, not both");
  const results = await runDeployment({
    config: await loadConfig(value(args, "--config") ?? "deploy/config.ts"),
    artifact: { path: artifactPath, ...(value(args, "--second-apk") && { secondApkPath: value(args, "--second-apk") }), ...(value(args, "--download-url") && { downloadUrl: value(args, "--download-url") }) },
    platforms: selectedPlatforms(args),
    dryRun,
  });
  for (const result of results) console.log(`[${result.platform}] ${result.status} (${result.mode}) ${result.message}${result.reference ? ` reference=${result.reference}` : ""}`);
  if (dryRun) console.log("Dry-run only. Re-run with --confirm after reviewing the selected targets.");
}

if (import.meta.main) {
  try { await main(Bun.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
