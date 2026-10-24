/**
 * Permission model: atomic permission fields, permission groups (which are also
 * the roles), provider sources (verified OAuth claims and a database column),
 * and permission verification expressions.
 *
 * The model is deliberately closed and statically checkable: every group member
 * names a declared permission field or group, and every verification comparison
 * names `self.*`, a declared input, or a string literal. The generated server
 * mirrors the same resolution and evaluation rules in `auth/permissions.ts`; the
 * functions here are the authoritative definition used by the parser, the
 * generators and the repository tests.
 */

/** One atomic permission: a stable identifier plus the value carried by claims/DB rows. */
export interface QiyPermissionFieldIR {
  name: string;
  value: string;
  label?: string;
  labelKey?: string;
  comment?: string;
  commentKey?: string;
}

/** How a group declares its members: a list block or a union expression (`A & B`). */
export type QiyPermissionGroupForm = "list" | "union";

/**
 * A permission group. `members` are permission field names or group names; the
 * `&` union operator is normalized into the same member list because a group is
 * always the union of its members (`&` means union here, not intersection).
 */
export interface QiyPermissionGroupIR {
  name: string;
  members: string[];
  form: QiyPermissionGroupForm;
  label?: string;
  labelKey?: string;
  comment?: string;
  commentKey?: string;
}

/** OAuth claim source: for one configured provider, read one verified id_token claim. */
export interface QiyPermissionClaimIR {
  provider: string;
  claim: string;
}

/**
 * Database source: one text column on the authenticated user row. The column
 * stores a JSON string array (or a comma/space separated string); each entry is
 * a permission value or a group name.
 */
export interface QiyPermissionDatabaseIR {
  entity: string;
  field: string;
}

export type QiyPermissionInputType = "Text" | "Array<String>";

export interface QiyPermissionVerificationInputIR {
  name: string;
  type: QiyPermissionInputType;
}

export type QiyPermissionOperandIR =
  | { kind: "self"; set: "permissions" | "groups" | "role" }
  | { kind: "input"; name: string }
  | { kind: "literal"; value: string };

/**
 * Comparison operators. Long forms are the canonical syntax, short forms are
 * accepted by the parser and normalized to the same operator:
 * `some in` / `some included in`, `all in` / `all included in`,
 * `not some in` / `not some included in`, `not all in` / `not all included in`,
 * `=` and `!=`. Every operand normalizes to a set of strings.
 */
export type QiyPermissionComparisonOperator = "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals";

export type QiyPermissionExpressionIR =
  | { kind: "comparison"; operator: QiyPermissionComparisonOperator; left: QiyPermissionOperandIR; right: QiyPermissionOperandIR }
  | { kind: "and"; children: QiyPermissionExpressionIR[] }
  | { kind: "or"; children: QiyPermissionExpressionIR[] }
  | { kind: "not"; expression: QiyPermissionExpressionIR };

export interface QiyPermissionVerificationIR {
  name: string;
  inputs: QiyPermissionVerificationInputIR[];
  expression: QiyPermissionExpressionIR;
  label?: string;
  labelKey?: string;
  comment?: string;
  commentKey?: string;
}

export interface QiyPermissionModel {
  fields: QiyPermissionFieldIR[];
  groups: QiyPermissionGroupIR[];
  claims?: QiyPermissionClaimIR[];
  database?: QiyPermissionDatabaseIR;
  verifications: QiyPermissionVerificationIR[];
}

export const selfPermissionSets = ["permissions", "groups", "role"] as const;

export function isPermissionModelEmpty(model: QiyPermissionModel | undefined): boolean {
  if (!model) return true;
  return model.fields.length === 0 && model.groups.length === 0 && (model.claims?.length ?? 0) === 0 && !model.database && model.verifications.length === 0;
}

export function permissionFieldValue(model: QiyPermissionModel, name: string): string | undefined {
  return model.fields.find((field) => field.name === name)?.value;
}

/** All declared permission values, in declaration order (deduplicated). */
export function declaredPermissionValues(model: QiyPermissionModel): string[] {
  return [...new Set(model.fields.map((field) => field.value))];
}

/**
 * Expands permission field names and group names into the set of permission
 * values and group names they imply. Unknown names expand to nothing; cycles are
 * rejected by `validatePermissionModel`, so this is safe to call on a validated model.
 */
