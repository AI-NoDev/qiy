import type { DatabaseIR, FieldIR } from "./database-ir";
import { renderAppTemplate } from "./admin-template";
import { validateDatabaseIR } from "./database-ir";
import type { QiyProject } from "./qiy-project";

const oidcAuthProviders = new Set(["oidc", "oauth2", "sso", "okta", "auth0", "azure-ad-b2c", "keycloak", "google", "kinde"]);
const authProviderLabels: Record<string, string> = {
  oidc: "OpenID Connect",
  oauth2: "OAuth 2.0",
  sso: "Enterprise SSO",
  okta: "Okta",
  auth0: "Auth0",
  "azure-ad-b2c": "Azure AD B2C",
  keycloak: "Keycloak",
  google: "Google",
  kinde: "Kinde",
  otp: "One-time password",
};

type WebOptions = Pick<QiyProject, "mode" | "integration" | "ui" | "messages" | "apiClient" | "menuGroups" | "dashboardMetrics" | "realtime" | "auth" | "workflows" | "dataflows" | "actions" | "restrictions" | "pages" | "scopes"> & { readOnly?: boolean };
type GeneratedAction = {
  name: string;
  roles?: string[];
  resource: string;
  placements: Array<"list" | "show">;
  batch?: boolean;
  label: string;
  labelKey?: string;
  condition?: { field: string; operator: "==" | "!="; value: string };
  target:
    | { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string }
    | { kind: "dataflow"; dataflow: string; roles: string[]; confirm?: string; confirmKey?: string; idempotency: boolean; url: string; idInput: string; inputs: Array<{ name: string; type: string; required: boolean; comment?: string }> };
};

function resourceFields(database: DatabaseIR, menuGroups: NonNullable<QiyProject["menuGroups"]>, realtime?: QiyProject["realtime"], pages: NonNullable<QiyProject["pages"]> = []): string {
  const enumByName = new Map((database.enums ?? []).map((enumeration) => [enumeration.name, enumeration.values]));
  const entityByName = new Map(database.entities.map((entity) => [entity.name, entity]));
  const parentByResource = new Map(menuGroups.flatMap((group) => group.resources.map((resource) => [resource, `menu-${group.name}`] as const)));
  const liveModeByResource = new Map((realtime?.resources ?? []).map((subscription) => [subscription.resource, realtime!.mode] as const));
  // Page-level field layout: a field with roles is only rendered for those roles.
  const fieldRolesByResource = new Map(pages.filter((page) => page.fields?.length).map((page) => [page.resource, new Map(page.fields!.map((entry) => [entry.field, entry.roles]))]));
  return JSON.stringify(database.entities.map((entity) => ({
    name: entity.tableName,
    apiName: entity.name,
    label: entity.label ?? entity.name,
    ...(entity.comment !== undefined && { comment: entity.comment }),
    ...(entity.commentKey !== undefined && { commentKey: entity.commentKey }),
    icon: entity.icon ?? (entity.name.toLowerCase().includes("user") ? "UserOutlined" : entity.name.toLowerCase().includes("order") ? "ShoppingOutlined" : entity.name.toLowerCase().includes("warehouse") ? "DatabaseOutlined" : "TableOutlined"),
    liveMode: liveModeByResource.get(entity.tableName) ?? "off",
    ...(parentByResource.has(entity.tableName) && { menuParent: parentByResource.get(entity.tableName) }),
    ...(database.relations?.some((relation) => relation.toEntity === entity.name) && { relatedResources: database.relations.filter((relation) => relation.toEntity === entity.name).map((relation) => ({ resource: entityByName.get(relation.fromEntity)!.tableName, field: relation.fromField, label: entityByName.get(relation.fromEntity)!.label ?? entityByName.get(relation.fromEntity)!.name })) }),
    fields: entity.fields.map((field) => {
      const relation = (database.relations ?? []).find((candidate) => candidate.fromEntity === entity.name && candidate.fromField === field.name);
      const target = relation && entityByName.get(relation.toEntity);
      return {
      name: field.name,
      label: field.label ?? field.name,
      ...(field.comment !== undefined && { comment: field.comment }),
      ...(field.commentKey !== undefined && { commentKey: field.commentKey }),
      type: field.type,
      nullable: Boolean(field.nullable),
      primaryKey: Boolean(field.primaryKey),
      visible: field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      listVisible: field.listVisible ?? field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      formVisible: field.formVisible ?? field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      showVisible: field.showVisible ?? field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      sortable: field.sortable ?? true,
      filterable: field.filterable ?? true,
      filterModes: field.filterModes ?? (field.enumName ? ["eq"] : field.type === "Text" ? ["contains", "startsWith", "endsWith", "eq"] : ["eq", "gt", "gte", "lt", "lte", "between", "in"]),
      ...((field.type === "File" || field.type === "Files") && { uploadMode: field.uploadMode ?? "binary", maxBytes: field.maxBytes ?? 25 * 1024 * 1024, mimeTypes: field.mimeTypes ?? ["*/*"], maxFiles: field.type === "Files" ? field.maxFiles ?? 6 : 1 }),
      ...(field.enumName && { enumName: field.enumName, enumValues: enumByName.get(field.enumName) ?? [] }),
      ...(target && { relation: { resource: target.tableName, labelField: target.fields.find((candidate) => ["name", "title", "displayName", "code"].includes(candidate.name))?.name ?? "id" } }),
      ...(field.icon && { icon: field.icon }),
      ...(fieldRolesByResource.get(entity.tableName)?.has(field.name) && { roles: fieldRolesByResource.get(entity.tableName)!.get(field.name) }),
      ...(field.type === "Vector" && { dimension: field.dimension }),
    }; }),
  })), null, 2);
}

function editable(field: FieldIR): boolean { return !field.primaryKey && field.type !== "Vector"; }

function renderMultiProviderWebClient(): string {
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
export async function beginProviderLogin(provider: QiyAuthProviderPublic, returnTo = window.location.pathname + window.location.search): Promise<void> {
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
  for (const key of [verifierKey, stateKey, providerKey, returnToKey]) sessionStorage.removeItem(key);
  if (!provider || !verifier || !expectedState) throw new Error("No pending login for this provider");
  const error = callbackUrl.searchParams.get("error");
  if (error) throw new Error(callbackUrl.searchParams.get("error_description") ?? error);
  if (callbackUrl.searchParams.get("state") !== expectedState) throw new Error("State mismatch in the provider callback");
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("The provider callback did not contain an authorization code");
  const redirectUri = provider.redirectUri ?? window.location.origin + "/auth/callback";
  const response = await fetcher(provider.tokenUrl ?? "", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: provider.clientId, code, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
  });
  if (!response.ok) throw new Error("The provider token exchange failed");
  const tokens = (await response.json()) as { access_token?: string; id_token?: string; expires_in?: number };
  if (!tokens.access_token) throw new Error("The provider token response did not include an access token");
  window.localStorage.setItem(accessTokenKey, tokens.access_token);
  if (tokens.id_token) window.localStorage.setItem(idTokenKey, tokens.id_token);
  if (typeof tokens.expires_in === "number") window.localStorage.setItem(expiresAtKey, String(Date.now() + tokens.expires_in * 1000));
  return returnTo;
}
`;
}

export function generateWeb(database: DatabaseIR, options: WebOptions = {}): Record<string, string> {
  const ui = options.ui ?? { library: "antd", theme: "blue", themes: ["blue", "purple", "green", "orange", "red"], colorMode: "system", allowThemeSwitch: true, allowColorModeSwitch: true } as const;
  if (ui.library !== "antd") throw new Error(`Unsupported UI library ${ui.library}; only antd is implemented`);
  const treeEntities = Object.fromEntries([...new Set((options.scopes ?? []).flatMap((scope) => scope.tree ? [[scope.tree.entity, scope.tree.parentField] as const] : []))].map(([entity, parentField]) => [entity, { parentField, labelField: "name" }]));
  const usesOidcAuth = Boolean(options.auth && oidcAuthProviders.has(options.auth.provider));
  const usesOtpAuth = options.auth?.provider === "otp";
  const authProviderLabel = options.auth ? authProviderLabels[options.auth.provider] ?? options.auth.provider : "";
  const integrationAuth = options.mode === "integration" && options.integration?.authTransport !== "none";
  const usesAuth = Boolean(options.auth || integrationAuth);
  const resourceRolePolicies = (options.restrictions ?? []).filter((restriction) => restriction.roles?.length).map((restriction) => ({ resource: restriction.resource, roles: restriction.roles }));
  const resourcePolicyDeclaration = resourceRolePolicies.length ? `const resourcePolicies: Array<{ resource: string; roles: string[] }> = ${JSON.stringify(resourceRolePolicies)};\n` : "";
  // The generated access-control test must describe this model's own resources and
  // allow lists; hardcoding demo resource names fails for restricted projects.
  // Mirrors the generated provider: admin and operator may mutate non-`users` resources,
  // viewers are read-only, and a resource allow list narrows every action.
  const roleActions: Record<string, string[]> = { admin: ["list", "show", "create", "edit", "delete"], operator: ["list", "show", "create", "edit", "delete"], viewer: ["list", "show"] };
  const modelResources = database.entities.map((entity) => entity.name);
  // Prefer a business resource: the generated provider treats user administration as
  // admin-only, so deriving expectations from it would need a special case everywhere.
  const candidateResources = modelResources.filter((name) => name !== options.auth?.userEntity);
  const policyResource = candidateResources.find((name) => resourceRolePolicies.some((policy) => policy.resource === name)) ?? candidateResources[0] ?? modelResources[0];
  const roleExpectations = (role: string, anonymous = false): string[] => {
    if (!policyResource) return [];
    const policy = resourceRolePolicies.find((item) => item.resource === policyResource);
    const page = (options.pages ?? []).find((item) => item.resource === policyResource);
    const adminOnly = policyResource === options.auth?.userEntity;
    const allowed = !anonymous && (adminOnly ? role === "admin" : policy?.roles ? (policy.roles as string[]).includes(role) : true);
    // A page rule narrows (or widens) the per-action expectation for its resource.
    const expected = (action: string) => {
      const pageRule = page?.actions.find((entry) => entry.action === action);
      if (pageRule) return allowed && (pageRule.roles as string[]).includes(role);
      return allowed && (adminOnly ? role === "admin" : (roleActions[role] ?? []).includes(action));
    };
    return ["list", "show", "create", "edit", "delete"].map((action) => `  expect((await qiyAccessControlProvider.can({ resource: ${JSON.stringify(policyResource)}, action: "${action}" })).can).toBe(${expected(action)});`);
  };
  const resourcePolicyCheck = resourceRolePolicies.length ? `const resourcePolicy = resourcePolicies.find((policy) => policy.resource === resource); if (resourcePolicy && !resourcePolicy.roles.includes(identity.role ?? "")) return { can: false, reason: "Resource access is restricted" }; ` : "";
  // Page-level rules refine the role model per page action; the API guard enforces
  // the same table, so hiding a button here matches an actual denial there.
  const pageRuleEntries = (options.pages ?? []).flatMap((page) => page.actions.map((entry) => ({ resource: page.resource, action: entry.action, roles: entry.roles })));
  const pageRuleDeclaration = pageRuleEntries.length ? `const pageRules: Array<{ resource: string; action: string; roles: string[] }> = ${JSON.stringify(pageRuleEntries)};\n` : "";
  const pageRuleCheck = pageRuleEntries.length ? `const pageRule = pageRules.find((rule) => rule.resource === resource && rule.action === action); if (pageRule) return pageRule.roles.includes(identity.role ?? "") ? { can: true, reason: "Page access is allowed" } : { can: false, reason: "Page access is restricted" }; ` : "";
  const requiresAuthShell = usesAuth;
  const usesRealtime = Boolean(options.realtime);
  // GraphQL apps keep Ably for live updates and add the SSE subscription transport
  // on the server, so realtime no longer requires the REST data provider.
  const usesGraphqlSubscriptions = usesRealtime && (options.apiClient ?? "rest") === "graphql";
  const errors = validateDatabaseIR(database);
  const menuGroups = options.menuGroups ?? [];
  const groupNames = new Set<string>();
  const assignedResources = new Set<string>();
  const resourceNames = database.entities.map((entity) => entity.tableName);
  const actionNames = new Set<string>();
  const dashboardNames = new Set<string>();
  const iconNames = [...new Set([
    "AppstoreOutlined", "DashboardOutlined", "DatabaseOutlined", "ShoppingOutlined", "TableOutlined", "UserOutlined",
    ...database.entities.map((entity) => entity.icon).filter((icon): icon is string => Boolean(icon)),
    ...database.entities.flatMap((entity) => entity.fields.map((field) => field.icon)).filter((icon): icon is string => Boolean(icon)),
    ...(database.enums ?? []).flatMap((enumeration) => enumeration.values.map((item) => item.icon)).filter((icon): icon is string => Boolean(icon)),
    ...menuGroups.map((group) => group.icon).filter((icon): icon is string => Boolean(icon)),
    ...(options.dashboardMetrics ?? []).map((metric) => metric.icon).filter((icon): icon is string => Boolean(icon)),
  ])].sort();
  for (const icon of iconNames) if (!/^[A-Z][a-zA-Z0-9]*Outlined$/.test(icon)) errors.push(`Invalid Ant Design icon ${icon}`);
  for (const metric of options.dashboardMetrics ?? []) {
    if (!/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(metric.name) || dashboardNames.has(metric.name)) errors.push(`Dashboard metric ${metric.name}: invalid or duplicate name`);
    dashboardNames.add(metric.name);
    if (!resourceNames.includes(metric.resource)) errors.push(`Dashboard metric ${metric.name}: unknown resource ${metric.resource}`);
    if (![8, 12, 24].includes(metric.span)) errors.push(`Dashboard metric ${metric.name}: span must be 8, 12 or 24`);
    if (metric.type === "distribution") {
      const entity = database.entities.find((item) => item.tableName === metric.resource);
      if (!metric.groupBy || !entity?.fields.some((field) => field.name === metric.groupBy && field.enumName)) errors.push(`Dashboard metric ${metric.name}: distribution requires an enum groupBy field`);
    }
    if (metric.type === "trend") {
      const entity = database.entities.find((item) => item.tableName === metric.resource);
      if (!metric.groupBy || !entity?.fields.some((field) => field.name === metric.groupBy && field.type === "DateTime")) errors.push(`Dashboard metric ${metric.name}: trend requires a DateTime groupBy field`);
      if (!Number.isInteger(metric.days) || metric.days! < 1 || metric.days! > 365) errors.push(`Dashboard metric ${metric.name}: days must be between 1 and 365`);
    }
    if (metric.type === "aggregate") {
      const entity = database.entities.find((item) => item.tableName === metric.resource);
      if (!metric.field || !entity?.fields.some((field) => field.name === metric.field && ["Integer", "Decimal", "Money"].includes(field.type))) errors.push(`Dashboard metric ${metric.name}: aggregate requires a numeric field`);
      if (!metric.agg || !["sum", "avg", "min", "max"].includes(metric.agg)) errors.push(`Dashboard metric ${metric.name}: aggregate requires agg sum, avg, min or max`);
    }
    if (metric.type !== "aggregate" && (metric.field !== undefined || metric.agg !== undefined)) errors.push(`Dashboard metric ${metric.name}: field and agg require aggregate type`);
    if (metric.type !== "trend" && metric.days !== undefined) errors.push(`Dashboard metric ${metric.name}: days requires trend type`);
  }
  for (const group of menuGroups) {
    if (!/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(group.name) || groupNames.has(group.name)) errors.push(`Menu group ${group.name}: invalid or duplicate name`);
    groupNames.add(group.name);
    for (const resource of group.resources) {
      if (!resourceNames.includes(resource)) errors.push(`Menu group ${group.name}: unknown resource ${resource}`);
      if (assignedResources.has(resource)) errors.push(`Menu group ${group.name}: duplicate resource ${resource}`);
      assignedResources.add(resource);
    }
  }
  for (const action of options.actions ?? []) {
    if (!/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(action.name) || actionNames.has(action.name)) errors.push(`Action ${action.name}: invalid or duplicate name`);
    actionNames.add(action.name);
    const entity = database.entities.find((candidate) => candidate.tableName === action.resource || candidate.name === action.resource);
    if (!entity) errors.push(`Action ${action.name}: unknown resource ${action.resource}`);
    if (!action.placements.length || new Set(action.placements).size !== action.placements.length) errors.push(`Action ${action.name}: placements must be unique and non-empty`);
    if (action.target.kind === "dataflow") {
      const target = action.target;
      const flow = options.dataflows?.find((candidate) => candidate.name === target.dataflow);
      if (!flow) errors.push(`Action ${action.name}: unknown dataflow ${target.dataflow}`);
      else if (entity && !flow.context.some((binding) => binding.entity === entity.name)) errors.push(`Action ${action.name}: dataflow ${flow.name} does not load resource ${entity.tableName}`);
    } else if (!/^\/[a-z0-9_-]+(?:\/(?:[a-z0-9_-]+|:[a-z][a-zA-Z0-9_]*))*$/.test(action.target.path) || !action.target.path.includes(":id")) {
      errors.push(`Action ${action.name}: navigate path must be a safe absolute route containing :id`);
    }
  }
  for (const group of menuGroups) {
    if (group.parent && !groupNames.has(group.parent)) errors.push(`Menu group ${group.name}: unknown parent ${group.parent}`);
    const seen = new Set([group.name]);
    let parent = group.parent;
    while (parent && !seen.has(parent)) { seen.add(parent); parent = menuGroups.find((candidate) => candidate.name === parent)?.parent; }
    if (parent && seen.has(parent)) errors.push(`Menu group ${group.name}: cyclic parent`);
  }
  if (!database.entities.length) errors.push("V0 dashboard requires at least one entity");
  for (const entity of database.entities) {
    if (!entity.fields.some((field) => field.primaryKey && field.name === "id" && field.type === "UUID")) errors.push(`${entity.name}: V0 dashboard requires a UUID id field`);
    if (!options.readOnly && entity.fields.some((field) => field.type === "Vector" && !field.nullable)) errors.push(`${entity.name}: V0 dashboard cannot edit a required Vector field`);
    for (const field of options.readOnly ? [] : entity.fields) {
      if (!field.primaryKey && !field.nullable && field.type !== "Vector" && !(field.formVisible ?? field.visible ?? true)) errors.push(`${entity.name}.${field.name}: required field cannot be hidden from the create form`);
    }
    if (!options.readOnly && !entity.fields.some(editable)) errors.push(`${entity.name}: V0 dashboard requires an editable field`);
    if (!/^[a-z][a-z0-9_-]*$/.test(entity.tableName)) errors.push(`${entity.name}: route path must be lowercase and URL-safe`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const template = renderAppTemplate("web", "web");
  const root = template["web/app/root.tsx"]!;
  const show = template["web/app/routes/show.tsx"]!;
  const hasRelatedResources = (database.relations ?? []).some((relation) => database.entities.some((entity) => entity.name === relation.toEntity));
  const hasOrderWorkflow = options.workflows?.includes("orderInventory") ?? false;
  if (hasOrderWorkflow && (database.dialect !== "postgresql" || !["orders", "orderItems", "inventoryItems"].every((name) => database.entities.some((entity) => entity.name === name)))) throw new Error("orderInventory workflow requires PostgreSQL and orders, orderItems, and inventoryItems entities");
  const dashboardMetrics = options.dashboardMetrics?.length ? options.dashboardMetrics : database.entities.map((entity) => ({ name: entity.name, resource: entity.tableName, label: entity.label ?? entity.name, icon: entity.icon, span: 8 as const }));
  const distributionEntity = database.entities.find((entity) => entity.fields.some((field) => field.enumName));
  const distributionField = distributionEntity?.fields.find((field) => field.enumName);
  const trendEntity = database.entities.find((entity) => entity.fields.some((field) => field.type === "DateTime"));
  const trendField = trendEntity?.fields.find((field) => field.type === "DateTime");
  const actionDefinitions: GeneratedAction[] = (options.actions ?? []).map((action) => {
    if (action.target.kind === "navigate") return { ...action, resource: database.entities.find((entity) => entity.name === action.resource)?.tableName ?? action.resource, target: action.target };
    const target = action.target;
    const flow = options.dataflows!.find((candidate) => candidate.name === target.dataflow)!;
    const entity = database.entities.find((candidate) => candidate.tableName === action.resource || candidate.name === action.resource)!;
    const binding = flow.context.find((candidate) => candidate.entity === entity.name)!;
    const source = binding.id.split(":", 2)[1]!;
    return {
      ...action,
      resource: entity.tableName,
      target: {
        ...target,
        url: `/api/v1/commands/${flow.name}${action.batch ? "/batch" : ""}`,
        idempotency: flow.idempotency?.required === true,
        roles: flow.roles ?? ["admin", "operator"],
        idInput: source.split(".", 2)[1]!,
        inputs: flow.input.map((input) => ({ name: input.name, type: input.type, required: input.required, comment: input.comment, commentKey: input.commentKey, ...(database.enums?.some((enumeration) => enumeration.name === input.type) ? { options: database.enums.find((enumeration) => enumeration.name === input.type)!.values.map((value) => ({ value: value.name, label: value.label ?? value.name })) } : {}) })),
      },
    };
  });
  const actionPolicies = actionDefinitions.flatMap((action) => action.target.kind === "dataflow" ? [{ resource: action.resource, action: action.name, roles: action.target.roles }] : action.roles ? [{ resource: action.resource, action: action.name, roles: action.roles }] : []);
  const generated: Record<string, string> = {
    ...template,
    "web/app/ui/theme-config.ts": `export const qiyUiConfig = ${JSON.stringify(ui, null, 2)} as const;\n`,
    "web/app/root.tsx": root
      .replace("__QIY_AUTH_IMPORT__", usesAuth ? (options.auth ? 'import { qiyAccessControlProvider, qiyAuthProvider } from "./auth";\nimport { Authenticated } from "@refinedev/core";\nimport { Navigate, useLocation } from "react-router";' : 'import { qiyIntegrationAuthProvider } from "./host/auth";\nimport { Authenticated } from "@refinedev/core";\nimport { Navigate, useLocation } from "react-router";') : "")
      .replace("__QIY_AUTH_PROPS__", usesAuth ? (options.auth ? "authProvider={qiyAuthProvider} accessControlProvider={qiyAccessControlProvider}" : "authProvider={qiyIntegrationAuthProvider}") : "")
      .replace("__QIY_AUTH_LOCATION__", requiresAuthShell ? 'const location = useLocation(); // legacy login check: location.pathname === "/auth/login"' : "")
      .replace("__QIY_LAYOUT_START__", requiresAuthShell ? '{location.pathname.startsWith("/auth/") ? <Outlet /> : <Authenticated key="protected" fallback={<Navigate to="/auth/login" replace />}> ' : "")
      .replace("__QIY_LAYOUT_END__", requiresAuthShell ? "</Authenticated>}" : ""),
    "web/app/routes/show.tsx": show
      .replace("__QIY_ORDER_IMPORT__", [hasOrderWorkflow ? 'import { OrderWorkflowActions } from "../features/orders/order-actions";' : "", hasRelatedResources ? 'import { RelatedRecords } from "../components/related-records";' : "", actionDefinitions.length ? 'import { BusinessActions } from "../components/business-actions";' : ""].filter(Boolean).join("\n"))
      .replace("__QIY_ORDER_ACTIONS__", [hasOrderWorkflow ? '{resource.name === "orders" && result && id && <OrderWorkflowActions id={id} status={String(result.status ?? "")} />}' : "", hasRelatedResources ? '{result && id && (resource.relatedResources ?? []).map((relation) => <RelatedRecords key={relation.resource + relation.field} relation={relation} recordId={id} />)}' : "", actionDefinitions.length ? '{id && result && <BusinessActions resource={resource.name} placement="show" record={result} />}' : ""].join("")),
    ...(actionDefinitions.length ? {
      "web/app/actions.ts": `type QiyActionCondition = { field: string; operator: "==" | "!="; value: string };
