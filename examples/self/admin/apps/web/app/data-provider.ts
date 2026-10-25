import type { DataProvider } from "@refinedev/core";
import { qiyApiError } from "./api-error";
import { resources, resourceNames } from "./resources";

const allowed = new Set<string>(resourceNames);
const dataflowCommands = new Set<string>(["/api/v1/commands/receiveInventory","/api/v1/commands/putawayStock","/api/v1/commands/reserveStock","/api/v1/commands/adjustStock","/api/v1/commands/shipSalesOrder","/api/v1/commands/transferInventory","/api/v1/commands/completeWorkOrder","/api/v1/commands/approvePurchaseOrder"]);
const api = "/api/v1";
type QiyFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
function authHeaders(): Record<string, string> { const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token"); return token ? { Authorization: `Bearer ${token}` } : {}; }

function urlFor(resource: string, id?: string | number): string {
  if (!allowed.has(resource)) throw new Error(`Unknown resource: ${resource}`);
  const base = `${api}/${resource}`;
  return id === undefined ? base : `${base}/${encodeURIComponent(String(id))}`;
}

/** Upper bound of ids a single `getMany` call accepts; keeps filter queries bounded. */
export const maxGetManyIds = 200;
/**
 * The generated list endpoints cap `pageSize` at 100, so a larger id batch is
 * split into id-set chunks. Normal pages never exceed the first chunk (one
 * request); the split only protects unusual callers from a 422.
 */
const getManyChunkSize = 100;

/** Refine passes BaseKey ids; dedupe them, drop blanks and cap the batch. */
export function normalizeGetManyIds(ids: ReadonlyArray<string | number> | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => String(id)).filter((id) => id.length > 0))].slice(0, maxGetManyIds);
}

/**
 * One list request per id chunk, filtered with `filters=[{"field":"id","operator":"in","value":"a,b"}]`.
 * The generated repositories split the comma-separated value into an `IN (...)`
 * clause, which turns a page of FK cells into one request per target resource.
 */
export function getManyRequestUrls(resource: string, ids: ReadonlyArray<string>): string[] {
  const urls: string[] = [];
  for (let index = 0; index < ids.length; index += getManyChunkSize) {
    const chunk = ids.slice(index, index + getManyChunkSize);
    const filters = JSON.stringify([{ field: "id", operator: "in", value: chunk.join(",") }]);
    urls.push(`${urlFor(resource)}?page=1&pageSize=${chunk.length}&filters=${encodeURIComponent(filters)}`);
  }
  return urls;
}

async function workflowCommand(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, url: string, method: string, payload?: unknown, meta?: Record<string, unknown>) {
  const isOrderWorkflow = /^\/api\/v1\/orders\/[0-9a-f-]{36}\/(submit|approve|ship|cancel)$/.test(url) && allowed.has("orders");
  if (method !== "post" || (!isOrderWorkflow && !dataflowCommands.has(url))) throw new Error("Unknown workflow command");
  const idempotencyKey = meta?.idempotencyKey;
  const isDataflow = dataflowCommands.has(url);
  const response = await fetcher(url, { method: "POST", headers: { ...authHeaders(), ...(isDataflow ? { "Content-Type": "application/json" } : {}), ...(typeof idempotencyKey === "string" ? { "idempotency-key": idempotencyKey } : {}) }, ...(isDataflow ? { body: JSON.stringify(payload ?? {}) } : {}) });
  const data = await response.json();
  if (!response.ok) throw qiyApiError(data, response.status);
  return { data };
}

