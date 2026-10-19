import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateApp } from "./commands/generate-app";
import { s3ApiAcceptance } from "./s3-api-acceptance";

const bucket = Bun.env.QIY_S3_BUCKET;
const endpoint = Bun.env.QIY_S3_ENDPOINT;
const accessKeyId = Bun.env.QIY_S3_ACCESS_KEY_ID;
const secretAccessKey = Bun.env.QIY_S3_SECRET_ACCESS_KEY;
if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error("Set QIY_S3_BUCKET, QIY_S3_ENDPOINT, QIY_S3_ACCESS_KEY_ID and QIY_S3_SECRET_ACCESS_KEY for an existing acceptance bucket");
}
const root = mkdtempSync(join(tmpdir(), "qiy-s3-acceptance-"));
const key = `acceptance/${crypto.randomUUID()}.txt`;
let storage: import("../templates/admin/apps/server/src/storage").StorageProvider | undefined;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
try {
  const source = join(root, "app.qiy");
  writeFileSync(source, 'qiy v0; application s3-acceptance { database sqlite {} storage { provider s3; } entity documents { field id UUID @id; field attachment File @nullable @upload(binary) @maxBytes(1048576); } }');
  await generateApp(source, join(root, "admin"));
  const adapter = await import(pathToFileURL(join(root, "admin/apps/server/src/storage/index.ts")).href);
  storage = adapter.createS3Storage({ bucket, endpoint, accessKeyId, secretAccessKey, region: Bun.env.QIY_S3_REGION ?? "us-east-1" });
  assert(storage, "Generated storage adapter missing");
  await storage.save(key, new Blob(["Qiy generated S3 acceptance"], { type: "text/plain" }));
  assert(await storage.exists(key), "Uploaded object missing");
  assert(await storage.open(key).text() === "Qiy generated S3 acceptance", "Object content mismatch");
  // Orphan scanning depends on enumerating real bucket contents, not just on get/put.
  assert((await storage.list()).includes(key), "list() did not return the uploaded object");
  const signedUrl = storage.signedUrl(key);
  assert(signedUrl, "Signed download URL missing");
  const response = await fetch(signedUrl);
  assert(response.ok && await response.text() === "Qiy generated S3 acceptance", "Signed download failed");
  await storage.delete(key);
  assert(!await storage.exists(key), "Deleted object still exists");
  assert(!(await storage.list()).includes(key), "list() still returns the deleted object");
  console.log("Generated S3 adapter: upload, exists, read, list, signed download and delete passed");
  if (Bun.argv.includes("--api")) {
    const workspace = join(root, "admin");
    const serverRoot = join(workspace, "apps/server");
    writeFileSync(join(serverRoot, "s3-api-acceptance.test.ts"), s3ApiAcceptance);
    for (const [command, cwd] of [
      [[process.execPath, "install"], workspace],
      [[process.execPath, "test", "./s3-api-acceptance.test.ts"], serverRoot],
    ] as const) {
      console.log("S3 API acceptance:", command.slice(1).join(" "));
      const child = Bun.spawn([...command], { cwd, env: { ...Bun.env, DATABASE_URL: ":memory:", QIY_STORAGE_PROVIDER: "s3", QIY_STORAGE_METADATA: "database" }, stdout: "inherit", stderr: "inherit" });
      if (await child.exited !== 0) throw new Error("Generated S3 API acceptance failed");
    }
  }
} finally {
  try { if (storage) await storage.delete(key); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
