/**
 * Web renderers for the multi-provider OIDC and hybrid sign-in clients, the
 * account client and the onboarding/profile routes.
 */
export function renderMultiProviderWebClient(): string {
  return `export interface QiyAuthProviderPublic {
  id: string;
  label: string;
  authorizationUrl: string;
  tokenUrl?: string;
  clientId: string;
  scope: string;
  redirectUri?: string;
  logoutUrl?: string;
}

const verifierKey = "qiy.oidc.verifier";
const stateKey = "qiy.oidc.state";
const returnToKey = "qiy.oidc.return_to";
const providerKey = "qiy.oidc.provider";
const accessTokenKey = "qiy.access_token";
const idTokenKey = "qiy.id_token";
const expiresAtKey = "qiy.expires_at";

export async function fetchAuthProviders(fetcher: typeof fetch = fetch): Promise<QiyAuthProviderPublic[]> {
  const response = await fetcher("/api/v1/auth/providers");
  if (!response.ok) throw new Error("Failed to load the configured identity providers");
  const payload = (await response.json()) as { providers?: QiyAuthProviderPublic[] };
  return payload.providers ?? [];
}

function randomValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
}

/** Redirects to the selected provider; the user can choose any configured provider. */
export async function beginProviderLogin(provider: QiyAuthProviderPublic, returnTo = (window.location.pathname.startsWith("/auth/") || window.location.pathname.startsWith("/oauth/")) ? "/" : window.location.pathname + window.location.search): Promise<void> {
  const verifier = randomValue();
  const state = randomValue();
  sessionStorage.setItem(verifierKey, verifier);
  sessionStorage.setItem(stateKey, state);
  sessionStorage.setItem(returnToKey, returnTo);
  sessionStorage.setItem(providerKey, JSON.stringify(provider));
  const redirectUri = provider.redirectUri ?? window.location.origin + "/auth/callback";
  const url = new URL(provider.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", provider.scope || "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url.toString());
}

/** Completes the callback: validates state, exchanges the code and stores the session. */
export async function completeProviderLogin(callbackUrl: URL, fetcher: typeof fetch = fetch): Promise<string> {
  const provider = JSON.parse(sessionStorage.getItem(providerKey) ?? "null") as QiyAuthProviderPublic | null;
  const verifier = sessionStorage.getItem(verifierKey);
  const expectedState = sessionStorage.getItem(stateKey);
  const returnTo = sessionStorage.getItem(returnToKey) ?? "/";
  if (!provider || !verifier || !expectedState) {
    // A second StrictMode/hydration pass after a successful login should land on the app instead of showing an error.
    if (window.localStorage.getItem(accessTokenKey)) return "/";
    throw new Error("No pending login for this provider");
  }
  const error = callbackUrl.searchParams.get("error");
  if (error) throw new Error(callbackUrl.searchParams.get("error_description") ?? error);
  if (callbackUrl.searchParams.get("state") !== expectedState) throw new Error("State mismatch in the provider callback");
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("The provider callback did not contain an authorization code");
  const redirectUri = provider.redirectUri ?? window.location.origin + "/auth/callback";
  // Exchange through the generated server so confidential clients (Google,
  // Auth0, Okta web apps) can use their client secret and browser CORS is not
  // required. The server keeps secrets out of the SPA bundle.
  const response = await fetcher("/api/v1/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: provider.id, code, codeVerifier: verifier, redirectUri }),
  });
  if (!response.ok) throw new Error("The provider token exchange failed");
  const tokens = (await response.json()) as { access_token?: string; id_token?: string; expires_in?: number };
  if (!tokens.access_token) throw new Error("The provider token response did not include an access token");
  window.localStorage.setItem(accessTokenKey, tokens.access_token);
  if (tokens.id_token) window.localStorage.setItem(idTokenKey, tokens.id_token);
  if (typeof tokens.expires_in === "number") window.localStorage.setItem(expiresAtKey, String(Date.now() + tokens.expires_in * 1000));
  for (const key of [verifierKey, stateKey, providerKey, returnToKey]) sessionStorage.removeItem(key);
  return returnTo;
}
`;
}

