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
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain('code_challenge_method", "S256"');
    expect(files["apps/web/app/auth/oidc-client.ts"]).toContain("grant_type: \"authorization_code\"");
    expect(files["apps/web/app/auth/oidc-client.ts"]).not.toContain("client_secret");
    expect(files["apps/web/app/routes.ts"]).toContain('route("auth/callback", "./routes/auth-callback.tsx")');
    expect(files["apps/web/app/root.tsx"]).toContain('location.pathname.startsWith("/auth/")');
    expect(files["apps/web/app/routes/login.tsx"]).not.toContain("粘贴");
    expect(files["apps/web/.env.example"]).toContain("VITE_QIY_AUTHORIZATION_URL=");
    expect(files["apps/web/.env.example"]).toContain("VITE_QIY_CLIENT_ID=qiy-admin-spa");
    expect(files["apps/web/.env.example"]).not.toContain("CLIENT_SECRET");
  });

  test("keeps local password auth separate from OTP challenge login", () => {
    const local = parseQiyProject(`qiy v0; application local-auth { database sqlite {} auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; } enum role { value admin; value operator; value viewer; } entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role role; } }`);
    const files = generateProject(local.database, local.name, { auth: local.auth });
    expect(files["apps/web/app/auth/oidc-client.ts"]).toBeUndefined();
    expect(files["apps/web/app/routes/auth-callback.tsx"]).toBeUndefined();
    const otp = parseQiyProject(`qiy v0; application otp-auth { database sqlite {} auth { provider otp; user users; roleField role; usernameField email; } enum role { value admin; value operator; value viewer; } entity users { field id UUID @id; field email Text @unique; field role role; } }`);
    const otpFiles = generateProject(otp.database, otp.name, { auth: otp.auth });
    expect(otpFiles["apps/server/src/auth/otp.ts"]).toContain("qiy-otp-challenge");
    expect(otpFiles["apps/server/src/auth/otp.ts"]).toContain("QIY_OTP_DELIVERY_URL");
    expect(otpFiles["apps/web/app/routes/login.tsx"]).toContain("/api/v1/auth/otp/request");
    expect(otpFiles["apps/web/app/auth/oidc-client.ts"]).toBeUndefined();
    expect(otpFiles["apps/server/.env.example"]).toContain("QIY_OTP_DELIVERY_URL=");
    expect(() => parseQiyProject(`qiy v0; application invalid-otp { database sqlite {} auth { provider otp; user users; roleField role; } enum role { value admin; value operator; value viewer; } entity users { field id UUID @id; field email Text @unique; field role role; } }`)).toThrow("requires usernameField");
  });
});
