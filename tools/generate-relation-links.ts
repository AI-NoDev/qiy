import { manyRelations, type DatabaseIR, type EntityIR, type ManyRelation } from "./database-ir";
import type { QiyProject } from "./qiy-project";

type QiyScope = NonNullable<QiyProject["scopes"]>[number];

/** Most ids one request may link through a single many-to-many field. */
export const maxRelationLinks = 500;

/**
 * Runtime for `relation … many`: the virtual id-array field is split off the
 * request body, validated against the target table and written to the join table
 * inside the caller's transaction; reads attach the arrays with one query per
 * relation. SQLite transactions are synchronous, so it gets its own writer.
 */
export function renderRelationLinksModule(dialect: DatabaseIR["dialect"]): string {
  const writer = dialect === "sqlite"
    ? `export function qiyWriteLinks(tx: any, changes: ReadonlyMap<QiyLink, string[]>, sourceId: string, scope?: { value: string }): void {
  for (const [link, ids] of changes) {
    if (ids.length) qiyAssertTargets(link, ids, tx.select({ id: link.targetKey }).from(link.target).where(qiyTargetCondition(link, ids, scope)).all());
    tx.delete(link.table).where(eq(link.table.sourceId, sourceId)).run();
    if (ids.length) tx.insert(link.table).values(ids.map((targetId) => ({ sourceId, targetId }))).run();
  }
}`
    : `export async function qiyWriteLinks(tx: any, changes: ReadonlyMap<QiyLink, string[]>, sourceId: string, scope?: { value: string }): Promise<void> {
  for (const [link, ids] of changes) {
    if (ids.length) qiyAssertTargets(link, ids, await tx.select({ id: link.targetKey }).from(link.target).where(qiyTargetCondition(link, ids, scope)));
    await tx.delete(link.table).where(eq(link.table.sourceId, sourceId));
    if (ids.length) await tx.insert(link.table).values(ids.map((targetId) => ({ sourceId, targetId })));
  }
}`;
  return `import { and, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "./db";

/** A many-to-many field named records that are missing, soft-deleted or outside the caller's data scope. */
export class QiyRelationLinkError extends Error {
  readonly field: string;
  readonly ids: string[];
  readonly errorKey = "relation.unknownTarget";
  /** graphql-js copies an original error's extensions into the GraphQL response. */
  readonly extensions: { status: 400; errorKey: string; field: string };

  constructor(field: string, ids: string[], message = field + " references records that do not exist: " + ids.join(", ")) {
    super(message);
    this.name = "QiyRelationLinkError";
    this.field = field;
    this.ids = ids;
    this.extensions = { status: 400, errorKey: this.errorKey, field };
  }
}

export interface QiyLink {
  /** Virtual id-array field on the source resource. */
  field: string;
  /** Join table with \`sourceId\` and \`targetId\` columns. */
  table: any;
  target: any;
  targetKey: any;
  /** Hides soft-deleted targets. */
  visible?: SQL;
  /** Target data-scope column; it must equal the caller's own scope value. */
  scopeColumn?: any;
}

/** Separates link fields from column values; \`null\` clears a field, an omitted field is left untouched. */
export function qiySplitLinks(input: Record<string, unknown>, links: readonly QiyLink[]): { values: Record<string, unknown>; changes: Map<QiyLink, string[]>; fields: string[] } {
  const values = { ...input };
  const changes = new Map<QiyLink, string[]>();
  for (const link of links) {
    if (!Object.hasOwn(values, link.field)) continue;
    const raw = values[link.field];
    delete values[link.field];
    if (raw !== null && !Array.isArray(raw)) throw new QiyRelationLinkError(link.field, [], link.field + " must be an array of ids or null");
    const ids = [...new Set((raw ?? []).map(String))];
    if (ids.length > ${maxRelationLinks}) throw new QiyRelationLinkError(link.field, [], link.field + " accepts at most ${maxRelationLinks} ids");
    changes.set(link, ids);
  }
  return { values, changes, fields: [...changes.keys()].map((link) => link.field) };
}

function qiyTargetCondition(link: QiyLink, ids: string[], scope?: { value: string }) {
  return and(inArray(link.targetKey, ids), link.visible, link.scopeColumn && scope ? eq(link.scopeColumn, scope.value) : undefined);
}

function qiyAssertTargets(link: QiyLink, ids: string[], found: Array<{ id: unknown }>): void {
  const known = new Set(found.map((row) => String(row.id)));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw new QiyRelationLinkError(link.field, missing);
}

${writer}

/** Adds every link field to each record, skipping soft-deleted targets; ids are sorted so responses are stable. */
export async function qiyAttachLinks<T extends Record<string, unknown> | undefined>(rows: T[], links: readonly QiyLink[]): Promise<T[]> {
  const ids = rows.flatMap((row) => row && row.id !== undefined && row.id !== null ? [String(row.id)] : []);
  if (!ids.length) return rows;
  const byLink = await Promise.all(links.map(async (link) => {
    const pairs: Array<{ sourceId: unknown; targetId: unknown }> = await db.select({ sourceId: link.table.sourceId, targetId: link.table.targetId }).from(link.table).innerJoin(link.target, eq(link.targetKey, link.table.targetId)).where(and(inArray(link.table.sourceId, ids), link.visible));
    const grouped = new Map<string, string[]>();
    for (const pair of pairs) grouped.set(String(pair.sourceId), [...(grouped.get(String(pair.sourceId)) ?? []), String(pair.targetId)]);
    return grouped;
  }));
  return rows.map((row) => {
    if (!row || row.id === undefined || row.id === null) return row;
    const linked: Record<string, unknown> = { ...row };
    links.forEach((link, index) => { linked[link.field] = [...(byLink[index]!.get(String(row.id)) ?? [])].sort(); });
    return linked as T;
  });
}

/** Records linked to any of the given targets, for \`eq\`/\`in\` filters on a link field. */
export function qiyLinkedSources(link: QiyLink, sourceKey: any, value: string): SQL {
  const targets = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!targets.length) throw new Error("In filter requires at least one value");
  return inArray(sourceKey, db.select({ id: link.table.sourceId }).from(link.table).where(inArray(link.table.targetId, targets)));
}
`;
}

