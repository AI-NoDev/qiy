export const s3ApiAcceptance = `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client } from "./src/db";
import { createStorageRoutes, scanOrphanAttachmentObjects } from "./src/storage/routes";
import { createStorageFromEnv } from "./src/storage";

function insertMetadata(storageKey: string): void {
  client.query("INSERT INTO attachments (id, storageKey, fileName, contentType, size, ownerId, resource, resourceId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), storageKey, null, "text/plain", 1, "owner", "documents", null, Date.now());
}

test("S3 API enforces attachment ownership with database metadata", async () => {
  client.exec('CREATE TABLE attachments (id text primary key, storageKey text unique not null, fileName text, contentType text not null, size integer not null, ownerId text, resource text not null, resourceId text, createdAt integer not null)');
  const storage = createStorageFromEnv();
  const key = "api-acceptance/" + crypto.randomUUID() + ".txt";
  const app = new Elysia().use(createStorageRoutes(async (request) => {
    const id = request.headers.get("x-test-user");
    return id ? { id, name: id, role: id === "admin" ? "admin" : id === "owner" ? "operator" : "viewer" } : null;
  }));
  const server = Bun.serve({ port: 0, fetch: (request) => app.handle(request) });
  // resource and field are required query parameters, so a request that omits
  // them is rejected by validation (422) before authorization can be exercised.
  const request = (path = "", user?: string, method = "GET", body?: string) => fetch(server.url.origin + "/api/v1/files" + path + "?key=" + key + "&resource=documents&field=attachment", {
    method, headers: user ? { "x-test-user": user, "content-type": "text/plain" } : {}, body,
  });
  try {
    expect((await request()).status).toBe(401);
    expect((await request("", "visitor", "POST", "denied")).status).toBe(403);
    expect(await storage.exists(key)).toBe(false);
    const upload = await request("", "owner", "POST", "private S3 invoice");
    expect(upload.status).toBe(200);
    expect(await upload.json()).toMatchObject({ ownerId: "owner", storageKey: key, size: 18 });
    expect(client.query("SELECT ownerId FROM attachments WHERE storageKey = ?").get(key)).toEqual({ ownerId: "owner" });
    expect((await request("", "owner", "POST", "overwrite")).status).toBe(409);
    expect(await (await request("", "owner")).text()).toBe("private S3 invoice");
    for (const path of ["", "/metadata", "/signed"]) expect((await request(path, "visitor")).status).toBe(404);
    const signed = await request("/signed", "owner");
    expect(signed.status).toBe(200);
    const { url } = await signed.json() as { url: string };
    expect(await (await fetch(url)).text()).toBe("private S3 invoice");
    expect((await request("", "owner", "DELETE")).status).toBe(403);
    expect((await request("", "admin", "DELETE")).status).toBe(200);
    expect(await storage.exists(key)).toBe(false);
    expect(client.query("SELECT id FROM attachments WHERE storageKey = ?").get(key)).toBeNull();
    expect((await request("/metadata", "owner")).status).toBe(404);

    // The S3 provider must enumerate real bucket contents for orphan scanning.
    const strandedKey = "api-acceptance/orphan-" + crypto.randomUUID() + ".txt";
    const keptKey = "api-acceptance/kept-" + crypto.randomUUID() + ".txt";
    await storage.save(strandedKey, new Blob(["stranded object"]));
    await storage.save(keptKey, new Blob(["referenced object"]));
    insertMetadata(strandedKey);
    insertMetadata(keptKey);
    const listed = await storage.list();
    expect(listed).toContain(strandedKey);
    expect(listed).toContain(keptKey);

    // A metadata row that never landed leaves a real object with no reference.
    client.query("DELETE FROM attachments WHERE storageKey = ?").run(strandedKey);
    const dryRun = await scanOrphanAttachmentObjects();
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.orphans).toContain(strandedKey);
    expect(dryRun.orphans).not.toContain(keptKey);
    expect(await storage.exists(strandedKey)).toBe(true);
    expect(dryRun.missingObjects).toBe(0);

    const applied = await scanOrphanAttachmentObjects({ dryRun: false });
    expect(applied.removed).toBeGreaterThanOrEqual(1);
    expect(await storage.exists(strandedKey)).toBe(false);
    expect(await storage.exists(keptKey)).toBe(true);
    expect((await scanOrphanAttachmentObjects()).orphans).not.toContain(keptKey);

    // The reverse direction is reported and cleaned by the other command.
    const goneKey = "api-acceptance/gone-" + crypto.randomUUID() + ".txt";
    insertMetadata(goneKey);
    expect((await scanOrphanAttachmentObjects()).missingObjects).toBe(1);
    expect((await scanOrphanAttachmentObjects()).orphans).not.toContain(goneKey);
    client.query("DELETE FROM attachments WHERE storageKey = ?").run(goneKey);
    await storage.delete(keptKey);
    client.query("DELETE FROM attachments WHERE storageKey = ?").run(keptKey);
  } finally {
    server.stop(true);
    await storage.delete(key);
    client.close();
  }
});
`;
