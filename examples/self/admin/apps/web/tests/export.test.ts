import { describe, expect, test } from "bun:test";
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
    await expect(uploadImport("orders", new Blob(["code\nA\n"]), accepting)).resolves.toBe(3);
    expect(calls[0]?.url).toBe("/api/v1/orders/import");
    expect(calls[0]?.contentType).toBe("text/csv");
    expect(calls[0]?.body).toBe("code\nA\n");
    const rejecting = (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: "Row 2: duplicate code", errorKey: "import.invalidRow" }, { status: 400 })) as typeof fetch;
    await expect(uploadImport("orders", new Blob(["code\n"]), rejecting)).rejects.toThrow("Row 2: duplicate code");
  });
});
