import { expect, test } from "bun:test";
import { handleAgentRequest } from "../tools/agent-api";

const request = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1:7331${path}`, init);

test("agent health and schema endpoints", async () => {
  const health = await handleAgentRequest(request("/health"));
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true, name: "qiy" });
  const schema = await handleAgentRequest(request("/schema"));
  expect(schema.status).toBe(200);
  expect((await schema.json() as { title?: string }).title).toBeDefined();
  const errors = await handleAgentRequest(request("/errors"));
  expect(Array.isArray(await errors.json())).toBe(true);
});

test("agent explain validates source and returns structured errors", async () => {
  const ok = await handleAgentRequest(request("/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "qiy v0; application demo { database sqlite {} entity items { field id UUID @id; field name Text; } }" }),
  }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ valid: true, entities: [{ name: "items" }] });
  const invalid = await handleAgentRequest(request("/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "not a model" }),
  }));
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toMatchObject({ valid: false });
});

test("agent rejects wrong methods, content types and missing source", async () => {
  expect((await handleAgentRequest(request("/explain"))).status).toBe(405);
  expect((await handleAgentRequest(request("/explain", { method: "POST", body: "{}" }))).status).toBe(415);
  expect((await handleAgentRequest(request("/explain", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status).toBe(400);
  expect((await handleAgentRequest(request("/unknown"))).status).toBe(404);
});
