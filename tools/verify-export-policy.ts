import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for the policy-aware CSV export. Export is a second read path,
 * so it must apply the same restrict row predicates and field masks as the list
 * endpoint, drop fully masked columns instead of blanking them, refuse instead of
 * truncating an oversized range, and leave an audit trail.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-export-policy-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "export.sqlite");

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
application export-policy {
  database sqlite {}
  api { client rest; }
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
    field region Text;
    field salary Integer;
    field note Text @nullable;
  }
  restrict orders {
    allow roles admin, operator;
    when region claim region;
    mask salary roles operator mode omit;
    mask note roles operator mode redact replacement "***";
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "export.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { auditEvents, orders } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const principal = (role: "admin" | "operator", region: string) => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims: { region } });
const app = (role: "admin" | "operator", region: string) => createApp({ users: UsersRepository, orders: OrdersRepository }, principal(role, region));
const exportCsv = async (role: "admin" | "operator", region: string, query = "") => (await app(role, region)).handle(new Request("http://localhost/api/v1/orders/export" + query));

test("exports only rows and columns the principal may see", async () => {
  // Seed each region with a principal whose own claim matches: writing a row
  // outside your own row policy is refused, so cross-region seeding needs both.
  for (const [title, region, salary] of [["a, with comma", "eu", 10], ["b", "eu", 20], ["c", "us", 30]] as const) {
    const writer = await app("admin", region);
    const created = await writer.handle(new Request("http://localhost/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, region, salary, note: "secret note" }) }));
    expect(created.status).toBe(201);
  }
  // A write outside the caller's own record policy is a policy refusal, not a crash.
  const outside = await (await app("admin", "eu")).handle(new Request("http://localhost/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "outside", region: "us", salary: 1, note: null }) }));
  expect(outside.status).toBe(403);
  expect((await outside.json() as { errorKey?: string }).errorKey).toBe("policy.outsideScope");

  // An operator only sees its own region and never the masked salary column.
  const operator = await exportCsv("operator", "eu");
  expect(operator.status).toBe(200);
  expect(operator.headers.get("content-type")).toContain("text/csv");
  expect(operator.headers.get("content-disposition")).toContain("orders.csv");
  const text = await operator.text();
  const lines = text.trimEnd().split("\\r\\n");
  expect(lines[0]).toBe("id,title,region,note");
  expect(lines).toHaveLength(3);
  expect(text).not.toContain("salary");
  expect(text).not.toContain("us");
  // RFC 4180 quoting, and the redacted note value instead of the real one.
  expect(text).toContain('"a, with comma"');
  expect(text).not.toContain("secret note");
  expect(text).toContain("***");

  // Admins share the row predicate but keep every column, still redacted per mask roles.
  const admin = await exportCsv("admin", "eu");
  const adminLines = (await admin.text()).trimEnd().split("\\r\\n");
  expect(adminLines[0]).toBe("id,title,region,salary,note");
  expect(adminLines).toHaveLength(3);

  // Filters narrow the exported range and are validated like the list endpoint.
  const filtered = await exportCsv("admin", "eu", "?filters=" + encodeURIComponent(JSON.stringify([{ field: "title", operator: "eq", value: "b" }])));
  expect((await filtered.text()).trimEnd().split("\\r\\n")).toHaveLength(2);
  expect((await exportCsv("admin", "eu", "?filters=" + encodeURIComponent(JSON.stringify([{ field: "unknown", operator: "eq", value: "x" }])))).status).toBe(400);
  expect((await exportCsv("admin", "eu", "?sort=note")).status).toBe(200);

  // A row selection exports exactly those ids, still filtered by the row policy.
  const all = await (await app("admin", "eu")).handle(new Request("http://localhost/api/v1/orders?pageSize=100"));
  const rows = (await all.json() as { data: Array<{ id: string; title: string }> }).data;
  const selected = await exportCsv("admin", "eu", "?ids=" + rows[0]!.id);
  const selectedLines = (await selected.text()).trimEnd().split("\\r\\n");
  expect(selectedLines).toHaveLength(2);
  expect(selectedLines[1]).toContain(rows[0]!.title);
  // Ids the caller cannot see are dropped instead of leaking, and bad ids are refused.
  const usRow = (await (await app("admin", "us")).handle(new Request("http://localhost/api/v1/orders?pageSize=100")).then((response) => response.json()) as { data: Array<{ id: string }> }).data[0]!;
  const foreign = await exportCsv("admin", "eu", "?ids=" + usRow.id);
  expect((await foreign.text()).trimEnd().split("\\r\\n")).toHaveLength(1);
  expect((await exportCsv("admin", "eu", "?ids=../etc")).status).toBe(400);
  expect((await exportCsv("admin", "eu", "?ids=" + Array.from({ length: 501 }, (_, index) => "id" + index).join(","))).status).toBe(400);

  // Exporting is audited.
  const audits = await db.select().from(auditEvents);
  expect(audits.some((row) => row.action === "orders.exported")).toBe(true);
});

test("refuses anonymous and oversized exports instead of truncating", async () => {
  const anonymous = await (await createApp({ users: UsersRepository, orders: OrdersRepository })).handle(new Request("http://localhost/api/v1/orders/export"));
  expect(anonymous.status).toBe(401);

  Bun.env.QIY_EXPORT_MAX_ROWS = "1";
  try {
    const limited = await exportCsv("admin", "eu");
    expect(limited.status).toBe(400);
    const body = await limited.json() as { errorKey?: string };
    expect(body.errorKey).toBe("export.tooLarge");
  } finally { delete Bun.env.QIY_EXPORT_MAX_ROWS; }

  // The list endpoint keeps its own page size cap and is unaffected by the export limit.
  const listed = await (await app("admin", "eu")).handle(new Request("http://localhost/api/v1/orders?pageSize=100"));
  expect(listed.status).toBe(200);
  expect((await listed.json() as { total: number }).total).toBe(2);
});

test("streams a multi-page export without materializing it", async () => {
  // Seed past one export page (250) inside a single region so the stream must
  // fetch several pages; the row policy still applies to every page.
  const writer = await app("admin", "eu");
  for (let index = 0; index < 310; index++) {
    const created = await writer.handle(new Request("http://localhost/api/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "stream-" + index, region: "eu", salary: index }) }));
    expect(created.status).toBe(201);
  }
  Bun.env.QIY_EXPORT_MAX_ROWS = "100000";
  try {
    const response = await exportCsv("operator", "eu");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    // A streamed response cannot advertise a total length.
    expect(response.headers.get("content-length")).toBeNull();
    const lines = (await response.text()).trimEnd().split("\\r\\n");
    const header = lines[0]!.split(",");
    // operator must not receive the fully masked column, even across pages.
    expect(header).not.toContain("salary");
    expect(header).toContain("title");
    expect(lines.length).toBeGreaterThan(300);
    const titleIndex = header.indexOf("title");
    const titles = lines.slice(1).map((line) => line.split(",")[titleIndex]);
    expect(titles).toContain("stream-0");
    expect(titles).toContain("stream-309");
    // Only the caller's region is exported (checked on the raw CSV cell, since a
    // quoted title may itself contain a comma).
    expect(lines.slice(1).some((line) => /,us,/.test(line))).toBe(false);
    // Selected rows still work through the streaming path.
    const one = await exportCsv("operator", "eu", "?ids=stream-not-a-real-id");
    expect((await one.text()).trimEnd().split("\\r\\n")).toHaveLength(1);
  } finally { delete Bun.env.QIY_EXPORT_MAX_ROWS; }
});

test("exports only the requested columns", async () => {
  // A column subset controls the header and every row, in declared order.
  const subset = await exportCsv("admin", "eu", "?columns=title,region");
  expect(subset.status).toBe(200);
  const subsetLines = (await subset.text()).trimEnd().split("\\r\\n");
  expect(subsetLines[0]).toBe("title,region");
  // An unknown column is refused, not silently ignored.
  const unknown = await exportCsv("admin", "eu", "?columns=title,missing");
  expect(unknown.status).toBe(400);
  expect((await unknown.json() as { errorKey?: string }).errorKey).toBe("export.invalidColumn");
  // Asking only for a fully masked column leaves nothing to export.
  const masked = await exportCsv("operator", "eu", "?columns=salary");
  expect(masked.status).toBe(400);
  expect((await masked.json() as { errorKey?: string }).errorKey).toBe("export.noColumns");
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "export.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  // The web side must compile and ship the export control plus its encoder tests.
  const web = join(admin, "apps/web");
  console.log(await must(["bun", "run", "typecheck"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "run", "build"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "test"], web, { DATABASE_URL: ":memory:" }));
  console.log(`export policy acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
