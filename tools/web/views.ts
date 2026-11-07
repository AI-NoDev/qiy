/**
 * Web renderers for saved views (local and server-backed) and the tree
 * helpers behind tree lists, with their tests.
 */
import type { WebOptions } from "./shared";

export function renderViewFiles(options: WebOptions): Record<string, string> {
  return {
    "web/app/views-api.ts": `export interface QiyServerView {
  id: string;
  resource: string;
  name: string;
  shared: boolean;
  /** True when the current user owns the row; the list page only offers delete for own rows. */
  mine?: boolean;
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
  search?: string;
  filters?: unknown[];
  sorters?: unknown[];
  columns?: string[];
}

function bearer(): Record<string, string> {
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  return token ? { Authorization: "Bearer " + token } : {};
}

/** Shared (and own) views stored on the server, so they follow the user across devices. */
export async function fetchServerViews(resource: string, fetcher: typeof fetch = fetch): Promise<QiyServerView[]> {
  const response = await fetcher("/api/v1/saved-views?resource=" + encodeURIComponent(resource), { headers: bearer() });
  if (!response.ok) throw new Error("Saved views failed: " + response.status);
  const body = await response.json() as { items?: QiyServerView[] };
  return Array.isArray(body.items) ? body.items : [];
}

/**
 * Publishing is an upsert keyed by name: the server updates the caller's existing
 * row with that name instead of adding a duplicate dropdown entry.
 */
export async function publishServerView(input: { resource: string; name: string; shared?: boolean; search?: string; filters?: unknown[]; sorters?: unknown[]; columns?: string[] }, fetcher: typeof fetch = fetch): Promise<QiyServerView> {
  const response = await fetcher("/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json", ...bearer() }, body: JSON.stringify({ shared: false, ...input }) });
  const body = await response.json().catch(() => null) as (QiyServerView & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? "Saving the view failed: " + response.status);
  return body;
}

/** Deletes a server view; 401/403/404 become explicit errors the list page can report. */
export async function deleteServerView(input: { resource: string; id: string }, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/v1/saved-views/" + encodeURIComponent(input.id), { method: "DELETE", headers: bearer() });
  if (response.status === 401) throw new Error("Sign in again to delete the saved view for " + input.resource);
  if (response.status === 403) throw new Error("Only the owner or an admin can delete the saved view for " + input.resource);
  if (response.status === 404) throw new Error("The saved view for " + input.resource + " no longer exists");
  if (!response.ok) throw new Error("Deleting the saved view for " + input.resource + " failed: " + response.status);
}
`,
    "web/app/tree.ts": `export interface QiyTreeNode<T> {
  key: string;
  title: string;
  record: T;
  children: QiyTreeNode<T>[];
}

/** Tree entities declared by scope ... tree <entity> <parentField>. */
export const treeParents: Record<string, { parentField: string; labelField: string }> = ${JSON.stringify(Object.fromEntries([...new Set((options.scopes ?? []).flatMap((scope) => scope.tree ? [[scope.tree.entity, scope.tree.parentField] as const] : []))].map(([entity, parentField]) => [entity, { parentField, labelField: "name" }])))};

/**
 * Builds a nested tree from flat rows. Missing parents, self references and cycles
 * are reported as orphans instead of being dropped silently or looping forever.
 */
export function buildTree<T extends Record<string, unknown>>(records: readonly T[], parentField: string, labelField: string): { nodes: Array<QiyTreeNode<T>>; orphans: T[] } {
  const byId = new Map<string, QiyTreeNode<T>>();
  for (const record of records) {
    const id = String(record.id ?? "");
    if (!id) continue;
    byId.set(id, { key: id, title: String(record[labelField] ?? id), record, children: [] });
  }
  const orphans: T[] = [];
  const placed = new Set<string>();
  for (const record of records) {
    const id = String(record.id ?? "");
    if (!id) continue;
    const parent = record[parentField];
    const parentId = parent === null || parent === undefined ? "" : String(parent);
    if (!parentId) { placed.add(id); continue; }
    // Self references and unknown parents cannot be attached anywhere.
    if (parentId === id || !byId.has(parentId)) { orphans.push(record); continue; }
    placed.add(id);
  }
  const roots: Array<QiyTreeNode<T>> = [];
  for (const record of records) {
    const id = String(record.id ?? "");
    if (!id || !placed.has(id)) continue;
    const node = byId.get(id)!;
    const parent = record[parentField];
    const parentId = parent === null || parent === undefined ? "" : String(parent);
    if (!parentId) { roots.push(node); continue; }
    byId.get(parentId)!.children.push(node);
  }
  // A cycle leaves nodes attached below each other with no root; surface them.
  const reachable = new Set<string>();
  const walk = (nodes: Array<QiyTreeNode<T>>) => { for (const node of nodes) { reachable.add(node.key); walk(node.children); } };
  walk(roots);
  for (const record of records) {
    const id = String(record.id ?? "");
    if (id && placed.has(id) && !reachable.has(id) && !orphans.includes(record)) orphans.push(record);
  }
  return { nodes: roots, orphans };
}
`,
    "web/app/views.ts": `export interface QiySavedView {  id: string;
  name: string;
  createdAt: string;
  search?: string;
  filters?: unknown[];
  sorters?: unknown[];
  columns?: string[];
}

const MAX_VIEWS = 50;
const MAX_NAME = 60;
const keyFor = (resource: string) => "qiy.views." + resource;

function resolveStorage(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function readAll(resource: string, storage?: Storage): Record<string, QiySavedView[]> {
  const store = resolveStorage(storage);
  if (!store) return {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(keyFor(resource)) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, QiySavedView[]>;
  } catch { return {}; }
}

function writeAll(resource: string, views: Record<string, QiySavedView[]>, storage?: Storage): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try { store.setItem(keyFor(resource), JSON.stringify(views)); } catch { /* quota or private mode */ }
}

/** Saved list views are per resource and per browser; a corrupt payload reads as empty. */
export function listSavedViews(resource: string, storage?: Storage): QiySavedView[] {
  const views = readAll(resource, storage)[resource];
  return Array.isArray(views) ? views.filter((view) => view && typeof view.id === "string" && typeof view.name === "string") : [];
}

export function saveView(resource: string, view: Omit<QiySavedView, "id" | "createdAt">, storage?: Storage): QiySavedView[] {
  const name = String(view.name ?? "").trim().slice(0, MAX_NAME);
  const existing = listSavedViews(resource, storage);
  if (!name) return existing;
  const next: QiySavedView = { id: existing.find((item) => item.name === name)?.id ?? crypto.randomUUID(), name, createdAt: new Date().toISOString(), ...(view.search ? { search: view.search } : {}), ...(view.filters?.length ? { filters: view.filters } : {}), ...(view.sorters?.length ? { sorters: view.sorters } : {}), ...(view.columns?.length ? { columns: view.columns } : {}) };
  const views = [...existing.filter((item) => item.name !== name), next].slice(-MAX_VIEWS);
  writeAll(resource, { ...readAll(resource, storage), [resource]: views }, storage);
  return views;
}

export function deleteSavedView(resource: string, id: string, storage?: Storage): QiySavedView[] {
  const views = listSavedViews(resource, storage).filter((view) => view.id !== id);
  writeAll(resource, { ...readAll(resource, storage), [resource]: views }, storage);
  return views;
}

/**
 * The dropdown mixes browser views with server views. Server rows are addressed as
 * "server:<id>" so one select value can stand for both kinds.
 */
export const SERVER_VIEW_PREFIX = "server:";
export type QiySavedViewKind = "local" | "server";
export function viewKind(id: string | undefined): QiySavedViewKind { return id?.startsWith(SERVER_VIEW_PREFIX) ? "server" : "local"; }
export function serverViewKey(id: string): string { return SERVER_VIEW_PREFIX + id; }
export function serverViewId(id: string | undefined): string | undefined { return id?.startsWith(SERVER_VIEW_PREFIX) ? id.slice(SERVER_VIEW_PREFIX.length) : undefined; }
/** Browser views are personal; server views are published (private) or shared with everyone. */
export type QiyViewMarker = "local" | "published" | "shared";
export function viewMarker(kind: QiySavedViewKind, shared: boolean): QiyViewMarker { return kind === "local" ? "local" : shared ? "shared" : "published"; }
/** Only own server rows are deletable in the UI; local rows always are. Fail closed when ownership is unknown. */
export function canDeleteView(view: { kind: QiySavedViewKind; mine?: boolean }): boolean { return view.kind === "local" || view.mine === true; }
`,
    "web/tests/tree.test.ts": `import { expect, test } from "bun:test";
import { buildTree } from "../app/tree";

const rows = [
  { id: "root", parentId: null, name: "Root" },
  { id: "a", parentId: "root", name: "A" },
  { id: "b", parentId: "root", name: "B" },
  { id: "a1", parentId: "a", name: "A1" },
];

test("nests rows by their parent field", () => {
  const { nodes, orphans } = buildTree(rows, "parentId", "name");
  expect(nodes.map((node) => node.key)).toEqual(["root"]);
  expect(nodes[0]!.children.map((node) => node.key)).toEqual(["a", "b"]);
  expect(nodes[0]!.children[0]!.children.map((node) => node.key)).toEqual(["a1"]);
  expect(orphans).toEqual([]);
});

test("reports unknown parents, self references and cycles instead of looping", () => {
  const broken = [
    { id: "root", parentId: null, name: "Root" },
    { id: "lost", parentId: "ghost", name: "Lost" },
    { id: "self", parentId: "self", name: "Self" },
    { id: "x", parentId: "y", name: "X" },
    { id: "y", parentId: "x", name: "Y" },
  ];
  const { nodes, orphans } = buildTree(broken, "parentId", "name");
  expect(nodes.map((node) => node.key)).toEqual(["root"]);
  expect(orphans.map((row) => row.id).sort()).toEqual(["lost", "self", "x", "y"]);
});

test("handles empty and label fallbacks", () => {
  expect(buildTree([], "parentId", "name")).toEqual({ nodes: [], orphans: [] });
  const { nodes } = buildTree([{ id: "only", parentId: null }], "parentId", "name");
  expect(nodes[0]!.title).toBe("only");
});
`,
  };
}

export function renderViewTestFiles(): Record<string, string> {
  return {
    "web/tests/views.test.ts": `import { expect, test } from "bun:test";
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
`,
  };
}
