import { resolve } from "node:path";
import { createApp, type Repositories } from "./app";
import { createHandler } from "./http";

const repositories: Repositories = {
products: (() => {
    const records: Array<Record<string, unknown>> = [{ "id": "00000000-0000-4000-8000-000000000001", "title": "Demo products", "price": "49.90", "embedding": null }];
    const visible = (record: Record<string, unknown>, scope?: { field: string; value: string }) => !scope || record[scope.field] === scope.value;
    return {
      async distribution(field: string, scope?: { field: string; value: string }) { const counts = new Map<string, number>(); for (const record of records.filter((item) => visible(item, scope))) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },
      async trend(field: string, days: number, scope?: { field: string; value: string }) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.filter((item) => visible(item, scope))) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },
      async list(page: number, pageSize: number, options?: { scope?: { field: string; value: string } }) { const rows = records.filter((record) => visible(record, options?.scope)); return { data: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length }; },
      async one(id: string, scope?: { field: string; value: string }) { return records.find((record) => record.id === id && visible(record, scope)); },
      async create(values: Record<string, unknown>, _actor?: string, scope?: { field: string; value: string }) {
        const record = { id: crypto.randomUUID(), ...values, ...(scope ? { [scope.field]: scope.value } : {}) };
        records.push(record);
        return record;
      },
      async update(id: string, values: Record<string, unknown>, _actor?: string, scope?: { field: string; value: string }) {
        const record = records.find((item) => item.id === id && visible(item, scope));
        if (record) Object.assign(record, values, scope ? { [scope.field]: scope.value } : {});
        return record;
      },
      async delete(id: string, _actor?: string, scope?: { field: string; value: string }) {
        const index = records.findIndex((record) => record.id === id && visible(record, scope));
        return index === -1 ? undefined : records.splice(index, 1)[0];
      },
      async deleteMany(ids: string[], _actor?: string, scope?: { field: string; value: string }) {
        const deleted = records.filter((record) => ids.includes(String(record.id)) && visible(record, scope));
        for (const record of deleted) records.splice(records.indexOf(record), 1);
        return deleted;
      },
    };
  })(),
};
const app = await createApp(repositories, async () => ({ id: "preview", name: "Preview Admin", role: "admin", claims: {} }), false, true);
const clientRoot = resolve(import.meta.dir, "../../web/build/client");
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(Bun.env.PORT ?? 3000), fetch: createHandler((request) => app.handle(request), clientRoot) });
console.log(`Local-only Qiy preview: http://127.0.0.1:${server.port}`);
