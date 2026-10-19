import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for CSV import. Import is a second write path, so it must honour
 * the same restrict row policy and masked-field rules as create, reject unknown or
 * masked columns, refuse oversized files, and leave nothing behind when a row fails.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-import-policy-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "import.sqlite");

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
application import-policy {
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
    field code Text @unique;
    field region Text;
    field salary Integer;
    field note Text @nullable;
  }
  restrict orders {
    allow roles admin, operator;
    when region claim region;
    mask salary roles operator mode omit;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);

writeFileSync(join(server, "import.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { createApp } from "./src/app";
import { db } from "./src/db";
import { auditEvents, orders } from "./src/schema";
import { OrdersRepository } from "./src/modules/orders/orders.repository";
import { UsersRepository } from "./src/modules/users/users.repository";

const as = (role: "admin" | "operator", region: string) => async () => ({ id: "00000000-0000-4000-8000-000000000001", name: role, role, claims: { region } });
const app = (role: "admin" | "operator", region = "eu") => createApp({ users: UsersRepository, orders: OrdersRepository }, as(role, region));
const post = async (role: "admin" | "operator", csv: string, region = "eu") => (await app(role, region)).handle(new Request("http://localhost/api/v1/orders/import", { method: "POST", headers: { "Content-Type": "text/csv" }, body: csv }));
const count = async () => (await db.select().from(orders)).length;

test("imports CSV rows the caller may own", async () => {
  const csv = "code,region,salary,note\\r\\nA-1,eu,10,\\"with, comma\\"\\r\\nA-2,eu,20,second\\r\\n";
  Bun.env.QIY_IMPORT_MAX_ROWS = "100";
  const response = await post("admin", csv);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ imported: 2 });
  const rows = await db.select().from(orders);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.code).sort()).toEqual(["A-1", "A-2"]);
  expect(rows.find((row) => row.code === "A-1")?.note).toBe("with, comma");
  expect(rows.find((row) => row.code === "A-2")?.salary).toBe(20);
  // RFC 4180 doubles quotes; a quoted field may contain a newline.
  const quoted = "code,region,salary,note\\nB-1,eu,5,\\"line one\\nline two\\"\\n";
  expect((await post("admin", quoted)).status).toBe(201);
  expect((await db.select().from(orders)).find((row) => row.code === "B-1")?.note).toBe("line one\\nline two");
  const audits = await db.select().from(auditEvents);
  expect(audits.filter((row) => row.action === "orders.imported")).toHaveLength(2);
});

test("rejects unknown, duplicated and masked columns", async () => {
  const before = await count();
  const unknown = await post("admin", "code,region,missing\\nC-1,eu,x\\n");
  expect(unknown.status).toBe(400);
  expect((await unknown.json() as { errorKey?: string }).errorKey).toBe("import.unknownField");
  const duplicate = await post("admin", "code,code\\nD-1,D-2\\n");
  expect(duplicate.status).toBe(400);
  expect((await duplicate.json() as { errorKey?: string }).errorKey).toBe("import.duplicateColumn");
  // salary is masked for operators, so they may neither write nor import it.
  const masked = await post("operator", "code,region,salary\\nE-1,eu,10\\n");
  expect(masked.status).toBe(403 === masked.status ? 403 : 400);
  expect((await masked.json() as { errorKey?: string }).errorKey).toBe("import.maskedField");
  expect(await count()).toBe(before);
});

test("leaves nothing behind when a row fails", async () => {
  const before = await count();
  // A-1 already exists, so the second row of this file violates the unique code.
  const conflict = await post("admin", "code,region,salary\\nNEW-1,eu,1\\nA-1,eu,2\\n");
  expect(conflict.status).toBe(400);
  const body = await conflict.json() as { error?: string; errorKey?: string };
  expect(body.errorKey).toBe("import.invalidRow");
  expect(body.error).toContain("Row 3");
  expect(await count()).toBe(before);

  // A malformed integer fails the same way and reports the column.
  const malformed = await post("admin", "code,region,salary\\nNEW-2,eu,not-a-number\\n");
  expect(malformed.status).toBe(400);
  expect((await malformed.json() as { error?: string }).error).toContain("must be an integer");
  expect(await count()).toBe(before);

  // Column-count mismatches are caught before writing anything.
  const ragged = await post("admin", "code,region,salary\\nNEW-3,eu\\n");
  expect(ragged.status).toBe(400);
  expect((await ragged.json() as { errorKey?: string }).errorKey).toBe("import.rowLength");
  expect(await count()).toBe(before);
});

test("refuses row-policy violations, empty files and oversized imports", async () => {
  const before = await count();
  const outside = await post("admin", "code,region,salary\\nFOREIGN-1,us,10\\n", "eu");
  expect(outside.status).toBe(403);
  expect((await outside.json() as { errorKey?: string }).errorKey).toBe("policy.outsideScope");
  expect(await count()).toBe(before);

  expect((await post("admin", "code,region,salary\\n")).status).toBe(400);
  Bun.env.QIY_IMPORT_MAX_ROWS = "1";
  try {
    const oversized = await post("admin", "code,region,salary\\nH-1,eu,1\\nH-2,eu,2\\n");
    expect(oversized.status).toBe(400);
    expect((await oversized.json() as { errorKey?: string }).errorKey).toBe("import.tooLarge");
  } finally { delete Bun.env.QIY_IMPORT_MAX_ROWS; }
  expect(await count()).toBe(before);
});

test("requires an authenticated caller", async () => {
  const anonymous = await (await createApp({ users: UsersRepository, orders: OrdersRepository })).handle(new Request("http://localhost/api/v1/orders/import", { method: "POST", headers: { "Content-Type": "text/csv" }, body: "code\\nX\\n" }));
  expect(anonymous.status).toBe(401);
});
`);

try {
  await must(["bun", "install"], admin);
  await must(["bun", "run", "db:generate"], server, { DATABASE_URL: databaseUrl });
  await must(["bun", "run", "db:migrate"], server, { DATABASE_URL: databaseUrl });
  console.log(await must(["bun", "run", "typecheck"], server, { DATABASE_URL: databaseUrl }));
  console.log(await must(["bun", "test", "--preload", "./tests/setup.ts", "import.acceptance.test.ts"], server, { DATABASE_URL: databaseUrl }));
  // The web side must compile and ship the import control plus its transfer tests.
  const web = join(admin, "apps/web");
  console.log(await must(["bun", "run", "typecheck"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "run", "build"], web, { DATABASE_URL: ":memory:" }));
  console.log(await must(["bun", "test"], web, { DATABASE_URL: ":memory:" }));
  console.log(`import policy acceptance passed: ${root}`);
} finally {
  console.log(`workspace kept for review: ${root}`);
}
