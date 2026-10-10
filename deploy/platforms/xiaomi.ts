import { existsSync, readFileSync } from "node:fs";
import { publicEncrypt, constants } from "node:crypto";
import { resolve } from "node:path";
import { resolveEnv, validateArtifact } from "../shared";
import type { DistributionContext, DistributionResult } from "../types";

function md5(value: string | Uint8Array): string {
  return new Bun.CryptoHasher("md5").update(value).digest("hex");
}

function appendFile(form: FormData, name: string, path: string, signatures: Array<{ name: string; hash: string }>): void {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`Xiaomi ${name} file does not exist: ${resolved}`);
  form.append(name, Bun.file(resolved));
  signatures.push({ name, hash: md5(readFileSync(resolved)) });
}

function xiaomiTestAccount(context: DistributionContext): string | undefined {
  const account = context.config.app.assets.testAccount;
  if (!account) return undefined;
  return JSON.stringify({
    zh_CN: {
      ...(account.accounts && { accounts: account.accounts.map((item) => ({ t: item.type === "password" ? 1 : 2, ...(item.account && { a: item.account }), ...(item.passwordOrCode && { p: item.passwordOrCode }), ...(item.accessCode && { c: item.accessCode }) })) }),
      ...(account.auditNotes && { auditNotes: account.auditNotes }),
    },
  });
}

/** Uses Xiaomi's documented public-key RSA/NONE/PKCS1Padding request signature. */
export async function publishXiaomi(context: DistributionContext): Promise<DistributionResult> {
  const store = context.config.stores.xiaomi;
  if (!store.enabled) throw new Error("Xiaomi distribution is disabled in deploy/config.ts");
  const artifact = validateArtifact(context.artifact);
  const assets = context.config.app.assets;
  const screenshots = assets.screenshots ?? [];
  if (context.dryRun) return { platform: "xiaomi", mode: "official-api", status: "planned", message: `Would ${store.releaseMode ?? "update-package"} ${artifact.path} through the Xiaomi automatic publishing API.` };
  if (!assets.iconPath || screenshots.length < 3) throw new Error("Xiaomi publishing requires iconPath and at least three screenshots in deploy/config.ts");

  const username = resolveEnv(store.username, "Xiaomi username");
  const credential = resolveEnv(store.credential, "Xiaomi account credential or platform private key");
  const encryptionPublicKey = resolveEnv(store.encryptionPublicKey, "Xiaomi encryption public key").replace(/\\n/g, "\n");
  const synchroType = store.releaseMode === "create" ? 0 : store.releaseMode === "update-info" ? 2 : 1;
  const app = context.config.app;
  const requestData = JSON.stringify({
    userName: username,
    synchroType,
    appInfo: {
      appName: app.name,
      packageName: app.packageName,
      ...(app.publisherName && { publisherName: app.publisherName }),
      ...(app.versionName && { versionName: app.versionName }),
      ...(app.category !== undefined && { category: app.category }),
      ...(app.keywords?.length && { keyWords: app.keywords.join(" ") }),
      ...(app.description && { desc: app.description }),
      ...(app.website && { web: app.website }),
      ...(app.brief && { brief: app.brief }),
      ...(app.updateDescription && { updateDesc: app.updateDescription }),
      privacyUrl: assets.privacyPolicyUrl,
      ...(xiaomiTestAccount(context) && { testAccount: xiaomiTestAccount(context) }),
    },
  });
  const signatures: Array<{ name: string; hash: string }> = [{ name: "RequestData", hash: md5(requestData) }];
  const form = new FormData();
  form.append("RequestData", requestData);
  if (synchroType !== 2) appendFile(form, "apk", artifact.path, signatures);
  if (artifact.secondApkPath) appendFile(form, "secondApk", artifact.secondApkPath, signatures);
  appendFile(form, "icon", assets.iconPath, signatures);
  for (const [index, screenshot] of screenshots.entries()) appendFile(form, `screenshot_${index + 1}`, screenshot, signatures);
  const signaturePayload = JSON.stringify({ password: credential, sig: signatures });
  const signature = publicEncrypt({ key: encryptionPublicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(signaturePayload)).toString("hex");
  form.append("SIG", signature);
  const baseUrl = store.apiBaseUrl ?? "https://api.developer.xiaomi.com/devupload";
  const response = await fetch(`${baseUrl}/dev/push`, { method: "POST", body: form });
  const body = await response.text();
  if (!response.ok) throw new Error(`Xiaomi app submission failed (${response.status}): ${body.slice(0, 500)}`);
  const parsed = JSON.parse(body) as { result?: number; message?: string };
  if (parsed.result !== 0) throw new Error(`Xiaomi app submission failed: ${parsed.message ?? body}`);
  return { platform: "xiaomi", mode: "official-api", status: "submitted", message: parsed.message ?? "Submitted to Xiaomi App Store." };
}