/**
 * Hybrid browser client: the login page and callback for a project that offers
 * password login plus OAuth providers. Unlike the multi-provider-only client it
 * never stores a provider token: the generated server exchanges the code and
 * returns either a Qiy session token, a signed onboarding token (first login), or
 * a linked-provider confirmation. Only the Qiy session token is kept in
 * localStorage, so the API never has to accept opaque provider tokens.
 */
export function renderHybridWebClient(): string {
  return `export interface QiyAuthProviderPublic {
  id: string;
  label: string;
  authorizationUrl: string;
  tokenUrl?: string;
  clientId: string;
  scope: string;
  redirectUri?: string;
  logoutUrl?: string;
}

export interface QiyOnboardingProfile { sub: string; username?: string; email?: string; name?: string }
export interface QiyOnboardingClaims { provider: string; subject: string; username?: string; email?: string; name?: string }
export interface QiySignInUser { id: string; name: string; role: string }
export interface QiySignInResult {
  accessToken?: string;
  needsOnboarding?: boolean;
  onboardingToken?: string;
  provider?: { id: string; label: string };
  profile?: QiyOnboardingProfile;
  user?: QiySignInUser;
}
export interface QiyPendingOnboarding { token: string; profile: QiyOnboardingProfile; provider: { id: string; label: string } }

const verifierKey = "qiy.oidc.verifier";
const stateKey = "qiy.oidc.state";
const returnToKey = "qiy.oidc.return_to";
const providerKey = "qiy.oidc.provider";
const modeKey = "qiy.oidc.mode";
const accessTokenKey = "qiy.access_token";
const pendingOnboardingKey = "qiy.oauth.onboarding";

function serverSession(): Storage { return window.localStorage; }
function flowState(): Storage { return window.sessionStorage; }

export async function fetchAuthProviders(fetcher: typeof fetch = fetch): Promise<QiyAuthProviderPublic[]> {
  const response = await fetcher("/api/v1/auth/providers");
  if (!response.ok) throw new Error("Failed to load the configured identity providers");
  const payload = (await response.json()) as { providers?: QiyAuthProviderPublic[] };
  return payload.providers ?? [];
}

function randomValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
}

function safeReturnTo(value: string): string { return value.startsWith("/") && !value.startsWith("//") ? value : "/"; }
function defaultReturnTo(): string { return (window.location.pathname.startsWith("/auth/") || window.location.pathname.startsWith("/oauth/")) ? "/" : window.location.pathname + window.location.search; }

function clearPendingFlow(): void {
  for (const key of [verifierKey, stateKey, returnToKey, providerKey, modeKey]) flowState().removeItem(key);
}

/** Clears the Qiy session and any pending OAuth flow state. */
export function clearSession(): void {
  serverSession().removeItem(accessTokenKey);
  flowState().removeItem(pendingOnboardingKey);
  clearPendingFlow();
}

async function beginProviderRedirect(provider: QiyAuthProviderPublic, returnTo: string, mode: "login" | "bind"): Promise<void> {
  const verifier = randomValue();
  const state = randomValue();
  flowState().setItem(verifierKey, verifier);
  flowState().setItem(stateKey, state);
  flowState().setItem(returnToKey, safeReturnTo(returnTo));
  flowState().setItem(providerKey, JSON.stringify(provider));
  flowState().setItem(modeKey, mode);
  const redirectUri = provider.redirectUri ?? window.location.origin + "/auth/callback";
  const url = new URL(provider.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", provider.scope || "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url.toString());
}

/** Starts a password-less provider sign-in. */
export async function beginProviderLogin(provider: QiyAuthProviderPublic, returnTo = defaultReturnTo()): Promise<void> {
  await beginProviderRedirect(provider, returnTo, "login");
}

/** Starts linking an additional provider to the signed-in account. */
export async function beginProviderBind(providerId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const providers = await fetchAuthProviders(fetcher);
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error("That identity provider is not configured on the server");
  await beginProviderRedirect(provider, "/profile", "bind");
}

/**
 * Completes the provider callback. Login mode returns the path to continue to
 * (the app, or /auth/onboarding for a first-time identity); bind mode links the
 * provider to the current account and returns to the profile page.
 */
export async function completeProviderCallback(callbackUrl: URL, fetcher: typeof fetch = fetch): Promise<string> {
  const storedProvider = flowState().getItem(providerKey);
  const provider = storedProvider ? JSON.parse(storedProvider) as QiyAuthProviderPublic : null;
  const verifier = flowState().getItem(verifierKey);
  const expectedState = flowState().getItem(stateKey);
  const returnTo = flowState().getItem(returnToKey) ?? "/";
  const mode = flowState().getItem(modeKey) ?? "login";
  if (!provider || !verifier || !expectedState) {
    // A second StrictMode/hydration pass after a successful login should land on the app instead of showing an error.
    if (serverSession().getItem(accessTokenKey)) return "/";
    throw new Error("No pending sign-in for this provider");
  }
  const providerError = callbackUrl.searchParams.get("error");
  if (providerError) throw new Error(callbackUrl.searchParams.get("error_description") ?? providerError);
  if (callbackUrl.searchParams.get("state") !== expectedState) throw new Error("State mismatch in the provider callback");
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("The provider callback did not contain an authorization code");
  const redirectUri = provider.redirectUri ?? window.location.origin + "/auth/callback";
  if (mode === "bind") {
    const accessToken = serverSession().getItem(accessTokenKey);
    const response = await fetcher("/api/v1/auth/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}) },
      body: JSON.stringify({ provider: provider.id, code, codeVerifier: verifier, redirectUri }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "Linking the identity provider failed");
    clearPendingFlow();
    return "/profile?linked=" + encodeURIComponent(provider.id);
  }
  const response = await fetcher("/api/v1/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: provider.id, code, codeVerifier: verifier, redirectUri }),
  });
  const result = await response.json().catch(() => null) as (QiySignInResult & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error ?? "The provider token exchange failed");
  if (result.needsOnboarding && result.onboardingToken) {
    const pending: QiyPendingOnboarding = { token: result.onboardingToken, profile: result.profile ?? { sub: "" }, provider: result.provider ?? { id: provider.id, label: provider.label } };
    flowState().setItem(pendingOnboardingKey, JSON.stringify(pending));
    clearPendingFlow();
    return "/auth/onboarding?token=" + encodeURIComponent(result.onboardingToken);
  }
  if (!result.accessToken) throw new Error("The server did not return a session token");
  serverSession().setItem(accessTokenKey, result.accessToken);
  clearPendingFlow();
  return safeReturnTo(returnTo);
}

/** Reads the pending onboarding token left by the callback, if any. */
export function readPendingOnboarding(): QiyPendingOnboarding | null {
  const raw = flowState().getItem(pendingOnboardingKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; profile?: unknown; provider?: unknown };
    if (typeof parsed.token !== "string") return null;
    const profile = parsed.profile && typeof parsed.profile === "object" ? parsed.profile as QiyOnboardingProfile : { sub: "" };
    const provider = parsed.provider && typeof parsed.provider === "object" ? parsed.provider as { id: string; label: string } : { id: "oidc", label: "Identity provider" };
    return { token: parsed.token, profile, provider };
  } catch { return null; }
}

/** The onboarding token is signed and verified by the server; the browser only reads it for prefill. */
export function decodeOnboardingToken(token: string): QiyOnboardingClaims | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    if (typeof payload.provider !== "string" || typeof payload.identitySubject !== "string") return null;
    return {
      provider: payload.provider,
      subject: payload.identitySubject,
      ...(typeof payload.username === "string" ? { username: payload.username } : {}),
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    };
  } catch { return null; }
}

/** Creates the local account for a verified provider identity and stores the session. */
export async function registerOAuthUser(input: { onboardingToken: string; username: string; email?: string; password: string }, fetcher: typeof fetch = fetch): Promise<QiySignInResult> {
  const response = await fetcher("/api/v1/auth/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const result = await response.json().catch(() => null) as (QiySignInResult & { error?: string }) | null;
  if (!response.ok || !result?.accessToken) throw new Error(result?.error ?? "The account could not be created");
  serverSession().setItem(accessTokenKey, result.accessToken);
  flowState().removeItem(pendingOnboardingKey);
  return result;
}
`;
}

