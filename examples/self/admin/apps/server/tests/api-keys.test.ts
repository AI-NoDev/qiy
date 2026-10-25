import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client } from "../src/db";
import { createApp, type Repositories } from "../src/app";
import { createApiKeyRoutes, withApiKeyAuthentication } from "../src/auth/api-keys";
import {
  API_KEY_MAX_ACTIVE,
  canCreateApiKey,
  generateApiKey,
  hashApiKey,
  isApiKeyExpired,
  maskApiKeyPrefix,
  parseApiKey,
  validateApiKeyExpiry,
  validateApiKeyName,
  verifyApiKeyHash,
} from "../src/auth/api-key-hash";

const DIALECT: string = "sqlite";
const USER_TABLE = "users";
const USER_FIELDS: Array<{ name: string; type: string; primaryKey: boolean }> = [{"name":"id","type":"UUID","primaryKey":true},{"name":"subject","type":"Text","primaryKey":false},{"name":"oktaSubject","type":"Text","primaryKey":false},{"name":"keycloakSubject","type":"Text","primaryKey":false},{"name":"googleSubject","type":"Text","primaryKey":false},{"name":"kindeSubject","type":"Text","primaryKey":false},{"name":"azureSubject","type":"Text","primaryKey":false},{"name":"email","type":"Text","primaryKey":false},{"name":"displayName","type":"Text","primaryKey":false},{"name":"role","type":"Text","primaryKey":false},{"name":"passwordHash","type":"Text","primaryKey":false},{"name":"oauthProfiles","type":"Text","primaryKey":false},{"name":"permissions","type":"Text","primaryKey":false},{"name":"orgId","type":"UUID","primaryKey":false}];
const SEED_COLUMNS: string[] = ["role"];
const ROLE_COLUMN = "role";
const DISPLAY_COLUMN = "role";
const EMAIL_COLUMN = "role";
const FIRST_TABLE = "users";
Bun.env.QIY_AUTH_SECRET = "qiy-api-key-test-secret-value-32-chars";

function identifier(name: string): string { return DIALECT === "mysql" ? "`" + name + "`" : '"' + name + '"'; }

function columnType(type: string): string {
  if (DIALECT === "sqlite") {
    if (type === "Integer" || type === "Boolean" || type === "DateTime") return "INTEGER";
    if (type === "Decimal" || type === "Money") return "REAL";
    if (type === "Vector" || type === "File" || type === "Files") return "BLOB";
    return "TEXT";
  }
  if (DIALECT === "postgresql") {
    if (type === "Integer") return "INTEGER";
    if (type === "Boolean") return "BOOLEAN";
    if (type === "Decimal" || type === "Money") return "DOUBLE PRECISION";
    if (type === "DateTime") return "TIMESTAMPTZ";
    if (type === "Date") return "DATE";
    if (type === "Time") return "TIME";
    return "TEXT";
  }
  if (type === "Integer" || type === "Boolean") return "INT";
  if (type === "Decimal" || type === "Money") return "DOUBLE";
  if (type === "DateTime" || type === "Date" || type === "Time") return "DATETIME(3)";
  return "VARCHAR(191)";
}

function usersDdl(): string {
  return "CREATE TABLE " + identifier(USER_TABLE) + " (" + USER_FIELDS.map((field) => identifier(field.name) + " " + columnType(field.type) + (field.primaryKey ? " PRIMARY KEY" : "")).join(", ") + ")";
}

