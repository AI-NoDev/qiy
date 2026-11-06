import { expect, test } from "bun:test";
import { canDeleteView, deleteSavedView, listSavedViews, saveView, serverViewId, serverViewKey, viewKind, viewMarker } from "../app/views";
import { deleteServerView, fetchServerViews, publishServerView } from "../app/views-api";

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

test("decides view kind, marker and deletability for local and server rows", () => {
  // Server rows are addressed with a "server:" prefix; plain ids are browser rows.
  expect(viewKind(undefined)).toBe("local");
  expect(viewKind("abc")).toBe("local");
  expect(viewKind("server:123")).toBe("server");
  expect(serverViewKey("123")).toBe("server:123");
  expect(serverViewId("server:123")).toBe("123");
  expect(serverViewId("abc")).toBeUndefined();
  // Local rows are personal; server rows are published (private) or shared.
  expect(viewMarker("local", false)).toBe("local");
  expect(viewMarker("server", false)).toBe("published");
  expect(viewMarker("server", true)).toBe("shared");
  // Local rows can always be deleted; server rows only when the caller owns them.
  expect(canDeleteView({ kind: "local" })).toBe(true);
  expect(canDeleteView({ kind: "server", mine: true })).toBe(true);
  expect(canDeleteView({ kind: "server", mine: false })).toBe(false);
  expect(canDeleteView({ kind: "server" })).toBe(false);
});

test("deletes server views through the API and reports 401/403/404", async () => {
  const calls: Array<{ url: string; method: string; authorization?: string }> = [];
  const responses = [new Response(null, { status: 204 }), new Response(null, { status: 401 }), new Response(null, { status: 403 }), new Response(null, { status: 404 })];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", authorization: (init?.headers as Record<string, string> | undefined)?.Authorization });
    return responses.shift() ?? new Response(null, { status: 500 });
  }) as typeof fetch;
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => "token-1" } } });
  try {
    // Bearer token is attached and the id is URL-encoded.
    await deleteServerView({ resource: "orders", id: "view 1" }, fetcher);
    expect(calls[0]).toMatchObject({ url: "/api/v1/saved-views/view%201", method: "DELETE", authorization: "Bearer token-1" });
    await expect(deleteServerView({ resource: "orders", id: "gone" }, fetcher)).rejects.toThrow("Sign in again");
    await expect(deleteServerView({ resource: "orders", id: "other" }, fetcher)).rejects.toThrow("Only the owner or an admin");
    await expect(deleteServerView({ resource: "orders", id: "missing" }, fetcher)).rejects.toThrow("no longer exists");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  }
});