/** Data scope of the target, which link validation narrows to the caller's own value. */
function targetScopeField(link: ManyRelation, scopes: readonly QiyScope[]): string | undefined {
  return scopes.find((scope) => scope.resource === link.target.name || scope.resource === link.target.tableName)?.field;
}

/**
 * A scoped target may only be linked from a source scoped by the same claim, so
 * the caller's own scope value can bound which targets are visible.
 */
export function validateRelationLinkScopes(database: DatabaseIR, scopes: readonly QiyScope[]): string[] {
  const scopeOf = (entity: EntityIR) => scopes.find((scope) => scope.resource === entity.name || scope.resource === entity.tableName);
  return manyRelations(database).flatMap((link) => {
    const target = scopeOf(link.target);
    if (!target) return [];
    const source = scopeOf(link.source);
    if (target.tree) return [`Relation ${link.relation.name}: many-to-many target ${link.target.name} uses a tree scope, which link validation cannot bound; link to an entity with a plain scope`];
    if (!source || source.claim !== target.claim) return [`Relation ${link.relation.name}: many-to-many target ${link.target.name} is scoped by claim ${target.claim}, so ${link.source.name} must be scoped by the same claim`];
    return [];
  });
}

/** `const qiyLinks = [...]` for one source entity's repository. */
export function renderRepositoryLinks(entity: EntityIR, database: DatabaseIR, scopes: readonly QiyScope[]): string {
  const links = manyRelations(database, entity.name);
  if (!links.length) return "";
  const entries = links.map((link) => {
    const softDelete = link.target.fields.find((field) => field.softDelete);
    const scopeField = targetScopeField(link, scopes);
    return `{ field: ${JSON.stringify(link.field)}, table: ${link.relation.name}, target: ${link.target.name}, targetKey: ${link.target.name}[${JSON.stringify(link.targetField)}]${softDelete ? `, visible: isNull(${link.target.name}.${softDelete.name})` : ""}${scopeField ? `, scopeColumn: ${link.target.name}.${scopeField}` : ""} }`;
  });
  return `const qiyLinks: QiyLink[] = [${entries.join(", ")}];\nconst qiyLinkFilters: Record<string, QiyLink> = Object.fromEntries(qiyLinks.map((link) => [link.field, link]));\n`;
}

/** Schema tables a source repository imports for its links (join tables and targets). */
export function repositoryLinkImports(entity: EntityIR, database: DatabaseIR): string[] {
  return [...new Set(manyRelations(database, entity.name).flatMap((link) => [link.relation.name, link.target.name]).filter((name) => name !== entity.name))];
}

