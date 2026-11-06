import { expect, test } from "bun:test";
import "./setup";
import { Elysia } from "elysia";
import { client } from "../src/db";
import { createStorageRoutes, cleanupMissingAttachmentObjects } from "../src/storage/routes";

test.skip("database attachment removal revokes reads and cleanup defaults to dry run", async () => {
  const previous = Bun.env.QIY_STORAGE_METADATA;
  Bun.env.QIY_STORAGE_METADATA = "database";
  const key = "metadata/" + crypto.randomUUID() + ".txt";
  try {
    client.exec('CREATE TABLE IF NOT EXISTS attachments (id text primary key, storageKey text unique not null, fileName text, contentType text not null, size integer not null, ownerId text, resource text not null, resourceId text, createdAt integer not null)');
    const app = new Elysia().use(createStorageRoutes(async () => ({ id: "metadata-owner", name: "Owner", role: "admin", claims: {} })));
    const url = "http://localhost/api/v1/files?key=" + key + "&resource=" + "missing" + "&field=" + "missing";
    expect((await app.handle(new Request(url, { method: "POST", body: new Blob(["metadata test"], { type: "application/octet-stream" }) }))).status).toBe(200);
    client.query("DELETE FROM attachments WHERE storageKey = ?").run(key);
    expect((await app.handle(new Request(url))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/api/v1/files/metadata?key=" + key))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/api/v1/files/signed?key=" + key))).status).toBe(404);
    expect((await app.handle(new Request(url, { method: "DELETE" }))).status).toBe(200);
    const missingKey = "missing/" + crypto.randomUUID() + ".txt";
    client.query("INSERT INTO attachments (id, storageKey, contentType, size, resource, createdAt) VALUES (?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), missingKey, "text/plain", 1, "test", Date.now());
    expect((await cleanupMissingAttachmentObjects()).dryRun).toBe(true);
    expect(client.query("SELECT id FROM attachments WHERE storageKey = ?").get(missingKey)).toBeTruthy();
    expect((await cleanupMissingAttachmentObjects({ dryRun: false })).dryRun).toBe(false);
    expect(client.query("SELECT id FROM attachments WHERE storageKey = ?").get(missingKey)).toBeNull();
  } finally {
    if (previous === undefined) delete Bun.env.QIY_STORAGE_METADATA; else Bun.env.QIY_STORAGE_METADATA = previous;
  }
});
