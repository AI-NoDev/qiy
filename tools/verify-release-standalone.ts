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
const realtimeAdminCli = readFileSync(join(realtimeOutput, "apps/server/src/realtime-admin.ts"), "utf8");
const realtimeEnvironment = readFileSync(join(realtimeOutput, "apps/server/.env.production"), "utf8");
assert(realtimeSchema.includes("deadLetteredAt") && realtimeSchema.includes("leaseOwner") && realtimeSchema.includes("leaseUntil"), "Realtime lease/dead-letter schema missing from executable output");
assert(realtimeRuntime.includes('/outbox/dead') && realtimeRuntime.includes('/outbox/metrics') && realtimeRuntime.includes('/outbox/metrics/prometheus') && realtimeRuntime.includes('/outbox/health') && realtimeRuntime.includes('/outbox/replay') && realtimeRuntime.includes('/outbox/:id/replay') && realtimeRuntime.includes('/outbox/delivered'), "Realtime administration routes missing from executable output");
assert(realtimeRuntime.includes("qiy_realtime_outbox_oldest_pending_age_seconds") && realtimeRuntime.includes("QIY_REALTIME_ALERT_MAX_DEAD_LETTERED"), "Realtime Prometheus metrics or alert thresholds missing from executable output");
assert(realtimeRuntime.includes('realtime.outbox.bulk_replayed') && realtimeRuntime.includes('realtime.outbox.cleaned'), "Realtime administration audit actions missing from executable output");
assert(realtimeAdminCli.includes("QIY_REALTIME_ADMIN_TOKEN is required") && realtimeAdminCli.includes('Authorization: `Bearer ${token}`'), "Authenticated Realtime operations CLI missing from executable output");
assert(JSON.parse(readFileSync(join(realtimeOutput, "apps/server/package.json"), "utf8")).scripts["realtime:admin"], "Realtime operations package command missing from executable output");
for (const key of ["QIY_REALTIME_LEASE_MS=30000", "QIY_REALTIME_MAX_ATTEMPTS=10", "QIY_REALTIME_RETENTION_DAYS=7", "QIY_REALTIME_CLEANUP_MS=86400000", "QIY_REALTIME_ALERT_MAX_PENDING=1000", "QIY_REALTIME_ALERT_MAX_DEAD_LETTERED=0", "QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS=300000"]) assert(realtimeEnvironment.includes(key), `Realtime environment default missing: ${key}`);
assert(realtimeEnvironment.includes("QIY_REALTIME_METRICS_TOKEN="), "Read-only metrics credential missing from executable output");
assert(readFileSync(join(realtimeOutput, "apps/server/tests/realtime.test.ts"), "utf8").includes("isolates and rotates read-only metrics credentials"), "Metrics credential isolation test missing from executable output");
const monitor = Bun.YAML.parse(readFileSync(join(realtimeOutput, "deploy/kubernetes/realtime-servicemonitor.yaml"), "utf8")) as any;
const service = Bun.YAML.parse(readFileSync(join(realtimeOutput, "deploy/kubernetes/service.yaml"), "utf8")) as any;
assert(monitor.spec.selector.matchLabels.app === service.metadata.labels.app, "Executable ServiceMonitor does not select its Service");
assert(monitor.spec.endpoints[0].authorization.credentials.key === "QIY_REALTIME_METRICS_TOKEN", "Executable ServiceMonitor uses incorrect credentials");
assert(service.spec.ports.some((port: any) => port.name === monitor.spec.endpoints[0].port), "Executable ServiceMonitor references a missing Service port");
const rules = Bun.YAML.parse(readFileSync(join(realtimeOutput, "deploy/kubernetes/realtime-prometheusrule.yaml"), "utf8")) as any;
assert(rules.spec.groups[0].rules.length === 3, "Executable monitoring alert rules missing");
assert(JSON.parse(readFileSync(join(realtimeOutput, "deploy/observability/grafana/qiy-realtime-outbox.json"), "utf8")).panels.length === 5, "Executable Grafana panels missing");
const installArgs = process.platform === "win32" ? ["install", "--linker", "hoisted"] : ["install"];
await run([process.execPath, ...installArgs], batchOutput);
await run([process.execPath, "run", "typecheck"], join(batchOutput, "apps/server"));
await run([process.execPath, "run", "test"], join(batchOutput, "apps/server"));
await run([process.execPath, ...installArgs], realtimeOutput);
await run([process.execPath, "run", "typecheck"], join(realtimeOutput, "apps/server"));
await run([process.execPath, "run", "test"], join(realtimeOutput, "apps/server"));
await run([process.execPath, ...installArgs], output);
for (const command of ["typecheck", "test", "build"]) await run([process.execPath, "run", command], output);
const webRoot = join(output, "apps/web");
assert(existsSync(join(webRoot, "build/client/index.html")), "Standalone SPA entry missing");
assert(!existsSync(join(webRoot, "build/server")), "Standalone build retained web server output");
await verifyGeneratedRuntime(output);
console.log(`Qiy executable ${expectedVersion}: anonymous realtime rejection, standalone, atomic batch and authenticated realtime operations create, clean install, typecheck/test/build passed in ${root}`);
