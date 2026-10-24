import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db";
import { users } from "../schema";
import type { Authenticator } from "./guard";

interface QiyProviderIdentitySummary { id: string; label: string; bound: boolean; subject?: string; email?: string; name?: string }
interface QiyProfileMetadata { email?: string; name?: string; sub?: string }

const providerIdentities: Array<{ id: string; label: string; subjectField: string }> = [{"id":"okta","label":"Okta","subjectField":"oktaSubject"},{"id":"keycloak","label":"Keycloak","subjectField":"keycloakSubject"},{"id":"google","label":"Google","subjectField":"googleSubject"},{"id":"kinde","label":"Kinde","subjectField":"kindeSubject"},{"id":"azure-ad-b2c","label":"Azure AD B2C","subjectField":"azureSubject"}];
const USERNAME_FIELD = "email";
const PASSWORD_FIELD = "passwordHash";
const ROLE_FIELD = "role";
const PROFILE_FIELD: string | null = "oauthProfiles";
const EMAIL_FIELD: string | null = null;
const DISPLAY_NAME_FIELD: string | null = "displayName";

function readProfiles(record: Record<string, unknown>): Record<string, QiyProfileMetadata> {
  if (!PROFILE_FIELD) return {};
  const raw = record[PROFILE_FIELD];
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try { const parsed = JSON.parse(raw) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, QiyProfileMetadata> : {}; } catch { return {}; }
}

export function createAccountRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/auth" }).get("/identities", async (context: any) => {
    const { request, set } = context;
    const principal = await authenticate(request);
    if (!principal) { set.status = 401; return { error: "Authentication required" }; }
    const rows = await db.select().from(users).where(eq(users.id, principal.id)).limit(1);
    const row = rows[0];
    if (!row) { set.status = 401; return { error: "Unknown account" }; }
    const record = row as unknown as Record<string, unknown>;
    const profiles = readProfiles(record);
    const username = String(record[USERNAME_FIELD] ?? "");
    const email = EMAIL_FIELD ? String(record[EMAIL_FIELD] ?? username) : username;
    const name = DISPLAY_NAME_FIELD ? String(record[DISPLAY_NAME_FIELD] ?? username) : username;
    const passwordSet = Boolean(record[PASSWORD_FIELD]);
    const providers: QiyProviderIdentitySummary[] = providerIdentities.map((provider) => {
      const subject = record[provider.subjectField];
      const metadata = profiles[provider.id];
      return { id: provider.id, label: provider.label, bound: typeof subject === "string" && subject !== "", ...(typeof subject === "string" && subject !== "" ? { subject } : {}), ...(metadata?.email ? { email: metadata.email } : {}), ...(metadata?.name ? { name: metadata.name } : {}) };
    });
    const loginMethodCount = providers.filter((provider) => provider.bound).length + (passwordSet ? 1 : 0);
    return { user: { id: String(record.id), username, email, name, role: String(record[ROLE_FIELD] ?? "") }, password: { set: passwordSet }, providers, loginMethodCount };
  });
}
