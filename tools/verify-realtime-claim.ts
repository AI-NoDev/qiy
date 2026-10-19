import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for claim-scoped realtime channels. A resource that declares
 * `when <field> claim <claim>` publishes to `qiy:<table>:<value>` and only grants
 * subscribers that segment, so one shared deployment isolates tenants per row.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-realtime-claim-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "claim.sqlite");

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number; output: string }> {
  const [executable = "bun", ...args] = command;
  const child = Bun.spawn([executable === "bun" ? process.execPath : executable, ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, output: stdout + stderr };
}
async function must(command: string[], cwd: string, env: Record<string, string> = {}): Promise<string> {
  const result = await run(command, cwd, env);
  if (result.code !== 0) throw new Error(`${command.join(" ")} failed (${result.code}) in ${cwd}:\n${result.output}`);
  return result.output;
}

writeFileSync(join(root, "app.qiy"), `qiy v0;
application realtime-claim {
  database sqlite {}
  api { client graphql; }
  realtime {
    mode auto;
    resource orders {
      events created, updated;
      roles admin, operator;
      when tenantId claim tenant;
    }
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
    field tenantId Text;
    field salary Integer @nullable;
  }
  restrict orders { allow roles admin, operator; mask salary roles operator mode omit; }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "claim.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { orders, realtimeOutbox } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";
import { databaseOutboxStore, dispatchRealtimeOutbox, publishRealtime, realtimeCapabilities, realtimeChannel } from "./src/realtime";

delete Bun.env.QIY_REALTIME_DISABLED;
Bun.env.QIY_REALTIME_SUBSCRIBE_POLL_MS = "150";
Bun.env.QIY_REALTIME_LEASE_MS = "1000";

const published: Array<{ channel: string; type: string }> = [];
const fakeAbly = (() => ({ channels: { get: (channel: string) => ({ publish: async (type: string) => { published.push({ channel, type }); } }) } })) as never;
type Claims = Record<string, string>;
const as = (role: "admin" | "operator" | "viewer", claims: Claims) => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims });
const app = (role: "admin" | "operator" | "viewer", claims: Claims = { tenant: "eu" }) => createApp({ users: UsersRepository, orders: OrdersRepository }, as(role, claims));
const subscribeUrl = (query: string) => "http://localhost/graphql/subscribe?query=" + encodeURIComponent(query);

async function nextFrame(response: Response, timeoutMs = 4000): Promise<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.indexOf("\\n\\n");
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        const data = frame.split("\\n").find((line) => line.startsWith("data: "));
        if (data) return JSON.parse(data.slice(6)) as Record<string, unknown>;
      }
    }
    throw new Error("No frame received: " + JSON.stringify(buffer));
  } finally { await reader.cancel().catch(() => undefined); }
}

test("grants only the caller's claim segment", async () => {
  expect(realtimeChannel("orders", "eu")).toBe("qiy:orders:eu");
  const principal = (role: "admin" | "operator" | "viewer", claims: Claims) => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims }) as never;
  expect(Object.keys(realtimeCapabilities(principal("operator", { tenant: "eu" })))).toEqual(["qiy:orders:eu"]);
  expect(Object.keys(realtimeCapabilities(principal("operator", {})))).toEqual([]);
  expect(Object.keys(realtimeCapabilities(principal("viewer", { tenant: "eu" })))).toEqual([]);
});

test("publishes and stores per-segment channels", async () => {
  await OrdersRepository.create({ title: "eu-order", tenantId: "eu", salary: 11 }, "actor");
  const rows = await db.select().from(realtimeOutbox);
  expect(rows.map((row) => row.channel)).toEqual(["qiy:orders:eu"]);
  // A record without the claim value cannot be addressed to a segment.
  await db.delete(realtimeOutbox);
  await publishRealtime("orders", "created", { id: "x", title: "no tenant" }, fakeAbly);
  expect(published).toEqual([]);
  await dispatchRealtimeOutbox(10, fakeAbly, databaseOutboxStore, "worker");
});

test("streams only the caller's tenant over GraphQL subscriptions", async () => {
  await db.delete(realtimeOutbox);
  const operator = await app("operator", { tenant: "eu" });
  const response = await operator.handle(new Request(subscribeUrl("subscription { ordersChanged { event record { id title tenantId salary } } }"), { headers: { "x-test-user": "operator" } }));
  expect(response.status).toBe(200);
  await Bun.sleep(250);

  // An eu row reaches this subscriber; a us row published on its own segment does not.
  const eu = await OrdersRepository.create({ title: "streamed-eu", tenantId: "eu", salary: 7 }, "actor");
  const us = await OrdersRepository.create({ title: "streamed-us", tenantId: "us", salary: 9 }, "admin");
  expect(await dispatchRealtimeOutbox(10, fakeAbly, databaseOutboxStore, "worker")).toMatchObject({ delivered: 2 });
  expect((await db.select().from(realtimeOutbox)).map((row) => row.channel).sort()).toEqual(["qiy:orders:eu", "qiy:orders:us"]);

  const frame = await nextFrame(response);
  const payload = (frame.data as Record<string, unknown>).ordersChanged as { event: string; record: Record<string, unknown> };
  expect(payload.event).toBe("created");
  expect(payload.record.id).toBe(eu!.id);
  expect(payload.record.tenantId).toBe("eu");
  expect(payload.record.salary).toBeNull();
  expect(published.map((item) => item.channel).sort()).toEqual(["qiy:orders:eu", "qiy:orders:us"]);
  expect(us!.id).not.toBe(eu!.id);
});

test("refuses subscriptions without the claim", async () => {
  const anonymousClaim = await app("operator", {});
  const denied = await anonymousClaim.handle(new Request(subscribeUrl("subscription { ordersChanged { event } }"), { headers: { "x-test-user": "operator" } }));
  expect(denied.status).toBe(403);
  const viewer = await app("viewer", { tenant: "eu" });
  expect((await viewer.handle(new Request(subscribeUrl("subscription { ordersChanged { event } }"), { headers: { "x-test-user": "viewer" } }))).status).toBe(403);
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "claim.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  // The browser live provider resolves the segmented channel from the token capability.
  const web = join(admin, "apps/web");
  console.log(await must(["bun", "run", "typecheck"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "test"], web, { DATABASE_URL: ":memory:" }));
  console.log(`realtime claim acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
