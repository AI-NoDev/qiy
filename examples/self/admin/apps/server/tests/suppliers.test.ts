import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { SuppliersRoutes, type SuppliersRepository } from "../src/routes/suppliers";

const records = new Map<string, Record<string, unknown>>();
const repository: SuppliersRepository = {
  async distribution(field) { const counts = new Map<string, number>(); for (const record of records.values()) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },
  async trend(field, days) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.values()) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },
  async list(page, pageSize, options = {}) {
    const data = [...records.values()];
    const filtered = options.search ? data.filter((record) => Object.values(record).some((value) => String(value ?? "").toLowerCase().includes(options.search!.toLowerCase()))) : data;
    const filterClauses = (expressions: Array<{ field: string; operator: string; value: string } | { operator: "and" | "or"; filters: unknown[] }>): Array<{ field: string; operator: string; value: string }> => expressions.flatMap((filter) => "field" in filter ? [filter] : filterClauses(filter.filters as Array<{ field: string; operator: string; value: string } | { operator: "and" | "or"; filters: unknown[] }>));
    const clauses = Array.isArray(options.filters) ? filterClauses(options.filters) : Object.entries(options.filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
    const filteredByFields = clauses.reduce((rows, { field, operator, value }) => rows.filter((record) => {
      const actual = record[field]; const text = String(actual ?? "");
      if (operator === "contains") return text.toLowerCase().includes(value.toLowerCase());
      if (operator === "startsWith") return text.toLowerCase().startsWith(value.toLowerCase());
      if (operator === "endsWith") return text.toLowerCase().endsWith(value.toLowerCase());
      if (operator === "in") return value.split(",").map((item) => item.trim()).includes(text);
      if (operator === "between") { const [lower, upper] = value.split(",").map(Number); return Number(actual) >= lower! && Number(actual) <= upper!; }
      if (operator === "gt") return Number(actual) > Number(value);
      if (operator === "gte") return Number(actual) >= Number(value);
      if (operator === "lt") return Number(actual) < Number(value);
      if (operator === "lte") return Number(actual) <= Number(value);
      return text === value;
    }), filtered);
    const sorted = options.sort ? [...filteredByFields].sort((left, right) => String(left[options.sort!] ?? "").localeCompare(String(right[options.sort!] ?? ""))) : filteredByFields;
    if (options.order === "desc") sorted.reverse();
    return { data: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length };
  },
  async one(id) { return records.get(id); },
  async create(values) {
    const record = { id: crypto.randomUUID(), ...values };
    records.set(record.id, record);
    return record;
  },
  async update(id, values) {
    const old = records.get(id);
    if (!old) return undefined;
    const record = { ...old, ...values };
    records.set(id, record);
    return record;
  },
  async delete(id) {
    const record = records.get(id);
    records.delete(id);
    return record;
  },
  async deleteMany(ids) {
    const deleted = ids.flatMap((id) => {
      const record = records.get(id);
      records.delete(id);
      return record ? [record] : [];
    });
    return deleted;
  },
};
  const app = new Elysia({ prefix: "/api/v1" }).use(SuppliersRoutes(repository, async () => ({ id: "00000000-0000-4000-8000-000000000001", name: "Scoped User", role: "admin", claims: {"org.id":"00000000-0000-4000-8000-000000000002"} })));
const endpoint = "http://localhost/api/v1/suppliers";

describe("suppliers CRUD", () => {
  test("creates, lists, reads, updates and deletes", async () => {
    records.clear();
    const created = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "code": "Example", "name": "Example", "leadTimeDays": 1 }),
    }));
    expect(created.status).toBe(201);
    const record = await created.json() as { id: string };
    expect(record.id).toBeTruthy();
    const listed = await app.handle(new Request(endpoint + "/?page=1&pageSize=10"));
    expect(listed.status).toBe(200);
    expect((await listed.json() as { total: number }).total).toBe(1);
    const queried = await app.handle(new Request(endpoint + "/?sort=id&order=desc&filters=" + encodeURIComponent(JSON.stringify({ id: record.id }))));
    expect(queried.status).toBe(200);
    expect((await queried.json() as { total: number }).total).toBe(1);
    const found = await app.handle(new Request(endpoint + "/" + record.id));
    expect(found.status).toBe(200);
    const patched = await app.handle(new Request(endpoint + "/" + record.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    }));
    expect(patched.status).toBe(400);
    const deleted = await app.handle(new Request(endpoint + "/" + record.id, { method: "DELETE" }));
    expect(deleted.status).toBe(200);
    expect((await app.handle(new Request(endpoint + "/" + record.id))).status).toBe(404);
    const firstBatchRecord = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "code": "Example", "name": "Example", "leadTimeDays": 1 }),
    }));
    const secondBatchRecord = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "code": "Example", "name": "Example", "leadTimeDays": 1 }),
    }));
    const firstBatchId = (await firstBatchRecord.json() as { id: string }).id;
    const secondBatchId = (await secondBatchRecord.json() as { id: string }).id;
    const batchDeleted = await app.handle(new Request(endpoint + "?ids=" + firstBatchId + "," + secondBatchId, { method: "DELETE" }));
    expect(batchDeleted.status).toBe(200);
  });

  test("rejects invalid pagination and resource ids", async () => {
    expect((await app.handle(new Request(endpoint + "/?pageSize=101"))).status).toBe(422);
    expect((await app.handle(new Request(endpoint + "/invalid-id"))).status).toBe(422);
  });



});
