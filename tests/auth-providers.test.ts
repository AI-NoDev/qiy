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
    expect(files["apps/web/app/routes/login.tsx"]).not.toContain("绮樿创");
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


describe("multi-provider authentication", () => {
  const multiModel = `qiy v0; application qiy-multi-provider {
    database sqlite {}
    auth {
      providers oidc, google, okta, auth0, azure-ad-b2c, keycloak, kinde;
      user users;
      subjectField subject;
      roleField role;
      provider google { subjectField googleSubject; }
      provider oidc { subjectField openidField; claim openid; }
    }
    enum role { value admin; value operator; value viewer; }
    entity users {
      field id UUID @id;
      field subject Text @unique;
      field googleSubject Text @nullable;
      field openidField Text @nullable;
      field role role;
    }
    entity notes { field id UUID @id; field title Text; }
  }`;

  test("parses and round-trips the provider list with per-provider mappings", () => {
    const project = parseQiyProject(multiModel);
    expect(project.auth?.providers).toEqual(["oidc", "google", "okta", "auth0", "azure-ad-b2c", "keycloak", "kinde"]);
    expect(project.auth?.provider).toBe("oidc");
    expect(project.auth?.providerMappings).toEqual([
      { provider: "google", subjectField: "googleSubject" },
      { provider: "oidc", subjectField: "openidField", claim: "openid" },
    ]);
    const serialized = serializeQiyProject(project);
    expect(serialized).toContain("providers oidc, google, okta, auth0, azure-ad-b2c, keycloak, kinde;");
    expect(serialized).toContain("provider oidc { subjectField openidField; claim openid; }");
    expect(parseQiyProject(serialized).auth).toEqual(project.auth);
  });

  test("rejects unknown providers, duplicates and otp in a provider list", () => {
    expect(() => parseQiyProject(multiModel.replace("providers oidc, google", "providers oidc, unknown"))).toThrow("Unsupported auth provider unknown");
    expect(() => parseQiyProject(multiModel.replace("providers oidc, google", "providers oidc, google, oidc"))).toThrow("must be unique");
    expect(() => parseQiyProject(multiModel.replace("providers oidc, google", "providers oidc, otp"))).toThrow("cannot include otp");
  });

  test("generates a per-provider verifier and a public provider list endpoint", () => {
    const project = parseQiyProject(multiModel);
    const files = generateProject(project.database, project.name, { auth: project.auth });
    const oidc = files["apps/server/src/auth/oidc.ts"] ?? "";
    expect(oidc).toContain("providerConfigs");
    expect(oidc).toContain("QIY_OIDC_");
    expect(oidc).toContain("providerMappings");
    expect(oidc).toContain('"oidc":{"subjectField":"openidField","claim":"openid"}');
    expect(oidc).toContain("createAuthProviderRoutes");
    expect(oidc).toContain("subject: (payload");
    expect(files["apps/server/src/app.ts"]).toContain("createAuthProviderRoutes");
    const login = files["apps/web/app/routes/login.tsx"] ?? "";
    expect(login).toContain("beginProviderLogin");
    expect(login).toContain("fetchAuthProviders");
    expect(files["apps/web/app/auth/oidc-multi.ts"]).toContain("completeProviderLogin");
  });
});

