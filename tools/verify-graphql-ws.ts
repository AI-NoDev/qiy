import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for the graphql-ws WebSocket transport. The generated GraphQL
 * server must accept connection_init with a bearer token, subscribe to a realtime
 * root field and stream events, while rejecting unauthenticated connections.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-graphql-ws-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "ws.sqlite");

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
application graphql-ws {
  database sqlite {}
  api { client graphql; }
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

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "graphql-ws.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { orders, realtimeOutbox } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";
import { databaseOutboxStore, dispatchRealtimeOutbox } from "./src/realtime";

delete Bun.env.QIY_REALTIME_DISABLED;
Bun.env.QIY_REALTIME_SUBSCRIBE_POLL_MS = "100";
Bun.env.QIY_REALTIME_LEASE_MS = "1000";

const authenticate = async (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  if (header !== "Bearer operator-token") return null;
  return { id: "00000000-0000-4000-8000-000000000001", name: "operator", role: "operator" as const, claims: {} };
};
const fakeAbly = (() => ({ channels: { get: () => ({ publish: async () => undefined }) } })) as never;

function open(port: number, token?: string): Promise<{ socket: WebSocket; frames: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket("ws://127.0.0.1:" + port + "/graphql/ws");
    const frames: Array<Record<string, unknown>> = [];
    socket.addEventListener("message", (event) => { frames.push(JSON.parse(String(event.data)) as Record<string, unknown>); });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "connection_init", payload: token ? { token } : {} }));
      resolve({ socket, frames });
    });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed to open")));
  });
}
async function waitFor(frames: Array<Record<string, unknown>>, predicate: (frame: Record<string, unknown>) => boolean, timeoutMs = 4000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = frames.find(predicate);
    if (found) return found;
    await Bun.sleep(25);
  }
  throw new Error("Expected frame not received: " + JSON.stringify(frames));
}

test("streams a subscription over graphql-ws after connection_init", async () => {
  const app = await createApp({ users: UsersRepository, orders: OrdersRepository }, authenticate as never);
  const listening = await app.listen(0);
  const port = (listening.server as { port: number }).port;
  const { socket, frames } = await open(port, "operator-token");
  try {
    await waitFor(frames, (frame) => frame.type === "connection_ack");
    socket.send(JSON.stringify({ id: "sub-1", type: "subscribe", payload: { query: "subscription { ordersChanged { event record { id title } } }" } }));
    // Give the server a moment to register the subscription, then emit an event.
    await Bun.sleep(150);
    await OrdersRepository.create({ title: "ws-event" }, "actor");
    expect(await dispatchRealtimeOutbox(10, fakeAbly, databaseOutboxStore, "worker")).toMatchObject({ delivered: 1 });
    const next = await waitFor(frames, (frame) => frame.type === "next" && frame.id === "sub-1");
    const payload = next.payload as { data?: { ordersChanged?: { event: string; record: { title: string } } } };
    expect(payload.data?.ordersChanged?.event).toBe("created");
    expect(payload.data?.ordersChanged?.record.title).toBe("ws-event");
    // Completing the operation closes just that subscription.
    socket.send(JSON.stringify({ id: "sub-1", type: "complete" }));
    await waitFor(frames, (frame) => frame.type === "complete" && frame.id === "sub-1");
  } finally { socket.close(); }
});

test("closes unauthenticated connections and refuses bad subscriptions", async () => {
  const app = await createApp({ users: UsersRepository, orders: OrdersRepository }, authenticate as never);
  const listening = await app.listen(0);
  const port = (listening.server as { port: number }).port;
  const { socket, frames } = await open(port, undefined as never);
  const closed = await new Promise<number>((resolve) => { socket.addEventListener("close", (event) => resolve(event.code)); });
  expect(closed).toBe(4401);
  expect(frames.some((frame) => frame.type === "connection_ack")).toBe(false);

  const authed = await open(port, "operator-token");
  try {
    await waitFor(authed.frames, (frame) => frame.type === "connection_ack");
    authed.socket.send(JSON.stringify({ id: "bad", type: "subscribe", payload: { query: "subscription { missingChanged { event } }" } }));
    const failure = await waitFor(authed.frames, (frame) => frame.type === "error" && frame.id === "bad");
    expect(JSON.stringify(failure.payload)).toMatch(/not defined|Cannot query field/);
    // Plain queries are not subscriptions and are refused on this transport.
    authed.socket.send(JSON.stringify({ id: "query", type: "subscribe", payload: { query: "{ orders { total } }" } }));
    const refused = await waitFor(authed.frames, (frame) => frame.type === "error" && frame.id === "query");
    expect(refused.type).toBe("error");
  } finally { authed.socket.close(); }
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "graphql-ws.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  console.log(`graphql-ws acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
