import { Elysia, t } from "elysia";
import type { Authenticator } from "../../auth/guard";
import { createCustomersService } from "./customers.service";
import type { CustomersRepository as CustomersRepositoryPort } from "./customers.contract";


const createCustomers = t.Object({
  "name": t.String({ minLength: 1 }),
  "email": t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
  "creditLimit": t.String({ pattern: "^-?[0-9]+(\\.[0-9]+)?$" }),
}, { additionalProperties: false });

const patchCustomers = t.Object({
  "name": t.Optional(t.String({ minLength: 1 })),
  "email": t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
  "creditLimit": t.Optional(t.String({ pattern: "^-?[0-9]+(\\.[0-9]+)?$" })),
}, { additionalProperties: false });

export interface CustomersRepository {
  distribution(field: string, scope?: { field: string; value: string }): Promise<Array<{ value: string | null; count: number }>>;
  trend(field: string, days: number, scope?: { field: string; value: string }): Promise<Array<{ day: string; count: number }>>;
  list(page: number, pageSize: number, options?: ListQuery): Promise<{ data: Array<Record<string, unknown>>; total: number }>;
  one(id: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  create(values: typeof createCustomers.static, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown>>;
  update(id: string, values: typeof patchCustomers.static, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  delete(id: string, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  deleteMany(ids: string[], actorId?: string, scope?: { field: string; value: string }): Promise<Array<Record<string, unknown>>>;
}

export interface ListQuery {
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, string>;
  scope?: { field: string; value: string };
}

export function CustomersRoutes(repository: CustomersRepositoryPort, authenticate: Authenticator = async () => null) {
  const redact = (record: Record<string, unknown>) => record;
  const sortableFields = ["id","name","email","creditLimit"] as string[];
  const filterableFields = ["id","name","email","creditLimit"] as string[];
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
  const service = createCustomersService(repository);
  return new Elysia({ prefix: "/customers" })
    .onError(({ error, status }) => error instanceof Error && error.message.startsWith("Missing required data scope claim:") ? status(403, { error: error.message }) : undefined)
    .get("/distribution", async ({ query, status, request }) => ([] as string[]).includes(query.field) ? repository.distribution(query.field, await resolveScope(request)) : status(400, { error: "Unsupported distribution field" }), { query: t.Object({ field: t.String() }) })
    .get("/trend", async ({ query, status, request }) => ([] as string[]).includes(query.field) ? repository.trend(query.field, query.days, await resolveScope(request)) : status(400, { error: "Unsupported trend field" }), { query: t.Object({ field: t.String(), days: t.Numeric({ minimum: 1, maximum: 365 }) }) })
    .get("/", async ({ query, status, request }) => {
      let filters: Record<string, string> | undefined;
      if (query.filters) {
        try {
          const parsed: unknown = JSON.parse(query.filters);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) return status(400, { error: "Invalid filters" });
          filters = parsed as Record<string, string>;
        }
        catch { return status(400, { error: "Invalid filters" }); }
      }
      if (query.sort && !sortableFields.includes(query.sort)) return status(400, { error: "Unsupported sort field" });
      if (filters && Object.keys(filters).some((field) => !filterableFields.includes(field))) return status(400, { error: "Unsupported filter field" });
      const scope = await resolveScope(request);
      const result = await service.list(query.page ?? 1, query.pageSize ?? 20, { ...query, filters, scope });
      return { ...result, data: result.data.map((record) => redact(record)) };
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
    .get("/:id", async ({ params, status, request }) => {
      const record = await service.one(params.id, await resolveScope(request));
      return record ? redact(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
    .post("/", async ({ body, status, request }) => status(201, redact(await service.create(body, (await authenticate(request))?.id, await resolveScope(request)))), { body: createCustomers })
    .patch("/:id", async ({ params, body, status, request }) => {
      if (Object.keys(body).length === 0) return status(400, { error: "Empty update" });
      const principal = await authenticate(request);
      const record = await service.update(params.id, body, principal?.id, await resolveScope(request));
      return record ? redact(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }), body: patchCustomers })
    .delete("/", async ({ query, request }) => (await repository.deleteMany(query.ids.split(","), (await authenticate(request))?.id, await resolveScope(request))).map((record) => redact(record)), {
      query: t.Object({ ids: t.String({ minLength: 1 }) }),
    })
    .delete("/:id", async ({ params, status, request }) => {
      const record = await service.delete(params.id, (await authenticate(request))?.id, await resolveScope(request));
      return record ? redact(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });
}

export const customersWritableFields = ["name", "email", "creditLimit"] as const;
