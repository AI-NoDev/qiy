import { Elysia, t } from "elysia";
import type { Authenticator } from "../auth/guard";

export type AuditQuery = { resource: string; resourceId?: string; action?: string; actorId?: string; page: number; pageSize: number };
export type AuditReader = (query: AuditQuery) => Promise<{ data: unknown[]; total: number }>;
const resources = new Set<string>(["users","orgs","suppliers","customers","products","boms","warehouses","bins","inventory","stock_movements","purchase_orders","purchase_order_lines","receipts","sales_orders","sales_order_lines","shipments","work_orders"]);
const scopedResources = new Set<string>(["warehouses"]);
export function createAuditRoutes(authenticate: Authenticator, read: AuditReader = async (query) => (await import("./repository")).readAudit(query)) {
  return new Elysia({ prefix: "/api/v1/audit-logs" }).get("/", async ({ request, query, status, set }) => {
    set.headers["Cache-Control"] = "no-store";
    let principal;
    try { principal = await authenticate(request); } catch { return status(401, { error: "Invalid credentials" }); }
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Audit history is restricted to administrators" });
    if (!resources.has(query.resource)) return status(400, { error: "Unknown audit resource" });
    if (scopedResources.has(query.resource)) return status(403, { error: "Tenant audit history requires persisted scope metadata" });
    return read({ ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 20 });
  }, { query: t.Object({ resource: t.String(), resourceId: t.Optional(t.String({ maxLength: 200 })), action: t.Optional(t.String({ maxLength: 200 })), actorId: t.Optional(t.String({ format: "uuid" })), page: t.Optional(t.Numeric({ minimum: 1, maximum: 1000000, multipleOf: 1 })), pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })) }), detail: { tags: ["Audit"], summary: "Read authoritative resource audit history" } });
}
