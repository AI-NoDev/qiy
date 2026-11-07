/**
 * Server renderers for the per-resource REST routes and their contract tests.
 */
import { manyRelations, generatedFieldsOf, type DatabaseIR, type EntityIR } from "../database-ir";
import type { QiyProject, QiyResourceRestriction } from "../qiy-project";
import { restrictionFixture } from "./permissions";
import { ruleSample, ruleViolations } from "../field-rules";
import { temporalFieldsOf, createFields, patchFields, modelName, filterModesForField } from "./shared";

export function renderRoutes(entity: EntityIR, database: DatabaseIR, scopes: Array<{ resource: string; field: string; claim: string }> = [], hiddenFields: string[] = [], restricted = false, temporalErrorClass = "", fieldRuled = false): string {
  const temporal = temporalFieldsOf(entity);
  const name = modelName(entity);
  const route = JSON.stringify(`/${entity.tableName}`);
  const scope = scopes.find((item) => item.resource === entity.name || item.resource === entity.tableName);
  const scopeLiteral = scope ? JSON.stringify({ field: scope.field, claim: scope.claim }) : "null";
  const linkFields = manyRelations(database, entity.name).map((link) => link.field);
  const sortableFields = JSON.stringify(entity.fields.filter((field) => field.sortable !== false).map((field) => field.name));
  const filterableFields = JSON.stringify([...entity.fields.filter((field) => field.filterable !== false).map((field) => field.name), ...linkFields]);
  const filterModes = JSON.stringify(Object.fromEntries([...entity.fields.filter((field) => field.filterable !== false).map((field) => [field.name, filterModesForField(field)]), ...linkFields.map((field) => [field, ["eq", "in"]])]));
  const allowed = entity.fields.filter((field) => !field.primaryKey && field.computed === undefined).map((field) => JSON.stringify(field.name)).join(", ");
  const sanitize = hiddenFields.length ? `const privateFields = ${JSON.stringify(hiddenFields)} as string[];
const redact = (record: Record<string, unknown>) => { const safe = { ...record }; for (const field of privateFields) delete safe[field]; return safe; };` : "const redact = (record: Record<string, unknown>) => record;";
  const privateInputGuard = hiddenFields.length ? `.onRequest(async ({ request, status }) => {
      // Elysia hooks run for every request, so login bodies with a password must not trip this guard.
      const guardedPath = new URL(request.url).pathname;
      if (guardedPath !== "/api/v1" + ${route} && !guardedPath.startsWith("/api/v1" + ${route} + "/")) return;
      if (request.method !== "POST" && request.method !== "PATCH") return;
      try {
        const values: unknown = await request.clone().json();
        if (values && typeof values === "object" && !Array.isArray(values) && privateFields.some((field) => Object.hasOwn(values, field))) return status(400, { error: "Private fields cannot be written" });
      } catch { return; }
    })` : "";
  const maskWriteGuard = restricted ? `.onRequest(async ({ request, status }) => {
      // Elysia hooks run for every request, so this guard must only inspect its own resource.
      if (!new URL(request.url).pathname.startsWith("/api/v1" + ${route})) return;
      if (request.method !== "POST" && request.method !== "PATCH") return;
      let values: unknown;
      try { values = await request.clone().json(); } catch { return; }
      if (!values || typeof values !== "object" || Array.isArray(values)) return;
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      if (policy.maskedFields.some((field) => Object.hasOwn(values, field))) return status(400, { error: "Masked fields cannot be written", errorKey: "policy.maskedField" });
    })` : "";
  const policyColumnEntries = entity.fields.map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const policyPlumbing = restricted ? `
  const policyColumns: Record<string, any> = { ${policyColumnEntries} };
  const resolveResourcePolicy = async (principal: Principal | null, request?: Request | null, scope?: { field: string; value: string }) => resolvePolicy(${JSON.stringify(entity.name)}, principal, policyColumns, scope ?? (request ? await resolveScope(request) : undefined));` : "";
  const policyErrorHandler = restricted
    ? ".onError(({ error, status }) => error instanceof QiyPolicyError ? status(error.status as 403, { error: error.message, errorKey: error.errorKey }) : undefined)"
    : "";
  // Malformed Date/Time payloads are rejected with a documented 400 instead of a
  // generic 500 or TypeBox 422; the class comes from api/src/temporal.ts.
  const temporalErrorHandler = temporalErrorClass
    ? `.onError(({ error, status }) => error instanceof ${temporalErrorClass} ? status(400, { error: error.message }) : undefined)`
    : "";
  // A stale @version counter is a documented 409; the class comes from api/src/concurrency.ts.
  const versionErrorHandler = entity.fields.some((field) => field.version)
    ? `.onError(({ error, status }) => error instanceof QiyVersionConflict ? status(409, { error: error.message, errorKey: error.errorKey }) : undefined)`
    : "";
  // Unknown, soft-deleted or out-of-scope link targets come from api/src/relation-links.ts.
  const linkErrorHandler = linkFields.length
    ? `.onError(({ error, status }) => error instanceof QiyRelationLinkError ? status(400, { error: error.message, errorKey: error.errorKey, field: error.field }) : undefined)`
    : "";
  // @min/@max/@length/@pattern violations come from api/src/field-rules.ts.
  const fieldRuleErrorHandler = fieldRuled
    ? `.onError(({ error, status }) => error instanceof QiyFieldRuleError ? status(400, { error: error.message, errorKey: error.errorKey, field: error.field }) : undefined)`
    : "";
  // Exhausted unique-constraint retries mean the model cannot allocate a distinct
  // code; the write is rejected with a documented 409 instead of a 500.
  const generatedErrorHandler = generatedFieldsOf(entity, database.relations ?? []).length
    ? `.onError(({ error, status }) => error instanceof QiyGeneratedValueConflict ? status(409, { error: error.message, errorKey: "generated.conflict" }) : undefined)`
    : "";
  const redactRecordHelper = restricted
    ? `const redactRecord = (record: Record<string, unknown>, policy?: QiyPolicy) => redact(policy ? policy.mask(record) : record);`
    : `const redactRecord = (record: Record<string, unknown>) => redact(record);`;
  /**
   * Handler bodies are emitted verbatim for unrestricted resources so existing
   * generated output is unchanged; restricted resources additionally resolve the
   * request policy and thread it into every repository call.
   */
  const oneHandler = restricted
    ? `.get("/:id", async ({ params, status, request }) => {
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      const record = await repository.one(params.id, await resolveScope(request), policy);
      return record ? redactRecord(record, policy) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })`
    : `.get("/:id", async ({ params, status, request }) => {
      const record = await repository.one(params.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })`;
  const createHandler = restricted
    ? `.post("/", async ({ body, status, request }) => {
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      return status(201, redactRecord(await repository.create(body, principal?.id, await resolveScope(request), policy), policy));
    }, { body: create${name} })`
    : `.post("/", async ({ body, status, request }) => status(201, redactRecord(await repository.create(body, (await authenticate(request))?.id, await resolveScope(request)))), { body: create${name} })`;
  const patchHandler = restricted
    ? `.patch("/:id", async ({ params, body, status, request }) => {
      if (Object.keys(body).length === 0) return status(400, { error: "Empty update" });
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      const record = await repository.update(params.id, body, principal?.id, await resolveScope(request), policy);
      return record ? redactRecord(record, policy) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }), body: patch${name} })`
    : `.patch("/:id", async ({ params, body, status, request }) => {
      if (Object.keys(body).length === 0) return status(400, { error: "Empty update" });
      const principal = await authenticate(request);
      const record = await repository.update(params.id, body, principal?.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }), body: patch${name} })`;
  const deleteManyHandler = restricted
    ? `.delete("/", async ({ query, request }) => {
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      const records = await repository.deleteMany(query.ids.split(","), principal?.id, await resolveScope(request), policy);
      return records.map((record) => redactRecord(record, policy));
    }, {
      query: t.Object({ ids: t.String({ minLength: 1 }) }),
    })`
    : `.delete("/", async ({ query, request }) => (await repository.deleteMany(query.ids.split(","), (await authenticate(request))?.id, await resolveScope(request))).map((record) => redactRecord(record)), {
      query: t.Object({ ids: t.String({ minLength: 1 }) }),
    })`;
  const softDeletes = entity.fields.some((field) => field.softDelete);
  const restoreHandler = !softDeletes ? "" : restricted
    ? `.post("/:id/restore", async ({ params, status, request }) => {
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      const record = await repository.restore?.(params.id, principal?.id, await resolveScope(request), policy);
      return record ? redactRecord(record, policy) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })`
    : `.post("/:id/restore", async ({ params, status, request }) => {
      const record = await repository.restore?.(params.id, (await authenticate(request))?.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })`;
  const deleteHandler = restricted
    ? `.delete("/:id", async ({ params, status, request }) => {
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      const record = await repository.delete(params.id, principal?.id, await resolveScope(request), policy);
      return record ? redactRecord(record, policy) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });`
    : `.delete("/:id", async ({ params, status, request }) => {
      const record = await repository.delete(params.id, (await authenticate(request))?.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });`;
  return `
const create${name} = t.Object({
${createFields(entity, database)}
}, { additionalProperties: false${entity.comment !== undefined ? `, description: ${JSON.stringify(entity.comment)}` : ""} });

const patch${name} = t.Object({
${patchFields(entity, database)}
}, { additionalProperties: false${entity.comment !== undefined ? `, description: ${JSON.stringify(entity.comment)}` : ""} });

export interface ${name}Repository {
  distribution(field: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ value: string | null; count: number }>>;
  grouped?(groupBy: string, metric: string, operator: "sum" | "avg" | "min" | "max", scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ value: string | null; count: number }>>;
  /** Optional so generated test doubles and hand-written repositories keep compiling. */
  aggregate?(field: string, operator: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<{ value: number | null; operator: string }>;
  trend(field: string, days: number, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ day: string; count: number }>>;
  list(page: number, pageSize: number, options?: ListQuery): Promise<{ data: Array<Record<string, unknown>>; total: number }>;
  one(id: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  create(values: typeof create${name}.static, actorId?: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown>>;
  update(id: string, values: typeof patch${name}.static, actorId?: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  delete(id: string, actorId?: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  deleteMany(ids: string[], actorId?: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<Record<string, unknown>>>;
  /** Clears the @softDelete marker; only soft-deleted resources implement it. */
  restore?(id: string, actorId?: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
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
  /** Lists soft-deleted rows instead of live ones (ignored without @softDelete). */
  deleted?: boolean;
${restricted ? "  policy?: QiyPolicy;" : ""}
}

export function ${name}Routes(repository: ${name}Repository, authenticate: Authenticator = async () => null) {
  ${sanitize}
  ${redactRecordHelper}
  const sortableFields = ${sortableFields} as string[];
  const filterableFields = ${filterableFields} as string[];
  const filterModes = ${filterModes} as Record<string, FilterOperator[]>;
  const resolveScope = async (request: Request) => {
    const principal = await authenticate(request);
    const scopeConfig = ${scopeLiteral} as { field: string; claim: string } | null;
    const scopeField = scopeConfig?.field;
    const scopeClaim = scopeConfig?.claim;
    if (!scopeField || !scopeClaim) return undefined;
    const claimValue = principal?.claims?.[scopeClaim];
    if (!principal || claimValue === undefined || claimValue === null || claimValue === "") throw new Error("Missing required data scope claim: " + scopeClaim);
    return { field: scopeField, value: String(claimValue) };
  };${policyPlumbing}
  const exportColumns = ${JSON.stringify([...entity.fields.filter((field) => field.type !== "Vector").map((field) => field.name), ...linkFields])} as string[];
  const exportMaxRows = () => { const value = Number(Bun.env.QIY_EXPORT_MAX_ROWS ?? 1000); return Number.isSafeInteger(value) && value >= 1 && value <= 100000 ? value : 1000; };
  // Exports stream in bounded pages so memory does not grow with the result set.
  const EXPORT_PAGE_SIZE = Math.min(250, exportMaxRows());
  // Import accepts plain scalar columns only; vectors and key lists need the API.
${linkFields.length ? "  // Many-to-many link fields travel as JSON id arrays, like Array columns.\n" : ""}  const importTypes = ${JSON.stringify(Object.fromEntries([...entity.fields.filter((field) => !field.primaryKey && !field.stateMachine && field.type !== "Vector" && field.type !== "Files").map((field) => [field.name, field.type]), ...linkFields.map((field) => [field, "Array"])]))} as Record<string, string>;
  const importArrayItems = ${JSON.stringify(Object.fromEntries(entity.fields.filter((field) => field.type === "Array").map((field) => [field.name, field.itemType]))) } as Record<string, string | undefined>;
${entity.fields.some((field) => field.defaultValue) ? `  // An empty cell leaves a @default column to its declared default.
  const importDefaulted = new Set(${JSON.stringify(entity.fields.filter((field) => field.defaultValue).map((field) => field.name))});
` : ""}  const importColumns = Object.keys(importTypes);
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
      if (char === "\\r") continue;
      if (char === "\\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
      field += char;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((cells) => cells.some((cell) => cell.length > 0));
  };
  const importValue = (field: string, value: string) => {
    if (value === "") return ${entity.fields.some((field) => field.defaultValue) ? "importDefaulted.has(field) ? undefined : null" : "null"};
    if (importTypes[field] === "Integer") { const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error("Column " + field + " must be an integer"); return parsed; }
    if (importTypes[field] === "Boolean") { if (!["true", "false", "1", "0"].includes(value.toLowerCase())) throw new Error("Column " + field + " must be true or false"); return value === "1" || value.toLowerCase() === "true"; }
    if (importTypes[field] === "JSON" || importTypes[field] === "Array") {
      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { throw new Error("Column " + field + " must be valid JSON"); }
      if (importTypes[field] === "Array") {
        if (!Array.isArray(parsed)) throw new Error("Column " + field + " must be a JSON array");
        if (importArrayItems[field] === "Integer" && parsed.some((item) => !Number.isInteger(item))) throw new Error("Column " + field + " must be an array of integers");
        if (importArrayItems[field] !== "Integer" && parsed.some((item) => typeof item !== "string")) throw new Error("Column " + field + " must be an array of strings");
      }
      return parsed;
    }
    if (importTypes[field] === "DateTime") { const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) throw new Error("Column " + field + " must be an ISO date-time"); return parsed; }${temporal.length ? `
    if (importTypes[field] === "Date") { const parsed = new Date(value + "T00:00:00Z"); if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Column " + field + " must be a YYYY-MM-DD date"); return value; }
    if (importTypes[field] === "Time") { const match = /^([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/.exec(value); if (!match) throw new Error("Column " + field + " must be a HH:mm:ss time"); return match[1] + ":" + match[2] + ":" + (match[3] ?? "00"); }` : ""}
    return value;
  };
  const importWorkerId = crypto.randomUUID();
  const exportWorkerId = crypto.randomUUID();
  /**
   * Claims one export job (by id inline, otherwise the oldest queued one) and
   * rebuilds its CSV from the stored request spec, so any replica can finish it.
   */
  const claimAndProcessExportJob = async (jobId?: string): Promise<string | undefined> => {
    const claimed = await claimExportJob(${JSON.stringify(entity.tableName)}, exportWorkerId, new Date(Date.now() + 120000), jobId);
    if (!claimed) return undefined;
    type ExportSpec = { search?: string; sort?: string; order?: "asc" | "desc"; filters?: string; ids?: string; columns?: string; principal: { id: string; name?: string; role?: string; claims?: Record<string, string | number | boolean | null> }; scope?: { field: string; value: string } };
    let spec: ExportSpec;
    try { spec = JSON.parse(claimed.payload) as ExportSpec; }
    catch { await updateExportJob(claimed.id, { status: "failed", errors: ["Export job payload is invalid"], releaseLease: true }).catch(() => undefined); return claimed.id; }
    const principal = { id: spec.principal.id, name: spec.principal.name ?? "", role: isQiyRole(spec.principal.role) ? spec.principal.role : QIY_DEFAULT_ROLE, claims: spec.principal.claims ?? {} };
    const requestedIds = spec.ids ? spec.ids.split(",").map((id) => id.trim()).filter(Boolean) : [];
    const requestedColumns = spec.columns ? [...new Set(spec.columns.split(",").map((column) => column.trim()).filter(Boolean))] : [];
    const pageSize = Math.min(EXPORT_PAGE_SIZE, exportMaxRows());
    const csvCell = (value: unknown) => {
      if (value === null || value === undefined) return "";
      const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
      return /[",\\r\\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
    };
    try {
      const firstPage = await runListQuery({ search: spec.search, sort: spec.sort, order: spec.order, filters: spec.filters, page: 1, pageSize: requestedIds.length ? exportMaxRows() : pageSize }, new Request("http://worker/export"), { principal, scope: spec.scope });
      if ("error" in firstPage) throw new Error(firstPage.error);
      ${restricted ? "const policy = firstPage.policy;" : ""}
      const project = (record: Record<string, unknown>) => redactRecord(record${restricted ? ", policy" : ""}) as Record<string, unknown>;
      let rows = firstPage.result.data.map(project);
      if (requestedIds.length) rows = rows.filter((row) => requestedIds.includes(String(row.id)));
      const visibleColumns = exportColumns.filter((column) => rows.some((row) => Object.hasOwn(row, column)));
      const columns = requestedColumns.length ? visibleColumns.filter((column) => requestedColumns.includes(column)) : visibleColumns;
      if (requestedColumns.length && !columns.length) throw new Error("None of the requested columns can be exported");
      const lines = [columns.join(",") + "\\r\\n"];
      let written = 0;
      const push = (row: Record<string, unknown>) => { lines.push(columns.map((column) => csvCell(row[column])).join(",") + "\\r\\n"); written++; };
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
    const claimed = await claimImportJob(${JSON.stringify(entity.tableName)}, importWorkerId, new Date(Date.now() + 120000), jobId);
    if (!claimed) return undefined;
    type ImportPayload = { header: string[]; rows: string[][]; principal: { id: string; name?: string; role?: string; claims?: Record<string, string | number | boolean | null> }; scope?: { field: string; value: string } };
    let payload: ImportPayload;
    try { payload = JSON.parse(claimed.payload) as ImportPayload; }
    catch { await updateImportJob(claimed.id, { status: "failed", errors: ["Import job payload is invalid"], releaseLease: true }).catch(() => undefined); return claimed.id; }
    const payloadPrincipal = { id: payload.principal.id, name: payload.principal.name ?? "", role: isQiyRole(payload.principal.role) ? payload.principal.role : QIY_DEFAULT_ROLE, claims: payload.principal.claims ?? {} };
    const payloadScope = payload.scope;
    ${restricted ? "const payloadPolicy = await resolveResourcePolicy(payloadPrincipal as never, null, payloadScope);" : ""}
    const createdKeys: string[] = [];
    const jobErrors: string[] = [];
    let processed = 0;
    try {
      for (const [offset, cells] of payload.rows.entries()) {
        const rowNumber = offset + 2;
        try {
          if (cells.length !== payload.header.length) throw new Error("Row " + rowNumber + " has " + cells.length + " columns, expected " + payload.header.length);
          const values = Object.fromEntries(payload.header.map((name, column) => [name, importValue(name, cells[column] ?? "")]));
          const record = await repository.create(values, payloadPrincipal.id, payloadScope${restricted ? ", payloadPolicy" : ""});
          createdKeys.push(String((record as Record<string, unknown>).id));
        } catch (error) {
          jobErrors.push("Row " + rowNumber + ": " + (error instanceof Error ? error.message : String(error)));
          break;
        }
        processed++;
        if (processed % 25 === 0) await updateImportJob(claimed.id, { processed });
        if (processed % 10 === 0 && await isImportJobCancelled(claimed.id)) {
          if (createdKeys.length) await repository.deleteMany(createdKeys, payloadPrincipal.id, payloadScope${restricted ? ", payloadPolicy" : ""}).catch(() => undefined);
          await updateImportJob(claimed.id, { status: "cancelled", processed, errors: ["Cancelled"], releaseLease: true });
          return claimed.id;
        }
        const delayMs = Number(Bun.env.QIY_IMPORT_JOB_DELAY_MS ?? 0);
        if (Number.isSafeInteger(delayMs) && delayMs > 0) await Bun.sleep(Math.min(delayMs, 1000));
      }
      if (jobErrors.length) {
        if (createdKeys.length) await repository.deleteMany(createdKeys, payloadPrincipal.id, payloadScope${restricted ? ", payloadPolicy" : ""}).catch(() => undefined);
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
  const runListQuery = async (query: { page?: number; pageSize?: number; search?: string; sort?: string; order?: "asc" | "desc"; filters?: string; deleted?: string }, request: Request, workerContext?: { principal: { id: string; name?: string; role?: string; claims?: Record<string, string | number | boolean | null> }; scope?: { field: string; value: string } }): Promise<{ status: number; error: string } | { result: { data: Array<Record<string, unknown>>; total: number }; clauses: number; policy: ${restricted ? "QiyPolicy" : "undefined"} }> => {
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
    const policy = ${restricted ? "await resolveResourcePolicy(principal, request, workerContext ? workerContext.scope : undefined)" : "undefined"};
    const result = await repository.list(query.page ?? 1, query.pageSize ?? 20, { ...query, deleted: query.deleted === "true", filters, scope${restricted ? ", policy" : ""} });
    return { result, clauses: clauses.length, policy };
  };
  return new Elysia({ prefix: ${route} })${privateInputGuard}${maskWriteGuard}\n    .onError(({ error, status }) => error instanceof Error && error.message.startsWith("Missing required data scope claim:") ? status(403, { error: error.message }) : undefined)${policyErrorHandler}${temporalErrorHandler}${fieldRuleErrorHandler}${versionErrorHandler}${linkErrorHandler}${generatedErrorHandler}\n    .get("/aggregate", async ({ query, status, request }) => {
      ${restricted ? "const principal = await authenticate(request);\n      const policy = await resolveResourcePolicy(principal, request);\n      if (policy.maskedFields.includes(query.field)) return status(403, { error: \"Aggregating a masked field is not permitted\", errorKey: \"policy.maskedField\" });\n      " : ""}if (!["sum", "avg", "min", "max"].includes(query.op)) return status(400, { error: "Unsupported aggregate operator" });
      if (!(${JSON.stringify(entity.fields.filter((field) => ["Integer", "Decimal", "Money"].includes(field.type)).map((field) => field.name))} as string[]).includes(query.field)) return status(400, { error: "Unsupported aggregate field" });
      return repository.aggregate ? repository.aggregate(query.field, query.op as "sum" | "avg" | "min" | "max", await resolveScope(request)${restricted ? ", policy" : ""}) : { value: null, operator: query.op };
    }, { query: t.Object({ field: t.String({ minLength: 1 }), op: t.String({ minLength: 3 }) }) })
    .get("/distribution", async ({ query, status, request }) => {
      ${restricted ? "const principal = await authenticate(request);\n      const policy = await resolveResourcePolicy(principal, request);\n      " : ""}if (query.metric) {
        if (!repository.grouped) return status(501, { error: "Grouped aggregation is not supported" });
        if (!["sum", "avg", "min", "max"].includes(query.op ?? "")) return status(400, { error: "Unsupported aggregate operator" });
        if (!(${JSON.stringify(entity.fields.filter((field) => ["Integer", "Decimal", "Money"].includes(field.type)).map((field) => field.name))} as string[]).includes(query.metric)) return status(400, { error: "Unsupported aggregate field" });
        return (${JSON.stringify(entity.fields.filter((field) => field.enumName).map((field) => field.name))} as string[]).includes(query.field) ? repository.grouped(query.field, query.metric, query.op as "sum" | "avg" | "min" | "max", await resolveScope(request)${restricted ? ", policy" : ""}) : status(400, { error: "Unsupported distribution field" });
      }
      return (${JSON.stringify(entity.fields.filter((field) => field.enumName).map((field) => field.name))} as string[]).includes(query.field) ? repository.distribution(query.field, await resolveScope(request)${restricted ? ", policy" : ""}) : status(400, { error: "Unsupported distribution field" });
    }, { query: t.Object({ field: t.String(), metric: t.Optional(t.String()), op: t.Optional(t.String()) }) })
    .get("/trend", async ({ query, status, request }) => {
      ${restricted ? "const principal = await authenticate(request);\n      const policy = await resolveResourcePolicy(principal, request);\n      " : ""}return (${JSON.stringify(entity.fields.filter((field) => field.type === "DateTime").map((field) => field.name))} as string[]).includes(query.field) ? repository.trend(query.field, query.days, await resolveScope(request)${restricted ? ", policy" : ""}) : status(400, { error: "Unsupported trend field" });
    }, { query: t.Object({ field: t.String(), days: t.Numeric({ minimum: 1, maximum: 365 }) }) })
    .get("/", async ({ query, status, request }) => {
      const outcome = await runListQuery(query, request);
      if ("error" in outcome) return status(outcome.status, { error: outcome.error });
      return { ...outcome.result, data: outcome.result.data.map((record) => redactRecord(record${restricted ? ", outcome.policy" : ""})) };
    }, {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        search: t.Optional(t.String({ maxLength: 200 })),
        sort: t.Optional(t.String({ maxLength: 64 })),
        order: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
        filters: t.Optional(t.String({ maxLength: 2000 })),${softDeletes ? `
        deleted: t.Optional(t.Union([t.Literal("true"), t.Literal("false")])),` : ""}
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
      const project = (record: Record<string, unknown>) => redactRecord(record${restricted ? ", firstPage.policy" : ""}) as Record<string, unknown>;
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
        return /[",\\r\\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
      };
      const encoder = new TextEncoder();
      const line = (row: Record<string, unknown>) => columns.map((column) => csvCell(row[column])).join(",") + "\\r\\n";
      const totalPages = selectedIds.length ? 1 : Math.ceil(firstPage.result.total / pageSize);
      let exported = firstRows.length;
      // Background export: store the request spec and let the worker build the CSV.
      if (query.async === "1") {
        const jobId = await createExportJob({
          resource: ${JSON.stringify(entity.tableName)},
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
            controller.enqueue(encoder.encode(columns.join(",") + "\\r\\n"));
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
      return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + ${JSON.stringify(entity.tableName)} + '.csv"' } });
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
      ${restricted ? "const policy = await resolveResourcePolicy(principal, request);" : ""}
      const rows = parseCsv(await request.text());
      if (rows.length < 2) return status(400, { error: "CSV must include a header and at least one data row", errorKey: "import.empty" });
      const header = rows[0]!.map((name) => name.trim());
      const duplicate = header.filter((name, index) => header.indexOf(name) !== index);
      if (duplicate.length) return status(400, { error: "Duplicate import columns: " + duplicate.join(", "), errorKey: "import.duplicateColumn" });
      const unsupported = header.filter((name) => !importColumns.includes(name));
      if (unsupported.length) return status(400, { error: "Unsupported import columns: " + unsupported.join(", "), errorKey: "import.unknownField" });
      ${restricted ? "const maskedColumns = policy.maskedFields.filter((field) => header.includes(field));\n      if (maskedColumns.length) return status(400, { error: \"Masked fields cannot be imported: \" + maskedColumns.join(\", \"), errorKey: \"import.maskedField\" });" : ""}
      const limit = importMaxRows();
      if (rows.length - 1 > limit) return status(400, { error: "Import is limited to " + limit + " rows", errorKey: "import.tooLarge" });
      const scope = await resolveScope(request);
      // Background import: the row payload is stored on the job so any replica can run it.
      if (query?.async === "1") {
        const jobId = await createImportJob({
          resource: ${JSON.stringify(entity.tableName)},
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
        if (cells.length !== header.length) { if (created.length) await repository.deleteMany(created, principal.id, scope${restricted ? ", policy" : ""}).catch(() => undefined); return status(400, { error: "Row " + (index + 1) + " has " + cells.length + " columns, expected " + header.length, errorKey: "import.rowLength" }); }
        try {
          const values = Object.fromEntries(header.map((name, column) => [name, importValue(name, cells[column] ?? "")]));
          const record = await repository.create(values, principal.id, scope${restricted ? ", policy" : ""});
          created.push(String((record as Record<string, unknown>).id));
        } catch (error) {
          if (created.length) await repository.deleteMany(created, principal.id, scope${restricted ? ", policy" : ""}).catch(() => undefined);
          ${restricted ? 'if (error instanceof QiyPolicyError) return status(403, { error: "Row " + (index + 1) + ": " + error.message, errorKey: error.errorKey });' : ""}
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
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Export job not found" });
      return { id: job.id, resource: job.resource, status: job.status, total: job.total, processed: job.processed, errors: job.errors, createdAt: job.createdAt, updatedAt: job.updatedAt };
    })
    .get("/export/jobs/:id/download", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      const job = await readExportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)} || !job.result) return status(404, { error: "Export job not found" });
      if (job.status !== "completed") return status(409, { error: "Export job is not finished", errorKey: "export.notReady" });
      return new Response(job.result, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + job.resource + '.csv"' } });
    })
    // Cross-replica worker: an admin can list work and drive one job from any replica.
    .get("/import/jobs", async ({ request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!hasFullAccess(principal.role)) return status(403, { error: "Worker dispatch requires a full-access role", errorKey: "import.forbidden" });
      return { items: await listImportJobs(${JSON.stringify(entity.tableName)}) };
    })
    .post("/import/jobs/:id/run", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!hasFullAccess(principal.role)) return status(403, { error: "Worker dispatch requires a full-access role", errorKey: "import.forbidden" });
      const job = await readImportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Import job not found" });
      if (job.status !== "queued") return status(409, { error: "Import job is not queued", errorKey: "import.notQueued" });
      const ran = await claimAndProcessImportJob(params.id);
      if (!ran) return status(409, { error: "Import job was claimed by another worker", errorKey: "import.claimed" });
      return status(202, { jobId: ran });
    })
    // Cross-replica export worker: list work and run one job from any replica.
    .get("/export/jobs", async ({ request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!hasFullAccess(principal.role)) return status(403, { error: "Worker dispatch requires a full-access role", errorKey: "export.forbidden" });
      return { items: await listExportJobs(${JSON.stringify(entity.tableName)}) };
    })
    .post("/export/jobs/:id/run", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!hasFullAccess(principal.role)) return status(403, { error: "Worker dispatch requires a full-access role", errorKey: "export.forbidden" });
      const job = await readExportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Export job not found" });
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
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Import job not found" });
      return job;
    })
    // Cancelling stops the background loop and compensates what it already wrote.
    .post("/import/jobs/:id/cancel", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      await releaseStaleImportJobs();
      const job = await readImportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Import job not found" });
      const outcome = await requestImportJobCancel(params.id);
      if (outcome === "notRunning") return status(409, { error: "Import job is not running", errorKey: "import.notRunning" });
      return status(202, { status: "cancelled" });
    })
    ${oneHandler}
    ${createHandler}
    ${patchHandler}
    ${deleteManyHandler}
    ${restoreHandler}
    ${deleteHandler}
}

export const ${entity.name}WritableFields = [${allowed}] as const;
`;
}

export function renderRouteTest(entity: EntityIR, database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]> = [], hiddenFields: string[] = [], restrictions: QiyResourceRestriction[] = []): string {
  const name = modelName(entity);
  const scopeClaims = Object.fromEntries(scopes.map((scope) => [scope.claim, database.entities.find((item) => item.name === scope.resource || item.tableName === scope.resource)?.fields.find((field) => field.name === scope.field)?.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : "Example"]));
  const claims = JSON.stringify({ ...scopeClaims, ...restrictionFixture(database, restrictions, [entity.name])?.claims });
  const values = entity.fields.filter((field) => field.computed === undefined && !field.primaryKey && !field.nullable && !field.version && !field.stateMachine).map((field) => {
    const constrained = ruleSample(field);
    const example = constrained !== undefined ? JSON.stringify(constrained) : field.type === "Integer" ? "1" : field.type === "Boolean" ? "true" : field.type === "Array" ? (field.itemType === "Integer" ? "[1]" : '["Example"]') : field.type === "Decimal" || field.type === "Money" ? '"1.00"'
      : field.type === "Vector" ? `Array(${field.dimension}).fill(0)` : field.type === "Files" ? '["uploads/sample.pdf"]' : field.type === "DateTime" ? '"2026-01-01T00:00:00.000Z"' : field.type === "Date" ? '"2026-11-30"' : field.type === "Time" ? '"08:30:00"' : field.type === "UUID" ? '"00000000-0000-4000-8000-000000000002"'
        : field.enumName ? JSON.stringify(database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values[0]?.name ?? "") : field.type === "Email" ? '"user@example.com"' : field.type === "URL" ? '"https://example.com"' : '"Example"';
    return `${JSON.stringify(field.name)}: ${example}`;
  }).join(", ");
  const unsupportedQueryTests = [
    ...entity.fields.filter((field) => field.sortable === false).map((field) => `  test("rejects sorting on disabled field ${field.name}", async () => {
    const response = await app.handle(new Request(endpoint + "/?sort=${encodeURIComponent(field.name)}"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported sort field" });
  });`),
    ...entity.fields.filter((field) => field.filterable === false).map((field) => `  test("rejects filtering on disabled field ${field.name}", async () => {
    const filters = encodeURIComponent(JSON.stringify({ ${JSON.stringify(field.name)}: "x" }));
    const response = await app.handle(new Request(endpoint + "/?filters=" + filters));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported filter field" });
  });`),
  ].join("\n\n");
  const hiddenFieldTests = hiddenFields.map((field) => `
  test("never returns or persists private field ${field}", async () => {
    records.clear();
    const id = "00000000-0000-4000-8000-000000000077";
    records.set(id, { id, ${JSON.stringify(field)}: "argon2id-private-hash" });
    const found = await app.handle(new Request(endpoint + "/" + id));
    expect(found.status).toBe(200);
    expect(await found.json()).not.toHaveProperty(${JSON.stringify(field)});
    const listed = await app.handle(new Request(endpoint + "/"));
    expect(await listed.json()).not.toMatchObject({ data: [ { ${JSON.stringify(field)}: "argon2id-private-hash" } ] });
    const created = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values}${values ? ", " : ""}${JSON.stringify(field)}: "attacker-controlled-hash" }) }));
    expect(created.status).toBe(400);
    expect(await created.json()).toEqual({ error: "Private fields cannot be written" });
    expect([...records.values()].some((record) => record[${JSON.stringify(field)}] === "attacker-controlled-hash")).toBe(false);
  });`).join("\n");
  // Date and Time are text contracts validated in api/src/temporal.ts: a malformed
  // value must be a documented 400 on create and update, and a bare `HH:mm` Time
  // is normalized to the stored `HH:mm:ss` form.
  const temporalFixtureFields = temporalFieldsOf(entity);
  const invalidTemporalValue = (type: "Date" | "Time") => type === "Date" ? "not-a-date" : "25:61:00";
  const temporalTests = temporalFixtureFields.map(([field, type]) => `
  test("rejects an invalid ${type} value for ${field}", async () => {
    records.clear();
    const invalid = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...({ ${values} } as Record<string, unknown>), ${JSON.stringify(field)}: ${JSON.stringify(invalidTemporalValue(type))} }) }));
    expect(invalid.status).toBe(400);
    expect(String((await invalid.json() as { error?: string }).error)).toContain(${JSON.stringify(field)});
    const created = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values} }) }));
    expect(created.status).toBe(201);
    const record = await created.json() as { id: string };
    const patched = await app.handle(new Request(endpoint + "/" + record.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${JSON.stringify(field)}: ${JSON.stringify(invalidTemporalValue(type))} }) }));
    expect(patched.status).toBe(400);
  });`).join("\n");
  const firstTimeField = temporalFixtureFields.find(([, type]) => type === "Time")?.[0];
  const temporalNormalizationTest = firstTimeField
    ? `
  test("normalizes a HH:mm Time value to HH:mm:ss", async () => {
    records.clear();
    const created = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...({ ${values} } as Record<string, unknown>), ${JSON.stringify(firstTimeField)}: "08:30" }) }));
    expect(created.status).toBe(201);
    expect((await created.json() as Record<string, unknown>)[${JSON.stringify(firstTimeField)}]).toBe("08:30:00");
  });`
    : "";
  // Non-temporal resources keep the previous generated output byte-for-byte.
  const temporalSection = temporalTests || temporalNormalizationTest ? `\n${temporalTests}${temporalNormalizationTest}` : "";
  // Each declared @min/@max/@length/@pattern rule is a documented 400 on create and update.
  const ruleTests = entity.fields.filter((field) => !hiddenFields.includes(field.name)).flatMap((field) => ruleViolations(field).map(({ rule, value }) => `
  test("rejects ${field.name} values that break its ${rule} rule", async () => {
    records.clear();
    const invalid = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...({ ${values} } as Record<string, unknown>), ${JSON.stringify(field.name)}: ${JSON.stringify(value)} }) }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ errorKey: ${JSON.stringify(`validation.${rule}`)}, field: ${JSON.stringify(field.name)} });
    expect(records.size).toBe(0);
    const created = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values} }) }));
    expect(created.status).toBe(201);
    const record = await created.json() as { id: string };
    const patched = await app.handle(new Request(endpoint + "/" + record.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${JSON.stringify(field.name)}: ${JSON.stringify(value)} }) }));
    expect(patched.status).toBe(400);
  });`)).join("\n");
  const ruleSection = ruleTests ? `\n${ruleTests}` : "";
  const stateSection = entity.fields.filter((field) => field.stateMachine).map((field) => {
    const target = database.enums?.find((item) => item.name === field.enumName)?.values.find((value) => field.defaultValue?.kind !== "literal" || value.name !== field.defaultValue.value)?.name ?? "";
    return `
  test("only statemachine ${field.stateMachine} changes ${field.name}", async () => {
    records.clear();
    const created = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values}${values ? ", " : ""}${JSON.stringify(field.name)}: ${JSON.stringify(target)} }),
    }));
    expect(created.status).toBe(201);
    const record = await created.json() as Record<string, unknown> & { id: string };
    expect(record[${JSON.stringify(field.name)}]).not.toBe(${JSON.stringify(target)});
    const patched = await app.handle(new Request(endpoint + "/" + record.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${JSON.stringify(field.name)}: ${JSON.stringify(target)} }),
    }));
    expect(patched.status).toBe(400);
  });`;
  }).join("\n");
  const linkSection = manyRelations(database, entity.name).map((link) => `
  test("validates the ${link.field} id list", async () => {
    records.clear();
    const post = (body: Record<string, unknown>) => app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...{ ${values} }, ...body }) }));
    const id = "00000000-0000-4000-8000-0000000000aa";
    for (const invalid of [["not-a-uuid"], [id, id], id, Array.from({ length: 501 }, () => crypto.randomUUID())]) expect((await post({ ${JSON.stringify(link.field)}: invalid })).status).toBe(422);
    const created = await post({ ${JSON.stringify(link.field)}: [id] });
    expect(created.status).toBe(201);
    expect((await created.json() as Record<string, unknown>)[${JSON.stringify(link.field)}]).toEqual([id]);
    const filtered = (filters: unknown) => app.handle(new Request(endpoint + "/?filters=" + encodeURIComponent(JSON.stringify(filters))));
    expect((await filtered([{ field: ${JSON.stringify(link.field)}, operator: "in", value: id }])).status).toBe(200);
    expect((await filtered([{ field: ${JSON.stringify(link.field)}, operator: "contains", value: "0" }])).status).toBe(400);
  });`).join("\n");
  return `import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${name}Routes, type ${name}Repository } from "../src/routes/${entity.name}";
import { QIY_ADMIN_ROLE } from "../src/auth/roles";

const records = new Map<string, Record<string, unknown>>();
const repository: ${name}Repository = {
  async distribution(field) { const counts = new Map<string, number>(); for (const record of records.values()) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },
  async trend(field, days) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.values()) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },
  async list(page, pageSize, options = {}) {
    const data = [...records.values()];
    const filtered = options.search ? data.filter((record) => Object.values(record).some((value) => String(value ?? "").toLowerCase().includes(options.search!.toLowerCase()))) : data;
    const filterClauses = (expressions: Array<{ field: string; operator: string; value: string } | { operator: "and" | "or"; filters: unknown[] }>): Array<{ field: string; operator: string; value: string }> => expressions.flatMap((filter) => "field" in filter ? [filter] : filterClauses(filter.filters as Array<{ field: string; operator: string; value: string } | { operator: "and" | "or"; filters: unknown[] }>));
    const clauses = Array.isArray(options.filters) ? filterClauses(options.filters) : Object.entries(options.filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
    const filteredByFields = clauses.reduce((rows, { field, operator, value }) => rows.filter((record) => {
      const actual = record[field]; const text = String(actual ?? "");
      if (operator === "contains") return text.toLowerCase().includes(value.toLowerCase());
      if (operator === "startsWith") return text.toLowerCase().startsWith(value.toLowerCase());
      if (operator === "endsWith") return text.toLowerCase().endsWith(value.toLowerCase());
      if (operator === "in") return value.split(",").map((item) => item.trim()).includes(text);
      if (operator === "between") { const [lower, upper] = value.split(",").map(Number); return Number(actual) >= lower! && Number(actual) <= upper!; }
      if (operator === "gt") return Number(actual) > Number(value);
      if (operator === "gte") return Number(actual) >= Number(value);
      if (operator === "lt") return Number(actual) < Number(value);
      if (operator === "lte") return Number(actual) <= Number(value);
      return text === value;
    }), filtered);
    const sorted = options.sort ? [...filteredByFields].sort((left, right) => String(left[options.sort!] ?? "").localeCompare(String(right[options.sort!] ?? ""))) : filteredByFields;
    if (options.order === "desc") sorted.reverse();
    return { data: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length };
  },
  async one(id) { return records.get(id); },
  async create(values) {
    const record = { id: crypto.randomUUID(), ...values };
    records.set(record.id, record);
    return record;
  },
  async update(id, values) {
    const old = records.get(id);
    if (!old) return undefined;
    const record = { ...old, ...values };
    records.set(id, record);
    return record;
  },
  async delete(id) {
    const record = records.get(id);
    records.delete(id);
    return record;
  },
  async deleteMany(ids) {
    const deleted = ids.flatMap((id) => {
      const record = records.get(id);
      records.delete(id);
      return record ? [record] : [];
    });
    return deleted;
  },
};
  const app = new Elysia({ prefix: "/api/v1" }).use(${name}Routes(repository, async () => ({ id: "00000000-0000-4000-8000-000000000001", name: "Scoped User", role: QIY_ADMIN_ROLE, claims: ${claims} })));
const endpoint = "http://localhost/api/v1/${entity.tableName}";

describe("${entity.tableName} CRUD", () => {
  test("creates, lists, reads, updates and deletes", async () => {
    records.clear();
    const created = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values} }),
    }));
    expect(created.status).toBe(201);
    const record = await created.json() as { id: string };
    expect(record.id).toBeTruthy();
    const listed = await app.handle(new Request(endpoint + "/?page=1&pageSize=10"));
    expect(listed.status).toBe(200);
    expect((await listed.json() as { total: number }).total).toBe(1);
    const queried = await app.handle(new Request(endpoint + "/?sort=id&order=desc&filters=" + encodeURIComponent(JSON.stringify({ id: record.id }))));
    expect(queried.status).toBe(200);
    expect((await queried.json() as { total: number }).total).toBe(1);
    const found = await app.handle(new Request(endpoint + "/" + record.id));
    expect(found.status).toBe(200);
    const patched = await app.handle(new Request(endpoint + "/" + record.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    }));
    expect(patched.status).toBe(400);
    const deleted = await app.handle(new Request(endpoint + "/" + record.id, { method: "DELETE" }));
    expect(deleted.status).toBe(200);
    expect((await app.handle(new Request(endpoint + "/" + record.id))).status).toBe(404);
    const firstBatchRecord = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values} }),
    }));
    const secondBatchRecord = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values} }),
    }));
    const firstBatchId = (await firstBatchRecord.json() as { id: string }).id;
    const secondBatchId = (await secondBatchRecord.json() as { id: string }).id;
    const batchDeleted = await app.handle(new Request(endpoint + "?ids=" + firstBatchId + "," + secondBatchId, { method: "DELETE" }));
    expect(batchDeleted.status).toBe(200);
  });

  test("rejects invalid pagination and resource ids", async () => {
    expect((await app.handle(new Request(endpoint + "/?pageSize=101"))).status).toBe(422);
    expect((await app.handle(new Request(endpoint + "/invalid-id"))).status).toBe(422);
  });

${unsupportedQueryTests}
${hiddenFieldTests}${temporalSection}${ruleSection}${stateSection}${linkSection}
});
`;
}
