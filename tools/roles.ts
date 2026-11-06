/**
 * Roles: the names a principal's `role` may take and the coarse access each one
 * grants on generated resources. Declared in `auth { roles { ... } }`; a model
 * without the block gets `admin full; operator write; viewer read;`.
 *
 * - `full`  : every resource, including users, system pages, audit history and workers
 * - `write` : list/show/create/edit/delete on business resources
 * - `read`  : list/show on business resources
 *
 * `restrict`, `pages`, masks, realtime and `allow roles` refine access per
 * resource or command; they only reference declared role names.
 */

export type QiyRoleAccess = "full" | "write" | "read";

export interface QiyRoleDeclaration {
  name: string;
  access: QiyRoleAccess;
}

export const QIY_ROLE_ACCESS: readonly QiyRoleAccess[] = ["full", "write", "read"];

export const defaultRoles: readonly QiyRoleDeclaration[] = [
  { name: "admin", access: "full" },
  { name: "operator", access: "write" },
  { name: "viewer", access: "read" },
];

const accessRank: Record<QiyRoleAccess, number> = { read: 0, write: 1, full: 2 };

export function declaredRoles(auth?: { roles?: readonly QiyRoleDeclaration[] }): readonly QiyRoleDeclaration[] {
  return auth?.roles ?? defaultRoles;
}

export function roleNames(auth?: { roles?: readonly QiyRoleDeclaration[] }): string[] {
  return declaredRoles(auth).map((role) => role.name);
}

/** Roles that may write business records (`full` and `write`). */
export function writeRoles(auth?: { roles?: readonly QiyRoleDeclaration[] }): string[] {
  return declaredRoles(auth).filter((role) => role.access !== "read").map((role) => role.name);
}

export function fullAccessRoles(auth?: { roles?: readonly QiyRoleDeclaration[] }): string[] {
  return declaredRoles(auth).filter((role) => role.access === "full").map((role) => role.name);
}

/** The first declared role with the least access: the default for first-time OAuth onboarding. */
export function leastPrivilegedRole(auth?: { roles?: readonly QiyRoleDeclaration[] }): string {
  const roles = declaredRoles(auth);
  return roles.reduce((least, role) => accessRank[role.access] < accessRank[least.access] ? role : least, roles[0]!).name;
}

/** The first declared `full` role: the bootstrap administrator. */
export function primaryAdminRole(auth?: { roles?: readonly QiyRoleDeclaration[] }): string {
  return fullAccessRoles(auth)[0]!;
}

/** Role names the generators need when emitting checks and test principals. */
export interface RoleContext {
  /** Every declared role, in declaration order. */
  names: string[];
  /** The first full-access role. */
  admin: string;
  /** Full- and write-access roles. */
  writers: string[];
  /** Read-only roles. */
  readers: string[];
  /** The first read-only role, if any. */
  reader?: string;
  /** The first role without full access, if any. */
  member?: string;
  /** The least-privileged role. */
  least: string;
}

export function roleContext(auth?: { roles?: readonly QiyRoleDeclaration[] }): RoleContext {
  const roles = declaredRoles(auth);
  return {
    names: roles.map((role) => role.name),
    admin: primaryAdminRole(auth),
    writers: writeRoles(auth),
    readers: roles.filter((role) => role.access === "read").map((role) => role.name),
    reader: roles.find((role) => role.access === "read")?.name,
    member: roles.find((role) => role.access !== "full")?.name,
    least: leastPrivilegedRole(auth),
  };
}

/** Commands without an `allow` rule may be run by every role with write access. */
export function withDefaultCommandRoles<T extends { roles?: string[]; permission?: string[]; verification?: string }>(flows: readonly T[], auth?: { roles?: readonly QiyRoleDeclaration[] }): T[] {
  return flows.map((flow) => flow.roles || flow.permission || flow.verification ? flow : { ...flow, roles: writeRoles(auth) });
}

export function roleAccessTable(auth?: { roles?: readonly QiyRoleDeclaration[] }): Record<string, QiyRoleAccess> {
  return Object.fromEntries(declaredRoles(auth).map((role) => [role.name, role.access]));
}

export function validateRoleDeclarations(roles: readonly QiyRoleDeclaration[]): string[] {
  const errors: string[] = [];
  if (!roles.length) errors.push("Auth roles: declare at least one role");
  const seen = new Set<string>();
  for (const role of roles) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(role.name)) errors.push(`Auth roles: role name ${role.name} must start with a lowercase letter and contain only letters and digits`);
    if (seen.has(role.name)) errors.push(`Auth roles: duplicate role ${role.name}`);
    seen.add(role.name);
    if (!QIY_ROLE_ACCESS.includes(role.access)) errors.push(`Auth roles: role ${role.name} has unsupported access ${role.access}; use full, write or read`);
  }
  if (roles.length && !roles.some((role) => role.access === "full")) errors.push("Auth roles: at least one role needs full access to administer users");
  return errors;
}

/** `api/src/auth/roles.ts` in the generated server. */
export function renderRolesModule(auth?: { roles?: readonly QiyRoleDeclaration[] }): string {
  return `/** Roles declared in the model and the coarse access each one grants. */
export type QiyRoleAccess = "full" | "write" | "read";

const roles = ${JSON.stringify(roleAccessTable(auth))} as const satisfies Record<string, QiyRoleAccess>;

export type QiyRole = keyof typeof roles;
export const QIY_ROLES: Readonly<Record<QiyRole, QiyRoleAccess>> = roles;
export const QIY_ROLE_NAMES = Object.keys(roles) as QiyRole[];
/** Least-privileged role: the default for accounts created by first-time OAuth onboarding. */
export const QIY_DEFAULT_ROLE: QiyRole = ${JSON.stringify(leastPrivilegedRole(auth))};
/** First full-access role: the bootstrap administrator. */
export const QIY_ADMIN_ROLE: QiyRole = ${JSON.stringify(primaryAdminRole(auth))};

export function isQiyRole(value: unknown): value is QiyRole {
  return typeof value === "string" && Object.hasOwn(roles, value);
}

/** Full-access roles administer users, system pages, audit history and workers. */
export function hasFullAccess(role: string): boolean {
  return isQiyRole(role) && QIY_ROLES[role] === "full";
}

/** Full- and write-access roles may create, edit and delete business records. */
export function canWrite(role: string): boolean {
  return isQiyRole(role) && QIY_ROLES[role] !== "read";
}
`;
}