export function expandPermissionNames(model: QiyPermissionModel, names: readonly string[]): { permissions: string[]; groups: string[] } {
  const values = new Set<string>();
  const groups = new Set<string>();
  const byName = new Map(model.groups.map((group) => [group.name, group]));
  const expand = (name: string, visiting: Set<string>): void => {
    const field = model.fields.find((candidate) => candidate.name === name);
    if (field) { values.add(field.value); return; }
    const group = byName.get(name);
    if (!group || visiting.has(name)) return;
    visiting.add(name);
    groups.add(name);
    for (const member of group.members) expand(member, visiting);
    visiting.delete(name);
  };
  for (const name of names) expand(name, new Set());
  return { permissions: [...values].sort(), groups: [...groups].sort(), };
}

/** `allow permission A, B;` requires every expanded permission value. */
export function requiredPermissionValues(model: QiyPermissionModel, names: readonly string[]): string[] {
  return expandPermissionNames(model, names).permissions;
}

/** Role groups: groups whose name equals a role string (`admin`, `operator`, `viewer`). */
export function roleGroupNames(model: QiyPermissionModel): string[] {
  return model.groups.filter((group) => ["admin", "operator", "viewer"].includes(group.name)).map((group) => group.name);
}

/** Expansion graph used by the generated runtime module. */
export function permissionExpansionTables(model: QiyPermissionModel): {
  fieldValues: Record<string, string>;
  groups: Record<string, string[]>;
} {
  return {
    fieldValues: Object.fromEntries(model.fields.map((field) => [field.name, field.value])),
    groups: Object.fromEntries(model.groups.map((group) => [group.name, group.members])),
  };
}

/** Input shapes accepted by a verification: `Text` is one string, `Array<String>` a string list. */
export function normalizeVerificationInputValue(type: QiyPermissionInputType, value: unknown): string[] | undefined {
  if (type === "Text") return typeof value === "string" ? [value] : undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
  return [...(value as string[])];
}

/**
 * Normalizes a claim value into permission entries. Values may be a JSON array,
 * one comma/space separated string, or a single string; other claim value types
 * (numbers, booleans, null) carry no permission entries.
 */
export function normalizeClaimPermissionValues(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
  if (typeof value !== "string") return [];
  return splitPermissionEntries(value);
}

/**
 * Normalizes the `permission from database field` column. The documented contract
 * is a text/JSON column holding a string array; comma/space separated text is
 * accepted as a convenience, and malformed content fails closed (ignored).
 */
export function normalizeDatabasePermissionColumn(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? [...new Set(parsed.filter((entry): entry is string => typeof entry === "string"))] : [];
    } catch {
      return [];
    }
  }
  return splitPermissionEntries(trimmed);
}

function splitPermissionEntries(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean))];
}

/** Effective permissions for one authenticated principal. */
export interface QiyPermissionSnapshot {
  permissions: string[];
  groups: string[];
}

/**
 * Resolves the effective permissions for a principal. Resolution order is a
 * union (never subtraction), so every configured source can only add access:
 *
 * 1. the role group: a permission group whose name equals `role` (admin/operator/viewer)
 * 2. `permission from database field` entries: permission values or group names
 * 3. `permission from claim` entries from the verified id_token claims
 *
 * Unknown claim/database entries are ignored. Local password sessions have no
 * claims, so they resolve from the role group and database column only.
 */
export function resolvePermissionSnapshot(
  model: QiyPermissionModel,
  source: { role: string; claims?: Record<string, string | number | boolean | null | string[]>; databasePermissions?: readonly string[] },
): QiyPermissionSnapshot {
  const values = new Set<string>();
  const groups = new Set<string>();
  const byName = new Map(model.groups.map((group) => [group.name, group]));
  const fieldValuesByName = new Map(model.fields.map((field) => [field.name, field.value]));
  // Provider entries are permission VALUES or GROUP NAMES, so direct value
  // entries are recognized separately from permission field names.
  const declaredValues = new Set(model.fields.map((field) => field.value));
  const expand = (name: string, visiting: Set<string>): void => {
    const fieldValue = fieldValuesByName.get(name);
    if (fieldValue !== undefined) { values.add(fieldValue); return; }
    const group = byName.get(name);
    if (!group || visiting.has(name)) return;
    visiting.add(name);
    groups.add(name);
    for (const member of group.members) expand(member, visiting);
    visiting.delete(name);
  };
  if (byName.has(source.role)) expand(source.role, new Set());
  for (const entry of source.databasePermissions ?? []) {
    if (declaredValues.has(entry)) values.add(entry);
    else if (byName.has(entry)) expand(entry, new Set());
  }
  for (const claim of model.claims ?? []) {
    const raw = source.claims?.[claim.claim];
    if (raw === undefined) continue;
    for (const entry of normalizeClaimPermissionValues(raw)) {
      if (declaredValues.has(entry)) values.add(entry);
      else if (byName.has(entry)) expand(entry, new Set());
    }
  }
  return { permissions: [...values].sort(), groups: [...groups].sort() };
}

