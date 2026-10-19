import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const providers = ["oidc", "oauth2", "sso", "okta", "auth0", "azure-ad-b2c", "keycloak", "google", "kinde"] as const;

function model(provider: typeof providers[number]): string {
  return `qiy v0; application qiy-${provider} {
    database sqlite {}
    auth { provider ${provider}; user users; subjectField externalSubject; roleField role; }
    enum role { value admin; value operator; value viewer; }
    entity users { field id UUID @id; field externalSubject Text @unique; field role role; }
  }`;
}

describe("Refine command palette and identity providers", () => {
  test("ships kbar in the default generated web package", () => {
    const project = parseQiyProject(model("oidc"));
    const files = generateProject(project.database, project.name, { auth: project.auth });
    expect(JSON.parse(files["apps/web/package.json"]!).dependencies["@refinedev/kbar"]).toBe("2.0.1");
    expect(files["apps/web/app/root.tsx"]).toContain("RefineKbarProvider");
    expect(files["apps/web/app/root.tsx"]).toContain("<RefineKbar />");
  });

  for (const provider of providers) test(`round-trips and generates ${provider} through the shared PKCE adapter`, () => {
    const project = parseQiyProject(model(provider));
    expect(project.auth?.provider).toBe(provider);
    expect(parseQiyProject(serializeQiyProject(project)).auth).toEqual(project.auth);
    const files = generateProject(project.database, project.name, { auth: project.auth });
    expect(files["apps/server/src/auth/oidc.ts"]).toContain("createRemoteJWKSet");
    expect(files["apps/server/src/auth/oidc.ts"]).toContain("QIY_OIDC_JWKS_TIMEOUT_MS");
    expect(files["apps/server/src/auth/oidc.ts"]).toContain("QIY_OIDC_JWKS_COOLDOWN_MS");
    expect(files["apps/server/src/auth/oidc.ts"]).toContain("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS");
    expect(files["apps/server/src/auth/oidc.ts"]).toContain("{ timeoutDuration, cooldownDuration, cacheMaxAge }");
    expect(files["apps/server/.env.example"]).toContain("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS=600000");
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain('code_challenge_method", "S256"');
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain("grant_type: \"authorization_code\"");
    expect(files["apps/web/app/auth/oidc-client.ts"]).not.toContain("client_secret");
    // Session lifetime: expiry is tracked and renewal is silent, without keeping a
    // refresh token in browser storage (that belongs in a backend-for-frontend).
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain("expires_in");
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain('expiresAtKey = "qiy.expires_at"');
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain("export function oidcSession(");
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain("export function clearOidcSession(");
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain("export function consumeSilentAttempt(");
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain("export function isSilentRenewFailure(");
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain("state, \"none\")");
    expect(files["apps/web/app/auth/oidc-client.ts"]).not.toContain("refresh_token");
    expect(files["apps/web/app/auth.ts"]).toContain("oidcSession({ skewMs: oidcSessionSkewMs })");
    expect(files["apps/web/app/auth.ts"]).toContain("clearOidcSession()");
    expect(files["apps/web/app/routes/login.tsx"]).toContain("beginOidcSilentRenew");
    expect(files["apps/web/app/routes/login.tsx"]).toContain("consumeSilentAttempt");
    expect(files["apps/web/app/routes/auth-callback.tsx"]).toContain("isSilentRenewFailure");
    expect(files["apps/web/tests/oidc-client.test.ts"]).toContain("tracks token expiry and clears it on logout");
    expect(files["apps/web/tests/oidc-client.test.ts"]).toContain("renews silently once per redirect cycle");
    expect(files["apps/web/app/routes.ts"]).toContain('route("auth/callback", "./routes/auth-callback.tsx")');
    expect(files["apps/web/app/root.tsx"]).toContain('location.pathname.startsWith("/auth/")');
    expect(files["apps/web/app/routes/login.tsx"]).not.toContain("粘贴");
    expect(files["apps/web/.env.example"]).toContain("VITE_QIY_AUTHORIZATION_URL=");
    expect(files["apps/web/.env.example"]).toContain("VITE_QIY_CLIENT_ID=qiy-admin-spa");
    expect(files["apps/web/.env.example"]).not.toContain("CLIENT_SECRET");
  });

  test("guards every generated resource page so direct URLs cannot bypass access control", () => {
    const project = parseQiyProject(`qiy v0; application page-guard { database sqlite {} auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; } enum role { value admin; value operator; value viewer; } entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role role; } entity orders { field id UUID @id; field reference Text; } }`);
    const files = generateProject(project.database, project.name, project);
    const routes = files["apps/web/app/routes.ts"]!;
    for (const [guard, action] of [["guard-list", "list"], ["guard-create", "create"], ["guard-show", "show"], ["guard-edit", "edit"]] as const) {
      expect(routes).toContain(`layout("./routes/${guard}.tsx"`);
      expect(files[`apps/web/app/routes/${guard}.tsx`]).toContain(`<ResourcePageGuard action="${action}" />`);
    }
    expect(routes).toContain('import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";');
    const guard = files["apps/web/app/components/resource-page-guard.tsx"]!;
    expect(guard).toContain("<CanAccess resource={resource} action={action}");
    expect(guard).toContain("<Outlet />");
    expect(guard).toContain('fallback={<Result status="403"');
    // Pages without a resolved resource still render instead of trapping the user.
    expect(guard).toContain("if (!resource) return <Outlet />;");
    expect(files["apps/web/tests/auth.test.ts"]).toContain("decides every resource page action, so route guards cannot be bypassed by URL");
  });

  test("keeps local password auth separate from OTP challenge login", () => {
    const local = parseQiyProject(`qiy v0; application local-auth { database sqlite {} auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; } enum role { value admin; value operator; value viewer; } entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role role; } }`);
    const files = generateProject(local.database, local.name, { auth: local.auth });
    expect(files["apps/web/app/auth/oidc-client.ts"]).toBeUndefined();
    expect(files["apps/web/app/routes/auth-callback.tsx"]).toBeUndefined();
    // The local-auth password column is hidden from the GraphQL schema, so the
    // generated GraphQL test must not select or submit it.
    const graphqlTest = files["apps/server/tests/graphql.test.ts"]!;
    expect(graphqlTest).not.toContain("passwordHash");
    expect(graphqlTest).not.toContain("PasswordHash");
    const otp = parseQiyProject(`qiy v0; application otp-auth { database sqlite {} auth { provider otp; user users; roleField role; usernameField email; } enum role { value admin; value operator; value viewer; } entity users { field id UUID @id; field email Text @unique; field role role; } }`);
    const otpFiles = generateProject(otp.database, otp.name, { auth: otp.auth });
    expect(otpFiles["apps/server/src/auth/otp.ts"]).toContain("qiy-otp-challenge");
    expect(otpFiles["apps/server/src/auth/otp.ts"]).toContain("QIY_OTP_DELIVERY_URL");
    expect(otpFiles["apps/web/app/routes/login.tsx"]).toContain("/api/v1/auth/otp/request");
    expect(otpFiles["apps/web/app/auth/oidc-client.ts"]).toBeUndefined();
    expect(otpFiles["apps/server/.env.example"]).toContain("QIY_OTP_DELIVERY_URL=");
    expect(otpFiles["apps/server/.env.example"]).toContain("QIY_OTP_DELIVERY_TIMEOUT_MS=10000");
    const otpSource = otpFiles["apps/server/src/auth/otp.ts"]!;
    expect(otpSource).toContain("AbortSignal.timeout(timeout)");
    expect(otpSource).toContain("QIY_OTP_DELIVERY_TIMEOUT_MS must be an integer between 100 and 60000");
    expect(otpSource).toContain('errorKey: "auth.otpDeliveryFailed"');
    expect(otpSource).toContain("OTP delivery adapter timed out");
    expect(otpSource).toContain("OTP delivery adapter is unreachable");
    // A failed delivery must not mint a challenge, and the code must never be logged.
    expect(otpSource.indexOf('errorKey: "auth.otpDeliveryFailed"')).toBeLessThan(otpSource.indexOf("const challengeToken = "));
    expect(otpSource).toContain('console.error("OTP delivery failed", { provider: Bun.env.QIY_OTP_DELIVERY_URL, error });');
    // Display names are derived from declared fields, so user entities without
    // displayName/email still produce compiling server code.
    expect(otpSource).toContain("name: String(row.email ?? row.id)");
    expect(otpSource).not.toContain("row.displayName");
    expect(() => parseQiyProject(`qiy v0; application invalid-otp { database sqlite {} auth { provider otp; user users; roleField role; } enum role { value admin; value operator; value viewer; } entity users { field id UUID @id; field email Text @unique; field role role; } }`)).toThrow("requires usernameField");
  });
});