/** Wraps the outermost repository so every returned record carries its link fields. */
export function renderLinkedRepository(entity: EntityIR, database: DatabaseIR, contract: string, innerName: string): string {
  if (!manyRelations(database, entity.name).length) return "";
  const softDeletes = entity.fields.some((field) => field.softDelete);
  return `const qiyLinkedRepository: ${contract} = {
  ...${innerName},
  list: async (...args: any[]) => { const result = await (${innerName}.list as any)(...args); return { ...result, data: await qiyAttachLinks(result.data, qiyLinks) }; },
  one: async (...args: any[]) => (await qiyAttachLinks([await (${innerName}.one as any)(...args)], qiyLinks))[0],
  create: async (...args: any[]) => (await qiyAttachLinks([await (${innerName}.create as any)(...args)], qiyLinks))[0],
  update: async (...args: any[]) => (await qiyAttachLinks([await (${innerName}.update as any)(...args)], qiyLinks))[0],
  delete: async (...args: any[]) => (await qiyAttachLinks([await (${innerName}.delete as any)(...args)], qiyLinks))[0],
  deleteMany: async (...args: any[]) => qiyAttachLinks(await (${innerName}.deleteMany as any)(...args), qiyLinks),${softDeletes ? `
  restore: async (...args: any[]) => (await qiyAttachLinks([await (${innerName}.restore as any)(...args)], qiyLinks))[0],` : ""}
};
`;
}

/**
 * Threads link writes through generated create/update methods: the request body
 * is split before any column write, the join rows are replaced inside the same
 * transaction, and the audit entry lists the link fields that changed.
 */
export function injectLinkWrites(methods: string, entity: EntityIR, database: DatabaseIR): string {
  if (!manyRelations(database, entity.name).length) return methods;
  const awaitWrite = database.dialect === "sqlite" ? "" : "await ";
  const createStart = methods.indexOf("  async create(values, actorId, scope");
  const updateStart = methods.indexOf("  async update(id, values, actorId, scope");
  const updateEnd = methods.indexOf("  async delete(id, actorId, scope");
  if (createStart === -1 || updateStart === -1 || updateEnd === -1) throw new Error(`Many-to-many links for ${entity.name}: unexpected repository shape`);
  const prelude = (method: string) => method
    .replace(/^ {2}async (create|update)\((id, )?values, /, "  async $1($2qiyInput, ")
    .replace(/\) \{\n/, ") {\n    const { values, changes: qiyLinkChanges, fields: qiyLinkFields } = qiySplitLinks(qiyInput, qiyLinks);\n")
    .replace(/fields: Object\.keys\((values|prepared)\)/g, "fields: [...Object.keys($1), ...qiyLinkFields]");
  let create = prelude(methods.slice(createStart, updateStart));
  const created = 'if (!record) throw new Error("Insert returned no record");';
  if (!create.includes(created)) throw new Error(`Many-to-many links for ${entity.name}: expected a checked insert`);
  create = create.replace(created, `${created}\n      ${awaitWrite}qiyWriteLinks(tx, qiyLinkChanges, String(record.id), scope);`);
  let update = prelude(methods.slice(updateStart, updateEnd));
  const audited = new RegExp(`( {6}if \\(record\\) (?:await )?tx\\.insert\\(auditEvents\\)\\.values\\(\\{[^\\n]*action: "${entity.tableName}\\.updated")`);
  if (!audited.test(update)) throw new Error(`Many-to-many links for ${entity.name}: expected an audited update`);
  update = update.replace(audited, `      if (record) ${awaitWrite}qiyWriteLinks(tx, qiyLinkChanges, id, scope);\n$1`);
  return `${methods.slice(0, createStart)}${create}${update}${methods.slice(updateEnd)}`;
}

/**
 * DDL for SQLite tests that create a linked entity's table by hand: reads join
 * the link table and its target, so both must exist (the target only needs its
 * key and soft-delete columns).
 */
export function sqliteLinkTestTables(entity: EntityIR, database: DatabaseIR): string {
  return manyRelations(database, entity.name).map((link) => {
    const target = link.target.name === entity.name ? "" : (() => {
      const softDelete = link.target.fields.find((field) => field.softDelete);
      const key = link.target.fields.find((field) => field.name === link.targetField)!;
      return ` DROP TABLE IF EXISTS "${link.target.tableName}"; CREATE TABLE "${link.target.tableName}" ("${key.columnName ?? key.name}" text primary key${softDelete ? `, "${softDelete.columnName ?? softDelete.name}" integer` : ""});`;
    })();
    return ` DROP TABLE IF EXISTS "${link.table}";${target} CREATE TABLE "${link.table}" ("sourceId" text not null, "targetId" text not null, primary key ("sourceId", "targetId"));`;
  }).join("");
}

/** Route body and GraphQL metadata for each link field of one entity. */
export function linkFieldsOf(entity: EntityIR, database: DatabaseIR): ManyRelation[] {
  return manyRelations(database, entity.name);
}

export function linkBodySchema(link: ManyRelation): string {
  const schema = `t.Union([t.Array(t.String({ format: "uuid" }), { maxItems: ${maxRelationLinks}, uniqueItems: true }), t.Null()]${link.relation.comment !== undefined ? `, { description: ${JSON.stringify(link.relation.comment)} }` : ""})`;
  return `  ${JSON.stringify(link.field)}: t.Optional(${schema}),`;
}