/* -------------------------------------------------------------------------- */
/* Verification expressions                                                    */
/* -------------------------------------------------------------------------- */

export type QiyPermissionOperandSet = string[];

export interface QiyPermissionEvaluationContext {
  self: { permissions: readonly string[]; groups: readonly string[]; role: string };
  input: Record<string, string | readonly string[]>;
}

export interface QiyPermissionVerdict {
  allowed: boolean;
  missing: string[];
}

function permissionOperandValues(operand: QiyPermissionOperandIR, context: QiyPermissionEvaluationContext): QiyPermissionOperandSet {
  if (operand.kind === "self") {
    if (operand.set === "role") return [context.self.role];
    return [...(operand.set === "permissions" ? context.self.permissions : context.self.groups)];
  }
  if (operand.kind === "literal") return [operand.value];
  const value = context.input[operand.name];
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value as string];
}

/** Compares two sets with the declared operator; `missing` is the diagnostic payload. */
export function comparePermissionSets(operator: QiyPermissionComparisonOperator, left: readonly string[], right: readonly string[]): { allowed: boolean; missing: string[] } {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const difference = [...leftSet].filter((entry) => !rightSet.has(entry)).sort();
  switch (operator) {
    case "all-in": return { allowed: difference.length === 0, missing: difference };
    case "some-in": {
      const shared = [...leftSet].filter((entry) => rightSet.has(entry));
      // A failing `some in` means none of the left entries are present.
      return { allowed: shared.length > 0, missing: shared.length > 0 ? [] : difference };
    }
    case "not-all-in": return { allowed: difference.length > 0, missing: [] };
    case "not-some-in": {
      const shared = [...leftSet].filter((entry) => rightSet.has(entry)).sort();
      return { allowed: shared.length === 0, missing: shared };
    }
    case "equals": {
      const symmetric = [...new Set([...difference, ...[...rightSet].filter((entry) => !leftSet.has(entry))])].sort();
      return { allowed: symmetric.length === 0, missing: symmetric };
    }
    case "not-equals": return { allowed: !(difference.length === 0 && rightSet.size === leftSet.size), missing: [] };
  }
}

/**
 * Evaluates a verification expression. `missing` aggregates the diagnostics of
 * the comparisons that evaluated false (a best-effort explanation; `allowed` is
 * the authoritative verdict).
 */
export function evaluatePermissionExpression(expression: QiyPermissionExpressionIR, context: QiyPermissionEvaluationContext): QiyPermissionVerdict {
  const evaluate = (node: QiyPermissionExpressionIR): { allowed: boolean; missing: string[] } => {
    if (node.kind === "comparison") {
      return comparePermissionSets(node.operator, permissionOperandValues(node.left, context), permissionOperandValues(node.right, context));
    }
    if (node.kind === "not") {
      const inner = evaluate(node.expression);
      // Negation inverts the verdict; a failing negation has no "missing" set.
      return { allowed: !inner.allowed, missing: inner.allowed ? [] : inner.missing };
    }
    const results = node.children.map(evaluate);
    if (node.kind === "and") {
      const failed = results.filter((result) => !result.allowed);
      return { allowed: failed.length === 0, missing: failed.flatMap((result) => result.missing) };
    }
    return { allowed: results.some((result) => result.allowed), missing: results.some((result) => result.allowed) ? [] : results.flatMap((result) => result.missing) };
  };
  const verdict = evaluate(expression);
  return { allowed: verdict.allowed, missing: verdict.allowed ? [] : [...new Set(verdict.missing)].sort() };
}

/** Evaluates a declared verification by name, validating the runtime input shape. */
export function evaluatePermissionVerification(
  model: QiyPermissionModel,
  name: string,
  self: QiyPermissionEvaluationContext["self"],
  input: Record<string, unknown>,
): { found: false } | { found: true; allowed: boolean; missing: string[] } | { found: true; error: string } {
  const verification = model.verifications.find((candidate) => candidate.name === name);
  if (!verification) return { found: false };
  const normalized: Record<string, string[]> = {};
  for (const declared of verification.inputs) {
    const value = input[declared.name];
    if (value === undefined) return { found: true, error: `Verification ${name} requires input field ${declared.name}` };
    const normalizedValue = normalizeVerificationInputValue(declared.type, value);
    if (!normalizedValue) return { found: true, error: `Verification ${name} input field ${declared.name} must be ${declared.type === "Text" ? "a string" : "an array of strings"}` };
    normalized[declared.name] = normalizedValue;
  }
  const verdict = evaluatePermissionExpression(verification.expression, { self, input: normalized });
  return { found: true, allowed: verdict.allowed, missing: verdict.missing };
}

