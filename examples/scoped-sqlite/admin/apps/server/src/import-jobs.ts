import { and, desc, eq } from "drizzle-orm";
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
  const values = { id, resource: input.resource, status: "queued", total: input.total, processed: 0, failed: 0, errors: null, actorId: input.actorId, payload: input.payload ?? null, leaseOwner: null, leaseUntil: null, createdAt: new Date(), updatedAt: new Date() };
  db.insert(qiyImportJobs).values(values).run();
  return id;
}

export async function updateImportJob(id: string, patch: { status?: QiyImportJobStatus; processed?: number; failed?: number; errors?: string[]; releaseLease?: boolean }): Promise<void> {
  const values = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.processed !== undefined ? { processed: patch.processed } : {}),
    ...(patch.failed !== undefined ? { failed: patch.failed } : {}),
    ...(patch.errors ? { errors: JSON.stringify(patch.errors) } : {}),
    updatedAt: new Date(),
  };
  db.update(qiyImportJobs).set(values).where(eq(qiyImportJobs.id, id)).run();
}

export async function readImportJob(id: string): Promise<QiyImportJob | undefined> {
  const row = db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, id)).get();
  return row ? toJob(row as QiyImportJobRow) : undefined;
}


/**
 * Claims the oldest runnable job for a resource. The conditional update means two
 * replicas racing for the same row cannot both win; the loser sees a different owner.
 */
export async function claimImportJob(resource: string, workerId: string, leaseUntil: Date, jobId?: string): Promise<(QiyImportJob & { payload: string }) | undefined> {
  const candidates = db.select().from(qiyImportJobs).where(and(eq(qiyImportJobs.resource, resource), eq(qiyImportJobs.status, "queued"))).orderBy(qiyImportJobs.createdAt).all();
  const candidate = candidates.find((row) => Boolean(row.payload) && (!jobId || row.id === jobId));
  if (!candidate) return undefined;
  const now = new Date();
  db.update(qiyImportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: now }).where(and(eq(qiyImportJobs.id, candidate.id), eq(qiyImportJobs.status, "queued"))).run();
  const claimed = db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, candidate.id)).get();
  if (!claimed || claimed.leaseOwner !== workerId || !claimed.payload) return undefined;
  return { ...toJob(claimed as QiyImportJobRow), payload: claimed.payload };
}

/** Lists recent jobs for a resource so a worker can find queued work. */
export async function listImportJobs(resource: string, limit = 50): Promise<QiyImportJob[]> {
  const rows = db.select().from(qiyImportJobs).where(eq(qiyImportJobs.resource, resource)).orderBy(desc(qiyImportJobs.createdAt)).all();
  return rows.slice(0, limit).map((row) => toJob(row as QiyImportJobRow));
}
/** Marks a queued/running job as cancelled; finished jobs report notRunning. */
export async function requestImportJobCancel(id: string): Promise<"cancelled" | "notRunning" | "missing"> {
  const job = await readImportJob(id);
  if (!job) return "missing";
  if (job.status !== "queued" && job.status !== "running") return "notRunning";
  db.update(qiyImportJobs).set({ status: "cancelling", updatedAt: new Date() }).where(eq(qiyImportJobs.id, id)).run();
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
  const candidates = db.select().from(qiyImportJobs).all();
  const stale = candidates.filter((row) => (row.status === "queued" || row.status === "running") && row.updatedAt instanceof Date && row.updatedAt < cutoff);
  for (const row of stale) {
    db.update(qiyImportJobs).set({ status: "failed", errors: JSON.stringify(["Stale import job timed out"]), updatedAt: new Date() }).where(eq(qiyImportJobs.id, row.id)).run();
  }
  return stale.length;
}
