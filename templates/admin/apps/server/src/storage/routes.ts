import { Elysia, t } from "elysia";
import type { Authenticator } from "../auth/guard";
import { createStorageFromEnv, storageKey } from "./index";

type AttachmentMetadata = { id: string; storageKey: string; fileName: string | null; contentType: string; size: number; ownerId: string; resource: string; resourceId: string | null; createdAt: string };
const memoryMetadata = new Map<string, AttachmentMetadata>();
let databasePromise: Promise<{ db: any; attachments: any; eq: any } | null> | undefined;

async function databaseHandle(): Promise<{ db: any; attachments: any; eq: any } | null> {
  if (Bun.env.QIY_STORAGE_METADATA !== "database") return null;
  if (!Bun.env.DATABASE_URL) throw new Error("DATABASE_URL is required for attachment metadata");
  databasePromise ??= (async () => {
    const [{ db }, schema, { eq }] = await Promise.all([import("../db"), import("../schema"), import("drizzle-orm")]);
    return { db, attachments: schema.attachments, eq };
  })();
  return databasePromise;
}

async function saveMetadata(metadata: AttachmentMetadata): Promise<void> {
  const handle = await databaseHandle();
  if (handle) await handle.db.insert(handle.attachments).values({ id: metadata.id, storageKey: metadata.storageKey, fileName: metadata.fileName, contentType: metadata.contentType, size: metadata.size, ownerId: metadata.ownerId, resource: metadata.resource, resourceId: metadata.resourceId });
  memoryMetadata.set(metadata.storageKey, metadata);
}

async function removeMetadata(key: string): Promise<void> {
  memoryMetadata.delete(key);
  const handle = await databaseHandle();
  if (handle) await handle.db.delete(handle.attachments).where(handle.eq(handle.attachments.storageKey, key));
}

async function readMetadata(key: string): Promise<AttachmentMetadata | undefined> {
  const handle = await databaseHandle();
  if (handle) {
    const [row] = await handle.db.select().from(handle.attachments).where(handle.eq(handle.attachments.storageKey, key)).limit(1);
    if (row) return { ...row, createdAt: new Date(row.createdAt).toISOString() } as AttachmentMetadata;
  }
  return memoryMetadata.get(key);
}

export async function cleanupMissingAttachmentObjects(options: { dryRun?: boolean; limit?: number } = {}): Promise<{ checked: number; removed: number; dryRun: boolean }> {
  const handle = await databaseHandle();
  if (!handle) throw new Error("Attachment cleanup requires QIY_STORAGE_METADATA=database and DATABASE_URL");
  const storage = createStorageFromEnv();
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 10000));
  const rows = await handle.db.select().from(handle.attachments).limit(limit) as Array<{ id: string; storageKey: string }>;
  let removed = 0;
  for (const row of rows) {
    const key = storageKey(row.storageKey);
    if (await storage.exists(key)) continue;
    removed++;
    if (!options.dryRun) await handle.db.delete(handle.attachments).where(handle.eq(handle.attachments.id, row.id));
  }
  return { checked: rows.length, removed, dryRun: options.dryRun ?? true };
}

function canReadAttachment(principal: { id: string; role: string }, metadata: AttachmentMetadata | undefined): boolean {
  return principal.role === "admin" || metadata?.ownerId === principal.id;
}

function failure(status: (code: number, body: unknown) => unknown, code: number, message: string) {
  return status(code, { error: message });
}

export function createStorageRoutes(authenticate: Authenticator) {
  const storage = createStorageFromEnv();
  return new Elysia({ prefix: "/api/v1/files" })
    .get("/", async ({ query, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return failure(status, 401, "Authentication required");
      try {
        const key = storageKey(query.key);
        const metadata = await readMetadata(key);
        if (!metadata || !canReadAttachment(principal, metadata)) return failure(status, 404, "File not found");
        if (!await storage.exists(key)) return failure(status, 404, "File not found");
        return new Response(storage.open(key));
      } catch { return failure(status, 400, "Invalid storage key"); }
    }, { query: t.Object({ key: t.String({ minLength: 1, maxLength: 240 }) }) })
    .post("/", async ({ query, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || (principal.role !== "admin" && principal.role !== "operator")) return failure(status, 403, "Permission denied");
      try {
        const key = storageKey(query.key);
        if (await readMetadata(key) || await storage.exists(key)) return failure(status, 409, "Storage key already exists");
        const content = await request.blob();
        if (content.size > 25 * 1024 * 1024) return failure(status, 413, "File is too large");
        await storage.save(key, content);
        const metadata: AttachmentMetadata = { id: crypto.randomUUID(), storageKey: key, fileName: query.fileName ?? null, contentType: content.type || query.contentType || "application/octet-stream", size: content.size, ownerId: principal.id, resource: query.resource ?? "unbound", resourceId: query.resourceId ?? null, createdAt: new Date().toISOString() };
        try { await saveMetadata(metadata); }
        catch (error) { await storage.delete(key); throw error; }
        return { ...metadata };
      } catch { return failure(status, 400, "Invalid storage key or file"); }
    }, { query: t.Object({ key: t.String({ minLength: 1, maxLength: 240 }), fileName: t.Optional(t.String({ maxLength: 255 })), contentType: t.Optional(t.String({ maxLength: 255 })), resource: t.Optional(t.String({ maxLength: 160 })), resourceId: t.Optional(t.String({ maxLength: 160 })) }) })
    .get("/metadata", async ({ query, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return failure(status, 401, "Authentication required");
      try {
        const key = storageKey(query.key);
        const metadata = await readMetadata(key);
        return metadata && canReadAttachment(principal, metadata) ? metadata : failure(status, 404, "Attachment metadata not found");
      } catch { return failure(status, 400, "Invalid storage key"); }
    }, { query: t.Object({ key: t.String({ minLength: 1, maxLength: 240 }) }) })
    .get("/signed", async ({ query, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return failure(status, 401, "Authentication required");
      try {
        const key = storageKey(query.key);
        const metadata = await readMetadata(key);
        if (!metadata || !canReadAttachment(principal, metadata) || !await storage.exists(key)) return failure(status, 404, "File not found");
        return { url: storage.signedUrl(key, "GET") };
      } catch { return failure(status, 400, "Invalid storage key"); }
    }, { query: t.Object({ key: t.String({ minLength: 1, maxLength: 240 }) }) })
    .delete("/", async ({ query, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || principal.role !== "admin") return failure(status, 403, "Permission denied");
      try { const key = storageKey(query.key); await storage.delete(key); await removeMetadata(key); return { deleted: true }; }
      catch { return failure(status, 400, "Invalid storage key"); }
    }, { query: t.Object({ key: t.String({ minLength: 1, maxLength: 240 }) }) });
}
