/**
 * Helpers shared by the server renderers: API field schemas, principal claims
 * and the subtree helper behind tree scopes.
 */
import { generatedFieldsOf, manyRelations, type DatabaseIR, type EntityIR, type FieldIR, type FilterMode } from "../database-ir";
import { linkBodySchema } from "../generate-relation-links";
import type { QiyProject } from "../qiy-project";
import type { QiyTestSuite } from "../qiy-test";

/** A data scope, optionally widened to the whole subtree of a self-referencing entity. */
export type QiyScope = NonNullable<QiyProject["scopes"]>[number];

/** Resolves the tree table, id column and parent column a `tree` scope needs. */
export function resolveScopeTree(database: DatabaseIR, entity: EntityIR): { scope: QiyScope; table: EntityIR; idField: FieldIR; parentField: FieldIR } | undefined {
  const scope = (database as DatabaseIR & { scopes?: QiyScope[] }).scopes?.find((candidate) => (candidate.resource === entity.name || candidate.resource === entity.tableName) && candidate.tree);
  if (!scope?.tree) return undefined;
  const table = database.entities.find((candidate) => candidate.name === scope.tree!.entity || candidate.tableName === scope.tree!.entity);
  const idField = table?.fields.find((field) => field.primaryKey);
  const parentField = table?.fields.find((field) => field.name === scope.tree!.parentField);
  return table && idField && parentField ? { scope, table, idField, parentField } : undefined;
}

/** Emits the recursive CTE used to turn one claim value into the allowed subtree ids. */
export function renderScopeTreeHelper(database: DatabaseIR, entity: EntityIR, name = "qiyScopeSubtree"): string {
  const tree = resolveScopeTree(database, entity);
  if (!tree) return "";
  const cast = JSON.stringify(database.dialect === "mysql" ? "CHAR" : "TEXT");
  const table = tree.table.name;
  // PostgreSQL folds unquoted camelCase identifiers, so alias-qualified CTE columns
  // are emitted through sql.raw (backticks for MySQL, double quotes elsewhere).
  const rawIdentifier = (identifier: string) => database.dialect === "mysql" ? "`" + identifier + "`" : '"' + identifier + '"';
  const childIdRaw = JSON.stringify("child." + rawIdentifier(tree.idField.name));
  const childParentRaw = JSON.stringify("child." + rawIdentifier(tree.parentField.name));
  const castName = `${name}Cast`;
  return `const ${castName} = ${cast};
/** Subtree ids are structural metadata: the recursive CTE does not re-apply the row policy. */
function ` + name + `(column: any, value: string) {
  return sql\`CAST(\${column} AS \${sql.raw(${castName})}) IN (WITH RECURSIVE qiy_scope(id, depth) AS (SELECT CAST(\${${table}.${tree.idField.name}} AS \${sql.raw(${castName})}), 0 FROM \${${table}} WHERE CAST(\${${table}.${tree.idField.name}} AS \${sql.raw(${castName})}) = \${value} UNION ALL SELECT CAST(\${sql.raw(${childIdRaw})} AS \${sql.raw(${castName})}), qiy_scope.depth + 1 FROM \${${table}} AS child JOIN qiy_scope ON CAST(\${sql.raw(${childParentRaw})} AS \${sql.raw(${castName})}) = qiy_scope.id WHERE qiy_scope.depth < 64) SELECT id FROM qiy_scope)\`;
}
`;
}

export function apiFieldSchema(field: FieldIR, database: DatabaseIR): string {
  if (field.enumName) {
    const values = database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values ?? [];
    return `t.Union([${values.map((value) => `t.Literal(${JSON.stringify(value.name)})`).join(", ")}])`;
  }
  switch (field.type) {
    case "UUID": return "t.String({ format: \"uuid\" })";
    case "Text": return "t.String({ minLength: 1 })";
    case "Email": return "t.String({ format: \"email\", minLength: 3 })";
    case "URL": return "t.String({ format: \"uri\", minLength: 4 })";
    case "JSON": return "t.Any()";
    case "Array": return `t.Array(${field.itemType === "Integer" ? "t.Integer()" : "t.String({ minLength: 1 })"})`;
    case "File": return "t.String({ minLength: 1, maxLength: 240 })";
    case "Files": return `t.Array(t.String({ minLength: 1, maxLength: 240 }), { minItems: 1, maxItems: ${field.maxFiles ?? 6} })`;
    case "Integer": return "t.Integer()";
    case "Boolean": return "t.Boolean()";
    // The temporal contract is validated by api/src/temporal.ts so malformed values
    // return a documented 400 instead of TypeBox's 422: TypeBox has no strict
    // calendar/`HH:mm:ss` format (its "date" format accepts 2026-2-3 and 2026-02-31).
    case "Date":
    case "Time": return "t.String({ minLength: 1, maxLength: 40 })";
    case "DateTime": return "t.String({ format: \"date-time\" })";
    case "Decimal":
    case "Money": return "t.String({ pattern: \"^-?[0-9]+(\\\\.[0-9]+)?$\" })";
    case "Vector": return `t.Array(t.Number(), { minItems: ${field.dimension}, maxItems: ${field.dimension} })`;
  }
}

