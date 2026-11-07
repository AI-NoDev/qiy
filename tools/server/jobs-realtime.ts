/**
 * Server renderers for CSV export/import jobs, saved views and realtime
 * (SSE stream, outbox and masked broadcast fields).
 */
import type { DatabaseIR } from "../database-ir";
import type { QiyProject, QiyResourceRestriction } from "../qiy-project";
import type { RoleContext } from "../roles";

/**
 * A realtime channel is shared by every subscriber of a resource, so a field that
 * is masked for any role allowed to subscribe must be stripped from the event
 * payload at publish time. A mask without roles (or with a claim predicate only)
 * applies to everyone, so it always counts.
 */
export function maskedRealtimeFields(restriction: QiyResourceRestriction | undefined, subscriberRoles: readonly string[]): string[] {
  if (!restriction?.masks?.length) return [];
  const fields = restriction.masks
    .filter((mask) => !mask.roles?.length || mask.roles.some((role) => subscriberRoles.includes(role)))
    .map((mask) => mask.field);
  return [...new Set(fields)];
}

export function renderRealtimeOutboxSchema(dialect: DatabaseIR["dialect"]): string {
  const table = dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
  const string = dialect === "mysql" ? (name: string, length: number) => `varchar(${JSON.stringify(name)}, { length: ${length} })` : (name: string) => `text(${JSON.stringify(name)})`;
  const date = (name: string) => dialect === "postgresql" ? `timestamp(${JSON.stringify(name)}, { withTimezone: true })` : dialect === "sqlite" ? `integer(${JSON.stringify(name)}, { mode: "timestamp_ms" })` : `datetime(${JSON.stringify(name)}, { mode: "date", fsp: 3 })`;
  return `\n\nexport const realtimeOutbox = ${table}("qiy_realtime_outbox", {\n  id: ${string("id", 36)}.primaryKey(),\n  channel: ${string("channel", 190)}.notNull(),\n  type: ${string("type", 80)}.notNull(),\n  payload: text("payload").notNull(),\n  createdAt: ${date("createdAt")}.notNull(),\n}, (table) => [index("qiy_realtime_outbox_created_idx").on(table.createdAt)]);\n`;
}

/**
 * Background export jobs: the CSV is materialized by the worker and stored on the
 * job row so a client can download it later (or after a reconnect).
 */
export function renderExportJobsModule(dialect: DatabaseIR["dialect"]): string {
  const sqlite = dialect === "sqlite";
  const now = "new Date()";
  return `import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { qiyExportJobs } from "./schema";

export type QiyExportJobStatus = "queued" | "running" | "completed" | "failed";

export interface QiyExportJob {
  id: string;
  resource: string;
  status: QiyExportJobStatus;
  total: number;
  processed: number;
  errors: string[];
  actorId: string | null;
  createdAt: string;
  updatedAt: string;
}

type QiyExportJobRow = typeof qiyExportJobs.$inferSelect;
const iso = (value: Date | number | string) => value instanceof Date ? value.toISOString() : new Date(Number(value)).toISOString();

function toJob(row: QiyExportJobRow): QiyExportJob {
  return {
    id: row.id,
    resource: row.resource,
    status: row.status as QiyExportJobStatus,
    total: Number(row.total),
    processed: Number(row.processed),
    errors: row.errors ? (JSON.parse(row.errors) as string[]) : [],
    actorId: row.actorId ?? null,
    createdAt: iso(row.createdAt as Date | number),
    updatedAt: iso(row.updatedAt as Date | number),
  };
}

export async function createExportJob(input: { resource: string; total: number; actorId: string | null; payload?: string }): Promise<string> {
  const id = crypto.randomUUID();
  const values = { id, resource: input.resource, status: "queued", total: input.total, processed: 0, payload: input.payload ?? null, errors: null, actorId: input.actorId, leaseOwner: null, leaseUntil: null, createdAt: ${now}, updatedAt: ${now} };
  ${sqlite ? "db.insert(qiyExportJobs).values(values).run();" : "await db.insert(qiyExportJobs).values(values);"}
  return id;
}

export async function updateExportJob(id: string, patch: { status?: QiyExportJobStatus; processed?: number; payload?: string; result?: string; errors?: string[]; releaseLease?: boolean }): Promise<void> {
  const values = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.processed !== undefined ? { processed: patch.processed } : {}),
    ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
    ...(patch.result !== undefined ? { result: patch.result } : {}),
    ...(patch.errors ? { errors: JSON.stringify(patch.errors) } : {}),
    updatedAt: ${now},
  };
  ${sqlite ? "db.update(qiyExportJobs).set(values).where(eq(qiyExportJobs.id, id)).run();" : "await db.update(qiyExportJobs).set(values).where(eq(qiyExportJobs.id, id));"}
}

export async function readExportJob(id: string): Promise<(QiyExportJob & { payload?: string; result?: string }) | undefined> {
  ${sqlite ? "const row = db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, id)).get();" : "const [row] = await db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, id)).limit(1);"}
  if (!row) return undefined;
  const job = toJob(row as QiyExportJobRow);
  const payload = (row as QiyExportJobRow).payload;
  const result = (row as QiyExportJobRow).result;
  return { ...job, ...(payload ? { payload } : {}), ...(result ? { result } : {}) };
}

/** Claims one export job with a conditional update so replicas cannot both run it. */
export async function claimExportJob(resource: string, workerId: string, leaseUntil: Date, jobId?: string): Promise<(QiyExportJob & { payload: string }) | undefined> {
  ${sqlite ? `const candidates = db.select().from(qiyExportJobs).where(and(eq(qiyExportJobs.resource, resource), eq(qiyExportJobs.status, "queued"))).orderBy(qiyExportJobs.createdAt).all();` : `const candidates = await db.select().from(qiyExportJobs).where(and(eq(qiyExportJobs.resource, resource), eq(qiyExportJobs.status, "queued"))).orderBy(qiyExportJobs.createdAt);`}
  const candidate = candidates.find((row) => Boolean(row.payload) && (!jobId || row.id === jobId));
  if (!candidate) return undefined;
  ${sqlite ? `db.update(qiyExportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: ${now} }).where(and(eq(qiyExportJobs.id, candidate.id), eq(qiyExportJobs.status, "queued"))).run();` : `await db.update(qiyExportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: ${now} }).where(and(eq(qiyExportJobs.id, candidate.id), eq(qiyExportJobs.status, "queued")));`}
  ${sqlite ? `const claimed = db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, candidate.id)).get();` : `const [claimed] = await db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, candidate.id)).limit(1);`}
  if (!claimed || claimed.leaseOwner !== workerId || !claimed.payload) return undefined;
  return { ...toJob(claimed as QiyExportJobRow), payload: claimed.payload };
}

/** Lists recent export jobs for a resource so a worker can find queued work. */
export async function listExportJobs(resource: string, limit = 50): Promise<QiyExportJob[]> {
  ${sqlite ? `const rows = db.select().from(qiyExportJobs).where(eq(qiyExportJobs.resource, resource)).orderBy(desc(qiyExportJobs.createdAt)).all();` : `const rows = await db.select().from(qiyExportJobs).where(eq(qiyExportJobs.resource, resource)).orderBy(desc(qiyExportJobs.createdAt));`}
  return rows.slice(0, limit).map((row) => toJob(row as QiyExportJobRow));
}
`;
}