/** Shared browser client for the personal-center account page (password-only and hybrid). */
export function renderAccountWebClient(): string {
  return `export interface QiyIdentityProvider { id: string; label: string; bound: boolean; subject?: string; email?: string; name?: string }
export interface QiyIdentitiesUser { id: string; username: string; email: string; name: string; role: string }
export interface QiyIdentities { user: QiyIdentitiesUser; password: { set: boolean }; providers: QiyIdentityProvider[]; loginMethodCount: number }

const tokenKey = "qiy.access_token";
function bearer(): Record<string, string> {
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem(tokenKey);
  return token ? { Authorization: "Bearer " + token } : {};
}

/** Reads the signed-in account and every linked sign-in method from the API. */
export async function fetchIdentities(fetcher: typeof fetch = fetch): Promise<QiyIdentities> {
  const response = await fetcher("/api/v1/auth/identities", { headers: bearer() });
  const result = await response.json().catch(() => null) as (QiyIdentities & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error ?? "Could not load the account profile");
  return result;
}

/** Removes one linked provider. The server refuses to remove the last login method. */
export async function unbindProvider(provider: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/v1/auth/unbind", { method: "POST", headers: { "Content-Type": "application/json", ...bearer() }, body: JSON.stringify({ provider }) });
  const result = await response.json().catch(() => null) as { error?: string; ok?: boolean } | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Could not unlink the identity provider");
}

/** Revokes every existing local session for the current account. */
export async function revokeAllSessions(fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/v1/auth/logout-all", { method: "POST", headers: { ...bearer() } });
  const result = await response.json().catch(() => null) as { error?: string; ok?: boolean } | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Could not revoke sessions");
}
`;
}

