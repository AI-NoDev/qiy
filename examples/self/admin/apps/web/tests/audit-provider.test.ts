import { expect, test } from "bun:test";
import { createAuditLogProvider } from "../app/providers/audit-log-provider";
import { qiyAuthProvider } from "../app/auth";

test("audit provider maps Refine filters, propagates authentication errors and disallows writes", async () => {
  let requested = "";
  const provider = createAuditLogProvider(async (input) => { requested = String(input); return Response.json({ data: [], total: 0 }); });
  const resource = "users";
  expect(await provider.get({ resource, action: "update", meta: { id: "record", page: 2 }, author: { id: "actor" } })).toEqual({ data: [], total: 0 });
  const query = new URL(requested, "http://localhost").searchParams;
  expect(query.get("resourceId")).toBe("record"); expect(query.get("action")).toBe(resource + ".updated"); expect(query.get("page")).toBe("2"); expect(query.get("actorId")).toBe("actor");
  await expect(provider.create({ resource, action: "create", meta: {} })).rejects.toThrow("client writes are disabled");
  await expect(provider.update({ id: "event", name: "forged" })).rejects.toThrow("immutable");
  await expect(provider.get({ resource: "unknown" })).rejects.toThrow("Unknown audit resource");
  const failing = createAuditLogProvider(async () => Response.json({ error: "Expired" }, { status: 401 }));
  try { await failing.get({ resource }); throw new Error("Expected rejection"); } catch (error) { expect(error).toMatchObject({ statusCode: 401, message: "Expired" }); expect(await qiyAuthProvider.onError(error)).toMatchObject({ logout: true }); }
  expect(await qiyAuthProvider.onError({ statusCode: 403 })).toEqual({});
});
