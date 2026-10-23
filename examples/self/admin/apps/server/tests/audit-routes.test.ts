import { expect, test } from "bun:test";
import { createAuditRoutes, type AuditQuery } from "../src/audit/routes";
import type { Principal } from "../src/auth/guard";

test("audit API protects history and validates pagination without trusting client authors", async () => {
  let principal: Principal | null = null;
  const calls: AuditQuery[] = [];
  const app = createAuditRoutes(async () => principal, async (query) => { calls.push(query); return { data: [{ id: "event", author: { id: "trusted" } }], total: 1 }; });
  const endpoint = "http://localhost/api/v1/audit-logs/?resource=" + "users";
  expect((await app.handle(new Request(endpoint))).status).toBe(401);
  principal = { id: "actor", name: "User", role: "operator" };
  expect((await app.handle(new Request(endpoint))).status).toBe(403);
  principal.role = "admin";
  expect((await app.handle(new Request(endpoint + "&pageSize=101"))).status).toBe(422);
  expect((await app.handle(new Request(endpoint + "&page=1.5"))).status).toBe(422);
  expect((await app.handle(new Request("http://localhost/api/v1/audit-logs/?resource=unknown"))).status).toBe(400);
  const result = await app.handle(new Request(endpoint + "&page=2&pageSize=10&action=reviewed&resourceId=record"));
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect((await result.json()).data[0].author.id).toBe("trusted");
  expect(calls[0]).toMatchObject({ page: 2, pageSize: 10, action: "reviewed", resourceId: "record" });
  expect((await app.handle(new Request("http://localhost/api/v1/audit-logs/?resource=warehouses"))).status).toBe(403);
  expect((await app.handle(new Request(endpoint, { method: "POST", body: "{}" }))).status).toBe(404);
});
