/**
 * Web renderers for the CSV export/import client and its tests.
 */

export function renderExportFiles(): Record<string, string> {
  return {
    "web/app/export.ts": `export type QiyExportFilter = { field: string; operator: string; value: string } | { operator: "and" | "or"; value: QiyExportFilter[] };
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
`,
  };
}

export function renderExportTestFiles(): Record<string, string> {
  return {
    "web/tests/export.test.ts": `import { describe, expect, test } from "bun:test";
import { downloadExport, encodeExportFilters, exportUrl, uploadImport } from "../app/export";

describe("CSV export helper", () => {
  test("encodes the table filter state the API accepts", () => {
    expect(encodeExportFilters([{ field: "__search", operator: "contains", value: "phone" }, { field: "status", operator: "eq", value: "approved" }])).toEqual([{ field: "status", operator: "eq", value: "approved" }]);
    expect(encodeExportFilters([{ field: "tags", operator: "in", value: ["a", "b"] }])).toEqual([{ field: "tags", operator: "in", value: "a,b" }]);
    expect(encodeExportFilters([{ operator: "and", value: [{ field: "a", operator: "eq", value: "1" }, { operator: "or", value: [{ field: "b", operator: "eq", value: "2" }, { field: "c", operator: "eq", value: "3" }] }] }])).toEqual([{ operator: "and", value: [{ field: "a", operator: "eq", value: "1" }, { operator: "or", value: [{ field: "b", operator: "eq", value: "2" }, { field: "c", operator: "eq", value: "3" }] }] }]);
    // A group without usable children disappears instead of sending an empty condition.
    expect(encodeExportFilters([{ operator: "or", value: [{ field: "q", operator: "contains", value: "x" }] }])).toEqual([]);
  });

  test("builds the export URL from filters and the first sorter", () => {
    expect(exportUrl("orders")).toBe("/api/v1/orders/export");
    const url = new URL(exportUrl("orders", { filters: [{ field: "status", operator: "eq", value: "open" }], sorters: [{ field: "title", order: "desc" }, { field: "id", order: "asc" }] }), "http://localhost");
    expect(url.pathname).toBe("/api/v1/orders/export");
    expect(JSON.parse(url.searchParams.get("filters")!)).toEqual([{ field: "status", operator: "eq", value: "open" }]);
    expect(url.searchParams.get("sort")).toBe("title");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(new URL(exportUrl("orders", { sorters: [{ field: "title", order: "asc" }] }), "http://localhost").searchParams.get("order")).toBeNull();
    // A row selection narrows the export to those ids.
    expect(new URL(exportUrl("orders", { ids: ["a", 1] }), "http://localhost").searchParams.get("ids")).toBe("a,1");
    expect(new URL(exportUrl("orders", { ids: [] }), "http://localhost").searchParams.get("ids")).toBeNull();
  });

  test("surfaces the server refusal instead of downloading a partial file", async () => {
    const refusing = (async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ error: "Export is limited to 1000 rows; narrow the filters", errorKey: "export.tooLarge" }), { status: 400, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    await expect(downloadExport("/api/v1/orders/export", refusing)).rejects.toThrow("Export is limited to 1000 rows");
    const forbidden = (async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 401 })) as typeof fetch;
    await expect(downloadExport("/api/v1/orders/export", forbidden)).rejects.toThrow("Export failed: 401");
  });

  test("uploads a CSV import and surfaces row errors", async () => {
    const calls: Array<{ url: string; body?: string; contentType?: string }> = [];
    const accepting = (async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : await (init?.body as Blob | undefined)?.text(), contentType: (init?.headers as Record<string, string>)["Content-Type"] }); return Response.json({ imported: 3 }); }) as typeof fetch;
    await expect(uploadImport("orders", new Blob(["code\\nA\\n"]), accepting)).resolves.toBe(3);
    expect(calls[0]?.url).toBe("/api/v1/orders/import");
    expect(calls[0]?.contentType).toBe("text/csv");
    expect(calls[0]?.body).toBe("code\\nA\\n");
    const rejecting = (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: "Row 2: duplicate code", errorKey: "import.invalidRow" }, { status: 400 })) as typeof fetch;
    await expect(uploadImport("orders", new Blob(["code\\n"]), rejecting)).rejects.toThrow("Row 2: duplicate code");
  });
});
`,
  };
}
