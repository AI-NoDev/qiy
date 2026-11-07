import type { DatabaseIR, EntityIR } from "./database-ir";
import type { QiyProject, QiyResourceRestriction } from "./qiy-project";

type ViewScope = NonNullable<QiyProject["scopes"]>[number];
export type AccessDatabase = DatabaseIR & { scopes?: ViewScope[]; restrictions?: QiyResourceRestriction[] };

interface ViewSourceAccess {
  source: EntityIR;
  softDeleteField?: string;
  scope?: ViewScope;
  restricted: boolean;
}

function sourceOf(database: DatabaseIR, from: string): EntityIR {
  return database.entities.find((entity) => entity.name === from || entity.tableName === from)!;
}

/** Row rules a view inherits from its source entity: soft delete, data scope and policy. */
export function viewSourceAccess(database: AccessDatabase, view: NonNullable<DatabaseIR["views"]>[number]): ViewSourceAccess {
  const source = sourceOf(database, view.from);
  return {
    source,
    softDeleteField: source.fields.find((field) => field.softDelete)?.name,
    scope: database.scopes?.find((scope) => scope.resource === source.name || scope.resource === source.tableName),
    restricted: (database.restrictions ?? []).some((restriction) => restriction.resource === source.name || restriction.resource === source.tableName),
  };
}

function guarded(access: ViewSourceAccess): boolean {
  return Boolean(access.softDeleteField || access.scope || access.restricted);
}

function renderTreeHelper(database: DatabaseIR, access: ViewSourceAccess, name: string): string {
  const tree = access.scope?.tree;
  if (!tree) return "";
  const table = database.entities.find((entity) => entity.name === tree.entity || entity.tableName === tree.entity)!;
  const idField = table.fields.find((field) => field.primaryKey)!;
  const cast = database.dialect === "mysql" ? "CHAR" : "TEXT";
  const raw = (identifier: string) => database.dialect === "mysql" ? "`" + identifier + "`" : '"' + identifier + '"';
  return `function ${name}(column: any, value: string) {
  return sql\`CAST(\${column} AS ${cast}) IN (WITH RECURSIVE qiy_scope(id, depth) AS (SELECT CAST(\${${table.name}.${idField.name}} AS ${cast}), 0 FROM \${${table.name}} WHERE CAST(\${${table.name}.${idField.name}} AS ${cast}) = \${value} UNION ALL SELECT CAST(\${sql.raw(${JSON.stringify(`child.${raw(idField.name)}`)})} AS ${cast}), qiy_scope.depth + 1 FROM \${${table.name}} AS child JOIN qiy_scope ON CAST(\${sql.raw(${JSON.stringify(`child.${raw(tree.parentField)}`)})} AS ${cast}) = qiy_scope.id WHERE qiy_scope.depth < 64) SELECT id FROM qiy_scope)\`;
}
`;
}