export function renderOnboardingRoute(options: { usernameLabel: string; hasEmailField: boolean }): string {
  // The username field is either the model's login identifier (email) or a username.
  const usernameLabelKey = options.usernameLabel === "Email" ? "qiy.email" : "qiy.username";
  const emailField = options.hasEmailField
    ? `        <Form.Item name="email" label={translate("qiy.email", {}, "Email")} rules={[{ required: true, type: "email", message: translate("qiy.invalidEmail", {}, "Enter a valid email address") }]}><Input autoComplete="email" /></Form.Item>\n`
    : "";
  return `import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useTranslation } from "@refinedev/core";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { decodeOnboardingToken, registerOAuthUser } from "../auth/oidc-multi";

interface OnboardingValues { username: string; email?: string; password: string; confirmPassword: string }

/**
 * Shown after the first OAuth sign-in for an identity that has no users row.
 * The IdP username/email prefill the form; the user may adjust them and must set
 * a password so the account also works with password login. All copy follows the
 * active interface language through the generated chrome dictionary.
 */
export default function AuthOnboarding() {
  const navigate = useNavigate();
  const { translate } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const claims = token ? decodeOnboardingToken(token) : null;
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const initialUsername = claims?.username ?? claims?.email ?? claims?.subject ?? "";
  const initialEmail = claims?.email ?? "";
  const submit = async (values: OnboardingValues) => {
    setSubmitting(true);
    setError(undefined);
    try {
      await registerOAuthUser({ onboardingToken: token, username: values.username.trim(), email: (values.email ?? values.username).trim(), password: values.password });
      navigate("/", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  };
  if (!token) return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card style={{ width: 480 }}><Alert type="error" showIcon message={translate("qiy.onboardingInvalid", {}, "This onboarding link is invalid or has expired.")} /><Button style={{ marginTop: 16 }} onClick={() => navigate("/auth/login", { replace: true })}>{translate("qiy.backToSignIn", {}, "Back to sign in")}</Button></Card></main>;
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card style={{ width: 480 }}>
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>{translate("qiy.finishAccount", {}, "Finish creating your account")}</Typography.Title>
      <Typography.Text type="secondary">{claims?.provider ? translate("qiy.signedInWith", { provider: claims.provider }) : ""}{translate("qiy.confirmAccount", {}, "Confirm the account details and choose a password.")}</Typography.Text>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <Form layout="vertical" initialValues={{ username: initialUsername, email: initialEmail, password: "", confirmPassword: "" }} onFinish={(values) => void submit(values as OnboardingValues)}>
        <Form.Item name="username" label={translate(${JSON.stringify(usernameLabelKey)}, {}, ${JSON.stringify(options.usernameLabel)})} rules={[{ required: true, message: translate("qiy.fieldRequired", {}, "This field is required") }]}><Input autoComplete="username" /></Form.Item>
${emailField}        <Form.Item name="password" label={translate("qiy.password", {}, "Password")} rules={[{ required: true, min: 8, message: translate("qiy.passwordMin", {}, "Use at least 8 characters") }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="confirmPassword" label={translate("qiy.confirmPassword", {}, "Confirm password")} dependencies={["password"]} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value: string) => value === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error(translate("qiy.passwordMismatch", {}, "Passwords do not match"))) })]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting}>{translate("qiy.createAccount", {}, "Create account and sign in")}</Button>
      </Form>
      <Typography.Text type="secondary">{translate("qiy.alreadyHaveAccount", {}, "Already have an account with a password?")} <Typography.Link onClick={() => navigate("/auth/login", { replace: true })}>{translate("qiy.signInAction", {}, "Sign in")}</Typography.Link> {translate("qiy.linkProviderHint", {}, "Sign in and link this provider from your profile.")}</Typography.Text>
    </Space>
  </Card></main>;
}
`;
}

