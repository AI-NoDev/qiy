import { Elysia, t } from "elysia";
import type { Authenticator, Principal } from "../../auth/guard";
import { createInventoryService } from "./inventory.service";
import { claimImportJob, createImportJob, isImportJobCancelled, listImportJobs, readImportJob, releaseStaleImportJobs, requestImportJobCancel, updateImportJob } from "../../import-jobs";
import { claimExportJob, createExportJob, listExportJobs, readExportJob, updateExportJob } from "../../export-jobs";
import type { InventoryRepository as InventoryRepositoryPort } from "./inventory.contract";


const createInventory = t.Object({
  "inventoryKey": t.String({ minLength: 1 }),
  "warehouseId": t.String({ format: "uuid" }),
  "binId": t.String({ format: "uuid" }),
  "productId": t.String({ format: "uuid" }),
  "quantity": t.Integer(),
  "reserved": t.Integer(),
  "lotCode": t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()], {})),
  "updatedAt": t.Optional(t.Union([t.String({ format: "date-time" }), t.Null()], {})),
}, { additionalProperties: false });

const patchInventory = t.Object({
  "inventoryKey": t.Optional(t.String({ minLength: 1 })),
  "warehouseId": t.Optional(t.String({ format: "uuid" })),
  "binId": t.Optional(t.String({ format: "uuid" })),
  "productId": t.Optional(t.String({ format: "uuid" })),
  "quantity": t.Optional(t.Integer()),
  "reserved": t.Optional(t.Integer()),
  "lotCode": t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()], {})),
  "updatedAt": t.Optional(t.Union([t.String({ format: "date-time" }), t.Null()], {})),
}, { additionalProperties: false });

