/**
 * Server renderers for row policies, data scopes and the declarative
 * permission model (expansion tables, routes and tests).
 */
import type { DatabaseIR, EntityIR } from "../database-ir";
import type { QiyProject, QiyPolicyExpression, QiyResourceRestriction, QiyRowPredicate } from "../qiy-project";
import { declaredPermissionValues, evaluatePermissionVerification as evaluateDeclaredVerification, permissionExpansionTables, resolvePermissionSnapshot, type QiyPermissionModel } from "../permissions";
import type { RoleContext } from "../roles";
import { resolveScopeTree, renderScopeTreeHelper, modelName, type QiyScope } from "./shared";

/**
 * Claims and seed values that let a generated test principal see the seeded
 * rows of restricted resources. Returns undefined when a policy uses a
 * form (scope, cross-field, not) that a static fixture cannot satisfy.
 */
export function restrictionFixture(database: DatabaseIR, restrictions: QiyResourceRestriction[], entityNames: string[]): { claims: Record<string, string>; values: Map<string, Map<string, string>> } | undefined {
  const claims: Record<string, string> = {};
  const values = new Map<string, Map<string, string>>();
  for (const name of entityNames) {
    const restriction = restrictions.find((candidate) => candidate.resource === name);
    const entity = database.entities.find((candidate) => candidate.name === name);
    if (!restriction || !entity) continue;
    const fields = new Map<string, string>();
    const satisfy = (predicate: QiyRowPredicate) => {
      const field = entity.fields.find((candidate) => candidate.name === predicate.field);
      const numeric = field?.type === "Integer";
      if (predicate.source === "claim") {
        claims[predicate.claim!] ??= field?.type === "UUID" ? "00000000-0000-4000-8000-0000000000aa" : numeric ? "41" : "qiy-claim";
        if (predicate.operator === "==") fields.set(predicate.field, numeric ? claims[predicate.claim!]! : JSON.stringify(claims[predicate.claim!]));
        return true;
      }
      if (predicate.operator === "==" || predicate.operator === "in") fields.set(predicate.field, numeric ? String(Number(predicate.values![0])) : JSON.stringify(predicate.values![0]));
      return true;
    };
    const visit = (node: QiyPolicyExpression): boolean =>
      node.kind === "predicate" ? satisfy(node.predicate)
        : node.kind === "and" ? node.children.every(visit)
          : node.kind === "or" ? node.children.length > 0 && visit(node.children[0]!)
            : false;
    const supported = (restriction.rows ?? []).every(satisfy)
      && (restriction.groups ?? []).every((group) => group.length > 0 && satisfy(group[0]!))
      && (restriction.expressions ?? []).every(visit);
    if (!supported) return undefined;
    values.set(name, fields);
  }
  return { claims, values };
}

/** Stub-repository tests only observe the scope, so they skip resources whose row policy also needs policy claims. */
export function rowPolicyFree(database: DatabaseIR, restrictions: NonNullable<QiyProject["restrictions"]>) {
  const restricted = new Set(restrictions.filter((restriction) => restriction.rows?.length || restriction.groups?.length || restriction.expressions?.length).flatMap((restriction) => {
    const entity = database.entities.find((item) => item.name === restriction.resource || item.tableName === restriction.resource);
    return entity ? [entity.name] : [];
  }));
  return (resource: string) => !database.entities.some((entity) => restricted.has(entity.name) && (entity.name === resource || entity.tableName === resource));
}

export function renderDataScopeTest(database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]>, restrictions: NonNullable<QiyProject["restrictions"]> = []): string | undefined {
  const policyFree = rowPolicyFree(database, restrictions);
  const configured = scopes.find((scope) => policyFree(scope.resource));
  if (!configured) return undefined;
  const entity = database.entities.find((item) => item.name === configured.resource || item.tableName === configured.resource)!;
  const unscoped = database.entities.find((item) => item.name !== entity.name && !scopes.some((scope) => scope.resource === item.name || scope.resource === item.tableName));
  const name = modelName(entity);
  const value = entity.fields.find((field) => field.name === configured.field)?.type === "UUID"
    ? "00000000-0000-4000-8000-000000000002" : "tenant-a";
  return `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";
import { QIY_ADMIN_ROLE } from "../src/auth/roles";

const scoped = { field: ${JSON.stringify(configured.field)}, value: ${JSON.stringify(value)} };
const seen: Array<unknown> = [];
const repository = {
  distribution: async (_field: string, scope?: unknown) => { seen.push(scope); return []; },
  list: async (_page: number, _size: number, options?: { scope?: unknown }) => { seen.push(options?.scope); return { data: [], total: 0 }; },
  one: async (_id: string, scope?: unknown) => { seen.push(scope); return undefined; },
  create: async (_values: unknown, _actor?: string, scope?: unknown) => { seen.push(scope); return {}; },
  update: async (_id: string, _values: unknown, _actor?: string, scope?: unknown) => { seen.push(scope); return undefined; },
  delete: async (_id: string, _actor?: string, scope?: unknown) => { seen.push(scope); return undefined; },
  deleteMany: async (_ids: string[], _actor?: string, scope?: unknown) => { seen.push(scope); return []; },
};
const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((item) => item.name))}.map((resource) => [resource, repository])) as unknown as Repositories;
const request = (query: string) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });

test("data scope rejects missing claims without blocking unrelated resources", async () => {
  seen.length = 0;
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: QIY_ADMIN_ROLE }), false);
  const graph = await app.handle(request("query { ${entity.name} { total } }"));
  if (graph.status === 200) expect((await graph.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  else expect(graph.status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/${entity.tableName}/"))).status).toBe(403);
  ${unscoped ? `expect((await app.handle(request("query { ${unscoped.name} { total } }"))).status).toBe(200);` : ""}
  expect(seen).toEqual(${unscoped ? "[undefined]" : "[]"});
});

test("REST and GraphQL pass the authorized scope to repository operations", async () => {
  seen.length = 0;
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: QIY_ADMIN_ROLE, claims: { ${JSON.stringify(configured.claim)}: scoped.value } }), false);
  const list = await app.handle(request("query { ${entity.name} { total } }"));
  expect(list.status).toBe(200);
  expect((await list.json() as { data: { ${entity.name}: { total: number } } }).data.${entity.name}.total).toBe(0);
  expect((await app.handle(request('mutation { delete${name}(id: "00000000-0000-4000-8000-000000000001") { id } }'))).status).toBe(200);
  expect((await app.handle(new Request("http://localhost/api/v1/${entity.tableName}/"))).status).toBe(200);
  expect(seen).toEqual([scoped, scoped, scoped]);
});
`;
}