/**
 * Server-side saved views: a per-user list of named filter/sort/column snapshots,
 * optionally shared with everyone who can read the resource. The browser keeps a
 * local copy too, so the UI works offline; this store is what makes views follow
 * the user across devices and lets teams share them.
 */
export function renderSavedViewsModule(dialect: DatabaseIR["dialect"], resources: string[]): string {
  const sqlite = dialect === "sqlite";
  const now = "new Date()";
  return `import { and, desc, eq, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "./db";
import { qiySavedViews } from "./schema";
import type { Authenticator, Principal } from "./auth/guard";
import { hasFullAccess } from "./auth/roles";

export interface QiySavedView {
  id: string;
  resource: string;
  name: string;
  ownerId: string;
  shared: boolean;
  /** True when the caller owns this row; shared rows from other users report false. */
  mine: boolean;
  search?: string;
  filters?: unknown[];
  sorters?: unknown[];
  columns?: string[];
  createdAt: string;
  updatedAt: string;
}

const viewResources = ${JSON.stringify(resources)} as string[];
const MAX_VIEWS_PER_RESOURCE = 100;
const iso = (value: Date | number | string) => value instanceof Date ? value.toISOString() : new Date(Number(value)).toISOString();
const decode = (value: string | null): unknown[] | undefined => { if (!value) return undefined; try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed : undefined; } catch { return undefined; } };

function toView(row: typeof qiySavedViews.$inferSelect, principalId: string): QiySavedView {
  return {
    id: row.id,
    resource: row.resource,
    name: row.name,
    ownerId: row.ownerId,
    shared: Boolean(row.shared),
    mine: row.ownerId === principalId,
    ...(row.search ? { search: row.search } : {}),
    ...(decode(row.filters) ? { filters: decode(row.filters) } : {}),
    ...(decode(row.sorters) ? { sorters: decode(row.sorters) } : {}),
    ...(decode(row.columns) ? { columns: decode(row.columns) as string[] } : {}),
    createdAt: iso(row.createdAt as Date | number),
    updatedAt: iso(row.updatedAt as Date | number),
  };
}

export async function listSavedViews(resource: string, principal: Principal): Promise<QiySavedView[]> {
  // Own views plus everyone's shared views, newest first. updatedAt then createdAt
  // plus the id tiebreaker keep the dropdown order stable for identical timestamps.
  ${sqlite
    ? "const rows = db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, resource), or(eq(qiySavedViews.ownerId, principal.id), eq(qiySavedViews.shared, 1)))).orderBy(desc(qiySavedViews.updatedAt), desc(qiySavedViews.createdAt), desc(qiySavedViews.id)).all();"
    : dialect === "mysql"
      ? "const rows = await db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, resource), or(eq(qiySavedViews.ownerId, principal.id), eq(qiySavedViews.shared, 1)))).orderBy(desc(qiySavedViews.updatedAt), desc(qiySavedViews.createdAt), desc(qiySavedViews.id));"
      : "const rows = await db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, resource), or(eq(qiySavedViews.ownerId, principal.id), eq(qiySavedViews.shared, true)))).orderBy(desc(qiySavedViews.updatedAt), desc(qiySavedViews.createdAt), desc(qiySavedViews.id));"}
  return rows.map((row) => toView(row as typeof qiySavedViews.$inferSelect, principal.id));
}

export async function createSavedView(input: { resource: string; name: string; shared: boolean; search?: string; filters?: unknown[]; sorters?: unknown[]; columns?: string[]; principal: Principal }): Promise<QiySavedView> {
  ${sqlite
    ? "const existing = db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, input.resource), eq(qiySavedViews.ownerId, input.principal.id))).all();"
    : "const existing = await db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, input.resource), eq(qiySavedViews.ownerId, input.principal.id)));"}
  // Publishing an existing name updates that row; only a new name counts toward the cap.
  // Rows duplicated by older releases are collapsed on the next publish.
  const duplicates = existing.filter((row) => row.name === input.name);
  const duplicate = duplicates[0];
  if (!duplicate && existing.length >= MAX_VIEWS_PER_RESOURCE) throw new Error("view.limit");
  const id = duplicate ? duplicate.id : crypto.randomUUID();
  const payload = {
    shared: ${dialect === "postgresql" ? "input.shared" : "input.shared ? 1 : 0"},
    search: input.search ?? null,
    filters: input.filters ? JSON.stringify(input.filters) : null,
    sorters: input.sorters ? JSON.stringify(input.sorters) : null,
    columns: input.columns ? JSON.stringify(input.columns) : null,
    updatedAt: ${now},
  };
  if (duplicate) {
    ${sqlite ? "for (const extra of duplicates.slice(1)) db.delete(qiySavedViews).where(eq(qiySavedViews.id, extra.id)).run();" : "for (const extra of duplicates.slice(1)) await db.delete(qiySavedViews).where(eq(qiySavedViews.id, extra.id));"}
    ${sqlite ? "db.update(qiySavedViews).set(payload).where(eq(qiySavedViews.id, id)).run();" : "await db.update(qiySavedViews).set(payload).where(eq(qiySavedViews.id, id));"}
  } else {
    ${sqlite ? "db.insert(qiySavedViews).values({ id, resource: input.resource, name: input.name, ownerId: input.principal.id, createdAt: new Date(), ...payload }).run();" : "await db.insert(qiySavedViews).values({ id, resource: input.resource, name: input.name, ownerId: input.principal.id, createdAt: new Date(), ...payload });"}
  }
  ${sqlite ? "const row = db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).get();" : "const [row] = await db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).limit(1);"}
  return toView(row as typeof qiySavedViews.$inferSelect, input.principal.id);
}

export async function deleteSavedView(id: string, principal: Principal): Promise<"deleted" | "missing" | "forbidden"> {
  ${sqlite ? "const row = db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).get();" : "const [row] = await db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).limit(1);"}
  if (!row) return "missing";
  // Owners delete their own rows; an admin may remove another user's shared row during cleanup.
  if (row.ownerId !== principal.id && !hasFullAccess(principal.role)) return "forbidden";
  ${sqlite ? "db.delete(qiySavedViews).where(eq(qiySavedViews.id, id)).run();" : "await db.delete(qiySavedViews).where(eq(qiySavedViews.id, id));"}
  return "deleted";
}

export function createSavedViewsRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/saved-views" })
    .get("/", async ({ query, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!viewResources.includes(query.resource)) return status(400, { error: "Unknown view resource", errorKey: "views.unknownResource" });
      return { items: await listSavedViews(query.resource, principal) };
    }, { query: t.Object({ resource: t.String({ minLength: 1, maxLength: 160 }) }) })
    .post("/", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!viewResources.includes(body.resource)) return status(400, { error: "Unknown view resource", errorKey: "views.unknownResource" });
      const name = body.name.trim();
      if (!name) return status(400, { error: "View name is required", errorKey: "views.invalidName" });
      try {
        const view = await createSavedView({ ...body, name, shared: body.shared ?? false, principal });
        return status(201, view);
      } catch (error) {
        if (error instanceof Error && error.message === "view.limit") return status(400, { error: "Too many saved views for this resource", errorKey: "views.limit" });
        throw error;
      }
    }, { body: t.Object({ resource: t.String({ minLength: 1, maxLength: 160 }), name: t.String({ minLength: 1, maxLength: 80 }), shared: t.Optional(t.Boolean()), search: t.Optional(t.String({ maxLength: 300 })), filters: t.Optional(t.Array(t.Any(), { maxItems: 50 })), sorters: t.Optional(t.Array(t.Any(), { maxItems: 10 })), columns: t.Optional(t.Array(t.String({ maxLength: 80 }), { maxItems: 100 })) }, { additionalProperties: false }) })
    .delete("/:id", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      const outcome = await deleteSavedView(params.id, principal);
      if (outcome === "missing") return status(404, { error: "Saved view not found" });
      if (outcome === "forbidden") return status(403, { error: "Saved view belongs to another user", errorKey: "views.forbidden" });
      return status(204);
    });
}
`;
}

