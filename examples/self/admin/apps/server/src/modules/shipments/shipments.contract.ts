export interface ShipmentsRepository {
  distribution(field: string, scope?: { field: string; value: string }): Promise<Array<{ value: string | null; count: number }>>;
  /** Optional so generated test doubles and hand-written repositories keep compiling. */
  aggregate?(field: string, operator: string, scope?: { field: string; value: string }): Promise<{ value: number | null; operator: string }>;
  trend(field: string, days: number, scope?: { field: string; value: string }): Promise<Array<{ day: string; count: number }>>;
  list(page: number, pageSize: number, options?: ListQuery): Promise<{ data: Array<Record<string, unknown>>; total: number }>;
  one(id: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  create(values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown>>;
  update(id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
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