export function createDataProvider(fetcher: QiyFetcher = fetch): DataProvider {
  async function request(url: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(url, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } });
    const content = await response.json();
    if (!response.ok) throw qiyApiError(content, response.status);
    return content;
  }

  /**
   * Coalesces identical `getMany` id sets. React Query already dedupes by key, but
   * two independent mounted consumers (or a StrictMode remount) can still ask for
   * the same page of FK records within the same tick; this cache guarantees one
   * network request per `(resource, id set)` for a short window.
   */
  const idBatchCache = new Map<string, { at: number; data: Array<{ id: string }> }>();
  const idBatchInflight = new Map<string, Promise<Array<{ id: string }>>>();
  const idBatchCacheTtlMs = 30_000;
  function idBatchKey(resource: string, ids: ReadonlyArray<string>): string {
    return resource + "|" + [...ids].sort().join(",");
  }
  function invalidateIdBatchCache(): void {
    idBatchCache.clear();
    idBatchInflight.clear();
  }

  return {
    getApiUrl: () => api,
    custom: async ({ url, method, query, payload, meta }) => {
      if (method === "post") {
        const result = await workflowCommand(fetcher, url, method, payload, meta);
        invalidateIdBatchCache();
        return result;
      }
      const match = /^\/api\/v1\/([a-z][a-z0-9_-]*)\/(distribution|trend|aggregate)$/.exec(url);
      if (method !== "get" || !match || !allowed.has(match[1]!)) throw new Error("Unknown analytics resource");
      const resource = resources.find((item) => item.name === match[1]);
      const analytics = query as { field?: string; days?: number; op?: string } | undefined;
      const field = analytics?.field;
      if (match[2] === "aggregate") {
        // `stat` chart views aggregate one numeric column in SQL.
        const operator = analytics?.op ?? "sum";
        if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unknown aggregate operator");
        if (!field || !resource?.fields.some((item) => item.name === field && (item.type === "Integer" || item.type === "Decimal" || item.type === "Money"))) throw new Error("Unknown aggregate field");
        const data = await request(`${url}?field=${encodeURIComponent(field)}&op=${encodeURIComponent(operator)}`) as { value?: number | null; operator?: string };
        return { data: { value: data?.value ?? null, operator: data?.operator ?? operator } };
      }
      const days = Number(analytics?.days);
      if (!field || !resource?.fields.some((item) => item.name === field && (match[2] === "trend" ? item.type === "DateTime" : item.enumValues?.length))) throw new Error(`Unknown ${match[2]} field`);
      if (match[2] === "trend" && (!Number.isInteger(days) || days < 1 || days > 365)) throw new Error("Invalid trend days");
      const data = await request(`${url}?field=${encodeURIComponent(field)}${match[2] === "trend" ? `&days=${days}` : ""}`) as Array<{ count: number }>;
      return { data: { items: data } };
    },
    getList: async ({ resource, pagination, sorters, filters }) => {
      const params = new URLSearchParams({
        page: String(pagination?.currentPage ?? 1),
        pageSize: String(pagination?.pageSize ?? 20),
      });
      const sorter = sorters?.[0];
      if (sorter?.field) {
        params.set("sort", String(sorter.field));
        params.set("order", sorter.order === "desc" ? "desc" : "asc");
      }
      const searchFilter = filters?.find((filter) => "field" in filter && (filter.field === "q" || filter.field === "__search"));
      if (searchFilter && "value" in searchFilter && searchFilter.value !== undefined) params.set("search", String(searchFilter.value));
      const fieldFilters = Object.fromEntries((filters ?? []).flatMap((filter) => {
        if (!("field" in filter) || filter.field === "q" || filter.field === "__search" || !("value" in filter) || filter.operator !== "eq") return [];
        return [[filter.field, String(filter.value)]];
      }));
      const encodeFilters = (items: readonly any[]): unknown[] => items.flatMap<unknown>((filter) => { if (!("field" in filter)) return filter.operator === "and" || filter.operator === "or" ? [{ operator: filter.operator, filters: encodeFilters(Array.isArray(filter.value) ? filter.value : []) }] : []; if (filter.field === "q" || filter.field === "__search" || !("value" in filter)) return []; return [{ field: String(filter.field), operator: String(filter.operator ?? "eq"), value: Array.isArray(filter.value) ? filter.value.map(String).join(",") : String(filter.value) }]; });
      const encodedFilters = encodeFilters(filters ?? []);
      if (encodedFilters.length > 0) params.set("filters", JSON.stringify(encodedFilters));
      else if (Object.keys(fieldFilters).length > 0) params.set("filters", JSON.stringify(fieldFilters));
      return await request(`${urlFor(resource)}?${params}`) as { data: Array<{ id: string }>; total: number };
    },
    getOne: async ({ resource, id }) => ({ data: await request(urlFor(resource, id)) as { id: string } }),
    /**
     * Batched FK lookup: `useMany` on a list page lands here instead of one
     * `getOne` per cell. The list endpoint filters by `id in (a,b,c)`; the
     * response is the regular `{ data, total }` page, so only `data` is returned.
     */
    getMany: async ({ resource, ids }) => {
      const normalized = normalizeGetManyIds(ids);
      if (normalized.length === 0) return { data: [] };
      const key = idBatchKey(resource, normalized);
      const cached = idBatchCache.get(key);
      if (cached && Date.now() - cached.at < idBatchCacheTtlMs) return { data: cached.data };
      const inflight = idBatchInflight.get(key);
      if (inflight) return { data: await inflight };
      const promise = (async () => {
        const data: Array<{ id: string }> = [];
        for (const url of getManyRequestUrls(resource, normalized)) {
          const page = await request(url) as { data?: Array<{ id: string }> };
          data.push(...(page.data ?? []));
        }
        idBatchCache.set(key, { at: Date.now(), data });
        return data;
      })().finally(() => { idBatchInflight.delete(key); });
      idBatchInflight.set(key, promise);
      return { data: await promise };
    },
    create: async ({ resource, variables }) => ({
      data: (invalidateIdBatchCache(), await request(urlFor(resource), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(variables) }) as { id: string }),
    }),
    update: async ({ resource, id, variables }) => ({
      data: (invalidateIdBatchCache(), await request(urlFor(resource, id), { method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(variables) }) as { id: string }),
    }),
    deleteOne: async ({ resource, id }) => ({ data: (invalidateIdBatchCache(), await request(urlFor(resource, id), { method: "DELETE", headers: authHeaders() }) as { id: string }) }),
    deleteMany: async ({ resource, ids }) => ({ data: (invalidateIdBatchCache(), await request(`${urlFor(resource)}?ids=${ids.map((id) => encodeURIComponent(String(id))).join(",")}`, { method: "DELETE", headers: authHeaders() }) as Array<{ id: string }>) }),
  } as DataProvider;
}