export function previewRecord(entity: EntityIR, database: DatabaseIR, scope?: { field: string; value: string }): string {
  const values = entity.fields.map((field) => {
    if (field.type === "DateTime") return `${JSON.stringify(field.name)}: new Date().toISOString()`;
    if (field.type === "Date") return `${JSON.stringify(field.name)}: ${JSON.stringify("2026-11-30")}`;
    if (field.type === "Time") return `${JSON.stringify(field.name)}: ${JSON.stringify("08:30:00")}`;
    let value: unknown = null;
    if (field.name === scope?.field) value = scope.value;
    else if (field.primaryKey) value = "00000000-0000-4000-8000-000000000001";
    else if (field.enumName) value = database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values[0]?.name ?? null;
    else if (field.type === "Text") value = `Demo ${entity.name}`;
    else if (field.type === "Email") value = "user@example.com";
    else if (field.type === "URL") value = "https://example.com";
    else if (field.type === "JSON") value = {};
    else if (field.type === "Array") value = field.itemType === "Integer" ? [1] : ["Example"];
    else if (field.type === "Boolean") value = true;
    else if (field.type === "Integer") value = 1;
    else if (field.type === "Decimal" || field.type === "Money") value = "49.90";
    return `${JSON.stringify(field.name)}: ${JSON.stringify(value)}`;
  });
  return `{ ${values.join(", ")} }`;
}

export function previewRepository(entity: EntityIR, database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]> = []): string {
  const configured = scopes.find((scope) => scope.resource === entity.name || scope.resource === entity.tableName);
  const field = entity.fields.find((item) => item.name === configured?.field);
  const scope = configured && field ? { field: field.name, value: field.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : `Demo ${entity.name}` } : undefined;
  const scopeWriteSpread = "...(scope ? { [scope.field]: scope.value } : {})";
  return `${entity.name}: (() => {
    const records: Array<Record<string, unknown>> = [${previewRecord(entity, database, scope)}];
    const visible = (record: Record<string, unknown>, scope?: { field: string; value: string }) => !scope || record[scope.field] === scope.value;
    return {
      async distribution(field: string, scope?: { field: string; value: string }) { const counts = new Map<string, number>(); for (const record of records.filter((item) => visible(item, scope))) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },
      async trend(field: string, days: number, scope?: { field: string; value: string }) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.filter((item) => visible(item, scope))) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },
      async list(page: number, pageSize: number, options?: { scope?: { field: string; value: string } }) { const rows = records.filter((record) => visible(record, options?.scope)); return { data: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length }; },
      async one(id: string, scope?: { field: string; value: string }) { return records.find((record) => record.id === id && visible(record, scope)); },
      async create(values: Record<string, unknown>, _actor?: string, scope?: { field: string; value: string }) {
        const record = { id: crypto.randomUUID(), ...values, ${scopeWriteSpread} };
        records.push(record);
        return record;
      },
      async update(id: string, values: Record<string, unknown>, _actor?: string, scope?: { field: string; value: string }) {
        const record = records.find((item) => item.id === id && visible(item, scope));
        if (record) Object.assign(record, values, scope ? { [scope.field]: scope.value } : {});
        return record;
      },
      async delete(id: string, _actor?: string, scope?: { field: string; value: string }) {
        const index = records.findIndex((record) => record.id === id && visible(record, scope));
        return index === -1 ? undefined : records.splice(index, 1)[0];
      },
      async deleteMany(ids: string[], _actor?: string, scope?: { field: string; value: string }) {
        const deleted = records.filter((record) => ids.includes(String(record.id)) && visible(record, scope));
        for (const record of deleted) records.splice(records.indexOf(record), 1);
        return deleted;
      },
    };
  })(),`;
}

/**
 * Row-level and field-level authorization shared by REST, GraphQL and the
 * repository layer. Row predicates are compiled into Drizzle conditions so the
 * database enforces visibility, and field masks are applied to every response
 * projection. Both are derived from the authenticated principal, never from the
 * request body, so a client cannot widen its own scope.
 */