describe("hybrid password + OAuth authentication", () => {
  const hybridModel = `qiy v0; application qiy-hybrid {
    database sqlite {}
    auth {
      providers local, okta, keycloak;
      user users;
      subjectField subject;
      roleField role;
      usernameField email;
      passwordField passwordHash;
      profileField oauthProfiles;
      provider okta { subjectField oktaSubject; }
      provider keycloak { subjectField keycloakSubject; }
    }
    enum role { value admin; value operator; value viewer; }
    entity users {
      field id UUID @id;
      field subject Text @unique;
      field oktaSubject Text @nullable @unique;
      field keycloakSubject Text @nullable @unique;
      field email Text @unique;
      field displayName Text @nullable;
      field passwordHash Text @nullable;
      field oauthProfiles Text @nullable;
      field role role;
    }
    entity notes { field id UUID @id; field title Text; }
  }`;

  test("parses and round-trips a providers list that mixes password login with OAuth", () => {
    const project = parseQiyProject(hybridModel);
    expect(project.auth?.local).toBe(true);
    expect(project.auth?.providers).toEqual(["okta", "keycloak"]);
    expect(project.auth?.provider).toBe("okta");
    expect(project.auth?.usernameField).toBe("email");
    expect(project.auth?.passwordField).toBe("passwordHash");
    expect(project.auth?.profileField).toBe("oauthProfiles");
    expect(project.auth?.providerMappings).toEqual([
      { provider: "okta", subjectField: "oktaSubject" },
      { provider: "keycloak", subjectField: "keycloakSubject" },
    ]);
    const serialized = serializeQiyProject(project);
    expect(serialized).toContain("providers local, okta, keycloak;");
    expect(serialized).toContain("profileField oauthProfiles;");
    expect(parseQiyProject(serialized).auth).toEqual(project.auth);
  });

  test("normalizes a providers list that only contains local to the password-only mode", () => {
    const source = `qiy v0; application list-local { database sqlite {} auth { providers local; user users; roleField role; usernameField email; passwordField passwordHash; } enum role { value admin; value operator; value viewer; } entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role role; } }`;
    const project = parseQiyProject(source);
    expect(project.auth?.provider).toBe("local");
    expect(project.auth?.providers).toBeUndefined();
    expect(project.auth?.local).toBe(true);
    expect(serializeQiyProject(project)).toContain("provider local;");
  });

  test("generates the hybrid authenticator, account and onboarding endpoints", () => {
    const project = parseQiyProject(hybridModel);
    const files = generateProject(project.database, project.name, { auth: project.auth });
    const oidc = files["apps/server/src/auth/oidc.ts"] ?? "";
    expect(oidc).toContain("createHybridAuthRoutes");
    expect(oidc).toContain("needsOnboarding");
    expect(oidc).toContain("onboardingToken");
    expect(oidc).toContain("QIY_OIDC_DEFAULT_ROLE");
    expect(oidc).toContain('"/oauth/register"');
    expect(oidc).toContain('"/bind"');
    expect(oidc).toContain('"/unbind"');
    expect(oidc).toContain("identitySubject");
    expect(oidc).toContain("last login method");
    expect(oidc).toContain("already linked to another account");
    expect(files["apps/server/src/auth/hybrid.ts"]).toContain("createLocalAuthenticator");
    expect(files["apps/server/src/auth/hybrid.ts"]).toContain("createProviderAuthenticator");
    expect(files["apps/server/src/auth/password.ts"]).toContain("signAccessToken");
    expect(files["apps/server/src/auth/local.ts"]).toContain('post("/login"');
    expect(files["apps/server/src/auth/account.ts"]).toContain('get("/identities"');
    expect(files["apps/server/src/auth/account.ts"]).toContain("loginMethodCount");
    expect(files["apps/server/src/server.ts"]).toContain('from "./auth/hybrid"');
    const app = files["apps/server/src/app.ts"]!;
    expect(app).toContain("createHybridAuthRoutes(authenticate)");
    expect(app).toContain("createAccountRoutes(authenticate)");
    expect(app).toContain("/api/v1/auth/oauth/register");
    expect(app).toContain("/api/v1/auth/exchange");
    expect(files["apps/server/tests/hybrid-auth.test.ts"]).toContain("readOnboardingToken");
    expect(files["apps/server/src/graphql.ts"]).not.toContain("passwordHash: String");
    expect(JSON.parse(files["apps/server/package.json"]!).scripts["auth:bootstrap-admin"]).toBe("bun --env-file=.env.production src/auth/bootstrap-admin.ts");
    const env = files["apps/server/.env.example"]!;
    expect(env).toContain("QIY_AUTH_SECRET=");
    expect(env).toContain("QIY_OIDC_OKTA_ISSUER=");
    expect(env).toContain("QIY_OIDC_KEYCLOAK_JWKS_URL=");
    expect(env).toContain("QIY_OIDC_DEFAULT_ROLE=viewer");
    expect(env).toContain("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS=600000");
    const webLogin = files["apps/web/app/routes/login.tsx"]!;
    expect(webLogin).toContain('import { AuthPage } from "@refinedev/antd"');
    expect(webLogin).toContain("fetchAuthProviders");
    expect(webLogin).toContain("providers={providers}");
    const auth = files["apps/web/app/auth.ts"]!;
    expect(auth).toContain('fetch("/api/v1/auth/login"');
    expect(auth).toContain("providerName");
    expect(auth).toContain("beginProviderLogin");
    expect(files["apps/web/app/auth/oidc-multi.ts"]).toContain("completeProviderCallback");
    expect(files["apps/web/app/auth/oidc-multi.ts"]).toContain("registerOAuthUser");
    expect(files["apps/web/app/auth/oidc-multi.ts"]).toContain("beginProviderBind");
    expect(files["apps/web/app/routes/auth-onboarding.tsx"]).toContain("registerOAuthUser");
    expect(files["apps/web/app/routes/auth-onboarding.tsx"]).toContain("min: 8");
    expect(files["apps/web/app/routes/profile.tsx"]).toContain("beginProviderBind");
    expect(files["apps/web/app/routes/profile.tsx"]).toContain("fetchIdentities");
    expect(files["apps/web/app/routes.ts"]).toContain('route("auth/onboarding", "./routes/auth-onboarding.tsx")');
    expect(files["apps/web/app/routes.ts"]).toContain('route("profile", "./routes/profile.tsx")');
    expect(files["apps/web/app/routes.ts"]).toContain('route("oauth/*"');
    expect(files["apps/web/app/root.tsx"]).toContain('to="/profile"');
    expect(files["apps/web/app/root.tsx"]).toContain('location.pathname.startsWith("/oauth/")');
    expect(files["apps/web/app/auth/oidc-client.ts"]).toBeUndefined();
    expect(files["apps/web/.env.example"]).not.toContain("VITE_QIY_AUTHORIZATION_URL");
  });

  test("generates a profile page for local-only password accounts too", () => {
    const source = `qiy v0; application local-profile { database sqlite {} auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; } enum role { value admin; value operator; value viewer; } entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role role; } }`;
    const project = parseQiyProject(source);
    const files = generateProject(project.database, project.name, { auth: project.auth });
    expect(files["apps/server/src/auth/account.ts"]).toContain('get("/identities"');
    expect(files["apps/server/src/app.ts"]).toContain("createAccountRoutes(authenticate)");
    expect(files["apps/web/app/routes/profile.tsx"]).toContain("fetchIdentities");
    expect(files["apps/web/app/routes/profile.tsx"]).not.toContain("beginProviderBind");
    expect(files["apps/web/app/routes.ts"]).toContain('route("profile", "./routes/profile.tsx")');
    expect(files["apps/web/app/root.tsx"]).toContain('to="/profile"');
    expect(files["apps/web/app/auth/oidc-multi.ts"]).toBeUndefined();
  });

  test("rejects hybrid models whose binding columns cannot store a nullable unique identity", () => {
    const requiredColumn = hybridModel.replace("field oktaSubject Text @nullable @unique;", "field oktaSubject Text @unique;");
    expect(() => { const project = parseQiyProject(requiredColumn); generateProject(project.database, project.name, { auth: project.auth }); }).toThrow("must be nullable");
    const notUnique = hybridModel.replace("field oktaSubject Text @nullable @unique;", "field oktaSubject Text @nullable;");
    expect(() => { const project = parseQiyProject(notUnique); generateProject(project.database, project.name, { auth: project.auth }); }).toThrow("must be unique");
    const noMapping = hybridModel.replace("      provider okta { subjectField oktaSubject; }\n", "");
    expect(() => { const project = parseQiyProject(noMapping); generateProject(project.database, project.name, { auth: project.auth }); }).toThrow("needs its own nullable subjectField mapping");
    const badProfile = hybridModel.replace("field oauthProfiles Text @nullable;", "field oauthProfiles Text;");
    expect(() => { const project = parseQiyProject(badProfile); generateProject(project.database, project.name, { auth: project.auth }); }).toThrow("profileField must be a nullable Text field");
    const uncovered = hybridModel.replace("field displayName Text @nullable;", "field displayName Text @nullable;\n      field orgId UUID;");
    expect(() => { const project = parseQiyProject(uncovered); generateProject(project.database, project.name, { auth: project.auth }); }).toThrow("OAuth onboarding cannot populate required user fields");
  });

  test("requires local username/password fields whenever local is in the providers list", () => {
    expect(() => parseQiyProject(hybridModel.replace("      passwordField passwordHash;\n", ""))).toThrow("requires usernameField and passwordField");
    expect(() => parseQiyProject(hybridModel.replace("      usernameField email;\n", "").replace("      passwordField passwordHash;\n", ""))).toThrow("requires usernameField and passwordField");
  });
});
