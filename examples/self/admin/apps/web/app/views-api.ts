export interface QiyServerView {
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