export function renderPolicyModule(restrictions: QiyResourceRestriction[], database: DatabaseIR, scopes: QiyScope[] = []): string {
  const configuredScopes = scopes.length ? scopes : ((database as DatabaseIR & { scopes?: QiyScope[] }).scopes ?? []);
  /** True when a restrict expression mentions the caller's data scope. */
  const mentionsScope = (node: QiyPolicyExpression): boolean =>
    node.kind === "scope" ? true
      : node.kind === "not" ? mentionsScope(node.expression)
        : node.kind === "and" || node.kind === "or" ? node.children.some(mentionsScope)
          : false;
  // resolveScopeTree reads scopes off the database IR, so mirror them onto a copy.
  const scopedDatabase = scopes.length ? ({ ...database, scopes } as DatabaseIR & { scopes: QiyScope[] }) : database;
  const scopeResources: Record<string, { field: string; helper?: string }> = {};
  const treeHelpers: string[] = [];
  for (const restriction of restrictions) {
    if (!(restriction.expressions ?? []).some(mentionsScope)) continue;
    const entity = database.entities.find((candidate) => candidate.name === restriction.resource)!;
    const scope = configuredScopes.find((candidate) => candidate.resource === entity.name || candidate.resource === entity.tableName);
    if (!scope) continue;
    let helper: string | undefined;
    if (resolveScopeTree(scopedDatabase, entity) && !treeHelpers.some((item) => item === entity.name)) {
      const name = `qiyPolicyScopeSubtree_${treeHelpers.length}`;
      const rendered = renderScopeTreeHelper(scopedDatabase, entity, name);
      if (rendered) {
        treeHelpers.push(rendered);
        helper = name;
      }
    }
    scopeResources[entity.name] = { field: scope.field, ...(helper ? { helper } : {}) };
  }
  const scopeLiteral = JSON.stringify(scopeResources);
  const helperNames = treeHelpers.map((code) => /function (qiyPolicyScopeSubtree_\d+)/.exec(code)?.[1]).filter((name): name is string => Boolean(name));
  const helperMapLiteral = `{ ${helperNames.map((name) => `${JSON.stringify(name)}: ${name}`).join(", ")} }`;
  const scopeHelperCode = treeHelpers.length ? `\n${treeHelpers.join("\n")}` : "";
  const treeImport = treeHelpers.length ? `\nimport { ${[...new Set(scopes.map((scope) => database.entities.find((candidate) => candidate.name === scope.tree?.entity || candidate.tableName === scope.tree?.entity)?.name).filter((name): name is string => Boolean(name)))].join(", ")} } from "../schema";` : "";
  const rowsLiteral = JSON.stringify(Object.fromEntries(restrictions.map((restriction) => {
    const entity = database.entities.find((candidate) => candidate.name === restriction.resource)!;
    const numericFields = [...(restriction.rows ?? []), ...(restriction.groups ?? []).flat()]
      .filter((row) => entity.fields.find((field) => field.name === row.field)?.type === "Integer")
      .map((row) => row.field);
    return [restriction.resource, { rows: restriction.rows ?? [], groups: restriction.groups ?? [], expressions: restriction.expressions ?? [], masks: restriction.masks ?? [], roles: restriction.roles ?? [], numericFields }];
  })));
  const roleLiteral = JSON.stringify(Object.fromEntries(restrictions.filter((restriction) => restriction.roles?.length).map((restriction) => [restriction.resource, restriction.roles!])));
  return `import { and, eq, gt, gte, inArray, lt, lte, ne, not, notInArray, or${treeHelpers.length ? ", sql" : ""} } from "drizzle-orm";
import type { Principal } from "../auth/guard";
import type { QiyRole } from "../auth/roles";

export type { QiyRole };

export interface QiyRowPredicate {
  field: string;
  source: "claim" | "values";
  operator: "==" | "!=" | "in" | "notIn";
  claim?: string;
  values?: string[];
  missing: "deny" | "hide";
}

export type QiyCrossOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type QiyPolicyExpression =
  | { kind: "predicate"; predicate: QiyRowPredicate }
  | { kind: "cross"; field: string; operator: QiyCrossOperator; otherField: string }
  | { kind: "scope" }
  | { kind: "not"; expression: QiyPolicyExpression }
  | { kind: "and"; children: QiyPolicyExpression[] }
  | { kind: "or"; children: QiyPolicyExpression[] };

export interface QiyFieldMask {
  field: string;
  roles?: QiyRole[];
  claim?: string;
  claimState?: "present" | "absent";
  mode: "omit" | "null" | "redact";
  replacement?: string;
}

export interface QiyResourcePolicy {
  rows: QiyRowPredicate[];
  /** Each group is OR-ed internally and AND-ed with rows. */
  groups: QiyRowPredicate[][];
  /** General boolean expressions AND-ed with rows and groups. */
  expressions: QiyPolicyExpression[];
  masks: QiyFieldMask[];
  roles: QiyRole[];
  /** Fields whose declared literal values must be coerced to numbers. */
  numericFields: string[];
}

/** Resolved authorization state for one request and one resource. */
export interface QiyPolicy {
  /** Drizzle row conditions that must all hold for a row to be visible. */
  conditions: unknown[];
  /** True when an expression mentions the scope atom, so the repository must not also apply its implicit scope filter. */
  usesScope: boolean;
  /** Fields the current principal must not read or write. */
  maskedFields: string[];
  /** Applies role and claim based field masking to a response record. */
  mask(record: Record<string, unknown>): Record<string, unknown>;
}

const policies = ${rowsLiteral} as Record<string, QiyResourcePolicy>;
const scopeResources = ${scopeLiteral} as Record<string, { field: string; helper?: string }>;
const scopeHelpers: Record<string, (column: unknown, value: string) => unknown> = ${helperMapLiteral};${treeImport}${scopeHelperCode}
const resourceRoles = ${roleLiteral} as Record<string, QiyRole[]>;

export class QiyPolicyError extends Error {
  readonly status: number;
  readonly errorKey: string;
  constructor(message: string, status = 403, errorKey = "policy.denied") {
    super(message);
    this.status = status;
    this.errorKey = errorKey;
  }
}

/** True when the principal carries any role permitted for the resource. */
export function mayUseResource(resource: string, principal: Principal | null): boolean {
  const roles = resourceRoles[resource];
  if (!roles || roles.length === 0) return true;
  if (!principal) return false;
  return roles.includes(principal.role as QiyRole);
}

function claimValue(principal: Principal | null, claim: string): string | undefined {
  const value = principal?.claims?.[claim];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/**
 * Builds the row conditions and mask function for a resource. When the resource
 * has no recorded policy the result is inert, so generated behaviour for models
 * without \`restrict\` blocks is unchanged.
 */
export function resolvePolicy(resource: string, principal: Principal | null, columns: Record<string, unknown>, scope?: { field: string; value: string }): QiyPolicy {
  const policy = policies[resource];
  if (!policy) return { conditions: [], maskedFields: [], mask: (record) => record, usesScope: false };
  if (!mayUseResource(resource, principal)) throw new QiyPolicyError("Permission denied for resource " + resource, 403, "policy.resourceDenied");
  const conditions: unknown[] = [];
  /** Returns the condition for one predicate, or undefined when it must be hidden. */
  const buildCondition = (row: QiyRowPredicate, missingIsHide: boolean): unknown | undefined => {
    const column = columns[row.field];
    if (!column) throw new QiyPolicyError("Unknown policy column " + row.field, 500, "policy.misconfigured");
    if (row.source === "claim") {
      const value = claimValue(principal, row.claim!);
      if (value === undefined) {
        if (row.missing === "deny" && !missingIsHide) throw new QiyPolicyError("Missing required authorization claim: " + row.claim, 403, "policy.missingClaim");
        return undefined;
      }
      return eq(column as never, value as never);
    }
    const values = (row.values ?? []).map((value) => (policy.numericFields.includes(row.field) ? Number(value) : value));
    if (row.operator === "==") return eq(column as never, values[0] as never);
    if (row.operator === "!=") return ne(column as never, values[0] as never);
    if (row.operator === "in") return inArray(column as never, values as never[]);
    return notInArray(column as never, values as never[]);
  };
  for (const row of policy.rows) {
    conditions.push(buildCondition(row, false) ?? eq(columns[row.field] as never, "__qiy_policy_never_matches__" as never));
  }
  for (const group of policy.groups ?? []) {
    // A missing claim drops only its own branch; if every branch drops the request
    // stays fail-closed instead of silently returning every row.
    const branches = group.map((row) => buildCondition(row, true)).filter((condition) => condition !== undefined);
    if (!branches.length) throw new QiyPolicyError("Missing required authorization claim for a policy group", 403, "policy.missingClaim");
    conditions.push(branches.length === 1 ? branches[0] : or(...(branches as never[])));
  }
  /** Builds one boolean expression; undefined means "cannot be satisfied for this principal". */
  const buildExpression = (node: QiyPolicyExpression): unknown | undefined => {
    if (node.kind === "predicate") return buildCondition(node.predicate, true);
    if (node.kind === "scope") {
      const config = scopeResources[resource];
      if (!scope || !scope.value || !config) return undefined;
      const column = columns[scope.field] ?? columns[config.field];
      if (!column) throw new QiyPolicyError("Unknown scope column " + scope.field, 500, "policy.misconfigured");
      const helper = config.helper ? scopeHelpers[config.helper] : undefined;
      if (helper) return helper(column, scope.value);
      return eq(column as never, scope.value as never);
    }
    if (node.kind === "cross") {
      const left = columns[node.field];
      const right = columns[node.otherField];
      if (!left || !right) throw new QiyPolicyError("Unknown cross-field policy column", 500, "policy.misconfigured");
      if (node.operator === "==") return eq(left as never, right as never);
      if (node.operator === "!=") return ne(left as never, right as never);
      if (node.operator === "<") return lt(left as never, right as never);
      if (node.operator === "<=") return lte(left as never, right as never);
      if (node.operator === ">") return gt(left as never, right as never);
      return gte(left as never, right as never);
    }
    if (node.kind === "not") {
      // NOT of an unsatisfiable claim branch is never treated as "allow everything".
      const inner = buildExpression(node.expression);
      return inner === undefined ? undefined : not(inner as never);
    }
    const children = node.children.map(buildExpression).filter((condition) => condition !== undefined);
    if (!children.length) return undefined;
    if (children.length === 1) return children[0];
    return node.kind === "and" ? and(...(children as never[])) : or(...(children as never[]));
  };
  for (const expression of policy.expressions ?? []) {
    const built = buildExpression(expression);
    if (built === undefined) throw new QiyPolicyError("Missing required authorization claim for a policy expression", 403, "policy.missingClaim");
    conditions.push(built);
  }
  const activeMasks = policy.masks.filter((mask) => {
    if (mask.roles && !(principal && mask.roles.includes(principal.role as QiyRole))) return false;
    if (mask.claim) {
      const present = claimValue(principal, mask.claim) !== undefined;
      if (mask.claimState === "absent" ? present : !present) return false;
    }
    return true;
  });
  const mask = (record: Record<string, unknown>) => {
    if (!activeMasks.length) return record;
    const safe = { ...record };
    for (const item of activeMasks) {
      if (!Object.hasOwn(safe, item.field)) continue;
      if (item.mode === "omit") delete safe[item.field];
      else if (item.mode === "null") safe[item.field] = null;
      else safe[item.field] = item.replacement;
    }
    return safe;
  };
  const usesScope = (policy.expressions ?? []).some((expression) => {
    const visit = (node: QiyPolicyExpression): boolean =>
      node.kind === "scope" ? true
        : node.kind === "not" ? visit(node.expression)
          : node.kind === "and" || node.kind === "or" ? node.children.some(visit)
            : false;
    return visit(expression);
  });
  return { conditions, maskedFields: activeMasks.map((item) => item.field), mask, usesScope };
}
`;
}

