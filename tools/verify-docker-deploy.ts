import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real container deployment acceptance: generate a PostgreSQL app, build a Docker
 * image of the workspace, migrate and serve it against a containerised database,
 * then probe it over the container network.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-docker-deploy-"));
const admin = join(root, "admin");
const workspace = join(root, "deploy");
const network = "qiy-deploy-net";
const dbContainer = "qiy-deploy-pg";
const appContainer = "qiy-deploy-app";
const image = "qiy-deploy-app:acceptance";
const probeImage = "oven/bun:1.3.13";
const databaseName = "qiy_deploy";
const databaseUrl = `postgres://postgres:qiydeploy@${dbContainer}:5432/${databaseName}`;

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
  if (result.code !== 0) throw new Error(`${command.join(" ")} failed (${result.code}):\n${result.output.slice(-2000)}`);
  return result.output;
}

writeFileSync(join(root, "app.qiy"), `qiy v0;
application docker-deploy {
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
// Move the generated tree one level down so `deploy` is the build context.
await must(["cmd", "/c", "move", admin, workspace]);
writeFileSync(join(workspace, "Dockerfile"), `FROM oven/bun:1.3.13
WORKDIR /app
COPY . .
RUN bun install
RUN cd apps/server && bun run db:generate
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "cd apps/server && bun src/db-migrate.ts && QIY_AUTH_SECRET=acceptance-secret-for-docker-0001 bun src/server.ts"]
`);

let failures = 0;
const check = (label: string, condition: boolean) => {
  if (condition) console.log("  ok   " + label);
  else { failures += 1; console.log("  FAIL " + label); }
};

try {
  await run(["docker", "rm", "-f", dbContainer, appContainer]);
  await run(["docker", "rmi", "-f", image]);
  await run(["docker", "network", "rm", network]);
  await must(["docker", "network", "create", network]);
  await must(["docker", "run", "-d", "--name", dbContainer, "--network", network, "-e", "POSTGRES_PASSWORD=qiydeploy", "-e", `POSTGRES_DB=${databaseName}`, "postgres:16-alpine"]);
  console.log("database container started");
  console.log(await must(["docker", "build", "-t", image, "."], { cwd: workspace, timeoutMs: 900_000 }));
  console.log("application image built");

  console.log(await must(["docker", "run", "-d", "--name", appContainer, "--network", network, "-e", `DATABASE_URL=${databaseUrl}`, "-e", "PORT=3000", "-e", "HOST=0.0.0.0", "-e", "QIY_STORAGE_METADATA=database", "-e", "QIY_STORAGE_PROVIDER=local", "-e", "QIY_STORAGE_ROOT=./storage", image]));
  // The entrypoint migrates before serving, so wait for readiness with a probe container.
  const probe = [
    "docker", "run", "--rm", "--network", network, probeImage, "bun", "-e",
    `const deadline = Date.now() + 120000; for (;;) { try { const response = await fetch("http://${appContainer}:3000/api/v1/health"); if (response.ok) { console.log("health", response.status, await response.text()); process.exit(0); } } catch {} if (Date.now() > deadline) { console.error("timeout"); process.exit(1); } await Bun.sleep(1000); }`,
  ];
  const health = await must(probe, { timeoutMs: 180_000 });
  check("container serves a healthy API", health.includes("health 200"));

  const anonymous = await must([
    "docker", "run", "--rm", "--network", network, probeImage, "bun", "-e",
    `const response = await fetch("http://${appContainer}:3000/api/v1/notes"); console.log("status", response.status);`,
  ], { timeoutMs: 120_000 });
  check("anonymous REST access is rejected", anonymous.includes("status 401"));

  const login = await must([
    "docker", "run", "--rm", "--network", network, probeImage, "bun", "-e",
    `const response = await fetch("http://${appContainer}:3000/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@example.com", password: "wrong" }) }); console.log("status", response.status);`,
  ], { timeoutMs: 120_000 });
  check("login rejects unknown credentials", /status 4\d\d/.test(login));

  const logs = await run(["docker", "logs", appContainer]);
  check("migration ran inside the container", /migrat|matches src\/schema/i.test(logs.output));
} finally {
  await run(["docker", "rm", "-f", appContainer, dbContainer]);
  await run(["docker", "rmi", "-f", image]);
  await run(["docker", "network", "rm", network]);
  console.log(failures === 0 ? "docker deploy acceptance passed: " + root : "docker deploy acceptance FAILED");
  if (failures > 0) process.exit(1);
}
