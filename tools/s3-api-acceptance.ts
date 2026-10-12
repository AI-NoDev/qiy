export const s3ApiAcceptance = `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client } from "./src/db";
import { createStorageRoutes } from "./src/storage/routes";
import { createStorageFromEnv } from "./src/storage";

test("S3 API enforces attachment ownership with database metadata", async () => {
  client.exec('CREATE TABLE attachments (id text primary key, storageKey text unique not null, fileName text, contentType text not null, size integer not null, ownerId text, resource text not null, resourceId text, createdAt integer not null)');
  const storage = createStorageFromEnv();
  const key = "api-acceptance/" + crypto.randomUUID() + ".txt";
  const app = new Elysia().use(createStorageRoutes(async (request) => {
    const id = request.headers.get("x-test-user");
    return id ? { id, name: id, role: id === "admin" ? "admin" : id === "owner" ? "operator" : "viewer" } : null;
  }));
  const server = Bun.serve({ port: 0, fetch: (request) => app.handle(request) });
  const request = (path = "", user?: string, method = "GET", body?: string) => fetch(server.url.origin + "/api/v1/files" + path + "?key=" + key, {
    method, headers: user ? { "x-test-user": user } : {}, body,
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
  } finally {
    server.stop(true);
    await storage.delete(key);
    client.close();
  }
});
`;