/**
 * Generated permission provider (`api/src/auth/permissions.ts`). Resolution is a
 * union of the role group, the configured database permission column and the
 * verified id_token claims; verification expressions are data-driven so the same
 * HTTP/command checks run in every generated app.
 */
export function renderPermissionModule(auth: NonNullable<QiyProject["auth"]>, permissions: QiyPermissionModel): string {
  const expansion = permissionExpansionTables(permissions);
  const claimSources = permissions.claims ?? [];
  const databaseSource = permissions.database;
  const schemaName = auth.userEntity;
  const dbImports = databaseSource
    ? `import { eq } from "drizzle-orm";\nimport { db } from "../db";\nimport { ${schemaName} } from "../schema";\n`
    : "";
  const databaseLoad = databaseSource
    ? `  let databasePermissions: string[] | undefined;
  try {
    const rows = await db.select({ value: ${schemaName}.${databaseSource.field} }).from(${schemaName}).where(eq(${schemaName}.id, principal.id)).limit(1);
    databasePermissions = normalizeDatabasePermissionColumn(rows[0]?.value);
  } catch {
    // A missing row/table must not break /auth/me: the role group and verified
    // claims still apply, and the database source only ever adds permissions.
    databasePermissions = undefined;
  }
`
    : "";
  const verifications = Object.fromEntries(permissions.verifications.map((verification) => [verification.name, { inputs: verification.inputs, expression: verification.expression }]));
  return `import type { Principal } from "./guard";
${dbImports}
export interface QiyPermissionSnapshot { permissions: string[]; groups: string[] }

/** Permission field name -> permission value. */
const PERMISSION_FIELD_VALUES: Record<string, string> = ${JSON.stringify(expansion.fieldValues)};
/** Declared permission values: provider entries are values or group names. */
const PERMISSION_DECLARED_VALUES: readonly string[] = ${JSON.stringify(declaredPermissionValues(permissions))};
/** Permission group name -> member permission field or group names. */
const PERMISSION_GROUPS: Record<string, string[]> = ${JSON.stringify(expansion.groups)};
/** Verified id_token claim sources declared with \`permission from claim\`. */
const PERMISSION_CLAIM_SOURCES: Array<{ provider: string; claim: string }> = ${JSON.stringify(claimSources)};

function splitPermissionEntries(value: string): string[] {
  return [...new Set(value.split(/[\\s,]+/).map((entry) => entry.trim()).filter(Boolean))];
}

/** Claim values may be a string array, one comma/space separated string, or one string. */
export function normalizeClaimPermissionValues(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
  if (typeof value !== "string") return [];
  return splitPermissionEntries(value);
}

/** The database permission column is a JSON string array; separated text is accepted too. */
export function normalizeDatabasePermissionColumn(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? [...new Set(parsed.filter((entry): entry is string => typeof entry === "string"))] : [];
    } catch { return []; }
  }
  return splitPermissionEntries(trimmed);
}

function expandPermissionEntry(entry: string, values: Set<string>, groups: Set<string>, visiting: Set<string>): void {
  const fieldValue = PERMISSION_FIELD_VALUES[entry];
  if (fieldValue !== undefined) { values.add(fieldValue); return; }
  const members = PERMISSION_GROUPS[entry];
  if (!members || visiting.has(entry)) return;
  visiting.add(entry);
  groups.add(entry);
  for (const member of members) expandPermissionEntry(member, values, groups, visiting);
  visiting.delete(entry);
}

export function expandPermissionEntries(entries: Iterable<string>): QiyPermissionSnapshot {
  const values = new Set<string>();
  const groups = new Set<string>();
  for (const entry of entries) expandPermissionEntry(entry, values, groups, new Set());
  return { permissions: [...values].sort(), groups: [...groups].sort() };
}

export function resolvePermissionSnapshot(source: { role: string; claims?: Principal["claims"]; databasePermissions?: readonly string[] }): QiyPermissionSnapshot {
  const values = new Set<string>();
  const groups = new Set<string>();
  expandPermissionEntry(source.role, values, groups, new Set());
  for (const entry of source.databasePermissions ?? []) {
    if (PERMISSION_DECLARED_VALUES.includes(entry)) values.add(entry);
    else expandPermissionEntry(entry, values, groups, new Set());
  }
  for (const claimSource of PERMISSION_CLAIM_SOURCES) {
    for (const entry of normalizeClaimPermissionValues(source.claims?.[claimSource.claim])) {
      if (PERMISSION_DECLARED_VALUES.includes(entry)) values.add(entry);
      else expandPermissionEntry(entry, values, groups, new Set());
    }
  }
  return { permissions: [...values].sort(), groups: [...groups].sort() };
}

/** Effective permissions for the authenticated principal; never throws for missing rows. */
export async function loadPermissions(principal: Principal): Promise<QiyPermissionSnapshot> {
${databaseLoad}  const snapshot = resolvePermissionSnapshot({ role: principal.role, ...(principal.claims ? { claims: principal.claims } : {})${databaseSource ? ", databasePermissions" : ""} });
  if (!principal.scopes || principal.scopes.length === 0) return snapshot;
  const allowed = new Set(principal.scopes);
  return { ...snapshot, permissions: snapshot.permissions.filter((permission) => allowed.has(permission)) };
}

export type QiyPermissionVerdict = { allowed: boolean; missing: string[] };
type QiyPermissionInputType = "Text" | "Array<String>";
type QiyPermissionOperand = { kind: "self"; set: "permissions" | "groups" | "role" } | { kind: "input"; name: string } | { kind: "literal"; value: string };
type QiyPermissionExpression =
  | { kind: "comparison"; operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals"; left: QiyPermissionOperand; right: QiyPermissionOperand }
  | { kind: "and"; children: QiyPermissionExpression[] }
  | { kind: "or"; children: QiyPermissionExpression[] }
  | { kind: "not"; expression: QiyPermissionExpression };

const PERMISSION_VERIFICATIONS: Record<string, { inputs: Array<{ name: string; type: QiyPermissionInputType }>; expression: QiyPermissionExpression }> = ${JSON.stringify(verifications)};
export const permissionVerificationNames: string[] = Object.keys(PERMISSION_VERIFICATIONS).sort();

function operandValues(operand: QiyPermissionOperand, self: QiyPermissionSnapshot & { role: string }, input: Record<string, string[]>): string[] {
  if (operand.kind === "self") return operand.set === "role" ? [self.role] : [...(operand.set === "permissions" ? self.permissions : self.groups)];
  if (operand.kind === "literal") return [operand.value];
  return [...(input[operand.name] ?? [])];
}

export function comparePermissionSets(operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals", left: readonly string[], right: readonly string[]): QiyPermissionVerdict {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const difference = [...leftSet].filter((entry) => !rightSet.has(entry)).sort();
  if (operator === "all-in") return { allowed: difference.length === 0, missing: difference };
  if (operator === "some-in") { const shared = [...leftSet].filter((entry) => rightSet.has(entry)); return { allowed: shared.length > 0, missing: shared.length > 0 ? [] : difference }; }
  if (operator === "not-all-in") return { allowed: difference.length > 0, missing: [] };
  if (operator === "not-some-in") { const shared = [...leftSet].filter((entry) => rightSet.has(entry)).sort(); return { allowed: shared.length === 0, missing: shared }; }
  if (operator === "equals") {
    const symmetric = [...new Set([...difference, ...[...rightSet].filter((entry) => !leftSet.has(entry))])].sort();
    return { allowed: symmetric.length === 0, missing: symmetric };
  }
  return { allowed: !(difference.length === 0 && rightSet.size === leftSet.size), missing: [] };
}

function evaluatePermissionExpression(expression: QiyPermissionExpression, self: QiyPermissionSnapshot & { role: string }, input: Record<string, string[]>): QiyPermissionVerdict {
  const evaluate = (node: QiyPermissionExpression): QiyPermissionVerdict => {
    if (node.kind === "comparison") return comparePermissionSets(node.operator, operandValues(node.left, self, input), operandValues(node.right, self, input));
    if (node.kind === "not") { const inner = evaluate(node.expression); return { allowed: !inner.allowed, missing: inner.allowed ? [] : inner.missing }; }
    const results = node.children.map(evaluate);
    if (node.kind === "and") { const failed = results.filter((result) => !result.allowed); return { allowed: failed.length === 0, missing: failed.flatMap((result) => result.missing) }; }
    return { allowed: results.some((result) => result.allowed), missing: results.some((result) => result.allowed) ? [] : results.flatMap((result) => result.missing) };
  };
  const verdict = evaluate(expression);
  return { allowed: verdict.allowed, missing: verdict.allowed ? [] : [...new Set(verdict.missing)].sort() };
}

/**
 * Evaluates one declared verification. Unknown names report \`found: false\`;
 * invalid input shapes report \`error\` so the HTTP route can answer 400; extra
 * input fields are ignored. Declared inputs are required.
 */
export function evaluatePermissionVerification(
  name: string,
  self: QiyPermissionSnapshot & { role: string },
  input: Record<string, unknown>,
): { found: false } | { found: true; allowed: boolean; missing: string[] } | { found: true; error: string } {
  const verification = PERMISSION_VERIFICATIONS[name];
  if (!verification) return { found: false };
  const normalized: Record<string, string[]> = {};
  for (const declared of verification.inputs) {
    const value = input[declared.name];
    if (value === undefined) return { found: true, error: "Verification " + name + " requires input field " + declared.name };
    if (declared.type === "Text") {
      if (typeof value !== "string") return { found: true, error: "Verification " + name + " input field " + declared.name + " must be a string" };
      normalized[declared.name] = [value];
    } else {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return { found: true, error: "Verification " + name + " input field " + declared.name + " must be an array of strings" };
      normalized[declared.name] = [...(value as string[])];
    }
  }
  const verdict = evaluatePermissionExpression(verification.expression, self, normalized);
  return { found: true, allowed: verdict.allowed, missing: verdict.missing };
}
`;
}

