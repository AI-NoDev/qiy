import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Self-provisioning S3-compatible acceptance. When no endpoint is supplied it
 * starts a local MinIO from an already present image, pre-creating the bucket as
 * a directory in the data volume (MinIO serves existing directories as buckets,
 * so no admin credentials or mc client are needed), then runs the generated
 * adapter acceptance and the in-process HTTP/metadata acceptance against it.
 * Set QIY_S3_ENDPOINT and friends to reuse an existing bucket instead.
 */
const container = "qiy-minio-acceptance";
const bucket = "qiy-acceptance";
const hostPort = Number(Bun.env.QIY_S3_ACCEPTANCE_PORT ?? 19010);
const accessKeyId = "qiy-acceptance";
const secretAccessKey = "qiy-acceptance-secret";
const root = mkdtempSync(join(tmpdir(), "qiy-s3-run-"));
const data = join(root, "data");
const externallyConfigured = Boolean(Bun.env.QIY_S3_ENDPOINT);
let started = false;

async function run(command: string[], env: Record<string, string> = {}): Promise<void> {
  console.log(`==> ${command.join(" ")}`);
  const child = Bun.spawn(command, { cwd: join(import.meta.dir, ".."), env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`${command.join(" ")} failed`);
}

async function probe(endpoint: string): Promise<boolean> {
  const script = join(root, "probe.ts");
  await Bun.write(script, `const client = new Bun.S3Client({ bucket: ${JSON.stringify(bucket)}, endpoint: ${JSON.stringify(endpoint)}, accessKeyId: ${JSON.stringify(accessKeyId)}, secretAccessKey: ${JSON.stringify(secretAccessKey)}, region: "us-east-1" });\ntry { await client.write("readiness/probe.txt", "ok"); await client.unlink("readiness/probe.txt"); console.log("ready"); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }\n`);
  const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
  const [stdout, , code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return code === 0 && stdout.includes("ready");
}

try {
  let endpoint = Bun.env.QIY_S3_ENDPOINT;
  if (!externallyConfigured) {
    mkdirSync(join(data, bucket), { recursive: true });
    await run(["docker", "rm", "-f", container]).catch(() => undefined);
    await run(["docker", "run", "-d", "--name", container, "-p", `${hostPort}:9000`, "-e", `MINIO_ROOT_USER=${accessKeyId}`, "-e", `MINIO_ROOT_PASSWORD=${secretAccessKey}`, "-v", `${data}:/data`, "minio/minio:latest", "server", "/data"]);
    started = true;
    endpoint = `http://127.0.0.1:${hostPort}`;
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt++) {
      await Bun.sleep(1000);
      ready = await probe(endpoint);
    }
    if (!ready) throw new Error(`MinIO did not become ready at ${endpoint} with bucket ${bucket}`);
    console.log(`MinIO ready at ${endpoint} with bucket ${bucket}`);
  }
  const environment = {
    QIY_S3_BUCKET: bucket,
    QIY_S3_ENDPOINT: endpoint!,
    QIY_S3_ACCESS_KEY_ID: accessKeyId,
    QIY_S3_SECRET_ACCESS_KEY: secretAccessKey,
    QIY_S3_REGION: "us-east-1",
  };
  await run([process.execPath, "tools/verify-s3-storage.ts"], environment);
  await run([process.execPath, "tools/verify-s3-storage.ts", "--api"], environment);
  console.log(`S3-compatible acceptance passed against ${endpoint}`);
} finally {
  if (started) await run(["docker", "rm", "-f", container]).catch(() => undefined);
  if (!Bun.env.QIY_S3_KEEP) rmSync(root, { recursive: true, force: true });
  else console.log(`kept ${root}`);
}