function graphqlName(name: string): string {
  return name[0]!.toUpperCase() + name.slice(1);
}

function selectionFor(resource: string): string {
  const definition = resources.find((item) => item.name === resource);
  if (!definition) throw new Error(`Unknown resource: ${resource}`);
  return definition.fields.map((field) => field.name).join(" ");
}

async function graphqlRequest(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, query: string, variables?: Record<string, unknown>): Promise<any> {
  const response = await fetcher("/graphql", { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json() as { data?: any; errors?: Array<{ message?: string }> };
  if (!response.ok || payload.errors?.length) throw Object.assign(new Error(payload.errors?.map((error) => error.message ?? "GraphQL error").join("; ") ?? `API error ${response.status}`), { statusCode: response.ok ? 400 : response.status });
  return payload.data;
}

export function createGraphQLDataProvider(fetcher: QiyFetcher = fetch): DataProvider {
  return {
    getApiUrl: () => "/graphql",
    custom: async ({ url, method, query, payload, meta }) => {
      if (method === "post") return workflowCommand(fetcher, url, method, payload, meta);
      const match = /^\/api\/v1\/([a-z][a-z0-9_-]*)\/(distribution|trend|aggregate)$/.exec(url);
      const resource = resources.find((item) => item.name === match?.[1]);
      const analytics = query as { field?: string; days?: number; op?: string } | undefined;
      const field = analytics?.field;
      if (match?.[2] === "aggregate") {
        const operator = analytics?.op ?? "sum";
        if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unknown aggregate operator");
        if (method !== "get" || !resource || !field || !resource.fields.some((item) => item.name === field && (item.type === "Integer" || item.type === "Decimal" || item.type === "Money"))) throw new Error("Unknown aggregate field");
        const aggregateName = `${resource.apiName}Aggregate`;
        const result = await graphqlRequest(fetcher, `query($field: String!, $op: String!) { ${aggregateName}(field: $field, op: $op) }`, { field, op: operator });
        return { data: { value: (result[aggregateName] as number | null) ?? null, operator } };
      }
      if (method !== "get" || !resource || !field || !resource.fields.some((item) => item.name === field && (match?.[2] === "trend" ? item.type === "DateTime" : item.enumValues?.length))) throw new Error("Unknown analytics field");
      if (match?.[2] === "trend") {
        const days = Number(analytics?.days);
        if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend days");
        const name = `${resource.apiName}Trend`;
        const result = await graphqlRequest(fetcher, `query($field: String!, $days: Int!) { ${name}(field: $field, days: $days) { day count } }`, { field, days });
        return { data: { items: result[name] as Array<{ day: string; count: number }> } };
      }
      const name = `${resource.apiName}Distribution`;
      const result = await graphqlRequest(fetcher, `query($field: String!) { ${name}(field: $field) { value count } }`, { field });
      return { data: { items: result[name] as Array<{ value: string | null; count: number }> } };
    },
    getList: async ({ resource, pagination, sorters, filters }) => {
      const definition = resources.find((item) => item.name === resource);
      if (!definition) throw new Error(`Unknown resource: ${resource}`);
      const search = filters?.find((filter) => "field" in filter && (filter.field === "q" || filter.field === "__search"));
      const fieldFilters = (filters ?? []).flatMap((filter) => {
        if (!("field" in filter) || filter.field === "q" || filter.field === "__search" || !("value" in filter)) return [];
        return filter.operator === "eq" ? [{ field: String(filter.field), value: String(filter.value) }] : [{ field: String(filter.field), operator: String(filter.operator), value: String(filter.value) }];
      });
      const sorter = sorters?.[0];
      const queryName = definition.apiName;
      const query = `query QiyList($page: Int, $pageSize: Int, $search: String, $sort: String, $order: String, $filters: [QiyFilterInput!]) { ${queryName}(page: $page, pageSize: $pageSize, search: $search, sort: $sort, order: $order, filters: $filters) { items { ${selectionFor(resource)} } total } }`;
      const result = await graphqlRequest(fetcher, query, { page: pagination?.currentPage ?? 1, pageSize: pagination?.pageSize ?? 20, search: search && "value" in search ? String(search.value) : undefined, sort: sorter?.field ? String(sorter.field) : undefined, order: sorter?.order === "desc" ? "desc" : "asc", filters: fieldFilters });
      return { data: result[queryName].items, total: result[queryName].total };
    },
    getOne: async ({ resource, id }) => { const definition = resources.find((item) => item.name === resource); if (!definition) throw new Error(`Unknown resource: ${resource}`); const queryName = `${definition.apiName}ById`; const result = await graphqlRequest(fetcher, `query($id: ID!) { ${queryName}(id: $id) { ${selectionFor(resource)} } }`, { id: String(id) }); return { data: result[queryName] }; },
    /** Batched FK lookup: one list query with an `id in (...)` filter per id chunk. */
    getMany: async ({ resource, ids }) => {
      const definition = resources.find((item) => item.name === resource);
      if (!definition) throw new Error(`Unknown resource: ${resource}`);
      const normalized = normalizeGetManyIds(ids);
      if (normalized.length === 0) return { data: [] };
      const queryName = definition.apiName;
      const data: Array<{ id: string }> = [];
      for (let index = 0; index < normalized.length; index += getManyChunkSize) {
        const chunk = normalized.slice(index, index + getManyChunkSize);
        const query = `query QiyMany($page: Int, $pageSize: Int, $filters: [QiyFilterInput!]) { ${queryName}(page: $page, pageSize: $pageSize, filters: $filters) { items { ${selectionFor(resource)} } total } }`;
        const result = await graphqlRequest(fetcher, query, { page: 1, pageSize: chunk.length, filters: [{ field: "id", operator: "in", value: chunk.join(",") }] });
        data.push(...(result[queryName].items as Array<{ id: string }>));
      }
      return { data };
    },
    create: async ({ resource, variables }) => { const definition = resources.find((item) => item.name === resource); if (!definition) throw new Error(`Unknown resource: ${resource}`); const name = graphqlName(definition.apiName); const result = await graphqlRequest(fetcher, `mutation($input: ${name}CreateInput!) { create${name}(input: $input) { ${selectionFor(resource)} } }`, { input: variables }); return { data: result[`create${name}`] }; },
    update: async ({ resource, id, variables }) => { const definition = resources.find((item) => item.name === resource); if (!definition) throw new Error(`Unknown resource: ${resource}`); const name = graphqlName(definition.apiName); const result = await graphqlRequest(fetcher, `mutation($id: ID!, $input: ${name}UpdateInput!) { update${name}(id: $id, input: $input) { ${selectionFor(resource)} } }`, { id: String(id), input: variables }); return { data: result[`update${name}`] }; },
    deleteOne: async ({ resource, id }) => { const definition = resources.find((item) => item.name === resource); if (!definition) throw new Error(`Unknown resource: ${resource}`); const name = graphqlName(definition.apiName); const result = await graphqlRequest(fetcher, `mutation($id: ID!) { delete${name}(id: $id) { ${selectionFor(resource)} } }`, { id: String(id) }); return { data: result[`delete${name}`] }; },
    deleteMany: async ({ resource, ids }) => { const definition = resources.find((item) => item.name === resource); if (!definition) throw new Error(`Unknown resource: ${resource}`); const name = graphqlName(definition.apiName); const result = await graphqlRequest(fetcher, `mutation($ids: [ID!]!) { delete${name}Many(ids: $ids) { ${selectionFor(resource)} } }`, { ids: ids.map(String) }); return { data: result[`delete${name}Many`] }; },
  } as DataProvider;
}

export const dataProvider = (import.meta.env.VITE_QIY_API_TRANSPORT ?? "rest") === "graphql" ? createGraphQLDataProvider() : createDataProvider();
