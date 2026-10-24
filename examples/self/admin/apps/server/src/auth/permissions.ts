import type { Principal } from "./guard";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../schema";

export interface QiyPermissionSnapshot { permissions: string[]; groups: string[] }

/** Permission field name -> permission value. */
const PERMISSION_FIELD_VALUES: Record<string, string> = {"ApiGetUserPermission":"api:getUser","ApiPutUserPermission":"api:putUser","ApiDeleteUserPermission":"api:deleteUser","InventoryReceivePermission":"inventory:receive","InventoryPutawayPermission":"inventory:putaway","InventoryReservePermission":"inventory:reserve","InventoryAdjustPermission":"inventory:adjust","InventoryTransferPermission":"inventory:transfer","PurchaseApprovePermission":"purchasing:approve","SalesShipPermission":"sales:ship","WorkOrderCompletePermission":"workorder:complete","ReportReadPermission":"report:read"};
/** Declared permission values: provider entries are values or group names. */
const PERMISSION_DECLARED_VALUES: readonly string[] = ["api:getUser","api:putUser","api:deleteUser","inventory:receive","inventory:putaway","inventory:reserve","inventory:adjust","inventory:transfer","purchasing:approve","sales:ship","workorder:complete","report:read"];
/** Permission group name -> member permission field or group names. */
const PERMISSION_GROUPS: Record<string, string[]> = {"UserApiPermissionGroup":["ApiGetUserPermission","ApiPutUserPermission"],"ManagerRole":["ApiPutUserPermission","ApiDeleteUserPermission"],"SuperAdminManager":["UserApiPermissionGroup","ManagerRole"],"admin":["SuperAdminManager","InventoryReceivePermission","InventoryPutawayPermission","InventoryReservePermission","InventoryAdjustPermission","InventoryTransferPermission","PurchaseApprovePermission","SalesShipPermission","WorkOrderCompletePermission","ReportReadPermission"],"operator":["InventoryReceivePermission","InventoryPutawayPermission","InventoryReservePermission","InventoryAdjustPermission","InventoryTransferPermission","SalesShipPermission","WorkOrderCompletePermission","ReportReadPermission"],"viewer":["ReportReadPermission"]};
/** Verified id_token claim sources declared with `permission from claim`. */
const PERMISSION_CLAIM_SOURCES: Array<{ provider: string; claim: string }> = [{"provider":"azure-ad-b2c","claim":"roles"},{"provider":"google","claim":"groups"},{"provider":"keycloak","claim":"roles"}];

function splitPermissionEntries(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean))];
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
  let databasePermissions: string[] | undefined;
  try {
    const rows = await db.select({ value: users.permissions }).from(users).where(eq(users.id, principal.id)).limit(1);
    databasePermissions = normalizeDatabasePermissionColumn(rows[0]?.value);
  } catch {
    // A missing row/table must not break /auth/me: the role group and verified
    // claims still apply, and the database source only ever adds permissions.
    databasePermissions = undefined;
  }
  return resolvePermissionSnapshot({ role: principal.role, ...(principal.claims ? { claims: principal.claims } : {}), databasePermissions });
}

export type QiyPermissionVerdict = { allowed: boolean; missing: string[] };
type QiyPermissionInputType = "Text" | "Array<String>";
type QiyPermissionOperand = { kind: "self"; set: "permissions" | "groups" | "role" } | { kind: "input"; name: string } | { kind: "literal"; value: string };
type QiyPermissionExpression =
  | { kind: "comparison"; operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals"; left: QiyPermissionOperand; right: QiyPermissionOperand }
  | { kind: "and"; children: QiyPermissionExpression[] }
  | { kind: "or"; children: QiyPermissionExpression[] }
  | { kind: "not"; expression: QiyPermissionExpression };

const PERMISSION_VERIFICATIONS: Record<string, { inputs: Array<{ name: string; type: QiyPermissionInputType }>; expression: QiyPermissionExpression }> = {"CanAccessUserApi":{"inputs":[{"name":"permission","type":"Array<String>"}],"expression":{"kind":"comparison","operator":"all-in","left":{"kind":"input","name":"permission"},"right":{"kind":"self","set":"permissions"}}},"CanManageUsers":{"inputs":[{"name":"permission","type":"Array<String>"}],"expression":{"kind":"or","children":[{"kind":"comparison","operator":"all-in","left":{"kind":"input","name":"permission"},"right":{"kind":"self","set":"groups"}},{"kind":"comparison","operator":"all-in","left":{"kind":"input","name":"permission"},"right":{"kind":"self","set":"permissions"}}]}},"CanShipOrders":{"inputs":[],"expression":{"kind":"or","children":[{"kind":"comparison","operator":"equals","left":{"kind":"self","set":"role"},"right":{"kind":"literal","value":"admin"}},{"kind":"comparison","operator":"equals","left":{"kind":"self","set":"role"},"right":{"kind":"literal","value":"operator"}}]}},"CanAdjustStock":{"inputs":[{"name":"permission","type":"Text"}],"expression":{"kind":"comparison","operator":"all-in","left":{"kind":"input","name":"permission"},"right":{"kind":"self","set":"permissions"}}}};
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
 * Evaluates one declared verification. Unknown names report `found: false`;
 * invalid input shapes report `error` so the HTTP route can answer 400; extra
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
