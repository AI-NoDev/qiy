export type QiyExportFilter = { field: string; operator: string; value: string } | { operator: "and" | "or"; value: QiyExportFilter[] };
/**
 * Mirrors the list data provider's filter encoding so an export covers exactly the
 * rows and columns the table is showing. The export endpoint re-validates every
 * field and operator, so drift fails loudly instead of exporting the wrong range.
 */
export function encodeExportFilters(items: readonly unknown[]): QiyExportFilter[] {
  return items.flatMap<QiyExportFilter>((item) => {
    if (!item || typeof item !== "object") return [];
    const filter = item as Record<string, unknown>;
    if (!("field" in filter)) {
      const children = Array.isArray(filter.value) ? filter.value : [];
      const operator = filter.operator === "or" ? "or" : filter.operator === "and" ? "and" : undefined;
      const encoded = encodeExportFilters(children);
      return operator && encoded.length ? [{ operator, value: encoded }] : [];
    }
    if (filter.field === "q" || filter.field === "__search" || !("value" in filter)) return [];
    const value = Array.isArray(filter.value) ? filter.value.map(String).join(",") : String(filter.value ?? "");
    return [{ field: String(filter.field), operator: String(filter.operator ?? "eq"), value }];
  });
}

export function exportUrl(resource: string, options: { filters?: readonly unknown[]; sorters?: readonly unknown[]; ids?: readonly (string | number)[]; columns?: readonly string[] } = {}): string {
  const params = new URLSearchParams();
  const filters = encodeExportFilters(options.filters ?? []);
  if (filters.length) params.set("filters", JSON.stringify(filters));
  const sorters = (options.sorters ?? []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const sorter = item as Record<string, unknown>;
    return typeof sorter.field === "string" && sorter.field ? [sorter] : [];
  });
  if (sorters[0]) {
    params.set("sort", String(sorters[0].field));
    if (sorters[0].order === "desc") params.set("order", "desc");
  }
  // A selection exports exactly those rows; the server still applies the policy.
  const ids = (options.ids ?? []).map(String).filter(Boolean);
  if (ids.length) params.set("ids", ids.join(","));
  // Only the columns the table is showing are exported.
  const columns = (options.columns ?? []).map(String).filter(Boolean);
  if (columns.length) params.set("columns", columns.join(","));
  const query = params.toString();
  return "/api/v1/" + resource + "/export" + (query ? "?" + query : "");
}

function fileNameFrom(response: Response, resource: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return match?.[1] ?? resource + ".csv";
}

export async function downloadExport(url: string, fetcher: typeof fetch = fetch): Promise<void> {  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  const response = await fetcher(url, { headers: token ? { Authorization: "Bearer " + token } : {} });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Export failed: " + response.status);
  }
  const blob = await response.blob();
  if (typeof window === "undefined") return;
  const href = window.URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = href;
  link.download = fileNameFrom(response, url.split("/").at(-2) ?? "export");
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(href);
}

export async function uploadImport(resource: string, file: Blob, fetcher: typeof fetch = fetch): Promise<number> {
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  const response = await fetcher("/api/v1/" + resource + "/import", { method: "POST", headers: { "Content-Type": "text/csv", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: file });
  const body = await response.json().catch(() => null) as { imported?: number; error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? "Import failed: " + response.status);
  return body?.imported ?? 0;
}

export interface QiyImportJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  processed: number;
  failed: number;
  errors: string[];
}

function bearer(): Record<string, string> {
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  return token ? { Authorization: "Bearer " + token } : {};
}

/**
 * Starts a background import and returns its job id. The rows are written after
 * the response, so the UI polls the job instead of holding a request open.
 */
export async function startImport(resource: string, file: Blob, fetcher: typeof fetch = fetch): Promise<{ jobId: string; total: number }> {
  const response = await fetcher("/api/v1/" + resource + "/import?async=1", { method: "POST", headers: { "Content-Type": "text/csv", ...bearer() }, body: file });
  const body = await response.json().catch(() => null) as { jobId?: string; total?: number; error?: string } | null;
  if (!response.ok || !body?.jobId) throw new Error(body?.error ?? "Import failed: " + response.status);
  return { jobId: body.jobId, total: body.total ?? 0 };
}

export async function waitForImport(resource: string, jobId: string, options: { onProgress?: (job: QiyImportJob) => void; intervalMs?: number; timeoutMs?: number; fetcher?: typeof fetch } = {}): Promise<QiyImportJob> {
  const fetcher = options.fetcher ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    const response = await fetcher("/api/v1/" + resource + "/import/jobs/" + jobId, { headers: bearer() });
    const body = await response.json().catch(() => null) as (QiyImportJob & { error?: string }) | null;
    if (!response.ok || !body) throw new Error(body?.error ?? "Import status failed: " + response.status);
    options.onProgress?.(body);
    if (body.status === "completed" || body.status === "failed") return body;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500));
  }
  throw new Error("Import did not finish in time");
}