/**
 * Regression tests for the generated saved-view routes. Publishing the same name
 * must upsert instead of duplicating the dropdown entry, every row reports whether
 * it belongs to the caller, only the owner (or an admin) may delete, and the
 * per-user cap only applies to new names. SQLite runs on the in-memory test
 * database; PostgreSQL/MySQL need QIY_TEST_DATABASE_URL with migrations applied.
 */
export function renderSavedViewsTest(dialect: DatabaseIR["dialect"], resources: string[], roles: RoleContext): string {
  const resource = resources[0]!;
  const exec = dialect === "sqlite" ? "client.exec(statement)" : dialect === "postgresql" ? "client.unsafe(statement)" : "client.query(statement)";
  const ddl = dialect === "sqlite"
    ? `CREATE TABLE IF NOT EXISTS "qiy_saved_views" ("id" text primary key, "resource" text not null, "name" text not null, "ownerId" text not null, "shared" integer not null, "search" text, "filters" text, "sorters" text, "columns" text, "createdAt" integer not null, "updatedAt" integer not null)`
    : dialect === "postgresql"
      ? `CREATE TABLE IF NOT EXISTS "qiy_saved_views" ("id" text primary key, "resource" text not null, "name" text not null, "ownerId" text not null, "shared" boolean not null, "search" text, "filters" text, "sorters" text, "columns" text, "createdAt" timestamp with time zone not null, "updatedAt" timestamp with time zone not null)`
      : "CREATE TABLE IF NOT EXISTS `qiy_saved_views` (`id` varchar(36) primary key, `resource` varchar(160) not null, `name` varchar(120) not null, `ownerId` varchar(36) not null, `shared` int not null, `search` text, `filters` text, `sorters` text, `columns` text, `createdAt` datetime(3) not null, `updatedAt` datetime(3) not null)";
  const available = dialect === "sqlite" ? "true" : "Boolean(Bun.env.QIY_TEST_DATABASE_URL)";
  const carolRows = dialect === "mysql"
    ? "DELETE FROM `qiy_saved_views` WHERE `ownerId` = '00000000-0000-4000-8000-0000000000c1'"
    : `DELETE FROM "qiy_saved_views" WHERE "ownerId" = '00000000-0000-4000-8000-0000000000c1'`;
  return `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { QiySavedView } from "../src/saved-views";
import type { QiyRole } from "../src/auth/roles";

const dialect = ${JSON.stringify(dialect)};
const available = ${available};
const resource = ${JSON.stringify(resource)};
const ddl = ${JSON.stringify(ddl)};
const carolRows = ${JSON.stringify(carolRows)};

type Principal = { id: string; name: string; role: QiyRole };
const alice: Principal = { id: "00000000-0000-4000-8000-0000000000a1", name: "Alice", role: ${JSON.stringify(roles.admin)} };
const bob: Principal = { id: "00000000-0000-4000-8000-0000000000b1", name: "Bob", role: ${JSON.stringify(roles.member ?? roles.admin)} };
const carol: Principal = { id: "00000000-0000-4000-8000-0000000000c1", name: "Carol", role: ${JSON.stringify(roles.member ?? roles.admin)} };

async function sql(statement: string): Promise<void> {
  const { client } = await import("../src/db");
  await ${exec};
}

async function setup() {
  await sql(ddl);
  const { createSavedViewsRoutes } = await import("../src/saved-views");
  let current: Principal | undefined = alice;
  const app = new Elysia().use(createSavedViewsRoutes(async () => current ?? null));
  const request = (user: Principal | undefined, path: string, init?: RequestInit) => { current = user; return app.handle(new Request("http://localhost" + path, init)); };
  const list = async (user: Principal): Promise<QiySavedView[]> => {
    const response = await request(user, "/api/v1/saved-views?resource=" + resource);
    expect(response.status).toBe(200);
    return ((await response.json()) as { items: QiySavedView[] }).items;
  };
  const create = (user: Principal, body: Record<string, unknown>) => request(user, "/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, ...body }) });
  const remove = (user: Principal | undefined, id: string) => request(user, "/api/v1/saved-views/" + id, { method: "DELETE" });
  return { request, list, create, remove };
}

test.skipIf(!available)("publishing the same name twice upserts one row and reports ownership", async () => {
  const { list, create } = await setup();
  const first = await create(alice, { name: "open-items", shared: true, search: "one", columns: ["id"] });
  expect(first.status).toBe(201);
  const created = (await first.json()) as QiySavedView;
  expect(created).toMatchObject({ resource, name: "open-items", ownerId: alice.id, shared: true, mine: true, search: "one", columns: ["id"] });

  // Republishing the same name keeps the id and replaces the stored payload.
  const second = await create(alice, { name: "open-items", shared: true, search: "two", columns: ["id", "title"] });
  expect(second.status).toBe(201);
  const updated = (await second.json()) as QiySavedView;
  expect(updated.id).toBe(created.id);
  expect(updated).toMatchObject({ search: "two", columns: ["id", "title"] });
  expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());

  // Exactly one row survives, and another user sees the shared copy flagged as not mine.
  expect((await list(alice)).filter((view) => view.name === "open-items")).toHaveLength(1);
  const sharedCopies = (await list(carol)).filter((view) => view.name === "open-items");
  expect(sharedCopies).toHaveLength(1);
  expect(sharedCopies[0]).toMatchObject({ id: created.id, ownerId: alice.id, mine: false });

  // Private views never leak into another user's list.
  await create(alice, { name: "admin-only" });
  expect((await list(carol)).some((view) => view.name === "admin-only")).toBe(false);
});

test.skipIf(!available)("owners and admins delete views while others get 403, 404 or 401", async () => {
  const { list, create, remove } = await setup();
  const adminView = (await (await create(alice, { name: "admin-private" })).json()) as QiySavedView;
  const bobShared = (await (await create(bob, { name: "bob-shared", shared: true })).json()) as QiySavedView;

  // A non-owner cannot delete another user's row, even a shared one.
${roles.member ? "  expect((await remove(bob, adminView.id)).status).toBe(403);" : ""}
  // An admin may clean up another user's shared row.
  expect((await remove(alice, bobShared.id)).status).toBe(204);
  expect((await list(bob)).some((view) => view.id === bobShared.id)).toBe(false);
  // Owners delete their own rows; deleting twice is a 404.
  const ownView = (await (await create(bob, { name: "bob-own" })).json()) as QiySavedView;
  expect((await remove(bob, ownView.id)).status).toBe(204);
  expect((await remove(bob, ownView.id)).status).toBe(404);
  // Anonymous deletes are rejected before ownership is considered.
  expect((await remove(undefined, adminView.id)).status).toBe(401);
  expect((await list(alice)).some((view) => view.id === adminView.id)).toBe(true);
});

test.skipIf(!available)("validates the resource, the name and the caller", async () => {
  const { request, create } = await setup();
  expect((await request(undefined, "/api/v1/saved-views?resource=" + resource)).status).toBe(401);
  expect((await request(alice, "/api/v1/saved-views?resource=not-a-resource")).status).toBe(400);
  expect((await create(alice, { name: "   " })).status).toBe(400);
  expect((await create(alice, { name: "wrong-resource", resource: "not-a-resource" })).status).toBe(400);
  const anonymous = await request(undefined, "/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, name: "anonymous" }) });
  expect(anonymous.status).toBe(401);
});

test.skipIf(!available)("caps distinct view names but keeps upserting existing names", async () => {
  const { list, create } = await setup();
  // The test principal is unique, so it owns exactly the rows created here.
  await sql(carolRows);
  for (let index = 0; index < 100; index++) expect((await create(carol, { name: "bulk-" + index })).status).toBe(201);
  const rejected = await create(carol, { name: "one-too-many" });
  expect(rejected.status).toBe(400);
  expect(((await rejected.json()) as { errorKey?: string }).errorKey).toBe("views.limit");
  // Republishing an existing name updates in place and is not blocked by the cap.
  expect((await create(carol, { name: "bulk-0", search: "updated" })).status).toBe(201);
  const own = (await list(carol)).filter((view) => view.ownerId === carol.id && view.resource === resource);
  expect(own).toHaveLength(100);
  expect(own.find((view) => view.name === "bulk-0")?.search).toBe("updated");
});
`;
}

