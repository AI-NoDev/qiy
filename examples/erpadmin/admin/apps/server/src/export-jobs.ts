import { and, desc, eq } from "drizzle-orm";
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
  const values = { id, resource: input.resource, status: "queued", total: input.total, processed: 0, payload: input.payload ?? null, errors: null, actorId: input.actorId, leaseOwner: null, leaseUntil: null, createdAt: new Date(), updatedAt: new Date() };
  await db.insert(qiyExportJobs).values(values);
  return id;
}

export async function updateExportJob(id: string, patch: { status?: QiyExportJobStatus; processed?: number; payload?: string; result?: string; errors?: string[]; releaseLease?: boolean }): Promise<void> {
  const values = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.processed !== undefined ? { processed: patch.processed } : {}),
    ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
    ...(patch.result !== undefined ? { result: patch.result } : {}),
    ...(patch.errors ? { errors: JSON.stringify(patch.errors) } : {}),
    updatedAt: new Date(),
  };
  await db.update(qiyExportJobs).set(values).where(eq(qiyExportJobs.id, id));
}

export async function readExportJob(id: string): Promise<(QiyExportJob & { payload?: string; result?: string }) | undefined> {
  const [row] = await db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, id)).limit(1);
  if (!row) return undefined;
  const job = toJob(row as QiyExportJobRow);
  const payload = (row as QiyExportJobRow).payload;
  const result = (row as QiyExportJobRow).result;
  return { ...job, ...(payload ? { payload } : {}), ...(result ? { result } : {}) };
}

/** Claims one export job with a conditional update so replicas cannot both run it. */
export async function claimExportJob(resource: string, workerId: string, leaseUntil: Date, jobId?: string): Promise<(QiyExportJob & { payload: string }) | undefined> {
  const candidates = await db.select().from(qiyExportJobs).where(and(eq(qiyExportJobs.resource, resource), eq(qiyExportJobs.status, "queued"))).orderBy(qiyExportJobs.createdAt);
  const candidate = candidates.find((row) => Boolean(row.payload) && (!jobId || row.id === jobId));
  if (!candidate) return undefined;
  await db.update(qiyExportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: new Date() }).where(and(eq(qiyExportJobs.id, candidate.id), eq(qiyExportJobs.status, "queued")));
  const [claimed] = await db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, candidate.id)).limit(1);
  if (!claimed || claimed.leaseOwner !== workerId || !claimed.payload) return undefined;
  return { ...toJob(claimed as QiyExportJobRow), payload: claimed.payload };
}

/** Lists recent export jobs for a resource so a worker can find queued work. */
export async function listExportJobs(resource: string, limit = 50): Promise<QiyExportJob[]> {
  const rows = await db.select().from(qiyExportJobs).where(eq(qiyExportJobs.resource, resource)).orderBy(desc(qiyExportJobs.createdAt));
  return rows.slice(0, limit).map((row) => toJob(row as QiyExportJobRow));
}
