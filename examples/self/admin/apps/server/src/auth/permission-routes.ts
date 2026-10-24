import { Elysia, t } from "elysia";
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
