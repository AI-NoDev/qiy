import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyGeneratedRuntime } from "./verify-generated-runtime";

const executable = process.argv[2];
const expectedVersion = process.argv[3];
if (!executable || !expectedVersion) throw new Error("Usage: bun tools/verify-release-standalone.ts <executable> <version>");
const binary = resolve(executable);
const root = mkdtempSync(join(tmpdir(), "qiy-release-standalone-"));
const output = join(root, "admin");
const batchOutput = join(root, "batch-admin");
const realtimeOutput = join(root, "realtime-admin");
async function run(command: string[], cwd = root): Promise<string> {
  console.log(`Standalone acceptance: ${command.slice(1).join(" ")} (${cwd})`);
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return stdout.trim();
}
async function runRejected(command: string[], expectedMessage: string, cwd = root): Promise<void> {
  console.log(`Standalone rejection: ${command.slice(1).join(" ")} (${cwd})`);
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code === 0) throw new Error(`${command.join(" ")} unexpectedly succeeded\n${stdout}\n${stderr}`);
  if (!`${stdout}\n${stderr}`.includes(expectedMessage)) throw new Error(`${command.join(" ")} did not report ${JSON.stringify(expectedMessage)}\n${stdout}\n${stderr}`);
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
assert(await run([binary, "--version"]) === expectedVersion, "Executable version mismatch");
const anonymousRealtimeModel = join(root, "anonymous-realtime.qiy");
writeFileSync(anonymousRealtimeModel, `qiy v0;
application anonymous-realtime {
  database sqlite {}
  api { client rest; }
  realtime { mode auto; resource orders { events created; roles admin; } }
  entity orders { field id UUID @id; }
}
`);
await runRejected([binary, "create", "-f", anonymousRealtimeModel, "-n", "anonymous-realtime", "-o", join(root, "anonymous-realtime-admin")], "Realtime requires generated authentication");
await run([binary, "create", "-f", resolve(import.meta.dir, "../examples/dataflow/create-delete.qiy"), "-n", "release-standalone", "-o", output]);
const manifest = JSON.parse(readFileSync(join(output, ".qiy-generated.json"), "utf8"));
assert(manifest.qiyVersion === expectedVersion && manifest.mode === "standalone", "Standalone provenance mismatch");
assert(existsSync(join(output, "apps/server/src/storage/routes.ts")), "Storage routes missing from executable template");
assert(existsSync(join(output, "apps/server/tests/storage-metadata.test.ts")), "Database metadata regression test missing");
assert(existsSync(join(output, "apps/server/tests/qiy-scenarios.test.ts")), "Declarative app.test.qiy scenarios missing from executable output");
await run([binary, "create", "-f", resolve(import.meta.dir, "../examples/dataflow/batch-actions.qiy"), "-n", "release-batch", "-o", batchOutput]);
assert(readFileSync(join(batchOutput, "apps/server/src/dataflows/index.ts"), "utf8").includes('.post("/archiveReview/batch"'), "Atomic batch Dataflow route missing from executable output");
assert(readFileSync(join(batchOutput, "apps/server/src/graphql.ts"), "utf8").includes("runArchiveReviewBatch(items: [ArchiveReviewCommandInput!]!, idempotencyKey: String!): [Reviews!]!"), "Atomic batch GraphQL mutation missing from executable output");
assert(readFileSync(join(batchOutput, "apps/server/src/graphql-adapter.ts"), "utf8").includes("runArchiveReviewBatch:"), "Atomic batch GraphQL adapter resolver missing from executable output");
assert(readFileSync(join(batchOutput, "apps/web/app/routes/list.tsx"), "utf8").includes("<BatchBusinessActions"), "Batch Refine selection action missing from executable output");
assert(readFileSync(join(batchOutput, "apps/server/tests/dataflow.test.ts"), "utf8").includes("batch executes atomically"), "Generated atomic batch regression test missing from executable output");
await run([binary, "create", "-f", resolve(import.meta.dir, "../examples/realtime/app.qiy"), "-n", "release-realtime", "-o", realtimeOutput]);
const realtimeSchema = readFileSync(join(realtimeOutput, "apps/server/src/schema.ts"), "utf8");
const realtimeRuntime = readFileSync(join(realtimeOutput, "apps/server/src/realtime.ts"), "utf8");
const realtimeEnvironment = readFileSync(join(realtimeOutput, "apps/server/.env.production"), "utf8");
assert(realtimeSchema.includes("qiy_realtime_outbox_created_idx") && !realtimeSchema.slice(realtimeSchema.indexOf('"qiy_realtime_outbox"'), realtimeSchema.indexOf("qiy_realtime_outbox_created_idx")).includes("leaseOwner"), "Realtime event log schema missing from executable output");
assert(realtimeRuntime.includes('"/stream"') && realtimeRuntime.includes("event: ready") && realtimeRuntime.includes("realtimeChannelIterator"), "Realtime SSE stream missing from executable output");
assert(!existsSync(join(realtimeOutput, "apps/server/src/realtime-admin.ts")), "Removed realtime admin CLI still generated");
for (const key of ["QIY_REALTIME_POLL_MS=1000", "QIY_REALTIME_RETENTION_DAYS=1", "QIY_REALTIME_CLEANUP_MS=3600000"]) assert(realtimeEnvironment.includes(key), `Realtime environment default missing: ${key}`);
for (const key of ["QIY_ABLY_API_KEY", "QIY_REALTIME_METRICS_TOKEN", "QIY_REALTIME_LEASE_MS"]) assert(!realtimeEnvironment.includes(key), `Removed realtime environment key still generated: ${key}`);
for (const file of ["deploy/kubernetes/realtime-servicemonitor.yaml", "deploy/kubernetes/realtime-prometheusrule.yaml", "deploy/observability/grafana/qiy-realtime-outbox.json"]) assert(!existsSync(join(realtimeOutput, file)), `Removed realtime monitoring artifact still generated: ${file}`);
assert(readFileSync(join(realtimeOutput, "apps/server/tests/realtime.test.ts"), "utf8").includes("streams only the channels granted to the caller"), "Realtime channel isolation test missing from executable output");
const installArgs = process.platform === "win32" ? ["install", "--linker", "hoisted"] : ["install"];
await run([process.execPath, ...installArgs], batchOutput);
await run([process.execPath, "run", "typecheck"], join(batchOutput, "apps/server"));
await run([process.execPath, "test", "--timeout", "30000"], join(batchOutput, "apps/server"));
await run([process.execPath, ...installArgs], realtimeOutput);
await run([process.execPath, "run", "typecheck"], join(realtimeOutput, "apps/server"));
await run([process.execPath, "test", "--timeout", "30000"], join(realtimeOutput, "apps/server"));
await run([process.execPath, ...installArgs], output);
for (const command of ["typecheck", "test", "build"]) await run([process.execPath, "run", command], output);
const webRoot = join(output, "apps/web");
assert(existsSync(join(webRoot, "build/client/index.html")), "Standalone SPA entry missing");
assert(!existsSync(join(webRoot, "build/server")), "Standalone build retained web server output");
await verifyGeneratedRuntime(output);
console.log(`Qiy executable ${expectedVersion}: anonymous realtime rejection, standalone, atomic batch and authenticated realtime operations create, clean install, typecheck/test/build passed in ${root}`);