type QiyActionBase = { name: string; resource: string; placements: Array<"list" | "show">; batch?: boolean; label: string; labelKey?: string; roles?: string[]; condition?: QiyActionCondition };
export type QiyActionDefinition = QiyActionBase & ({ target: { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string } } | { target: { kind: "dataflow"; dataflow: string; roles: string[]; confirm?: string; confirmKey?: string; idempotency: boolean; url: string; idInput: string; inputs: Array<{ name: string; type: string; required: boolean; comment?: string; commentKey?: string; options?: Array<{ value: string; label: string }> }> } });
export const qiyActions: QiyActionDefinition[] = ${JSON.stringify(actionDefinitions, null, 2)};
export function actionMatchesRecord(action: QiyActionDefinition, record: Record<string, unknown>) { if (!action.condition) return true; if (!Object.prototype.hasOwnProperty.call(record, action.condition.field) || record[action.condition.field] == null) return false; const matches = record[action.condition.field] === action.condition.value; return action.condition.operator === "==" ? matches : !matches; }
export function actionsFor(resource: string, placement: "list" | "show", record: Record<string, unknown>) { return qiyActions.filter((action) => !action.batch && action.resource === resource && action.placements.includes(placement) && actionMatchesRecord(action, record)); }
export function batchActionsFor(resource: string) { return qiyActions.filter((action) => action.batch && action.resource === resource && action.placements.includes("list") && action.target.kind === "dataflow"); }
export function hasBatchActions(resource: string) { return batchActionsFor(resource).length > 0; }
`,
      "web/app/components/business-actions.tsx": `import { CanAccess, useCustomMutation, useInvalidate, useNotification, useTranslation } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Select, Space } from "antd";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { actionsFor, batchActionsFor, type QiyActionDefinition } from "../actions";

function CommandAction({ action, resource, recordId }: { action: QiyActionDefinition; resource: string; recordId: string }) {
  const { translate } = useTranslation();
  const { open: notify } = useNotification();
  const [open, setOpen] = useState(false); const [form] = Form.useForm(); const { mutateAsync, mutation } = useCustomMutation(); const invalidate = useInvalidate(); const queryClient = useQueryClient();
  const pendingRequest = useRef<{ payload: string; key: string } | null>(null);
  if (action.target.kind !== "dataflow") return null;
  const target = action.target; const fields = target.inputs.filter((field) => field.name !== target.idInput && field.required);
  const actionLabel = action.labelKey ? translate(action.labelKey, {}, action.label) : action.label;
  const confirmation = target.confirmKey ? translate(target.confirmKey, {}, target.confirm) : target.confirm;
  const run = async (values: Record<string, unknown> = {}) => {
    const body = Object.fromEntries(target.inputs.map((field) => [field.name, field.name === target.idInput ? recordId : values[field.name]]));
    const payload = JSON.stringify(body);
    if (!pendingRequest.current || pendingRequest.current.payload !== payload) pendingRequest.current = { payload, key: crypto.randomUUID() };
    try {
      await mutateAsync({ url: target.url, method: "post", successNotification: false, errorNotification: false, values: body, ...(target.idempotency ? { meta: { idempotencyKey: pendingRequest.current.key } } : {}) });
      pendingRequest.current = null;
      setOpen(false); form.resetFields(); notify?.({ type: "success", message: translate("notifications.success", {}, "Successful"), description: actionLabel });
      await invalidate({ resource, id: recordId, invalidates: ["detail", "list"] });
      await queryClient.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).toLowerCase().includes("audit") });
    } catch (error) { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  };
  const button = <Button type="link" loading={mutation.isPending} onClick={fields.length ? () => setOpen(true) : confirmation ? undefined : () => void run()}>{actionLabel}</Button>;
  return <CanAccess resource={resource} action={action.name} params={{ id: recordId }}>{fields.length ? <>{button}<Modal open={open} title={actionLabel} okText={actionLabel} confirmLoading={mutation.isPending} onCancel={() => setOpen(false)} onOk={() => form.submit()}>{confirmation && <p>{confirmation}</p>}<Form form={form} layout="vertical" onFinish={(values) => void run(values)}>{fields.map((field) => <Form.Item key={field.name} name={field.name} label={field.commentKey ? translate(field.commentKey, {}, field.comment ?? field.name) : field.comment ?? field.name} rules={[{ required: true }]} valuePropName={field.type === "Boolean" ? "checked" : "value"}>{field.options ? <Select options={field.options} /> : field.type === "Boolean" ? <Checkbox /> : field.type === "Integer" || field.type === "Decimal" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>)}</Form></Modal></> : confirmation ? <Popconfirm title={confirmation} onConfirm={() => void run()}>{button}</Popconfirm> : button}</CanAccess>;
}

function BatchCommandAction({ action, resource, recordIds, onComplete }: { action: QiyActionDefinition; resource: string; recordIds: string[]; onComplete(): void }) {
  const { translate } = useTranslation(); const { open: notify } = useNotification(); const [open, setOpen] = useState(false); const [form] = Form.useForm(); const { mutateAsync, mutation } = useCustomMutation(); const invalidate = useInvalidate(); const queryClient = useQueryClient(); const pendingRequest = useRef<{ payload: string; key: string } | null>(null);
  if (action.target.kind !== "dataflow") return null;
  const target = action.target; const fields = target.inputs.filter((field) => field.name !== target.idInput && field.required); const actionLabel = action.labelKey ? translate(action.labelKey, {}, action.label) : action.label; const confirmation = target.confirmKey ? translate(target.confirmKey, {}, target.confirm) : target.confirm;
  const run = async (values: Record<string, unknown> = {}) => { const items = recordIds.map((recordId) => Object.fromEntries(target.inputs.map((field) => [field.name, field.name === target.idInput ? recordId : values[field.name]]))); const body = { items }; const payload = JSON.stringify(body); if (!pendingRequest.current || pendingRequest.current.payload !== payload) pendingRequest.current = { payload, key: crypto.randomUUID() }; try { await mutateAsync({ url: target.url, method: "post", successNotification: false, errorNotification: false, values: body, meta: { idempotencyKey: pendingRequest.current.key } }); pendingRequest.current = null; setOpen(false); form.resetFields(); onComplete(); notify?.({ type: "success", message: translate("notifications.success", {}, "Successful"), description: actionLabel }); await invalidate({ resource, invalidates: ["list"] }); await queryClient.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).toLowerCase().includes("audit") }); } catch (error) { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); } };
  const button = <Button loading={mutation.isPending} onClick={fields.length ? () => setOpen(true) : confirmation ? undefined : () => void run()}>{actionLabel} ({recordIds.length})</Button>;
  return <CanAccess resource={resource} action={action.name} params={{ ids: recordIds }}>{fields.length ? <>{button}<Modal open={open} title={actionLabel} okText={actionLabel} confirmLoading={mutation.isPending} onCancel={() => setOpen(false)} onOk={() => form.submit()}>{confirmation && <p>{confirmation}</p>}<Form form={form} layout="vertical" onFinish={(values) => void run(values)}>{fields.map((field) => <Form.Item key={field.name} name={field.name} label={field.commentKey ? translate(field.commentKey, {}, field.comment ?? field.name) : field.comment ?? field.name} rules={[{ required: true }]} valuePropName={field.type === "Boolean" ? "checked" : "value"}>{field.options ? <Select options={field.options} /> : field.type === "Boolean" ? <Checkbox /> : field.type === "Integer" || field.type === "Decimal" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>)}</Form></Modal></> : confirmation ? <Popconfirm title={confirmation} onConfirm={() => void run()}>{button}</Popconfirm> : button}</CanAccess>;
}

export function BusinessActions({ resource, placement, record }: { resource: string; placement: "list" | "show"; record: Record<string, unknown> }) { const { translate } = useTranslation(); const recordId = String(record.id); return <Space wrap>{actionsFor(resource, placement, record).map((action) => action.target.kind === "navigate" ? <CanAccess key={action.name} resource={resource} action={action.name} params={{ id: recordId }}><Link to={action.target.path.replace(":id", encodeURIComponent(recordId))}><Button type="link">{action.labelKey ? translate(action.labelKey, {}, action.label) : action.label}</Button></Link></CanAccess> : <CommandAction key={action.name} action={action} resource={resource} recordId={recordId} />)}</Space>; }
export function BatchBusinessActions({ resource, recordIds, onComplete }: { resource: string; recordIds: string[]; onComplete(): void }) { if (!recordIds.length) return null; return <Space wrap>{batchActionsFor(resource).map((action) => <BatchCommandAction key={action.name} action={action} resource={resource} recordIds={recordIds} onComplete={onComplete} />)}</Space>; }
`,
    } : {}),
    ...(hasOrderWorkflow ? {
      "web/app/features/orders/order-actions.tsx": `import { CanAccess, useCustomMutation, useGetIdentity, useInvalidate, useNotification, useTranslation } from "@refinedev/core";
import { Button, Popconfirm, Space } from "antd";

type Command = "submit" | "approve" | "ship" | "cancel";
export function OrderWorkflowActions({ id, status }: { id: string; status: string }) {
  const { data: identity } = useGetIdentity<{ role?: string }>();
  const { translate } = useTranslation();
  const { open: notify } = useNotification();
  const { mutateAsync, mutation } = useCustomMutation();
  const invalidate = useInvalidate();
  const run = async (command: Command) => {
    try {
      await mutateAsync({ url: \`/api/v1/orders/\${encodeURIComponent(id)}/\${command}\`, method: "post", successNotification: false, errorNotification: false, values: {}, ...(command === "submit" ? { meta: { idempotencyKey: crypto.randomUUID() } } : {}) });
      await invalidate({ resource: "orders", id, invalidates: ["detail", "list"] });
      notify?.({ type: "success", message: translate("notifications.success", {}, "Successful") });
    } catch (error) { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  };
  return <CanAccess resource="orders" action="edit" params={{ id }}><Space wrap style={{ marginTop: 16 }}>
    {status === "draft" && <Button type="primary" loading={mutation.isPending} onClick={() => void run("submit")}>{translate("orders.actions.submit", {}, "Submit order")}</Button>}
    {status === "submitted" && identity?.role === "admin" && <Button type="primary" loading={mutation.isPending} onClick={() => void run("approve")}>{translate("orders.actions.approve", {}, "Approve order")}</Button>}
    {status === "approved" && <Popconfirm title={translate("orders.actions.shipConfirm", {}, "Confirm shipment and deduct inventory?")} onConfirm={() => void run("ship")}><Button type="primary" loading={mutation.isPending}>{translate("orders.actions.ship", {}, "Ship")}</Button></Popconfirm>}
    {(status === "draft" || status === "submitted") && <Popconfirm title={translate("orders.actions.cancelConfirm", {}, "Cancel order and release reservations?")} onConfirm={() => void run("cancel")}><Button danger loading={mutation.isPending}>{translate("orders.actions.cancel", {}, "Cancel order")}</Button></Popconfirm>}
  </Space></CanAccess>;
}
`,
    } : {}),
    "web/app/icons.tsx": `import { ${iconNames.join(", ")} } from "@ant-design/icons";
export const qiyIcons = { ${iconNames.join(", ")} };
`,
    "web/app/data-provider.ts": renderAppTemplate("web", "web")["web/app/data-provider.ts"]!
      .replace('import type { DataProvider } from "@refinedev/core";', 'import type { DataProvider } from "@refinedev/core";\nimport { qiyApiError } from "./api-error";')
      .replace('Object.assign(new Error(typeof data?.error === "string" ? data.error : `API error ${response.status}`), { statusCode: response.status })', 'qiyApiError(data, response.status)')
      .replace('Object.assign(new Error(typeof content?.error === "string" ? content.error : `API error ${response.status}`), { statusCode: response.status })', 'qiyApiError(content, response.status)')
      .replace('      if (Object.keys(fieldFilters).length > 0) params.set("filters", JSON.stringify(fieldFilters));', '      const encodeFilters = (items: readonly any[]): unknown[] => items.flatMap<unknown>((filter) => { if (!("field" in filter)) return filter.operator === "and" || filter.operator === "or" ? [{ operator: filter.operator, filters: encodeFilters(Array.isArray(filter.value) ? filter.value : []) }] : []; if (filter.field === "q" || filter.field === "__search" || !("value" in filter)) return []; return [{ field: String(filter.field), operator: String(filter.operator ?? "eq"), value: Array.isArray(filter.value) ? filter.value.map(String).join(",") : String(filter.value) }]; });\n      const encodedFilters = encodeFilters(filters ?? []);\n      if (encodedFilters.length > 0) params.set("filters", JSON.stringify(encodedFilters));\n      else if (Object.keys(fieldFilters).length > 0) params.set("filters", JSON.stringify(fieldFilters));')
      .replace('        if (!("field" in filter) || filter.field === "q" || filter.field === "__search" || !("value" in filter) || filter.operator !== "eq") return [];\n        return [{ field: String(filter.field), value: String(filter.value) }];', '        if (!("field" in filter) || filter.field === "q" || filter.field === "__search" || !("value" in filter)) return [];\n        return filter.operator === "eq" ? [{ field: String(filter.field), value: String(filter.value) }] : [{ field: String(filter.field), operator: String(filter.operator), value: String(filter.value) }];')
      .replaceAll("__QIY_DEFAULT_API_TRANSPORT__", options.apiClient ?? "rest")
      .replace("const allowed = new Set<string>(resourceNames);", `const allowed = new Set<string>(resourceNames);\nconst dataflowCommands = new Set<string>(${JSON.stringify([...(options.dataflows ?? []).map((flow) => `/api/v1/commands/${flow.name}`), ...actionDefinitions.flatMap((action) => action.batch && action.target.kind === "dataflow" ? [action.target.url] : [])])});`)
      .replace('if (method !== "post" || !/^\\/api\\/v1\\/orders\\/[0-9a-f-]{36}\\/(submit|approve|ship|cancel)$/.test(url) || !allowed.has("orders")) throw new Error("Unknown workflow command");', 'const isOrderWorkflow = /^\\/api\\/v1\\/orders\\/[0-9a-f-]{36}\\/(submit|approve|ship|cancel)$/.test(url) && allowed.has("orders");\n  if (method !== "post" || (!isOrderWorkflow && !dataflowCommands.has(url))) throw new Error("Unknown workflow command");')
      .replace('custom: async ({ url, method, query, meta }) => {\n      if (method === "post") return workflowCommand(fetcher, url, method, meta);', 'custom: async ({ url, method, query, meta }) => {\n      if (method === "post") return workflowCommand(fetcher, url, method, meta);')
      .replace('custom: async ({ url, method, query, meta }) => {\n      if (method === "post") return workflowCommand(fetcher, url, method, meta);', 'custom: async ({ url, method, query, meta }) => {\n      if (method === "post") return workflowCommand(fetcher, url, method, meta);'),
    "web/app/api-error.ts": `import { defaultMessageLocale, projectMessage } from "./messages";
export function qiyApiError(payload: unknown, statusCode: number, locale = typeof document === "undefined" ? defaultMessageLocale : document.documentElement.lang) {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const errorKey = typeof body.errorKey === "string" ? body.errorKey : undefined;
  const fallback = typeof body.error === "string" ? body.error : "API error " + statusCode;
  const message = errorKey ? projectMessage(locale, errorKey) ?? fallback : fallback;
  return Object.assign(new Error(message), { statusCode, ...(errorKey ? { errorKey } : {}) });
}
`,
    "web/app/dashboard.ts": `export interface DashboardMetric { name: string; resource: string; label: string; icon?: string; comment?: string; commentKey?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend" | "aggregate"; groupBy?: string; days?: number; field?: string; agg?: "sum" | "avg" | "min" | "max" }
export const dashboardMetrics: DashboardMetric[] = ${JSON.stringify(dashboardMetrics, null, 2)};
`,
    ...(options.auth ? {
      "web/app/auth.ts": `import type { AccessControlProvider, AuthProvider } from "@refinedev/core";
${usesOidcAuth ? 'import { beginOidcLogin, beginOidcLogout, clearOidcSession, oidcSession, oidcSessionSkewMs } from "./auth/oidc-client";' : ""}

const tokenKey = "qiy.access_token";
type QiyIdentity = { id?: string; name?: string; role?: string };
const token = () => typeof window === "undefined" ? undefined : window.localStorage.getItem(tokenKey) ?? undefined;
/** With OIDC the stored expiry decides validity so an expired token never looks authenticated. */
const sessionUsable = () => typeof window === "undefined" ? false : ${usesOidcAuth ? `!oidcSession({ skewMs: oidcSessionSkewMs }).expired` : "Boolean(token())"};
export const qiyAuthProvider: AuthProvider = {
  login: async ({ token: nextToken, username, email, password, identifier, challengeToken, code }: { token?: string; username?: string; email?: string; password?: string; identifier?: string; challengeToken?: string; code?: string }) => {
    const loginName = username ?? email;
    ${options.auth?.provider === "local" ? `
    if (loginName && password) {
      const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: loginName, password }) });
      if (!response.ok) return { success: false, error: { name: "LoginFailed", message: (await response.json().catch(() => null) as { error?: string } | null)?.error ?? "Invalid username or password" } };
      const result = await response.json() as { accessToken?: string };
      if (!result.accessToken) return { success: false, error: { name: "LoginFailed", message: "Login response did not contain an access token" } };
      window.localStorage.setItem(tokenKey, result.accessToken);
      return { success: true, redirectTo: "/" };
    }` : ""}
    ${usesOtpAuth ? `if (identifier && challengeToken && code) { const response = await fetch("/api/v1/auth/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, challengeToken, code }) }); const result = await response.json().catch(() => null) as { accessToken?: string; error?: string } | null; if (!response.ok || !result?.accessToken) return { success: false, error: { name: "OtpVerificationFailed", message: result?.error ?? "Invalid or expired one-time password" } }; window.localStorage.setItem(tokenKey, result.accessToken); return { success: true, redirectTo: "/" }; }` : ""}
    ${usesOidcAuth ? 'await beginOidcLogin(); return { success: true };' : 'void nextToken;'}
    return { success: false, error: { name: "CredentialsRequired", message: ${JSON.stringify(usesOtpAuth ? "Identifier, challenge token and one-time password are required" : options.auth?.provider === "local" ? "Username and password are required" : "Identity provider login could not start")} } };
  },
  logout: async () => { ${usesOidcAuth ? "clearOidcSession();" : 'window.localStorage.removeItem(tokenKey);'} ${usesOidcAuth ? "beginOidcLogout();" : ""} return { success: true, redirectTo: "/auth/login" }; },
  check: async () => sessionUsable() ? { authenticated: true } : { authenticated: false, redirectTo: "/auth/login" },
  getIdentity: async () => { const accessToken = token(); if (!accessToken) return null; const response = await fetch("/api/v1/auth/me", { headers: { Authorization: "Bearer " + accessToken } }); if (!response.ok) return null; return await response.json() as QiyIdentity; },
  getPermissions: async () => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; return identity?.role ?? null; },
  onError: async (error) => error?.statusCode === 401 ? { logout: true, redirectTo: "/auth/login" } : {},
};
const commandPolicies: Array<{ resource: string; action: string; roles: string[] }> = ${JSON.stringify(actionPolicies)};
${resourcePolicyDeclaration}${pageRuleDeclaration}export const qiyAccessControlProvider: AccessControlProvider = { can: async ({ resource, action }) => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; if (!identity) return { can: false, reason: "Authentication required" }; ${resourcePolicyCheck}${pageRuleCheck}const command = commandPolicies.find((policy) => policy.resource === resource && policy.action === action); if (command) return { can: command.roles.includes(identity.role ?? ""), reason: "Command execution is restricted" }; if (identity.role === "admin") return { can: true }; if (resource === "users") return { can: false, reason: "User administration is restricted" }; const can = identity.role === "operator" || action === "list" || action === "show"; return can ? { can: true } : { can: false, reason: "Role " + (identity.role ?? "unknown") + " cannot " + action + " " + resource }; }, options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true }, queryOptions: { staleTime: 30_000 } } };
export function qiyAuthToken(): string | undefined { return token(); }
`,
      "web/app/routes/login.tsx": options.auth?.provider === "local"
        ? `import { AuthPage } from "@refinedev/antd";
export default function Login() { return <AuthPage type="login" title="Qiy Admin" registerLink={false} forgotPasswordLink={false} formProps={{ layout: "vertical" }} />; }
`
        : usesOtpAuth
          ? `import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { useState } from "react";
