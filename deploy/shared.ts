import { existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type { DistributionContext, EnvReference, ReleaseArtifact, RelayDistributionConfig } from "./types";

export function resolveEnv(reference: EnvReference, label: string): string {
  const name = reference.slice("env:".length);
  if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`${label} must use an uppercase env:NAME reference`);
  const value = Bun.env[name];
  if (!value) throw new Error(`${label} requires environment variable ${name}`);
  return value;
}

export function validateArtifact(artifact: ReleaseArtifact): ReleaseArtifact {
  const path = resolve(artifact.path);
  if (!existsSync(path)) throw new Error(`Android artifact does not exist: ${path}`);
  if (![".apk", ".aab"].includes(extname(path).toLowerCase())) throw new Error("Android artifact must be an .apk or .aab file");
  if (artifact.secondApkPath && !existsSync(resolve(artifact.secondApkPath))) throw new Error(`Second Android artifact does not exist: ${artifact.secondApkPath}`);
  return { ...artifact, path, ...(artifact.secondApkPath && { secondApkPath: resolve(artifact.secondApkPath) }) };
}

export function artifactName(artifact: ReleaseArtifact): string {
  return basename(artifact.path);
}

export function requireDownloadUrl(context: DistributionContext, platform: string): string {
  const url = context.artifact.downloadUrl;
  if (!url) throw new Error(`${platform} requires --download-url because the official API downloads the artifact from a reachable HTTPS URL`);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error(`${platform} download URL must use HTTPS`);
  return parsed.toString();
}

export async function submitToRelay(platform: string, relay: RelayDistributionConfig, context: DistributionContext): Promise<{ reference?: string }> {
  const token = resolveEnv(relay.token, `${platform} relay token`);
  const response = await fetch(relay.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...relay.headers },
    body: JSON.stringify({
      platform,
      app: context.config.app,
      artifact: { path: artifactName(context.artifact), downloadUrl: context.artifact.downloadUrl, secondApkPath: context.artifact.secondApkPath && basename(context.artifact.secondApkPath) },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${platform} relay rejected the release (${response.status}): ${body.slice(0, 500)}`);
  let parsed: { reference?: string } | undefined;
  try { parsed = JSON.parse(body) as { reference?: string }; } catch { /* a non-JSON success response is valid */ }
  return parsed ?? {};
}
