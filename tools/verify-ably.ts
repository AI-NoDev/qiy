import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real Ably acceptance. Ably has no local server, so this runs only when
 * QIY_ABLY_API_KEY is present (create a free app at https://ably.com and copy the
 * API key). Without it the script explains what would be verified and exits 0.
 */
const apiKey = Bun.env.QIY_ABLY_API_KEY;
if (!apiKey) {
  console.log(`Ably real-service acceptance: SKIPPED (no QIY_ABLY_API_KEY).

How to run it for real:
  1. Create a free Ably app at https://ably.com (or reuse one).
  2. Copy its API key (format "<app id>.<key id>:<secret>").
  3. Set the key and rerun:
       $env:QIY_ABLY_API_KEY="<your key>"
       bun run tools/verify-ably.ts
  In bash: QIY_ABLY_API_KEY="<your key>" bun run tools/verify-ably.ts

What it verifies against Ably:
  - the generated publisher writes to the real "qiy:orders" channel (Ably REST);
  - an Ably REST reader sees that message in channel history;
  - the generated /api/v1/realtime/token endpoint mints a subscribe-only capability
    token, which can read history but is refused when publishing (40160);
  - publishing with an invalid key is rejected.
`);
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), "qiy-ably-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "ably.sqlite");
const channel = "qiy:orders";

async function run(command: string[], options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<{ code: number; output: string }> {
  // Resolve the runtime by path: child processes may not inherit the `bun` PATH entry on Windows.
  const executable = command[0] === "bun" ? process.execPath : command[0]!;
  const child = Bun.spawn([executable, ...command.slice(1)], { cwd: options.cwd ?? root, env: { ...process.env, ...(options.env ?? {}) }, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 300_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, output: stdout + stderr };
  } finally { clearTimeout(timer); }
}
async function must(command: string[], options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<string> {
  const result = await run(command, options);
  if (result.code !== 0) throw new Error(`${command.join(" ")} failed (${result.code}):\n${result.output.slice(-3000)}`);
  return result.output;
}

writeFileSync(join(root, "app.qiy"), `qiy v0;
application ably-real {
  database sqlite {}
  api { client rest; }
  realtime {
    mode auto;
    resource orders { events created, updated; roles admin, operator; }
  }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }
  entity orders {
    field id UUID @id;
    field title Text;
  }
}
`);

let failures = 0;
const check = (label: string, condition: boolean) => {
  if (condition) console.log("  ok   " + label);
  else { failures += 1; console.log("  FAIL " + label); }
};

try {
  console.log(`workspace ${root}`);
  await generateApp(join(root, "app.qiy"), admin);
  await must(["bun", "install"], { cwd: admin });
  await must(["bun", "run", "db:generate"], { cwd: server, env: { DATABASE_URL: databaseUrl } });
  await must(["bun", "run", "db:migrate"], { cwd: server, env: { DATABASE_URL: databaseUrl } });

  writeFileSync(join(server, "ably.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { Rest } from "ably";
import { createApp } from "./src/app";
import { publishRealtime } from "./src/realtime";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const key = process.env.QIY_ABLY_API_KEY!;\n// The generated test setup disables external realtime calls; this acceptance wants them.\ndelete Bun.env.QIY_REALTIME_DISABLED;
const channel = ${JSON.stringify(channel)};
const admin = { id: "00000000-0000-4000-8000-000000000001", name: "admin", role: "admin" as const };
const operator = { id: "00000000-0000-4000-8000-000000000002", name: "operator", role: "operator" as const };
let current = admin;
const app = () => createApp({ users: UsersRepository, orders: OrdersRepository }, (async () => current) as never);

test("publishes to real Ably and reads the message from history", async () => {
  const marker = "ably-real-" + Date.now();
  await publishRealtime("orders", "created", { id: marker, title: marker });
  const reader = new Rest({ key });
  const history = await reader.channels.get(channel).history({ limit: 20 });
  expect(history.items.some((item) => JSON.stringify(item.data).includes(marker))).toBe(true);
}, 30_000);

test("generated token endpoint mints a subscribe-only capability", async () => {
  const response = await (await app()).handle(new Request("http://localhost/api/v1/realtime/token", { method: "POST" }));
  expect(response.status).toBe(200);
  const tokenRequest = await response.json() as Record<string, unknown>;
  expect(Object.keys(tokenRequest).length).toBeGreaterThan(0);
  // Ably authCallback is node-style: callback(error, tokenRequest).
  const restricted = new Rest({ authCallback: ((_data: unknown, callback: (error: Error | null, request: unknown) => void) => callback(null, tokenRequest)) as never });
  // The minted capability is subscribe-only for the granted channel.
  const capability = JSON.parse(String((tokenRequest as { capability?: string }).capability));
  expect(capability[channel]).toEqual(["subscribe"]);
  // Publishing is not in the capability, so Ably must reject it (40160).
  await expect(restricted.channels.get(channel).publish("probe", { ok: false })).rejects.toThrow(/Unauthorized to publish|not permitted/i);
  // Channels outside the capability are rejected as well.
  await expect(restricted.channels.get("qiy:other").publish("probe", { ok: false })).rejects.toThrow(/Unauthorized to publish|not permitted/i);
}, 30_000);

test("a viewer cannot request a realtime token", async () => {
  current = { id: "00000000-0000-4000-8000-000000000003", name: "viewer", role: "viewer" as const };
  const response = await (await app()).handle(new Request("http://localhost/api/v1/realtime/token", { method: "POST" }));
  expect(response.status).toBe(403);
  current = admin;
}, 20_000);
`);

  const tests = await must(["bun", "test", "--preload", "./tests/setup.ts", "ably.acceptance.test.ts"], {
    cwd: server,
    env: { DATABASE_URL: databaseUrl, QIY_ABLY_API_KEY: apiKey },
    timeoutMs: 600_000,
  });
  console.log(tests);
  check("real Ably publish/history/capability acceptance passed", tests.includes("0 fail"));
} finally {
  console.log(failures === 0 ? "Ably real-service acceptance passed: " + root : "Ably real-service acceptance FAILED");
  if (failures > 0) process.exit(1);
}
