import { Elysia, t } from "elysia";
import type { Authenticator } from "../auth/guard";
import { createStorageFromEnv, storageKey } from "./index";

type AttachmentMetadata = { id: string; storageKey: string; fileName: string | null; contentType: string; size: number; ownerId: string; resource: string; resourceId: string | null; createdAt: string };
type UploadPolicy = { mode: "binary" | "base64" | "both"; maxBytes: number; mimeTypes: string[]; maxFiles: number };
const uploadPolicies = __QIY_UPLOAD_POLICIES__ as Record<string, UploadPolicy>;
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
    return row ? { ...row, createdAt: new Date(row.createdAt).toISOString() } as AttachmentMetadata : undefined;
  }
  return memoryMetadata.get(key);
}

export async function cleanupMissingAttachmentObjects(options: { dryRun?: boolean; limit?: number } = {}): Promise<{ checked: number; removed: number; dryRun: boolean }> {
  const handle = await databaseHandle();
  if (!handle) throw new Error("Attachment cleanup requires QIY_STORAGE_METADATA=database and DATABASE_URL");
  const storage = createStorageFromEnv();
  const dryRun = options.dryRun ?? true;
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 10000));
  const rows = await handle.db.select().from(handle.attachments).limit(limit) as Array<{ id: string; storageKey: string }>;
  let removed = 0;
  for (const row of rows) {
    const key = storageKey(row.storageKey);
    if (await storage.exists(key)) continue;
    removed++;
    if (!dryRun) await handle.db.delete(handle.attachments).where(handle.eq(handle.attachments.id, row.id));
  }
  return { checked: rows.length, removed, dryRun };
}

/**
 * Finds stored objects that no attachment metadata references. Unlike
 * cleanupMissingAttachmentObjects (metadata without an object) this covers the
 * opposite direction, which is what a failed metadata write or a manual delete
 * leaves behind. It never deletes unless dryRun is false.
 */
export async function scanOrphanAttachmentObjects(options: { dryRun?: boolean; limit?: number } = {}): Promise<{ objects: number; metadata: number; orphans: string[]; missingObjects: number; removed: number; dryRun: boolean; truncated: boolean }> {
  const handle = await databaseHandle();
  if (!handle) throw new Error("Attachment orphan scanning requires QIY_STORAGE_METADATA=database and DATABASE_URL");
  const storage = createStorageFromEnv();
  const dryRun = options.dryRun ?? true;
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 10000));
  const rows = await handle.db.select().from(handle.attachments) as Array<{ storageKey: string }>;
  const known = new Set(rows.map((row) => row.storageKey));
  const objects = await storage.list();
  const orphans = objects.filter((key) => !known.has(key)).sort();
  const missingObjects = rows.filter((row) => !objects.includes(row.storageKey)).length;
  const removed = dryRun ? 0 : (await Promise.all(orphans.slice(0, limit).map((key) => storage.delete(key).then(() => 1)))).length;
  return { objects: objects.length, metadata: rows.length, orphans: orphans.slice(0, limit), missingObjects, removed, dryRun, truncated: orphans.length > limit };
}

function canReadAttachment(principal: { id: string; role: string }, metadata: AttachmentMetadata | undefined): boolean {
  return principal.role === "admin" || metadata?.ownerId === principal.id;
}

function failure(status: (code: number, body: unknown) => unknown, code: number, message: string) {
  return status(code, { error: message });
}

class UploadFailure extends Error { constructor(public readonly status: number, message: string) { super(message); } }
function uploadPolicy(resource: string, field: string): UploadPolicy {
  const policy = uploadPolicies[resource + "." + field];
  if (!policy) throw new UploadFailure(400, "Unknown file field");
  return policy;
}
function acceptsMime(policy: UploadPolicy, contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return policy.mimeTypes.some((mime) => mime === "*/*" || mime === normalized || (mime.endsWith("/*") && normalized.startsWith(mime.slice(0, -1))));
}
function decodeBase64(value: string, contentType: string): Blob {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new UploadFailure(400, "Invalid base64 file data");
  return new Blob([Buffer.from(value, "base64")], { type: contentType });
}

export function createStorageRoutes(authenticate: Authenticator) {
  const storage = createStorageFromEnv();
  const saveUpload = async (principal: { id: string }, query: { key: string; fileName?: string; contentType?: string; resource: string; resourceId?: string; field: string }, content: Blob, encoding: "binary" | "base64") => {
    const key = storageKey(query.key);
    const policy = uploadPolicy(query.resource, query.field);
    if (policy.mode !== "both" && policy.mode !== encoding) throw new UploadFailure(415, `File field does not accept ${encoding} uploads`);
    if (await readMetadata(key) || await storage.exists(key)) throw new UploadFailure(409, "Storage key already exists");
    if (content.size > policy.maxBytes) throw new UploadFailure(413, "File is too large");
    const contentType = (content.type || query.contentType || "application/octet-stream").toLowerCase();
    if (!acceptsMime(policy, contentType)) throw new UploadFailure(415, "File MIME type is not allowed");
    await storage.save(key, content);
    const metadata: AttachmentMetadata = { id: crypto.randomUUID(), storageKey: key, fileName: query.fileName ?? null, contentType, size: content.size, ownerId: principal.id, resource: query.resource, resourceId: query.resourceId ?? null, createdAt: new Date().toISOString() };
    try { await saveMetadata(metadata); }
    catch (error) { await storage.delete(key); throw error; }
    return metadata;
  };
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
        const content = await request.blob();
        return { ...await saveUpload(principal, query, content, "binary") };
      } catch (error) { return failure(status, error instanceof UploadFailure ? error.status : 400, error instanceof Error ? error.message : "Invalid storage key or file"); }
    }, { query: t.Object({ key: t.String({ minLength: 1, maxLength: 240 }), fileName: t.Optional(t.String({ maxLength: 255 })), contentType: t.Optional(t.String({ maxLength: 255 })), resource: t.String({ minLength: 1, maxLength: 160 }), resourceId: t.Optional(t.String({ maxLength: 160 })), field: t.String({ minLength: 1, maxLength: 160 }) }) })
    .post("/base64", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || (principal.role !== "admin" && principal.role !== "operator")) return failure(status, 403, "Permission denied");
      try {
        const content = decodeBase64(body.data, body.contentType);
        return { ...await saveUpload(principal, body, content, "base64") };
      } catch (error) { return failure(status, error instanceof UploadFailure ? error.status : 400, error instanceof Error ? error.message : "Invalid base64 file"); }
    }, { body: t.Object({ key: t.String({ minLength: 1, maxLength: 240 }), data: t.String({ minLength: 1, maxLength: 140000000 }), fileName: t.Optional(t.String({ maxLength: 255 })), contentType: t.String({ minLength: 1, maxLength: 255 }), resource: t.String({ minLength: 1, maxLength: 160 }), resourceId: t.Optional(t.String({ maxLength: 160 })), field: t.String({ minLength: 1, maxLength: 160 }) }) })
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