/** The declared Date/Time fields of an entity, in declaration order. */
export function temporalFieldsOf(entity: EntityIR): Array<[string, "Date" | "Time"]> {
  return entity.fields
    .filter((field): field is FieldIR & { type: "Date" | "Time" } => field.type === "Date" || field.type === "Time")
    .map((field) => [field.name, field.type]);
}

export function apiField(field: FieldIR, database: DatabaseIR): string {
  const schema = apiFieldSchema(field, database);
  return field.comment !== undefined ? `t.Intersect([${schema}], { description: ${JSON.stringify(field.comment)} })` : schema;
}

export function createFields(entity: EntityIR, database: DatabaseIR): string {
  const generated = new Set(generatedFieldsOf(entity, database.relations ?? []).map((field) => field.field.name));
  return entity.fields.filter((field) => !field.primaryKey && !field.softDelete && field.tenantClaim === undefined && field.computed === undefined && !field.version && !field.stateMachine).map((field) => {
    const value = field.nullable ? `t.Optional(t.Union([${apiField(field, database)}, t.Null()], ${JSON.stringify(field.comment !== undefined ? { description: field.comment } : {})}))` : apiField(field, database);
    // Generated fields are filled by the server, so the client may omit them even
    // when the column is NOT NULL. Client-supplied values are ignored on write.
    // A @default column fills an omitted value the same way.
    return `  ${JSON.stringify(field.name)}: ${generated.has(field.name) || field.defaultValue ? `t.Optional(${value})` : value},`;
  }).concat(manyRelations(database, entity.name).map(linkBodySchema)).join("\n");
}

export function patchFields(entity: EntityIR, database: DatabaseIR): string {
  return entity.fields.filter((field) => !field.primaryKey && !field.softDelete && field.tenantClaim === undefined && field.computed === undefined && !field.stateMachine).map((field) => {
    const value = field.nullable ? `t.Union([${apiField(field, database)}, t.Null()], ${JSON.stringify(field.comment !== undefined ? { description: field.comment } : {})})` : apiField(field, database);
    return `  ${JSON.stringify(field.name)}: t.Optional(${value}),`;
  }).concat(manyRelations(database, entity.name).map(linkBodySchema)).join("\n");
}

export function modelName(entity: EntityIR): string {
  return entity.name[0]!.toUpperCase() + entity.name.slice(1);
}

/**
 * Maps principal claims to user columns for sessions whose claims come from the
 * user row (local password, OTP, API keys). An explicit `claim` mapping in the
 * auth block wins; otherwise "org.id" falls back to a field named "orgId".
 */
export function userClaimFields(auth: QiyProject["auth"], userEntity: EntityIR | undefined, scopes: QiyScope[] = []): Array<{ claim: string; field: string; expected: string }> {
  const claims = [...new Set([...scopes.map((scope) => scope.claim), ...(auth?.claimFields ?? []).map((mapping) => mapping.claim)])];
  return claims.flatMap((claim) => {
    const explicit = auth?.claimFields?.find((mapping) => mapping.claim === claim)?.field;
    const expected = explicit ?? claim.replace(/\.([a-zA-Z0-9])/g, (_match: string, char: string) => char.toUpperCase());
    const field = userEntity?.fields.find((candidate) => candidate.name === expected || (!explicit && candidate.name === claim));
    return field ? [{ claim, field: field.name, expected }] : [{ claim, field: "", expected }];
  });
}

export function renderUserClaimLines(mappings: Array<{ claim: string; field: string }>, row: string): string {
  return mappings.filter((mapping) => mapping.field).map(({ claim, field }) => `  if (${row}.${field} !== null && ${row}.${field} !== undefined && ${row}.${field} !== "") claims[${JSON.stringify(claim)}] = typeof ${row}.${field} === "boolean" || typeof ${row}.${field} === "number" ? ${row}.${field} : String(${row}.${field});`).join("\n");
}

/**
 * Builds the principal display-name expression from the fields the user entity
 * actually declares. Hardcoding `displayName`/`email` produced server code that
 * did not compile for user entities without those fields.
 */
export function principalNameExpression(entity: EntityIR | undefined, ...candidates: Array<string | undefined>): string {
  const declared = [...new Set(candidates.filter((field): field is string => typeof field === "string" && field.length > 0))]
    .filter((field) => entity?.fields.some((item) => item.name === field));
  return `String(${[...declared.map((field) => `row.${field}`), "row.id"].join(" ?? ")})`;
}

export function filterModesForField(field: FieldIR): FilterMode[] {
  return field.filterModes ?? (field.enumName
    ? ["eq"]
    : field.type === "Text" || field.type === "File"
      ? ["contains", "startsWith", "endsWith", "eq"]
      : ["eq", "gt", "gte", "lt", "lte", "between", "in"]);
}

export type ServerOptions = Pick<QiyProject, "comment" | "commentKey" | "storageProvider" | "auth" | "permissions" | "scopes" | "restrictions" | "pages" | "corsOrigins" | "elysiaPlugins" | "dataflows" | "actions" | "realtime" | "features" | "webhooks" | "notifications" | "notificationSettings"> & { testSuite?: QiyTestSuite; appName?: string };
