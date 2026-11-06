/** Roles declared in the model and the coarse access each one grants. */
export type QiyRoleAccess = "full" | "write" | "read";

const roles = {"admin":"full","operator":"write","viewer":"read"} as const satisfies Record<string, QiyRoleAccess>;

export type QiyRole = keyof typeof roles;
export const QIY_ROLES: Readonly<Record<QiyRole, QiyRoleAccess>> = roles;
export const QIY_ROLE_NAMES = Object.keys(roles) as QiyRole[];
/** Least-privileged role: the default for accounts created by first-time OAuth onboarding. */
export const QIY_DEFAULT_ROLE: QiyRole = "viewer";
/** First full-access role: the bootstrap administrator. */
export const QIY_ADMIN_ROLE: QiyRole = "admin";

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