import { useLogin } from "@refinedev/core";
export default function Login() { const [identifier, setIdentifier] = useState(""); const [challengeToken, setChallengeToken] = useState(""); const [code, setCode] = useState(""); const [requesting, setRequesting] = useState(false); const [requestError, setRequestError] = useState<string>(); const { mutate, isPending, error } = useLogin(); const requestCode = async () => { setRequesting(true); setRequestError(undefined); try { const response = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier }) }); const result = await response.json().catch(() => null) as { challengeToken?: string; error?: string; devCode?: string } | null; if (!response.ok || !result?.challengeToken) throw new Error(result?.error ?? "Could not send one-time password"); setChallengeToken(result.challengeToken); if (result.devCode) setCode(result.devCode); } catch (reason) { setRequestError(reason instanceof Error ? reason.message : String(reason)); } finally { setRequesting(false); } }; return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card title="Qiy Admin 登录" style={{ width: 420 }}><Space direction="vertical" style={{ width: "100%" }}><Typography.Paragraph type="secondary">输入邮箱、手机号或模型配置的唯一登录标识，获取一次性验证码。</Typography.Paragraph><Input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="登录标识" disabled={Boolean(challengeToken)} />{challengeToken ? <><Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="一次性验证码" /><Button type="primary" loading={isPending} block onClick={() => mutate({ identifier, challengeToken, code })}>验证并登录</Button><Button block onClick={() => { setChallengeToken(""); setCode(""); }}>重新发送</Button></> : <Button type="primary" loading={requesting} block onClick={() => void requestCode()}>发送验证码</Button>}{(requestError || error) && <Alert type="error" message={requestError ?? error?.message ?? String(error)} />}</Space></Card></div>; }
`
        : `import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useLogin } from "@refinedev/core";
import { beginOidcSilentRenew, consumeSilentAttempt, oidcSession, oidcSessionSkewMs, oidcProviderLabel } from "../auth/oidc-client";
export default function Login() { const { mutate, isPending, error } = useLogin(); const [renewing, setRenewing] = useState(false); const [renewError, setRenewError] = useState<string>(); useEffect(() => { if (!oidcSession({ skewMs: oidcSessionSkewMs }).expired) return; if (!consumeSilentAttempt()) return; setRenewing(true); void beginOidcSilentRenew("/").catch((reason: unknown) => { setRenewError(reason instanceof Error ? reason.message : String(reason)); setRenewing(false); }); }, []); return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card title="Qiy Admin 登录" style={{ width: 420 }}><Space direction="vertical" style={{ width: "100%" }}><Typography.Paragraph type="secondary">使用 ${authProviderLabel} Authorization Code + PKCE 登录。浏览器端不会保存 client secret；会话过期时先尝试静默续期，失败才需要重新登录。</Typography.Paragraph>{renewing ? <><Spin /><Typography.Paragraph>正在尝试静默续期…</Typography.Paragraph></> : <Button type="primary" loading={isPending} block onClick={() => mutate({})}>使用 ${authProviderLabel} 登录</Button>}{(renewError || error) && <Alert type="error" message={renewError ?? error?.message ?? String(error)} />}</Space></Card></div>; }
`,
      ...(usesOidcAuth ? {
        "web/app/auth/oidc-client.ts": `export interface OidcClientConfig { authorizationUrl: string; tokenUrl: string; clientId: string; scope: string; redirectUri: string; logoutUrl?: string; }
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type EnvLike = Record<string, string | undefined>;
const accessTokenKey = "qiy.access_token";
const idTokenKey = "qiy.id_token";
const expiresAtKey = "qiy.expires_at";
const verifierKey = "qiy.oidc.verifier";
const stateKey = "qiy.oidc.state";
const returnToKey = "qiy.oidc.return_to";
const silentAttemptKey = "qiy.oidc.silent_attempt";
export const oidcProviderLabel = ${JSON.stringify(authProviderLabel)};
export const oidcSessionSkewMs = 60_000;

function envSource(): EnvLike { return import.meta.env as EnvLike; }
function required(env: EnvLike, name: string): string { const value = env[name]?.trim(); if (!value) throw new Error("Missing frontend environment variable " + name); return value; }
export function readOidcClientConfig(env: EnvLike = envSource(), origin = window.location.origin): OidcClientConfig {
  return {
    authorizationUrl: required(env, "VITE_QIY_AUTHORIZATION_URL"),
    tokenUrl: required(env, "VITE_QIY_TOKEN_URL"),
    clientId: required(env, "VITE_QIY_CLIENT_ID"),
    scope: env.VITE_QIY_AUTH_SCOPE?.trim() || "openid profile email",
    redirectUri: env.VITE_QIY_REDIRECT_URI?.trim() || origin + "/auth/callback",
    ...(env.VITE_QIY_LOGOUT_URL?.trim() ? { logoutUrl: env.VITE_QIY_LOGOUT_URL.trim() } : {}),
  };
}
function randomValue(): string { const bytes = crypto.getRandomValues(new Uint8Array(32)); return base64Url(bytes); }
function base64Url(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\\+/g, "-").replace(/\\\//g, "_").replace(/=+$/, ""); }
export async function createPkceChallenge(verifier: string): Promise<string> { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))); }
export async function buildAuthorizationUrl(config: OidcClientConfig, verifier: string, state: string, prompt?: "none"): Promise<string> { const url = new URL(config.authorizationUrl); url.searchParams.set("response_type", "code"); url.searchParams.set("client_id", config.clientId); url.searchParams.set("redirect_uri", config.redirectUri); url.searchParams.set("scope", config.scope); url.searchParams.set("state", state); url.searchParams.set("code_challenge", await createPkceChallenge(verifier)); url.searchParams.set("code_challenge_method", "S256"); if (prompt) url.searchParams.set("prompt", prompt); return url.toString(); }
export async function beginOidcLogin(returnTo = window.location.pathname + window.location.search): Promise<void> { const config = readOidcClientConfig(); const verifier = randomValue(); const state = randomValue(); window.sessionStorage.setItem(verifierKey, verifier); window.sessionStorage.setItem(stateKey, state); window.sessionStorage.setItem(returnToKey, returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"); window.sessionStorage.removeItem(silentAttemptKey); window.location.assign(await buildAuthorizationUrl(config, verifier, state)); }
export interface OidcSession { token?: string; expiresAt?: number; expired: boolean; }
/**
 * Reads the stored session and reports whether the access token is no longer
 * usable. When the provider did not return expires_in the expiry is unknown and
 * the token is treated as usable, which keeps behaviour unchanged for such IdPs.
 */
export function oidcSession(options: { storage?: StorageLike; now?: number; skewMs?: number } = {}): OidcSession { const storage = options.storage ?? window.localStorage; const now = options.now ?? Date.now(); const skew = options.skewMs ?? 0; const token = storage.getItem(accessTokenKey) ?? undefined; const raw = storage.getItem(expiresAtKey); const expiresAt = raw === null ? undefined : Number(raw); const known = expiresAt !== undefined && Number.isFinite(expiresAt); return { ...(token ? { token } : {}), ...(known ? { expiresAt } : {}), expired: !token || (known && expiresAt - skew <= now) }; }
export function clearOidcSession(storage: StorageLike = window.localStorage, session: StorageLike = window.sessionStorage): void { storage.removeItem(accessTokenKey); storage.removeItem(idTokenKey); storage.removeItem(expiresAtKey); session.removeItem(silentAttemptKey); }
/** True once per redirect cycle, so a failed silent renewal cannot loop. */
export function consumeSilentAttempt(session: StorageLike = window.sessionStorage): boolean { if (session.getItem(silentAttemptKey) === "1") return false; session.setItem(silentAttemptKey, "1"); return true; }
/**
 * Renews the session through the identity provider without user interaction.
 * This relies on the provider session cookie, so no refresh token is kept in
 * browser storage; a refresh-token or refresh-cookie design belongs in a
 * backend-for-frontend.
 */
export async function beginOidcSilentRenew(returnTo = "/", config?: OidcClientConfig): Promise<void> { const effective = config ?? readOidcClientConfig(); const verifier = randomValue(); const state = randomValue(); window.sessionStorage.setItem(verifierKey, verifier); window.sessionStorage.setItem(stateKey, state); window.sessionStorage.setItem(returnToKey, returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"); window.location.assign(await buildAuthorizationUrl(effective, verifier, state, "none")); }
export function isSilentRenewFailure(message: string | undefined): boolean { return Boolean(message && /login_required|interaction_required|consent_required|account_selection_required/i.test(message)); }
export async function completeOidcLogin(callbackUrl: string, storage: StorageLike = window.sessionStorage, localStorage: StorageLike = window.localStorage, fetcher: typeof fetch = fetch, config = readOidcClientConfig()): Promise<string> { const url = new URL(callbackUrl); const providerError = url.searchParams.get("error"); if (providerError) throw new Error(url.searchParams.get("error_description") || providerError); const code = url.searchParams.get("code"); const state = url.searchParams.get("state"); const expectedState = storage.getItem(stateKey); const verifier = storage.getItem(verifierKey); if (!code || !state || !expectedState || state !== expectedState || !verifier) { storage.removeItem(verifierKey); storage.removeItem(stateKey); throw new Error("Invalid or expired OAuth state"); } const body = new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId, redirect_uri: config.redirectUri, code_verifier: verifier }); const response = await fetcher(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }); const result = await response.json().catch(() => null) as { access_token?: string; id_token?: string; expires_in?: number; error?: string; error_description?: string } | null; if (!response.ok || !result?.access_token) throw new Error(result?.error_description || result?.error || "Identity provider did not return an access token"); localStorage.setItem(accessTokenKey, result.access_token); if (result.id_token) localStorage.setItem(idTokenKey, result.id_token); const expiresIn = Number(result.expires_in); if (Number.isFinite(expiresIn) && expiresIn > 0) localStorage.setItem(expiresAtKey, String(Date.now() + expiresIn * 1000)); else localStorage.removeItem(expiresAtKey); storage.removeItem(silentAttemptKey); const returnTo = storage.getItem(returnToKey) || "/"; storage.removeItem(verifierKey); storage.removeItem(stateKey); storage.removeItem(returnToKey); return returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"; }
export function beginOidcLogout(config?: OidcClientConfig): void { const idToken = window.localStorage.getItem(idTokenKey); window.localStorage.removeItem(idTokenKey); window.sessionStorage.removeItem(verifierKey); window.sessionStorage.removeItem(stateKey); window.sessionStorage.removeItem(returnToKey); let effective = config; if (!effective) { try { effective = readOidcClientConfig(); } catch { return; } } if (!effective.logoutUrl) return; const url = new URL(effective.logoutUrl); url.searchParams.set("post_logout_redirect_uri", window.location.origin + "/auth/login"); if (idToken) url.searchParams.set("id_token_hint", idToken); window.location.assign(url.toString()); }
`,
        "web/app/routes/auth-callback.tsx": `import { Alert, Card, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { completeOidcLogin, isSilentRenewFailure, oidcProviderLabel } from "../auth/oidc-client";
export default function AuthCallback() { const navigate = useNavigate(); const [error, setError] = useState<string>(); useEffect(() => { let active = true; void completeOidcLogin(window.location.href).then((target) => { if (active) navigate(target, { replace: true }); }).catch((reason) => { if (!active) return; const message = reason instanceof Error ? reason.message : String(reason); /* A silent renewal the provider refuses is not a failure: fall back to interactive login. */ if (isSilentRenewFailure(message)) { navigate("/auth/login", { replace: true }); return; } setError(message); }); return () => { active = false; }; }, [navigate]); return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card style={{ width: 420 }}>{error ? <Alert type="error" showIcon message={oidcProviderLabel + " 登录失败"} description={error} /> : <><Spin /><Typography.Paragraph style={{ marginTop: 16 }}>正在完成 {oidcProviderLabel} 登录…</Typography.Paragraph></>}</Card></div>; }
`,
        "web/tests/oidc-client.test.ts": `import { expect, test } from "bun:test";
import { beginOidcSilentRenew, buildAuthorizationUrl, clearOidcSession, completeOidcLogin, consumeSilentAttempt, isSilentRenewFailure, oidcSession, readOidcClientConfig } from "../app/auth/oidc-client";
const config = { authorizationUrl: "https://id.example/authorize", tokenUrl: "https://id.example/token", clientId: "qiy-spa", scope: "openid profile", redirectUri: "https://admin.example/auth/callback" };
function memory(initial: Record<string, string> = {}) { const values = new Map(Object.entries(initial)); return { values, store: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } }; }
test("builds authorization-code PKCE requests without a client secret", async () => { const url = new URL(await buildAuthorizationUrl(config, "verifier-value", "state-value")); expect(url.searchParams.get("response_type")).toBe("code"); expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("state")).toBe("state-value"); expect(url.searchParams.has("client_secret")).toBe(false); expect(url.searchParams.has("prompt")).toBe(false); expect(new URL(await buildAuthorizationUrl(config, "verifier-value", "state-value", "none")).searchParams.get("prompt")).toBe("none"); });
test("requires provider endpoints and a public client id", () => { expect(() => readOidcClientConfig({}, "https://admin.example")).toThrow("VITE_QIY_AUTHORIZATION_URL"); });
test("exchanges a matching callback and fails closed on state mismatch", async () => { const session = new Map([["qiy.oidc.verifier", "verifier-value"], ["qiy.oidc.state", "state-value"], ["qiy.oidc.return_to", "/orders"]]); const local = new Map<string, string>(); const storage = { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => { session.set(key, value); }, removeItem: (key: string) => { session.delete(key); } }; const localStorage = { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => { local.set(key, value); }, removeItem: (key: string) => { local.delete(key); } }; const requests: RequestInit[] = []; const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { requests.push(init ?? {}); return Response.json({ access_token: "access-token", id_token: "id-token" }); }) as typeof fetch; expect(await completeOidcLogin("https://admin.example/auth/callback?code=code-value&state=state-value", storage, localStorage, fetcher, config)).toBe("/orders"); expect(local.get("qiy.access_token")).toBe("access-token"); expect(String(requests[0]?.body)).toContain("code_verifier=verifier-value"); session.set("qiy.oidc.verifier", "verifier-value"); session.set("qiy.oidc.state", "expected"); await expect(completeOidcLogin("https://admin.example/auth/callback?code=code-value&state=wrong", storage, localStorage, fetcher, config)).rejects.toThrow("Invalid or expired OAuth state"); });
test("tracks token expiry and clears it on logout", async () => { const local = memory(); const session = memory(); const fetcher = (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ access_token: "token-a", expires_in: 300 })) as typeof fetch; session.store.setItem("qiy.oidc.verifier", "verifier-value"); session.store.setItem("qiy.oidc.state", "state-value"); const started = Date.now(); await completeOidcLogin("https://admin.example/auth/callback?code=code-value&state=state-value", session.store, local.store, fetcher, config); const expiresAt = Number(local.store.getItem("qiy.expires_at")); expect(expiresAt).toBeGreaterThanOrEqual(started + 300_000); expect(oidcSession({ storage: local.store, now: started }).expired).toBe(false); expect(oidcSession({ storage: local.store, now: started + 299_000 }).expired).toBe(false); expect(oidcSession({ storage: local.store, now: started + 300_001 }).expired).toBe(true); expect(oidcSession({ storage: local.store, now: started + 299_000, skewMs: 60_000 }).expired).toBe(true); clearOidcSession(local.store, session.store); expect(oidcSession({ storage: local.store, now: started }).expired).toBe(true); expect(local.store.getItem("qiy.expires_at")).toBeNull(); });
test("treats a provider without expires_in as usable and a missing token as expired", async () => { const local = memory(); const session = memory(); const fetcher = (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ access_token: "token-b" })) as typeof fetch; session.store.setItem("qiy.oidc.verifier", "verifier-value"); session.store.setItem("qiy.oidc.state", "state-value"); await completeOidcLogin("https://admin.example/auth/callback?code=code-value&state=state-value", session.store, local.store, fetcher, config); expect(local.store.getItem("qiy.expires_at")).toBeNull(); expect(oidcSession({ storage: local.store, now: Date.now() + 10 ** 12 }).expired).toBe(false); expect(oidcSession({ storage: memory().store }).expired).toBe(true); });
test("renews silently once per redirect cycle and detects provider refusal", async () => { const session = memory(); const assigned: string[] = []; const previous = Object.getOwnPropertyDescriptor(globalThis, "window"); try { Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://admin.example", pathname: "/orders", search: "", assign: (url: string) => { assigned.push(url); } }, sessionStorage: session.store, localStorage: memory().store } }); expect(consumeSilentAttempt(session.store)).toBe(true); expect(consumeSilentAttempt(session.store)).toBe(false); await beginOidcSilentRenew("/reports", config); const url = new URL(assigned[0]!); expect(url.searchParams.get("prompt")).toBe("none"); expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("client_secret")).toBeNull(); expect(session.store.getItem("qiy.oidc.return_to")).toBe("/reports"); expect(isSilentRenewFailure("login_required")).toBe(true); expect(isSilentRenewFailure("interaction_required")).toBe(true); expect(isSilentRenewFailure("access_denied")).toBe(false); expect(isSilentRenewFailure(undefined)).toBe(false); } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); } });
`,
      } : {}),
      "web/tests/auth.test.ts": `import { afterAll, beforeAll, expect, test } from "bun:test";
import { qiyAccessControlProvider, qiyAuthProvider } from "../app/auth";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const tokens = new Map<string, string>();
let role = "viewer";
beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => tokens.get(key) ?? null, setItem: (key: string, value: string) => { tokens.set(key, value); }, removeItem: (key: string) => { tokens.delete(key); } }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, location: { origin: "http://localhost", pathname: "/", search: "", assign: () => {} } } });
  globalThis.fetch = (async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("/auth/login") ? { accessToken: "local-test-token" } : { id: "test-user", role }), { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
});
afterAll(() => { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); globalThis.fetch = originalFetch; });

test("authenticates using ${options.auth?.provider === "local" ? "username and password" : "the configured identity provider"}", async () => {
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
  ${options.auth?.provider === "local" ? 'expect((await qiyAuthProvider.login({ username: "admin", password: "correct-password" })).success).toBe(true); expect(tokens.get("qiy.access_token")).toBe("local-test-token");' : 'tokens.set("qiy.access_token", "test-token");'}
  expect((await qiyAuthProvider.check({})).authenticated).toBe(true);
});

test("matches server admin, operator and viewer role policy", async () => {
${["viewer", "operator", "admin"].map((role) => `  role = ${JSON.stringify(role)};\n${roleExpectations(role).join("\n")}`).join("\n")}
  await qiyAuthProvider.logout({});
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
});
test("decides every resource page action, so route guards cannot be bypassed by URL", async () => {
  tokens.set("qiy.access_token", "page-guard-token");
${["viewer", "operator", "admin"].map((role) => `  role = ${JSON.stringify(role)};\n${roleExpectations(role).join("\n")}`).join("\n")}
  tokens.clear();
  role = "viewer";
${roleExpectations("viewer", true).join("\n")}
  tokens.set("qiy.access_token", "page-guard-token");
});
${actionPolicies.length ? `
test("matches each action role allowlist without an admin bypass", async () => {
  tokens.set("qiy.access_token", "policy-test-token");
  for (const policy of ${JSON.stringify(actionPolicies)}) {
    for (const candidate of ["admin", "operator", "viewer"]) {
      role = candidate;
      expect((await qiyAccessControlProvider.can({ resource: policy.resource, action: policy.action })).can).toBe(policy.roles.includes(candidate));
    }
  }
  tokens.clear();
  ${actionPolicies.map((policy) => `expect((await qiyAccessControlProvider.can({ resource: ${JSON.stringify(policy.resource)}, action: ${JSON.stringify(policy.action)} })).can).toBe(false);`).join("\n  ")}
});
` : ""}
`,
    } : {}),
    "web/app/hooks/index.ts": `export function useQiyTitle(title: string): string { return "Qiy · " + title; }\n`,
    "web/app/views-api.ts": `export interface QiyServerView {
  id: string;
  resource: string;
  name: string;
  shared: boolean;
  search?: string;
  filters?: unknown[];
  sorters?: unknown[];
  columns?: string[];
}

function bearer(): Record<string, string> {
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  return token ? { Authorization: "Bearer " + token } : {};
}

/** Shared (and own) views stored on the server, so they follow the user across devices. */
export async function fetchServerViews(resource: string, fetcher: typeof fetch = fetch): Promise<QiyServerView[]> {
  const response = await fetcher("/api/v1/saved-views?resource=" + encodeURIComponent(resource), { headers: bearer() });
  if (!response.ok) throw new Error("Saved views failed: " + response.status);
  const body = await response.json() as { items?: QiyServerView[] };
  return Array.isArray(body.items) ? body.items : [];
}

export async function publishServerView(input: { resource: string; name: string; shared?: boolean; search?: string; filters?: unknown[]; sorters?: unknown[]; columns?: string[] }, fetcher: typeof fetch = fetch): Promise<QiyServerView> {
  const response = await fetcher("/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json", ...bearer() }, body: JSON.stringify({ shared: false, ...input }) });
  const body = await response.json().catch(() => null) as (QiyServerView & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? "Saving a shared view failed: " + response.status);
  return body;
}

export async function deleteServerView(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/v1/saved-views/" + encodeURIComponent(id), { method: "DELETE", headers: bearer() });
  if (!response.ok && response.status !== 204) throw new Error("Deleting a shared view failed: " + response.status);
}
`,
    "web/app/tree.ts": `export interface QiyTreeNode<T> {
  key: string;
  title: string;
  record: T;
  children: QiyTreeNode<T>[];
}

/** Tree entities declared by scope ... tree <entity> <parentField>. */
export const treeParents: Record<string, { parentField: string; labelField: string }> = ${JSON.stringify(Object.fromEntries([...new Set((options.scopes ?? []).flatMap((scope) => scope.tree ? [[scope.tree.entity, scope.tree.parentField] as const] : []))].map(([entity, parentField]) => [entity, { parentField, labelField: "name" }])))};

/**
 * Builds a nested tree from flat rows. Missing parents, self references and cycles
 * are reported as orphans instead of being dropped silently or looping forever.
 */