function keysDdl(): string {
  const timestamp = DIALECT === "sqlite" ? "INTEGER" : DIALECT === "postgresql" ? "TIMESTAMPTZ" : "DATETIME(3)";
  return "CREATE TABLE " + identifier("qiy_api_keys") + " (" + ["id", "userId", "name", "prefix", "hash", "createdAt"].map((column) => identifier(column) + (column === "createdAt" ? " " + timestamp : " TEXT") + (column === "id" ? " PRIMARY KEY" : " NOT NULL")).join(", ") + ", " + ["lastUsedAt", "expiresAt", "revokedAt"].map((column) => identifier(column) + " " + timestamp).join(", ") + ")";
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function timestampLiteral(value: Date | null): string {
  if (!value) return "NULL";
  return DIALECT === "sqlite" ? String(value.getTime()) : literal(value.toISOString());
}

function nowMinus(minutes: number): Date { return new Date(Date.now() - minutes * 60_000); }
function nowPlus(minutes: number): Date { return new Date(Date.now() + minutes * 60_000); }

async function exec(sql: string): Promise<void> { client.exec(sql); }
async function rows(sql: string): Promise<Array<Record<string, unknown>>> { return client.query(sql).all() as Array<Record<string, unknown>>; }

async function reset(): Promise<void> {
  await exec("DROP TABLE IF EXISTS " + identifier("qiy_api_keys"));
  await exec("DROP TABLE IF EXISTS " + identifier(USER_TABLE));
  await exec(usersDdl());
  await exec(keysDdl());
}

async function seedUser(id: string, role: string, displayName: string): Promise<void> {
  const values = SEED_COLUMNS.map((column) => column === ROLE_COLUMN ? literal(role) : column === DISPLAY_COLUMN ? literal(displayName) : literal(displayName.toLowerCase().replace(/\s+/g, ".") + "@example.com"));
  await exec("INSERT INTO " + identifier(USER_TABLE) + " (" + [identifier("id"), ...SEED_COLUMNS.map((column) => identifier(column))].join(", ") + ") VALUES (" + [literal(id), ...values].join(", ") + ")");
}

async function insertKey(input: { id: string; userId: string; name: string; prefix: string; hash: string; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null }): Promise<void> {
  await exec("INSERT INTO " + identifier("qiy_api_keys") + " (" + ["id", "userId", "name", "prefix", "hash", "createdAt", "lastUsedAt", "expiresAt", "revokedAt"].map((column) => identifier(column)).join(", ") + ") VALUES (" + [literal(input.id), literal(input.userId), literal(input.name), literal(input.prefix), literal(input.hash), timestampLiteral(input.createdAt), "NULL", timestampLiteral(input.expiresAt), timestampLiteral(input.revokedAt)].join(", ") + ")");
}

async function keyRows(): Promise<Array<Record<string, unknown>>> { return rows("SELECT id, userId, name, prefix, hash, lastUsedAt, expiresAt, revokedAt FROM qiy_api_keys"); }

const session = async (request: Request) => {
  const header = request.headers.get("authorization");
  if (header === "Bearer session-admin") return { id: "admin-user", name: "Admin", role: "admin" as const };
  if (header === "Bearer session-operator") return { id: "operator-user", name: "Operator", role: "operator" as const };
  return null;
};

function routes() { return new Elysia().use(createApiKeyRoutes(session)); }
function call(path: string, init?: RequestInit) { return routes().handle(new Request("http://localhost" + path, init)); }
const adminHeaders = { authorization: "Bearer session-admin", "content-type": "application/json" };
const operatorHeaders = { authorization: "Bearer session-operator", "content-type": "application/json" };

test("API key helpers hash secrets, validate names/expiry and never expose the secret", () => {
  const generated = generateApiKey();
  expect(generated.key.startsWith("qiy_")).toBe(true);
  const parsed = parseApiKey(generated.key);
  expect(parsed).not.toBeNull();
  expect(generated.prefix).toHaveLength(8);
  expect(parsed!.prefix).toBe(generated.prefix);
  expect(parseApiKey("qiy_short")).toBeNull();
  expect(parseApiKey("session-token")).toBeNull();
  expect(generated.hash).toHaveLength(64);
  expect(generated.hash).not.toContain(generated.key);
  expect(verifyApiKeyHash(generated.key, generated.hash)).toBe(true);
  expect(verifyApiKeyHash(generated.key, hashApiKey("another-secret"))).toBe(false);
  expect(hashApiKey(parsed!.secret)).toBe(generated.hash);
  expect(maskApiKeyPrefix(generated.prefix)).not.toContain(parsed!.secret);
  expect(validateApiKeyName("  CI deploy  ")).toBe("CI deploy");
  expect(() => validateApiKeyName("   ")).toThrow("name is required");
  expect(validateApiKeyExpiry(nowPlus(5).toISOString())).toBeInstanceOf(Date);
  expect(() => validateApiKeyExpiry(nowMinus(5).toISOString())).toThrow("must be in the future");
  expect(isApiKeyExpired(nowMinus(1), new Date())).toBe(true);
  expect(isApiKeyExpired(null, new Date())).toBe(false);
  expect(canCreateApiKey(API_KEY_MAX_ACTIVE - 1)).toBe(true);
  expect(canCreateApiKey(API_KEY_MAX_ACTIVE)).toBe(false);
});

test("creates, lists, authenticates and revokes an API key", async () => {
  await reset();
  await seedUser("admin-user", "admin", "Admin User");
  const created = await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "CI deploy", expiresAt: nowPlus(60).toISOString() }) });
  expect(created.status).toBe(201);
  const payload = await created.json() as { key: string; record: { id: string; maskedKey: string; prefix: string; name: string } };
  expect(payload.key.startsWith("qiy_")).toBe(true);
  expect(payload.record.name).toBe("CI deploy");
  const parsed = parseApiKey(payload.key)!;
  expect(payload.record.maskedKey).not.toContain(parsed.secret);
  expect(JSON.stringify(payload)).not.toContain("hash");
  const stored = await keyRows();
  expect(stored).toHaveLength(1);
  expect(stored[0]!.hash).toBe(hashApiKey(parsed.secret));
  expect(stored[0]!.hash).not.toBe(payload.key);
  expect(String(stored[0]!.hash)).toHaveLength(64);
  expect(stored[0]!.prefix).toBe(payload.record.prefix);

  const listed = await call("/api/v1/auth/api-keys", { headers: adminHeaders });
  expect(listed.status).toBe(200);
  const listedBody = await listed.json() as { items: Array<Record<string, unknown>> };
  expect(listedBody.items).toHaveLength(1);
  expect(JSON.stringify(listedBody)).not.toContain(parsed.secret);

  const wrapped = withApiKeyAuthentication(session);
  const bearerPrincipal = await wrapped(new Request("http://localhost/probe", { headers: { authorization: "Bearer " + payload.key } }));
  expect(bearerPrincipal).toMatchObject({ id: "admin-user", role: "admin" });
  const headerPrincipal = await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": payload.key } }));
  expect(headerPrincipal).toMatchObject({ id: "admin-user", role: "admin" });
  expect(await wrapped(new Request("http://localhost/probe", { headers: { authorization: "Bearer session-token" } }))).toBeNull();
  const used = await keyRows();
  expect(used[0]!.lastUsedAt).not.toBeNull();

  const revoked = await call("/api/v1/auth/api-keys/" + payload.record.id, { method: "DELETE", headers: adminHeaders });
  expect(revoked.status).toBe(200);
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": payload.key } }))).toBeNull();
  expect((await call("/api/v1/auth/api-keys/" + payload.record.id, { method: "DELETE", headers: adminHeaders })).status).toBe(200);
  expect((await call("/api/v1/auth/api-keys/missing", { method: "DELETE", headers: adminHeaders })).status).toBe(404);
});

