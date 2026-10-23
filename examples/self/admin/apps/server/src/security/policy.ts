import { and, eq, gt, gte, inArray, lt, lte, ne, not, notInArray, or } from "drizzle-orm";
import type { Principal } from "../auth/guard";

export type QiyRole = "admin" | "operator" | "viewer";

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

const policies = {"products":{"rows":[],"groups":[],"expressions":[],"masks":[{"field":"unitCost","mode":"redact","roles":["operator","viewer"],"replacement":"***"}],"roles":["admin","operator"],"numericFields":[]}} as Record<string, QiyResourcePolicy>;
const scopeResources = {} as Record<string, { field: string; helper?: string }>;
const scopeHelpers: Record<string, (column: unknown, value: string) => unknown> = {  };
const resourceRoles = {"products":["admin","operator"]} as Record<string, QiyRole[]>;

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
 * without `restrict` blocks is unchanged.
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