/**
 * Job store shared by every generated import route. Import can take longer than a
 * request should, so `POST /import?async=1` records the job here and the caller
 * polls `GET /import/jobs/:id`; the table is generated for every application.
 */
export function renderImportJobsModule(dialect: DatabaseIR["dialect"]): string {
  const sqlite = dialect === "sqlite";
  const dateValue = sqlite ? "new Date()" : dialect === "mysql" ? "new Date()" : "new Date()";
  return `import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { qiyImportJobs } from "./schema";

export type QiyImportJobStatus = "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";

export interface QiyImportJob {
  id: string;
  resource: string;
  status: QiyImportJobStatus;
  total: number;
  processed: number;
  failed: number;
  errors: string[];
  actorId: string | null;
  createdAt: string;
  updatedAt: string;
}

type QiyImportJobRow = typeof qiyImportJobs.$inferSelect;

function toJob(row: QiyImportJobRow): QiyImportJob {
  const iso = (value: Date | number | string) => value instanceof Date ? value.toISOString() : new Date(Number(value)).toISOString();
  return {
    id: row.id,
    resource: row.resource,
    status: row.status as QiyImportJobStatus,
    total: Number(row.total),
    processed: Number(row.processed),
    failed: Number(row.failed),
    errors: row.errors ? (JSON.parse(row.errors) as string[]) : [],
    actorId: row.actorId ?? null,
    createdAt: iso(row.createdAt as Date | number),
    updatedAt: iso(row.updatedAt as Date | number),
  };
}

export async function createImportJob(input: { resource: string; total: number; actorId: string | null; payload?: string }): Promise<string> {
  const id = crypto.randomUUID();
  const values = { id, resource: input.resource, status: "queued", total: input.total, processed: 0, failed: 0, errors: null, actorId: input.actorId, payload: input.payload ?? null, leaseOwner: null, leaseUntil: null, createdAt: ${dateValue}, updatedAt: ${dateValue} };
  ${sqlite ? "db.insert(qiyImportJobs).values(values).run();" : "await db.insert(qiyImportJobs).values(values);"}
  return id;
}

export async function updateImportJob(id: string, patch: { status?: QiyImportJobStatus; processed?: number; failed?: number; errors?: string[]; releaseLease?: boolean }): Promise<void> {
  const values = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.processed !== undefined ? { processed: patch.processed } : {}),
    ...(patch.failed !== undefined ? { failed: patch.failed } : {}),
    ...(patch.errors ? { errors: JSON.stringify(patch.errors) } : {}),
    updatedAt: ${dateValue},
  };
  ${sqlite ? "db.update(qiyImportJobs).set(values).where(eq(qiyImportJobs.id, id)).run();" : "await db.update(qiyImportJobs).set(values).where(eq(qiyImportJobs.id, id));"}
}

export async function readImportJob(id: string): Promise<QiyImportJob | undefined> {
  ${sqlite ? "const row = db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, id)).get();" : "const [row] = await db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, id)).limit(1);"}
  return row ? toJob(row as QiyImportJobRow) : undefined;
}


/**
 * Claims the oldest runnable job for a resource. The conditional update means two
 * replicas racing for the same row cannot both win; the loser sees a different owner.
 */
export async function claimImportJob(resource: string, workerId: string, leaseUntil: Date, jobId?: string): Promise<(QiyImportJob & { payload: string }) | undefined> {
  ${sqlite ? `const candidates = db.select().from(qiyImportJobs).where(and(eq(qiyImportJobs.resource, resource), eq(qiyImportJobs.status, "queued"))).orderBy(qiyImportJobs.createdAt).all();` : dialect === "mysql" ? `const candidates = await db.select().from(qiyImportJobs).where(and(eq(qiyImportJobs.resource, resource), eq(qiyImportJobs.status, "queued"))).orderBy(qiyImportJobs.createdAt);` : `const candidates = await db.select().from(qiyImportJobs).where(and(eq(qiyImportJobs.resource, resource), eq(qiyImportJobs.status, "queued"))).orderBy(qiyImportJobs.createdAt);`}
  const candidate = candidates.find((row) => Boolean(row.payload) && (!jobId || row.id === jobId));
  if (!candidate) return undefined;
  const now = new Date();
  ${sqlite ? `db.update(qiyImportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: now }).where(and(eq(qiyImportJobs.id, candidate.id), eq(qiyImportJobs.status, "queued"))).run();` : `await db.update(qiyImportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: now }).where(and(eq(qiyImportJobs.id, candidate.id), eq(qiyImportJobs.status, "queued")));`}
  ${sqlite ? `const claimed = db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, candidate.id)).get();` : `const [claimed] = await db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, candidate.id)).limit(1);`}
  if (!claimed || claimed.leaseOwner !== workerId || !claimed.payload) return undefined;
  return { ...toJob(claimed as QiyImportJobRow), payload: claimed.payload };
}

/** Lists recent jobs for a resource so a worker can find queued work. */
export async function listImportJobs(resource: string, limit = 50): Promise<QiyImportJob[]> {
  ${sqlite ? `const rows = db.select().from(qiyImportJobs).where(eq(qiyImportJobs.resource, resource)).orderBy(desc(qiyImportJobs.createdAt)).all();` : `const rows = await db.select().from(qiyImportJobs).where(eq(qiyImportJobs.resource, resource)).orderBy(desc(qiyImportJobs.createdAt));`}
  return rows.slice(0, limit).map((row) => toJob(row as QiyImportJobRow));
}
/** Marks a queued/running job as cancelled; finished jobs report notRunning. */
export async function requestImportJobCancel(id: string): Promise<"cancelled" | "notRunning" | "missing"> {
  const job = await readImportJob(id);
  if (!job) return "missing";
  if (job.status !== "queued" && job.status !== "running") return "notRunning";
  ${sqlite ? `db.update(qiyImportJobs).set({ status: "cancelling", updatedAt: ${dateValue} }).where(eq(qiyImportJobs.id, id)).run();` : `await db.update(qiyImportJobs).set({ status: "cancelling", updatedAt: ${dateValue} }).where(eq(qiyImportJobs.id, id));`}
  return "cancelled";
}

/** Cheap status probe used between rows so a cancelled import stops promptly. */
export async function isImportJobCancelled(id: string): Promise<boolean> {
  const job = await readImportJob(id);
  return job?.status === "cancelling" || job?.status === "cancelled";
}

/**
 * A crashed process leaves running jobs behind forever, so status and cancel calls
 * first age out jobs whose progress has not moved within the stale window.
 */
export async function releaseStaleImportJobs(now: Date = new Date()): Promise<number> {
  const configured = Number(Bun.env.QIY_IMPORT_JOB_STALE_MS ?? 300000);
  const staleMs = Number.isSafeInteger(configured) && configured >= 1000 ? configured : 300000;
  const cutoff = new Date(now.getTime() - staleMs);
  ${sqlite ? "const candidates = db.select().from(qiyImportJobs).all();" : "const candidates = await db.select().from(qiyImportJobs);"}
  const stale = candidates.filter((row) => (row.status === "queued" || row.status === "running") && row.updatedAt instanceof Date && row.updatedAt < cutoff);
  for (const row of stale) {
    ${sqlite ? `db.update(qiyImportJobs).set({ status: "failed", errors: JSON.stringify(["Stale import job timed out"]), updatedAt: ${dateValue} }).where(eq(qiyImportJobs.id, row.id)).run();` : `await db.update(qiyImportJobs).set({ status: "failed", errors: JSON.stringify(["Stale import job timed out"]), updatedAt: ${dateValue} }).where(eq(qiyImportJobs.id, row.id));`}
  }
  return stale.length;
}
`;
}