/* -------------------------------------------------------------------------- */
/* Syntax formatting                                                           */
/* -------------------------------------------------------------------------- */

const comparisonText: Record<QiyPermissionComparisonOperator, string> = {
  "all-in": "all included in",
  "some-in": "some included in",
  "not-all-in": "not all included in",
  "not-some-in": "not some included in",
  equals: "=",
  "not-equals": "!=",
};

function permissionOperandText(operand: QiyPermissionOperandIR): string {
  if (operand.kind === "self") return `self.${operand.set}`;
  if (operand.kind === "input") return `input.${operand.name}`;
  return JSON.stringify(operand.value);
}

/** Canonical `.qiy` text for a verification expression (parenthesized for safe re-parsing). */
export function formatPermissionExpression(expression: QiyPermissionExpressionIR): string {
  if (expression.kind === "comparison") {
    return `${permissionOperandText(expression.left)} ${comparisonText[expression.operator]} ${permissionOperandText(expression.right)}`;
  }
  if (expression.kind === "not") {
    const inner = formatPermissionExpression(expression.expression);
    return expression.expression.kind === "comparison" ? `! ( ${inner} )` : `! ( ${inner} )`;
  }
  return expression.children.map((child) => {
    const inner = formatPermissionExpression(child);
    return child.kind === "comparison" ? inner : `( ${inner} )`;
  }).join(` ${expression.kind === "and" ? "&&" : "||"} `);
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export interface PermissionValidationOptions {
  /** OAuth/OIDC providers configured in the auth block. */
  oauthProviders: readonly string[];
  /** All configured (non-local) providers, used to reject local/otp claim sources. */
  allProviders?: readonly string[];
  /** Database entities, for `permission from database field <entity>.<field>`. */
  entities: ReadonlyArray<{ name: string; tableName: string; fields: ReadonlyArray<{ name: string; type: string; nullable?: boolean }> }>;
  /** Auth user entity table name, when authentication is generated. */
  userEntity?: string;
  /** Generated authentication is required for the whole permission model. */
  hasAuth: boolean;
}

/**
 * Validates the permission model. Errors are returned as messages with the same
 * `Context: detail` shape as the parser so they can be joined and surfaced.
 */
export function validatePermissionModel(model: QiyPermissionModel, options: PermissionValidationOptions): string[] {
  const errors: string[] = [];
  const fieldNames = new Set<string>();
  const fieldValues = new Set<string>();
  for (const field of model.fields) {
    if (fieldNames.has(field.name)) errors.push(`Permission field ${field.name}: duplicate declaration`);
    fieldNames.add(field.name);
    if (!field.value.trim()) errors.push(`Permission field ${field.name}: value cannot be empty`);
    if (fieldValues.has(field.value)) errors.push(`Permission field ${field.name}: duplicate value ${field.value}`);
    fieldValues.add(field.value);
    if (/\s/.test(field.value)) errors.push(`Permission field ${field.name}: value cannot contain whitespace (${field.value})`);
  }
  const groupNames = new Set<string>();
  for (const group of model.groups) {
    if (fieldNames.has(group.name)) errors.push(`Permission group ${group.name}: name already used by a permission field`);
    if (groupNames.has(group.name)) errors.push(`Permission group ${group.name}: duplicate declaration`);
    groupNames.add(group.name);
  }
  for (const group of model.groups) {
    if (!group.members.length) errors.push(`Permission group ${group.name}: requires at least one member`);
    const seen = new Set<string>();
    for (const member of group.members) {
      if (seen.has(member)) errors.push(`Permission group ${group.name}: duplicate member ${member}`);
      seen.add(member);
      if (!fieldNames.has(member) && !groupNames.has(member)) errors.push(`Permission group ${group.name}: unknown member ${member}`);
      if (member === group.name) errors.push(`Permission group ${group.name}: cannot reference itself`);
    }
  }
  // Group reference cycles cannot be expanded deterministically.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const groupByName = new Map(model.groups.map((group) => [group.name, group]));
  const visit = (name: string, path: string[]): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) { errors.push(`Permission group ${path[0]}: cyclic group reference ${[...path, name].join(" -> ")}`); return; }
    const group = groupByName.get(name);
    if (!group) return;
    visiting.add(name);
    for (const member of group.members) visit(member, [...path, name]);
    visiting.delete(name);
    visited.add(name);
  };
  for (const group of model.groups) visit(group.name, []);

  if (!options.hasAuth && !isPermissionModelEmpty(model)) errors.push("Permission declarations require a generated auth block");
  const configuredOAuth = new Set(options.oauthProviders);
  const configuredAll = new Set(options.allProviders ?? options.oauthProviders);
  const seenClaims = new Set<string>();
  for (const claim of model.claims ?? []) {
    if (!configuredOAuth.has(claim.provider)) errors.push(`Permission claim source ${claim.provider}: provider is not a configured OAuth/OIDC provider`);
    if (claim.provider === "local" || claim.provider === "otp") errors.push(`Permission claim source ${claim.provider}: local and otp sessions do not carry claims`);
    if (configuredAll.has(claim.provider) && !configuredOAuth.has(claim.provider)) errors.push(`Permission claim source ${claim.provider}: provider does not emit verified claims`);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(claim.claim)) errors.push(`Permission claim source ${claim.provider}: claim name ${claim.claim} is not a plain claim name`);
    const key = `${claim.provider}:${claim.claim}`;
    if (seenClaims.has(key)) errors.push(`Permission claim source ${claim.provider}: duplicate claim ${claim.claim}`);
    seenClaims.add(key);
  }
  if (model.database) {
    const entity = options.entities.find((candidate) => candidate.name === model.database!.entity || candidate.tableName === model.database!.entity);
    if (!entity) errors.push(`Permission database source: unknown entity ${model.database.entity}`);
    else {
      const field = entity.fields.find((candidate) => candidate.name === model.database!.field);
      if (!field) errors.push(`Permission database source: unknown field ${model.database.entity}.${model.database.field}`);
      else if (field.type !== "Text") errors.push(`Permission database source: ${model.database.entity}.${model.database.field} must be a Text column holding a permission array`);
    }
    if (options.userEntity && entity && entity.tableName !== options.userEntity) {
      errors.push(`Permission database source: ${model.database.entity} is not the auth user entity ${options.userEntity}`);
    }
  }
  const verificationNames = new Set<string>();
  for (const verification of model.verifications) {
    if (fieldNames.has(verification.name) || groupNames.has(verification.name)) errors.push(`Permission verification ${verification.name}: name already used by a permission field or group`);
    if (verificationNames.has(verification.name)) errors.push(`Permission verification ${verification.name}: duplicate declaration`);
    verificationNames.add(verification.name);
    const inputNames = new Set<string>();
    for (const input of verification.inputs) {
      if (inputNames.has(input.name)) errors.push(`Permission verification ${verification.name}: duplicate input ${input.name}`);
      inputNames.add(input.name);
      if (input.name === "self") errors.push(`Permission verification ${verification.name}: input name self is reserved`);
    }
    errors.push(...validatePermissionExpression(verification.expression, verification.name, inputNames));
  }
  return errors;
}