/** Generated HTTP surface for permissions: current snapshot and verification checks. */
export function renderPermissionRoutes(): string {
  return `import { Elysia, t } from "elysia";
import type { Authenticator } from "./guard";
import { evaluatePermissionVerification, loadPermissions, permissionVerificationNames } from "./permissions";

export function createPermissionRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/auth" })
    .get("/permissions", async ({ request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      return await loadPermissions(principal);
    })
    .post("/verify-permission", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!permissionVerificationNames.includes(body.verification)) return status(400, { error: "Unknown permission verification: " + body.verification });
      const snapshot = await loadPermissions(principal);
      const verdict = evaluatePermissionVerification(body.verification, { ...snapshot, role: principal.role }, body.input ?? {});
      if (!verdict.found) return status(400, { error: "Unknown permission verification: " + body.verification });
      if ("error" in verdict) return status(400, { error: verdict.error });
      return verdict.allowed ? { allowed: true } : { allowed: false, missing: verdict.missing };
    }, { body: t.Object({ verification: t.String({ minLength: 1, maxLength: 120 }), input: t.Optional(t.Record(t.String(), t.Any())) }) });
}
`;
}

/**
 * Generated permission tests. Expected provider snapshots and verification
 * verdicts are computed at generation time with tools/permissions.ts and asserted
 * against the generated runtime module, so the two implementations cannot drift.
 */