test("API keys authenticate through the app guard and inherit the user's limits", async () => {
  await reset();
  await seedUser("admin-user", "admin", "Admin User");
  await seedUser("operator-user", "operator", "Operator User");
  const adminResponse = await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "Admin key" }) });
  const adminPayload = await adminResponse.json() as { key: string; record: { id: string } };
  const adminKey = adminPayload.key;
  const operatorResponse = await call("/api/v1/auth/api-keys", { method: "POST", headers: operatorHeaders, body: JSON.stringify({ name: "Operator key" }) });
  expect(operatorResponse.status).toBe(201);
  const operatorKey = (await operatorResponse.json() as { key: string }).key;

  const refused = await call("/api/v1/auth/api-keys/" + adminPayload.record.id, { method: "DELETE", headers: operatorHeaders });
  expect(refused.status).toBe(404);

  const repository = { distribution: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(["users", "orgs", "suppliers", "customers", "products", "boms", "purchase_orders", "purchase_order_lines", "receipts", "sales_orders", "sales_order_lines", "shipments", "warehouses", "bins", "inventory", "stock_movements", "work_orders"].map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, session);
  const adminRead = await app.handle(new Request("http://localhost/api/v1/" + FIRST_TABLE + "/", { headers: { "x-api-key": adminKey } }));
  expect(adminRead.status).toBe(200);
  const anonymous = await app.handle(new Request("http://localhost/api/v1/" + FIRST_TABLE + "/"));
  expect(anonymous.status).toBe(401);
  // Non-admin principals never get role access to the auth user resource: an
  // operator API key must be rejected by the same guard as an operator session.
  const operatorDenied = await app.handle(new Request("http://localhost/api/v1/" + USER_TABLE + "/", { headers: { "x-api-key": operatorKey } }));
  expect(operatorDenied.status).toBe(403);
  const self = await app.handle(new Request("http://localhost/api/v1/auth/api-keys", { headers: { "x-api-key": adminKey } }));
  expect(self.status).toBe(200);
  const revoke = await app.handle(new Request("http://localhost/api/v1/auth/api-keys/" + adminPayload.record.id, { method: "DELETE", headers: { "x-api-key": adminKey } }));
  expect(revoke.status).toBe(200);
  const afterRevoke = await app.handle(new Request("http://localhost/api/v1/" + FIRST_TABLE + "/", { headers: { "x-api-key": adminKey } }));
  expect(afterRevoke.status).toBe(401);
});

