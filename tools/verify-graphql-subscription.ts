import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for the SSE realtime transport: a real write lands in the
 * outbox, the shared poller fans it out, and both the REST event stream and the
 * GraphQL subscription stream it to the caller with field masks applied.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-graphql-subscription-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "subscription.sqlite");

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
application subscription {
  database sqlite {}
  api { client graphql; }
  realtime { mode auto; resource orders { events created, updated; roles admin, operator; } }
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
    field salary Integer @nullable;
  }
  restrict orders { allow roles admin, operator; mask salary roles operator mode omit; }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "subscription.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { orders, realtimeOutbox } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";
import { pollRealtimeOutbox } from "./src/realtime";

delete Bun.env.QIY_REALTIME_DISABLED;
Bun.env.QIY_REALTIME_POLL_MS = "150";

const as = (role: "admin" | "operator" | "viewer") => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims: {} });
const app = (role: "admin" | "operator" | "viewer") => createApp({ users: UsersRepository, orders: OrdersRepository }, as(role));
const subscribeUrl = (query: string) => "http://localhost/graphql/subscribe?query=" + encodeURIComponent(query);

async function nextFrame(response: Response, timeoutMs = 4000, skip: (frame: string) => boolean = () => false): Promise<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\\n\\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = frame.split("\\n").find((line) => line.startsWith("data: "));
        if (data && !skip(frame)) return JSON.parse(data.slice(6)) as Record<string, unknown>;
        index = buffer.indexOf("\\n\\n");
      }
    }
    throw new Error("No subscription frame received: " + JSON.stringify(buffer));
  } finally { await reader.cancel().catch(() => undefined); }
}

test("streams a created event and applies field masks", async () => {
  const operator = await app("operator");
  const response = await operator.handle(new Request(subscribeUrl("subscription { ordersChanged { event record { id title salary } } }"), { headers: { "x-test-user": "operator" } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");

  // A real write followed by a real outbox read reaches the in-process bus.
  const created = await OrdersRepository.create({ title: "streamed", salary: 99 }, "actor");
  expect((await db.select().from(realtimeOutbox)).length).toBe(1);
  await pollRealtimeOutbox();

  const frame = await nextFrame(response);
  const payload = (frame.data as Record<string, unknown>).ordersChanged as { event: string; record: Record<string, unknown> };
  expect(payload.event).toBe("created");
  expect(payload.record.id).toBe(created!.id);
  expect(payload.record.title).toBe("streamed");
  // salary is masked for operators: the published payload has no key at all, and the
  // GraphQL response can only return null for the explicitly requested field.
  expect(payload.record.salary).toBeNull();
  const storedPayloads = (await db.select().from(realtimeOutbox)).map((row) => row.payload).join(" ");
  expect(storedPayloads).not.toContain("salary");
});

test("streams granted channels over the REST event stream with masks applied", async () => {
  const operator = await app("operator");
  const response = await operator.handle(new Request("http://localhost/api/v1/realtime/stream", { headers: { "x-test-user": "operator" } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const created = await OrdersRepository.create({ title: "rest stream", salary: 7 }, "actor");
  await pollRealtimeOutbox();
  const frame = await nextFrame(response, 4000, (raw) => raw.startsWith("event: ready"));
  expect(frame.channel).toBe("qiy:orders");
  expect(frame.event).toBe("created");
  expect((frame.record as Record<string, unknown>).id).toBe(created!.id);
  expect(frame.record as Record<string, unknown>).not.toHaveProperty("salary");
  const viewer = await app("viewer");
  expect((await viewer.handle(new Request("http://localhost/api/v1/realtime/stream", { headers: { "x-test-user": "viewer" } }))).status).toBe(403);
});

test("enforces subscription permissions and rejects non-subscription documents", async () => {
  const viewer = await app("viewer");
  const forbidden = await viewer.handle(new Request(subscribeUrl("subscription { ordersChanged { event } }"), { headers: { "x-test-user": "viewer" } }));
  expect(forbidden.status).toBe(403);
  expect((await forbidden.json() as { error?: string }).error).toContain("not permitted");

  const anonymous = await (await createApp({ users: UsersRepository, orders: OrdersRepository })).handle(new Request(subscribeUrl("subscription { ordersChanged { event } }")));
  expect(anonymous.status).toBe(401);

  const operator = await app("operator");
  expect((await operator.handle(new Request(subscribeUrl("subscription { unknownField }"), { headers: { "x-test-user": "operator" } }))).status).toBe(400);
  const query = await operator.handle(new Request(subscribeUrl("{ orders { total } }"), { headers: { "x-test-user": "operator" } }));
  expect(query.status).toBe(400);
  const malformed = await operator.handle(new Request(subscribeUrl("subscription {"), { headers: { "x-test-user": "operator" } }));
  expect(malformed.status).toBe(400);
});

test("exposes the subscription root in the generated schema", async () => {
  const { graphqlTypeDefs } = await import("./src/graphql");
  expect(graphqlTypeDefs).toContain("type Subscription {");
  expect(graphqlTypeDefs).toContain("ordersChanged: OrdersEvent!");
  expect(graphqlTypeDefs).toContain("type OrdersEvent {");
});

test("receives events delivered by another replica through the outbox tail", async () => {
  {
    const operator = await app("operator");
    const response = await operator.handle(new Request(subscribeUrl("subscription { ordersChanged { event record { title } } }"), { headers: { "x-test-user": "operator" } }));
    expect(response.status).toBe(200);
    // Give the poller time to start, then insert a row as another replica would:
    // nothing on this instance calls pollRealtimeOutbox, so only the tail sees it.
    await Bun.sleep(250);
    await db.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: "qiy:orders", type: "updated", payload: JSON.stringify({ id: "remote-1", title: "remote" }), createdAt: new Date() });
    const frame = await nextFrame(response, 4000);
    const payload = (frame.data as Record<string, unknown>).ordersChanged as { event: string; record: Record<string, unknown> };
    expect(payload.event).toBe("updated");
    expect(payload.record.title).toBe("remote");
  }
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "subscription.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl, QIY_TEST_DATABASE_URL: databaseUrl }));
  // The web client half of the transport must compile and parse the SSE frames.
  const web = join(admin, "apps/web");
  console.log(await must(["bun", "run", "typecheck"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "run", "build"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "test"], web, { DATABASE_URL: ":memory:" }));
  console.log(`graphql subscription acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