export interface InventoryRepository {
  distribution(field: string, scope?: { field: string; value: string }): Promise<Array<{ value: string | null; count: number }>>;
  /** Optional so generated test doubles and hand-written repositories keep compiling. */
  aggregate?(field: string, operator: string, scope?: { field: string; value: string }): Promise<{ value: number | null; operator: string }>;
  trend(field: string, days: number, scope?: { field: string; value: string }): Promise<Array<{ day: string; count: number }>>;
  list(page: number, pageSize: number, options?: ListQuery): Promise<{ data: Array<Record<string, unknown>>; total: number }>;
  one(id: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  create(values: typeof createInventory.static, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown>>;
  update(id: string, values: typeof patchInventory.static, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  delete(id: string, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  deleteMany(ids: string[], actorId?: string, scope?: { field: string; value: string }): Promise<Array<Record<string, unknown>>>;
  /** Optional so test doubles and hand-written repositories keep working. */
  recordExportAudit?(input: { rows: number; filters: number; principalId?: string }): Promise<void>;
  recordImportAudit?(input: { rows: number; principalId?: string }): Promise<void>;
}

export type FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";
export interface FilterClause { field: string; operator: FilterOperator; value: string; }
export interface FilterGroup { operator: "and" | "or"; filters: FilterExpression[]; }
export type FilterExpression = FilterClause | FilterGroup;

export interface ListQuery {
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, string> | FilterExpression[];
  scope?: { field: string; value: string };

}

export function InventoryRoutes(repository: InventoryRepositoryPort, authenticate: Authenticator = async () => null) {
  const redact = (record: Record<string, unknown>) => record;
  const redactRecord = (record: Record<string, unknown>) => redact(record);
  const sortableFields = ["id","inventoryKey","warehouseId","binId","productId","quantity","reserved","lotCode","updatedAt"] as string[];
  const filterableFields = ["id","inventoryKey","warehouseId","binId","productId","quantity","reserved","lotCode","updatedAt"] as string[];
  const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"inventoryKey":["contains","startsWith","endsWith","eq"],"warehouseId":["eq","gt","gte","lt","lte","between","in"],"binId":["eq","gt","gte","lt","lte","between","in"],"productId":["eq","gt","gte","lt","lte","between","in"],"quantity":["eq","gt","gte","lt","lte","between","in"],"reserved":["eq","gt","gte","lt","lte","between","in"],"lotCode":["contains","startsWith","endsWith","eq"],"updatedAt":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
  const resolveScope = async (request: Request) => {
    const principal = await authenticate(request);
    const scopeConfig = null as { field: string; claim: string } | null;
    const scopeField = scopeConfig?.field;
    const scopeClaim = scopeConfig?.claim;
    if (!scopeField || !scopeClaim) return undefined;
    const claimValue = principal?.claims?.[scopeClaim];
    if (!principal || claimValue === undefined || claimValue === null || claimValue === "") throw new Error("Missing required data scope claim: " + scopeClaim);
    return { field: scopeField, value: String(claimValue) };
  };
  const exportColumns = ["id","inventoryKey","warehouseId","binId","productId","quantity","reserved","lotCode","updatedAt"] as string[];
  const exportMaxRows = () => { const value = Number(Bun.env.QIY_EXPORT_MAX_ROWS ?? 1000); return Number.isSafeInteger(value) && value >= 1 && value <= 100000 ? value : 1000; };
  // Exports stream in bounded pages so memory does not grow with the result set.
  const EXPORT_PAGE_SIZE = Math.min(250, exportMaxRows());
  // Import accepts plain scalar columns only; vectors and key lists need the API.
  const importTypes = {"inventoryKey":"Text","warehouseId":"UUID","binId":"UUID","productId":"UUID","quantity":"Integer","reserved":"Integer","lotCode":"Text","updatedAt":"DateTime"} as Record<string, string>;
  const importColumns = Object.keys(importTypes);
  const importMaxRows = () => { const value = Number(Bun.env.QIY_IMPORT_MAX_ROWS ?? 1000); return Number.isSafeInteger(value) && value >= 1 && value <= 100000 ? value : 1000; };
  /** RFC 4180 reader: quoted fields, doubled quotes and CRLF line endings. */
  const parseCsv = (input: string): string[][] => {
    const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
    for (let index = 0; index < input.length; index++) {
      const char = input[index]!;
      if (quoted) {
        if (char === '"') { if (input[index + 1] === '"') { field += '"'; index++; } else quoted = false; }
        else field += char;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === ",") { row.push(field); field = ""; continue; }
      if (char === "\r") continue;
      if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
      field += char;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((cells) => cells.some((cell) => cell.length > 0));
  };
  const importValue = (field: string, value: string) => {
    if (value === "") return null;
    if (importTypes[field] === "Integer") { const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error("Column " + field + " must be an integer"); return parsed; }
    if (importTypes[field] === "DateTime") { const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) throw new Error("Column " + field + " must be an ISO date-time"); return parsed; }
    return value;
  };
  const importWorkerId = crypto.randomUUID();
  const exportWorkerId = crypto.randomUUID();
  /**
   * Claims one export job (by id inline, otherwise the oldest queued one) and
   * rebuilds its CSV from the stored request spec, so any replica can finish it.
   */
  const claimAndProcessExportJob = async (jobId?: string): Promise<string | undefined> => {
    const claimed = await claimExportJob("inventory", exportWorkerId, new Date(Date.now() + 120000), jobId);
    if (!claimed) return undefined;
    type ExportSpec = { search?: string; sort?: string; order?: "asc" | "desc"; filters?: string; ids?: string; columns?: string; principal: { id: string; name?: string; role?: string; claims?: Record<string, string | number | boolean | null> }; scope?: { field: string; value: string } };
    let spec: ExportSpec;
    try { spec = JSON.parse(claimed.payload) as ExportSpec; }
    catch { await updateExportJob(claimed.id, { status: "failed", errors: ["Export job payload is invalid"], releaseLease: true }).catch(() => undefined); return claimed.id; }
    const principal = { id: spec.principal.id, name: spec.principal.name ?? "", role: (spec.principal.role ?? "viewer") as "admin" | "operator" | "viewer", claims: spec.principal.claims ?? {} };
    const requestedIds = spec.ids ? spec.ids.split(",").map((id) => id.trim()).filter(Boolean) : [];
    const requestedColumns = spec.columns ? [...new Set(spec.columns.split(",").map((column) => column.trim()).filter(Boolean))] : [];
    const pageSize = Math.min(EXPORT_PAGE_SIZE, exportMaxRows());
    const csvCell = (value: unknown) => {
      if (value === null || value === undefined) return "";
      const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
      return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
    };
    try {
      const firstPage = await runListQuery({ search: spec.search, sort: spec.sort, order: spec.order, filters: spec.filters, page: 1, pageSize: requestedIds.length ? exportMaxRows() : pageSize }, new Request("http://worker/export"), { principal, scope: spec.scope });
      if ("error" in firstPage) throw new Error(firstPage.error);
      
      const project = (record: Record<string, unknown>) => redactRecord(record) as Record<string, unknown>;
      let rows = firstPage.result.data.map(project);
      if (requestedIds.length) rows = rows.filter((row) => requestedIds.includes(String(row.id)));
      const visibleColumns = exportColumns.filter((column) => rows.some((row) => Object.hasOwn(row, column)));
      const columns = requestedColumns.length ? visibleColumns.filter((column) => requestedColumns.includes(column)) : visibleColumns;
      if (requestedColumns.length && !columns.length) throw new Error("None of the requested columns can be exported");
      const lines = [columns.join(",") + "\r\n"];
      let written = 0;
      const push = (row: Record<string, unknown>) => { lines.push(columns.map((column) => csvCell(row[column])).join(",") + "\r\n"); written++; };
      for (const row of rows) push(row);
      rows = [];
      const totalPages = requestedIds.length ? 1 : Math.ceil(firstPage.result.total / pageSize);
      for (let page = 2; page <= totalPages; page++) {
        const next = await runListQuery({ search: spec.search, sort: spec.sort, order: spec.order, filters: spec.filters, page, pageSize }, new Request("http://worker/export"), { principal, scope: spec.scope });
        if ("error" in next) throw new Error(next.error);
        for (const record of next.result.data.map(project)) push(record);
        if (written % 500 === 0) await updateExportJob(claimed.id, { processed: written });
      }
      await repository.recordExportAudit?.({ rows: written, filters: firstPage.clauses, principalId: principal.id });
      await updateExportJob(claimed.id, { status: "completed", processed: written, result: lines.join(""), releaseLease: true });
    } catch (error) {
      await updateExportJob(claimed.id, { status: "failed", errors: [error instanceof Error ? error.message : String(error)], releaseLease: true }).catch(() => undefined);
    }
    return claimed.id;
  };
  /**
   * Claims one import job (by id when running inline, otherwise the oldest queued one)
   * and writes its stored payload. Any replica can run this; the lease decides who wins.
   */
  const claimAndProcessImportJob = async (jobId?: string): Promise<string | undefined> => {
    const claimed = await claimImportJob("inventory", importWorkerId, new Date(Date.now() + 120000), jobId);
    if (!claimed) return undefined;
    type ImportPayload = { header: string[]; rows: string[][]; principal: { id: string; name?: string; role?: string; claims?: Record<string, string | number | boolean | null> }; scope?: { field: string; value: string } };
    let payload: ImportPayload;
    try { payload = JSON.parse(claimed.payload) as ImportPayload; }
    catch { await updateImportJob(claimed.id, { status: "failed", errors: ["Import job payload is invalid"], releaseLease: true }).catch(() => undefined); return claimed.id; }
    const payloadPrincipal = { id: payload.principal.id, name: payload.principal.name ?? "", role: (payload.principal.role ?? "viewer") as "admin" | "operator" | "viewer", claims: payload.principal.claims ?? {} };
    const payloadScope = payload.scope;
    
    const createdKeys: string[] = [];
    const jobErrors: string[] = [];
    let processed = 0;
    try {
      for (const [offset, cells] of payload.rows.entries()) {
        const rowNumber = offset + 2;
        try {
          if (cells.length !== payload.header.length) throw new Error("Row " + rowNumber + " has " + cells.length + " columns, expected " + payload.header.length);
          const values = Object.fromEntries(payload.header.map((name, column) => [name, importValue(name, cells[column] ?? "")]));
          const record = await service.create(values, payloadPrincipal.id, payloadScope);
          createdKeys.push(String((record as Record<string, unknown>).id));
        } catch (error) {
          jobErrors.push("Row " + rowNumber + ": " + (error instanceof Error ? error.message : String(error)));
          break;
        }
        processed++;
        if (processed % 25 === 0) await updateImportJob(claimed.id, { processed });
        if (processed % 10 === 0 && await isImportJobCancelled(claimed.id)) {
          if (createdKeys.length) await repository.deleteMany(createdKeys, payloadPrincipal.id, payloadScope).catch(() => undefined);
          await updateImportJob(claimed.id, { status: "cancelled", processed, errors: ["Cancelled"], releaseLease: true });
          return claimed.id;
        }
        const delayMs = Number(Bun.env.QIY_IMPORT_JOB_DELAY_MS ?? 0);
        if (Number.isSafeInteger(delayMs) && delayMs > 0) await Bun.sleep(Math.min(delayMs, 1000));
      }
      if (jobErrors.length) {
        if (createdKeys.length) await repository.deleteMany(createdKeys, payloadPrincipal.id, payloadScope).catch(() => undefined);
        await updateImportJob(claimed.id, { status: "failed", processed, failed: jobErrors.length, errors: jobErrors, releaseLease: true });
      } else {
        await repository.recordImportAudit?.({ rows: processed, principalId: payloadPrincipal.id });
        await updateImportJob(claimed.id, { status: "completed", processed, errors: [], releaseLease: true });
      }
    } catch (error) {
      await updateImportJob(claimed.id, { status: "failed", errors: [...jobErrors, error instanceof Error ? error.message : String(error)], releaseLease: true }).catch(() => undefined);
    }
    return claimed.id;
  };
  // The list and export routes share one query path so export cannot diverge from
  // the list's filter validation, scope handling or row policy.
  const runListQuery = async (query: { page?: number; pageSize?: number; search?: string; sort?: string; order?: "asc" | "desc"; filters?: string }, request: Request, workerContext?: { principal: { id: string; name?: string; role?: string; claims?: Record<string, string | number | boolean | null> }; scope?: { field: string; value: string } }): Promise<{ status: number; error: string } | { result: { data: Array<Record<string, unknown>>; total: number }; clauses: number; policy: undefined }> => {
    let filters: Record<string, string> | FilterExpression[] | undefined;
    if (query.filters) {
      try {
        const parsed: unknown = JSON.parse(query.filters);
        const oldShape = parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every((value) => typeof value === "string");
        const validExpression = (value: unknown, depth = 0): value is FilterExpression => {
          if (depth > 8 || !value || typeof value !== "object" || Array.isArray(value)) return false;
          const filter = value as Record<string, unknown>;
          if (typeof filter.field === "string" && typeof filter.operator === "string" && typeof filter.value === "string") return true;
          return (filter.operator === "and" || filter.operator === "or") && Array.isArray(filter.filters) && filter.filters.length > 0 && filter.filters.every((child) => validExpression(child, depth + 1));
        };
        const newShape = Array.isArray(parsed) && parsed.length > 0 && parsed.every((filter) => validExpression(filter));
        if (!oldShape && !newShape) return { status: 400, error: "Invalid filters" };
        filters = parsed as Record<string, string> | FilterExpression[];
      } catch { return { status: 400, error: "Invalid filters" }; }
    }
    if (query.sort && !sortableFields.includes(query.sort)) return { status: 400, error: "Unsupported sort field" };
    const flatten = (expressions: FilterExpression[]): FilterClause[] => expressions.flatMap((filter) => "field" in filter ? [filter] : flatten(filter.filters));
    const clauses = Array.isArray(filters) ? flatten(filters) : Object.entries(filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
    if (clauses.length > 50) return { status: 400, error: "Too many filters" };
    if (clauses.some((filter) => !filterableFields.includes(filter.field))) return { status: 400, error: "Unsupported filter field" };
    if (clauses.some((filter) => !filterModes[filter.field]?.includes(filter.operator))) return { status: 400, error: "Unsupported filter operator" };
    const scope = workerContext ? workerContext.scope : await resolveScope(request);
    const principal = workerContext ? (workerContext.principal as Principal | null) : await authenticate(request);
    const policy = undefined;
    const result = await service.list(query.page ?? 1, query.pageSize ?? 20, { ...query, filters, scope });
    return { result, clauses: clauses.length, policy };
  };
  const service = createInventoryService(repository);
  return new Elysia({ prefix: "/inventory" })
    .onError(({ error, status }) => error instanceof Error && error.message.startsWith("Missing required data scope claim:") ? status(403, { error: error.message }) : undefined)
    .get("/aggregate", async ({ query, status, request }) => {
      if (!["sum", "avg", "min", "max"].includes(query.op)) return status(400, { error: "Unsupported aggregate operator" });
      if (!(["quantity","reserved"] as string[]).includes(query.field)) return status(400, { error: "Unsupported aggregate field" });
      return repository.aggregate ? repository.aggregate(query.field, query.op as "sum" | "avg" | "min" | "max", await resolveScope(request)) : { value: null, operator: query.op };
    }, { query: t.Object({ field: t.String({ minLength: 1 }), op: t.String({ minLength: 3 }) }) })
    .get("/distribution", async ({ query, status, request }) => {
      return ([] as string[]).includes(query.field) ? repository.distribution(query.field, await resolveScope(request)) : status(400, { error: "Unsupported distribution field" });
    }, { query: t.Object({ field: t.String() }) })
    .get("/trend", async ({ query, status, request }) => {
      return (["updatedAt"] as string[]).includes(query.field) ? repository.trend(query.field, query.days, await resolveScope(request)) : status(400, { error: "Unsupported trend field" });
    }, { query: t.Object({ field: t.String(), days: t.Numeric({ minimum: 1, maximum: 365 }) }) })
    .get("/", async ({ query, status, request }) => {
      const outcome = await runListQuery(query, request);
      if ("error" in outcome) return status(outcome.status, { error: outcome.error });
      return { ...outcome.result, data: outcome.result.data.map((record) => redactRecord(record)) };
    }, {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        search: t.Optional(t.String({ maxLength: 200 })),
        sort: t.Optional(t.String({ maxLength: 64 })),
        order: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
        filters: t.Optional(t.String({ maxLength: 2000 })),
      }),
    })
    .get("/export", async ({ query, status, request }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      const limit = exportMaxRows();
      // Selected-row export is bounded on its own; a large table must not block it.
      const selectedIds = query.ids ? query.ids.split(",").map((id) => id.trim()).filter(Boolean) : [];
      if (selectedIds.length > 500) return status(400, { error: "Select at most 500 rows to export", errorKey: "export.tooManyIds" });
      if (selectedIds.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) return status(400, { error: "Invalid row id for export", errorKey: "export.invalidId" });
      // Column selection is limited to declared exportable columns.
      const requestedColumns = query.columns ? [...new Set(query.columns.split(",").map((column) => column.trim()).filter(Boolean))] : [];
      if (requestedColumns.length > 100) return status(400, { error: "Select at most 100 columns to export", errorKey: "export.tooManyColumns" });
      if (requestedColumns.some((column) => !exportColumns.includes(column))) return status(400, { error: "Unknown export column", errorKey: "export.invalidColumn" });
      const pageSize = Math.min(EXPORT_PAGE_SIZE, limit);
      const firstPage = await runListQuery({ ...query, page: 1, pageSize: selectedIds.length ? limit : pageSize }, request);
      if ("error" in firstPage) return status(firstPage.status, { error: firstPage.error });
      // Refuse rather than silently exporting a partial data range.
      if (!selectedIds.length && firstPage.result.total > limit) return status(400, { error: "Export is limited to " + limit + " rows; narrow the filters", errorKey: "export.tooLarge" });
      const project = (record: Record<string, unknown>) => redactRecord(record) as Record<string, unknown>;
      const firstRecords = selectedIds.length ? firstPage.result.data : firstPage.result.data;
      let firstRows = firstRecords.map(project);
      if (selectedIds.length) firstRows = firstRows.filter((record) => selectedIds.includes(String(record.id)));
      // Masked omit fields disappear from the projection, so the column set is taken once.
      const visibleColumns = exportColumns.filter((column) => firstRows.some((row) => Object.hasOwn(row, column)));
      const columns = requestedColumns.length ? visibleColumns.filter((column) => requestedColumns.includes(column)) : visibleColumns;
      if (requestedColumns.length && !columns.length) return status(400, { error: "None of the requested columns can be exported", errorKey: "export.noColumns" });
      const csvCell = (value: unknown) => {
        if (value === null || value === undefined) return "";
        const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
        return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
      };
      const encoder = new TextEncoder();
      const line = (row: Record<string, unknown>) => columns.map((column) => csvCell(row[column])).join(",") + "\r\n";
      const totalPages = selectedIds.length ? 1 : Math.ceil(firstPage.result.total / pageSize);
      let exported = firstRows.length;
      // Background export: store the request spec and let the worker build the CSV.
      if (query.async === "1") {
        const jobId = await createExportJob({
          resource: "inventory",
          total: firstPage.result.total,
          actorId: principal.id,
          payload: JSON.stringify({ search: query.search, sort: query.sort, order: query.order, filters: query.filters, ids: query.ids, columns: query.columns, principal: { id: principal.id, name: principal.name, role: principal.role, claims: principal.claims ?? {} }, scope: await resolveScope(request) }),
        });
        if (Bun.env.QIY_EXPORT_INLINE !== "off") void claimAndProcessExportJob(jobId);
        return status(202, { jobId, total: firstPage.result.total });
      }
      // Rows stream page by page, so a large export never materializes the whole table.
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(columns.join(",") + "\r\n"));
            for (const row of firstRows) controller.enqueue(encoder.encode(line(row)));
            firstRows = [];
            for (let page = 2; page <= totalPages; page++) {
              const next = await runListQuery({ ...query, page, pageSize }, request);
              if ("error" in next) throw new Error(next.error);
              for (const record of next.result.data.map(project)) {
                controller.enqueue(encoder.encode(line(record)));
                exported++;
              }
            }
            await repository.recordExportAudit?.({ rows: exported, filters: firstPage.clauses, principalId: principal.id });
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + "inventory" + '.csv"' } });
    }, {
      query: t.Object({
        search: t.Optional(t.String({ maxLength: 200 })),
        sort: t.Optional(t.String({ maxLength: 64 })),
        order: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
        filters: t.Optional(t.String({ maxLength: 2000 })),
        ids: t.Optional(t.String({ maxLength: 32000 })),
        columns: t.Optional(t.String({ maxLength: 4000 })),
        async: t.Optional(t.String({ maxLength: 1 })),
      }),
    })
    .post("/import", async ({ request, status, query }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      
      const rows = parseCsv(await request.text());
      if (rows.length < 2) return status(400, { error: "CSV must include a header and at least one data row", errorKey: "import.empty" });
      const header = rows[0]!.map((name) => name.trim());
      const duplicate = header.filter((name, index) => header.indexOf(name) !== index);
      if (duplicate.length) return status(400, { error: "Duplicate import columns: " + duplicate.join(", "), errorKey: "import.duplicateColumn" });
      const unsupported = header.filter((name) => !importColumns.includes(name));
      if (unsupported.length) return status(400, { error: "Unsupported import columns: " + unsupported.join(", "), errorKey: "import.unknownField" });
      
      const limit = importMaxRows();
      if (rows.length - 1 > limit) return status(400, { error: "Import is limited to " + limit + " rows", errorKey: "import.tooLarge" });
      const scope = await resolveScope(request);
      // Background import: the row payload is stored on the job so any replica can run it.
      if (query?.async === "1") {
        const jobId = await createImportJob({
          resource: "inventory",
          total: rows.length - 1,
          actorId: principal.id,
          payload: JSON.stringify({ header, rows: rows.slice(1), principal: { id: principal.id, name: principal.name, role: principal.role, claims: principal.claims ?? {} }, scope }),
        });
        if (Bun.env.QIY_IMPORT_INLINE !== "off") void claimAndProcessImportJob(jobId);
        return status(202, { jobId, total: rows.length - 1 });
      }
      const created: string[] = [];
      // Rows are written one by one, so a failure compensates by deleting what this
      // request already created instead of leaving a partial import behind.
      for (let index = 1; index < rows.length; index++) {
        const cells = rows[index]!;
        if (cells.length !== header.length) { if (created.length) await repository.deleteMany(created, principal.id, scope).catch(() => undefined); return status(400, { error: "Row " + (index + 1) + " has " + cells.length + " columns, expected " + header.length, errorKey: "import.rowLength" }); }
        try {
          const values = Object.fromEntries(header.map((name, column) => [name, importValue(name, cells[column] ?? "")]));
          const record = await service.create(values, principal.id, scope);
          created.push(String((record as Record<string, unknown>).id));
        } catch (error) {
          if (created.length) await repository.deleteMany(created, principal.id, scope).catch(() => undefined);
          
          return status(400, { error: "Row " + (index + 1) + ": " + (error instanceof Error ? error.message : String(error)), errorKey: "import.invalidRow" });
        }
      }
      await repository.recordImportAudit?.({ rows: created.length, principalId: principal.id });
      return status(201, { imported: created.length });
    })
    // Background export progress: status, then a one-shot CSV download.
    .get("/export/jobs/:id", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      const job = await readExportJob(params.id);
      if (!job || job.resource !== "inventory") return status(404, { error: "Export job not found" });
      return { id: job.id, resource: job.resource, status: job.status, total: job.total, processed: job.processed, errors: job.errors, createdAt: job.createdAt, updatedAt: job.updatedAt };
    })
    .get("/export/jobs/:id/download", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      const job = await readExportJob(params.id);
      if (!job || job.resource !== "inventory" || !job.result) return status(404, { error: "Export job not found" });
      if (job.status !== "completed") return status(409, { error: "Export job is not finished", errorKey: "export.notReady" });
      return new Response(job.result, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + job.resource + '.csv"' } });
    })
    // Cross-replica worker: an admin can list work and drive one job from any replica.
    .get("/import/jobs", async ({ request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Worker dispatch requires the admin role", errorKey: "import.forbidden" });
      return { items: await listImportJobs("inventory") };
    })
    .post("/import/jobs/:id/run", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Worker dispatch requires the admin role", errorKey: "import.forbidden" });
      const job = await readImportJob(params.id);
      if (!job || job.resource !== "inventory") return status(404, { error: "Import job not found" });
      if (job.status !== "queued") return status(409, { error: "Import job is not queued", errorKey: "import.notQueued" });
      const ran = await claimAndProcessImportJob(params.id);
      if (!ran) return status(409, { error: "Import job was claimed by another worker", errorKey: "import.claimed" });
      return status(202, { jobId: ran });
    })
    // Cross-replica export worker: list work and run one job from any replica.
    .get("/export/jobs", async ({ request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Worker dispatch requires the admin role", errorKey: "export.forbidden" });
      return { items: await listExportJobs("inventory") };
    })
    .post("/export/jobs/:id/run", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Worker dispatch requires the admin role", errorKey: "export.forbidden" });
      const job = await readExportJob(params.id);
      if (!job || job.resource !== "inventory") return status(404, { error: "Export job not found" });
      if (job.status !== "queued") return status(409, { error: "Export job is not queued", errorKey: "export.notQueued" });
      const ran = await claimAndProcessExportJob(params.id);
      if (!ran) return status(409, { error: "Export job was claimed by another worker", errorKey: "export.claimed" });
      return status(202, { jobId: ran });
    })
    // Background import progress: the caller polls this job id.
    .get("/import/jobs/:id", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      await releaseStaleImportJobs();
      const job = await readImportJob(params.id);
      if (!job || job.resource !== "inventory") return status(404, { error: "Import job not found" });
      return job;
    })
    // Cancelling stops the background loop and compensates what it already wrote.
    .post("/import/jobs/:id/cancel", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      await releaseStaleImportJobs();
      const job = await readImportJob(params.id);
      if (!job || job.resource !== "inventory") return status(404, { error: "Import job not found" });
      const outcome = await requestImportJobCancel(params.id);
      if (outcome === "notRunning") return status(409, { error: "Import job is not running", errorKey: "import.notRunning" });
      return status(202, { status: "cancelled" });
    })
    .get("/:id", async ({ params, status, request }) => {
      const record = await service.one(params.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
    .post("/", async ({ body, status, request }) => status(201, redactRecord(await service.create(body, (await authenticate(request))?.id, await resolveScope(request)))), { body: createInventory })
    .patch("/:id", async ({ params, body, status, request }) => {
      if (Object.keys(body).length === 0) return status(400, { error: "Empty update" });
      const principal = await authenticate(request);
      const record = await service.update(params.id, body, principal?.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }), body: patchInventory })
    .delete("/", async ({ query, request }) => (await repository.deleteMany(query.ids.split(","), (await authenticate(request))?.id, await resolveScope(request))).map((record) => redactRecord(record)), {
      query: t.Object({ ids: t.String({ minLength: 1 }) }),
    })
    .delete("/:id", async ({ params, status, request }) => {
      const record = await service.delete(params.id, (await authenticate(request))?.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });
}

export const inventoryWritableFields = ["inventoryKey", "warehouseId", "binId", "productId", "quantity", "reserved", "lotCode", "updatedAt"] as const;