export function renderPermissionTest(database: DatabaseIR, permissions: QiyPermissionModel, declared: RoleContext): string {
  const roles = declared.names.filter((role) => permissions.groups.some((group) => group.name === role));
  const snapshots = Object.fromEntries(roles.map((role) => [role, resolvePermissionSnapshot(permissions, { role })]));
  const sampleValues = declaredPermissionValues(permissions);
  const positiveValue = sampleValues[0] ?? "qiy:permission";
  const pool = sampleValues.length > 1 ? sampleValues : [positiveValue];
  const verificationCases = permissions.verifications.flatMap((verification) => {
    const samples: Array<Record<string, unknown>> = [];
    const build = (values: string[]) => Object.fromEntries(verification.inputs.map((input, index) => [input.name, input.type === "Text" ? values[index] : [values[index]]]));
    if (verification.inputs.every((input) => input.type === "Text")) {
      samples.push(build(pool.slice(0, verification.inputs.length).concat(Array(Math.max(0, verification.inputs.length - pool.length)).fill(positiveValue))));
      samples.push(build(Array(verification.inputs.length).fill("qiy:unknown-permission")));
    } else {
      samples.push(build(Array(verification.inputs.length).fill(positiveValue)));
      samples.push(build(Array(verification.inputs.length).fill("qiy:unknown-permission")));
      if (pool.length > 1) samples.push(build(Array(verification.inputs.length).fill(pool[1])));
    }
    return roles.flatMap((role) => samples.map((input) => {
      const snapshot = snapshots[role]!;
      const verdict = evaluateDeclaredVerification(permissions, verification.name, { permissions: snapshot.permissions, groups: snapshot.groups, role }, input);
      if (!verdict.found || "error" in verdict) throw new Error(`Permission verification ${verification.name}: cannot build a generated test case`);
      return {
        role,
        verification: verification.name,
        input,
        expected: { found: true, allowed: verdict.allowed, missing: verdict.missing },
      };
    }));
  });
  const textOnlyVerification = permissions.verifications.find((verification) => verification.inputs.length > 0 && verification.inputs.every((input) => input.type === "Text"));
  const arrayOnlyVerification = permissions.verifications.find((verification) => verification.inputs.length > 0 && verification.inputs.every((input) => input.type === "Array<String>"));
  const invalidInputChecks = [
    textOnlyVerification ? `expect((await post({ verification: ${JSON.stringify(textOnlyVerification.name)}, input: {} })).status).toBe(400);` : "",
    textOnlyVerification ? `expect((await post({ verification: ${JSON.stringify(textOnlyVerification.name)}, input: ${JSON.stringify(Object.fromEntries(textOnlyVerification.inputs.map((input) => [input.name, 7])))} })).status).toBe(400);` : "",
    arrayOnlyVerification ? `expect((await post({ verification: ${JSON.stringify(arrayOnlyVerification.name)}, input: ${JSON.stringify(Object.fromEntries(arrayOnlyVerification.inputs.map((input) => [input.name, "not-an-array"])))} })).status).toBe(400);` : "",
  ].filter(Boolean).join("\n    ");
  // The database loader is covered end-to-end by the HTTP acceptance matrix
  // against a seeded database; generated tests assert the pure contract because a
  // generated test cannot own the auth user table without racing other suites.
  const databaseTest = "";
  const dataset = JSON.stringify({
    snapshots: Object.fromEntries(roles.map((role) => [role, snapshots[role]])),
    cases: verificationCases,
    positiveValue,
    firstVerification: permissions.verifications[0]?.name ?? "Unknown",
    hasDatabaseSource: Boolean(permissions.database),
  }, null, 2);
  return `import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
${databaseTest ? 'import { client } from "../src/db";' : ""}
import { createApp, type Repositories } from "../src/app";
import { createPermissionRoutes } from "../src/auth/permission-routes";
import {
  evaluatePermissionVerification,
  loadPermissions,
  normalizeClaimPermissionValues,
  normalizeDatabasePermissionColumn,
  permissionVerificationNames,
  resolvePermissionSnapshot,
} from "../src/auth/permissions";
import { QIY_ADMIN_ROLE, QIY_DEFAULT_ROLE, type QiyRole } from "../src/auth/roles";

interface PermissionSnapshot { permissions: string[]; groups: string[] }
interface PermissionCase { role: string; verification: string; input: Record<string, unknown>; expected: { found: true; allowed: boolean; missing: string[] } }
const dataset = ${dataset} as {
  snapshots: Record<string, PermissionSnapshot>;
  cases: PermissionCase[];
  positiveValue: string;
  firstVerification: string;
  textInputVerification?: string;
  arrayInputVerification?: string;
  hasDatabaseSource: boolean;
};

const principal = (role: string) => ({ id: "00000000-0000-4000-8000-000000000010", name: role, role: role as QiyRole });
const authenticate = async (request: Request) => {
  const role = request.headers.get("x-test-role");
  return role ? principal(role) : null;
};
const app = new Elysia().use(createPermissionRoutes(authenticate));
const request = (path: string, role: string | undefined, init: RequestInit = {}) => app.handle(new Request("http://localhost" + path, { ...init, headers: { ...(role ? { "x-test-role": role } : {}), ...(init.headers ?? {}) } }));

describe("generated permission provider", () => {
  test("resolves role-group permissions without any claims or database rows", () => {
${roles.map((role) => `    expect(resolvePermissionSnapshot({ role: ${JSON.stringify(role)} })).toEqual(${JSON.stringify(snapshots[role])});`).join("\n") || "    expect(resolvePermissionSnapshot({ role: QIY_ADMIN_ROLE })).toEqual({ permissions: [], groups: [] });"}
  });

  test("API-key permission scopes intersect the effective permission set", async () => {
    const adminPermissions = (await loadPermissions(principal(QIY_ADMIN_ROLE))).permissions;
    if (adminPermissions.length > 0) {
      const scoped = await loadPermissions({ ...principal(QIY_ADMIN_ROLE), scopes: [adminPermissions[0]!] });
      expect(scoped.permissions).toEqual([adminPermissions[0]!]);
      const none = await loadPermissions({ ...principal(QIY_ADMIN_ROLE), scopes: ["qiy-unknown-scope"] });
      expect(none.permissions).toEqual([]);
    }
  });

  test("claim values accept arrays, comma-separated text and space-separated text", () => {
    expect(normalizeClaimPermissionValues(["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeClaimPermissionValues("a,b")).toEqual(["a", "b"]);
    expect(normalizeClaimPermissionValues("a b")).toEqual(["a", "b"]);
    expect(normalizeClaimPermissionValues(7)).toEqual([]);
    expect(normalizeClaimPermissionValues([1, true, "a"])).toEqual(["a"]);
  });

  test("the database permission column accepts JSON arrays and separated text, failing closed on garbage", () => {
    expect(normalizeDatabasePermissionColumn('["GroupOne","api:getUser"]')).toEqual(["GroupOne", "api:getUser"]);
    expect(normalizeDatabasePermissionColumn("GroupOne, api:getUser")).toEqual(["GroupOne", "api:getUser"]);
    expect(normalizeDatabasePermissionColumn("  ")).toEqual([]);
    expect(normalizeDatabasePermissionColumn("[not-json")).toEqual([]);
    expect(normalizeDatabasePermissionColumn(null)).toEqual([]);
  });
${permissions.claims?.length ? `  test("verified claim sources are only trusted when the claim is present", () => {
${permissions.claims.map((claim) => `    expect(resolvePermissionSnapshot({ role: QIY_DEFAULT_ROLE, claims: { ${JSON.stringify(claim.claim)}: dataset.positiveValue } }).permissions).toContain(dataset.positiveValue);`).join("\n")}
    expect(resolvePermissionSnapshot({ role: QIY_DEFAULT_ROLE, claims: { "qiy-unrelated": "x" } })).toEqual(resolvePermissionSnapshot({ role: QIY_DEFAULT_ROLE }));
  });` : ""}${permissions.database ? `  test("database permission entries are unioned with the role group", () => {
    const expected = resolvePermissionSnapshot({ role: QIY_DEFAULT_ROLE, databasePermissions: [dataset.positiveValue, "qiy-unknown-group"] });
    expect(expected).toEqual(resolvePermissionSnapshot({ role: QIY_DEFAULT_ROLE, databasePermissions: [dataset.positiveValue] }));
    expect(expected.groups).not.toContain("qiy-unknown-group");
  });` : ""}
${permissions.verifications.length ? `  test("verification truth table matches the declared expressions", () => {
    for (const testCase of dataset.cases) {
      const self = { ...dataset.snapshots[testCase.role]!, role: testCase.role };
      expect({ verification: testCase.verification, input: testCase.input, verdict: evaluatePermissionVerification(testCase.verification, self, testCase.input) }).toEqual({ verification: testCase.verification, input: testCase.input, verdict: testCase.expected });
    }
  });

  test("unknown verification names are rejected", () => {
    expect(evaluatePermissionVerification("QiyUnknownVerification", { permissions: [], groups: [], role: QIY_DEFAULT_ROLE }, {})).toEqual({ found: false });
  });` : ""}
});

describe("generated permission HTTP routes", () => {
  test("GET /api/v1/auth/permissions returns the effective snapshot for the bearer", async () => {
    for (const role of Object.keys(dataset.snapshots)) {
      const response = await request("/api/v1/auth/permissions", role);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(dataset.snapshots[role]!);
    }
    expect((await request("/api/v1/auth/permissions", undefined)).status).toBe(401);
  });
${permissions.verifications.length ? `  test("POST /api/v1/auth/verify-permission answers the same verdicts as the provider", async () => {
    for (const testCase of dataset.cases) {
      const response = await request("/api/v1/auth/verify-permission", testCase.role, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verification: testCase.verification, input: testCase.input }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(testCase.expected.allowed ? { allowed: true } : { allowed: false, missing: testCase.expected.missing });
    }
  });

  test("POST /api/v1/auth/verify-permission rejects unknown verifications and malformed input", async () => {
    const post = (body: unknown, role: string = QIY_ADMIN_ROLE) => request("/api/v1/auth/verify-permission", role, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ verification: "QiyUnknownVerification", input: {} })).status).toBe(400);
    ${invalidInputChecks}
    expect((await request("/api/v1/auth/verify-permission", undefined, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verification: "QiyUnknownVerification" }) })).status).toBe(401);
  });

  test("extra verification input fields are ignored", async () => {
    const testCase = dataset.cases[0]!;
    const response = await request("/api/v1/auth/verify-permission", testCase.role, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verification: testCase.verification, input: { ...testCase.input, qiyExtra: "ignored" } }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(testCase.expected.allowed ? { allowed: true } : { allowed: false, missing: testCase.expected.missing });
  });` : ""}
});
${databaseTest ? `\ndescribe("generated database permission source", () => {${databaseTest}});\n` : ""}
describe("generated /auth/me permission metadata", () => {
  test("includes effective permissions and groups without removing the principal fields", async () => {
    const repository = { distribution: async () => [], trend: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
    const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
    const application = await createApp(repositories, authenticate, false);
    for (const role of Object.keys(dataset.snapshots)) {
      const response = await application.handle(new Request("http://localhost/api/v1/auth/me", { headers: { "x-test-role": role } }));
      expect(response.status).toBe(200);
      const payload = await response.json() as { id: string; name: string; role: string; permissions: string[]; groups: string[] };
      expect(payload.id).toBe("00000000-0000-4000-8000-000000000010");
      expect(payload.role).toBe(role);
      expect({ permissions: payload.permissions, groups: payload.groups }).toEqual(dataset.snapshots[role]!);
    }
  });

  test("exposes the declared verification names", async () => {
    expect(permissionVerificationNames).toEqual(${JSON.stringify(permissions.verifications.map((verification) => verification.name).sort())});
    expect(await loadPermissions(principal(QIY_ADMIN_ROLE))).toBeTruthy();
  });
});
`;
}
