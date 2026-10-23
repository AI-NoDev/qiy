import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { createLocalStorage, createS3Storage, storageKey } from "../src/storage";
import { createStorageRoutes } from "../src/storage/routes";

describe("storage providers", () => {
  test("stores and removes a local object", async () => {
    const root = mkdtempSync(join(tmpdir(), "qiy-storage-"));
    try {
      const storage = createLocalStorage(root);
      await storage.save("orders/invoice-1.txt", new Blob(["invoice"]));
      expect(await storage.exists("orders/invoice-1.txt")).toBe(true);
      expect(await storage.open("orders/invoice-1.txt").text()).toBe("invoice");
      expect(storage.signedUrl("orders/invoice-1.txt")).toBeNull();
      await storage.delete("orders/invoice-1.txt");
      expect(await storage.exists("orders/invoice-1.txt")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects traversal and missing S3 configuration", () => {
    for (const key of ["../secret", "/absolute", "foo//bar", "foo\\bar", "foo/..", "foo/.hidden"]) {
      expect(() => storageKey(key)).toThrow("Invalid storage key");
    }
    expect(() => createS3Storage({ bucket: "" })).toThrow("S3 bucket is required");
  });

  test.skip("signed reads require ownership and fall back to authenticated local downloads", async () => {
    const root = mkdtempSync(join(tmpdir(), "qiy-storage-signed-"));
    const prior = { root: Bun.env.QIY_STORAGE_ROOT, provider: Bun.env.QIY_STORAGE_PROVIDER, metadata: Bun.env.QIY_STORAGE_METADATA };
    Bun.env.QIY_STORAGE_ROOT = root;
    Bun.env.QIY_STORAGE_PROVIDER = "local";
    Bun.env.QIY_STORAGE_METADATA = "memory";
    try {
      const app = new Elysia().use(createStorageRoutes(async (request) => request.headers.get("x-user") ? { id: request.headers.get("x-user")!, role: request.headers.get("x-role") === "admin" ? "admin" : "viewer", name: "Tester" } : null));
      const key = "files/" + crypto.randomUUID() + ".txt";
      const endpoint = "http://localhost/api/v1/files?key=" + encodeURIComponent(key) + "&resource=missing&field=missing";
      const signed = endpoint.replace("files?", "files/signed?");
      expect((await app.handle(new Request(signed))).status).toBe(401);
      expect((await app.handle(new Request(signed, { headers: { "x-user": "owner" } }))).status).toBe(404);
      expect((await app.handle(new Request(endpoint, { method: "POST", headers: { "x-user": "owner", "x-role": "admin" }, body: new Blob(["private"], { type: "application/octet-stream" }) }))).status).toBe(200);
      expect((await app.handle(new Request(signed, { headers: { "x-user": "visitor" } }))).status).toBe(404);
      expect(await (await app.handle(new Request(signed, { headers: { "x-user": "owner" } }))).json()).toEqual({ url: null });
      expect((await app.handle(new Request("http://localhost/api/v1/files/signed?key=../secret", { headers: { "x-user": "owner" } }))).status).toBe(400);
      expect((await app.handle(new Request(signed, { headers: { "x-user": "administrator", "x-role": "admin" } }))).status).toBe(200);
    } finally {
      if (prior.root === undefined) delete Bun.env.QIY_STORAGE_ROOT; else Bun.env.QIY_STORAGE_ROOT = prior.root;
      if (prior.provider === undefined) delete Bun.env.QIY_STORAGE_PROVIDER; else Bun.env.QIY_STORAGE_PROVIDER = prior.provider;
      if (prior.metadata === undefined) delete Bun.env.QIY_STORAGE_METADATA; else Bun.env.QIY_STORAGE_METADATA = prior.metadata;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