test("rejects expired/revoked keys, invalid payloads and the per-user key limit", async () => {
  await reset();
  await seedUser("admin-user", "admin", "Admin User");
  const generated = generateApiKey();
  const expired = generateApiKey();
  const revoked = generateApiKey();
  await insertKey({ id: "expired-key", userId: "admin-user", name: "Expired", prefix: expired.prefix, hash: expired.hash, createdAt: nowMinus(120), expiresAt: nowMinus(60), revokedAt: null });
  await insertKey({ id: "revoked-key", userId: "admin-user", name: "Revoked", prefix: revoked.prefix, hash: revoked.hash, createdAt: nowMinus(120), expiresAt: null, revokedAt: nowMinus(60) });
  await insertKey({ id: "live-key", userId: "admin-user", name: "Live", prefix: generated.prefix, hash: generated.hash, createdAt: nowMinus(120), expiresAt: null, revokedAt: null });
  const wrapped = withApiKeyAuthentication(session);
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": expired.key } }))).toBeNull();
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": revoked.key } }))).toBeNull();
  expect(await wrapped(new Request("http://localhost/probe", { headers: { "x-api-key": "qiy_00000000_" + "x".repeat(43) } }))).toBeNull();
  expect((await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "" }) })).status).toBe(422);
  expect((await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "Missing expiry" }) })).status).toBe(201);
  expect((await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "Past", expiresAt: nowMinus(5).toISOString() }) })).status).toBe(400);
  await exec("DELETE FROM " + identifier("qiy_api_keys"));
  for (let index = 0; index < API_KEY_MAX_ACTIVE; index += 1) {
    const key = generateApiKey();
    await insertKey({ id: "limit-" + index, userId: "admin-user", name: "Key " + index, prefix: key.prefix, hash: key.hash, createdAt: new Date(), expiresAt: null, revokedAt: null });
  }
  expect((await call("/api/v1/auth/api-keys", { method: "POST", headers: adminHeaders, body: JSON.stringify({ name: "Over limit" }) })).status).toBe(409);
});
