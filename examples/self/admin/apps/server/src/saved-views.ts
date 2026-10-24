import { and, desc, eq, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "./db";
import { qiySavedViews } from "./schema";
import type { Authenticator, Principal } from "./auth/guard";

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

const viewResources = ["users","orgs","suppliers","customers","products","boms","purchase_orders","purchase_order_lines","receipts","sales_orders","sales_order_lines","shipments","warehouses","bins","inventory","stock_movements","work_orders"] as string[];
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
  const rows = db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, resource), or(eq(qiySavedViews.ownerId, principal.id), eq(qiySavedViews.shared, 1)))).orderBy(desc(qiySavedViews.updatedAt), desc(qiySavedViews.createdAt), desc(qiySavedViews.id)).all();
  return rows.map((row) => toView(row as typeof qiySavedViews.$inferSelect, principal.id));
}

export async function createSavedView(input: { resource: string; name: string; shared: boolean; search?: string; filters?: unknown[]; sorters?: unknown[]; columns?: string[]; principal: Principal }): Promise<QiySavedView> {
  const existing = db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, input.resource), eq(qiySavedViews.ownerId, input.principal.id))).all();
  // Publishing an existing name updates that row; only a new name counts toward the cap.
  // Rows duplicated by older releases are collapsed on the next publish.
  const duplicates = existing.filter((row) => row.name === input.name);
  const duplicate = duplicates[0];
  if (!duplicate && existing.length >= MAX_VIEWS_PER_RESOURCE) throw new Error("view.limit");
  const id = duplicate ? duplicate.id : crypto.randomUUID();
  const payload = {
    shared: input.shared ? 1 : 0,
    search: input.search ?? null,
    filters: input.filters ? JSON.stringify(input.filters) : null,
    sorters: input.sorters ? JSON.stringify(input.sorters) : null,
    columns: input.columns ? JSON.stringify(input.columns) : null,
    updatedAt: new Date(),
  };
  if (duplicate) {
    for (const extra of duplicates.slice(1)) db.delete(qiySavedViews).where(eq(qiySavedViews.id, extra.id)).run();
    db.update(qiySavedViews).set(payload).where(eq(qiySavedViews.id, id)).run();
  } else {
    db.insert(qiySavedViews).values({ id, resource: input.resource, name: input.name, ownerId: input.principal.id, createdAt: new Date(), ...payload }).run();
  }
  const row = db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).get();
  return toView(row as typeof qiySavedViews.$inferSelect, input.principal.id);
}

export async function deleteSavedView(id: string, principal: Principal): Promise<"deleted" | "missing" | "forbidden"> {
  const row = db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).get();
  if (!row) return "missing";
  // Owners delete their own rows; an admin may remove another user's shared row during cleanup.
  if (row.ownerId !== principal.id && principal.role !== "admin") return "forbidden";
  db.delete(qiySavedViews).where(eq(qiySavedViews.id, id)).run();
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
