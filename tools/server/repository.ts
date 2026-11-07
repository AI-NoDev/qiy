/**
 * Server renderers for per-resource repositories: CRUD methods and
 * generated-value create wrappers.
 */
import { manyRelations, generatedFieldsOf, type DatabaseIR, type EntityIR } from "../database-ir";
import { injectLinkWrites } from "../generate-relation-links";
import { generatedFieldSpecs } from "../generate-values";
import { resolveScopeTree, type QiyScope } from "./shared";

/**
 * Wraps the generated transactional `create` of one repository in
 * `qiyCreateWithGeneratedValues`, which ignores client-supplied generated fields,
 * renders server values and retries a unique-constraint conflict a bounded
 * number of times. Only the create method changes; update/delete stay verbatim.
 */
export function wrapGeneratedCreateMethods(methods: string, entityName: string, fieldsLiteral: string): string {
  const start = methods.indexOf("  async create(values, actorId, scope");
  const end = methods.indexOf("  async update(id, values, actorId, scope");
  if (start === -1 || end === -1 || end < start) throw new Error(`Generated create for ${entityName}: unexpected repository shape`);
  const create = methods.slice(start, end);
  const open = create.indexOf("return db.transaction(");
  if (open === -1) throw new Error(`Generated create for ${entityName}: expected a transactional insert`);
  const head = `${create.slice(0, open)}return qiyCreateWithGeneratedValues(${JSON.stringify(entityName)}, ${fieldsLiteral}, values, (prepared) => db.transaction(`;
  // Only the request-body variable is renamed: `...values` is a spread while
  // `.values(...)` is the Drizzle insert builder and must stay untouched.
  let tail = create.slice(open + "return db.transaction(".length).replace(/(?<!")\bvalues\b(?!["\w(])/g, "prepared");
  const closing = "    });\n  },";
  const closingIndex = tail.lastIndexOf(closing);
  if (closingIndex === -1) throw new Error(`Generated create for ${entityName}: expected a closing transaction`);
  tail = `${tail.slice(0, closingIndex)}    }));\n  },${tail.slice(closingIndex + closing.length)}`;
  return `${methods.slice(0, start)}${head}${tail}${methods.slice(end)}`;
}

