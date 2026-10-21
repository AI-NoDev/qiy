import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real Kubernetes acceptance: generate a PostgreSQL app, build its image, start a
 * single-node k3s cluster in Docker, import the images, deploy the generated
 * manifests and probe the running pod.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-k8s-"));
const admin = join(root, "admin");
const workspace = join(root, "workspace");
const k3s = "qiy-k3s";
const image = "qiy-k8s-app:acceptance";
const appName = "k8s-demo";
const namespace = "qiy-k8s";
const k3sVersion = "v1.31.4-k3s1";

async function run(command: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<{ code: number; output: string }> {
  const child = Bun.spawn(command, { cwd: options.cwd ?? root, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 300_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, output: stdout + stderr };
  } finally { clearTimeout(timer); }
}
async function must(command: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  const result = await run(command, options);
  if (result.code !== 0) throw new Error(`${command.join(" ")} failed (${result.code}):\n${result.output.slice(-2500)}`);
  return result.output;
}
const kube = (args: string[], timeoutMs = 180_000) => must(["docker", "exec", k3s, "kubectl", ...args], { timeoutMs });

writeFileSync(join(root, "app.qiy"), `qiy v0;
application ${appName} {
  database postgresql {}
  api { client rest; }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }
  entity notes {
    field id UUID @id;
    field title Text;
    field body Text @nullable;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);
await must(["cmd", "/c", "move", admin, workspace]);
writeFileSync(join(workspace, "Dockerfile"), `FROM oven/bun:1.3.13
WORKDIR /app
COPY . .
RUN bun install
RUN cd apps/server && bun run db:generate
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "cd apps/server && bun src/db-migrate.ts && QIY_AUTH_SECRET=acceptance-secret-for-k8s-cluster-0001 bun src/server.ts"]
`);

let failures = 0;
const check = (label: string, condition: boolean) => {
  if (condition) console.log("  ok   " + label);
  else { failures += 1; console.log("  FAIL " + label); }
};

try {
  await run(["docker", "rm", "-f", k3s]);
  await run(["docker", "rm", "-f", "qiy-k8s-pg"]);
  await run(["docker", "rmi", "-f", image]);
  console.log(await must(["docker", "build", "-t", image, "."], { cwd: workspace, timeoutMs: 900_000 }));
  console.log("application image built");

  console.log(await must(["docker", "run", "-d", "--name", k3s, "--privileged", "rancher/k3s:" + k3sVersion, "server", "--disable", "traefik", "--disable", "metrics-server"], { timeoutMs: 300_000 }));
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    const nodes = await run(["docker", "exec", k3s, "kubectl", "get", "nodes", "--no-headers"]);
    if (nodes.code === 0 && nodes.output.includes(" Ready")) { ready = true; break; }
    await Bun.sleep(2000);
  }
  check("k3s node is ready", ready);
  if (!ready) { console.log("k3s container: " + (await run(["docker", "ps", "-a", "--filter", "name=" + k3s])).output); console.log("k3s logs:\n" + (await run(["docker", "logs", k3s], { timeoutMs: 60000 })).output.slice(-3000)); }
  if (!ready) throw new Error("k3s cluster did not become ready");

  // Preload the k3s system images: the k3s container cannot reach Docker Hub, so the
  // host pulls them and they are imported through the containerd binary.
  for (const imageRef of ["rancher/mirrored-pause:3.6", "rancher/mirrored-coredns-coredns:1.12.0", "rancher/local-path-provisioner:v0.0.30", "rancher/mirrored-library-busybox:1.36.1"]) {
    await must(["docker", "pull", imageRef], { timeoutMs: 600_000 });
  }
  await must(["docker", "save", "-o", join(root, "system.tar"), "rancher/mirrored-pause:3.6", "rancher/mirrored-coredns-coredns:1.12.0", "rancher/local-path-provisioner:v0.0.30", "rancher/mirrored-library-busybox:1.36.1"], { timeoutMs: 600_000 });
  await must(["docker", "cp", join(root, "system.tar"), k3s + ":/tmp/system.tar"]);
  await must(["docker", "exec", k3s, "/bin/ctr", "-n", "k8s.io", "images", "import", "/tmp/system.tar"], { timeoutMs: 900_000 });
  await Bun.sleep(5000);
  for (let attempt = 0; attempt < 60; attempt++) {
    const pods = await run(["docker", "exec", k3s, "kubectl", "get", "pods", "-n", "kube-system", "--no-headers"]);
    if (pods.code === 0 && pods.output.includes("Running") && !pods.output.includes("ContainerCreating")) break;
    await Bun.sleep(2000);
  }

  // Import the application and database images into the k3s containerd store.
  await must(["docker", "save", "-o", join(root, "app.tar"), image]);
  await must(["docker", "cp", join(root, "app.tar"), k3s + ":/tmp/app.tar"]);
  await must(["docker", "exec", k3s, "/bin/ctr", "-n", "k8s.io", "images", "import", "/tmp/app.tar"], { timeoutMs: 900_000 });
  console.log("images imported into k3s");

  await run(["docker", "rm", "-f", "qiy-k8s-pg"]);
  await must(["docker", "run", "-d", "--name", "qiy-k8s-pg", "-p", "55433:5432", "-e", "POSTGRES_PASSWORD=qiyk8s", "-e", "POSTGRES_DB=qiy_k8s", "postgres:16-alpine"], { timeoutMs: 300_000 });
  let databaseReady = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const ping = await run(["docker", "exec", "qiy-k8s-pg", "pg_isready", "-U", "postgres"]);
    if (ping.code === 0) { databaseReady = true; break; }
    await Bun.sleep(2000);
  }
  check("host database is ready", databaseReady);
  if (!databaseReady) throw new Error("postgres did not become ready");

  await kube(["create", "namespace", namespace]);

  // Pods reach the host database through Docker Desktop's internal gateway.
  const databaseUrl = `postgres://postgres:qiyk8s@host.docker.internal:55433/qiy_k8s`;
  await kube(["create", "secret", "generic", appName, "-n", namespace,
    `--from-literal=DATABASE_URL=${databaseUrl}`,
    "--from-literal=QIY_STORAGE_PROVIDER=local",
    "--from-literal=QIY_AUTH_SECRET=acceptance-secret-for-k8s-cluster-0001",
    "--from-literal=QIY_OIDC_ISSUER=",
    "--from-literal=QIY_OIDC_AUDIENCE=",
    "--from-literal=QIY_OIDC_JWKS_URL=",
    "--from-literal=QIY_S3_BUCKET=",
    "--from-literal=QIY_S3_REGION=",
    "--from-literal=QIY_S3_ENDPOINT=",
    "--from-literal=QIY_S3_ACCESS_KEY_ID=",
    "--from-literal=QIY_S3_SECRET_ACCESS_KEY=",
  ]);

  // Apply the generated manifests with only the local image substituted.
  const manifestDir = join(workspace, "deploy", "kubernetes");
  const deployment = (await Bun.file(join(manifestDir, "deployment.yaml")).text())
    .replace(`${appName}:latest`, `${image}\n          imagePullPolicy: Never`);
  writeFileSync(join(root, "deployment.yaml"), deployment);
  for (const file of ["persistent-volume-claim.yaml", "service.yaml"]) {
    writeFileSync(join(root, file), await Bun.file(join(manifestDir, file)).text());
  }
  for (const file of ["deployment.yaml", "persistent-volume-claim.yaml", "service.yaml"]) {
    await must(["docker", "cp", join(root, file), `${k3s}:/tmp/${file}`]);
  }
  await kube(["apply", "-n", namespace, "-f", "/tmp/persistent-volume-claim.yaml", "-f", "/tmp/deployment.yaml", "-f", "/tmp/service.yaml"]);
  try { await kube(["rollout", "status", "deployment/" + appName, "-n", namespace, "--timeout=300s"], 360_000); } catch (error) { console.log("pods:\n" + (await run(["docker", "exec", k3s, "kubectl", "get", "pods", "-n", namespace, "-o", "wide"])).output); console.log("describe:\n" + (await run(["docker", "exec", k3s, "kubectl", "describe", "deployment", appName, "-n", namespace])).output.slice(-2500)); const podNames = (await run(["docker", "exec", k3s, "kubectl", "get", "pods", "-n", namespace, "--no-headers"])).output.split(/\s+/)[0]; console.log("pod describe:\n" + (await run(["docker", "exec", k3s, "kubectl", "describe", "pod", "-n", namespace, podNames ?? ""])).output.slice(-3000)); console.log("pvc:\n" + (await run(["docker", "exec", k3s, "kubectl", "describe", "pvc", "-n", namespace])).output.slice(-1800)); console.log("provisioner logs:\n" + (await run(["docker", "exec", k3s, "kubectl", "logs", "-n", "kube-system", "-l", "app=local-path-provisioner", "--tail=30"])).output.slice(-2000)); console.log("logs:\n" + (await run(["docker", "exec", k3s, "kubectl", "logs", "-n", namespace, podNames ?? ""])).output.slice(-2000)); throw error; }

  const pods = await kube(["get", "pods", "-n", namespace, "-l", "app=" + appName, "-o", "jsonpath={.items[*].status.phase}"]);
  check("generated deployment pod is running", pods.includes("Running"));
  const claims = await kube(["get", "pvc", "-n", namespace, "-o", "jsonpath={.items[*].status.phase}"]);
  check("generated PVC is bound (ReadWriteOnce works on default storage)", claims.includes("Bound"));

  const health = await kube(["exec", "-n", namespace, "deploy/" + appName, "--", "bun", "-e",
    `const response = await fetch("http://127.0.0.1:3000/api/v1/health"); console.log("status", response.status, await response.text());`], 120_000);
  check("pod serves a healthy API", health.includes("status 200"));
  const anonymous = await kube(["exec", "-n", namespace, "deploy/" + appName, "--", "bun", "-e",
    `const response = await fetch("http://127.0.0.1:3000/api/v1/notes"); console.log("status", response.status);`], 120_000);
  check("anonymous REST access is rejected", anonymous.includes("status 401"));
  const logs = await kube(["logs", "-n", namespace, "deploy/" + appName], 120_000);
  check("migration ran inside the pod", /migrat|matches src\/schema/i.test(logs));
  check("service is deployed", (await kube(["get", "service", appName, "-n", namespace])).includes(appName));
  check("replicas are available", (await kube(["get", "deployment", appName, "-n", namespace, "-o", "jsonpath={.status.availableReplicas}"])).trim().length > 0);
} finally {
  await run(["docker", "rm", "-f", k3s]);
  await run(["docker", "rmi", "-f", image]);
  console.log(failures === 0 ? "k8s deploy acceptance passed: " + root : "k8s deploy acceptance FAILED");
  if (failures > 0) process.exit(1);
}
