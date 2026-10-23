import { expect, test } from "bun:test";
import { deleteSavedView, listSavedViews, saveView } from "../app/views";
import { fetchServerViews, publishServerView } from "../app/views-api";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  } as Storage;
}

test("saves, updates and lists views per resource", () => {
  const storage = memoryStorage();
  const first = saveView("orders", { name: "Open", search: "abc", filters: [{ field: "status", operator: "eq", value: "open" }], sorters: [{ field: "title", order: "desc" }], columns: ["id", "title"] }, storage);
  expect(first).toHaveLength(1);
  expect(first[0]?.name).toBe("Open");
  expect(listSavedViews("orders", storage)).toHaveLength(1);
  // The same name updates in place instead of duplicating.
  const updated = saveView("orders", { name: "Open", filters: [] }, storage);
  expect(updated).toHaveLength(1);
  expect(updated[0]?.filters).toBeUndefined();
  saveView("orders", { name: "Late", columns: ["id"] }, storage);
  expect(listSavedViews("orders", storage).map((view) => view.name)).toEqual(["Open", "Late"]);
  // Views never leak across resources.
  expect(listSavedViews("products", storage)).toEqual([]);
  expect(listSavedViews("orders", storage)).toHaveLength(2);
});

test("ignores blank names and deletes by id", () => {
  const storage = memoryStorage();
  expect(saveView("orders", { name: "   " }, storage)).toEqual([]);
  const saved = saveView("orders", { name: "  Padded  " }, storage);
  expect(saved[0]?.name).toBe("Padded");
  expect(deleteSavedView("orders", saved[0]!.id, storage)).toEqual([]);
  expect(listSavedViews("orders", storage)).toEqual([]);
  // Deleting an unknown id is a no-op.
  expect(deleteSavedView("orders", "missing", storage)).toEqual([]);
});

test("tolerates corrupt storage and missing window", () => {
  const storage = memoryStorage();
  storage.setItem("qiy.views.orders", "{not json");
  expect(listSavedViews("orders", storage)).toEqual([]);
  storage.setItem("qiy.views.orders", JSON.stringify({ orders: [{ id: 1 }, null] }));
  expect(listSavedViews("orders", storage)).toEqual([]);
  // Server-side rendering has no localStorage.
  expect(listSavedViews("orders")).toEqual([]);
});

test("publishes a view to the server and lists the shared ones", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined });
    if (init?.method === "POST") return Response.json({ id: "s1", resource: "orders", name: "Open", shared: true, createdAt: new Date().toISOString() }, { status: 201 });
    return Response.json({ items: [{ id: "s1", resource: "orders", name: "Open", shared: true, createdAt: new Date().toISOString() }] });
  }) as typeof fetch;
  const published = await publishServerView({ resource: "orders", name: "Open", shared: true, search: "draft", filters: [{ field: "status", operator: "eq", value: "draft" }], columns: ["id", "status"] }, fetcher);
  expect(published.shared).toBe(true);
  expect(calls[0]).toMatchObject({ url: "/api/v1/saved-views", method: "POST" });
  expect(calls[0]!.body).toMatchObject({ resource: "orders", name: "Open", shared: true, search: "draft", columns: ["id", "status"] });
  const listed = await fetchServerViews("orders", fetcher);
  expect(listed.map((view) => view.id)).toEqual(["s1"]);
  expect(calls[1]!.url).toContain("resource=orders");
});