export function renderRealtime(config: NonNullable<QiyProject["realtime"]>, dataflows: NonNullable<QiyProject["dataflows"]>, roles: RoleContext): string {
  const subscriptions = JSON.stringify(config.resources);
  const eventRoles = new Map<string, Set<string>>();
  const writers = roles.writers;
  for (const flow of dataflows) {
    for (const action of flow.steps.flatMap((step) => step.actions)) {
      if (action.kind !== "emit") continue;
      const roles = eventRoles.get(action.event) ?? new Set<string>();
      for (const role of flow.roles ?? writers) roles.add(role);
      eventRoles.set(action.event, roles);
    }
  }
  const eventSubscriptions = JSON.stringify([...eventRoles].map(([event, roles]) => ({ event, roles: [...roles] })));
  return `import { Elysia } from "elysia";
import { asc, count, gte, lt } from "drizzle-orm";
import { db } from "./db";
import { realtimeOutbox } from "./schema";
import { publishRealtimeEvent, subscribeRealtimeEvents, type QiyRealtimeBusEvent } from "./realtime-bus";
import type { Authenticator, Principal } from "./auth/guard";

export type QiyRealtimeEvent = "created" | "updated" | "deleted";
export interface QiyRealtimeSubscription { resource: string; events: string[]; roles: string[]; claim?: { field: string; claim: string } }
export interface QiyRealtimeEventSubscription { event: string; roles: string[] }
// Declared element types: an empty capability list must still be typed, otherwise
// an empty const array becomes readonly never[] and the generated server fails tsc.
export const qiyRealtimeSubscriptions: readonly QiyRealtimeSubscription[] = ${subscriptions};
export const qiyRealtimeEventSubscriptions: readonly QiyRealtimeEventSubscription[] = ${eventSubscriptions};

function realtimeInteger(name: "QIY_REALTIME_POLL_MS" | "QIY_REALTIME_RETENTION_DAYS" | "QIY_REALTIME_CLEANUP_MS", fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = Number(Bun.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(name + " must be an integer from " + minimum + " to " + maximum);
  return value;
}

/** Row-scoped channels append the subscriber's claim value: qiy:orders:eu. */
export function realtimeChannel(resource: string, claimValue?: string | number | null): string {
  return claimValue === undefined || claimValue === null || claimValue === "" ? "qiy:" + resource : "qiy:" + resource + ":" + String(claimValue);
}

export function realtimeCapabilities(principal: Principal): Record<string, string[]> {
  return Object.fromEntries([
    ...qiyRealtimeSubscriptions
      .filter((subscription) => (subscription.roles as readonly string[]).includes(principal.role))
      // A claim-scoped resource grants only the caller's own segment; a missing claim grants nothing.
      .flatMap((subscription): Array<[string, string[]]> => {
        if (!subscription.claim) return [["qiy:" + subscription.resource, ["subscribe"]]];
        const value = principal.claims?.[subscription.claim.claim];
        if (value === undefined || value === null || value === "") return [];
        return [[realtimeChannel(subscription.resource, value as string | number), ["subscribe"]]];
      }),
    ...qiyRealtimeEventSubscriptions
      .filter((subscription) => (subscription.roles as readonly string[]).includes(principal.role))
      .map((subscription): [string, string[]] => ["qiy:event:" + subscription.event, ["subscribe"]]),
  ]);
}

// Rows stay in the read window this long, so a transaction that commits after a
// newer one (or on a replica with a slightly skewed clock) is still delivered.
const lookbackMs = 5000;
let cursor = new Date();
// Rows written before the poller started belong to no current subscriber.
let startedAt = cursor.getTime();
const seen = new Map<string, number>();
let subscribers = 0;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let polling: Promise<void> | undefined;
let pollAgain = false;

async function readOutbox(): Promise<void> {
  try {
    const rows = await db.select().from(realtimeOutbox)
      .where(gte(realtimeOutbox.createdAt, new Date(cursor.getTime() - lookbackMs)))
      .orderBy(asc(realtimeOutbox.createdAt), asc(realtimeOutbox.id))
      .limit(1000);
    for (const row of rows) {
      const createdAt = new Date(row.createdAt).getTime();
      if (createdAt > cursor.getTime()) cursor = new Date(createdAt);
      if (seen.has(row.id)) continue;
      seen.set(row.id, createdAt);
      if (createdAt < startedAt) continue;
      let record: Record<string, unknown> = {};
      try { record = JSON.parse(row.payload) as Record<string, unknown>; } catch { record = {}; }
      publishRealtimeEvent({ id: row.id, channel: row.channel, event: row.type, record });
    }
    const horizon = cursor.getTime() - lookbackMs;
    for (const [id, createdAt] of seen) if (createdAt < horizon) seen.delete(id);
  } catch (error) {
    console.error("Realtime outbox poll failed", error);
  }
}

/**
 * Fans committed outbox rows out to this instance's subscribers. Every replica
 * tails the same table, so an event written by any instance reaches every
 * connected browser; services call this right after a commit for low latency.
 */
export function pollRealtimeOutbox(): Promise<void> {
  if (Bun.env.QIY_REALTIME_DISABLED === "1" || subscribers === 0) return Promise.resolve();
  if (polling) { pollAgain = true; return polling; }
  polling = (async () => {
    try { do { pollAgain = false; await readOutbox(); } while (pollAgain); }
    finally { polling = undefined; }
  })();
  return polling;
}

function retainPoller(): () => void {
  subscribers += 1;
  if (!pollTimer && Bun.env.QIY_REALTIME_DISABLED !== "1") {
    cursor = new Date();
    startedAt = cursor.getTime();
    seen.clear();
    pollTimer = setInterval(() => { void pollRealtimeOutbox(); }, realtimeInteger("QIY_REALTIME_POLL_MS", 1000, 100));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscribers -= 1;
    if (subscribers === 0 && pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
  };
}

export type QiyRealtimeIterator = AsyncIterableIterator<QiyRealtimeBusEvent> & { close: () => void };

/** Events on the given channels as an async iterator; closing it releases the shared poller. */
export function realtimeChannelIterator(channels: string | readonly string[]): QiyRealtimeIterator {
  const accepted = new Set<string>(typeof channels === "string" ? [channels] : channels);
  const queue: QiyRealtimeBusEvent[] = [];
  let pending: ((result: IteratorResult<QiyRealtimeBusEvent>) => void) | undefined;
  let closed = false;
  const release = retainPoller();
  const unsubscribe = subscribeRealtimeEvents((event) => {
    if (closed || !accepted.has(event.channel)) return;
    const resolve = pending;
    if (resolve) { pending = undefined; resolve({ value: event, done: false }); }
    else if (queue.length < 1000) queue.push(event);
  });
  const stop = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    release();
    const resolve = pending;
    pending = undefined;
    resolve?.({ value: undefined as never, done: true });
  };
  const iterator: QiyRealtimeIterator = {
    close: stop,
    [Symbol.asyncIterator]() { return iterator; },
    next() {
      if (closed) return Promise.resolve({ value: undefined as never, done: true });
      const queued = queue.shift();
      if (queued) return Promise.resolve({ value: queued, done: false });
      return new Promise<IteratorResult<QiyRealtimeBusEvent>>((resolve) => { pending = resolve; });
    },
    return() { stop(); return Promise.resolve({ value: undefined as never, done: true }); },
  };
  return iterator;
}

export function realtimeCleanupCutoff(retentionDays: number, now = new Date()): Date {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("Realtime retention days must be an integer from 1 to 3650");
  return new Date(now.getTime() - retentionDays * 86400000);
}

/** Outbox rows only need to outlive the read window; older rows are removed. */
export async function cleanupRealtimeOutbox(retentionDays = realtimeInteger("QIY_REALTIME_RETENTION_DAYS", 1, 1, 3650), now = new Date()): Promise<number> {
  const cutoff = realtimeCleanupCutoff(retentionDays, now);
  const [row] = await db.select({ value: count() }).from(realtimeOutbox).where(lt(realtimeOutbox.createdAt, cutoff));
  const total = Number(row?.value ?? 0);
  if (total > 0) await db.delete(realtimeOutbox).where(lt(realtimeOutbox.createdAt, cutoff));
  return total;
}

export function startRealtimeOutboxCleanup(): ReturnType<typeof setInterval> | undefined {
  if (Bun.env.QIY_REALTIME_DISABLED === "1") return undefined;
  const cleanup = () => void cleanupRealtimeOutbox()
    .then((deleted) => { if (deleted > 0) console.info("Realtime outbox cleanup removed " + deleted + " record(s)"); })
    .catch((error) => console.error("Realtime outbox cleanup failed", error));
  cleanup();
  const timer = setInterval(cleanup, realtimeInteger("QIY_REALTIME_CLEANUP_MS", 3600000, 60000));
  timer.unref?.();
  return timer;
}

/**
 * GET /api/v1/realtime/stream: one authenticated text/event-stream carrying every
 * channel the caller is granted. The first frame (event: ready) lists them.
 */
export function createRealtimeRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/realtime" }).get("/stream", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    const channels = Object.keys(realtimeCapabilities(principal));
    if (!channels.length) return status(403, { error: "Realtime subscription is not permitted" });
    if (Bun.env.QIY_REALTIME_DISABLED === "1") return status(503, { error: "Realtime is disabled" });
    const events = realtimeChannelIterator(channels);
    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    request.signal?.addEventListener("abort", () => events.close());
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("event: ready\\ndata: " + JSON.stringify({ channels }) + "\\n\\n"));
        heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(": keep-alive\\n\\n")); } catch { /* stream closed */ } }, 25000);
        try {
          for await (const event of events) controller.enqueue(encoder.encode("event: " + event.event + "\\ndata: " + JSON.stringify(event) + "\\n\\n"));
        } catch { /* the client went away */ } finally {
          if (heartbeat) clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
        events.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  });
}
`;
}