/**
 * Personal center: account details, password status and (for hybrid projects)
 * the linked sign-in methods with bind/unbind controls. Works for local-only
 * accounts too; the provider list is simply empty there.
 */
export function renderProfileRoute(options: { hasProviderBinding: boolean; roleEnumName?: string }): string {
  const bindImport = options.hasProviderBinding ? 'import { beginProviderBind } from "../auth/oidc-multi";\n' : "";
  // The role tag is model data: resolve it through the declared role enum's value keys.
  const roleKey = options.roleEnumName ? `qiy.enums.${options.roleEnumName}.values.` : undefined;
  const roleTag = roleKey
    ? `<Tag color="blue">{translate(${JSON.stringify(roleKey)} + identities.user.role, {}, identities.user.role)}</Tag>`
    : `<Tag color="blue">{identities.user.role}</Tag>`;
  const providerSection = options.hasProviderBinding
    ? `    <Card title={translate("qiy.linkedMethods", {}, "Linked sign-in methods")}>
      <List<QiyIdentityProvider> dataSource={identities.providers} locale={{ emptyText: translate("qiy.noProviders", {}, "No OAuth providers configured") }} renderItem={(provider) => <List.Item actions={provider.bound
        ? [<Popconfirm key="unbind" title={translate("qiy.unlinkTitle", { provider: provider.label })} description={canRemove(provider) ? translate("qiy.unlinkKeep", {}, "You can link it again later.") : translate("qiy.unlinkLast", {}, "This is your last sign-in method.")} disabled={!canRemove(provider)} onConfirm={() => void unbind(provider)}><Button danger loading={busy === provider.id} disabled={!canRemove(provider)}>{translate("qiy.unbind", {}, "Unbind")}</Button></Popconfirm>]
        : [<Button key="bind" type="primary" loading={busy === provider.id} onClick={() => void bind(provider)}>{translate("qiy.bind", {}, "Bind")}</Button>]}>
        <List.Item.Meta title={<Space><Tag color={provider.bound ? "green" : "default"}>{provider.label}</Tag>{provider.bound ? <Typography.Text type="secondary">{translate("qiy.linked", {}, "Linked")}</Typography.Text> : null}</Space>} description={provider.bound ? <Typography.Text type="secondary">{provider.email ?? provider.name ?? provider.subject ?? translate("qiy.linked", {}, "Linked")}</Typography.Text> : <Typography.Text type="secondary">{translate("qiy.notLinked", {}, "Not linked yet")}</Typography.Text>} />
      </List.Item>} />
    </Card>
`
    : "";
  return `import { useLogout, useNotification, useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Descriptions, List, Popconfirm, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
${bindImport}import { fetchIdentities, revokeAllSessions, unbindProvider, type QiyIdentities, type QiyIdentityProvider } from "../auth/account";

export default function Profile() {
  const [searchParams] = useSearchParams();
  const { open } = useNotification();
  const { translate } = useTranslation();
  const { mutate: logout } = useLogout();
  const [identities, setIdentities] = useState<QiyIdentities>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const load = async () => {
    try { setIdentities(await fetchIdentities()); setError(undefined); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  useEffect(() => { void load(); }, []);
  const linked = searchParams.get("linked");
  useEffect(() => { if (linked) open?.({ type: "success", message: translate("qiy.linkedToast", { provider: linked }) }); }, [linked, open, translate]);
  const unbind = async (provider: QiyIdentityProvider) => {
    setBusy(provider.id);
    try { await unbindProvider(provider.id); await load(); open?.({ type: "success", message: translate("qiy.unlinkedToast", { provider: provider.label }) }); }
    catch (caught) { open?.({ type: "error", message: caught instanceof Error ? caught.message : String(caught) }); }
    finally { setBusy(undefined); }
  };
  const revokeAll = async () => {
    setBusy("revoke-all");
    try { await revokeAllSessions(); open?.({ type: "success", message: translate("qiy.revokeAllDone", {}, "All sessions revoked") }); logout(); }
    catch (caught) { open?.({ type: "error", message: caught instanceof Error ? caught.message : String(caught) }); setBusy(undefined); }
  };
  ${options.hasProviderBinding ? `const bind = async (provider: QiyIdentityProvider) => {
    setBusy(provider.id);
    try { await beginProviderBind(provider.id); }
    catch (caught) { open?.({ type: "error", message: caught instanceof Error ? caught.message : String(caught) }); setBusy(undefined); }
  };` : ""}
  if (error && !identities) return <Alert type="error" showIcon message={error} />;
  if (!identities) return <Spin />;
  const passwordSet = identities.password.set;
  const canRemove = (provider: QiyIdentityProvider) => passwordSet || identities.providers.some((other) => other.id !== provider.id && other.bound);
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Typography.Title level={2} style={{ margin: 0 }}>{translate("qiy.profileTitle", {}, "Profile")}</Typography.Title>
    <Card title={translate("qiy.account", {}, "Account")} extra={<Space><Popconfirm title={translate("qiy.revokeAllConfirm", {}, "Sign out every device? Existing local sessions stop working immediately.")} onConfirm={() => void revokeAll()} okText={translate("qiy.revokeAll", {}, "Sign out all devices")} cancelText={translate("qiy.cancel", {}, "Cancel")}><Button danger loading={busy === "revoke-all"}>{translate("qiy.revokeAll", {}, "Sign out all devices")}</Button></Popconfirm><Button onClick={() => logout()}>{translate("qiy.signOut", {}, "Sign out")}</Button></Space>}>
      <Descriptions column={1} items={[
        { key: "username", label: translate("qiy.username", {}, "Username"), children: identities.user.username },
        { key: "email", label: translate("qiy.email", {}, "Email"), children: identities.user.email },
        { key: "name", label: translate("qiy.name", {}, "Name"), children: identities.user.name },
        { key: "role", label: translate("qiy.role", {}, "Role"), children: ${roleTag} },
        { key: "password", label: translate("qiy.password", {}, "Password"), children: passwordSet ? <Tag color="green">{translate("qiy.passwordSet", {}, "Set")}</Tag> : <Tag>{translate("qiy.passwordNotSet", {}, "Not set")}</Tag> },
      ]} />
    </Card>
${providerSection}  </Space>;
}
`;
}