export function renderRepositoryMethods(entity: EntityIR, database: DatabaseIR, realtimeEvents: ReadonlySet<string> = new Set(), restricted = false, realtimeMasked: string[] = [], realtimeClaim?: { field: string; claim: string }): string {  const searchOperator = database.dialect === "postgresql" ? "ilike" : "like";
  const searchableFields = entity.fields.filter((field) => field.type === "Text").map((field) => `${entity.name}.${field.name}`).join(", ");
  const sortFields = entity.fields.filter((field) => field.sortable !== false).map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const filterableEntityFields = entity.fields.filter((field) => field.filterable !== false);
  const filterFields = filterableEntityFields.map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const filterTypes = JSON.stringify(Object.fromEntries(filterableEntityFields.map((field) => [field.name, field.type])));
  const configuredScopes = (database as DatabaseIR & { scopes?: QiyScope[] }).scopes ?? [];
  const scopeFields = entity.fields.filter((field) => field.computed === undefined && configuredScopes.some((scope) => (scope.resource === entity.name || scope.resource === entity.tableName) && scope.field === field.name));
  const scopeColumnFields = [...new Set([...filterableEntityFields, ...scopeFields])].map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const groupFields = entity.fields.filter((field) => field.enumName).map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const numericFields = entity.fields.filter((field) => ["Integer", "Decimal", "Money"].includes(field.type)).map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const dateFields = entity.fields.filter((field) => field.type === "DateTime").map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const scopeColumns = scopeColumnFields || "";
  const linked = manyRelations(database, entity.name).length > 0;
  // A `tree` scope widens the claim to the whole subtree, so the row predicate
  // becomes a recursive CTE over the tree entity instead of an equality check.
  const scopeColumnCondition = resolveScopeTree(database, entity) ? `qiyScopeSubtree(scopeColumns[scope.field], scope.value)` : `eq(scopeColumns[scope.field], scope.value)`;
  // The list method names its argument differently, so mirror the same predicate for it.
  const scopeColumnConditionFor = (name: string) => resolveScopeTree(database, entity) ? `qiyScopeSubtree(scopeColumns[${name}.field], ${name}.value)` : `eq(scopeColumns[${name}.field], ${name}.value)`;
  // Writes always land on the caller's own node: the subtree predicate governs reads.
  const scopeWriteSpread = "...(scope ? { [scope.field]: scope.value } : {})";
  const policyCondition = restricted
    ? `const policyCondition = policy && policy.conditions.length ? and(...(policy.conditions as any[])) : undefined;`
    : "";
  /** `policyCondition` is only emitted for restricted resources, so every condition list must reference it conditionally. */
  const policyArg = restricted ? ", policyCondition" : "";
  // Audit columns differ per dialect: SQLite stores JSON text and a Date, MySQL a
  // numeric millisecond timestamp without a column default, PostgreSQL defaults now().
  const exportAuditValues = database.dialect === "sqlite"
    ? `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.exported", resource: "${entity.tableName}", resourceId: null, metadata: JSON.stringify({ rows: input.rows, filters: input.filters }), createdAt: new Date() }`
    : database.dialect === "mysql"
      ? `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.exported", resource: "${entity.tableName}", resourceId: null, metadata: { rows: input.rows, filters: input.filters }, createdAt: Date.now() }`
      : `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.exported", resource: "${entity.tableName}", resourceId: null, metadata: { rows: input.rows, filters: input.filters } }`;
  const importAuditValues = database.dialect === "sqlite"
    ? `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.imported", resource: "${entity.tableName}", resourceId: null, metadata: JSON.stringify({ rows: input.rows }), createdAt: new Date() }`
    : database.dialect === "mysql"
      ? `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.imported", resource: "${entity.tableName}", resourceId: null, metadata: { rows: input.rows }, createdAt: Date.now() }`
      : `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.imported", resource: "${entity.tableName}", resourceId: null, metadata: { rows: input.rows } }`;
  /**
   * A shared channel cannot carry per-recipient permissions, so masked fields are
   * stripped once at publish time for every role that may subscribe to it.
   */
  const realtimePayload = (record: string) => realtimeMasked.length ? `qiyRealtimePayload(${record})` : record;
  // Claim-scoped resources publish per segment so subscribers only ever see their own rows.
  const realtimeChannelExpression = (record: string) => realtimeClaim
    ? `"qiy:${entity.tableName}:" + String((${record} as Record<string, unknown>)[${JSON.stringify(realtimeClaim.field)}])`
    : JSON.stringify(`qiy:${entity.tableName}`);
  const realtimeWrite = (type: "created" | "updated" | "deleted", payload: string) => realtimeEvents.has(type)
    ? `${database.dialect === "sqlite" ? "" : "await "}tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: ${realtimeChannelExpression(payload)}, type: ${JSON.stringify(type)}, payload: JSON.stringify(${realtimePayload(payload)}), createdAt: new Date() })${database.dialect === "sqlite" ? ".run()" : ""};`
    : "";
  const softDeleteField = entity.fields.find((field) => field.softDelete)?.name;
  // @version: inserts start at 1; an update carrying the counter must match it, and every update increments it.
  const versionField = entity.fields.find((field) => field.version)?.name;
  const versionStart = versionField ? `, ${versionField}: 1` : "";
  const versionPrelude = versionField ? `const { ${versionField}: expectedVersionValue, ...changes } = values as Record<string, unknown>;
      const expectedVersion = expectedVersionValue === undefined || expectedVersionValue === null ? undefined : Number(expectedVersionValue);
      ` : "";
  const versionCondition = versionField ? `, expectedVersion === undefined ? undefined : eq(${entity.name}.${versionField}, expectedVersion)` : "";
  // A links-only patch has no column change; rewriting the id keeps the visibility check, row lock and audit.
  const updateSet = versionField ? `{ ...changes, ${versionField}: sql\`\${${entity.name}.${versionField}} + 1\`, ${scopeWriteSpread} }` : linked ? `{ ...(Object.keys(values).length ? values : { id }), ${scopeWriteSpread} }` : `{ ...values, ${scopeWriteSpread} }`;
  // A missed versioned update is a conflict only when the row is still visible to the caller.
  const versionConflict = (lookup: string) => versionField ? `
      if (!record && expectedVersion !== undefined && ${lookup}) throw new QiyVersionConflict(${JSON.stringify(entity.tableName)}, id);` : "";
  // Soft-deleted resources stamp the marker column instead of removing the row.
  const removeFrom = softDeleteField ? `update(${entity.name}).set({ ${softDeleteField}: new Date() } as Partial<typeof ${entity.name}.$inferInsert>)` : `delete(${entity.name})`;
  const realtimeDeleteManyWrite = realtimeEvents.has("deleted")
    ? `${database.dialect === "sqlite" ? "" : "await "}tx.insert(realtimeOutbox).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), channel: ${realtimeChannelExpression("record")}, type: "deleted", payload: JSON.stringify(${realtimePayload("record")}), createdAt: new Date() })))${database.dialect === "sqlite" ? ".run()" : ""};`
    : "";
  const auditedMutationMethods = database.dialect === "sqlite" ? `  async create(values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction((tx) => {
      ${policyCondition}
      const record = tx.insert(${entity.name}).values({ ...values, ${scopeWriteSpread}, id: crypto.randomUUID()${versionStart} } as typeof ${entity.name}.$inferInsert).returning().get();
      if (!record) throw new Error("Insert returned no record");
      ${restricted ? "const visible = tx.select().from(" + entity.name + ").where(and(eq(" + entity.name + ".id, record.id)" + policyArg + ")).get(); if (!visible) throw new QiyPolicyError(\"Write is outside the record policy\", 403, \"policy.outsideScope\");" : ""}
      tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: record.id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       ${realtimeWrite("created", "record")}
      return record;
    });
  },
  async update(id, values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      ${versionPrelude}const record = tx.update(${entity.name}).set(${updateSet}).where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg}${versionCondition})).returning().get();${versionConflict(`tx.select({ id: ${entity.name}.id }).from(${entity.name}).where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg})).get()`)}
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
  async delete(id, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const record = tx.${removeFrom}.where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg})).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: "{}", createdAt: new Date() }).run();
       if (record) ${realtimeWrite("deleted", "record") || "void 0;"}
      return record;
    });
  },
  async deleteMany(ids, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const deletedRows = tx.${removeFrom}.where(and(notDeleted, inArray(${entity.name}.id, ids), scopeCondition${policyArg})).returning().all();
      if (deletedRows.length) tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: "{}", createdAt: new Date() }))).run();
       if (deletedRows.length) ${realtimeDeleteManyWrite || "void 0;"}
      return deletedRows;
    });
  },
` : database.dialect === "mysql" ? `  async create(values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      ${policyCondition}
      const id = crypto.randomUUID();
      await tx.insert(${entity.name}).values({ ...values, ${scopeWriteSpread}, id${versionStart} } as typeof ${entity.name}.$inferInsert);
      const [record] = await tx.select().from(${entity.name}).where(and(eq(${entity.name}.id, id)${policyArg})).limit(1);
      if (!record) throw new Error("Insert returned no record");
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) }, createdAt: Date.now() });
       ${realtimeWrite("created", "record")}
      return record;
    });
  },
  async update(id, values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      ${versionPrelude}const [existing] = await tx.select().from(${entity.name}).where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg})).limit(1).for("update");
      if (!existing) return undefined;${versionField ? `
      if (expectedVersion !== undefined && existing.${versionField} !== expectedVersion) throw new QiyVersionConflict(${JSON.stringify(entity.tableName)}, id);` : ""}
      await tx.update(${entity.name}).set(${updateSet}).where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg}));
      const [record] = await tx.select().from(${entity.name}).where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg})).limit(1);
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) }, createdAt: Date.now() });
       if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
  async delete(id, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const [${softDeleteField ? "existing" : "record"}] = await tx.select().from(${entity.name}).where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg})).limit(1).for("update");
      if (!${softDeleteField ? "existing" : "record"}) return undefined;
      await tx.${removeFrom}.where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg}));${softDeleteField ? `
      const [record] = await tx.select().from(${entity.name}).where(eq(${entity.name}.id, id)).limit(1);` : ""}
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: {}, createdAt: Date.now() });
       ${realtimeWrite("deleted", "record")}
      return record;
    });
  },
  async deleteMany(ids, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      ${softDeleteField ? "let" : "const"} deletedRows = await tx.select().from(${entity.name}).where(and(notDeleted, inArray(${entity.name}.id, ids), scopeCondition${policyArg})).for("update");
      if (deletedRows.length) {
        await tx.${removeFrom}.where(and(notDeleted, inArray(${entity.name}.id, deletedRows.map((record) => record.id)), scopeCondition${policyArg}));${softDeleteField ? `
        deletedRows = await tx.select().from(${entity.name}).where(inArray(${entity.name}.id, deletedRows.map((record) => record.id)));` : ""}
        await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: {}, createdAt: Date.now() })));
         ${realtimeDeleteManyWrite}
      }
      return deletedRows;
    });
  },
` : `  async create(values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      ${policyCondition}
      const [record] = await tx.insert(${entity.name}).values({ ...values, ${scopeWriteSpread}, id: crypto.randomUUID()${versionStart} } as typeof ${entity.name}.$inferInsert).returning();
      if (!record) throw new Error("Insert returned no record");
      ${restricted ? "const [visible] = await tx.select().from(" + entity.name + ").where(and(eq(" + entity.name + ".id, record.id)" + policyArg + ")).limit(1); if (!visible) throw new QiyPolicyError(\"Write is outside the record policy\", 403, \"policy.outsideScope\");" : ""}
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: record.id, metadata: { fields: Object.keys(values) } });
       ${realtimeWrite("created", "record")}
      return record;
    });
  },
  async update(id, values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      ${versionPrelude}const [record] = await tx.update(${entity.name}).set(${updateSet}).where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg}${versionCondition})).returning();${versionConflict(`(await tx.select({ id: ${entity.name}.id }).from(${entity.name}).where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg})).limit(1))[0]`)}
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) } });
       if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
  async delete(id, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const [record] = await tx.${removeFrom}.where(and(notDeleted, eq(${entity.name}.id, id), scopeCondition${policyArg})).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: {} });
       if (record) ${realtimeWrite("deleted", "record") || "void 0;"}
      return record;
    });
  },
  async deleteMany(ids, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const deletedRows = await tx.${removeFrom}.where(and(notDeleted, inArray(${entity.name}.id, ids), scopeCondition${policyArg})).returning();
      if (deletedRows.length) await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: {} })));
       if (deletedRows.length) ${realtimeDeleteManyWrite || "void 0;"}
      return deletedRows;
    });
  },
`;
  const restoreAudit = database.dialect === "sqlite"
    ? `tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.restored", resource: "${entity.tableName}", resourceId: id, metadata: "{}", createdAt: new Date() }).run();`
    : database.dialect === "mysql"
      ? `await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.restored", resource: "${entity.tableName}", resourceId: id, metadata: {}, createdAt: Date.now() });`
      : `await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.restored", resource: "${entity.tableName}", resourceId: id, metadata: {} });`;
  const restoreScope = `const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const deletedCondition = and(isNotNull(${entity.name}.${softDeleteField}), eq(${entity.name}.id, id), scopeCondition${policyArg});
      const restoredValues = { ${softDeleteField}: null } as Partial<typeof ${entity.name}.$inferInsert>;`;
  const restoreMethod = !softDeleteField ? "" : database.dialect === "sqlite" ? `  async restore(id, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction((tx) => {
      ${restoreScope}
      const record = tx.update(${entity.name}).set(restoredValues).where(deletedCondition).returning().get();
      if (record) ${restoreAudit}
      if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
` : database.dialect === "mysql" ? `  async restore(id, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      ${restoreScope}
      const [existing] = await tx.select().from(${entity.name}).where(deletedCondition).limit(1).for("update");
      if (!existing) return undefined;
      await tx.update(${entity.name}).set(restoredValues).where(deletedCondition);
      const [record] = await tx.select().from(${entity.name}).where(eq(${entity.name}.id, id)).limit(1);
      ${restoreAudit}
      ${realtimeWrite("updated", "record")}
      return record;
    });
  },
` : `  async restore(id, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      ${restoreScope}
      const [record] = await tx.update(${entity.name}).set(restoredValues).where(deletedCondition).returning();
      if (record) ${restoreAudit}
      if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
`;
  const generatedCreateFields = generatedFieldsOf(entity, database.relations ?? []);
  const mutationMethods = injectLinkWrites(generatedCreateFields.length
    ? wrapGeneratedCreateMethods(auditedMutationMethods + restoreMethod, entity.name, JSON.stringify(generatedFieldSpecs(entity, database)))
    : auditedMutationMethods + restoreMethod, entity, database);
  return `  async aggregate(field, operator, scope${restricted ? ", policy" : ""}) {
    if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unsupported aggregate operator");
    const columns: Record<string, any> = { ${numericFields} };
    const column = columns[field];
    if (!column) throw new Error("Unsupported aggregate field");
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = scope && ${restricted ? "!(policy && policy.usesScope) && " : ""}scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
    ${policyCondition}
    const expression = operator === "sum" ? sum(column) : operator === "avg" ? avg(column) : operator === "min" ? min(column) : max(column);
    const [row] = await db.select({ value: expression }).from(${entity.name}).where(and(notDeleted, scopeCondition${policyArg}));
    const value = row?.value === null || row?.value === undefined ? null : Number(row.value);
    return { value: value === null || Number.isFinite(value) ? value : null, operator };
  },
  async distribution(field, scope${restricted ? ", policy" : ""}) {
    const columns: Record<string, any> = { ${groupFields} };
    const column = columns[field];
    if (!column) throw new Error("Unsupported distribution field");
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = scope && ${restricted ? "!(policy && policy.usesScope) && " : ""}scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
    ${policyCondition}
    return db.select({ value: column, count: count() }).from(${entity.name}).where(and(notDeleted, scopeCondition${policyArg})).groupBy(column);
  },
  async grouped(groupBy, metric, operator, scope${restricted ? ", policy" : ""}) {
    if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unsupported aggregate operator");
    const groupColumns: Record<string, any> = { ${groupFields} };
    const metricColumns: Record<string, any> = { ${numericFields} };
    const group = groupColumns[groupBy];
    const column = metricColumns[metric];
    if (!group) throw new Error("Unsupported distribution field");
    if (!column) throw new Error("Unsupported aggregate field");
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = scope && ${restricted ? "!(policy && policy.usesScope) && " : ""}scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
    ${policyCondition}
    const expression = operator === "sum" ? sum(column) : operator === "avg" ? avg(column) : operator === "min" ? min(column) : max(column);
    const rows = await db.select({ value: group, count: expression }).from(${entity.name}).where(and(notDeleted, scopeCondition${policyArg})).groupBy(group);
    return rows.map((row) => ({ value: row.value === null ? null : String(row.value), count: Number(row.count ?? 0) }));
  },
  async trend(field, days, scope${restricted ? ", policy" : ""}) {
    const columns: Record<string, any> = { ${dateFields} };
    const column = columns[field];
    if (!column || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend query");
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = scope && ${restricted ? "!(policy && policy.usesScope) && " : ""}scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
    ${policyCondition}
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * 86400000);
    const end = new Date(today + 86400000);
    const day = ${database.dialect === "postgresql" ? "sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`" : database.dialect === "sqlite" ? "sql<string>`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`" : "sql<string>`date_format(${column}, '%Y-%m-%d')`"};
    return db.select({ day, count: count() }).from(${entity.name}).where(and(notDeleted, gte(column, start), lt(column, end), scopeCondition${policyArg})).groupBy(day).orderBy(day);
  },
  async list(page, pageSize, options = {}) {
    const searchableColumns: any[] = [${searchableFields}];
    const searchCondition = options.search && searchableColumns.length > 0
      ? or(...searchableColumns.map((column) => ${searchOperator}(column, "%" + options.search + "%")))
      : undefined;
    const sortColumns: Record<string, any> = { ${sortFields} };
    const sortColumn = options.sort ? sortColumns[options.sort] : ${entity.name}.id;
    if (options.sort && !sortColumn) throw new Error("Unsupported sort field");
    const orderBy = options.order === "desc" ? desc(sortColumn) : asc(sortColumn);
    const filterColumns: Record<string, any> = { ${filterFields} };
    const filterTypes = ${filterTypes} as Record<string, string>;
    const filters = Array.isArray(options.filters) ? options.filters : Object.entries(options.filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
    const filterClauses = (expressions: FilterExpression[]): FilterClause[] => expressions.flatMap((filter) => "field" in filter ? [filter] : filterClauses(filter.filters));
    if (filterClauses(filters as FilterExpression[]).some(({ field }) => !filterColumns[field]${linked ? " && !qiyLinkFilters[field]" : ""})) throw new Error("Unsupported filter field");
    const coerce = (field: string, value: string) => filterTypes[field] === "Integer" ? Number(value) : filterTypes[field] === "DateTime" ? new Date(value) : value;
    const filterCondition = ({ field, operator, value }: FilterClause) => {
      const column = filterColumns[field];${linked ? `
      const link = qiyLinkFilters[field];
      if (link) {
        if (operator !== "eq" && operator !== "in") throw new Error("Unsupported filter operator");
        return qiyLinkedSources(link, ${entity.name}.id, value);
      }` : ""}
      if (operator === "contains") return ${searchOperator}(column, "%" + value + "%");
      if (operator === "startsWith") return ${searchOperator}(column, value + "%");
      if (operator === "endsWith") return ${searchOperator}(column, "%" + value);
      if (operator === "gt") return gt(column, coerce(field, value));
      if (operator === "gte") return gte(column, coerce(field, value));
      if (operator === "lt") return lt(column, coerce(field, value));
      if (operator === "lte") return lte(column, coerce(field, value));
      if (operator === "between") {
        const [lower, upper, extra] = value.split(",").map((item) => item.trim());
        if (!lower || !upper || extra !== undefined) throw new Error("Between filter requires two values");
        return and(gte(column, coerce(field, lower)), lte(column, coerce(field, upper)));
      }
      if (operator === "in") {
        const values = value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => coerce(field, item));
        if (values.length === 0) throw new Error("In filter requires at least one value");
        return inArray(column, values);
      }
      return eq(column, coerce(field, value));
    };
    const filterExpression = (filter: FilterExpression): any => "field" in filter
      ? filterCondition(filter)
      : filter.operator === "and" ? and(...filter.filters.map(filterExpression)) : or(...filter.filters.map(filterExpression));
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = options.scope && ${restricted ? "!(options.policy && options.policy.usesScope) && " : ""}scopeColumns[options.scope.field] ? ${scopeColumnConditionFor("options.scope")} : undefined;
    ${policyCondition.replace("policy && policy.conditions.length", "options.policy && options.policy.conditions.length").replace("(policy.conditions as any[])", "(options.policy.conditions as any[])")}
    const whereCondition = and(${softDeleteField ? `options.deleted ? isNotNull(${entity.name}.${softDeleteField}) : notDeleted` : "notDeleted"}, searchCondition, scopeCondition${policyArg}, ...(filters as FilterExpression[]).map(filterExpression));
    const [data, totalRows] = await Promise.all([
      db.select().from(
${entity.name}
).where(whereCondition).orderBy(orderBy).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ total: count() }).from(
${entity.name}
).where(whereCondition),
    ]);
    return { data, total: totalRows[0]?.total ?? 0 };
  },
  async one(id, scope${restricted ? ", policy" : ""}) {
    const scopeColumns: Record<string, any> = { ${filterFields} };
    const scopeCondition = scope && ${restricted ? "!(policy && policy.usesScope) && " : ""}scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
    ${policyCondition}
    const [record] = await db.select().from(
${entity.name}
).where(and(notDeleted, eq(
${entity.name}
.id, id), scopeCondition${policyArg})).limit(1);
    return record;
  },
${mutationMethods}
  async recordExportAudit(input) {
    await db.insert(auditEvents).values(${exportAuditValues});
  },
  async recordImportAudit(input) {
    await db.insert(auditEvents).values(${importAuditValues});
  },
`;
}