export function validatePermissionExpression(expression: QiyPermissionExpressionIR, context: string, inputNames: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const validateOperand = (operand: QiyPermissionOperandIR, node: QiyPermissionExpressionIR): void => {
    if (operand.kind === "input" && !inputNames.has(operand.name)) errors.push(`Permission verification ${context}: unknown input ${operand.name}`);
    if (operand.kind === "self" && !selfPermissionSets.includes(operand.set)) errors.push(`Permission verification ${context}: unknown self set ${operand.set}`);
    if (node.kind === "comparison" && node.operator === "equals" && operand.kind === "literal") {
      // Set equality with one literal is legal but rarely intended; keep it supported.
    }
  };
  const visit = (node: QiyPermissionExpressionIR): void => {
    if (node.kind === "comparison") {
      validateOperand(node.left, node);
      validateOperand(node.right, node);
      if (["some-in", "all-in", "not-some-in", "not-all-in"].includes(node.operator) && node.left.kind === "self" && node.left.set === "role" && node.right.kind === "self" && node.right.set === "role") {
        errors.push(`Permission verification ${context}: role membership comparison requires a non-role set`);
      }
      return;
    }
    if (node.kind === "not") { visit(node.expression); return; }
    if (!node.children.length) errors.push(`Permission verification ${context}: empty logical expression`);
    for (const child of node.children) visit(child);
  };
  visit(expression);
  return errors;
}
