import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, users } from "../schema";
import type { AuditQuery } from "./routes";

export async function readAudit(query: AuditQuery) {
  const condition = and(eq(auditEvents.resource, query.resource), query.resourceId === undefined ? undefined : eq(auditEvents.resourceId, query.resourceId), query.action === undefined ? undefined : eq(auditEvents.action, query.action), query.actorId === undefined ? undefined : eq(auditEvents.actorId, query.actorId));
  const rows = await db.select({ id: auditEvents.id, actorId: auditEvents.actorId, action: auditEvents.action, resource: auditEvents.resource, resourceId: auditEvents.resourceId, createdAt: auditEvents.createdAt, authorId: users.id, authorName: users.displayName }).from(auditEvents).leftJoin(users, eq(auditEvents.actorId, users.id)).where(condition).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
  const totals = await db.select({ total: count() }).from(auditEvents).where(condition);
  return { data: rows.map((row) => ({ id: row.id, resource: row.resource, action: row.action, createdAt: row.createdAt.toISOString(), author: row.actorId ? { id: row.actorId, name: row.authorName ?? row.actorId, deleted: row.authorId === null } : null, meta: { id: row.resourceId } })), total: Number(totals[0]?.total ?? 0) };
}
