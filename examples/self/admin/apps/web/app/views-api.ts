export interface QiyServerView {
  id: string;
  resource: string;
  name: string;
  shared: boolean;
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

export async function publishServerView(input: { resource: string; name: string; shared?: boolean; search?: string; filters?: unknown[]; sorters?: unknown[]; columns?: string[] }, fetcher: typeof fetch = fetch): Promise<QiyServerView> {
  const response = await fetcher("/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json", ...bearer() }, body: JSON.stringify({ shared: false, ...input }) });
  const body = await response.json().catch(() => null) as (QiyServerView & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? "Saving a shared view failed: " + response.status);
  return body;
}

export async function deleteServerView(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/v1/saved-views/" + encodeURIComponent(id), { method: "DELETE", headers: bearer() });
  if (!response.ok && response.status !== 204) throw new Error("Deleting a shared view failed: " + response.status);
}