export function buildTree<T extends Record<string, unknown>>(records: readonly T[], parentField: string, labelField: string): { nodes: Array<QiyTreeNode<T>>; orphans: T[] } {
  const byId = new Map<string, QiyTreeNode<T>>();
  for (const record of records) {
    const id = String(record.id ?? "");
    if (!id) continue;
    byId.set(id, { key: id, title: String(record[labelField] ?? id), record, children: [] });
  }
  const orphans: T[] = [];
  const placed = new Set<string>();
  for (const record of records) {
    const id = String(record.id ?? "");
    if (!id) continue;
    const parent = record[parentField];
    const parentId = parent === null || parent === undefined ? "" : String(parent);
    if (!parentId) { placed.add(id); continue; }
    // Self references and unknown parents cannot be attached anywhere.
    if (parentId === id || !byId.has(parentId)) { orphans.push(record); continue; }
    placed.add(id);
  }
  const roots: Array<QiyTreeNode<T>> = [];
  for (const record of records) {
    const id = String(record.id ?? "");
    if (!id || !placed.has(id)) continue;
    const node = byId.get(id)!;
    const parent = record[parentField];
    const parentId = parent === null || parent === undefined ? "" : String(parent);
    if (!parentId) { roots.push(node); continue; }
    byId.get(parentId)!.children.push(node);
  }
  // A cycle leaves nodes attached below each other with no root; surface them.
  const reachable = new Set<string>();
  const walk = (nodes: Array<QiyTreeNode<T>>) => { for (const node of nodes) { reachable.add(node.key); walk(node.children); } };
  walk(roots);
  for (const record of records) {
    const id = String(record.id ?? "");
    if (id && placed.has(id) && !reachable.has(id) && !orphans.includes(record)) orphans.push(record);
  }
  return { nodes: roots, orphans };
}
`,
    "web/app/views.ts": `export interface QiySavedView {  id: string;
  name: string;
  createdAt: string;
  search?: string;
  filters?: unknown[];
  sorters?: unknown[];
  columns?: string[];
}

const MAX_VIEWS = 50;
const MAX_NAME = 60;
const keyFor = (resource: string) => "qiy.views." + resource;

function resolveStorage(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function readAll(resource: string, storage?: Storage): Record<string, QiySavedView[]> {
  const store = resolveStorage(storage);
  if (!store) return {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(keyFor(resource)) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, QiySavedView[]>;
  } catch { return {}; }
}

function writeAll(resource: string, views: Record<string, QiySavedView[]>, storage?: Storage): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try { store.setItem(keyFor(resource), JSON.stringify(views)); } catch { /* quota or private mode */ }
}

/** Saved list views are per resource and per browser; a corrupt payload reads as empty. */
export function listSavedViews(resource: string, storage?: Storage): QiySavedView[] {
  const views = readAll(resource, storage)[resource];
  return Array.isArray(views) ? views.filter((view) => view && typeof view.id === "string" && typeof view.name === "string") : [];
}

export function saveView(resource: string, view: Omit<QiySavedView, "id" | "createdAt">, storage?: Storage): QiySavedView[] {
  const name = String(view.name ?? "").trim().slice(0, MAX_NAME);
  const existing = listSavedViews(resource, storage);
  if (!name) return existing;
  const next: QiySavedView = { id: existing.find((item) => item.name === name)?.id ?? crypto.randomUUID(), name, createdAt: new Date().toISOString(), ...(view.search ? { search: view.search } : {}), ...(view.filters?.length ? { filters: view.filters } : {}), ...(view.sorters?.length ? { sorters: view.sorters } : {}), ...(view.columns?.length ? { columns: view.columns } : {}) };
  const views = [...existing.filter((item) => item.name !== name), next].slice(-MAX_VIEWS);
  writeAll(resource, { ...readAll(resource, storage), [resource]: views }, storage);
  return views;
}

export function deleteSavedView(resource: string, id: string, storage?: Storage): QiySavedView[] {
  const views = listSavedViews(resource, storage).filter((view) => view.id !== id);
  writeAll(resource, { ...readAll(resource, storage), [resource]: views }, storage);
  return views;
}
`,
    "web/tests/tree.test.ts": `import { expect, test } from "bun:test";
import { buildTree } from "../app/tree";

const rows = [
  { id: "root", parentId: null, name: "Root" },
  { id: "a", parentId: "root", name: "A" },
  { id: "b", parentId: "root", name: "B" },
  { id: "a1", parentId: "a", name: "A1" },
];

test("nests rows by their parent field", () => {
  const { nodes, orphans } = buildTree(rows, "parentId", "name");
  expect(nodes.map((node) => node.key)).toEqual(["root"]);
  expect(nodes[0]!.children.map((node) => node.key)).toEqual(["a", "b"]);
  expect(nodes[0]!.children[0]!.children.map((node) => node.key)).toEqual(["a1"]);
  expect(orphans).toEqual([]);
});

test("reports unknown parents, self references and cycles instead of looping", () => {
  const broken = [
    { id: "root", parentId: null, name: "Root" },
    { id: "lost", parentId: "ghost", name: "Lost" },
    { id: "self", parentId: "self", name: "Self" },
    { id: "x", parentId: "y", name: "X" },
    { id: "y", parentId: "x", name: "Y" },
  ];
  const { nodes, orphans } = buildTree(broken, "parentId", "name");
  expect(nodes.map((node) => node.key)).toEqual(["root"]);
  expect(orphans.map((row) => row.id).sort()).toEqual(["lost", "self", "x", "y"]);
});

test("handles empty and label fallbacks", () => {
  expect(buildTree([], "parentId", "name")).toEqual({ nodes: [], orphans: [] });
  const { nodes } = buildTree([{ id: "only", parentId: null }], "parentId", "name");
  expect(nodes[0]!.title).toBe("only");
});
`,
    "web/tests/field-rules.test.ts": `import { expect, test } from "bun:test";
import { canSeeField, getResource, resources } from "../app/resources";

const fieldRules: Array<{ resource: string; field: string; roles: string[] }> = ${JSON.stringify((options.pages ?? []).flatMap((page) => (page.fields ?? []).map((entry) => ({ resource: page.resource, field: entry.field, roles: entry.roles }))), null, 2)};

test("page field layout follows the declared roles", () => {
  for (const rule of fieldRules) {
    const resource = getResource(rule.resource);
    expect(resource).toBeDefined();
    const field = resource?.fields.find((candidate) => candidate.name === rule.field);
    expect(field).toBeDefined();
    expect(field?.roles).toEqual(rule.roles);
    // Every role outside the rule must not see the field, inside must see it.
    for (const role of ["admin", "operator", "viewer"]) {
      expect(canSeeField(field!, role)).toBe(rule.roles.includes(role));
    }
    expect(canSeeField(field!, undefined)).toBe(false);
  }
});

test("fields without layout rules stay visible to every role", () => {
  for (const resource of resources) {
    for (const field of resource.fields) {
      if (field.roles) continue;
      for (const role of ["admin", "operator", "viewer"]) expect(canSeeField(field, role)).toBe(true);
    }
  }
});
`,
    "web/tests/views.test.ts": `import { expect, test } from "bun:test";
import { deleteSavedView, listSavedViews, saveView } from "../app/views";
import { fetchServerViews, publishServerView } from "../app/views-api";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  } as Storage;
}

test("saves, updates and lists views per resource", () => {
  const storage = memoryStorage();
  const first = saveView("orders", { name: "Open", search: "abc", filters: [{ field: "status", operator: "eq", value: "open" }], sorters: [{ field: "title", order: "desc" }], columns: ["id", "title"] }, storage);
  expect(first).toHaveLength(1);
  expect(first[0]?.name).toBe("Open");
  expect(listSavedViews("orders", storage)).toHaveLength(1);
  // The same name updates in place instead of duplicating.
  const updated = saveView("orders", { name: "Open", filters: [] }, storage);
  expect(updated).toHaveLength(1);
  expect(updated[0]?.filters).toBeUndefined();
  saveView("orders", { name: "Late", columns: ["id"] }, storage);
  expect(listSavedViews("orders", storage).map((view) => view.name)).toEqual(["Open", "Late"]);
  // Views never leak across resources.
  expect(listSavedViews("products", storage)).toEqual([]);
  expect(listSavedViews("orders", storage)).toHaveLength(2);
});

test("ignores blank names and deletes by id", () => {
  const storage = memoryStorage();
  expect(saveView("orders", { name: "   " }, storage)).toEqual([]);
  const saved = saveView("orders", { name: "  Padded  " }, storage);
  expect(saved[0]?.name).toBe("Padded");
  expect(deleteSavedView("orders", saved[0]!.id, storage)).toEqual([]);
  expect(listSavedViews("orders", storage)).toEqual([]);
  // Deleting an unknown id is a no-op.
  expect(deleteSavedView("orders", "missing", storage)).toEqual([]);
});

test("tolerates corrupt storage and missing window", () => {
  const storage = memoryStorage();
  storage.setItem("qiy.views.orders", "{not json");
  expect(listSavedViews("orders", storage)).toEqual([]);
  storage.setItem("qiy.views.orders", JSON.stringify({ orders: [{ id: 1 }, null] }));
  expect(listSavedViews("orders", storage)).toEqual([]);
  // Server-side rendering has no localStorage.
  expect(listSavedViews("orders")).toEqual([]);
});

test("publishes a view to the server and lists the shared ones", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined });
    if (init?.method === "POST") return Response.json({ id: "s1", resource: "orders", name: "Open", shared: true, createdAt: new Date().toISOString() }, { status: 201 });
    return Response.json({ items: [{ id: "s1", resource: "orders", name: "Open", shared: true, createdAt: new Date().toISOString() }] });
  }) as typeof fetch;
  const published = await publishServerView({ resource: "orders", name: "Open", shared: true, search: "draft", filters: [{ field: "status", operator: "eq", value: "draft" }], columns: ["id", "status"] }, fetcher);
  expect(published.shared).toBe(true);
  expect(calls[0]).toMatchObject({ url: "/api/v1/saved-views", method: "POST" });
  expect(calls[0]!.body).toMatchObject({ resource: "orders", name: "Open", shared: true, search: "draft", columns: ["id", "status"] });
  const listed = await fetchServerViews("orders", fetcher);
  expect(listed.map((view) => view.id)).toEqual(["s1"]);
  expect(calls[1]!.url).toContain("resource=orders");
});
`,
    "web/app/export.ts": `export type QiyExportFilter = { field: string; operator: string; value: string } | { operator: "and" | "or"; value: QiyExportFilter[] };
/**
 * Mirrors the list data provider's filter encoding so an export covers exactly the
 * rows and columns the table is showing. The export endpoint re-validates every
 * field and operator, so drift fails loudly instead of exporting the wrong range.
 */
export function encodeExportFilters(items: readonly unknown[]): QiyExportFilter[] {
  return items.flatMap<QiyExportFilter>((item) => {
    if (!item || typeof item !== "object") return [];
    const filter = item as Record<string, unknown>;
    if (!("field" in filter)) {
      const children = Array.isArray(filter.value) ? filter.value : [];
      const operator = filter.operator === "or" ? "or" : filter.operator === "and" ? "and" : undefined;
      const encoded = encodeExportFilters(children);
      return operator && encoded.length ? [{ operator, value: encoded }] : [];
    }
    if (filter.field === "q" || filter.field === "__search" || !("value" in filter)) return [];
    const value = Array.isArray(filter.value) ? filter.value.map(String).join(",") : String(filter.value ?? "");
    return [{ field: String(filter.field), operator: String(filter.operator ?? "eq"), value }];
  });
}

export function exportUrl(resource: string, options: { filters?: readonly unknown[]; sorters?: readonly unknown[]; ids?: readonly (string | number)[]; columns?: readonly string[] } = {}): string {
  const params = new URLSearchParams();
  const filters = encodeExportFilters(options.filters ?? []);
  if (filters.length) params.set("filters", JSON.stringify(filters));
  const sorters = (options.sorters ?? []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const sorter = item as Record<string, unknown>;
    return typeof sorter.field === "string" && sorter.field ? [sorter] : [];
  });
  if (sorters[0]) {
    params.set("sort", String(sorters[0].field));
    if (sorters[0].order === "desc") params.set("order", "desc");
  }
  // A selection exports exactly those rows; the server still applies the policy.
  const ids = (options.ids ?? []).map(String).filter(Boolean);
  if (ids.length) params.set("ids", ids.join(","));
  // Only the columns the table is showing are exported.
  const columns = (options.columns ?? []).map(String).filter(Boolean);
  if (columns.length) params.set("columns", columns.join(","));
  const query = params.toString();
  return "/api/v1/" + resource + "/export" + (query ? "?" + query : "");
}

function fileNameFrom(response: Response, resource: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return match?.[1] ?? resource + ".csv";
}

export async function downloadExport(url: string, fetcher: typeof fetch = fetch): Promise<void> {  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  const response = await fetcher(url, { headers: token ? { Authorization: "Bearer " + token } : {} });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Export failed: " + response.status);
  }
  const blob = await response.blob();
  if (typeof window === "undefined") return;
  const href = window.URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = href;
  link.download = fileNameFrom(response, url.split("/").at(-2) ?? "export");
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(href);
}

export async function uploadImport(resource: string, file: Blob, fetcher: typeof fetch = fetch): Promise<number> {
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  const response = await fetcher("/api/v1/" + resource + "/import", { method: "POST", headers: { "Content-Type": "text/csv", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: file });
  const body = await response.json().catch(() => null) as { imported?: number; error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? "Import failed: " + response.status);
  return body?.imported ?? 0;
}

export interface QiyImportJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  total: number;
  processed: number;
  failed: number;
  errors: string[];
}

function bearer(): Record<string, string> {
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  return token ? { Authorization: "Bearer " + token } : {};
}

/**
 * Starts a background import and returns its job id. The rows are written after
 * the response, so the UI polls the job instead of holding a request open.
 */
export async function startImport(resource: string, file: Blob, fetcher: typeof fetch = fetch): Promise<{ jobId: string; total: number }> {
  const response = await fetcher("/api/v1/" + resource + "/import?async=1", { method: "POST", headers: { "Content-Type": "text/csv", ...bearer() }, body: file });
  const body = await response.json().catch(() => null) as { jobId?: string; total?: number; error?: string } | null;
  if (!response.ok || !body?.jobId) throw new Error(body?.error ?? "Import failed: " + response.status);
  return { jobId: body.jobId, total: body.total ?? 0 };
}

export async function waitForImport(resource: string, jobId: string, options: { onProgress?: (job: QiyImportJob) => void; intervalMs?: number; timeoutMs?: number; fetcher?: typeof fetch } = {}): Promise<QiyImportJob> {
  const fetcher = options.fetcher ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  while (Date.now() < deadline) {
    const response = await fetcher("/api/v1/" + resource + "/import/jobs/" + jobId, { headers: bearer() });
    const body = await response.json().catch(() => null) as (QiyImportJob & { error?: string }) | null;
    if (!response.ok || !body) throw new Error(body?.error ?? "Import status failed: " + response.status);
    options.onProgress?.(body);
    if (body.status === "completed" || body.status === "failed") return body;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500));
  }
  throw new Error("Import did not finish in time");
}
`,
    "web/app/components/related-records.tsx": `import { useList } from "@refinedev/core";
import { useTranslation } from "@refinedev/core";
import { Alert, Card, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router";
import { canSeeField, getResource } from "../resources";
import { t, type QiyLocale } from "../i18n";

interface RelatedResource { resource: string; field: string; label: string; }

export function RelatedRecords({ relation, recordId }: { relation: RelatedResource; recordId: string }) {
  const { getLocale } = useTranslation();
  const locale: QiyLocale = getLocale() === "en-US" ? "en-US" : "zh-CN";
  const resource = getResource(relation.resource);
  const { result, query } = useList<Record<string, unknown>>({
    resource: relation.resource,
    filters: [{ field: relation.field, operator: "eq", value: recordId }],
    pagination: { currentPage: 1, pageSize: 10 },
    queryOptions: { enabled: Boolean(recordId) },
  });
  const fields = resource?.fields.filter((field) => field.listVisible && !field.primaryKey && field.type !== "Vector").slice(0, 5) ?? [];
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => ({ title: field.label, dataIndex: field.name, key: field.name, render: (value: unknown) => String(value ?? "—") }));
  columns.push({ title: t(locale, "actions"), key: "actions", render: (_value, record) => <Link to={"/" + relation.resource + "/" + String(record.id)}>{t(locale, "view")}</Link> });
  if (!resource) return <Alert type="error" message={"Unknown related resource: " + relation.resource} />;
  const total = result.total ?? 0;
  return <Card size="small" title={relation.label} style={{ marginTop: 16 }}><Table<Record<string, unknown>> rowKey="id" loading={query.isLoading} dataSource={result.data} columns={columns} pagination={total > 10 ? { pageSize: 10, total, showSizeChanger: false } : false} scroll={{ x: "max-content" }} /></Card>;
}
`,
    "web/app/plugins/index.ts": `export interface WebPlugin { name: string; setup?(): void | Promise<void>; }\nexport const plugins: WebPlugin[] = [];\n`,
    "web/app/shared/types.ts": `export type ID = string;\nexport interface PageResult<T> { data: T[]; total: number; }\n`,
    "web/app/features/resources/index.ts": `export { resources, resourceNames, getResource } from "../../resources";\nexport type { ResourceDefinition, ResourceField, FieldType } from "../../resources";\n`,
    "web/app/resources.ts": `export type FieldType = "UUID" | "Text" | "Integer" | "Decimal" | "Money" | "DateTime" | "File" | "Files" | "Vector";
export interface ResourceEnumValue { name: string; label?: string; color?: string; icon?: string; comment?: string; commentKey?: string; }
export interface ResourceEnumDefinition { name: string; comment?: string; commentKey?: string; values: ResourceEnumValue[]; }
export interface ResourceField { name: string; label: string; comment?: string; commentKey?: string; type: FieldType; nullable: boolean; primaryKey: boolean; visible: boolean; listVisible: boolean; formVisible: boolean; showVisible: boolean; sortable: boolean; filterable: boolean; filterModes: string[]; enumName?: string; enumValues?: ResourceEnumValue[]; relation?: { resource: string; labelField: string }; icon?: string; dimension?: number; uploadMode?: "binary" | "base64" | "both"; maxBytes?: number; mimeTypes?: string[]; maxFiles?: number; /** Page-level layout: the field is only rendered for these roles. */ roles?: string[]; }
/** Page-level field layout check; a field without role rules is visible to everyone. */
export function canSeeField(field: ResourceField, role: string | undefined | null): boolean { return !field.roles || field.roles.includes(role ?? ""); }
 export interface ResourceDefinition { name: string; apiName: string; label: string; comment?: string; commentKey?: string; icon: string; liveMode: "auto" | "manual" | "off"; menuParent?: string; fields: ResourceField[]; relatedResources?: Array<{ resource: string; field: string; label: string }>; }
export const enumerations: ResourceEnumDefinition[] = ${JSON.stringify(database.enums ?? [], null, 2)};
export const menuGroups = ${JSON.stringify(menuGroups.map((group) => ({ name: `menu-${group.name}`, label: group.label, icon: group.icon ?? "AppstoreOutlined", ...(group.parent && { parent: `menu-${group.parent}` }), ...(group.comment !== undefined && { comment: group.comment }), ...(group.commentKey !== undefined && { commentKey: group.commentKey }) })), null, 2)} as Array<{ name: string; label: string; icon: string; parent?: string; comment?: string; commentKey?: string }>;
export const resources: ResourceDefinition[] = ${resourceFields(database, menuGroups, options.realtime, options.pages)};
export const resourceNames = ${JSON.stringify(resourceNames)} as const;
export function getResource(name: string | undefined): ResourceDefinition | undefined { return resources.find((resource) => resource.name === name); }
`,
    ...(Object.keys(treeEntities).length ? {
      "web/app/components/tree-view.tsx": `import { useList } from "@refinedev/core";
import { Alert, Card, Empty, Space, Spin, Tree } from "antd";
import { useNavigate } from "react-router";
import { useState } from "react";
import { buildTree, type QiyTreeNode } from "../tree";

type AntdNode = { key: string; title: string; children: AntdNode[] };
const toAntd = (nodes: Array<QiyTreeNode<Record<string, unknown>>>): AntdNode[] => nodes.map((node) => ({ key: node.key, title: node.title, children: toAntd(node.children) }));

export function TreeView({ resource, parentField, labelField }: { resource: string; parentField: string; labelField: string }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string[]>([]);
  const { result, query } = useList({ resource, pagination: { mode: "off" } });
  const records = (result.data ?? []) as Array<Record<string, unknown>>;
  const { nodes, orphans } = buildTree(records, parentField, labelField);
  return <Card title={resource} extra={<span>{records.length} node(s)</span>}>
    {query.isLoading && <Spin />}
    {query.error && <Alert type="error" message={String(query.error)} />}
    {!query.isLoading && !records.length && <Empty />}
    <Tree treeData={toAntd(nodes)} expandedKeys={expanded} onExpand={(keys) => setExpanded(keys.map(String))} onSelect={(keys) => { const id = String(keys[0] ?? ""); if (id) navigate("/" + resource + "/" + id); }} />
    {orphans.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 16 }} message={orphans.length + " node(s) have a missing or cyclic parent"} />}
  </Card>;
}
`,
      "web/app/routes/tree.tsx": `import { Alert } from "antd";
import { useParams } from "react-router";
import { getResource } from "../resources";
import { treeParents } from "../tree";
import { TreeView } from "../components/tree-view";

export default function ResourceTree() {
  const { resource: name } = useParams();
  const resource = getResource(name);
  const config = name ? treeParents[name] : undefined;
  if (!resource || !config) return <Alert type="error" message="This resource has no tree configuration" />;
  return <TreeView resource={resource.name} parentField={config.parentField} labelField={config.labelField} />;
}
`,
    } : {}),
    "web/app/routes/home.tsx": `import { CanAccess, useCustom, useList, useTranslation } from "@refinedev/core";
import { Card, Col, Progress, Row, Space, Statistic, Typography, theme } from "antd";
import { Link } from "react-router";
import { resources } from "../resources";
 import { dashboardMetrics, type DashboardMetric } from "../dashboard";
 import { qiyIcons } from "../icons";
 import { projectMessage } from "../messages";
