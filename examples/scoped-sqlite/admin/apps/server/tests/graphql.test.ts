import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createGraphQLRoutes } from "../src/graphql";
import type { Repositories } from "../src/app";

const records = new Map<string, Record<string, unknown>>();
const repository: Repositories["records"] = {
  async distribution(field) { const counts = new Map<string, number>(); for (const record of records.values()) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },
  async trend(field, days) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.values()) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },
  async list(page, pageSize, options = {}) {
    const rows = [...records.values()];
    const filtered = options.search ? rows.filter((record) => Object.values(record).some((value) => String(value ?? "").toLowerCase().includes(options.search!.toLowerCase()))) : rows;
    return { data: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length };
  },
  async one(id) { return records.get(id); },
  async create(values) { const record = { id: crypto.randomUUID(), ...values }; records.set(record.id, record); return record; },
  async update(id, values) { const old = records.get(id); if (!old) return undefined; const record = { ...old, ...values }; records.set(id, record); return record; },
  async delete(id) { const record = records.get(id); records.delete(id); return record; },
  async deleteMany(ids) { return ids.flatMap((id) => { const record = records.get(id); records.delete(id); return record ? [record] : []; }); },
};
const app = new Elysia().use(createGraphQLRoutes({ records: repository } as Repositories, async () => ({ id: "test-user", role: "admin", name: "Test", claims: {"tenant.id":"00000000-0000-4000-8000-000000000002"} })));

describe("GraphQL API", () => {
  test("supports create, list and delete mutations", async () => {
    records.clear();
    const create = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "mutation($input: RecordsCreateInput!) { createRecords(input: $input) { id } }", variables: { input: { "tenantId": "Example", "title": "Example" } } }) }));
    expect(create.status).toBe(200);
    const created = await create.json() as { data: { createRecords: { id: string } } };
    expect(created.data.createRecords.id).toBeTruthy();
    const list = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "query { records { items { id tenantId title } total } }" }) }));
    expect((await list.json() as { data: { records: { total: number } } }).data.records.total).toBe(1);
    const deleted = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "mutation($id: ID!) { deleteRecords(id: $id) { id } }", variables: { id: created.data.createRecords.id } }) }));
    expect((await deleted.json() as { data: { deleteRecords: { id: string } } }).data.deleteRecords.id).toBeTruthy();
  });
});
