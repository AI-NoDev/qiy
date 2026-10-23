export interface QiySavedView {  id: string;
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