import { t, type QiyLocale } from "../i18n";

 function MetricDescription({ metric }: { metric: DashboardMetric }) {
   const { getLocale } = useTranslation();
   const description = metric.commentKey ? projectMessage(getLocale(), metric.commentKey) ?? metric.comment : metric.comment;
   return description ? <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{description}</Typography.Paragraph> : null;
 }

 function DistributionSummary({ metric }: { metric: DashboardMetric }) {
   const { translate } = useTranslation();
   const { token } = theme.useToken();
   const { result, query } = useCustom<{ items: Array<{ value: string | null; count: number }> }>({ url: \`/api/v1/\${metric.resource}/distribution\`, method: "get", config: { query: { field: metric.groupBy } } });
   const resource = resources.find((item) => item.name === metric.resource);
   const field = resource?.fields.find((item) => item.name === metric.groupBy);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const rows = result.data?.items ?? [];
   const total = rows.reduce((sum, row) => sum + row.count, 0);
   return <Col xs={24} sm={12} lg={metric.span}><Card title={<Space><Icon style={{ color: token.colorPrimary }} /><span>{metric.label}</span></Space>} loading={query.isLoading}><MetricDescription metric={metric} />{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map(({ value, count }) => { const item = field?.enumValues?.find((option) => option.name === value); const comment = item?.commentKey ? translate(item.commentKey, {}, item.comment) : item?.comment; return <div key={value ?? "null"}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text title={comment}>{item?.label ?? value ?? "—"}</Typography.Text><Typography.Text type="secondary">{count}</Typography.Text></Space><Progress percent={total ? Math.round(count / total * 100) : 0} showInfo={false} /></div>; })}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
 }
 function TrendSummary({ metric }: { metric: DashboardMetric }) {
   const { result, query } = useCustom<{ items: Array<{ day: string; count: number }> }>({ url: \`/api/v1/\${metric.resource}/trend\`, method: "get", config: { query: { field: metric.groupBy, days: metric.days } } });
   const { token } = theme.useToken();
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const rows = result.data?.items ?? [];
   const max = Math.max(...rows.map((row) => row.count), 0);
   return <Col xs={24} lg={metric.span}><Card title={<Space><Icon style={{ color: token.colorPrimary }} /><span>{metric.label}</span></Space>} loading={query.isLoading}><MetricDescription metric={metric} />{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map((row) => <div key={row.day}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text>{row.day}</Typography.Text><Typography.Text type="secondary">{row.count}</Typography.Text></Space><Progress percent={max ? Math.round(row.count / max * 100) : 0} showInfo={false} /></div>)}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
 }
 function AggregateSummary({ metric }: { metric: DashboardMetric }) {
   const { translate } = useTranslation();
   const { result, query } = useCustom<{ value: number | null; operator: string }>({ url: \`/api/v1/\${metric.resource}/aggregate\`, method: "get", config: { query: { field: metric.field, op: metric.agg ?? "sum" } } });
   const { token } = theme.useToken();
   const resource = resources.find((item) => item.name === metric.resource);
   const field = resource?.fields.find((item) => item.name === metric.field);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const value = result.data?.value;
   const precision = field?.type === "Money" || field?.type === "Decimal" ? 2 : 0;
   const label = field?.label ?? metric.field ?? "";
   return <Col xs={24} sm={12} lg={metric.span}><Card title={<Space><Icon style={{ color: token.colorPrimary }} /><span>{metric.label}</span></Space>} loading={query.isLoading}><MetricDescription metric={metric} />{query.error ? <Typography.Text type="danger">{String(query.error)}</Typography.Text> : <Statistic value={value ?? 0} precision={precision} suffix={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{(metric.agg ?? "sum") + " · " + label}</Typography.Text>} />}{value === null && !query.isLoading && !query.error && <Typography.Text type="secondary">{translate("qiy.noData", {}, "No data")}</Typography.Text>}</Card></Col>;
 }
 function ResourceSummary({ metric }: { metric: DashboardMetric }) {
   if (metric.type === "distribution") return <DistributionSummary metric={metric} />;
   if (metric.type === "trend") return <TrendSummary metric={metric} />;
   if (metric.type === "aggregate") return <AggregateSummary metric={metric} />;
   return <CountSummary metric={metric} />;
 }
 function CountSummary({ metric }: { metric: DashboardMetric }) {
   const { result, query } = useList({ resource: metric.resource, pagination: { currentPage: 1, pageSize: 1 } });
   const { token } = theme.useToken();
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   return <Col xs={24} sm={12} lg={metric.span}><Link to={\`/\${metric.resource}\`}><Card hoverable><Space><Icon style={{ fontSize: 24, color: token.colorPrimary }} /><div><Typography.Text type="secondary">{metric.label}</Typography.Text><MetricDescription metric={metric} /><Statistic value={query.isLoading ? "—" : result.total ?? 0} /></div></Space></Card></Link></Col>;
}
export default function Home() {
  const { getLocale } = useTranslation(); const locale: QiyLocale = getLocale() === "en-US" ? "en-US" : "zh-CN";
   return <Space direction="vertical" size="large" style={{ width: "100%" }}><div><Typography.Title level={2}>{locale === "zh-CN" ? "概览" : "Overview"}</Typography.Title><Typography.Paragraph type="secondary">{locale === "zh-CN" ? "从数据资源快速进入业务管理。" : "Jump into your data resources from one place."}</Typography.Paragraph></div><Row gutter={[16, 16]}>{dashboardMetrics.map((metric) => <CanAccess key={metric.name} resource={metric.resource} action="list"><ResourceSummary metric={metric} /></CanAccess>)}</Row><Card title={t(locale, "quickAccess")}><Space wrap>{resources.slice(0, 4).map((resource) => <CanAccess key={resource.name} resource={resource.name} action="list"><Link to={\`/\${resource.name}\`}>{resource.label}</Link></CanAccess>)}</Space></Card></Space>;
}
`,
    "web/app/messages.ts": `export const defaultMessageLocale = ${JSON.stringify(options.messages?.defaultLocale ?? "zh-CN")};\nexport const projectMessages: Record<string, Record<string, string>> = ${JSON.stringify(options.messages?.locales ?? {}, null, 2)};\nexport function projectMessage(locale: string, key: string): string | undefined { const entries = Object.hasOwn(projectMessages, locale) ? projectMessages[locale] : undefined; if (entries && Object.hasOwn(entries, key)) return entries[key]; const fallback = projectMessages[defaultMessageLocale]; return fallback && Object.hasOwn(fallback, key) ? fallback[key] : undefined; }\n`,
    "web/app/i18n.ts": `import type { I18nProvider } from "@refinedev/core";
import { createInstance, type TOptions } from "i18next";
import { defaultMessageLocale, projectMessage, projectMessages } from "./messages";
import type { Locale } from "antd/es/locale";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
export type QiyLocale = string;
export const supportedLocales: string[] = ${JSON.stringify([...new Set(["zh-CN", "en-US", ...Object.keys(options.messages?.locales ?? {})])])};
export const languageOptions = supportedLocales.map((value) => ({ value, label: new Intl.DisplayNames([value], { type: "language" }).of(value) ?? value }));
export function resolveLocale(value: string | undefined): QiyLocale { return value && supportedLocales.includes(value) ? value : defaultMessageLocale; }
export const localeMessages = { "zh-CN": { new: "新建", edit: "编辑", view: "查看", back: "返回列表", delete: "删除", batchDelete: "批量删除", actions: "操作", visibleColumns: "显示列", confirmDelete: "确认删除选中记录？", deleted: "删除成功", unknownResource: "未知资源", detail: "详情", language: "语言", save: "保存", cancel: "取消", deleteSuccess: "删除成功", quickAccess: "快速访问", upload: "上传文件" }, "en-US": { new: "New", edit: "Edit", view: "View", back: "Back to list", delete: "Delete", batchDelete: "Batch delete", actions: "Actions", visibleColumns: "Columns", confirmDelete: "Delete selected records?", deleted: "Deleted", unknownResource: "Unknown resource", detail: "Detail", language: "Language", save: "Save", cancel: "Cancel", deleteSuccess: "Deleted", quickAccess: "Quick access", upload: "Upload file" } } as const;
export const refineMessages: Record<QiyLocale, Record<string, string>> = {
  "zh-CN": { "buttons.logout": "退出登录", "buttons.create": "新建", "buttons.save": "保存", "buttons.delete": "删除", "buttons.edit": "编辑", "buttons.show": "查看", "buttons.cancel": "取消", "buttons.confirm": "确认", "buttons.refresh": "刷新", "buttons.search": "搜索", "buttons.filter": "筛选", "buttons.clear": "清除", "buttons.export": "导出", "buttons.import": "导入", "warnWhenUnsavedChanges": "更改尚未保存，确定离开吗？" },
  "en-US": { "buttons.logout": "Log out", "buttons.create": "Create", "buttons.save": "Save", "buttons.delete": "Delete", "buttons.edit": "Edit", "buttons.show": "View", "buttons.cancel": "Cancel", "buttons.confirm": "Confirm", "buttons.refresh": "Refresh", "buttons.search": "Search", "buttons.filter": "Filter", "buttons.clear": "Clear", "buttons.export": "Export", "buttons.import": "Import", "warnWhenUnsavedChanges": "You have unsaved changes. Leave this page?" },
};
export const antdLocales: Record<QiyLocale, Locale> = { "zh-CN": zhCN, "en-US": enUS };
Object.assign(refineMessages["en-US"]!, {
  "actions.list": "List", "actions.create": "Create", "actions.edit": "Edit", "actions.show": "Show", "table.actions": "Actions", "dashboard.title": "Dashboard", "loading": "Loading",
  "buttons.undo": "Undo", "buttons.clone": "Clone", "buttons.notAccessTitle": "You don't have permission to access",
  "notifications.success": "Successful", "notifications.error": "Error (status code: {{statusCode}})", "notifications.undoable": "You have {{seconds}} seconds to undo",
  "notifications.createSuccess": "Successfully created {{resource}}", "notifications.createError": "There was an error creating {{resource}} (status code: {{statusCode}})", "notifications.deleteSuccess": "Successfully deleted {{resource}}", "notifications.deleteError": "Error when deleting {{resource}} (status code: {{statusCode}})", "notifications.editSuccess": "Successfully edited {{resource}}", "notifications.editError": "Error when editing {{resource}} (status code: {{statusCode}})", "notifications.importProgress": "Importing: {{processed}}/{{total}}",
  "pages.login.title": "Sign in to your account", "pages.login.signin": "Sign in", "pages.login.fields.email": "Email", "pages.login.fields.password": "Password", "pages.login.buttons.submit": "Login", "pages.login.errors.requiredEmail": "Email is required", "pages.login.errors.requiredPassword": "Password is required",
  "pages.error.info": "You may have forgotten to add the {{action}} component to {{resource}} resource.", "pages.error.404": "Sorry, the page you visited does not exist.", "pages.error.resource404": "Are you sure you have created the {{resource}} resource.", "pages.error.backHome": "Back Home",
  "autoSave.success": "saved", "autoSave.error": "auto save failure", "autoSave.loading": "saving...", "autoSave.idle": "waiting for changes",
});
Object.assign(refineMessages["zh-CN"]!, {
  "actions.list": "列表", "actions.create": "新建", "actions.edit": "编辑", "actions.show": "详情", "table.actions": "操作", "dashboard.title": "工作台", "loading": "加载中",
  "buttons.undo": "撤销", "buttons.clone": "复制", "buttons.notAccessTitle": "没有访问权限",
  "notifications.success": "操作成功", "notifications.error": "操作失败（状态码：{{statusCode}}）", "notifications.undoable": "可在 {{seconds}} 秒内撤销",
  "notifications.createSuccess": "成功创建 {{resource}}", "notifications.createError": "创建 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.deleteSuccess": "成功删除 {{resource}}", "notifications.deleteError": "删除 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.editSuccess": "成功修改 {{resource}}", "notifications.editError": "修改 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.importProgress": "导入进度：{{processed}}/{{total}}",
  "pages.login.title": "登录账户", "pages.login.signin": "登录", "pages.login.fields.email": "邮箱", "pages.login.fields.password": "密码", "pages.login.buttons.submit": "登录", "pages.login.errors.requiredEmail": "请输入邮箱", "pages.login.errors.requiredPassword": "请输入密码",
  "pages.error.info": "可能未为 {{resource}} 资源配置 {{action}} 组件。", "pages.error.404": "页面不存在。", "pages.error.resource404": "请确认已创建 {{resource}} 资源。", "pages.error.backHome": "返回首页",
  "autoSave.success": "已保存", "autoSave.error": "自动保存失败", "autoSave.loading": "保存中", "autoSave.idle": "等待修改",
});
export function getAntdLocale(locale: QiyLocale): Locale { return Object.hasOwn(antdLocales, locale) ? antdLocales[locale]! : enUS; }
export function t(locale: QiyLocale, key: keyof typeof localeMessages["zh-CN"]): string { return projectMessage(locale, "qiy." + key) ?? localeMessages[locale === "zh-CN" ? "zh-CN" : "en-US"][key]; }
export function createI18nProvider(locale: QiyLocale, setLocale?: (next: QiyLocale) => void | Promise<void>): I18nProvider {
  const engine = createInstance();
  const resources = Object.fromEntries(supportedLocales.map((language) => {
    const fallback = language === "zh-CN" ? "zh-CN" : "en-US";
    return [language, { translation: { ...refineMessages[fallback], ...Object.fromEntries(Object.entries(localeMessages[fallback]).map(([key, value]) => ["qiy." + key, value])), ...projectMessages[defaultMessageLocale], ...(Object.hasOwn(projectMessages, language) ? projectMessages[language] : {}) } }];
  }));
  void engine.init({ lng: resolveLocale(locale), fallbackLng: defaultMessageLocale, resources, initAsync: false, keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false } });
  return {
    getLocale: () => engine.language,
    changeLocale: async (next) => {
      if (!supportedLocales.includes(next)) throw new Error("Unsupported interface locale: " + next);
      await engine.changeLanguage(next);
      await setLocale?.(next);
      return next;
    },
    translate: (key, options, defaultMessage) => {
      const parameters: TOptions = options && typeof options === "object" ? options : {};
      const fallback = typeof options === "string" ? options : defaultMessage ?? parameters.defaultValue ?? key;
      if (key.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part))) return String(fallback);
      return String(engine.t(key, { ...parameters, defaultValue: fallback, returnObjects: false, returnDetails: false }));
    },
  };
}
`,
    "web/app/components/resource-page-guard.tsx": `import { CanAccess } from "@refinedev/core";
import { Result } from "antd";
import { useParams } from "react-router";
import { Outlet } from "react-router";

export type ResourcePageAction = "list" | "create" | "show" | "edit";

/**
 * Page level authorization for resource routes. The access-control decision is
 * evaluated for the page action before the page renders, so navigating directly
 * to a URL cannot bypass the menu or button visibility rules.
 */
export function ResourcePageGuard({ action }: { action: ResourcePageAction }) {
  const { resource } = useParams();
  if (!resource) return <Outlet />;
  return <CanAccess resource={resource} action={action} fallback={<Result status="403" title="403" subTitle="没有访问该页面的权限 / You are not allowed to open this page" />}><Outlet /></CanAccess>;
}
`,
    "web/app/routes/guard-list.tsx": `import { ResourcePageGuard } from "../components/resource-page-guard";
export default function GuardList() { return <ResourcePageGuard action="list" />; }
`,
    "web/app/routes/guard-create.tsx": `import { ResourcePageGuard } from "../components/resource-page-guard";
export default function GuardCreate() { return <ResourcePageGuard action="create" />; }
`,
    "web/app/routes/guard-show.tsx": `import { ResourcePageGuard } from "../components/resource-page-guard";
export default function GuardShow() { return <ResourcePageGuard action="show" />; }
`,
    "web/app/routes/guard-edit.tsx": `import { ResourcePageGuard } from "../components/resource-page-guard";
export default function GuardEdit() { return <ResourcePageGuard action="edit" />; }
`,
    "web/app/routes/list.tsx": `import { useCan, useDeleteMany, useGetIdentity, useNotification, useTranslation } from "@refinedev/core";
import { CreateButton, DeleteButton, EditButton, List, ShowButton, useTable } from "@refinedev/antd";
import { Alert, Button, Checkbox, Dropdown, Input, Popconfirm, Popover, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, DownloadOutlined, SaveOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";
import { Link, useParams } from "react-router";
import { useEffect, useState } from "react";
import { canSeeField, getResource } from "../resources";
import { fetchServerViews, publishServerView, type QiyServerView } from "../views-api";
import { useColumnVisibility } from "../hooks/use-column-visibility";
import { qiyIcons } from "../icons";
import { downloadExport, exportUrl, startImport, waitForImport } from "../export";
import { deleteSavedView, listSavedViews, saveView } from "../views";
import { t, type QiyLocale } from "../i18n";
import { downloadFile } from "../hooks/download-file";
import type { BaseRecord } from "@refinedev/core";

function renderCell(field: { name: string; type: string; enumValues?: Array<{ name: string; label?: string; color?: string; icon?: string; comment?: string; commentKey?: string }> }, value: unknown, notify: ReturnType<typeof useNotification>["open"], translate: ReturnType<typeof useTranslation>["translate"]) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "File") return <Typography.Link onClick={() => void downloadFile(String(value)).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{String(value)}</Typography.Link>;
  if (field.type === "Files") {
    const keys = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    if (!keys.length) return "—";
    return <Space wrap>{keys.map((key) => <Typography.Link key={key} onClick={() => void downloadFile(key).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{key.split("/").pop()}</Typography.Link>)}</Space>;
  }
  const enumValue = field.enumValues?.find((item) => item.name === String(value));
  if (enumValue) { const Icon = enumValue.icon ? qiyIcons[enumValue.icon as keyof typeof qiyIcons] : undefined; const comment = enumValue.commentKey ? translate(enumValue.commentKey, {}, enumValue.comment) : enumValue.comment; return <Tag title={comment} color={enumValue.color} icon={Icon ? <Icon /> : undefined}>{enumValue.label ?? enumValue.name}</Tag>; }
  if (field.name.toLowerCase().includes("status") || field.name.toLowerCase() === "role") return <Typography.Text code>{String(value)}</Typography.Text>;
  if (field.type === "Money" || field.type === "Decimal") return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}
export default function ResourceList() {
  const { resource: name } = useParams(); const resource = getResource(name); const { translate, getLocale } = useTranslation(); const { open: notify } = useNotification(); const { data: identity } = useGetIdentity<{ role?: string }>(); const locale: QiyLocale = getLocale() === "en-US" ? "en-US" : "zh-CN";
  const { tableProps, tableQuery, setFilters, setSorters, filters, sorters } = useTable<Record<string, unknown>>({ resource: name ?? "", pagination: { currentPage: 1, pageSize: 10 }, syncWithLocation: true, queryOptions: { enabled: !!resource } });
  const { mutateAsync: removeMany } = useDeleteMany(); const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savedViews, setSavedViews] = useState(() => listSavedViews(name ?? ""));
  const [activeView, setActiveView] = useState<string | undefined>(undefined);
  const [viewName, setViewName] = useState("");
  const [serverViews, setServerViews] = useState<QiyServerView[]>([]);
  useEffect(() => {
    if (!name) return undefined;
    let active = true;
    void fetchServerViews(name).then((items) => { if (active) setServerViews(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [name]);
  const applySavedView = (id: string | undefined) => { setActiveView(id); const shared = id?.startsWith("server:") ?? false; const view = shared ? serverViews.find((item) => "server:" + item.id === id) : savedViews.find((item) => item.id === id); if (!view) return; setSearch(view.search ?? ""); setFilters((view.filters ?? []) as never); setSorters((view.sorters ?? []) as never); if (view.columns?.length) { const columns = view.columns; setVisibleKeys(() => columns); } };
  const storeSavedView = () => { if (!viewName.trim() || !resource) return; setSavedViews(saveView(resource.name, { name: viewName, search, filters: filters as unknown[], sorters: sorters as unknown[], columns: visibleKeys })); setViewName(""); notify?.({ type: "success", message: translate("qiy.saved", {}, "View saved") }); };
  const removeSavedView = () => { if (!resource) return; if (!activeView) return; setSavedViews(deleteSavedView(resource.name, activeView)); setActiveView(undefined); };
  const publishSavedView = async (shared: boolean) => {
    if (!resource || !activeView) return;
    const personal = savedViews.find((item) => item.id === activeView);
    const server = activeView.startsWith("server:") ? serverViews.find((item) => "server:" + item.id === activeView) : undefined;
    const view = personal ?? server;
    if (!view) return;
    try {
      await publishServerView({ resource: resource.name, name: view.name, shared, search: view.search, filters: view.filters as unknown[] | undefined, sorters: view.sorters as unknown[] | undefined, columns: view.columns });
      setServerViews(await fetchServerViews(resource.name));
      notify?.({ type: "success", message: shared ? translate("qiy.viewShared", {}, "View shared with everyone") : translate("qiy.viewPublished", {}, "View saved to server") });
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Publishing the view failed" });
    }
  };
  const runExport = () => { if (!resource) return; setExporting(true); void downloadExport(exportUrl(resource.name, { filters, sorters, columns: visibleKeys${options.readOnly ? "" : ", ids: selectedRowKeys.map(String)"} })).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setExporting(false)); };
  const { data: deletePermission } = useCan({ resource: name ?? "", action: "delete", queryOptions: { enabled: !!resource } });
  const [search, setSearch] = useState(""); const enumFields = resource?.fields.filter((field) => field.filterable && field.enumValues?.length) ?? []; const advancedFields = resource?.fields.filter((field) => field.filterable && !field.enumValues?.length && field.filterModes?.length) ?? []; const [enumFilters, setEnumFilters] = useState<Record<string, string | undefined>>({}); const [advancedFilters, setAdvancedFilters] = useState<Record<string, { operator: string; value: string }>>({}); const [advancedJoin, setAdvancedJoin] = useState<"and" | "or">("and");
  const { visibleKeys, setVisibleKeys } = useColumnVisibility(resource);
  if (!resource) return <Alert type="error" message={translate("qiy.unknownResource", {}, t(locale, "unknownResource"))} />;
  const fields = resource.fields.filter((field) => field.type !== "Vector" && visibleKeys.includes(field.name) && canSeeField(field, identity?.role));
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => {
    const Icon = field.icon ? qiyIcons[field.icon as keyof typeof qiyIcons] : undefined;
    return { title: <Space>{Icon && <Icon />}<span>{field.label}</span></Space>, dataIndex: field.name, key: field.name, sorter: field.sortable, render: (value: unknown) => renderCell(field, value, notify, translate) };
  });
  columns.push({ title: t(locale, "actions"), key: "actions", fixed: "right", render: (_value, record) => <Space>
    <ShowButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <EditButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <DeleteButton resource={resource.name} recordItemId={String(record.id)} hideText />
  </Space> });
  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); notify?.({ type: "success", message: t(locale, "deleteSuccess") }); };
  const applyFilters = (nextSearch = search, nextEnums = enumFilters, nextAdvanced = advancedFilters, nextAdvancedJoin = advancedJoin) => { const filters: Array<{ field: string; operator: string; value: string | string[] } | { operator: "and" | "or"; value: Array<{ field: string; operator: string; value: string | string[] }> }> = nextSearch ? [{ field: "__search", operator: "contains", value: nextSearch }] : []; for (const [field, value] of Object.entries(nextEnums)) if (value) filters.push({ field, operator: "eq", value }); const advanced = Object.entries(nextAdvanced).flatMap(([field, condition]) => !condition.value ? [] : [{ field, operator: condition.operator, value: condition.operator === "in" || condition.operator === "between" ? condition.value.split(",").map((item) => item.trim()) : condition.value }]); if (advanced.length === 1) filters.push(advanced[0]!); else if (advanced.length > 1) filters.push({ operator: nextAdvancedJoin, value: advanced }); setFilters(filters as never); };
  return <List resource={resource.name} title={<Typography.Title level={3} style={{ margin: 0 }}>{resource.label}</Typography.Title>} headerButtons={() => <Space wrap>${options.readOnly ? "" : '<Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(file) => { setImporting(true); void startImport(resource.name, file).then(({ jobId }) => waitForImport(resource.name, jobId, { onProgress: (progress) => notify?.({ type: "progress", message: String(progress.processed) + "/" + String(progress.total) + " row(s) imported" }) })).then((job) => { if (job.status === "failed") throw new Error(job.errors[0] ?? "Import failed"); notify?.({ type: "success", message: String(job.processed) + " row(s) imported" }); return tableQuery.refetch(); }).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setImporting(false)); return Upload.LIST_IGNORE; }}><Button icon={<UploadOutlined />} loading={importing}>{translate("qiy.import", {}, "Import CSV")}</Button></Upload>'}<Button icon={<DownloadOutlined />} loading={exporting} onClick={runExport}>{${options.readOnly ? 'translate("qiy.export", {}, "Export CSV")' : 'selectedRowKeys.length > 0 ? translate("qiy.exportSelected", {}, "Export selected") + " (" + selectedRowKeys.length + ")" : translate("qiy.export", {}, "Export CSV")'}}</Button><Dropdown menu={{ items: resource.fields.filter((field) => field.type !== "Vector").map((field) => ({ key: field.name, label: <Checkbox checked={visibleKeys.includes(field.name)} onChange={(event) => setVisibleKeys((keys) => event.target.checked ? [...keys, field.name] : keys.filter((key) => key !== field.name))}>{field.label}</Checkbox> })) }}><Button icon={<SettingOutlined />}>{t(locale, "visibleColumns")}</Button></Dropdown><Select allowClear style={{ minWidth: 160 }} placeholder={translate("qiy.views", {}, "Saved views")} value={activeView} options={[...savedViews.map((view) => ({ value: view.id, label: view.name })), ...serverViews.map((view) => ({ value: "server:" + view.id, label: view.name + " (shared)" }))]} onChange={(value) => applySavedView(value)} /><Popover trigger="click" content={<Space direction="vertical"><Input value={viewName} placeholder={translate("qiy.viewName", {}, "View name")} onChange={(event) => setViewName(event.target.value)} onPressEnter={storeSavedView} /><Button type="primary" disabled={!viewName.trim()} onClick={storeSavedView}>{translate("qiy.save", {}, "Save")}</Button></Space>}><Button icon={<SaveOutlined />}>{translate("qiy.saveView", {}, "Save view")}</Button></Popover>{activeView && <Popover trigger="click" content={<Space direction="vertical"><Button onClick={() => void publishSavedView(false)}>{translate("qiy.saveToServer", {}, "Save to server")}</Button><Button onClick={() => void publishSavedView(true)}>{translate("qiy.shareView", {}, "Share with everyone")}</Button></Space>}><Button icon={<UploadOutlined />}>{translate("qiy.publishView", {}, "Publish view")}</Button></Popover>}
    {activeView && <Button danger onClick={removeSavedView}>{translate("qiy.deleteView", {}, "Delete view")}</Button>}${Object.keys(treeEntities).length ? `{${JSON.stringify(Object.keys(treeEntities))}.includes(resource.name) && <Link to={"/" + resource.name + "/tree"}><Button>{translate("qiy.treeView", {}, "Tree view")}</Button></Link>}` : ""}<CreateButton resource={resource.name}>{t(locale, "new")}</CreateButton></Space>}>
    <div className="qiy-list-filters" role="search" aria-label={locale === "zh-CN" ? "筛选" : "Filters"}><Input.Search allowClear value={search} placeholder={locale === "zh-CN" ? "搜索" : "Search"} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => { setSearch(value); applyFilters(value); }} />{enumFields.map((field) => <Select key={field.name} allowClear value={enumFilters[field.name]} placeholder={field.label} options={field.enumValues?.map((item) => ({ value: item.name, label: item.label ?? item.name }))} onChange={(value) => { const next = { ...enumFilters, [field.name]: value }; setEnumFilters(next); applyFilters(search, next); }} />)}{advancedFields.length > 1 && <Select value={advancedJoin} style={{ minWidth: 116 }} options={[{ value: "and", label: locale === "zh-CN" ? "全部满足" : "Match all" }, { value: "or", label: locale === "zh-CN" ? "任一满足" : "Match any" }]} onChange={(value: "and" | "or") => { setAdvancedJoin(value); applyFilters(search, enumFilters, advancedFilters, value); }} />}{advancedFields.map((field) => { const condition = advancedFilters[field.name] ?? { operator: field.filterModes[0] ?? "eq", value: "" }; return <Space.Compact key={field.name}><Select value={condition.operator} style={{ width: 120 }} options={field.filterModes.map((mode) => ({ value: mode, label: mode }))} onChange={(operator) => { const next = { ...advancedFilters, [field.name]: { ...condition, operator } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} /><Input allowClear value={condition.value} placeholder={field.label + (condition.operator === "in" || condition.operator === "between" ? " (comma separated)" : "")} onChange={(event) => { const next = { ...advancedFilters, [field.name]: { ...condition, value: event.target.value } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} /></Space.Compact>; })}</div>
    {tableQuery.error && <Alert type="error" showIcon message={String(tableQuery.error)} style={{ marginBottom: 16 }} />}
    {deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}
    <Table<Record<string, unknown>> {...tableProps} pagination={{ ...tableProps.pagination, showSizeChanger: true, pageSizeOptions: ["10", "20", "50", "100"] }} rowSelection={deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined} rowKey="id" columns={columns} scroll={{ x: "max-content" }} />
  </List>;
}
`,
    "web/tests/column-visibility.test.ts": `import { expect, test } from "bun:test";
import { loadColumns } from "../app/hooks/use-column-visibility";
import { resources } from "../app/resources";

test("keeps column choices per resource and adopts new default columns", () => {
  const originalWindow = globalThis.window;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => storage.get(key) ?? null } } });
  try {
    const resource = resources[0]!;
    const defaults = loadColumns(resource);
    expect(defaults).toEqual(resource.fields.filter((field) => field.listVisible).map((field) => field.name));
    storage.set("qiy.columns." + resource.name, JSON.stringify({ fields: [resource.fields[0]!.name], selected: [] }));
    expect(loadColumns(resource)).toEqual(defaults.filter((name) => name !== resource.fields[0]!.name));
    if (resources[1]) expect(loadColumns(resources[1])).toEqual(resources[1].fields.filter((field) => field.listVisible).map((field) => field.name));
  } finally { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); }
});
`,
    ...(distributionEntity && distributionField ? { "web/tests/distribution.test.ts": `import { expect, test } from "bun:test";
import { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";

test("REST distribution fetches aggregated counts without a page-size limit", async () => {
  const requests: string[] = [];
  const fetcher = (async (url: RequestInfo | URL) => { requests.push(String(url)); return Response.json([{ value: "draft", count: 150 }, { value: "approved", count: 100 }]); }) as typeof fetch;
  const result = await createDataProvider(fetcher).custom?.({ url: "/api/v1/${distributionEntity.tableName}/distribution", method: "get", query: { field: "${distributionField.name}" } });
  expect(result?.data.items).toEqual([{ value: "draft", count: 150 }, { value: "approved", count: 100 }]);
  expect(requests).toEqual(["/api/v1/${distributionEntity.tableName}/distribution?field=${distributionField.name}"]);
  await expect(createDataProvider(fetcher).custom?.({ url: "/api/v1/${distributionEntity.tableName}/distribution", method: "get", query: { field: "missing" } })).rejects.toThrow("Unknown distribution field");
});

test("GraphQL distribution selects the same server aggregate", async () => {
  const requests: string[] = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { requests.push(String(init?.body)); return Response.json({ data: { ${distributionEntity.name}Distribution: [{ value: "draft", count: 150 }] } }); }) as typeof fetch;
  const result = await createGraphQLDataProvider(fetcher).custom?.({ url: "/api/v1/${distributionEntity.tableName}/distribution", method: "get", query: { field: "${distributionField.name}" } });
  expect(result?.data.items).toEqual([{ value: "draft", count: 150 }]);
  expect(JSON.parse(requests[0]!).variables).toEqual({ field: "${distributionField.name}" });
});
` } : {}),
    ...(trendEntity && trendField ? { "web/tests/trend.test.ts": `import { expect, test } from "bun:test";
import { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";

test("REST trend requests the selected UTC day window", async () => {
  const requests: string[] = [];
  const fetcher = (async (url: RequestInfo | URL) => { requests.push(String(url)); return Response.json([{ day: "2026-10-06", count: 2 }]); }) as typeof fetch;
  const endpoint = "/api/v1/${trendEntity.tableName}/trend";
  const result = await createDataProvider(fetcher).custom?.({ url: endpoint, method: "get", query: { field: "${trendField.name}", days: 30 } });
  expect(result?.data.items).toEqual([{ day: "2026-10-06", count: 2 }]);
  expect(requests).toEqual([endpoint + "?field=${trendField.name}&days=30"]);
  await expect(createDataProvider(fetcher).custom?.({ url: endpoint, method: "get", query: { field: "${trendField.name}", days: 366 } })).rejects.toThrow("Invalid trend days");
  await expect(createDataProvider(fetcher).custom?.({ url: endpoint, method: "get", query: { field: "missing", days: 30 } })).rejects.toThrow("Unknown trend field");
});

test("GraphQL trend requests the same field and day window", async () => {
  const requests: string[] = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { requests.push(String(init?.body)); return Response.json({ data: { ${trendEntity.name}Trend: [{ day: "2026-10-06", count: 2 }] } }); }) as typeof fetch;
  const result = await createGraphQLDataProvider(fetcher).custom?.({ url: "/api/v1/${trendEntity.tableName}/trend", method: "get", query: { field: "${trendField.name}", days: 30 } });
  expect(result?.data.items).toEqual([{ day: "2026-10-06", count: 2 }]);
  expect(JSON.parse(requests[0]!).variables).toEqual({ field: "${trendField.name}", days: 30 });
});
` } : {}),
    ...(hasOrderWorkflow ? { "web/tests/workflow.test.ts": `import { expect, test } from "bun:test";
import { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";

const orderId = "00000000-0000-4000-8000-000000000001";
for (const [name, createProvider] of [["REST", createDataProvider], ["GraphQL", createGraphQLDataProvider]] as const) {
  test(\`\${name} workflow posts to the same-origin command with idempotency header\`, async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json({ id: orderId, status: "submitted" });
    };
    const result = await createProvider(fetcher).custom?.({ url: \`/api/v1/orders/\${orderId}/submit\`, method: "post", meta: { idempotencyKey: "request-1" } });
    expect(result?.data).toEqual({ id: orderId, status: "submitted" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(\`/api/v1/orders/\${orderId}/submit\`);
    expect(requests[0]?.init?.method).toBe("POST");
    expect((requests[0]?.init?.headers as Record<string, string>)["idempotency-key"]).toBe("request-1");
  });

  test(\`\${name} workflow rejects arbitrary commands and surfaces server errors\`, async () => {
    const fetcher = async () => Response.json({ error: "Only draft orders can be submitted" }, { status: 409 });
    const provider = createProvider(fetcher);
    await expect(provider.custom?.({ url: \`/api/v1/orders/\${orderId}/publish\`, method: "post" })).rejects.toThrow("Unknown workflow command");
    await expect(provider.custom?.({ url: \`/api/v1/orders/\${orderId}/submit\`, method: "post" })).rejects.toThrow("Only draft orders can be submitted");
  });
}
` } : {}),
    "web/tests/i18n.test.ts": `import { expect, test } from "bun:test";
import { createI18nProvider } from "../app/i18n";

test("translates Refine layout and Qiy resource actions", () => {
  const zh = createI18nProvider("zh-CN");
  const en = createI18nProvider("en-US");
  expect(zh.translate("buttons.logout")).toBe("退出登录");
  expect(en.translate("buttons.logout")).toBe("Log out");
  expect(zh.translate("qiy.batchDelete")).toBe("批量删除");
});

test("implements Refine translation overloads, interpolation and asynchronous locale changes", async () => {
  const provider = createI18nProvider("en-US");
  expect(provider.translate("missing.title", "Fallback title")).toBe("Fallback title");
  expect(provider.translate("missing.title", {}, "Fallback title")).toBe("Fallback title");
  expect(provider.translate("missing.welcome", { name: "<Admin>" }, "Hello {{name}}")).toBe("Hello <Admin>");
  expect(provider.translate("missing.count", { count: 0 }, "{{count}} items")).toBe("0 items");
  expect(provider.translate("missing.empty", {}, "")).toBe("");
  expect(provider.translate("notifications.createSuccess", { resource: "Products" })).toBe("Successfully created Products");
  expect(provider.translate("notifications.error", { statusCode: 403 })).toBe("Error (status code: 403)");
  expect(provider.translate("unknown.key")).toBe("unknown.key");
  const changed = provider.changeLocale("zh-CN");
  expect(changed).toBeInstanceOf(Promise);
  await changed;
  expect(provider.getLocale()).toBe("zh-CN");
  expect(provider.translate("buttons.logout")).toBe("退出登录");
  expect(provider.translate("notifications.undoable", { seconds: 5 })).toBe("可在 5 秒内撤销");
  await expect(provider.changeLocale("unsupported")).rejects.toThrow("Unsupported interface locale");
  expect(provider.getLocale()).toBe("zh-CN");
  expect(createI18nProvider("en-US").getLocale()).toBe("en-US");
});
`,
    "web/tests/export.test.ts": `import { describe, expect, test } from "bun:test";
import { downloadExport, encodeExportFilters, exportUrl, uploadImport } from "../app/export";

describe("CSV export helper", () => {
  test("encodes the table filter state the API accepts", () => {
    expect(encodeExportFilters([{ field: "__search", operator: "contains", value: "phone" }, { field: "status", operator: "eq", value: "approved" }])).toEqual([{ field: "status", operator: "eq", value: "approved" }]);
    expect(encodeExportFilters([{ field: "tags", operator: "in", value: ["a", "b"] }])).toEqual([{ field: "tags", operator: "in", value: "a,b" }]);
    expect(encodeExportFilters([{ operator: "and", value: [{ field: "a", operator: "eq", value: "1" }, { operator: "or", value: [{ field: "b", operator: "eq", value: "2" }, { field: "c", operator: "eq", value: "3" }] }] }])).toEqual([{ operator: "and", value: [{ field: "a", operator: "eq", value: "1" }, { operator: "or", value: [{ field: "b", operator: "eq", value: "2" }, { field: "c", operator: "eq", value: "3" }] }] }]);
    // A group without usable children disappears instead of sending an empty condition.
    expect(encodeExportFilters([{ operator: "or", value: [{ field: "q", operator: "contains", value: "x" }] }])).toEqual([]);
  });

  test("builds the export URL from filters and the first sorter", () => {
    expect(exportUrl("orders")).toBe("/api/v1/orders/export");
    const url = new URL(exportUrl("orders", { filters: [{ field: "status", operator: "eq", value: "open" }], sorters: [{ field: "title", order: "desc" }, { field: "id", order: "asc" }] }), "http://localhost");
    expect(url.pathname).toBe("/api/v1/orders/export");
    expect(JSON.parse(url.searchParams.get("filters")!)).toEqual([{ field: "status", operator: "eq", value: "open" }]);
    expect(url.searchParams.get("sort")).toBe("title");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(new URL(exportUrl("orders", { sorters: [{ field: "title", order: "asc" }] }), "http://localhost").searchParams.get("order")).toBeNull();
    // A row selection narrows the export to those ids.
    expect(new URL(exportUrl("orders", { ids: ["a", 1] }), "http://localhost").searchParams.get("ids")).toBe("a,1");
    expect(new URL(exportUrl("orders", { ids: [] }), "http://localhost").searchParams.get("ids")).toBeNull();
  });

  test("surfaces the server refusal instead of downloading a partial file", async () => {
    const refusing = (async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ error: "Export is limited to 1000 rows; narrow the filters", errorKey: "export.tooLarge" }), { status: 400, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    await expect(downloadExport("/api/v1/orders/export", refusing)).rejects.toThrow("Export is limited to 1000 rows");
    const forbidden = (async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("", { status: 401 })) as typeof fetch;
    await expect(downloadExport("/api/v1/orders/export", forbidden)).rejects.toThrow("Export failed: 401");
  });

  test("uploads a CSV import and surfaces row errors", async () => {
    const calls: Array<{ url: string; body?: string; contentType?: string }> = [];
    const accepting = (async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : await (init?.body as Blob | undefined)?.text(), contentType: (init?.headers as Record<string, string>)["Content-Type"] }); return Response.json({ imported: 3 }); }) as typeof fetch;
    await expect(uploadImport("orders", new Blob(["code\\nA\\n"]), accepting)).resolves.toBe(3);
    expect(calls[0]?.url).toBe("/api/v1/orders/import");
    expect(calls[0]?.contentType).toBe("text/csv");
    expect(calls[0]?.body).toBe("code\\nA\\n");
    const rejecting = (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: "Row 2: duplicate code", errorKey: "import.invalidRow" }, { status: 400 })) as typeof fetch;
    await expect(uploadImport("orders", new Blob(["code\\n"]), rejecting)).rejects.toThrow("Row 2: duplicate code");
  });
});
`,
    "web/tests/data-provider.test.ts": `import { describe, expect, test } from "bun:test";\nimport { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";\nconst requests: Array<{ url: string; method: string; body?: string }> = [];\nconst fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); const method = init?.method ?? "GET"; requests.push({ url, method, body: init?.body?.toString() }); const body = method === "GET" && url.includes("?") ? { data: [{ id: "one" }], total: 1 } : method === "DELETE" && url.includes("ids=") ? [{ id: "one" }] : { id: "one" }; return new Response(JSON.stringify(body), { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } }); }) as typeof fetch;\ndescribe("same-origin Refine provider", () => { test("maps list and mutations", async () => { requests.length = 0; const provider = createDataProvider(fetcher); await provider.getList({ resource: "products", pagination: { currentPage: 2, pageSize: 5 } }); await provider.getOne({ resource: "products", id: "one" }); await provider.create({ resource: "products", variables: { title: "New" } }); await provider.update({ resource: "products", id: "one", variables: { title: "Updated" } }); await provider.deleteOne({ resource: "products", id: "one" }); await provider.deleteMany?.({ resource: "products", ids: ["one", "two"] }); expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "POST", "PATCH", "DELETE", "DELETE"]); }); test("encodes table query state", async () => { requests.length = 0; const provider = createDataProvider(fetcher); await provider.getList({ resource: "products", pagination: { currentPage: 3, pageSize: 10 }, sorters: [{ field: "name", order: "desc" }], filters: [{ field: "__search", operator: "contains", value: "phone" }, { field: "status", operator: "eq", value: "approved" }] }); const url = new URL(requests[0]!.url, "http://localhost"); expect(url.searchParams.get("page")).toBe("3"); expect(url.searchParams.get("pageSize")).toBe("10"); expect(url.searchParams.get("sort")).toBe("name"); expect(url.searchParams.get("order")).toBe("desc"); expect(url.searchParams.get("search")).toBe("phone"); expect(JSON.parse(url.searchParams.get("filters") ?? "{}")).toEqual([{ field: "status", operator: "eq", value: "approved" }]); }); test("maps GraphQL list variables", async () => { requests.length = 0; const provider = createGraphQLDataProvider(async (input, init) => { requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body?.toString() }); return new Response(JSON.stringify({ data: { products: { items: [{ id: "one" }], total: 1 } } }), { status: 200, headers: { "Content-Type": "application/json" } }); }); const result = await provider.getList({ resource: "products", pagination: { currentPage: 2, pageSize: 5 }, sorters: [{ field: "name", order: "desc" }] }); expect(result.total).toBe(1); const payload = JSON.parse(requests[0]!.body ?? "{}"); expect(payload.variables).toEqual({ page: 2, pageSize: 5, search: undefined, sort: "name", order: "desc", filters: [] }); }); test("rejects unknown resources", () => { const provider = createDataProvider(fetcher); expect(() => provider.getList({ resource: "../secrets" })).toThrow("Unknown resource"); }); });\n`.replaceAll('"products"', JSON.stringify(database.entities[0]!.tableName)).replace("data: { products:", `data: { ${database.entities[0]!.name}:`),
  };
  if (usesOidcAuth) generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace('  route("auth/login", "./routes/login.tsx"),', '  route("auth/login", "./routes/login.tsx"),\n  route("auth/callback", "./routes/auth-callback.tsx"),');
  if (actionDefinitions.length) {
    generated["web/app/routes/list.tsx"] = generated["web/app/routes/list.tsx"]!
      .replace('import { downloadFile } from "../hooks/download-file";', 'import { downloadFile } from "../hooks/download-file";\nimport { BatchBusinessActions, BusinessActions } from "../components/business-actions";')
      .replace('  </Space> });', '    <BusinessActions resource={resource.name} placement="list" record={record} />\n  </Space> });');
    if (actionDefinitions.some((action) => action.batch)) {
      generated["web/app/routes/list.tsx"] = generated["web/app/routes/list.tsx"]!
        .replace('    {deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm', '    {selectedRowKeys.length > 0 && <BatchBusinessActions resource={resource.name} recordIds={selectedRowKeys.map(String)} onComplete={() => setSelectedRowKeys([])} />}\n    {deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm')
        .replace(' rowSelection={deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined}', ' rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}');
    }
    const manualActions = actionDefinitions.filter((action): action is GeneratedAction & { target: Extract<GeneratedAction["target"], { kind: "navigate" }> } => action.target.kind === "navigate");
    if (manualActions.length) {
      const routeLines = manualActions.map((action) => `  route(${JSON.stringify(action.target.path.slice(1))}, ${JSON.stringify(`./routes/actions/${action.name}.tsx`)}),`).join("\n");
      generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace('  layout("./routes/guard-list.tsx", [route(":resource", "./routes/list.tsx")]),', `${routeLines}\n  layout("./routes/guard-list.tsx", [route(":resource", "./routes/list.tsx")]),`);
      for (const action of manualActions) {
        generated[`web/app/routes/actions/${action.name}.tsx`] = `import { CanAccess } from "@refinedev/core";\nimport { Result } from "antd";\nimport { useParams } from "react-router";\nimport ManualPage from "../../extensions/${action.name}";\n\nexport default function QiyProtectedActionPage() { const { id } = useParams(); return <CanAccess resource=${JSON.stringify(action.resource)} action=${JSON.stringify(action.name)} params={{ id }} fallback={<Result status="403" title="403" />}><ManualPage /></CanAccess>; }\n`;
        generated[`web/app/extensions/${action.name}.tsx`] = `import { useTranslation } from "@refinedev/core";\nimport { Button, Card, Typography } from "antd";\nimport { Link, useParams } from "react-router";\n\nexport default function QiyManualActionPage() { const { id } = useParams(); const { translate } = useTranslation(); return <Card title=${JSON.stringify(action.label)}><Typography.Paragraph>{${action.target.commentKey ? `translate(${JSON.stringify(action.target.commentKey)}, {}, ${JSON.stringify(action.target.comment)})` : JSON.stringify(action.target.comment)}}</Typography.Paragraph><Typography.Text type="secondary">Resource ID: {id}</Typography.Text><div style={{ marginTop: 16 }}><Link to={${JSON.stringify(`/${action.resource}/`)} + encodeURIComponent(id ?? "")}><Button>{translate("buttons.list", {}, "Back")}</Button></Link></div></Card>; }\n`;
      }
    }
    const commandAction = actionDefinitions.find((action) => action.target.kind === "dataflow");
    const conditionalAction = actionDefinitions.find((action) => action.condition);
    if (commandAction?.target.kind === "dataflow") {
      const commandPayload = commandAction.batch
        ? { items: [{ [commandAction.target.idInput]: "record-1" }, { [commandAction.target.idInput]: "record-2" }] }
        : { [commandAction.target.idInput]: "record-1" };
      generated["web/tests/actions.test.ts"] = `import { expect, test } from "bun:test";\nimport { actionMatchesRecord, qiyActions } from "../app/actions";\nimport { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";\n\ntest("declared actions preserve placement and targets", () => { expect(qiyActions.find((action) => action.name === ${JSON.stringify(commandAction.name)})?.placements).toEqual(${JSON.stringify(commandAction.placements)}); });\n${conditionalAction?.condition ? `test("action conditions fail closed against the current record", () => { const action = qiyActions.find((candidate) => candidate.name === ${JSON.stringify(conditionalAction.name)})!; expect(actionMatchesRecord(action, { ${JSON.stringify(conditionalAction.condition.field)}: ${JSON.stringify(conditionalAction.condition.value)} })).toBe(${conditionalAction.condition.operator === "=="}); expect(actionMatchesRecord(action, { ${JSON.stringify(conditionalAction.condition.field)}: "__different__" })).toBe(${conditionalAction.condition.operator === "!="}); expect(actionMatchesRecord(action, {})).toBe(false); });\n` : ""}for (const [name, createProvider] of [["REST", createDataProvider], ["GraphQL", createGraphQLDataProvider]] as const) test(name + " ${commandAction.batch ? "batch " : ""}dataflow command sends JSON values and rejects undeclared commands", async () => { const requests: Array<{ url: string; init?: RequestInit }> = []; const provider = createProvider(async (url, init) => { requests.push({ url: String(url), init }); return Response.json(${commandAction.batch ? "[]" : '{ id: "record-1" }'}); }); await provider.custom?.({ url: ${JSON.stringify(commandAction.target.url)}, method: "post", payload: ${JSON.stringify(commandPayload)} }); expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(${JSON.stringify(commandPayload)}); expect((requests[0]?.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json"); await expect(provider.custom?.({ url: "/api/v1/commands/not-declared", method: "post", payload: {} })).rejects.toThrow("Unknown workflow command"); });\n`;
    }
  }
  generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace("__QIY_TREE_ROUTE__", Object.keys(treeEntities).length ? '  route(":resource/tree", "./routes/tree.tsx"),\n' : "");
  if (options.readOnly) {
    generated["web/app/root.tsx"] = generated["web/app/root.tsx"]!
      .replace('      create: `/${resource.name}/new`,\n', "")
      .replace('      edit: `/${resource.name}/:id/edit`,\n', "");
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!
      .replace('  layout("./routes/guard-create.tsx", [route(":resource/new", "./routes/create.tsx")]),\n', "")
      .replace('  layout("./routes/guard-edit.tsx", [route(":resource/:id/edit", "./routes/edit.tsx")]),\n', "");
    let list = generated["web/app/routes/list.tsx"]!;
    for (const [from, to] of [
      ['import { useCan, useDeleteMany, useGetIdentity, useNotification, useTranslation } from "@refinedev/core";', 'import { useGetIdentity, useNotification, useTranslation } from "@refinedev/core";'],
      ['import { CreateButton, DeleteButton, EditButton, List, ShowButton, useTable } from "@refinedev/antd";', 'import { List, ShowButton, useTable } from "@refinedev/antd";'],
      ['import { DeleteOutlined, DownloadOutlined, SaveOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";', 'import { DownloadOutlined, SaveOutlined, SettingOutlined } from "@ant-design/icons";'],
      ['import { Alert, Button, Checkbox, Dropdown, Input, Popconfirm, Popover, Select, Space, Table, Tag, Typography, Upload } from "antd";', 'import { Alert, Button, Checkbox, Dropdown, Input, Popover, Select, Space, Table, Tag, Typography } from "antd";'],
      ['  const { mutateAsync: removeMany } = useDeleteMany(); const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);\n', ""],
      ['  const { data: deletePermission } = useCan({ resource: name ?? "", action: "delete", queryOptions: { enabled: !!resource } });\n', ""],
      ['    <EditButton resource={resource.name} recordItemId={String(record.id)} hideText />\n', ""],
      ['    <DeleteButton resource={resource.name} recordItemId={String(record.id)} hideText />\n', ""],
      ['  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); notify?.({ type: "success", message: t(locale, "deleteSuccess") }); };\n', ""],
      ['<CreateButton resource={resource.name}>{t(locale, "new")}</CreateButton>', ""],
      ['    {deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}\n', ""],
      [' rowSelection={deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined}', ""],
    ] as const) list = list.replace(from, to);
    if (/useDelete|useDeleteMany|deletePermission|CreateButton|EditButton|DeleteButton|selectedRowKeys|Popconfirm|DeleteOutlined|routes\/(create|edit)/.test(list)) {
      throw new Error("Could not safely apply read-only integration UI policy");
    }
    generated["web/app/routes/list.tsx"] = list;
    generated["web/app/routes/show.tsx"] = generated["web/app/routes/show.tsx"]!
      .replace('<CanAccess resource={resource.name} action="edit"><Link to={`/${resource.name}/${id}/edit`}><Button type="primary">{t(locale, "edit")}</Button></Link></CanAccess>', "")
      .replace('import { CanAccess, useOne, useTranslation } from "@refinedev/core";', 'import { useOne, useTranslation } from "@refinedev/core"');
    for (const path of ["web/app/routes/create.tsx", "web/app/routes/edit.tsx", "web/app/routes/guard-create.tsx", "web/app/routes/guard-edit.tsx", "web/app/components/resource-form.tsx"]) delete generated[path];
  }
  const localizedFailure = (options.dataflows ?? []).flatMap((flow) => flow.steps.flatMap((step) => step.actions.flatMap((action) => action.kind === "require" && action.errorKey ? [{ flow: flow.name, error: action.error, errorKey: action.errorKey }] : [])))[0];
  if (localizedFailure && options.messages) {
    generated["web/tests/api-error.test.ts"] = `import { expect, test } from "bun:test";
import { qiyApiError } from "../app/api-error";
import { createDataProvider } from "../app/data-provider";
const failure = ${JSON.stringify({ error: localizedFailure.error, errorKey: localizedFailure.errorKey })};
test("translates declared business errors and keeps status and key", () => {
${Object.entries(options.messages.locales).map(([locale, entries]) => `  expect(qiyApiError(failure, 409, ${JSON.stringify(locale)})).toMatchObject({ message: ${JSON.stringify(entries[localizedFailure.errorKey] ?? localizedFailure.error)}, statusCode: 409, errorKey: failure.errorKey });`).join("\n")}
  expect(qiyApiError({ error: "fallback", errorKey: "missing" }, 409, "zh-CN").message).toBe("fallback");
  expect(qiyApiError({ error: "literal" }, 409, "zh-CN").message).toBe("literal");
});
test("Refine custom command preserves the localized API error contract", async () => {
  const provider = createDataProvider(async () => Response.json(failure, { status: 409 }));
  await expect(provider.custom!({ url: ${JSON.stringify(`/api/v1/commands/${localizedFailure.flow}`)}, method: "post", payload: {} })).rejects.toMatchObject({ message: failure.error, statusCode: 409, errorKey: failure.errorKey });
});
`;
  }
  if (options.messages) {
    generated["web/app/root.tsx"] = generated["web/app/root.tsx"]!.replace('useState<QiyLocale>("zh-CN")', `useState<QiyLocale>(${JSON.stringify(options.messages.defaultLocale)})`);
    generated["web/app/root.tsx"] = generated["web/app/root.tsx"]!.replace('lang="zh-CN"', `lang=${JSON.stringify(options.messages.defaultLocale)}`);
    generated["web/tests/project-messages.test.ts"] = `import { expect, test } from "bun:test";
import { createI18nProvider, languageOptions, supportedLocales, resolveLocale, getAntdLocale, t } from "../app/i18n";
import { defaultMessageLocale, projectMessage } from "../app/messages";
test("switches model descriptions and falls back to the configured default locale", () => {
${Object.entries(options.messages.locales).flatMap(([locale, entries]) => Object.entries(entries).map(([key, message]) => `  expect(createI18nProvider(${JSON.stringify(locale)}).translate(${JSON.stringify(key)})).toBe(${JSON.stringify(message)});`)).join("\n")}
${Object.entries(options.messages.locales[options.messages.defaultLocale]!).map(([key, message]) => `  expect(projectMessage(${JSON.stringify(options.messages!.defaultLocale === "en-US" ? "zh-CN" : "en-US")}, ${JSON.stringify(key)})).toBe(${JSON.stringify(options.messages!.locales[options.messages!.defaultLocale === "en-US" ? "zh-CN" : "en-US"]?.[key] ?? message)});`).join("\n")}
  expect(projectMessage("en-US", "__proto__")).toBeUndefined();
  expect(projectMessage("zh-CN", "constructor")).toBeUndefined();
  expect(createI18nProvider("en-US").translate("constructor")).toBe("constructor");
  expect(createI18nProvider("zh-CN").translate("__proto__", {}, "Fallback")).toBe("Fallback");
});
test("switches declared locales, configures components and refuses undeclared locales", async () => {
  let selected = defaultMessageLocale;
  const provider = createI18nProvider(defaultMessageLocale, (next) => { selected = next; });
  for (const locale of supportedLocales) {
    await provider.changeLocale(locale);
    expect(selected).toBe(locale);
    expect(provider.getLocale()).toBe(locale);
    expect(languageOptions.some((option) => option.value === locale && option.label.length > 0)).toBe(true);
    expect(getAntdLocale(locale)).toBeDefined();
    expect(t(locale, "new")).toBe(projectMessage(locale, "qiy.new") ?? (locale === "zh-CN" ? "新建" : "New"));
  }
  await expect(provider.changeLocale("not-a-declared-locale")).rejects.toThrow("Unsupported interface locale");
  expect(resolveLocale("not-a-declared-locale")).toBe(defaultMessageLocale);
  expect(createI18nProvider("__proto__").translate("constructor")).toBe("constructor");
});
${Object.entries(options.messages.locales).flatMap(([locale, entries]) => Object.keys(entries).filter((key) => key.endsWith("_other") && Object.hasOwn(entries, key.slice(0, -6) + "_one")).map((key) => {
  const base = key.slice(0, -6);
  return `test(${JSON.stringify("selects localized plural forms for " + locale + " " + base)}, () => {\n  const provider = createI18nProvider(${JSON.stringify(locale)});\n${[1, 2].map((count) => {
    const category = new Intl.PluralRules(locale).select(count);
    const message = entries[base + "_" + category] ?? entries[key]!;
    return `  expect(provider.translate(${JSON.stringify(base)}, { count: ${count} })).toBe(${JSON.stringify(message.replaceAll("{{count}}", String(count)))});`;
  }).join("\n")}\n});`;
})).join("\n")}
`;
  }
  const componentLocales: Record<string, string> = { "ja-JP": "ja_JP", "ko-KR": "ko_KR", "fr-FR": "fr_FR", "de-DE": "de_DE", "es-ES": "es_ES", "pt-BR": "pt_BR", "ru-RU": "ru_RU", "ar-EG": "ar_EG", "hi-IN": "hi_IN", "it-IT": "it_IT", "zh-TW": "zh_TW" };
  const extraLocales = Object.keys(options.messages?.locales ?? {}).filter((locale) => Object.hasOwn(componentLocales, locale));
  generated["web/app/i18n.ts"] = generated["web/app/i18n.ts"]!
    .replace('import enUS from "antd/locale/en_US";', `import enUS from "antd/locale/en_US";\n${extraLocales.map((locale, index) => `import extraLocale${index} from "antd/locale/${componentLocales[locale]}";`).join("\n")}`)
    .replace('"en-US": enUS };', `"en-US": enUS${extraLocales.map((locale, index) => `, ${JSON.stringify(locale)}: extraLocale${index}`).join("")} };`);
  for (const path of Object.keys(generated)) {
    if (!path.startsWith("web/app/")) continue;
    generated[path] = generated[path]!.replaceAll('getLocale() === "en-US" ? "en-US" : "zh-CN"', 'resolveLocale(getLocale())');
    if (generated[path]!.includes("resolveLocale(getLocale())")) generated[path] = generated[path]!.replace('import { t, type QiyLocale }', 'import { t, resolveLocale, type QiyLocale }');
  }
  if (options.auth) {
    const userTable = database.entities.find((entity) => entity.name === options.auth!.userEntity)!.tableName;
    generated["web/app/auth.ts"] = generated["web/app/auth.ts"]!
      .replace('resource === "users"', `resource === ${JSON.stringify(userTable)}`)
      .replace('if (identity.role === "admin")', 'if (action === "audit") return { can: identity.role === "admin" }; if (identity.role === "admin")');
    generated["web/tests/auth.test.ts"] = generated["web/tests/auth.test.ts"]!.replaceAll('resource: "users"', `resource: ${JSON.stringify(userTable)}`).replaceAll('resource === "users"', `resource === ${JSON.stringify(userTable)}`);
    generated["web/app/root.tsx"] = 'import { auditLogProvider } from "./providers/audit-log-provider";\n' + generated["web/app/root.tsx"]!.replace("authProvider={qiyAuthProvider}", "auditLogProvider={auditLogProvider} authProvider={qiyAuthProvider}").replace("meta: { label: resource.label", "meta: { audit: [], label: resource.label");
    generated["web/app/routes/show.tsx"] = 'import { AuditHistory } from "../components/audit-history";\n' + generated["web/app/routes/show.tsx"]!.replace('</Show>;', '{id && <CanAccess resource={resource.name} action="audit"><AuditHistory resource={resource.name} recordId={id} /></CanAccess>}</Show>;');
    generated["web/app/providers/audit-log-provider.ts"] = `import type { AuditLogProvider } from "@refinedev/core";
import { qiyAuthToken } from "../auth";
import { resourceNames } from "../resources";

export function createAuditLogProvider(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch): AuditLogProvider {
  return {
    get: async ({ resource, meta, action, author }) => {
      if (!(resourceNames as readonly string[]).includes(resource)) throw new Error("Unknown audit resource");
      const params = new URLSearchParams({ resource, page: String(meta?.page ?? 1), pageSize: String(meta?.pageSize ?? 20) });
      if (meta?.id !== undefined) params.set("resourceId", String(meta.id));
      if (action) params.set("action", ({ create: resource + ".created", update: resource + ".updated", delete: resource + ".deleted" } as Record<string, string>)[action] ?? action);
      if (author?.id !== undefined) params.set("actorId", String(author.id));
      const token = qiyAuthToken();
      const response = await fetcher("/api/v1/audit-logs/?" + params, { headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.error ?? "Audit request failed"), { statusCode: response.status });
      return body;
    },
    create: async () => { throw new Error("Audit events are written in server transactions; client writes are disabled"); },
    update: async () => { throw new Error("Authoritative audit history is immutable"); },
  };
}
export const auditLogProvider = createAuditLogProvider();
`;
    generated["web/tests/audit-provider.test.ts"] = `import { expect, test } from "bun:test";
import { createAuditLogProvider } from "../app/providers/audit-log-provider";
import { qiyAuthProvider } from "../app/auth";

test("audit provider maps Refine filters, propagates authentication errors and disallows writes", async () => {
  let requested = "";
  const provider = createAuditLogProvider(async (input) => { requested = String(input); return Response.json({ data: [], total: 0 }); });
  const resource = ${JSON.stringify(database.entities[0]!.tableName)};
  expect(await provider.get({ resource, action: "update", meta: { id: "record", page: 2 }, author: { id: "actor" } })).toEqual({ data: [], total: 0 });
  const query = new URL(requested, "http://localhost").searchParams;
  expect(query.get("resourceId")).toBe("record"); expect(query.get("action")).toBe(resource + ".updated"); expect(query.get("page")).toBe("2"); expect(query.get("actorId")).toBe("actor");
  await expect(provider.create({ resource, action: "create", meta: {} })).rejects.toThrow("client writes are disabled");
  await expect(provider.update({ id: "event", name: "forged" })).rejects.toThrow("immutable");
  await expect(provider.get({ resource: "unknown" })).rejects.toThrow("Unknown audit resource");
  const failing = createAuditLogProvider(async () => Response.json({ error: "Expired" }, { status: 401 }));
  try { await failing.get({ resource }); throw new Error("Expected rejection"); } catch (error) { expect(error).toMatchObject({ statusCode: 401, message: "Expired" }); expect(await qiyAuthProvider.onError(error)).toMatchObject({ logout: true }); }
  expect(await qiyAuthProvider.onError({ statusCode: 403 })).toEqual({});
});
`;
    generated["web/app/components/audit-history.tsx"] = `import { useLogList, useTranslation } from "@refinedev/core";
import { Alert, Card, Table } from "antd";
import { useState } from "react";

type AuditEntry = { id: string; action: string; createdAt: string; author: { id: string; name: string; deleted: boolean } | null };
export function AuditHistory({ resource, recordId }: { resource: string; recordId: string }) {
  const [page, setPage] = useState(1);
  const { translate } = useTranslation();
  const query = useLogList<{ data: AuditEntry[]; total: number }>({ resource, meta: { id: recordId, page, pageSize: 10 } });
  return <Card title={translate("audit.title", "Audit history")} style={{ marginTop: 16 }}>{query.error ? <Alert type="error" message={query.error.message} /> : <Table<AuditEntry> rowKey="id" loading={query.isLoading} dataSource={query.data?.data ?? []} pagination={{ current: page, pageSize: 10, total: query.data?.total ?? 0, showSizeChanger: false, onChange: setPage }} columns={[{ title: translate("audit.action", "Action"), dataIndex: "action" }, { title: translate("audit.author", "Author"), render: (_, row) => row.author?.name ?? translate("audit.system", "System") }, { title: translate("audit.time", "Time"), dataIndex: "createdAt" }]} />}</Card>;
}
`;
  }
  if (usesRealtime) {
    const webPackage = JSON.parse(generated["web/package.json"]!) as { dependencies: Record<string, string> };
    webPackage.dependencies.ably = "2.29.0";
    generated["web/package.json"] = `${JSON.stringify(webPackage, null, 2)}\n`;
    generated["web/app/providers/live-provider.ts"] = `import * as Ably from "ably";
import type { LiveEvent, LiveProvider } from "@refinedev/core";

type QiySubscription = {
  channel?: Ably.RealtimeChannel;
  types: string[];
  listener: (message: Ably.InboundMessage) => void;
};

type QiyCapabilityMap = Record<string, string[]>;

/**
 * Claim-scoped resources publish to a segmented channel (qiy:orders:eu), so the
 * client resolves the channel it was actually granted from the token capability
 * instead of assuming the base resource name.
 */
function grantedChannel(capabilities: QiyCapabilityMap, resource: string): string {
  const base = "qiy:" + resource;
  if (Array.isArray(capabilities[base])) return base;
  return Object.keys(capabilities).find((channel) => channel.startsWith(base + ":")) ?? base;
}

export function createQiyLiveProvider(fetcher: typeof fetch = fetch, injected?: Ably.Realtime): LiveProvider | undefined {
  if (typeof window === "undefined" && !injected) return undefined;
  const client = injected ?? new Ably.Realtime({
    authCallback: async (_params, callback) => {
      try {
        const token = window.localStorage.getItem("qiy.access_token");
        const response = await fetcher("/api/v1/realtime/token", { method: "POST", headers: token ? { Authorization: "Bearer " + token } : {} });
        const body = await response.json() as any;
        if (!response.ok) throw new Error(body.error ?? "Realtime authorization failed");
        callback(null, body);
      } catch (error) { callback(error as any, null); }
    },
  });
  let capabilityPromise: Promise<QiyCapabilityMap> | undefined;
  const capabilities = () => capabilityPromise ??= (async (): Promise<QiyCapabilityMap> => {
    try {
      const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
      const response = await fetcher("/api/v1/realtime/token", { method: "POST", headers: token ? { Authorization: "Bearer " + token } : {} });
      if (!response.ok) return {};
      const body = await response.json() as { capability?: unknown };
      const parsed = typeof body.capability === "string" ? JSON.parse(body.capability) as QiyCapabilityMap : body.capability as QiyCapabilityMap;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch { return {}; }
  })();
  return {
    subscribe: ({ channel, types, callback, params, meta }) => {
      // Show and many pages only care about specific records, so they get the same
      // channel but are scoped to their ids instead of every event for the resource.
      const scopedIds = [params?.id, ...(Array.isArray(params?.ids) ? params.ids : [])]
        .filter((value) => value !== undefined && value !== null && value !== "")
        .map((value) => String(value));
      const listener = (message: Ably.InboundMessage) => {
        const payload = message.data && typeof message.data === "object" && !Array.isArray(message.data) ? message.data : { data: message.data };
        if (scopedIds.length) {
          const record = payload as Record<string, unknown>;
          const nested = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : undefined;
          const recordId = record.id ?? nested?.id;
          if (recordId === undefined || !scopedIds.includes(String(recordId))) return;
        }
        callback({ channel, type: message.name ?? "*", payload, date: new Date(message.timestamp ?? Date.now()), meta } satisfies LiveEvent);
      };
      const subscription: QiySubscription = { types, listener };
      void (async () => {
        const target = grantedChannel(await capabilities(), channel);
        const ablyChannel = client.channels.get(target);
        subscription.channel = ablyChannel;
        await ablyChannel.subscribe(types, listener).catch((error) => console.error("Realtime subscription failed", { channel: target, error }));
      })();
      return subscription;
    },
    unsubscribe: (subscription: QiySubscription) => subscription.channel?.unsubscribe(subscription.types, subscription.listener),
  };
}

export const qiyLiveProvider = createQiyLiveProvider();
`;
    generated["web/app/root.tsx"] = 'import { qiyLiveProvider } from "./providers/live-provider";\n' + generated["web/app/root.tsx"]!.replace("dataProvider={dataProvider}", "dataProvider={dataProvider} liveProvider={qiyLiveProvider}");
    generated["web/tests/live-provider.test.ts"] = `import { expect, test } from "bun:test";
import { createQiyLiveProvider } from "../app/providers/live-provider";

function fakeClient() {
  const listeners: Array<(message: unknown) => void> = [];
  const channels: string[] = [];
  const unsubscribed: number[] = [];
  const client = {
    channels: {
      get: (name: string) => {
        channels.push(name);
        return {
          subscribe: (types: string[], listener: (message: unknown) => void) => { listeners.push(listener); return Promise.resolve(); },
          unsubscribe: () => { unsubscribed.push(1); },
        };
      },
    },
  };
  return { client, listeners, channels, unsubscribed };
}

function event(id: string | undefined, name = "updated") {
  return { name, data: id === undefined ? { title: "no id" } : { id, title: "row " + id }, timestamp: 1 };
}

test("realtime provider stays browser-only during SSR", () => {
  expect(createQiyLiveProvider()).toBeUndefined();
});

test("scopes record subscriptions to the requested ids", async () => {
  const { client, listeners, channels } = fakeClient();
  const tokenFetcher = (async () => Response.json({ capability: JSON.stringify({ "qiy:orders": ["subscribe"] }) })) as unknown as typeof fetch;
  const provider = createQiyLiveProvider(tokenFetcher, client as never)!;
  const received: Array<Record<string, unknown>> = [];
  provider.subscribe({ channel: "orders", types: ["updated"], callback: (live) => received.push(live.payload as Record<string, unknown>), params: { subscriptionType: "useOne", id: "one" } });
  const many: Array<Record<string, unknown>> = [];
  provider.subscribe({ channel: "orders", types: ["updated"], callback: (live) => many.push(live.payload as Record<string, unknown>), params: { subscriptionType: "useMany", ids: ["a", "b"] } });
  const list: Array<Record<string, unknown>> = [];
  provider.subscribe({ channel: "orders", types: ["created"], callback: (live) => list.push(live.payload as Record<string, unknown>), params: { subscriptionType: "useList" } });
  const wrapped: Array<Record<string, unknown>> = [];
  provider.subscribe({ channel: "orders", types: ["updated"], callback: (live) => wrapped.push(live.payload as Record<string, unknown>), params: { id: "nested" } });
  await Bun.sleep(20);

  expect(channels[0]).toBe("qiy:orders");
  listeners[0]!(event("two"));
  expect(received).toHaveLength(0);
  listeners[0]!(event("one"));
  expect(received).toHaveLength(1);
  expect(received[0]?.id).toBe("one");

  // useMany pages scope to a list of ids, and events without an id never match.
  listeners[1]!(event("c"));
  listeners[1]!(event(undefined));
  listeners[1]!(event("b"));
  expect(many.map((payload) => payload.id)).toEqual(["b"]);

  // List pages stay unscoped and receive every event.
  listeners[2]!(event("anyone"));
  expect(list).toHaveLength(1);
  // A payload wrapped in data.id is still matched when scoped.
  listeners[3]!({ name: "updated", data: { data: { id: "nested" } }, timestamp: 1 });
  expect(wrapped).toHaveLength(1);
});

test("resolves a claim-scoped channel from the token capability", async () => {
  const { client, channels } = fakeClient();
  const tokenFetcher = (async () => Response.json({ capability: JSON.stringify({ "qiy:orders:eu": ["subscribe"] }) })) as unknown as typeof fetch;
  const provider = createQiyLiveProvider(tokenFetcher, client as never)!;
  provider.subscribe({ channel: "orders", types: ["updated"], callback: () => {} });
  await Bun.sleep(20);
  expect(channels[0]).toBe("qiy:orders:eu");
});

test("unsubscribes through the Ably channel", async () => {
  const { client, unsubscribed } = fakeClient();
  const provider = createQiyLiveProvider(fetch, client as never)!;
  const subscription = provider.subscribe({ channel: "orders", types: ["updated"], callback: () => {} });
  await Bun.sleep(10);
  provider.unsubscribe(subscription);
  expect(unsubscribed).toHaveLength(1);
});
`;
    if (usesGraphqlSubscriptions) {
      generated["web/app/subscriptions.ts"] = `export interface QiySubscriptionOptions {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  onData: (data: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  fetcher?: typeof fetch;
  /** Reconnect after the stream ends or fails; defaults to true. */
  reconnect?: boolean;
  /** Called before each reconnect attempt; backoff doubles up to maxReconnectDelayMs. */
  onReconnect?: (info: { attempt: number; delayMs: number }) => void;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

/**
 * Client half of the generated GraphQL subscription transport. Streams
 * text/event-stream frames from /api/v1/graphql/subscribe and invokes onData per
 * result; the returned function aborts the request and closes the stream.
 */
export function subscribeGraphql(options: QiySubscriptionOptions): () => void {
  const controller = new AbortController();
  const params = new URLSearchParams({ query: options.query });
  if (options.variables) params.set("variables", JSON.stringify(options.variables));
  if (options.operationName) params.set("operationName", options.operationName);
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
  const fetcher = options.fetcher ?? fetch;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Opens one SSE connection and streams it until the server ends or the caller stops. */
  const connect = async (): Promise<void> => {
    if (controller.signal.aborted) return;
    try {
      const response = await fetcher("/api/v1/graphql/subscribe?" + params.toString(), { headers: token ? { Authorization: "Bearer " + token } : {}, signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Subscription failed: " + response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Subscription stream is not readable");
      controller.signal.addEventListener("abort", () => { void reader.cancel().catch(() => undefined); });
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done || controller.signal.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\\n\\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = frame.split("\\n").find((line) => line.startsWith("data: "));
          if (dataLine && !controller.signal.aborted) {
            attempt = 0;
            const payload = JSON.parse(dataLine.slice(6)) as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
            if (payload.errors?.length) options.onError?.(new Error(payload.errors[0]!.message));
            else if (payload.data) options.onData(payload.data);
          }
          boundary = buffer.indexOf("\\n\\n");
        }
      }
      scheduleReconnect();
    } catch (error) {
      if (controller.signal.aborted) return;
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
      scheduleReconnect();
    }
  };
  const scheduleReconnect = () => {
    if (controller.signal.aborted) return;
    if (options.reconnect === false) return;
    const delay = Math.min(options.reconnectDelayMs ?? 1000, options.maxReconnectDelayMs ?? 30000) * Math.pow(2, Math.min(attempt, 5));
    attempt += 1;
    options.onReconnect?.({ attempt, delayMs: delay });
    timer = setTimeout(() => { void connect(); }, delay);
  };
  void connect();
  return () => {
    controller.abort();
    if (timer) clearTimeout(timer);
  };
}

export interface QiyGraphqlWsOptions {
  url?: string;
  token?: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  onData: (data: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  socketFactory?: (url: string) => WebSocket;
  /** Called before each reconnect attempt; backoff doubles up to maxReconnectDelayMs. */
  onReconnect?: (info: { attempt: number; delayMs: number }) => void;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

/** Converts the configured HTTP(S) origin into the graphql-ws URL. */
export function graphqlWsUrl(path = "/graphql/ws"): string {
  if (/^wss?:/.test(path)) return path;
  if (typeof window === "undefined") return path;
  return (window.location.protocol === "https:" ? "wss:" : "ws:") + "//" + window.location.host + path;
}

export function encodeGraphqlWsFrame(frame: Record<string, unknown>): string { return JSON.stringify(frame); }
export function decodeGraphqlWsFrame(raw: unknown): Record<string, unknown> | undefined {
  try { return JSON.parse(typeof raw === "string" ? raw : String(raw)) as Record<string, unknown>; } catch { return undefined; }
}

/**
 * graphql-ws client over a native WebSocket: init, subscribe, stream next frames
 * and stop cleanly. Authentication rides the connection_init payload token.
 */
export function subscribeGraphqlWs(query: string, options: QiyGraphqlWsOptions): () => void {
  const token = options.token ?? (typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token") ?? undefined);
  const createSocket = options.socketFactory ?? ((url: string) => new WebSocket(url));
  const id = "qiy-" + Math.random().toString(36).slice(2);
  let stopped = false;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  const connect = () => {
    socket = createSocket(graphqlWsUrl(options.url));
    const current = socket;
    current.addEventListener("message", (event) => {
      const frame = decodeGraphqlWsFrame(event.data);
      if (!frame?.type) return;
      if (frame.type === "connection_ack") {
        attempt = 0;
        current.send(encodeGraphqlWsFrame({ id, type: "subscribe", payload: { query, variables: options.variables, operationName: options.operationName } }));
        return;
      }
      if (frame.type === "next" && frame.id === id) {
        const payload = frame.payload as { data?: Record<string, unknown>; errors?: Array<{ message: string }> } | undefined;
        if (payload?.errors?.length) options.onError?.(new Error(payload.errors[0]!.message));
        else if (payload?.data) options.onData(payload.data);
        return;
      }
      if (frame.type === "error" && frame.id === id) {
        const payload = frame.payload as Array<{ message?: string }> | undefined;
        options.onError?.(new Error(payload?.[0]?.message ?? "Subscription failed"));
        return;
      }
      if (frame.type === "complete" && frame.id === id) options.onComplete?.();
    });
    const init = () => { if (current.readyState === 1) current.send(encodeGraphqlWsFrame({ type: "connection_init", payload: token ? { token } : {} })); };
    if (current.readyState === 1) init(); else current.addEventListener("open", init);
    current.addEventListener("error", () => options.onError?.(new Error("Subscription socket failed")));
    // Reconnect with capped exponential backoff until the caller stops the subscription.
    current.addEventListener("close", () => {
      if (stopped) return;
      const delay = Math.min(options.reconnectDelayMs ?? 1000, options.maxReconnectDelayMs ?? 30000) * Math.pow(2, Math.min(attempt, 5));
      attempt += 1;
      options.onReconnect?.({ attempt, delayMs: delay });
      timer = setTimeout(connect, delay);
    });
  };
  connect();
  return () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    if (socket && socket.readyState === 1) socket.send(encodeGraphqlWsFrame({ id, type: "complete" }));
    socket?.close();
  };
}

`;
      generated["web/tests/subscriptions.test.ts"] = `import { expect, test } from "bun:test";
import { decodeGraphqlWsFrame, encodeGraphqlWsFrame, graphqlWsUrl, subscribeGraphql, subscribeGraphqlWs } from "../app/subscriptions";

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

test("parses SSE frames split across chunks", async () => {
  const received: Array<Record<string, unknown>> = [];
  let requested = "";
  const fetcher = (async (url: RequestInfo | URL) => { requested = String(url); return streamResponse(["data: {\\"data\\":{\\"a\\":1}}\\n", "\\ndata: {\\"data\\":{\\"b\\":2}}\\n\\n"]); }) as typeof fetch;
  const stop = subscribeGraphql({ query: "subscription { a }", variables: { id: "x" }, onData: (data) => received.push(data), fetcher });
  await Bun.sleep(10);
  stop();
  expect(received).toEqual([{ a: 1 }, { b: 2 }]);
  const url = new URL(requested, "http://localhost");
  expect(url.pathname).toBe("/api/v1/graphql/subscribe");
  expect(url.searchParams.get("query")).toBe("subscription { a }");
  expect(url.searchParams.get("variables")).toBe(JSON.stringify({ id: "x" }));
});

test("reports GraphQL errors and HTTP refusals", async () => {
  const errors: string[] = [];
  subscribeGraphql({ query: "subscription { a }", onData: () => {}, onError: (error) => errors.push(error.message), fetcher: (async (_url: RequestInfo | URL, _init?: RequestInit) => streamResponse(["data: {\\"errors\\":[{\\"message\\":\\"not permitted\\"}]}\\n\\n"])) as typeof fetch });
  subscribeGraphql({ query: "subscription { a }", onData: () => {}, onError: (error) => errors.push(error.message), fetcher: (async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: "Authentication required" }, { status: 401 })) as typeof fetch });
  await Bun.sleep(10);
  expect(errors).toEqual(["not permitted", "Authentication required"]);
});

test("aborting stops further callbacks", async () => {
  const received: Array<Record<string, unknown>> = [];
  let push: ((chunk: string) => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      push = (chunk: string) => controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel() {},
  });
  const stop = subscribeGraphql({ query: "subscription { a }", onData: (data) => received.push(data), fetcher: (async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(stream)) as typeof fetch });
  await Bun.sleep(10);
  push?.("data: {\\"data\\":{\\"a\\":1}}\\n\\n");
  await Bun.sleep(10);
  stop();
  // Aborting cancels the reader, so the producer may already be closed.
  try { push?.("data: {\\"data\\":{\\"a\\":2}}\\n\\n"); } catch { /* stream cancelled by abort */ }
  await Bun.sleep(10);
  expect(received).toEqual([{ a: 1 }]);
});
test("graphql-ws client initializes, subscribes and streams frames", () => {
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  let closed = false;
  const socket = {
    readyState: 1,
    send: (frame: string) => sent.push(JSON.parse(frame) as Record<string, unknown>),
    close: () => { closed = true; },
    addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
  } as unknown as WebSocket;
  const emit = (frame: Record<string, unknown>) => { for (const listener of listeners.get("message") ?? []) listener({ data: JSON.stringify(frame) }); };
  const received: Array<Record<string, unknown>> = [];
  const errors: Error[] = [];
  let completed = 0;
  const stop = subscribeGraphqlWs("subscription { ordersChanged { event } }", {
    token: "token-1",
    socketFactory: () => socket,
    onData: (data) => received.push(data),
    onError: (error) => errors.push(error),
    onComplete: () => { completed += 1; },
  });
  // connection_init carries the bearer token from the caller.
  expect(sent[0]).toEqual({ type: "connection_init", payload: { token: "token-1" } });
  emit({ type: "connection_ack" });
  const subscribe = sent[1] as { id: string; type: string; payload: { query: string } };
  expect(subscribe.type).toBe("subscribe");
  expect(subscribe.payload.query).toContain("ordersChanged");
  emit({ id: subscribe.id, type: "next", payload: { data: { ordersChanged: { event: "created" } } } });
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ ordersChanged: { event: "created" } });
  emit({ id: subscribe.id, type: "error", payload: [{ message: "Realtime subscription is not permitted" }] });
  expect(errors[0]?.message).toContain("not permitted");
  emit({ id: subscribe.id, type: "complete" });
  expect(completed).toBe(1);
  // Stopping acknowledges the subscription and closes the socket.
  stop();
  expect(sent.some((frame) => frame.type === "complete" && frame.id === subscribe.id)).toBe(true);
  expect(closed).toBe(true);
});

test("graphql-ws helpers build the URL and tolerate bad frames", () => {
  expect(graphqlWsUrl("ws://example.test/graphql/ws")).toBe("ws://example.test/graphql/ws");
  expect(decodeGraphqlWsFrame("not json")).toBeUndefined();
  expect(decodeGraphqlWsFrame(JSON.stringify({ type: "pong" }))).toEqual({ type: "pong" });
  expect(encodeGraphqlWsFrame({ type: "ping" })).toBe('{"type":"ping"}');
});

test("graphql-ws client reconnects and resubscribes after a drop", async () => {
  type FakeSocket = {
    sent: Array<Record<string, unknown>>;
    listeners: Map<string, Array<(event: { data?: unknown }) => void>>;
    readyState: number;
    send: (frame: string) => void;
    close: () => void;
    addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void;
  };
  const sockets: FakeSocket[] = [];
  const factory = (): WebSocket => {
    const socket: FakeSocket = {
      sent: [],
      listeners: new Map(),
      readyState: 1,
      send: (frame) => socket.sent.push(JSON.parse(frame) as Record<string, unknown>),
      close: () => { socket.readyState = 3; },
      addEventListener: (type, listener) => {
        const list = socket.listeners.get(type) ?? [];
        list.push(listener as (event: { data?: unknown }) => void);
        socket.listeners.set(type, list);
      },
    };
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
  const emit = (socket: FakeSocket, type: string, event: { data?: unknown } = {}) => {
    for (const listener of socket.listeners.get(type) ?? []) listener(event);
  };
  const received: Array<Record<string, unknown>> = [];
  const reconnects: number[] = [];
  const stop = subscribeGraphqlWs("subscription { ordersChanged { event } }", {
    token: "token-1",
    socketFactory: factory,
    reconnectDelayMs: 5,
    onReconnect: (info) => reconnects.push(info.delayMs),
    onData: (data) => received.push(data),
  });
  expect(sockets).toHaveLength(1);
  emit(sockets[0]!, "message", { data: JSON.stringify({ type: "connection_ack" }) });
  const first = sockets[0]!.sent[1] as { id: string };
  emit(sockets[0]!, "message", { data: JSON.stringify({ id: first.id, type: "next", payload: { data: { ordersChanged: { event: "created" } } } }) });
  expect(received).toHaveLength(1);
  // Dropping the socket schedules a reconnect and a fresh connection_init.
  emit(sockets[0]!, "close");
  await Bun.sleep(25);
  expect(sockets).toHaveLength(2);
  expect(reconnects[0]).toBe(5);
  emit(sockets[1]!, "message", { data: JSON.stringify({ type: "connection_ack" }) });
  const second = sockets[1]!.sent[0] as { type: string };
  expect(second.type).toBe("connection_init");
  const resubscribe = sockets[1]!.sent[1] as { id: string; type: string };
  expect(resubscribe.type).toBe("subscribe");
  emit(sockets[1]!, "message", { data: JSON.stringify({ id: resubscribe.id, type: "next", payload: { data: { ordersChanged: { event: "updated" } } } }) });
  expect(received).toHaveLength(2);
  // Stopping clears the retry timer and closes the active socket.
  stop();
  emit(sockets[1]!, "close");
  await Bun.sleep(20);
  expect(sockets).toHaveLength(2);
});

test("SSE subscription reconnects after the stream ends", async () => {
  let calls = 0;
  const received: Array<Record<string, unknown>> = [];
  const reconnects: number[] = [];
  const fetcher = async (_url: string, init?: RequestInit) => {
    calls += 1;
    // The caller aborts through the signal; a plain resolve is enough for the fake.
    expect(init?.signal).toBeDefined();
    if (calls === 1) {
      return new Response(new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('data: {"data":{"ordersChanged":{"event":"created"}}}\\n\\n'));
          controller.close();
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response(new ReadableStream({ start(controller) { controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
  };
  const stop = subscribeGraphql({
    query: "subscription { ordersChanged { event } }",
    fetcher: fetcher as unknown as typeof fetch,
    reconnectDelayMs: 5,
    onReconnect: (info) => reconnects.push(info.delayMs),
    onData: (data) => received.push(data),
  });
  await Bun.sleep(30);
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({ ordersChanged: { event: "created" } });
  expect(calls).toBeGreaterThanOrEqual(2);
  expect(reconnects[0]).toBe(5);
  stop();
});

`;
    }
  }
  if (options.auth?.providers && options.auth.providers.length > 1) {
    generated["web/app/auth/oidc-multi.ts"] = renderMultiProviderWebClient();
    generated["web/app/routes/login.tsx"] = `import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { beginProviderLogin, fetchAuthProviders, type QiyAuthProviderPublic } from "../auth/oidc-multi";

export default function Login() {
  const [providers, setProviders] = useState<QiyAuthProviderPublic[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; void fetchAuthProviders().then((list) => { if (active) { setProviders(list); setLoading(false); } }).catch((caught: unknown) => { if (active) { setError(caught instanceof Error ? caught.message : String(caught)); setLoading(false); } }); return () => { active = false; }; }, []);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}>
    <Card style={{ width: 420 }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Qiy Admin</Typography.Title>
        <Typography.Text type="secondary">Choose an identity provider to sign in.</Typography.Text>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {loading ? <Spin /> : null}
        <Space direction="vertical" style={{ width: "100%" }}>
          {providers.map((provider) => <Button key={provider.id} block size="large" onClick={() => void beginProviderLogin(provider)}>{provider.label}</Button>)}
        </Space>
        {!loading && providers.length === 0 && !error ? <Alert type="warning" showIcon message="No identity provider is configured on the server" /> : null}
      </Space>
    </Card>
  </main>;
}
`;
    generated["web/app/routes/auth-callback.tsx"] = `import { Alert, Card, Spin } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { completeProviderLogin } from "../auth/oidc-multi";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  useEffect(() => { let active = true; void completeProviderLogin(new URL(window.location.href)).then((target) => { if (active) navigate(target || "/", { replace: true }); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); }); return () => { active = false; }; }, [navigate]);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card>{error ? <Alert type="error" showIcon message={error} /> : <Spin />}</Card></main>;
}
`;
  }

  return generated;
}