/** Generates read-only REST list/detail routes for `view` declarations. */
export function renderViewRoutes(database: AccessDatabase, requiresAuth: boolean): string | undefined {
  const views = database.views ?? [];
  if (views.length === 0) return undefined;
  const accesses = views.map((view) => ({ view, access: viewSourceAccess(database, view) }));
  const schemaImports = new Set(accesses.map(({ access }) => access.source.name));
  let usesPolicy = false;
  let usesTree = false;
  const helpers: string[] = [];
  const accessEntries = accesses.map(({ view, access }) => {
    if (!guarded(access)) return `  ${view.name}: async (_principal: Principal | null) => ({ condition: undefined, mask: (row: Record<string, unknown>) => row }),`;
    const source = access.source.name;
    const conditions: string[] = [];
    const lines: string[] = [];
    if (access.softDeleteField) conditions.push(`isNull(${source}.${access.softDeleteField})`);
    if (access.scope) {
      lines.push(`const claim = principal?.claims?.[${JSON.stringify(access.scope.claim)}];`);
      lines.push(`if (claim === undefined || claim === null || claim === "") throw new QiyViewAccessError(403, "Missing required data scope claim: ${access.scope.claim}");`);
      lines.push(`const scope = { field: ${JSON.stringify(access.scope.field)}, value: String(claim) };`);
    }
    if (access.restricted) {
      usesPolicy = true;
      lines.push(`const policy = resolvePolicy(${JSON.stringify(source)}, principal, { ${access.source.fields.map((field) => `${JSON.stringify(field.name)}: ${source}.${field.name}`).join(", ")} }${access.scope ? ", scope" : ""});`);
      conditions.push("...(policy.conditions as SQL[])");
    }
    if (access.scope) {
      let scopeCondition = `eq(${source}.${access.scope.field}, scope.value)`;
      if (access.scope.tree) {
        usesTree = true;
        const helper = `qiyViewScopeSubtree_${view.name}`;
        const treeTable = database.entities.find((entity) => entity.name === access.scope!.tree!.entity || entity.tableName === access.scope!.tree!.entity)!;
        schemaImports.add(treeTable.name);
        helpers.push(renderTreeHelper(database, access, helper));
        scopeCondition = `${helper}(${source}.${access.scope.field}, scope.value)`;
      }
      conditions.push(access.restricted ? `...(policy.usesScope ? [] : [${scopeCondition}])` : scopeCondition);
    }
    return `  ${view.name}: async (principal: Principal | null) => {
    ${lines.join("\n    ")}
    return {
      condition: and(${conditions.join(", ")}),
      mask: ${access.restricted ? "(row: Record<string, unknown>) => policy.mask(row)" : "(row: Record<string, unknown>) => row"},
    };
  },`;
  }).join("\n");
  const authenticateLine = requiresAuth
    ? `const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });`
    : "const principal = await authenticate(request);";
  const readers = accesses.map(({ view, access }) => {
    const source = access.source.name;
    const key = access.source.fields.find((field) => field.primaryKey)!.name;
    const columns = view.columns.map((column) => `${JSON.stringify(column)}: ${source}.${column}`).join(", ");
    const one = view.columns.includes("id") ? `
    async one(principal: Principal | null, id: string) {
      const access = await viewAccess.${view.name}(principal);
      const [row] = await db.select({ ${columns} }).from(${source}).where(and(eq(${source}.${key}, id), access.condition)).limit(1);
      return row ? access.mask(row) : undefined;
    },` : "";
    return `  ${view.name}: {
    async list(principal: Principal | null, page: number, pageSize: number) {
      const access = await viewAccess.${view.name}(principal);
      const [data, totalRows] = await Promise.all([
        db.select({ ${columns} }).from(${source}).where(access.condition).orderBy(${source}.${key}).limit(pageSize).offset((page - 1) * pageSize),
        db.select({ count: count() }).from(${source}).where(access.condition),
      ]);
      return { data: data.map(access.mask), total: Number(totalRows[0]?.count ?? 0) };
    },${one}
  },`;
  }).join("\n");
  const routes = accesses.map(({ view }) => {
    const detail = view.columns.includes("id") ? `
    .get("/${view.name}/:id", async ({ params, request, status }) => {
      ${authenticateLine}
      const row = await viewReaders.${view.name}.one(principal, params.id);
      return row ?? status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String() }) })` : "";
    return `    .get("/${view.name}", async ({ query, request, status }) => {
      ${authenticateLine}
      const page = Math.max(1, Math.floor(Number(query.page ?? 1)));
      const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize ?? 20))));
      return viewReaders.${view.name}.list(principal, page, pageSize);
    }, { query: t.Object({ page: t.Optional(t.Numeric({ minimum: 1 })), pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })) }) })${detail}`;
  }).join("\n");
  return `import { Elysia, t } from "elysia";
import { and, count, eq, isNull${usesTree ? ", sql" : ""}, type SQL } from "drizzle-orm";
import { db } from "./db";
import type { Principal } from "./auth/guard";
import { ${[...schemaImports].join(", ")} } from "./schema";
${usesPolicy ? 'import { QiyPolicyError, resolvePolicy } from "./security/policy";\n' : ""}
type ViewAuthenticate = (request: Request) => Promise<Principal | null>;

/** Raised when a principal cannot read a view at all (missing scope claim). */
export class QiyViewAccessError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

${helpers.join("\n")}/**
 * Each view inherits its source entity's soft-delete filter, data scope and row
 * policy (including field masks), so REST and GraphQL never expose rows the
 * principal could not read from the entity itself.
 */
type QiyViewAccess = (principal: Principal | null) => Promise<{ condition: SQL | undefined; mask: (row: Record<string, unknown>) => Record<string, unknown> }>;
export const viewAccess = {
${accessEntries}
} satisfies Record<string, QiyViewAccess>;

/**
 * A view is a projection of one entity, so REST and GraphQL read the view's
 * columns straight from the source table: the row rules filter the source with
 * its own indexes instead of an \`IN\` subquery over the view.
 */
export const viewReaders = {
${readers}
};

export function createViewRoutes(authenticate: ViewAuthenticate) {
  return new Elysia({ prefix: "/api/v1" })
    .onError(({ error, status }) => error instanceof QiyViewAccessError${usesPolicy ? " || error instanceof QiyPolicyError" : ""} ? status(error.status as 403, { error: error.message }) : undefined)
${routes};
}
`;
}
