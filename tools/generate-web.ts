import type { DatabaseIR, EnumIR, EnumValueIR, FieldIR } from "./database-ir";
import { renderAppTemplate } from "./admin-template";
import { generatedFieldKind, generatedFieldsOf, validateDatabaseIR } from "./database-ir";
import type { QiyChart, QiyChartView, QiyProject } from "./qiy-project";
import { authHasLocal, authIsHybrid, authOAuthProviders, authUsesProviderChooser, qiyChartVariants } from "./qiy-project";
import { evaluatePermissionExpression, requiredPermissionValues, type QiyPermissionExpressionIR } from "./permissions";

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

type WebOptions = Pick<QiyProject, "mode" | "integration" | "ui" | "messages" | "apiClient" | "menuGroups" | "dashboardMetrics" | "charts" | "chartPanels" | "realtime" | "auth" | "permissions" | "workflows" | "dataflows" | "actions" | "restrictions" | "pages" | "scopes" | "features" | "comment"> & { readOnly?: boolean };
type GeneratedAction = {
  name: string;
  roles?: string[];
  permission?: string[];
  verification?: string;
  resource: string;
  placements: Array<"list" | "show">;
  batch?: boolean;
  label: string;
  labelKey?: string;
  condition?: { field: string; operator: "==" | "!="; value: string };
  target:
    | { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpressionIR } }
    | { kind: "dataflow"; dataflow: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpressionIR }; confirm?: string; confirmKey?: string; idempotency: boolean; url: string; idInput: string; inputs: Array<{ name: string; type: string; required: boolean; comment?: string; commentKey?: string; labelKey: string; options?: Array<{ value: string; label: string; labelKey: string }> }> };
};

/**
 * Stable, model-derived translation keys. Every label a generated page renders
 * keeps its declared (or identifier) text as the fallback and is looked up in the
 * project `messages` dictionary through this key, so a model can be translated
 * without hand-editing generated code. Keys are derived only from declared
 * identifiers, never from user text, so they are stable across label edits.
 */
export const qiyModelKeys = {
  resourceLabel: (resource: string) => `qiy.resources.${resource}.label`,
  resourceSingular: (resource: string) => `qiy.resources.${resource}.singular`,
  resourcePlural: (resource: string) => `qiy.resources.${resource}.plural`,
  fieldLabel: (resource: string, field: string) => `qiy.resources.${resource}.fields.${field}.label`,
  enumLabel: (enumeration: string) => `qiy.enums.${enumeration}.label`,
  enumValueLabel: (enumeration: string, value: string) => `qiy.enums.${enumeration}.values.${value}`,
  menuLabel: (group: string) => `qiy.menu.${group}.label`,
  dashboardLabel: (metric: string) => `qiy.dashboard.${metric}.label`,
  chartLabel: (chart: string) => `qiy.charts.${chart}.label`,
  chartViewLabel: (chart: string, kind: string) => `qiy.charts.${chart}.views.${kind}.label`,
  chartLabelValue: (chart: string, value: string) => `qiy.charts.${chart}.labels.${value}`,
  actionLabel: (action: string) => `qiy.actions.${action}.label`,
  actionConfirm: (action: string) => `qiy.actions.${action}.confirm`,
  actionInputLabel: (action: string, input: string) => `qiy.actions.${action}.inputs.${input}.label`,
} as const;

/** Field-name heuristics shared by relation targets and display fallbacks. */
const naturalLabelFields = ["name", "title", "displayName", "code", "number", "sku", "email", "label", "inventoryKey"] as const;

/** Fallback chain for a resource display template: declared template, then the first human-readable field. */
function naturalDisplayField(entity: { fields: FieldIR[] }): FieldIR | undefined {
  return naturalLabelFields.map((name) => entity.fields.find((field) => field.name === name && field.type !== "File" && field.type !== "Files" && field.type !== "Vector")).find(Boolean);
}

function displayTemplateFor(declared: string | undefined, fallbackField?: FieldIR | undefined): string | undefined {
  return declared ?? (fallbackField ? `{$.${fallbackField.name}}` : undefined);
}

function enumerationDefinitions(database: DatabaseIR): Array<EnumIR & { label: string; labelKey: string; values: Array<EnumValueIR & { label: string; labelKey: string }> }> {
  return (database.enums ?? []).map((enumeration) => ({
    ...enumeration,
    label: enumeration.name,
    labelKey: qiyModelKeys.enumLabel(enumeration.name),
    values: enumeration.values.map((value) => ({ ...value, label: value.label ?? value.name, labelKey: qiyModelKeys.enumValueLabel(enumeration.name, value.name) })),
  }));
}

function resourceFields(database: DatabaseIR, menuGroups: NonNullable<QiyProject["menuGroups"]>, realtime?: QiyProject["realtime"], pages: NonNullable<QiyProject["pages"]> = []): string {
  const enumByName = new Map(enumerationDefinitions(database).map((enumeration) => [enumeration.name, enumeration.values]));
  const entityByName = new Map(database.entities.map((entity) => [entity.name, entity]));
  const generatedByEntity = new Map(database.entities.map((entity) => [entity.name, new Set(generatedFieldsOf(entity, database.relations ?? []).map((generated) => generated.field.name))]));
  const parentByResource = new Map(menuGroups.flatMap((group) => group.resources.map((resource) => [resource, `menu-${group.name}`] as const)));
  const liveModeByResource = new Map((realtime?.resources ?? []).map((subscription) => [subscription.resource, realtime!.mode] as const));
  // Page-level field layout: a field with roles is only rendered for those roles.
  const fieldRolesByResource = new Map(pages.filter((page) => page.fields?.length).map((page) => [page.resource, new Map(page.fields!.map((entry) => [entry.field, entry.roles]))]));
  return JSON.stringify(database.entities.map((entity) => {
    const displayField = naturalDisplayField(entity);
    const displayTemplate = displayTemplateFor(entity.display, displayField);
    // A table cell and its drawer should show the same text unless the model
    // declares a dedicated table display; both fall back to the entity display.
    const tableDisplayTemplate = entity.tableDisplay ?? displayTemplate;
    const relationDetailTemplate = entity.relationDetail ?? displayTemplate;
    return {
    name: entity.tableName,
    apiName: entity.name,
    label: entity.label ?? entity.name,
    labelKey: qiyModelKeys.resourceLabel(entity.tableName),
    singular: entity.singular ?? entity.label ?? entity.name,
    singularKey: qiyModelKeys.resourceSingular(entity.tableName),
    plural: entity.plural ?? entity.label ?? entity.name,
    pluralKey: qiyModelKeys.resourcePlural(entity.tableName),
    ...(displayTemplate !== undefined && { displayTemplate }),
    ...(tableDisplayTemplate !== undefined && { tableDisplayTemplate }),
    ...(relationDetailTemplate !== undefined && { relationDetailTemplate }),
    ...(entity.comment !== undefined && { comment: entity.comment }),
    ...(entity.commentKey !== undefined && { commentKey: entity.commentKey }),
    icon: entity.icon ?? (entity.name.toLowerCase().includes("user") ? "UserOutlined" : entity.name.toLowerCase().includes("order") ? "ShoppingOutlined" : entity.name.toLowerCase().includes("warehouse") ? "DatabaseOutlined" : "TableOutlined"),
    liveMode: liveModeByResource.get(entity.tableName) ?? "off",
    ...(parentByResource.has(entity.tableName) && { menuParent: parentByResource.get(entity.tableName) }),
    ...(database.relations?.some((relation) => relation.toEntity === entity.name) && { relatedResources: database.relations.filter((relation) => relation.toEntity === entity.name).map((relation) => ({ resource: entityByName.get(relation.fromEntity)!.tableName, field: relation.fromField, label: entityByName.get(relation.fromEntity)!.label ?? entityByName.get(relation.fromEntity)!.name, labelKey: qiyModelKeys.resourceLabel(entityByName.get(relation.fromEntity)!.tableName) })) }),
    fields: entity.fields.map((field) => {
      const relation = (database.relations ?? []).find((candidate) => candidate.fromEntity === entity.name && candidate.fromField === field.name);
      const target = relation && entityByName.get(relation.toEntity);
      return {
      name: field.name,
      label: field.label ?? field.name,
      labelKey: qiyModelKeys.fieldLabel(entity.tableName, field.name),
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
      ...(target && { relation: { resource: target.tableName, labelField: naturalDisplayField(target)?.name ?? "id" } }),
      // Generated values are filled by the server: hidden on create, read-only on
      // edit, and always displayed normally on list/show pages.
      ...(generatedByEntity.get(entity.name)?.has(field.name) && { autoGenerated: true }),
      ...(field.icon && { icon: field.icon }),
      ...(fieldRolesByResource.get(entity.tableName)?.has(field.name) && { roles: fieldRolesByResource.get(entity.tableName)!.get(field.name) }),
      ...(field.type === "Vector" && { dimension: field.dimension }),
    }; }),
  }; }), null, 2);
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

export function generateWeb(database: DatabaseIR, options: WebOptions = {}): Record<string, string> {
  const ui = options.ui ?? { library: "antd", theme: "blue", themes: ["blue", "purple", "green", "orange", "red"], colorMode: "system", allowThemeSwitch: true, allowColorModeSwitch: true } as const;
  if (ui.library !== "antd") throw new Error(`Unsupported UI library ${ui.library}; only antd is implemented`);
  const treeEntities = Object.fromEntries([...new Set((options.scopes ?? []).flatMap((scope) => scope.tree ? [[scope.tree.entity, scope.tree.parentField] as const] : []))].map(([entity, parentField]) => [entity, { parentField, labelField: "name" }]));
  const authOAuthProviderIds = options.auth ? authOAuthProviders(options.auth) : [];
  const hasLocalAuth = Boolean(options.auth && authHasLocal(options.auth));
  const hybridAuth = Boolean(options.auth && authIsHybrid(options.auth));
  const providerChooserAuth = Boolean(options.auth && authUsesProviderChooser(options.auth));
  const multiProviderAuth = Boolean(options.auth && providerChooserAuth && !hybridAuth);
  const usesOidcAuth = Boolean(options.auth && !hasLocalAuth && authOAuthProviderIds.length > 0 && oidcAuthProviders.has(options.auth.provider));
  const usesOtpAuth = options.auth?.provider === "otp";
  const authProviderLabel = options.auth ? authProviderLabels[options.auth.provider] ?? options.auth.provider : "";
  const userEntity = options.auth ? database.entities.find((entity) => entity.name === options.auth!.userEntity) : undefined;
  // The generated profile page renders the signed-in role; when the role field is
  // a declared enum, its localized value label comes from the model dictionary.
  const authRoleEnumName = options.auth ? userEntity?.fields.find((field) => field.name === options.auth!.roleField)?.enumName : undefined;
  // The hybrid onboarding form asks for a separate email only when the user
  // entity declares one that is not already the username field.
  const onboardingEmailField = userEntity?.fields.some((field) => field.name === "email") && options.auth?.usernameField !== "email" ? "email" : null;
  const onboardingUsernameLabel = options.auth?.usernameField === "email" ? "Email" : "Username";
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
      // Generated values are hidden from the create form on purpose: the server fills them.
      const generated = generatedFieldKind(field, { hasRelation: (database.relations ?? []).some((relation) => relation.fromEntity === entity.name && relation.fromField === field.name) }) !== undefined;
      if (!field.primaryKey && !field.nullable && field.type !== "Vector" && !generated && !(field.formVisible ?? field.visible ?? true)) errors.push(`${entity.name}.${field.name}: required field cannot be hidden from the create form`);
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
  const dashboardMetrics = options.dashboardMetrics?.length ? options.dashboardMetrics : options.charts?.length ? [] : database.entities.map((entity) => ({ name: entity.name, resource: entity.tableName, label: entity.label ?? entity.name, icon: entity.icon, span: 8 as const }));
  const localizedDashboardMetrics = dashboardMetrics.map((metric) => ({ ...metric, labelKey: qiyModelKeys.dashboardLabel(metric.name) }));
  // Chart pages: declarations with the same name are the views of one chart;
  // view labels are keyed by kind, distribution labels by enum value.
  const chartEntity = (entityName: string) => database.entities.find((entity) => entity.tableName === entityName || entity.name === entityName);
  const enumValuesFor = (entityName: string, fieldName: string | undefined) => {
    if (!fieldName) return [];
    const field = chartEntity(entityName)?.fields.find((candidate) => candidate.name === fieldName);
    const enumeration = field?.enumName ? database.enums?.find((candidate) => candidate.name === field.enumName) : undefined;
    return (enumeration?.values ?? []).map((value) => ({ value: value.name, label: value.label ?? value.name }));
  };
  const chartLabelsMetadata = (chart: QiyChart, view: QiyChartView) => {
    if (view.kind !== "pie" && view.kind !== "bar") return undefined;
    if (view.labels?.values?.length) {
      return { field: view.labels.field, values: view.labels.values.map((entry) => ({ value: entry.value, label: entry.label, labelKey: qiyModelKeys.chartLabelValue(chart.name, entry.value) })) };
    }
    const field = view.labels?.field ?? view.data.groupBy;
    const values = enumValuesFor(view.data.entity, field).map((entry) => ({ ...entry, labelKey: qiyModelKeys.chartLabelValue(chart.name, entry.value) }));
    return values.length ? { ...(field ? { field } : {}), values } : undefined;
  };
  const localizedCharts = (options.charts ?? []).map((chart) => ({
    name: chart.name,
    title: chart.title ?? chart.name,
    labelKey: qiyModelKeys.chartLabel(chart.name),
    ...(chart.icon ? { icon: chart.icon } : {}),
    views: chart.views.map((view) => {
      const labels = chartLabelsMetadata(chart, view);
      return {
        kind: view.kind,
        label: view.title ?? chart.title ?? chart.name,
        labelKey: qiyModelKeys.chartViewLabel(chart.name, view.kind),
        data: view.data,
        ...(labels ? { labels } : {}),
      };
    }),
  }));
  const localizedChartPanels = (options.chartPanels ?? []).map((panel) => ({
    name: panel.name,
    title: panel.title ?? panel.name,
    labelKey: qiyModelKeys.chartLabel(panel.name),
    grid: panel.grid,
    charts: panel.charts.map((chart) => ({ name: chart.name, placements: chart.placements })),
  }));
  // A generated test can only assert a concrete language switch when the model
  // declares translations for the first resource in both built-in locales.
  const firstEntity = database.entities[0];
  const firstResourceKey = firstEntity ? qiyModelKeys.resourceLabel(firstEntity.tableName) : undefined;
  const firstResourceZh = firstResourceKey ? options.messages?.locales["zh-CN"]?.[firstResourceKey] : undefined;
  const firstResourceEn = firstResourceKey ? options.messages?.locales["en-US"]?.[firstResourceKey] : undefined;
  const localeSwitchTest = firstEntity && firstResourceKey && firstResourceZh !== undefined && firstResourceEn !== undefined
    ? `
test("model labels switch between the declared Chinese and English dictionaries", () => {
  const resource = resources[0]!;
  expect(createI18nProvider("zh-CN").translate(${JSON.stringify(firstResourceKey)}, {}, resource.label)).toBe(${JSON.stringify(firstResourceZh)});
  expect(createI18nProvider("en-US").translate(${JSON.stringify(firstResourceKey)}, {}, resource.label)).toBe(${JSON.stringify(firstResourceEn)});
  expect(${JSON.stringify(firstResourceZh)}).not.toBe(${JSON.stringify(firstResourceEn)});
});
`
    : "";
  const distributionEntity = database.entities.find((entity) => entity.fields.some((field) => field.enumName));
  const distributionField = distributionEntity?.fields.find((field) => field.enumName);
  const trendEntity = database.entities.find((entity) => entity.fields.some((field) => field.type === "DateTime"));
  const trendField = trendEntity?.fields.find((field) => field.type === "DateTime");
  // Permission metadata drives command button visibility. `allow permission`
  // references expand to the permission values a principal must hold; an
  // `allow verification` can only be evaluated client-side when it declares no
  // inputs (the server still enforces every verification on the command route).
  const permissionModel = options.permissions && options.permissions.fields.length ? options.permissions : undefined;
  const expandWebPermissionRefs = (references: string[] | undefined): string[] | undefined => {
    if (!references?.length) return undefined;
    return permissionModel ? requiredPermissionValues(permissionModel, references) : references;
  };
  const webVerification = (name: string | undefined): { name: string; expression: QiyPermissionExpressionIR } | undefined => {
    if (!name || !permissionModel) return undefined;
    const verification = permissionModel.verifications.find((candidate) => candidate.name === name);
    if (!verification || verification.inputs.length) return undefined;
    return { name: verification.name, expression: verification.expression };
  };
  const actionDefinitions: GeneratedAction[] = (options.actions ?? []).map((action) => {
    const labelKey = action.labelKey ?? qiyModelKeys.actionLabel(action.name);
    if (action.target.kind === "navigate") {
      return {
        ...action,
        labelKey,
        resource: database.entities.find((entity) => entity.name === action.resource)?.tableName ?? action.resource,
        target: {
          ...action.target,
          ...(action.permission?.length ? { permissions: expandWebPermissionRefs(action.permission) } : {}),
          ...(webVerification(action.verification) ? { verification: webVerification(action.verification) } : {}),
        },
      };
    }
    const target = action.target;
    const flow = options.dataflows!.find((candidate) => candidate.name === target.dataflow)!;
    const entity = database.entities.find((candidate) => candidate.tableName === action.resource || candidate.name === action.resource)!;
    const binding = flow.context.find((candidate) => candidate.entity === entity.name)!;
    const source = binding.id.split(":", 2)[1]!;
    return {
      ...action,
      labelKey,
      resource: entity.tableName,
      target: {
        ...target,
        ...(target.confirm !== undefined && !target.confirmKey ? { confirmKey: qiyModelKeys.actionConfirm(action.name) } : {}),
        url: `/api/v1/commands/${flow.name}${action.batch ? "/batch" : ""}`,
        idempotency: flow.idempotency?.required === true,
        roles: flow.roles ?? ["admin", "operator"],
        ...(flow.permission?.length ? { permissions: expandWebPermissionRefs(flow.permission) } : {}),
        ...(webVerification(flow.verification) ? { verification: webVerification(flow.verification) } : {}),
        idInput: source.split(".", 2)[1]!,
        inputs: flow.input.map((input) => ({ name: input.name, type: input.type, required: input.required, comment: input.comment, ...(input.commentKey && { commentKey: input.commentKey }), labelKey: input.commentKey ?? qiyModelKeys.actionInputLabel(action.name, input.name), ...(database.enums?.some((enumeration) => enumeration.name === input.type) ? { options: database.enums.find((enumeration) => enumeration.name === input.type)!.values.map((value) => ({ value: value.name, label: value.label ?? value.name, labelKey: qiyModelKeys.enumValueLabel(input.type, value.name) })) } : {}) })),
      },
    };
  });
  type CommandPolicy = { resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpressionIR } };
  const actionPolicies: CommandPolicy[] = actionDefinitions.flatMap((action) => {
    const base = { resource: action.resource, action: action.name };
    if (action.target.kind === "dataflow") {
      return [{
        ...base,
        roles: action.target.roles,
        ...(action.target.permissions?.length ? { permissions: action.target.permissions } : {}),
        ...(action.target.verification ? { verification: action.target.verification } : {}),
      }];
    }
    const permissions = expandWebPermissionRefs(action.permission);
    const verification = webVerification(action.verification);
    if (!action.roles?.length && !permissions?.length && !verification) return [];
    return [{ ...base, roles: action.roles ?? [], ...(permissions?.length ? { permissions } : {}), ...(verification ? { verification } : {}) }];
  });
  const commandVerifications = Object.fromEntries(actionPolicies.filter((policy) => policy.verification).map((policy) => [policy.verification!.name, policy.verification!.expression]));
  // Model-derived permission visibility cases: the generated access control test
  // asserts permission/verification command policies against effective identity
  // metadata, with expectations computed by tools/permissions.ts.
  const declaredWebPermissionValues = permissionModel ? requiredPermissionValues(permissionModel, permissionModel.fields.map((field) => field.name)) : [];
  const allWebGroups = permissionModel?.groups.map((group) => group.name) ?? [];
  const webPermissionPolicies = actionPolicies.filter((policy) => policy.permissions?.length || policy.verification);
  const webPermissionCases = webPermissionPolicies.flatMap((policy) => {
    const variants: Array<{ role: string; permissions?: string[]; groups?: string[]; expected: boolean }> = [];
    if (policy.permissions?.length) {
      variants.push({ role: "viewer", permissions: policy.permissions, groups: [], expected: true });
      variants.push({ role: "viewer", permissions: [], groups: [], expected: false });
    }
    if (policy.verification) {
      const expression = policy.verification.expression;
      const evaluate = (identity: { role: string; permissions: string[]; groups: string[] }) => evaluatePermissionExpression(expression, { self: { permissions: identity.permissions, groups: identity.groups, role: identity.role }, input: {} }).allowed;
      const admin = { role: "admin", permissions: declaredWebPermissionValues, groups: allWebGroups };
      const viewer = { role: "viewer", permissions: [], groups: [] };
      variants.push({ role: "admin", permissions: admin.permissions, groups: admin.groups, expected: evaluate(admin) });
      variants.push({ role: "viewer", permissions: viewer.permissions, groups: viewer.groups, expected: evaluate(viewer) });
    }
    return variants.map((variant) => ({ policy, variant }));
  });

  /**
   * Client-side command permission check. The server remains authoritative: this
   * only hides buttons whose command would be denied. `allow permission` commands
   * use the effective `permissions` from `/auth/me`; when the server exposes no
   * permission metadata the generated access control falls back to the legacy
   * role allow list. Input-free `allow verification` rules are evaluated with the
   * same operator semantics as the server.
   */
  const usesCommandPermissions = actionPolicies.some((policy) => policy.permissions?.length || policy.verification);
  const commandPolicyTypes = `type QiyPermissionOperand = { kind: "self"; set: "permissions" | "groups" | "role" } | { kind: "input"; name: string } | { kind: "literal"; value: string };
type QiyPermissionExpression =
  | { kind: "comparison"; operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals"; left: QiyPermissionOperand; right: QiyPermissionOperand }
  | { kind: "and"; children: QiyPermissionExpression[] }
  | { kind: "or"; children: QiyPermissionExpression[] }
  | { kind: "not"; expression: QiyPermissionExpression };
type QiyCommandPolicy = { resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpression } };
`;
  const commandPolicyFunctions = usesCommandPermissions
    ? `function permissionOperandValues(operand: QiyPermissionOperand, identity: QiyIdentity): string[] {
  if (operand.kind === "self") {
    if (operand.set === "role") return [identity.role ?? ""];
    return [...(operand.set === "permissions" ? identity.permissions ?? [] : identity.groups ?? [])];
  }
  if (operand.kind === "literal") return [operand.value];
  return [];
}
function comparePermissionKeys(operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals", left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const difference = [...leftSet].filter((entry) => !rightSet.has(entry));
  if (operator === "all-in") return difference.length === 0;
  if (operator === "some-in") return [...leftSet].some((entry) => rightSet.has(entry));
  if (operator === "not-all-in") return difference.length > 0;
  if (operator === "not-some-in") return [...leftSet].every((entry) => !rightSet.has(entry));
  if (operator === "equals") return difference.length === 0 && rightSet.size === leftSet.size;
  return !(difference.length === 0 && rightSet.size === leftSet.size);
}
function evaluatePermissionExpression(expression: QiyPermissionExpression, identity: QiyIdentity): boolean {
  if (expression.kind === "comparison") return comparePermissionKeys(expression.operator, permissionOperandValues(expression.left, identity), permissionOperandValues(expression.right, identity));
  if (expression.kind === "not") return !evaluatePermissionExpression(expression.expression, identity);
  if (expression.kind === "and") return expression.children.every((child) => evaluatePermissionExpression(child, identity));
  return expression.children.some((child) => evaluatePermissionExpression(child, identity));
}
function evaluateCommandPermission(command: QiyCommandPolicy, identity: QiyIdentity): { can: boolean; reason: string } | undefined {
  if (command.verification) {
    const expression = commandVerifications[command.verification.name];
    if (expression) {
      const allowed = evaluatePermissionExpression(expression, identity);
      return allowed ? { can: true, reason: "Permission verification " + command.verification.name + " satisfied" } : { can: false, reason: "Permission verification " + command.verification.name + " denied this command" };
    }
  }
  if (command.permissions?.length) {
    if (!Array.isArray(identity.permissions)) return undefined;
    const missing = command.permissions.filter((permission) => !identity.permissions!.includes(permission));
    return missing.length ? { can: false, reason: "Missing permission: " + missing.join(", ") } : { can: true, reason: "Permission granted" };
  }
  return undefined;
}
`
    : "";
  const commandPermissionEvaluation = usesCommandPermissions
    ? `const permissionVerdict = evaluateCommandPermission(command, identity); if (permissionVerdict) return permissionVerdict; `
    : "";
  const autoGeneratedResource = database.entities.find((entity) => generatedFieldsOf(entity, database.relations ?? []).length > 0);
  const autoGeneratedFields = autoGeneratedResource
    ? generatedFieldsOf(autoGeneratedResource, database.relations ?? []).map((generated) => ({
      name: generated.field.name,
      listVisible: generated.field.listVisible ?? generated.field.visible ?? !generated.field.primaryKey,
      showVisible: generated.field.showVisible ?? generated.field.visible ?? !generated.field.primaryKey,
    }))
    : [];
  const generatedFieldsTest = autoGeneratedResource ? `
test("hides generated fields on create, keeps them visible on edit and shows the hint", () => {
  const resource = resources.find((item) => item.name === ${JSON.stringify(autoGeneratedResource.tableName)})!;
  const generated: Array<{ name: string; listVisible: boolean; showVisible: boolean }> = ${JSON.stringify(autoGeneratedFields)};
  expect(generated.length).toBeGreaterThan(0);
  const create = createFormFields(resource).map((field) => field.name);
  const edit = editFormFields(resource).map((field) => field.name);
  const visible = resource.fields.filter((field) => field.listVisible).map((field) => field.name);
  expect(generatedFormFields(resource).map((field) => field.name).sort()).toEqual(generated.map((field) => field.name).sort());
  for (const expected of generated) {
    const field = resource.fields.find((item) => item.name === expected.name)!;
    expect(field.autoGenerated).toBe(true);
    expect(create).not.toContain(expected.name);
    expect(edit).toContain(expected.name);
    expect(field.showVisible).toBe(expected.showVisible);
    expect(visible.includes(expected.name)).toBe(expected.listVisible);
  }
});

test("translates the auto-generated hint in both built-in locales", () => {
  const zh = createI18nProvider("zh-CN").translate("qiy.autoGenerated");
  const en = createI18nProvider("en-US").translate("qiy.autoGenerated");
  expect(zh).toBeTruthy();
  expect(en).toBeTruthy();
  expect(zh).not.toBe(en);
});
` : "";
  const generated: Record<string, string> = {
    ...template,
    "web/app/ui/theme-config.ts": `export const qiyUiConfig = ${JSON.stringify(ui, null, 2)} as const;\n`,
    "web/app/root.tsx": root
      .replace("__QIY_AUTH_IMPORT__", usesAuth ? (options.auth ? 'import { qiyAccessControlProvider, qiyAuthProvider } from "./auth";\nimport { Authenticated } from "@refinedev/core";\nimport { Navigate, useLocation } from "react-router";' : 'import { qiyIntegrationAuthProvider } from "./host/auth";\nimport { Authenticated } from "@refinedev/core";\nimport { Navigate, useLocation } from "react-router";') : "")
      .replace("__QIY_AUTH_PROPS__", usesAuth ? (options.auth ? "authProvider={qiyAuthProvider} accessControlProvider={qiyAccessControlProvider}" : "authProvider={qiyIntegrationAuthProvider}") : "")
      .replace("__QIY_AUTH_LOCATION__", requiresAuthShell ? 'const location = useLocation(); // legacy login check: location.pathname === "/auth/login"' : "")
      .replace("__QIY_LAYOUT_START__", requiresAuthShell ? '{location.pathname.startsWith("/auth/") || location.pathname.startsWith("/oauth/") ? <Outlet /> : <Authenticated key="protected" fallback={<Navigate to="/auth/login" replace />}> ' : "")
      .replace("__QIY_LAYOUT_END__", requiresAuthShell ? "</Authenticated>}" : ""),
    "web/app/routes/show.tsx": show
      .replace("__QIY_ORDER_IMPORT__", [hasOrderWorkflow ? 'import { OrderWorkflowActions } from "../features/orders/order-actions";' : "", hasRelatedResources ? 'import { RelatedRecords } from "../components/related-records";' : "", actionDefinitions.length ? 'import { BusinessActions } from "../components/business-actions";' : ""].filter(Boolean).join("\n"))
      .replace("__QIY_ORDER_ACTIONS__", [hasOrderWorkflow ? '{resource.name === "orders" && result && id && <OrderWorkflowActions id={id} status={String(result.status ?? "")} />}' : "", hasRelatedResources ? '{result && id && (resource.relatedResources ?? []).map((relation) => <RelatedRecords key={relation.resource + relation.field} relation={relation} recordId={id} />)}' : "", actionDefinitions.length ? '{id && result && <BusinessActions resource={resource.name} placement="show" record={result} />}' : ""].join("")),
    ...(actionDefinitions.length ? {
      "web/app/actions.ts": `type QiyActionCondition = { field: string; operator: "==" | "!="; value: string };
type QiyActionBase = { name: string; resource: string; placements: Array<"list" | "show">; batch?: boolean; label: string; labelKey?: string; roles?: string[]; condition?: QiyActionCondition };
type QiyVerificationRule = { name: string; expression: unknown };
export type QiyActionDefinition = QiyActionBase & ({ target: { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string; permissions?: string[]; verification?: QiyVerificationRule } } | { target: { kind: "dataflow"; dataflow: string; roles: string[]; permissions?: string[]; verification?: QiyVerificationRule; confirm?: string; confirmKey?: string; idempotency: boolean; url: string; idInput: string; inputs: Array<{ name: string; type: string; required: boolean; comment?: string; commentKey?: string; labelKey: string; options?: Array<{ value: string; label: string; labelKey: string }> }> } });
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
  return <CanAccess resource={resource} action={action.name} params={{ id: recordId }}>{fields.length ? <>{button}<Modal open={open} title={actionLabel} okText={actionLabel} confirmLoading={mutation.isPending} onCancel={() => setOpen(false)} onOk={() => form.submit()}>{confirmation && <p>{confirmation}</p>}<Form form={form} layout="vertical" onFinish={(values) => void run(values)}>{fields.map((field) => <Form.Item key={field.name} name={field.name} label={translate(field.labelKey, {}, field.comment ?? field.name)} rules={[{ required: true }]} valuePropName={field.type === "Boolean" ? "checked" : "value"}>{field.options ? <Select options={field.options.map((option) => ({ value: option.value, label: translate(option.labelKey, {}, option.label) }))} /> : field.type === "Boolean" ? <Checkbox /> : field.type === "Integer" || field.type === "Decimal" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>)}</Form></Modal></> : confirmation ? <Popconfirm title={confirmation} onConfirm={() => void run()}>{button}</Popconfirm> : button}</CanAccess>;
}

function BatchCommandAction({ action, resource, recordIds, onComplete }: { action: QiyActionDefinition; resource: string; recordIds: string[]; onComplete(): void }) {
  const { translate } = useTranslation(); const { open: notify } = useNotification(); const [open, setOpen] = useState(false); const [form] = Form.useForm(); const { mutateAsync, mutation } = useCustomMutation(); const invalidate = useInvalidate(); const queryClient = useQueryClient(); const pendingRequest = useRef<{ payload: string; key: string } | null>(null);
  if (action.target.kind !== "dataflow") return null;
  const target = action.target; const fields = target.inputs.filter((field) => field.name !== target.idInput && field.required); const actionLabel = action.labelKey ? translate(action.labelKey, {}, action.label) : action.label; const confirmation = target.confirmKey ? translate(target.confirmKey, {}, target.confirm) : target.confirm;
  const run = async (values: Record<string, unknown> = {}) => { const items = recordIds.map((recordId) => Object.fromEntries(target.inputs.map((field) => [field.name, field.name === target.idInput ? recordId : values[field.name]]))); const body = { items }; const payload = JSON.stringify(body); if (!pendingRequest.current || pendingRequest.current.payload !== payload) pendingRequest.current = { payload, key: crypto.randomUUID() }; try { await mutateAsync({ url: target.url, method: "post", successNotification: false, errorNotification: false, values: body, meta: { idempotencyKey: pendingRequest.current.key } }); pendingRequest.current = null; setOpen(false); form.resetFields(); onComplete(); notify?.({ type: "success", message: translate("notifications.success", {}, "Successful"), description: actionLabel }); await invalidate({ resource, invalidates: ["list"] }); await queryClient.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).toLowerCase().includes("audit") }); } catch (error) { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); } };
  const button = <Button loading={mutation.isPending} onClick={fields.length ? () => setOpen(true) : confirmation ? undefined : () => void run()}>{actionLabel} ({recordIds.length})</Button>;
  return <CanAccess resource={resource} action={action.name} params={{ ids: recordIds }}>{fields.length ? <>{button}<Modal open={open} title={actionLabel} okText={actionLabel} confirmLoading={mutation.isPending} onCancel={() => setOpen(false)} onOk={() => form.submit()}>{confirmation && <p>{confirmation}</p>}<Form form={form} layout="vertical" onFinish={(values) => void run(values)}>{fields.map((field) => <Form.Item key={field.name} name={field.name} label={translate(field.labelKey, {}, field.comment ?? field.name)} rules={[{ required: true }]} valuePropName={field.type === "Boolean" ? "checked" : "value"}>{field.options ? <Select options={field.options.map((option) => ({ value: option.value, label: translate(option.labelKey, {}, option.label) }))} /> : field.type === "Boolean" ? <Checkbox /> : field.type === "Integer" || field.type === "Decimal" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>)}</Form></Modal></> : confirmation ? <Popconfirm title={confirmation} onConfirm={() => void run()}>{button}</Popconfirm> : button}</CanAccess>;
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
    "web/app/dashboard.ts": `export interface DashboardMetric { name: string; resource: string; label: string; labelKey: string; icon?: string; comment?: string; commentKey?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend" | "aggregate"; groupBy?: string; days?: number; field?: string; agg?: "sum" | "avg" | "min" | "max" }
export const dashboardMetrics: DashboardMetric[] = ${JSON.stringify(localizedDashboardMetrics, null, 2)};
`,
    "web/app/charts.ts": `export type ChartViewKind = "const" | "pie" | "bar" | "line" | "table";
export type ChartAggregate = "sum" | "avg" | "min" | "max";
export type ChartDataOperation = "count" | "sum" | "avg" | "min" | "max" | "trend" | "list";
export interface ChartDataDefinition { operation: ChartDataOperation; entity: string; field?: string; groupBy?: string; days?: number; columns?: string[]; }
export interface ChartLabelValue { value: string; label: string; labelKey: string; }
export interface ChartLabelsDefinition { field?: string; values: ChartLabelValue[]; }
export interface ChartViewDefinition { kind: ChartViewKind; label: string; labelKey: string; data: ChartDataDefinition; labels?: ChartLabelsDefinition; }
export interface ChartDefinition { name: string; title: string; labelKey: string; icon?: string; views: ChartViewDefinition[]; }
export type ChartVariant = "larger" | "xl" | "lg" | "large" | "medium" | "md" | "small" | "sm" | "xs";
export interface ChartPlacement { variant: ChartVariant; x: number; y: number; w: number; h: number; }
export interface ChartPanelChart { name: string; placements: ChartPlacement[]; }
export interface ChartPanelDefinition { name: string; title: string; labelKey: string; grid: { columns: number; rows: number }; charts: ChartPanelChart[]; }
export type ChartViewportCategory = "larger" | "medium" | "small";
export const chartViewKinds: ChartViewKind[] = ["const", "pie", "bar", "line", "table"];
export const chartVariantNames: ChartVariant[] = ${JSON.stringify([...qiyChartVariants])};
export const chartVariantBreakpoint: Record<ChartVariant, ChartViewportCategory> = { larger: "larger", xl: "larger", lg: "larger", large: "larger", medium: "medium", md: "medium", small: "small", sm: "small", xs: "small" };
export const chartViewportBreakpoints = { larger: 1200, medium: 768 } as const;
export function chartViewportCategory(width: number): ChartViewportCategory { return width >= chartViewportBreakpoints.larger ? "larger" : width >= chartViewportBreakpoints.medium ? "medium" : "small"; }
export function chartViewKindLabelKey(kind: ChartViewKind): string { return "qiy.chartViewKind." + kind; }
/** Largest declared placement that fits the viewport category, falling back to the smallest declared one. */
export function selectChartPlacement(placements: ChartPlacement[], category: ChartViewportCategory): ChartPlacement | undefined {
  const buckets: ChartViewportCategory[] = ["larger", "medium", "small"];
  const byBucket = new Map<ChartViewportCategory, ChartPlacement>();
  for (const placement of placements) {
    const bucket = chartVariantBreakpoint[placement.variant];
    if (bucket && !byBucket.has(bucket)) byBucket.set(bucket, placement);
  }
  const start = buckets.indexOf(category);
  for (const bucket of buckets.slice(start)) { const found = byBucket.get(bucket); if (found) return found; }
  for (const bucket of buckets.slice(0, start).reverse()) { const found = byBucket.get(bucket); if (found) return found; }
  return placements[0];
}
export function defaultChartView(chart: ChartDefinition): ChartViewDefinition | undefined { return chart.views[0]; }
export const chartPanelStorageKey = "qiy.charts.panel";
type ChartPanelStorage = Pick<Storage, "getItem" | "setItem">;
function chartPanelStorage(): ChartPanelStorage | undefined { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } }
export function readStoredChartPanel(storage: ChartPanelStorage | undefined = chartPanelStorage()): string | undefined { try { return storage?.getItem(chartPanelStorageKey) ?? undefined; } catch { return undefined; } }
export function storeChartPanel(name: string, storage: ChartPanelStorage | undefined = chartPanelStorage()): void { try { storage?.setItem(chartPanelStorageKey, name); } catch { /* quota or private mode */ } }
export function resolveChartPanel(panels: ChartPanelDefinition[], stored: string | undefined): ChartPanelDefinition | undefined { return panels.find((panel) => panel.name === stored) ?? panels[0]; }
export const charts: ChartDefinition[] = ${JSON.stringify(localizedCharts, null, 2)};
export const chartPanels: ChartPanelDefinition[] = ${JSON.stringify(localizedChartPanels, null, 2)};
export const hasChartDashboard = charts.length > 0;
export function findChart(name: string): ChartDefinition | undefined { return charts.find((chart) => chart.name === name); }
`,
    ...(options.auth ? {
      "web/app/auth.ts": `import type { AccessControlProvider, AuthProvider } from "@refinedev/core";
${usesOidcAuth ? 'import { beginOidcLogin, beginOidcLogout, clearOidcSession, oidcSession, oidcSessionSkewMs } from "./auth/oidc-client";' : ""}${hybridAuth ? 'import { beginProviderLogin, clearSession, fetchAuthProviders } from "./auth/oidc-multi";' : ""}

const tokenKey = "qiy.access_token";
type QiyIdentity = { id?: string; name?: string; role?: string; permissions?: string[]; groups?: string[] };
const token = () => typeof window === "undefined" ? undefined : window.localStorage.getItem(tokenKey) ?? undefined;
/** With OIDC the stored expiry decides validity so an expired token never looks authenticated. */
const sessionUsable = () => typeof window === "undefined" ? false : ${usesOidcAuth ? `!oidcSession({ skewMs: oidcSessionSkewMs }).expired` : "Boolean(token())"};
/**
 * Identity lookups are shared for the lifetime of an access token. Refine calls
 * getIdentity and the access-control can hook many times per navigation; without
 * this cache every call issued another GET /api/v1/auth/me. Concurrent callers share
 * one in-flight request and the successful result is reused for a minute.
 */
const identityCacheTtlMs = 60_000;
let identityCache: { token: string; value: QiyIdentity | null; at: number } | undefined;
let identityInflight: { token: string; promise: Promise<QiyIdentity | null> } | undefined;
export function clearIdentityCache(): void { identityCache = undefined; identityInflight = undefined; }
async function loadIdentity(): Promise<QiyIdentity | null> {
  const accessToken = token();
  if (!accessToken) return null;
  if (identityCache && identityCache.token === accessToken && Date.now() - identityCache.at < identityCacheTtlMs) return identityCache.value;
  if (identityInflight && identityInflight.token === accessToken) return identityInflight.promise;
  const promise = (async () => {
    try {
      const response = await fetch("/api/v1/auth/me", { headers: { Authorization: "Bearer " + accessToken } });
      if (!response.ok) return null;
      return await response.json() as QiyIdentity;
    } catch { return null; }
  })().then((value) => {
    identityCache = { token: accessToken, value, at: Date.now() };
    return value;
  }).finally(() => { if (identityInflight?.token === accessToken) identityInflight = undefined; });
  identityInflight = { token: accessToken, promise };
  return promise;
}
export const qiyAuthProvider: AuthProvider = {
  login: async ({ token: nextToken, username, email, password, identifier, challengeToken, code${hybridAuth ? ", providerName" : ""} }: { token?: string; username?: string; email?: string; password?: string; identifier?: string; challengeToken?: string; code?: string${hybridAuth ? "; providerName?: string" : ""} }) => {
    const loginName = username ?? email;
    ${hybridAuth ? `if (providerName) {
      const providers = await fetchAuthProviders();
      const selected = providers.find((candidate) => candidate.id === providerName);
      if (!selected) return { success: false, error: { name: "ProviderUnavailable", message: "That identity provider is not configured on the server" } };
      await beginProviderLogin(selected);
      return { success: true };
    }` : ""}
    ${hasLocalAuth ? `
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
    return { success: false, error: { name: "CredentialsRequired", message: ${JSON.stringify(usesOtpAuth ? "Identifier, challenge token and one-time password are required" : hasLocalAuth ? "Username and password are required" : "Identity provider login could not start")} } };
  },
  logout: async () => { clearIdentityCache(); ${hybridAuth ? "clearSession();" : usesOidcAuth ? "clearOidcSession();" : 'window.localStorage.removeItem(tokenKey);'} ${usesOidcAuth ? "beginOidcLogout();" : ""} return { success: true, redirectTo: "/auth/login" }; },
  check: async () => sessionUsable() ? { authenticated: true } : { authenticated: false, redirectTo: "/auth/login" },
  getIdentity: async () => loadIdentity(),
  getPermissions: async () => { const identity = await loadIdentity(); return identity?.role ?? null; },
  onError: async (error) => { clearIdentityCache(); return error?.statusCode === 401 ? { logout: true, redirectTo: "/auth/login" } : {}; },
};
const commandPolicies: Array<{ resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpression } }> = ${JSON.stringify(actionPolicies)};
const commandVerifications: Record<string, QiyPermissionExpression> = ${JSON.stringify(commandVerifications)};
${commandPolicyTypes}${commandPolicyFunctions}${resourcePolicyDeclaration}${pageRuleDeclaration}export const qiyAccessControlProvider: AccessControlProvider = { can: async ({ resource, action }) => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; if (!identity) return { can: false, reason: "Authentication required" }; ${resourcePolicyCheck}${pageRuleCheck}const command = commandPolicies.find((policy) => policy.resource === resource && policy.action === action); if (command) { ${commandPermissionEvaluation}return { can: command.roles.includes(identity.role ?? ""), reason: "Command execution is restricted" }; } if (identity.role === "admin") return { can: true }; if (resource === "users") return { can: false, reason: "User administration is restricted" }; const can = identity.role === "operator" || action === "list" || action === "show"; return can ? { can: true } : { can: false, reason: "Role " + (identity.role ?? "unknown") + " cannot " + action + " " + resource }; }, options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true }, queryOptions: { staleTime: 30_000 } } };
export function qiyAuthToken(): string | undefined { return token(); }
/** Cached identity for non-hook callers (route modules must not use auth hooks). */
export async function fetchCurrentIdentity(): Promise<QiyIdentity | null> { return loadIdentity(); }
`,
      "web/app/routes/login.tsx": hybridAuth
        ? `import { AuthPage } from "@refinedev/antd";
import { useEffect, useState } from "react";
import { fetchAuthProviders } from "../auth/oidc-multi";

/**
 * One login page for password accounts and every OAuth provider configured on
 * the server. AuthPage renders the credentials form; the providers prop adds one
 * button per provider (the login mutation then starts the PKCE redirect).
 */
export default function Login() {
  const [providers, setProviders] = useState<Array<{ name: string; label: string }>>([]);
  useEffect(() => { let active = true; void fetchAuthProviders().then((list) => { if (active) setProviders(list.map((provider) => ({ name: provider.id, label: provider.label }))); }).catch(() => undefined); return () => { active = false; }; }, []);
  return <AuthPage type="login" title="Qiy Admin" providers={providers} registerLink={false} forgotPasswordLink={false} rememberMe={false} formProps={{ layout: "vertical" }} />;
}
`
        : options.auth?.provider === "local"
        ? `import { AuthPage } from "@refinedev/antd";
export default function Login() { return <AuthPage type="login" title="Qiy Admin" registerLink={false} forgotPasswordLink={false} formProps={{ layout: "vertical" }} />; }
`
        : usesOtpAuth
          ? `import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { useState } from "react";
import { useLogin, useTranslation } from "@refinedev/core";
export default function Login() { const { translate } = useTranslation(); const [identifier, setIdentifier] = useState(""); const [challengeToken, setChallengeToken] = useState(""); const [code, setCode] = useState(""); const [requesting, setRequesting] = useState(false); const [requestError, setRequestError] = useState<string>(); const { mutate, isPending, error } = useLogin(); const requestCode = async () => { setRequesting(true); setRequestError(undefined); try { const response = await fetch("/api/v1/auth/otp/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier }) }); const result = await response.json().catch(() => null) as { challengeToken?: string; error?: string; devCode?: string } | null; if (!response.ok || !result?.challengeToken) throw new Error(result?.error ?? translate("qiy.otpSendFailed", {}, "Could not send one-time password")); setChallengeToken(result.challengeToken); if (result.devCode) setCode(result.devCode); } catch (reason) { setRequestError(reason instanceof Error ? reason.message : String(reason)); } finally { setRequesting(false); } }; return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card title={translate("qiy.otpTitle", {}, "Qiy Admin sign in")} style={{ width: 420 }}><Space direction="vertical" style={{ width: "100%" }}><Typography.Paragraph type="secondary">{translate("qiy.otpHint", {}, "Enter the email, phone or model identifier configured for this account to receive a one-time password.")}</Typography.Paragraph><Input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={translate("qiy.otpIdentifier", {}, "Sign-in identifier")} disabled={Boolean(challengeToken)} />{challengeToken ? <><Input value={code} onChange={(event) => setCode(event.target.value)} placeholder={translate("qiy.otpCode", {}, "One-time password")} /><Button type="primary" loading={isPending} block onClick={() => mutate({ identifier, challengeToken, code })}>{translate("qiy.otpVerify", {}, "Verify and sign in")}</Button><Button block onClick={() => { setChallengeToken(""); setCode(""); }}>{translate("qiy.otpResend", {}, "Send again")}</Button></> : <Button type="primary" loading={requesting} block onClick={() => void requestCode()}>{translate("qiy.otpSend", {}, "Send code")}</Button>}{(requestError || error) && <Alert type="error" message={requestError ?? error?.message ?? String(error)} />}</Space></Card></div>; }
`
        : `import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useLogin, useTranslation } from "@refinedev/core";
import { beginOidcSilentRenew, consumeSilentAttempt, oidcSession, oidcSessionSkewMs, oidcProviderLabel } from "../auth/oidc-client";
export default function Login() { const { translate } = useTranslation(); const { mutate, isPending, error } = useLogin(); const [renewing, setRenewing] = useState(false); const [renewError, setRenewError] = useState<string>(); useEffect(() => { if (!oidcSession({ skewMs: oidcSessionSkewMs }).expired) return; if (!consumeSilentAttempt()) return; setRenewing(true); void beginOidcSilentRenew("/").catch((reason: unknown) => { setRenewError(reason instanceof Error ? reason.message : String(reason)); setRenewing(false); }); }, []); return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card title={translate("qiy.oidcTitle", {}, "Qiy Admin sign in")} style={{ width: 420 }}><Space direction="vertical" style={{ width: "100%" }}><Typography.Paragraph type="secondary">{translate("qiy.oidcHint", { provider: ${JSON.stringify(authProviderLabel)} })}</Typography.Paragraph>{renewing ? <><Spin /><Typography.Paragraph>{translate("qiy.oidcRenewing", {}, "Trying silent renewal…")}</Typography.Paragraph></> : <Button type="primary" loading={isPending} block onClick={() => mutate({})}>{translate("qiy.oidcSignIn", { provider: ${JSON.stringify(authProviderLabel)} })}</Button>}{(renewError || error) && <Alert type="error" message={renewError ?? error?.message ?? String(error)} />}</Space></Card></div>; }
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
import { useTranslation } from "@refinedev/core";
import { completeOidcLogin, isSilentRenewFailure, oidcProviderLabel } from "../auth/oidc-client";
export default function AuthCallback() { const navigate = useNavigate(); const { translate } = useTranslation(); const [error, setError] = useState<string>(); useEffect(() => { void completeOidcLogin(window.location.href).then((target) => navigate(target, { replace: true })).catch((reason) => { const message = reason instanceof Error ? reason.message : String(reason); /* A silent renewal the provider refuses is not a failure: fall back to interactive login. */ if (isSilentRenewFailure(message)) { navigate("/auth/login", { replace: true }); return; } setError(message); }); }, [navigate]); return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card style={{ width: 420 }}>{error ? <Alert type="error" showIcon message={translate("qiy.providerLoginFailed", { provider: oidcProviderLabel })} description={error} /> : <><Spin /><Typography.Paragraph style={{ marginTop: 16 }}>{translate("qiy.completingProviderSignIn", { provider: oidcProviderLabel })}</Typography.Paragraph></>}</Card></div>; }
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
import { clearIdentityCache, qiyAccessControlProvider, qiyAuthProvider } from "../app/auth";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const tokens = new Map<string, string>();
let role = "viewer";
let identityPermissions: string[] | undefined;
let identityGroups: string[] | undefined;
beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => tokens.get(key) ?? null, setItem: (key: string, value: string) => { tokens.set(key, value); }, removeItem: (key: string) => { tokens.delete(key); } }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, location: { origin: "http://localhost", pathname: "/", search: "", assign: () => {} } } });
  globalThis.fetch = (async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("/auth/login") ? { accessToken: "local-test-token" } : { id: "test-user", role, ...(Array.isArray(identityPermissions) ? { permissions: identityPermissions } : {}), ...(Array.isArray(identityGroups) ? { groups: identityGroups } : {}) }), { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
});
afterAll(() => { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); globalThis.fetch = originalFetch; });

test("authenticates using ${hasLocalAuth ? "username and password" : "the configured identity provider"}", async () => {
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
  ${hasLocalAuth ? 'expect((await qiyAuthProvider.login({ username: "admin", password: "correct-password" })).success).toBe(true); expect(tokens.get("qiy.access_token")).toBe("local-test-token");' : 'tokens.set("qiy.access_token", "test-token");'}
  expect((await qiyAuthProvider.check({})).authenticated).toBe(true);
});

test("matches server admin, operator and viewer role policy", async () => {
${["viewer", "operator", "admin"].map((role) => `  role = ${JSON.stringify(role)}; clearIdentityCache();\n${roleExpectations(role).join("\n")}`).join("\n")}
  await qiyAuthProvider.logout({});
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
});
test("decides every resource page action, so route guards cannot be bypassed by URL", async () => {
  tokens.set("qiy.access_token", "page-guard-token");
${["viewer", "operator", "admin"].map((role) => `  role = ${JSON.stringify(role)}; clearIdentityCache();\n${roleExpectations(role).join("\n")}`).join("\n")}
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
      clearIdentityCache();
      expect((await qiyAccessControlProvider.can({ resource: policy.resource, action: policy.action })).can).toBe(policy.roles.includes(candidate));
    }
  }
  tokens.clear();
  ${actionPolicies.map((policy) => `expect((await qiyAccessControlProvider.can({ resource: ${JSON.stringify(policy.resource)}, action: ${JSON.stringify(policy.action)} })).can).toBe(false);`).join("\n  ")}
});
` : ""}${webPermissionCases.length ? `
const permissionCases = ${JSON.stringify(webPermissionCases.map((item) => ({ policy: { resource: item.policy.resource, action: item.policy.action }, variant: item.variant })))};
test("permission-guarded commands follow effective permissions from /auth/me", async () => {
  tokens.set("qiy.access_token", "permission-test-token");
  for (const item of permissionCases) {
    role = item.variant.role;
    identityPermissions = item.variant.permissions;
    identityGroups = item.variant.groups;
    clearIdentityCache();
    expect({ policy: item.policy, allowed: (await qiyAccessControlProvider.can({ resource: item.policy.resource, action: item.policy.action })).can }).toEqual({ policy: item.policy, allowed: item.variant.expected });
  }
  // Without permission metadata the generated provider keeps the legacy role allow list.
  identityPermissions = undefined;
  identityGroups = undefined;
  role = "viewer";
  clearIdentityCache();
  for (const policy of ${JSON.stringify(webPermissionPolicies.map((policy) => ({ resource: policy.resource, action: policy.action, roles: policy.roles })))}) {
    expect((await qiyAccessControlProvider.can({ resource: policy.resource, action: policy.action })).can).toBe(policy.roles.includes("viewer"));
  }
  tokens.clear();
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
  /** True when the current user owns the row; the list page only offers delete for own rows. */
  mine?: boolean;
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
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

/**
 * Publishing is an upsert keyed by name: the server updates the caller's existing
 * row with that name instead of adding a duplicate dropdown entry.
 */
export async function publishServerView(input: { resource: string; name: string; shared?: boolean; search?: string; filters?: unknown[]; sorters?: unknown[]; columns?: string[] }, fetcher: typeof fetch = fetch): Promise<QiyServerView> {
  const response = await fetcher("/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json", ...bearer() }, body: JSON.stringify({ shared: false, ...input }) });
  const body = await response.json().catch(() => null) as (QiyServerView & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? "Saving the view failed: " + response.status);
  return body;
}

/** Deletes a server view; 401/403/404 become explicit errors the list page can report. */
export async function deleteServerView(input: { resource: string; id: string }, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/v1/saved-views/" + encodeURIComponent(input.id), { method: "DELETE", headers: bearer() });
  if (response.status === 401) throw new Error("Sign in again to delete the saved view for " + input.resource);
  if (response.status === 403) throw new Error("Only the owner or an admin can delete the saved view for " + input.resource);
  if (response.status === 404) throw new Error("The saved view for " + input.resource + " no longer exists");
  if (!response.ok) throw new Error("Deleting the saved view for " + input.resource + " failed: " + response.status);
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

/**
 * The dropdown mixes browser views with server views. Server rows are addressed as
 * "server:<id>" so one select value can stand for both kinds.
 */
export const SERVER_VIEW_PREFIX = "server:";
export type QiySavedViewKind = "local" | "server";
export function viewKind(id: string | undefined): QiySavedViewKind { return id?.startsWith(SERVER_VIEW_PREFIX) ? "server" : "local"; }
export function serverViewKey(id: string): string { return SERVER_VIEW_PREFIX + id; }
export function serverViewId(id: string | undefined): string | undefined { return id?.startsWith(SERVER_VIEW_PREFIX) ? id.slice(SERVER_VIEW_PREFIX.length) : undefined; }
/** Browser views are personal; server views are published (private) or shared with everyone. */
export type QiyViewMarker = "local" | "published" | "shared";
export function viewMarker(kind: QiySavedViewKind, shared: boolean): QiyViewMarker { return kind === "local" ? "local" : shared ? "shared" : "published"; }
/** Only own server rows are deletable in the UI; local rows always are. Fail closed when ownership is unknown. */
export function canDeleteView(view: { kind: QiySavedViewKind; mine?: boolean }): boolean { return view.kind === "local" || view.mine === true; }
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
import { canDeleteView, deleteSavedView, listSavedViews, saveView, serverViewId, serverViewKey, viewKind, viewMarker } from "../app/views";
import { deleteServerView, fetchServerViews, publishServerView } from "../app/views-api";

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

test("decides view kind, marker and deletability for local and server rows", () => {
  // Server rows are addressed with a "server:" prefix; plain ids are browser rows.
  expect(viewKind(undefined)).toBe("local");
  expect(viewKind("abc")).toBe("local");
  expect(viewKind("server:123")).toBe("server");
  expect(serverViewKey("123")).toBe("server:123");
  expect(serverViewId("server:123")).toBe("123");
  expect(serverViewId("abc")).toBeUndefined();
  // Local rows are personal; server rows are published (private) or shared.
  expect(viewMarker("local", false)).toBe("local");
  expect(viewMarker("server", false)).toBe("published");
  expect(viewMarker("server", true)).toBe("shared");
  // Local rows can always be deleted; server rows only when the caller owns them.
  expect(canDeleteView({ kind: "local" })).toBe(true);
  expect(canDeleteView({ kind: "server", mine: true })).toBe(true);
  expect(canDeleteView({ kind: "server", mine: false })).toBe(false);
  expect(canDeleteView({ kind: "server" })).toBe(false);
});

test("deletes server views through the API and reports 401/403/404", async () => {
  const calls: Array<{ url: string; method: string; authorization?: string }> = [];
  const responses = [new Response(null, { status: 204 }), new Response(null, { status: 401 }), new Response(null, { status: 403 }), new Response(null, { status: 404 })];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", authorization: (init?.headers as Record<string, string> | undefined)?.Authorization });
    return responses.shift() ?? new Response(null, { status: 500 });
  }) as typeof fetch;
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => "token-1" } } });
  try {
    // Bearer token is attached and the id is URL-encoded.
    await deleteServerView({ resource: "orders", id: "view 1" }, fetcher);
    expect(calls[0]).toMatchObject({ url: "/api/v1/saved-views/view%201", method: "DELETE", authorization: "Bearer token-1" });
    await expect(deleteServerView({ resource: "orders", id: "gone" }, fetcher)).rejects.toThrow("Sign in again");
    await expect(deleteServerView({ resource: "orders", id: "other" }, fetcher)).rejects.toThrow("Only the owner or an admin");
    await expect(deleteServerView({ resource: "orders", id: "missing" }, fetcher)).rejects.toThrow("no longer exists");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
  }
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
import { RelationCell } from "./relation-field";
import { formatFieldValue } from "../date-fields";
import { t, resolveLocale, type QiyLocale } from "../i18n";

interface RelatedResource { resource: string; field: string; label: string; labelKey: string; }

export function RelatedRecords({ relation, recordId }: { relation: RelatedResource; recordId: string }) {
  const { getLocale, translate } = useTranslation();
  const locale: QiyLocale = resolveLocale(getLocale());
  const resource = getResource(relation.resource);
  const { result, query } = useList<Record<string, unknown>>({
    resource: relation.resource,
    filters: [{ field: relation.field, operator: "eq", value: recordId }],
    pagination: { currentPage: 1, pageSize: 10 },
    queryOptions: { enabled: Boolean(recordId) },
  });
  const fields = resource?.fields.filter((field) => field.listVisible && !field.primaryKey && field.type !== "Vector").slice(0, 5) ?? [];
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => ({ title: translate(field.labelKey, {}, field.label), dataIndex: field.name, key: field.name, render: (value: unknown) => field.relation ? <RelationCell field={field} value={value} /> : formatFieldValue(field.type, value, locale) || "—" }));
  columns.push({ title: t(locale, "actions"), key: "actions", render: (_value, record) => <Link to={"/" + relation.resource + "/" + String(record.id)}>{t(locale, "view")}</Link> });
  if (!resource) return <Alert type="error" message={translate("qiy.relatedUnknown", { resource: relation.resource })} />;
  const total = result.total ?? 0;
  return <Card size="small" title={translate(relation.labelKey, {}, relation.label)} style={{ marginTop: 16 }}><Table<Record<string, unknown>> rowKey="id" loading={query.isLoading} dataSource={result.data} columns={columns} pagination={total > 10 ? { pageSize: 10, total, showSizeChanger: false } : false} scroll={{ x: "max-content" }} /></Card>;
}
`,
    "web/app/plugins/index.ts": `export interface WebPlugin { name: string; setup?(): void | Promise<void>; }\nexport const plugins: WebPlugin[] = [];\n`,
    "web/app/shared/types.ts": `export type ID = string;\nexport interface PageResult<T> { data: T[]; total: number; }\n`,
    "web/app/features/resources/index.ts": `export { resources, resourceNames, getResource } from "../../resources";\nexport type { ResourceDefinition, ResourceField, FieldType } from "../../resources";\n`,
    "web/app/resources.ts": `export type FieldType = "UUID" | "Text" | "Integer" | "Decimal" | "Money" | "Date" | "Time" | "DateTime" | "File" | "Files" | "Vector";
export interface ResourceEnumValue { name: string; label?: string; labelKey: string; color?: string; icon?: string; comment?: string; commentKey?: string; }
export interface ResourceEnumDefinition { name: string; label?: string; labelKey?: string; comment?: string; commentKey?: string; values: ResourceEnumValue[]; }
export interface ResourceField { name: string; label: string; labelKey: string; comment?: string; commentKey?: string; type: FieldType; nullable: boolean; primaryKey: boolean; visible: boolean; listVisible: boolean; formVisible: boolean; showVisible: boolean; sortable: boolean; filterable: boolean; filterModes: string[]; enumName?: string; enumValues?: ResourceEnumValue[]; relation?: { resource: string; labelField: string }; icon?: string; dimension?: number; uploadMode?: "binary" | "base64" | "both"; maxBytes?: number; mimeTypes?: string[]; maxFiles?: number; /** Page-level layout: the field is only rendered for these roles. */ roles?: string[]; /** Filled by the server on create (@code / @generated / system UUID); hidden on create forms. */ autoGenerated?: boolean; }
/** Page-level field layout check; a field without role rules is visible to everyone. */
export function canSeeField(field: ResourceField, role: string | undefined | null): boolean { return !field.roles || field.roles.includes(role ?? ""); }
/** Fields the create/edit form can edit: form-visible, not the primary key, not a Vector. */
export function isFormEditable(field: ResourceField): boolean { return field.formVisible && !field.primaryKey && field.type !== "Vector"; }
/** Create-form fields: generated values are filled by the server and never typed. */
export function createFormFields(resource: ResourceDefinition): ResourceField[] { return resource.fields.filter((field) => isFormEditable(field) && !field.autoGenerated); }
/** Edit-form fields: generated fields appear read-only so their value stays visible. */
export function editFormFields(resource: ResourceDefinition): ResourceField[] { return resource.fields.filter(isFormEditable); }
/** The generated fields of an edit form (rendered read-only and never submitted). */
export function generatedFormFields(resource: ResourceDefinition): ResourceField[] { return resource.fields.filter((field) => isFormEditable(field) && field.autoGenerated); }
 export interface ResourceDefinition { name: string; apiName: string; label: string; labelKey: string; singular: string; singularKey: string; plural: string; pluralKey: string; displayTemplate?: string; tableDisplayTemplate?: string; relationDetailTemplate?: string; comment?: string; commentKey?: string; icon: string; liveMode: "auto" | "manual" | "off"; menuParent?: string; fields: ResourceField[]; relatedResources?: Array<{ resource: string; field: string; label: string; labelKey: string }>; }
/** A sidebar group declared in the model menu block. */
export interface MenuGroupDefinition { name: string; label: string; labelKey: string; icon: string; parent?: string; comment?: string; commentKey?: string; /** Resources (table names) in the declared menu order. */ resources: string[]; }
export const enumerations: ResourceEnumDefinition[] = ${JSON.stringify(enumerationDefinitions(database), null, 2)};
export const menuGroups: MenuGroupDefinition[] = ${JSON.stringify(menuGroups.map((group) => ({ name: `menu-${group.name}`, label: group.label, labelKey: qiyModelKeys.menuLabel(group.name), icon: group.icon ?? "AppstoreOutlined", ...(group.parent && { parent: `menu-${group.parent}` }), ...(group.comment !== undefined && { comment: group.comment }), ...(group.commentKey !== undefined && { commentKey: group.commentKey }), resources: group.resources })), null, 2)};
export const resources: ResourceDefinition[] = ${resourceFields(database, menuGroups, options.realtime, options.pages)};
export const resourceNames = ${JSON.stringify(resourceNames)} as const;
export function getResource(name: string | undefined): ResourceDefinition | undefined { return resources.find((resource) => resource.name === name); }
`,
    ...(Object.keys(treeEntities).length ? {
      "web/app/components/tree-view.tsx": `import { useList, useTranslation } from "@refinedev/core";
import { Alert, Card, Empty, Space, Spin, Tree } from "antd";
import { useNavigate } from "react-router";
import { useState } from "react";
import { buildTree, type QiyTreeNode } from "../tree";
import { getResource } from "../resources";

type AntdNode = { key: string; title: string; children: AntdNode[] };
const toAntd = (nodes: Array<QiyTreeNode<Record<string, unknown>>>): AntdNode[] => nodes.map((node) => ({ key: node.key, title: node.title, children: toAntd(node.children) }));

export function TreeView({ resource, parentField, labelField }: { resource: string; parentField: string; labelField: string }) {
  const navigate = useNavigate();
  const { translate } = useTranslation();
  const config = getResource(resource);
  const [expanded, setExpanded] = useState<string[]>([]);
  const { result, query } = useList({ resource, pagination: { mode: "off" } });
  const records = (result.data ?? []) as Array<Record<string, unknown>>;
  const { nodes, orphans } = buildTree(records, parentField, labelField);
  return <Card title={config ? translate(config.labelKey, {}, config.label) : resource} extra={<span>{translate("qiy.treeNodesCount", { nodes: records.length })}</span>}>
    {query.isLoading && <Spin />}
    {query.error && <Alert type="error" message={String(query.error)} />}
    {!query.isLoading && !records.length && <Empty />}
    <Tree treeData={toAntd(nodes)} expandedKeys={expanded} onExpand={(keys) => setExpanded(keys.map(String))} onSelect={(keys) => { const id = String(keys[0] ?? ""); if (id) navigate("/" + resource + "/" + id); }} />
    {orphans.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 16 }} message={translate("qiy.treeOrphans", { nodes: orphans.length })} />}
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
 import { chartPanels, charts } from "../charts";
 import { ChartDashboard } from "../components/charts";
 import { qiyIcons } from "../icons";
 import { projectMessage } from "../messages";
import { t, resolveLocale, type QiyLocale } from "../i18n";

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
   return <Col xs={24} sm={12} lg={metric.span}><Card title={<Space><Icon style={{ color: token.colorPrimary }} /><span>{translate(metric.labelKey, {}, metric.label)}</span></Space>} loading={query.isLoading}><MetricDescription metric={metric} />{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map(({ value, count }) => { const item = field?.enumValues?.find((option) => option.name === value); const comment = item?.commentKey ? translate(item.commentKey, {}, item.comment) : item?.comment; return <div key={value ?? "null"}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text title={comment}>{item ? translate(item.labelKey, {}, item.label ?? value ?? "—") : value ?? "—"}</Typography.Text><Typography.Text type="secondary">{count}</Typography.Text></Space><Progress percent={total ? Math.round(count / total * 100) : 0} showInfo={false} /></div>; })}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
 }
 function TrendSummary({ metric }: { metric: DashboardMetric }) {
   const { translate } = useTranslation();
   const { result, query } = useCustom<{ items: Array<{ day: string; count: number }> }>({ url: \`/api/v1/\${metric.resource}/trend\`, method: "get", config: { query: { field: metric.groupBy, days: metric.days } } });
   const { token } = theme.useToken();
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const rows = result.data?.items ?? [];
   const max = Math.max(...rows.map((row) => row.count), 0);
   return <Col xs={24} lg={metric.span}><Card title={<Space><Icon style={{ color: token.colorPrimary }} /><span>{translate(metric.labelKey, {}, metric.label)}</span></Space>} loading={query.isLoading}><MetricDescription metric={metric} />{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map((row) => <div key={row.day}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text>{row.day}</Typography.Text><Typography.Text type="secondary">{row.count}</Typography.Text></Space><Progress percent={max ? Math.round(row.count / max * 100) : 0} showInfo={false} /></div>)}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
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
   const label = field ? translate(field.labelKey, {}, field.label) : metric.field ?? "";
   const aggKey = ({ sum: "qiy.aggSum", avg: "qiy.aggAvg", min: "qiy.aggMin", max: "qiy.aggMax" } as const)[metric.agg ?? "sum"];
   return <Col xs={24} sm={12} lg={metric.span}><Card title={<Space><Icon style={{ color: token.colorPrimary }} /><span>{translate(metric.labelKey, {}, metric.label)}</span></Space>} loading={query.isLoading}><MetricDescription metric={metric} />{query.error ? <Typography.Text type="danger">{String(query.error)}</Typography.Text> : <Statistic value={value ?? 0} precision={precision} suffix={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{translate(aggKey, {}, metric.agg ?? "sum") + " · " + label}</Typography.Text>} />}{value === null && !query.isLoading && !query.error && <Typography.Text type="secondary">{translate("qiy.noData", {}, "No data")}</Typography.Text>}</Card></Col>;
 }
 function ResourceSummary({ metric }: { metric: DashboardMetric }) {
   if (metric.type === "distribution") return <DistributionSummary metric={metric} />;
   if (metric.type === "trend") return <TrendSummary metric={metric} />;
   if (metric.type === "aggregate") return <AggregateSummary metric={metric} />;
   return <CountSummary metric={metric} />;
 }
 function CountSummary({ metric }: { metric: DashboardMetric }) {
   const { translate } = useTranslation();
   const { result, query } = useList({ resource: metric.resource, pagination: { currentPage: 1, pageSize: 1 } });
   const { token } = theme.useToken();
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   return <Col xs={24} sm={12} lg={metric.span}><Link to={\`/\${metric.resource}\`}><Card hoverable><Space><Icon style={{ fontSize: 24, color: token.colorPrimary }} /><div><Typography.Text type="secondary">{translate(metric.labelKey, {}, metric.label)}</Typography.Text><MetricDescription metric={metric} /><Statistic value={query.isLoading ? "—" : result.total ?? 0} /></div></Space></Card></Link></Col>;
}
export default function Home() {
  const { getLocale, translate } = useTranslation(); const locale: QiyLocale = resolveLocale(getLocale());
   return <Space direction="vertical" size="large" style={{ width: "100%" }}><div><Typography.Title level={2}>{t(locale, "overview")}</Typography.Title><Typography.Paragraph type="secondary">{t(locale, "overviewDescription")}</Typography.Paragraph></div>{charts.length > 0 ? <ChartDashboard charts={charts} panels={chartPanels} /> : <Row gutter={[16, 16]}>{dashboardMetrics.map((metric) => <CanAccess key={metric.name} resource={metric.resource} action="list"><ResourceSummary metric={metric} /></CanAccess>)}</Row>}<Card title={t(locale, "quickAccess")}><Space wrap>{resources.slice(0, 4).map((resource) => <CanAccess key={resource.name} resource={resource.name} action="list"><Link to={\`/\${resource.name}\`}>{translate(resource.pluralKey, {}, translate(resource.labelKey, {}, resource.label))}</Link></CanAccess>)}</Space></Card></Space>;
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
/**
 * Built-in chrome dictionary. Every value is keyed by the suffix of a
 * \`qiy.<key>\` message, so \`t(locale, key)\` and \`translate("qiy.<key>")\` both
 * resolve it, and a project \`messages\` block can override any entry with the
 * same qiy.* key. Values using {{name}} placeholders are interpolated by i18next.
 */
export const localeMessages = {
  "zh-CN": {
    new: "新建", edit: "编辑", view: "查看", back: "返回列表", delete: "删除", batchDelete: "批量删除", actions: "操作",
    visibleColumns: "显示列", confirmDelete: "确认删除选中记录？", deleted: "删除成功", unknownResource: "未知资源", detail: "详情",
    createResource: "新建{{resource}}", editResource: "编辑{{resource}}", openDetail: "打开详情", searchRelation: "搜索…",
    drawerBreadcrumb: "关联记录路径", recordDetails: "字段详情", recordSummary: "关联摘要", close: "关闭",
    chartView: "视图", "chartViewKind.const": "统计", "chartViewKind.pie": "饼图", "chartViewKind.bar": "柱状图", "chartViewKind.line": "折线图", "chartViewKind.table": "表格",
    "docs.title": "功能总览", "docs.subtitle": "当前应用生成的实体、数据流、API 文档与访问密钥",
    "docs.tabEntities": "实体系", "docs.tabDataflows": "Dataflow", "docs.tabApi": "API 文档", "docs.tabPermissions": "权限模型", "docs.tabApiKeys": "访问密钥",
    "docs.entitiesTitle": "实体与关系", "docs.relationsTitle": "关系", "docs.accessNote": "API 文档只列出当前角色和权限允许的操作",
    "docs.apiFiltered": "该文档已按当前账号的权限过滤", "docs.panelError": "该分区暂时无法渲染", "docs.mermaidError": "图表渲染失败", "docs.mermaidTimeout": "图表渲染超时，已显示源码", "docs.emptySpec": "暂无 OpenAPI 文档", "docs.emptySpecHint": "当前账号没有可见的 API 操作", "docs.principal": "当前主体", "docs.parameters": "参数", "docs.paramName": "名称", "docs.paramIn": "位置", "docs.paramRequired": "必填", "docs.requestBody": "请求体", "docs.responses": "响应", "docs.responseStatus": "状态码", "docs.responseDescription": "说明", "docs.security": "认证", "docs.securityBearer": "会话 JWT", "docs.securityApiKey": "X-API-Key 请求头", "docs.curl": "curl 示例", "docs.roles": "允许角色", "docs.permissions": "所需权限",
    "docs.noData": "暂无可查看的内容", "docs.loadError": "功能总览加载失败", "docs.entity": "实体", "docs.selectEntity": "选择实体",
    "docs.fieldName": "字段", "docs.fieldType": "类型", "docs.fieldNullable": "可空", "docs.fieldEnum": "枚举", "docs.fieldAnnotations": "注解",
    "docs.restricted": "受限", "docs.actions": "操作", "docs.from": "来源", "docs.to": "目标", "docs.onDelete": "删除策略",
    "docs.dataflowsTitle": "数据流", "docs.allowRoles": "允许角色", "docs.allowPermissions": "所需权限", "docs.verification": "权限校验",
    "docs.dataflowInputs": "输入", "docs.dataflowSteps": "步骤", "docs.dataflowResult": "结果", "docs.role": "角色",
    "docs.effectivePermissions": "有效权限", "docs.permissionField": "权限", "docs.permissionValue": "值", "docs.permissionGroups": "权限组",
    "docs.permissionVerifications": "权限校验", "docs.members": "成员",
    "apiKey.title": "访问密钥", "apiKey.description": "用于脚本和 CI 的个人访问密钥；完整密钥只显示一次。",
    "apiKey.create": "创建密钥", "apiKey.name": "名称", "apiKey.namePlaceholder": "例如 CI 部署", "apiKey.nameRequired": "请输入名称",
    "apiKey.expires": "过期时间", "apiKey.expiresHint": "服务端 expiresAt 可选；留空即长期有效。",
    "apiKey.empty": "暂无访问密钥", "apiKey.prefix": "前缀", "apiKey.createdAt": "创建时间", "apiKey.lastUsed": "最近使用", "apiKey.status": "状态",
    "apiKey.active": "有效", "apiKey.revoked": "已撤销", "apiKey.expired": "已过期", "apiKey.revoke": "撤销", "apiKey.actions": "操作",
    "apiKey.revokeConfirm": "确定撤销该密钥？撤销后立即失效。", "apiKey.secretTitle": "请立即保存密钥",
    "apiKey.secretHint": "完整密钥只显示一次，关闭后无法找回。", "apiKey.copy": "复制", "apiKey.copied": "已复制", "apiKey.created": "已创建",
    "apiKey.loadError": "访问密钥加载失败", "apiKey.limit": "每用户最多 {{count}} 个有效密钥",
    "apiDocs.title": "API 文档", "apiDocs.pageTitle": "API 文档", "apiDocs.pageSubtitle": "当前账号可调用的 OpenAPI 3.1 操作；只读查看，使用 curl 示例配合会话令牌或访问密钥调用。",
    "apiDocs.roleTooltip": "你的账号角色用于过滤本文档；无权调用的操作不会列出。", "apiDocs.permissionTooltip": "由角色、数据库列与已验证 claim 合成的权限；文档只包含你有权调用的操作。",
    "apiDocs.rolesTooltip": "你的角色需属于以下之一；本文档已按当前账号过滤。", "apiDocs.permissionsTooltip": "该操作还需要列出的全部权限；本文档已按当前账号过滤。",
    "apiDocs.securityTooltip": "该操作支持的认证方式。", "apiDocs.currentRole": "角色", "apiDocs.currentPermissions": "权限",
    "apiDocs.searchPlaceholder": "搜索路径、方法、摘要或标签", "apiDocs.resultCount": "共 {{count}} 个操作", "apiDocs.noResults": "没有匹配的操作", "apiDocs.loadError": "API 文档加载失败",
    "apiKey.pageTitle": "访问密钥", "apiKey.pageSubtitle": "用于脚本和 CI 的个人访问密钥；每个密钥继承你的角色与权限，可通过 Bearer 令牌或 X-API-Key 请求头使用。",
    "apiKey.curlTitle": "在 curl 中使用密钥", "apiKey.apiDocsLink": "查看当前账号可用的 API 文档", "apiKey.searchPlaceholder": "搜索名称、前缀或状态",
    "apiKey.status.all": "全部", "apiKey.status.active": "有效", "apiKey.status.revoked": "已撤销", "apiKey.status.expired": "已过期",
    "apiKey.limitHint": "个有效密钥", "apiKey.never": "从未", "apiKey.revokedMessage": "已撤销",
    "apiKey.roleTooltip": "你的账号角色；密钥继承创建者的角色与权限。", "apiKey.permissionTooltip": "你的有效权限值；在此创建的密钥能调用的 API 与你一致。", "apiKey.groupTooltip": "授权给你账号的权限组（角色）。",
    yes: "是", no: "否",
    language: "语言", save: "保存", cancel: "取消", deleteSuccess: "删除成功", requiredWithLabel: "请输入\${label}", loading: "加载中", quickAccess: "快速访问", upload: "上传文件",
    overview: "概览", overviewDescription: "从数据资源快速进入业务管理。", profile: "个人中心", filters: "筛选", search: "搜索",
    matchAll: "全部匹配", matchAny: "任一匹配", commaSeparated: "（逗号分隔）", forbidden: "没有访问该页面的权限",
    noData: "暂无数据", vectorData: "向量数据", pickDate: "选择日期", pickTime: "选择时间", pickDateTime: "选择日期和时间",
    autoGenerated: "此值由服务器自动生成，无需手工填写。",
    import: "导入 CSV", export: "导出 CSV", exportSelected: "导出选中", views: "已存视图", viewName: "视图名称",
    saveView: "保存视图", saveToServer: "保存到服务器", shareView: "共享给所有人", publishView: "发布视图",
    saved: "视图已保存", viewShared: "视图已共享给所有人", viewPublished: "视图已保存到服务器", deleteView: "删除视图",
    viewDeleted: "视图已删除", viewDeleteFailed: "删除视图失败", confirmDeleteView: "删除该视图？",
    viewMine: "个人", viewPublishedTag: "发布", viewSharedTag: "共享", viewResource: "查看{{resource}}",
    treeView: "树视图", shared: "（共享）", importProgress: "正在导入：{{processed}}/{{total}}",
    importedRows: "已导入 {{rows}} 行", importFailed: "导入失败", publishFailed: "发布视图失败",
    paginationTotal: "第 {{start}}-{{end}} 条，共 {{total}} 条", perPage: "条/页", page: "页",
    treeNodesCount: "{{nodes}} 个节点", treeOrphans: "{{nodes}} 个节点的父级缺失或成环",
    relatedUnknown: "未知关联资源：{{resource}}",
    auditTitle: "操作审计", auditAction: "操作", auditAuthor: "操作人", auditSystem: "系统", auditTime: "时间",
    aggSum: "求和", aggAvg: "平均", aggMin: "最小值", aggMax: "最大值",
    uploadFailed: "上传失败：{{status}}", createForbidden: "没有创建该资源的权限。", editForbidden: "没有编辑该资源的权限。",
    themeColor: "主题色", themeBlue: "蓝色", themePurple: "紫色", themeGreen: "绿色", themeOrange: "橙色", themeRed: "红色",
    colorMode: "颜色模式", colorLight: "亮色", colorDark: "暗色", colorSystem: "跟随系统",
    profileTitle: "个人中心", account: "账号", signOut: "退出登录", username: "用户名", email: "邮箱", name: "姓名",
    role: "角色", password: "密码", passwordSet: "已设置", passwordNotSet: "未设置", linkedMethods: "已关联登录方式",
    noProviders: "未配置 OAuth 提供方", linked: "已关联", notLinked: "尚未关联", bind: "关联", unbind: "解除关联",
    unlinkTitle: "解除关联 {{provider}}？", unlinkKeep: "之后可以重新关联。", unlinkLast: "这是最后一个登录方式。",
    linkedToast: "已关联 {{provider}}", unlinkedToast: "已解除关联 {{provider}}",
    onboardingInvalid: "此账号开通链接无效或已过期。", backToSignIn: "返回登录", finishAccount: "完成账号创建",
    signedInWith: "已通过 {{provider}} 登录。", confirmAccount: "请确认账号信息并设置密码。", fieldRequired: "此项为必填项",
    invalidEmail: "请输入有效的邮箱地址", confirmPassword: "确认密码",
    passwordMin: "至少 8 个字符", passwordMismatch: "两次输入的密码不一致", createAccount: "创建账号并登录",
    alreadyHaveAccount: "已有密码账号？", signInAction: "登录", linkProviderHint: "登录后可在个人中心关联此登录方式。",
    loginNotConfigured: "此应用未配置认证。",
    completingSignIn: "正在完成登录…", completingProviderSignIn: "正在完成 {{provider}} 登录…", providerLoginFailed: "{{provider}} 登录失败",
    multiProviderHint: "请选择身份提供方登录。", noProviderConfigured: "服务器未配置身份提供方",
    otpTitle: "Qiy Admin 登录", otpHint: "输入邮箱、手机号或模型配置的唯一登录标识，获取一次性验证码。",
    otpIdentifier: "登录标识", otpCode: "一次性验证码", otpSend: "发送验证码", otpVerify: "验证并登录",
    otpResend: "重新发送", otpSendFailed: "验证码发送失败",
    oidcTitle: "Qiy Admin 登录", oidcHint: "使用 {{provider}} Authorization Code + PKCE 登录；浏览器不保存 client secret，会话过期时先尝试静默续期。",
    oidcSignIn: "使用 {{provider}} 登录", oidcRenewing: "正在尝试静默续期…",
  },
  "en-US": {
    new: "New", edit: "Edit", view: "View", back: "Back to list", delete: "Delete", batchDelete: "Batch delete", actions: "Actions",
    visibleColumns: "Columns", confirmDelete: "Delete selected records?", deleted: "Deleted", unknownResource: "Unknown resource", detail: "Detail",
    createResource: "Create {{resource}}", editResource: "Edit {{resource}}", openDetail: "Open details", searchRelation: "Search…",
    drawerBreadcrumb: "Related record path", recordDetails: "Field details", recordSummary: "Relation summary", close: "Close",
    chartView: "View", "chartViewKind.const": "Stat", "chartViewKind.pie": "Pie chart", "chartViewKind.bar": "Bar chart", "chartViewKind.line": "Line chart", "chartViewKind.table": "Table",
    "docs.title": "Feature overview", "docs.subtitle": "Entities, dataflows, API reference and access keys generated for this application",
    "docs.tabEntities": "Entities", "docs.tabDataflows": "Dataflow", "docs.tabApi": "API reference", "docs.tabPermissions": "Permissions", "docs.tabApiKeys": "API keys",
    "docs.entitiesTitle": "Entities & relations", "docs.relationsTitle": "Relations", "docs.accessNote": "The API reference only lists operations allowed for your role and permissions",
    "docs.apiFiltered": "This document is filtered by the current account permissions", "docs.panelError": "This section could not be rendered", "docs.mermaidError": "Diagram failed to render", "docs.mermaidTimeout": "Diagram rendering timed out; showing the source instead", "docs.emptySpec": "No OpenAPI document", "docs.emptySpecHint": "This account has no documented operations", "docs.principal": "Principal", "docs.parameters": "Parameters", "docs.paramName": "Name", "docs.paramIn": "In", "docs.paramRequired": "Required", "docs.requestBody": "Request body", "docs.responses": "Responses", "docs.responseStatus": "Status", "docs.responseDescription": "Description", "docs.security": "Security", "docs.securityBearer": "Session JWT", "docs.securityApiKey": "X-API-Key header", "docs.curl": "curl example", "docs.roles": "Roles", "docs.permissions": "Permissions",
    "docs.noData": "Nothing to show", "docs.loadError": "Failed to load the overview", "docs.entity": "Entity", "docs.selectEntity": "Entity",
    "docs.fieldName": "Field", "docs.fieldType": "Type", "docs.fieldNullable": "Nullable", "docs.fieldEnum": "Enum", "docs.fieldAnnotations": "Annotations",
    "docs.restricted": "Restricted", "docs.actions": "Actions", "docs.from": "From", "docs.to": "To", "docs.onDelete": "On delete",
    "docs.dataflowsTitle": "Dataflows", "docs.allowRoles": "Allowed roles", "docs.allowPermissions": "Required permissions", "docs.verification": "Verification",
    "docs.dataflowInputs": "Inputs", "docs.dataflowSteps": "Steps", "docs.dataflowResult": "Result", "docs.role": "Role",
    "docs.effectivePermissions": "Effective permissions", "docs.permissionField": "Permission", "docs.permissionValue": "Value", "docs.permissionGroups": "Groups",
    "docs.permissionVerifications": "Verifications", "docs.members": "Members",
    "apiKey.title": "API keys", "apiKey.description": "Personal API keys for scripts and CI; the full secret is shown only once.",
    "apiKey.create": "Create key", "apiKey.name": "Name", "apiKey.namePlaceholder": "e.g. CI deploy", "apiKey.nameRequired": "Name is required",
    "apiKey.expires": "Expires", "apiKey.expiresHint": "The server-side expiresAt is optional; leave it empty for a non-expiring key.",
    "apiKey.empty": "No API keys yet", "apiKey.prefix": "Prefix", "apiKey.createdAt": "Created", "apiKey.lastUsed": "Last used", "apiKey.status": "Status",
    "apiKey.active": "Active", "apiKey.revoked": "Revoked", "apiKey.expired": "Expired", "apiKey.revoke": "Revoke", "apiKey.actions": "Actions",
    "apiKey.revokeConfirm": "Revoke this key? It stops working immediately.", "apiKey.secretTitle": "Save this secret now",
    "apiKey.secretHint": "The full key is shown only once and cannot be recovered.", "apiKey.copy": "Copy", "apiKey.copied": "Copied", "apiKey.created": "Created",
    "apiKey.loadError": "Failed to load API keys", "apiKey.limit": "Up to {{count}} active keys per user",
    "apiDocs.title": "API reference", "apiDocs.pageTitle": "API reference", "apiDocs.pageSubtitle": "OpenAPI 3.1 operations allowed for the current account. Read-only: use the curl examples with a session token or an API key.",
    "apiDocs.roleTooltip": "Your account role is used to filter this document; operations you cannot call are not listed.", "apiDocs.permissionTooltip": "Permission values from your role, database column and verified claims. The document only contains operations you may call.",
    "apiDocs.rolesTooltip": "Your role must be one of these roles; this document is already filtered for your account.", "apiDocs.permissionsTooltip": "The operation additionally requires every listed permission; this document is already filtered for your account.",
    "apiDocs.securityTooltip": "Supported authentication schemes for this operation.", "apiDocs.currentRole": "Role", "apiDocs.currentPermissions": "Permissions",
    "apiDocs.searchPlaceholder": "Search path, method, summary or tag", "apiDocs.resultCount": "{{count}} operation(s)", "apiDocs.noResults": "No operations match this search", "apiDocs.loadError": "Failed to load the API document",
    "apiKey.pageTitle": "Access keys", "apiKey.pageSubtitle": "Personal API keys for scripts and CI. Each key inherits your role and permissions and can be used as a Bearer token or X-API-Key header.",
    "apiKey.curlTitle": "Using a key with curl", "apiKey.apiDocsLink": "View the API reference allowed for your account", "apiKey.searchPlaceholder": "Search name, prefix or status",
    "apiKey.status.all": "All", "apiKey.status.active": "Active", "apiKey.status.revoked": "Revoked", "apiKey.status.expired": "Expired",
    "apiKey.limitHint": "active keys", "apiKey.never": "Never", "apiKey.revokedMessage": "Revoked",
    "apiKey.roleTooltip": "Your account role. API keys inherit the role and permissions of the user who created them.", "apiKey.permissionTooltip": "Effective permission values for your account; a key created here can call exactly the APIs that you can call.", "apiKey.groupTooltip": "Permission groups (roles) granted to your account.",
    yes: "Yes", no: "No",
    language: "Language", save: "Save", cancel: "Cancel", deleteSuccess: "Deleted", requiredWithLabel: "\${label} is required", loading: "Loading", quickAccess: "Quick access", upload: "Upload file",
    overview: "Overview", overviewDescription: "Jump into your data resources from one place.", profile: "Profile", filters: "Filters", search: "Search",
    matchAll: "Match all", matchAny: "Match any", commaSeparated: " (comma separated)", forbidden: "You are not allowed to open this page",
    noData: "No data", vectorData: "Vector data", pickDate: "Select date", pickTime: "Select time", pickDateTime: "Select date and time",
    autoGenerated: "This value is generated automatically by the server.",
    import: "Import CSV", export: "Export CSV", exportSelected: "Export selected", views: "Saved views", viewName: "View name",
    saveView: "Save view", saveToServer: "Save to server", shareView: "Share with everyone", publishView: "Publish view",
    saved: "View saved", viewShared: "View shared with everyone", viewPublished: "View saved to server", deleteView: "Delete view",
    viewDeleted: "View deleted", viewDeleteFailed: "Deleting the view failed", confirmDeleteView: "Delete this view?",
    viewMine: "Personal", viewPublishedTag: "Published", viewSharedTag: "Shared", viewResource: "View {{resource}}",
    treeView: "Tree view", shared: " (shared)", importProgress: "Importing: {{processed}}/{{total}}",
    importedRows: "{{rows}} row(s) imported", importFailed: "Import failed", publishFailed: "Publishing the view failed",
    paginationTotal: "{{start}}-{{end}} of {{total}}", perPage: "/ page", page: "page",
    treeNodesCount: "{{nodes}} node(s)", treeOrphans: "{{nodes}} node(s) have a missing or cyclic parent",
    relatedUnknown: "Unknown related resource: {{resource}}",
    auditTitle: "Audit history", auditAction: "Action", auditAuthor: "Author", auditSystem: "System", auditTime: "Time",
    aggSum: "sum", aggAvg: "avg", aggMin: "min", aggMax: "max",
    uploadFailed: "Upload failed: {{status}}", createForbidden: "You do not have permission to create this resource.", editForbidden: "You do not have permission to edit this resource.",
    themeColor: "Theme color", themeBlue: "Blue", themePurple: "Purple", themeGreen: "Green", themeOrange: "Orange", themeRed: "Red",
    colorMode: "Color mode", colorLight: "Light", colorDark: "Dark", colorSystem: "System",
    profileTitle: "Profile", account: "Account", signOut: "Sign out", username: "Username", email: "Email", name: "Name",
    role: "Role", password: "Password", passwordSet: "Set", passwordNotSet: "Not set", linkedMethods: "Linked sign-in methods",
    noProviders: "No OAuth providers configured", linked: "Linked", notLinked: "Not linked yet", bind: "Bind", unbind: "Unbind",
    unlinkTitle: "Unlink {{provider}}?", unlinkKeep: "You can link it again later.", unlinkLast: "This is your last sign-in method.",
    linkedToast: "Linked {{provider}}", unlinkedToast: "Unlinked {{provider}}",
    onboardingInvalid: "This onboarding link is invalid or has expired.", backToSignIn: "Back to sign in", finishAccount: "Finish creating your account",
    signedInWith: "Signed in with {{provider}}.", confirmAccount: "Confirm the account details and choose a password.", fieldRequired: "This field is required",
    invalidEmail: "Enter a valid email address", confirmPassword: "Confirm password",
    passwordMin: "Use at least 8 characters", passwordMismatch: "Passwords do not match", createAccount: "Create account and sign in",
    alreadyHaveAccount: "Already have an account with a password?", signInAction: "Sign in", linkProviderHint: "Sign in and link this provider from your profile.",
    loginNotConfigured: "Authentication is not configured for this application.",
    completingSignIn: "Completing sign-in…", completingProviderSignIn: "Completing {{provider}} sign-in…", providerLoginFailed: "{{provider}} sign-in failed",
    multiProviderHint: "Choose an identity provider to sign in.", noProviderConfigured: "No identity provider is configured on the server",
    otpTitle: "Qiy Admin sign in", otpHint: "Enter the email, phone or model identifier configured for this account to receive a one-time password.",
    otpIdentifier: "Sign-in identifier", otpCode: "One-time password", otpSend: "Send code", otpVerify: "Verify and sign in",
    otpResend: "Send again", otpSendFailed: "Could not send the one-time password",
    oidcTitle: "Qiy Admin sign in", oidcHint: "Sign in with {{provider}} using Authorization Code + PKCE. No client secret is stored in the browser; expired sessions try silent renewal first.",
    oidcSignIn: "Sign in with {{provider}}", oidcRenewing: "Trying silent renewal…",
  },
} as const;
/** Localized filter operator names; project messages can override every entry with qiy.filters.mode.<mode>. */
export const filterModeMessages: Record<QiyLocale, Record<string, string>> = {
  "zh-CN": { eq: "等于", contains: "包含", startsWith: "开头是", endsWith: "结尾是", gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于", between: "介于", in: "属于" },
  "en-US": { eq: "Equals", contains: "Contains", startsWith: "Starts with", endsWith: "Ends with", gt: "Greater than", gte: "Greater than or equal", lt: "Less than", lte: "Less than or equal", between: "Between", in: "In" },
};
export function filterModeLabel(locale: QiyLocale, mode: string): string { return projectMessage(locale, "qiy.filters.mode." + mode) ?? filterModeMessages[locale === "zh-CN" ? "zh-CN" : "en-US"][mode] ?? mode; }
/** Language choice survives reloads; an unknown stored value falls back to the generated default. */
export const localeStorageKey = "qiy.locale";
type LocaleStorage = Pick<Storage, "getItem" | "setItem">;
function localeStorage(): LocaleStorage | undefined { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } }
export function readStoredLocale(fallback: QiyLocale = defaultMessageLocale, storage: Pick<Storage, "getItem"> | undefined = localeStorage()): QiyLocale { try { return resolveLocale(storage?.getItem(localeStorageKey) ?? fallback); } catch { return resolveLocale(fallback); } }
export function storeLocale(locale: QiyLocale, storage: LocaleStorage | undefined = localeStorage()): void { try { storage?.setItem(localeStorageKey, locale); } catch { /* quota or private mode */ } }
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
  "pages.login.rememberMe": "Remember me", "pages.login.forgotPassword": "Forgot password?", "pages.login.noAccount": "Don't have an account?", "pages.login.signup": "Sign up", "pages.login.providers": "Or continue with",
  "pages.error.info": "You may have forgotten to add the {{action}} component to {{resource}} resource.", "pages.error.404": "Sorry, the page you visited does not exist.", "pages.error.resource404": "Are you sure you have created the {{resource}} resource.", "pages.error.backHome": "Back Home",
  "autoSave.success": "saved", "autoSave.error": "auto save failure", "autoSave.loading": "saving...", "autoSave.idle": "waiting for changes",
});
Object.assign(refineMessages["zh-CN"]!, {
  "actions.list": "列表", "actions.create": "新建", "actions.edit": "编辑", "actions.show": "详情", "table.actions": "操作", "dashboard.title": "工作台", "loading": "加载中",
  "buttons.undo": "撤销", "buttons.clone": "复制", "buttons.notAccessTitle": "没有访问权限",
  "notifications.success": "操作成功", "notifications.error": "操作失败（状态码：{{statusCode}}）", "notifications.undoable": "可在 {{seconds}} 秒内撤销",
  "notifications.createSuccess": "成功创建 {{resource}}", "notifications.createError": "创建 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.deleteSuccess": "成功删除 {{resource}}", "notifications.deleteError": "删除 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.editSuccess": "成功修改 {{resource}}", "notifications.editError": "修改 {{resource}} 失败（状态码：{{statusCode}}）", "notifications.importProgress": "导入进度：{{processed}}/{{total}}",
  "pages.login.title": "登录账户", "pages.login.signin": "登录", "pages.login.fields.email": "邮箱", "pages.login.fields.password": "密码", "pages.login.buttons.submit": "登录", "pages.login.errors.requiredEmail": "请输入邮箱", "pages.login.errors.requiredPassword": "请输入密码",
  "pages.login.rememberMe": "记住我", "pages.login.forgotPassword": "忘记密码？", "pages.login.noAccount": "还没有账号？", "pages.login.signup": "注册", "pages.login.providers": "或使用以下方式登录",
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
    "web/app/components/resource-page-guard.tsx": `import { CanAccess, useTranslation } from "@refinedev/core";
import { Result } from "antd";
import { useParams } from "react-router";
import { Outlet } from "react-router";
import { resolveLocale } from "../i18n";

export type ResourcePageAction = "list" | "create" | "show" | "edit";

/**
 * Page level authorization for resource routes. The access-control decision is
 * evaluated for the page action before the page renders, so navigating directly
 * to a URL cannot bypass the menu or button visibility rules.
 */
export function ResourcePageGuard({ action }: { action: ResourcePageAction }) {
  const { resource } = useParams();
  const { getLocale, translate } = useTranslation();
  const locale = resolveLocale(getLocale());
  if (!resource) return <Outlet />;
  return <CanAccess resource={resource} action={action} fallback={<Result status="403" title="403" subTitle={translate("qiy.forbidden", {}, locale === "zh-CN" ? "没有访问该页面的权限" : "You are not allowed to open this page")} />}><Outlet /></CanAccess>;
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
import { useEffect, useMemo, useState } from "react";
import { canSeeField, getResource, type ResourceField } from "../resources";
import { RelationCell } from "../components/relation-field";
import { RelationBatchProvider, buildRelationBatchPlan } from "../components/relation-batch";
import { DateFieldInput } from "../components/date-field";
import { formatFieldValue, isDateFieldType, type DateFieldType } from "../date-fields";
import { fetchServerViews, publishServerView, deleteServerView, type QiyServerView } from "../views-api";
import { useColumnVisibility } from "../hooks/use-column-visibility";
import { qiyIcons } from "../icons";
import { downloadExport, exportUrl, startImport, waitForImport } from "../export";
import { canDeleteView, deleteSavedView, listSavedViews, saveView, serverViewId, serverViewKey, viewMarker, type QiySavedViewKind } from "../views";
import { t, filterModeLabel, resolveLocale, type QiyLocale } from "../i18n";
import { downloadFile } from "../hooks/download-file";
import type { BaseRecord } from "@refinedev/core";

function renderCell(field: ResourceField, value: unknown, notify: ReturnType<typeof useNotification>["open"], translate: ReturnType<typeof useTranslation>["translate"], locale: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.relation) return <RelationCell field={field} value={value} />;
  if (field.type === "File") return <Typography.Link onClick={() => void downloadFile(String(value)).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{String(value)}</Typography.Link>;
  if (field.type === "Files") {
    const keys = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    if (!keys.length) return "—";
    return <Space wrap>{keys.map((key) => <Typography.Link key={key} onClick={() => void downloadFile(key).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{key.split("/").pop()}</Typography.Link>)}</Space>;
  }
  if (isDateFieldType(field.type)) return formatFieldValue(field.type, value, locale);
  const enumValue = field.enumValues?.find((item) => item.name === String(value));
  if (enumValue) { const Icon = enumValue.icon ? qiyIcons[enumValue.icon as keyof typeof qiyIcons] : undefined; const comment = enumValue.commentKey ? translate(enumValue.commentKey, {}, enumValue.comment) : enumValue.comment; return <Tag title={comment} color={enumValue.color} icon={Icon ? <Icon /> : undefined}>{translate(enumValue.labelKey, {}, enumValue.label ?? enumValue.name)}</Tag>; }
  if (field.name.toLowerCase().includes("status") || field.name.toLowerCase() === "role") return <Typography.Text code>{String(value)}</Typography.Text>;
  if (field.type === "Money" || field.type === "Decimal") return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}
/**
 * One row of the "Saved views" dropdown. Browser views are personal, published
 * server views are private to their owner and shared views are visible to everyone.
 * Only deletable rows (own server rows and local rows) render the trash action, and
 * the action stops propagation so deleting never selects the view first.
 */
function SavedViewLabel({ viewKey, name, kind, shared, mine, deleting, onDelete, translate }: { viewKey: string; name: string; kind: QiySavedViewKind; shared: boolean; mine?: boolean; deleting: boolean; onDelete: (key: string) => void; translate: ReturnType<typeof useTranslation>["translate"] }) {
  const marker = viewMarker(kind, shared);
  const markerKey = marker === "local" ? "qiy.viewMine" : marker === "shared" ? "qiy.viewSharedTag" : "qiy.viewPublishedTag";
  const markerFallback = marker === "local" ? "Personal" : marker === "shared" ? "Shared" : "Published";
  const markerColor = marker === "local" ? "default" : marker === "shared" ? "green" : "blue";
  return <Space>
    <span>{name}</span>
    <Tag color={markerColor} style={{ marginInlineEnd: 0 }}>{translate(markerKey, {}, markerFallback)}</Tag>
    {canDeleteView({ kind, mine }) && <span onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <Popconfirm title={translate("qiy.confirmDeleteView", {}, "Delete this view?")} okText={translate("qiy.delete", {}, "Delete")} cancelText={translate("qiy.cancel", {}, "Cancel")} onConfirm={() => onDelete(viewKey)}>
        <Button type="text" size="small" danger loading={deleting} icon={<DeleteOutlined />} aria-label={translate("qiy.deleteView", {}, "Delete view")} />
      </Popconfirm>
    </span>}
  </Space>;
}
export default function ResourceList() {
  const { resource: name } = useParams(); const resource = getResource(name); const { translate, getLocale } = useTranslation(); const { open: notify } = useNotification(); const { data: identity } = useGetIdentity<{ role?: string }>(); const locale: QiyLocale = resolveLocale(getLocale());
  const { tableProps, tableQuery, setFilters, setSorters, filters, sorters } = useTable<Record<string, unknown>>({ resource: name ?? "", pagination: { currentPage: 1, pageSize: 10 }, syncWithLocation: true, queryOptions: { enabled: !!resource } });
  const { mutateAsync: removeMany } = useDeleteMany(); const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savedViews, setSavedViews] = useState(() => listSavedViews(name ?? ""));
  const [activeView, setActiveView] = useState<string | undefined>(undefined);
  const [viewName, setViewName] = useState("");
  const [serverViews, setServerViews] = useState<QiyServerView[]>([]);
  const [deletingView, setDeletingView] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!name) return undefined;
    let active = true;
    void fetchServerViews(name).then((items) => { if (active) setServerViews(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [name]);
  const applySavedView = (id: string | undefined) => { setActiveView(id); const serverId = serverViewId(id); const view = serverId ? serverViews.find((item) => item.id === serverId) : savedViews.find((item) => item.id === id); if (!view) return; setSearch(view.search ?? ""); setFilters((view.filters ?? []) as never); setSorters((view.sorters ?? []) as never); if (view.columns?.length) { const columns = view.columns; setVisibleKeys(() => columns); } };
  const storeSavedView = () => { if (!viewName.trim() || !resource) return; setSavedViews(saveView(resource.name, { name: viewName, search, filters: filters as unknown[], sorters: sorters as unknown[], columns: visibleKeys })); setViewName(""); notify?.({ type: "success", message: translate("qiy.saved", {}, "View saved") }); };
  /**
   * Deletes browser views from localStorage and server views through
   * DELETE /api/v1/saved-views/:id, then refetches so the dropdown matches the server.
   */
  const removeSavedView = async (key: string) => {
    if (!resource) return;
    setDeletingView(key);
    const serverId = serverViewId(key);
    try {
      if (serverId) {
        await deleteServerView({ resource: resource.name, id: serverId });
        setServerViews(await fetchServerViews(resource.name));
      } else {
        setSavedViews(deleteSavedView(resource.name, key));
      }
      if (activeView === key) setActiveView(undefined);
      notify?.({ type: "success", message: translate("qiy.viewDeleted", {}, "View deleted") });
    } catch {
      // Leave the row in place on failure: only the server may confirm a remote delete.
      notify?.({ type: "error", message: translate("qiy.viewDeleteFailed", {}, "Deleting the view failed") });
    } finally {
      setDeletingView(undefined);
    }
  };
  const publishSavedView = async (shared: boolean) => {
    if (!resource || !activeView) return;
    const personal = savedViews.find((item) => item.id === activeView);
    const serverId = serverViewId(activeView);
    const server = serverId ? serverViews.find((item) => item.id === serverId) : undefined;
    const view = personal ?? server;
    if (!view) return;
    try {
      // POST is an upsert keyed by name, so republishing never adds a duplicate row.
      const published = await publishServerView({ resource: resource.name, name: view.name, shared, search: view.search, filters: view.filters as unknown[] | undefined, sorters: view.sorters as unknown[] | undefined, columns: view.columns });
      setServerViews(await fetchServerViews(resource.name));
      // A published local view now lives on the server; drop the browser copy and follow the server row.
      if (!serverId) setSavedViews(deleteSavedView(resource.name, activeView));
      setActiveView(serverViewKey(published.id));
      notify?.({ type: "success", message: shared ? translate("qiy.viewShared", {}, "View shared with everyone") : translate("qiy.viewPublished", {}, "View saved to server") });
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : translate("qiy.publishFailed", {}, "Publishing the view failed") });
    }
  };
  const runExport = () => { if (!resource) return; setExporting(true); void downloadExport(exportUrl(resource.name, { filters, sorters, columns: visibleKeys${options.readOnly ? "" : ", ids: selectedRowKeys.map(String)"} })).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setExporting(false)); };
  const { data: deletePermission } = useCan({ resource: name ?? "", action: "delete", queryOptions: { enabled: !!resource } });
  const [search, setSearch] = useState(""); const enumFields = resource?.fields.filter((field) => field.filterable && field.enumValues?.length) ?? []; const advancedFields = resource?.fields.filter((field) => field.filterable && !field.enumValues?.length && field.filterModes?.length) ?? []; const [enumFilters, setEnumFilters] = useState<Record<string, string | undefined>>({}); const [advancedFilters, setAdvancedFilters] = useState<Record<string, { operator: string; value: string }>>({}); const [advancedJoin, setAdvancedJoin] = useState<"and" | "or">("and");
  const { visibleKeys, setVisibleKeys } = useColumnVisibility(resource);
  const relationBatchFields = useMemo(() => (resource?.fields ?? []).filter((field) => field.relation && field.listVisible && canSeeField(field, identity?.role)), [resource, identity?.role]);
  const relationBatchRows = (tableProps.dataSource ?? []) as Array<Record<string, unknown>>;
  // One batched FK request per target resource instead of one getOne per cell. The
  // plan is memoized so a re-render (e.g. an identity or selection update) cannot
  // retrigger the batch queries.
  const relationBatchPlan = useMemo(() => buildRelationBatchPlan(relationBatchFields, relationBatchRows), [relationBatchFields, relationBatchRows]);
  if (!resource) return <Alert type="error" message={translate("qiy.unknownResource", {}, t(locale, "unknownResource"))} />;
  // Menu/list titles use @plural, create/edit titles use @singular; both fall
  // back to the translated resource label so older dictionaries keep working.
  const singular = translate(resource.singularKey, {}, translate(resource.labelKey, {}, resource.singular));
  const plural = translate(resource.pluralKey, {}, translate(resource.labelKey, {}, resource.label));
  const fields = resource.fields.filter((field) => field.type !== "Vector" && visibleKeys.includes(field.name) && canSeeField(field, identity?.role));
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => {
    const Icon = field.icon ? qiyIcons[field.icon as keyof typeof qiyIcons] : undefined;
    return { title: <Space>{Icon && <Icon />}<span>{translate(field.labelKey, {}, field.label)}</span></Space>, dataIndex: field.name, key: field.name, sorter: field.sortable, render: (value: unknown) => renderCell(field, value, notify, translate, locale) };
  });
  columns.push({ title: t(locale, "actions"), key: "actions", fixed: "right", render: (_value, record) => <Space>
    <ShowButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <EditButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <DeleteButton resource={resource.name} recordItemId={String(record.id)} hideText />
  </Space> });
  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); notify?.({ type: "success", message: t(locale, "deleteSuccess") }); };
  const applyFilters = (nextSearch = search, nextEnums = enumFilters, nextAdvanced = advancedFilters, nextAdvancedJoin = advancedJoin) => { const filters: Array<{ field: string; operator: string; value: string | string[] } | { operator: "and" | "or"; value: Array<{ field: string; operator: string; value: string | string[] }> }> = nextSearch ? [{ field: "__search", operator: "contains", value: nextSearch }] : []; for (const [field, value] of Object.entries(nextEnums)) if (value) filters.push({ field, operator: "eq", value }); const advanced = Object.entries(nextAdvanced).flatMap(([field, condition]) => !condition.value ? [] : [{ field, operator: condition.operator, value: condition.operator === "in" || condition.operator === "between" ? condition.value.split(",").map((item) => item.trim()) : condition.value }]); if (advanced.length === 1) filters.push(advanced[0]!); else if (advanced.length > 1) filters.push({ operator: nextAdvancedJoin, value: advanced }); setFilters(filters as never); };
  return <List resource={resource.name} title={<Typography.Title level={3} style={{ margin: 0 }}>{plural}</Typography.Title>} headerButtons={() => <Space wrap>${options.readOnly ? "" : '<Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(file) => { setImporting(true); void startImport(resource.name, file).then(({ jobId }) => waitForImport(resource.name, jobId, { onProgress: (progress) => notify?.({ type: "progress", message: translate("qiy.importProgress", { processed: progress.processed, total: progress.total }) }) })).then((job) => { if (job.status === "failed") throw new Error(job.errors[0] ?? translate("qiy.importFailed", {}, "Import failed")); notify?.({ type: "success", message: translate("qiy.importedRows", { rows: job.processed }) }); return tableQuery.refetch(); }).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setImporting(false)); return Upload.LIST_IGNORE; }}><Button icon={<UploadOutlined />} loading={importing}>{translate("qiy.import", {}, "Import CSV")}</Button></Upload>'}<Button icon={<DownloadOutlined />} loading={exporting} onClick={runExport}>{${options.readOnly ? 'translate("qiy.export", {}, "Export CSV")' : 'selectedRowKeys.length > 0 ? translate("qiy.exportSelected", {}, "Export selected") + " (" + selectedRowKeys.length + ")" : translate("qiy.export", {}, "Export CSV")'}}</Button><Dropdown menu={{ items: resource.fields.filter((field) => field.type !== "Vector").map((field) => ({ key: field.name, label: <Checkbox checked={visibleKeys.includes(field.name)} onChange={(event) => setVisibleKeys((keys) => event.target.checked ? [...keys, field.name] : keys.filter((key) => key !== field.name))}>{translate(field.labelKey, {}, field.label)}</Checkbox> })) }}><Button icon={<SettingOutlined />}>{t(locale, "visibleColumns")}</Button></Dropdown><Select allowClear style={{ minWidth: 160 }} placeholder={translate("qiy.views", {}, "Saved views")} value={activeView} options={[...savedViews.map((view) => ({ value: view.id, label: <SavedViewLabel viewKey={view.id} name={view.name} kind="local" shared={false} deleting={deletingView === view.id} onDelete={removeSavedView} translate={translate} /> })), ...serverViews.map((view) => { const key = serverViewKey(view.id); return { value: key, label: <SavedViewLabel viewKey={key} name={view.name} kind="server" shared={view.shared} mine={view.mine} deleting={deletingView === key} onDelete={removeSavedView} translate={translate} /> }; })]} onChange={(value) => applySavedView(value)} /><Popover trigger="click" content={<Space direction="vertical"><Input value={viewName} placeholder={translate("qiy.viewName", {}, "View name")} onChange={(event) => setViewName(event.target.value)} onPressEnter={storeSavedView} /><Button type="primary" disabled={!viewName.trim()} onClick={storeSavedView}>{translate("qiy.save", {}, "Save")}</Button></Space>}><Button icon={<SaveOutlined />}>{translate("qiy.saveView", {}, "Save view")}</Button></Popover>{activeView && <Popover trigger="click" content={<Space direction="vertical"><Button onClick={() => void publishSavedView(false)}>{translate("qiy.saveToServer", {}, "Save to server")}</Button><Button onClick={() => void publishSavedView(true)}>{translate("qiy.shareView", {}, "Share with everyone")}</Button></Space>}><Button icon={<UploadOutlined />}>{translate("qiy.publishView", {}, "Publish view")}</Button></Popover>}
    ${Object.keys(treeEntities).length ? `{${JSON.stringify(Object.keys(treeEntities))}.includes(resource.name) && <Link to={"/" + resource.name + "/tree"}><Button>{translate("qiy.treeView", {}, "Tree view")}</Button></Link>}` : ""}<CreateButton resource={resource.name}>{translate("qiy.createResource", { resource: singular }, singular)}</CreateButton></Space>}>
    <div className="qiy-list-filters" role="search" aria-label={t(locale, "filters")}><Input.Search allowClear value={search} placeholder={t(locale, "search")} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => { setSearch(value); applyFilters(value); }} />{enumFields.map((field) => <Select key={field.name} allowClear value={enumFilters[field.name]} placeholder={translate(field.labelKey, {}, field.label)} options={field.enumValues?.map((item) => ({ value: item.name, label: translate(item.labelKey, {}, item.label ?? item.name) }))} onChange={(value) => { const next = { ...enumFilters, [field.name]: value }; setEnumFilters(next); applyFilters(search, next); }} />)}{advancedFields.length > 1 && <Select value={advancedJoin} style={{ minWidth: 116 }} options={[{ value: "and", label: t(locale, "matchAll") }, { value: "or", label: t(locale, "matchAny") }]} onChange={(value: "and" | "or") => { setAdvancedJoin(value); applyFilters(search, enumFilters, advancedFilters, value); }} />}{advancedFields.map((field) => { const condition = advancedFilters[field.name] ?? { operator: field.filterModes[0] ?? "eq", value: "" }; return <Space.Compact key={field.name}><Select value={condition.operator} style={{ width: 120 }} options={field.filterModes.map((mode) => ({ value: mode, label: filterModeLabel(locale, mode) }))} onChange={(operator) => { const next = { ...advancedFilters, [field.name]: { ...condition, operator } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} />{isDateFieldType(field.type) && condition.operator !== "in" && condition.operator !== "between" ? <DateFieldInput type={field.type as DateFieldType} value={condition.value} placeholder={translate(field.labelKey, {}, field.label)} onChange={(next) => { const nextFilters = { ...advancedFilters, [field.name]: { ...condition, value: next ?? "" } }; setAdvancedFilters(nextFilters); applyFilters(search, enumFilters, nextFilters); }} /> : <Input allowClear value={condition.value} placeholder={translate(field.labelKey, {}, field.label) + (condition.operator === "in" || condition.operator === "between" ? t(locale, "commaSeparated") : "")} onChange={(event) => { const next = { ...advancedFilters, [field.name]: { ...condition, value: event.target.value } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} />}</Space.Compact>; })}</div>
    {tableQuery.error && <Alert type="error" showIcon message={String(tableQuery.error)} style={{ marginBottom: 16 }} />}
    {deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}
    <RelationBatchProvider plan={relationBatchPlan}>
    <Table<Record<string, unknown>> {...tableProps} pagination={{ ...tableProps.pagination, showSizeChanger: true, pageSizeOptions: ["10", "20", "50", "100"], showTotal: (total: number, range: [number, number]) => translate("qiy.paginationTotal", { start: range[0], end: range[1], total }), locale: { items_per_page: t(locale, "perPage"), page: t(locale, "page") } }} rowSelection={deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined} rowKey="id" columns={columns} scroll={{ x: "max-content" }} />
    </RelationBatchProvider>
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
    ...(generatedFieldsTest ? { "web/tests/generated-fields.test.ts": `import { expect, test } from "bun:test";
import { createFormFields, editFormFields, generatedFormFields, resources } from "../app/resources";
import { createI18nProvider } from "../app/i18n";
${generatedFieldsTest}` } : {}),
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
    "web/tests/model-i18n.test.ts": `import { expect, test } from "bun:test";
import { createI18nProvider, filterModeLabel, readStoredLocale, resolveLocale, storeLocale, supportedLocales, t } from "../app/i18n";
import { defaultMessageLocale, projectMessages } from "../app/messages";
import { enumerations, menuGroups, resources } from "../app/resources";
import { dashboardMetrics } from "../app/dashboard";
import { chartPanels, charts } from "../app/charts";
${actionDefinitions.length ? 'import { qiyActions } from "../app/actions";\n' : ""}
interface LabelEntry { key: string; fallback: string }
const labels: LabelEntry[] = [
  ...resources.map((resource) => ({ key: resource.labelKey ?? "", fallback: resource.label })),
  ...resources.map((resource) => ({ key: resource.singularKey ?? "", fallback: resource.singular })),
  ...resources.map((resource) => ({ key: resource.pluralKey ?? "", fallback: resource.plural })),
  ...resources.flatMap((resource) => resource.fields.map((field) => ({ key: field.labelKey ?? "", fallback: field.label }))),
  ...resources.flatMap((resource) => (resource.relatedResources ?? []).map((relation) => ({ key: relation.labelKey ?? "", fallback: relation.label }))),
  ...menuGroups.map((group) => ({ key: group.labelKey, fallback: group.label })),
  ...dashboardMetrics.map((metric) => ({ key: metric.labelKey ?? "", fallback: metric.label })),
  ...charts.map((chart) => ({ key: chart.labelKey, fallback: chart.title })),
  ...chartPanels.map((panel) => ({ key: panel.labelKey, fallback: panel.title })),
  ...charts.flatMap((chart) => chart.views.flatMap((view) => [
    { key: view.labelKey, fallback: view.label },
    ...(view.labels?.values ?? []).map((entry) => ({ key: entry.labelKey, fallback: entry.label })),
  ])),
${actionDefinitions.length ? `  ...qiyActions.flatMap((action) => [
    { key: action.labelKey ?? "", fallback: action.label },
    ...(action.target.kind === "dataflow" ? [
      ...(action.target.confirmKey ? [{ key: action.target.confirmKey, fallback: action.target.confirm ?? "" }] : []),
      ...action.target.inputs.map((input) => ({ key: input.labelKey, fallback: input.comment ?? input.name })),
    ] : []),
  ]),
` : ""}];

test("every model-derived label has a stable key and resolves through project messages", () => {
  const providers = Object.fromEntries(supportedLocales.map((locale) => [locale, createI18nProvider(locale)]));
  for (const { key, fallback } of labels) {
    expect(key).toMatch(/^qiy\\.(resources|enums|menu|dashboard|charts|actions)\\./);
    for (const locale of supportedLocales) {
      const expected = projectMessages[locale]?.[key] ?? projectMessages[defaultMessageLocale]?.[key] ?? fallback;
      expect(providers[locale]!.translate(key, {}, fallback)).toBe(expected);
    }
  }
  // The old raw label stays the default when a translation is missing.
  expect(createI18nProvider(defaultMessageLocale).translate("qiy.resources.__missing__.label", {}, "Fallback label")).toBe("Fallback label");
});

test("enum values, menu groups and dashboard metrics carry translation keys", () => {
  for (const enumeration of enumerations) {
    expect(enumeration.labelKey).toBe("qiy.enums." + enumeration.name + ".label");
    for (const value of enumeration.values) expect(value.labelKey).toBe("qiy.enums." + enumeration.name + ".values." + value.name);
  }
  for (const resource of resources) {
    expect(resource.labelKey).toBe("qiy.resources." + resource.name + ".label");
    expect(resource.singularKey).toBe("qiy.resources." + resource.name + ".singular");
    expect(resource.pluralKey).toBe("qiy.resources." + resource.name + ".plural");
    for (const field of resource.fields) expect(field.labelKey).toBe("qiy.resources." + resource.name + ".fields." + field.name + ".label");
  }
  for (const metric of dashboardMetrics) expect(metric.labelKey).toBe("qiy.dashboard." + metric.name + ".label");
  for (const chart of charts) {
    expect(chart.labelKey).toBe("qiy.charts." + chart.name + ".label");
    expect(chart.views.length).toBeGreaterThan(0);
    for (const view of chart.views) {
      expect(view.labelKey).toBe("qiy.charts." + chart.name + ".views." + view.kind + ".label");
      for (const entry of view.labels?.values ?? []) expect(entry.labelKey).toBe("qiy.charts." + chart.name + ".labels." + entry.value);
    }
  }
  for (const panel of chartPanels) expect(panel.labelKey).toBe("qiy.charts." + panel.name + ".label");
  for (const mode of ["eq", "contains", "between"]) expect(filterModeLabel("zh-CN", mode).length).toBeGreaterThan(0);
});

test("locale switching stores the choice and survives a reload", async () => {
  const storage = new Map<string, string>();
  const fake = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
  expect(readStoredLocale(defaultMessageLocale, fake)).toBe(defaultMessageLocale);
  const target = supportedLocales.find((locale) => locale !== defaultMessageLocale) ?? defaultMessageLocale;
  let current = defaultMessageLocale;
  const provider = createI18nProvider(defaultMessageLocale, (next) => { current = next; storeLocale(next, fake); });
  await provider.changeLocale(target);
  expect(current).toBe(target);
  expect(readStoredLocale(defaultMessageLocale, fake)).toBe(target);
  expect(resolveLocale(readStoredLocale(defaultMessageLocale, fake))).toBe(target);
  storeLocale("not-a-declared-locale", fake);
  expect(readStoredLocale(defaultMessageLocale, fake)).toBe(defaultMessageLocale);
  expect(t(defaultMessageLocale, "new").length).toBeGreaterThan(0);
});
${localeSwitchTest}`,
    "web/tests/chrome-i18n.test.ts": `import { expect, test } from "bun:test";
import { createI18nProvider, filterModeLabel } from "../app/i18n";

/**
 * UI chrome (toolbars, theme controls, auth pages, pagination) ships with a
 * built-in zh-CN/en-US dictionary and follows the same language selector as the
 * model labels. This test keeps every key present in both locales so a missing
 * translation shows up as a failing fallback instead of an English literal.
 */
const chromeKeys = [
  "qiy.import", "qiy.export", "qiy.exportSelected", "qiy.visibleColumns", "qiy.views", "qiy.viewName",
  "qiy.save", "qiy.saveView", "qiy.saveToServer", "qiy.shareView", "qiy.publishView", "qiy.saved",
  "qiy.viewShared", "qiy.viewPublished", "qiy.deleteView", "qiy.shared", "qiy.importFailed", "qiy.importedRows",
  "qiy.viewDeleted", "qiy.viewDeleteFailed", "qiy.confirmDeleteView", "qiy.viewMine", "qiy.viewPublishedTag", "qiy.viewSharedTag",
  "qiy.treeView", "qiy.auditTitle", "qiy.auditAction", "qiy.auditAuthor", "qiy.auditSystem", "qiy.auditTime",
  "qiy.new", "qiy.edit", "qiy.delete", "qiy.batchDelete", "qiy.confirmDelete", "qiy.detail",
  "qiy.createResource", "qiy.editResource", "qiy.openDetail", "qiy.searchRelation",
  "qiy.drawerBreadcrumb", "qiy.recordDetails", "qiy.recordSummary", "qiy.close", "qiy.chartView", "qiy.chartViewKind.const", "qiy.chartViewKind.pie", "qiy.chartViewKind.bar", "qiy.chartViewKind.line", "qiy.chartViewKind.table",
  "qiy.docs.title", "qiy.docs.subtitle", "qiy.docs.tabEntities", "qiy.docs.tabDataflows", "qiy.docs.tabPermissions", "qiy.docs.entitiesTitle", "qiy.docs.relationsTitle", "qiy.docs.accessNote", "qiy.docs.apiFiltered", "qiy.docs.mermaidError", "qiy.docs.mermaidTimeout", "qiy.docs.panelError", "qiy.docs.noData", "qiy.docs.fieldName", "qiy.docs.fieldType", "qiy.docs.fieldNullable", "qiy.docs.fieldEnum", "qiy.docs.fieldAnnotations", "qiy.docs.emptySpec", "qiy.docs.principal", "qiy.docs.parameters", "qiy.docs.paramName", "qiy.docs.paramIn", "qiy.docs.paramRequired", "qiy.docs.requestBody", "qiy.docs.responses", "qiy.docs.responseStatus", "qiy.docs.responseDescription", "qiy.docs.security", "qiy.docs.securityBearer", "qiy.docs.securityApiKey", "qiy.docs.curl", "qiy.docs.roles", "qiy.docs.permissions",
  "qiy.apiDocs.title", "qiy.apiDocs.pageTitle", "qiy.apiDocs.pageSubtitle", "qiy.apiDocs.roleTooltip", "qiy.apiDocs.permissionTooltip", "qiy.apiDocs.rolesTooltip", "qiy.apiDocs.permissionsTooltip", "qiy.apiDocs.securityTooltip", "qiy.apiDocs.currentRole", "qiy.apiDocs.currentPermissions", "qiy.apiDocs.searchPlaceholder", "qiy.apiDocs.resultCount", "qiy.apiDocs.noResults", "qiy.apiDocs.loadError",
  "qiy.apiKey.pageTitle", "qiy.apiKey.pageSubtitle", "qiy.apiKey.curlTitle", "qiy.apiKey.apiDocsLink", "qiy.apiKey.searchPlaceholder", "qiy.apiKey.status.all", "qiy.apiKey.status.active", "qiy.apiKey.status.revoked", "qiy.apiKey.status.expired", "qiy.apiKey.limitHint", "qiy.apiKey.never", "qiy.apiKey.revokedMessage", "qiy.apiKey.roleTooltip", "qiy.apiKey.permissionTooltip", "qiy.apiKey.groupTooltip",
  "qiy.apiKey.title", "qiy.apiKey.description", "qiy.apiKey.create", "qiy.apiKey.name", "qiy.apiKey.empty", "qiy.apiKey.prefix", "qiy.apiKey.status", "qiy.apiKey.active", "qiy.apiKey.revoked", "qiy.apiKey.expired", "qiy.apiKey.revoke", "qiy.apiKey.secretTitle", "qiy.apiKey.secretHint", "qiy.apiKey.copy", "qiy.apiKey.copied", "qiy.apiKey.limit",
  "qiy.yes", "qiy.no",
  "qiy.search", "qiy.filters", "qiy.matchAll", "qiy.matchAny", "qiy.commaSeparated", "qiy.forbidden", "qiy.noData",
  "qiy.themeColor", "qiy.themeBlue", "qiy.themePurple", "qiy.themeGreen", "qiy.themeOrange", "qiy.themeRed",
  "qiy.colorMode", "qiy.colorLight", "qiy.colorDark", "qiy.colorSystem",
  "qiy.profileTitle", "qiy.account", "qiy.signOut", "qiy.username", "qiy.email", "qiy.name", "qiy.role",
  "qiy.password", "qiy.passwordSet", "qiy.passwordNotSet", "qiy.linkedMethods", "qiy.noProviders", "qiy.linked",
  "qiy.notLinked", "qiy.bind", "qiy.unbind", "qiy.unlinkKeep", "qiy.unlinkLast",
  "qiy.onboardingInvalid", "qiy.backToSignIn", "qiy.finishAccount", "qiy.confirmAccount", "qiy.fieldRequired",
  "qiy.passwordMin", "qiy.passwordMismatch", "qiy.createAccount", "qiy.alreadyHaveAccount", "qiy.signInAction",
  "qiy.linkProviderHint", "qiy.loginNotConfigured", "qiy.completingSignIn", "qiy.multiProviderHint",
  "qiy.noProviderConfigured", "qiy.otpHint", "qiy.otpIdentifier", "qiy.otpCode", "qiy.otpSend", "qiy.otpVerify",
  "qiy.otpResend", "qiy.oidcHint", "qiy.oidcSignIn", "qiy.oidcRenewing",
  "qiy.createForbidden", "qiy.editForbidden", "qiy.relatedUnknown", "qiy.treeNodesCount", "qiy.treeOrphans",
  "qiy.pickDate", "qiy.pickTime", "qiy.pickDateTime",
] as const;

test("every chrome key resolves in zh-CN and en-US instead of falling back to English", () => {
  const zh = createI18nProvider("zh-CN");
  const en = createI18nProvider("en-US");
  for (const key of chromeKeys) {
    const fallback = "i18n-fallback-" + key;
    expect(zh.translate(key, {}, fallback)).not.toBe(fallback);
    expect(en.translate(key, {}, fallback)).not.toBe(fallback);
    const zhValue = zh.translate(key, {}, fallback);
    const enValue = en.translate(key, {}, fallback);
    expect(typeof zhValue).toBe("string");
    expect(typeof enValue).toBe("string");
  }
  // The chrome really is translated, not just present: a few stable pairs.
  expect(zh.translate("qiy.import")).toBe("导入 CSV");
  expect(en.translate("qiy.import")).toBe("Import CSV");
  expect(zh.translate("qiy.export")).toBe("导出 CSV");
  expect(zh.translate("qiy.visibleColumns")).toBe("显示列");
  expect(zh.translate("qiy.views")).toBe("已存视图");
  expect(zh.translate("qiy.saveView")).toBe("保存视图");
  expect(zh.translate("qiy.viewDeleted")).toBe("视图已删除");
  expect(en.translate("qiy.viewDeleted")).toBe("View deleted");
  expect(zh.translate("qiy.viewDeleteFailed")).toBe("删除视图失败");
  expect(zh.translate("qiy.viewMine")).toBe("个人");
  expect(zh.translate("qiy.viewPublishedTag")).toBe("发布");
  expect(zh.translate("qiy.viewSharedTag")).toBe("共享");
  expect(zh.translate("qiy.search")).toBe("搜索");
  expect(zh.translate("qiy.matchAll")).toBe("全部匹配");
  expect(zh.translate("qiy.themeBlue")).toBe("蓝色");
  expect(zh.translate("qiy.themePurple")).toBe("紫色");
  expect(zh.translate("qiy.themeGreen")).toBe("绿色");
  expect(zh.translate("qiy.themeOrange")).toBe("橙色");
  expect(zh.translate("qiy.themeRed")).toBe("红色");
  expect(zh.translate("qiy.colorLight")).toBe("亮色");
  expect(zh.translate("qiy.colorDark")).toBe("暗色");
  expect(zh.translate("qiy.colorSystem")).toBe("跟随系统");
  expect(en.translate("qiy.colorLight")).toBe("Light");
  expect(zh.translate("qiy.profileTitle")).toBe("个人中心");
  expect(en.translate("qiy.profileTitle")).toBe("Profile");
  // The FK drawer/breadcrumb chrome follows the same dictionary as the rest of the UI.
  expect(zh.translate("qiy.drawerBreadcrumb")).toBe("关联记录路径");
  expect(en.translate("qiy.drawerBreadcrumb")).toBe("Related record path");
  expect(zh.translate("qiy.recordDetails")).toBe("字段详情");
  expect(en.translate("qiy.recordDetails")).toBe("Field details");
  expect(zh.translate("qiy.recordSummary")).toBe("关联摘要");
  expect(zh.translate("qiy.close")).toBe("关闭");
  expect(en.translate("qiy.close")).toBe("Close");
  // Chart dashboard chrome (panel/view selectors + view-kind labels).
  expect(zh.translate("qiy.chartView")).toBe("视图");
  expect(en.translate("qiy.chartView")).toBe("View");
  expect(zh.translate("qiy.chartViewKind.pie")).toBe("饼图");
  expect(en.translate("qiy.chartViewKind.table")).toBe("Table");
  // System overview + API-key chrome.
  expect(zh.translate("qiy.docs.title")).toBe("功能总览");
  expect(en.translate("qiy.docs.title")).toBe("Feature overview");
  expect(zh.translate("qiy.docs.tabApiKeys")).toBe("访问密钥");
  expect(en.translate("qiy.docs.tabEntities")).toBe("Entities");
  expect(zh.translate("qiy.apiKey.title")).toBe("访问密钥");
  expect(en.translate("qiy.apiKey.title")).toBe("API keys");
  expect(zh.translate("qiy.yes")).toBe("是");
  expect(en.translate("qiy.no")).toBe("No");
  expect(zh.translate("qiy.signOut")).toBe("退出登录");
  expect(zh.translate("qiy.bind")).toBe("关联");
  expect(zh.translate("qiy.unbind")).toBe("解除关联");
  expect(zh.translate("qiy.createAccount")).toBe("创建账号并登录");
  // Interpolated chrome (pagination/saved-view/link copy) keeps its parameters.
  expect(zh.translate("qiy.paginationTotal", { start: 1, end: 10, total: 42 })).toBe("第 1-10 条，共 42 条");
  expect(en.translate("qiy.paginationTotal", { start: 1, end: 10, total: 42 })).toBe("1-10 of 42");
  expect(zh.translate("qiy.importedRows", { rows: 3 })).toBe("已导入 3 行");
  expect(zh.translate("qiy.unlinkTitle", { provider: "Okta" })).toBe("解除关联 Okta？");
  expect(zh.translate("filterModeLabelPlaceholder", {}, "fallback")).toBe("fallback");
});

test("filter operators and unknown keys still fall back safely", () => {
  expect(filterModeLabel("zh-CN", "contains")).toBe("包含");
  expect(filterModeLabel("en-US", "between")).toBe("Between");
  expect(createI18nProvider("en-US").translate("qiy.notARealChromeKey", {}, "Fallback")).toBe("Fallback");
});
`,
    "web/tests/date-fields.test.ts": `import { describe, expect, test } from "bun:test";
import dayjs from "dayjs";
import { formatFieldValue, isDateFieldType, toFormValue, toPayloadValue } from "../app/date-fields";

describe("Date/Time/DateTime form contracts", () => {
  test("converts stored contract strings into picker values", () => {
    expect(toFormValue("Date", "2026-11-30")?.format("YYYY-MM-DD")).toBe("2026-11-30");
    expect(toFormValue("Time", "14:30:05")?.format("HH:mm:ss")).toBe("14:30:05");
    expect(toFormValue("Time", "14:30")?.format("HH:mm:ss")).toBe("14:30:00");
    expect(toFormValue("DateTime", "2026-11-30T08:30:00.000Z")?.toISOString()).toBe("2026-11-30T08:30:00.000Z");
    expect(toFormValue("Date", null)).toBeNull();
  });

  test("converts picker values back to the API contract", () => {
    expect(toPayloadValue("Date", dayjs("2026-11-30"))).toBe("2026-11-30");
    expect(toPayloadValue("Time", dayjs("1970-01-01T14:30:05"))).toBe("14:30:05");
    expect(toPayloadValue("DateTime", dayjs("2026-11-30T08:30:00.000Z"))).toBe("2026-11-30T08:30:00.000Z");
    expect(toPayloadValue("Date", null)).toBeNull();
    expect(toPayloadValue("Time", undefined)).toBeNull();
    // Values already in the contract (form.setFieldsValue) pass through unchanged.
    expect(toPayloadValue("Date", "2026-11-30")).toBe("2026-11-30");
  });

  test("invalid stored input never becomes an invalid picker value", () => {
    expect(toFormValue("Date", "not-a-date")).toBeNull();
    expect(toFormValue("Date", "2026-13-01")).toBeNull();
    expect(toFormValue("Time", "25:00:00")).toBeNull();
    expect(toFormValue("Time", "08:30:00Z")).toBeNull();
    expect(toFormValue("DateTime", "tomorrow")).toBeNull();
  });

  test("formats display text with Intl and falls back to the raw string", () => {
    expect(formatFieldValue("Date", "2026-11-30", "en-US")).toContain("2026");
    expect(formatFieldValue("Date", "2026-11-30", "zh-CN")).toContain("2026");
    expect(formatFieldValue("Time", "08:30:00", "zh-CN")).toBe("08:30:00");
    expect(formatFieldValue("Time", "08:30:00", "en-US")).toMatch(/8:30:00/);
    expect(formatFieldValue("DateTime", "2026-11-30T08:30:00.000Z", "en-US")).toContain("2026");
    expect(formatFieldValue("Date", "not-a-date", "en-US")).toBe("not-a-date");
    expect(formatFieldValue("Date", "2026-13-01", "en-US")).toBe("2026-13-01");
    expect(formatFieldValue("Text", "plain")).toBe("plain");
    expect(formatFieldValue("Date", null)).toBe("");
    expect(isDateFieldType("DateTime")).toBe(true);
    expect(isDateFieldType("Text")).toBe(false);
  });
});
`,
    "web/tests/display-template.test.ts": `import { describe, expect, test } from "bun:test";
import { escapeHtml, plainTextTemplate, recordDisplayText, relationDetailHtml, renderTemplate } from "../app/display-template";
import type { ResourceDefinition, ResourceField } from "../app/resources";

const fields = [
  { name: "code", type: "Text", label: "Code", labelKey: "code", nullable: false, primaryKey: false, visible: true, listVisible: true, formVisible: true, showVisible: true, sortable: true, filterable: true, filterModes: ["eq"] },
  { name: "status", type: "Text", label: "Status", labelKey: "status", nullable: false, primaryKey: false, visible: true, listVisible: true, formVisible: true, showVisible: true, sortable: true, filterable: true, filterModes: ["eq"], enumValues: [{ name: "active", label: "Active", labelKey: "qiy.enums.state.values.active" }] },
] as unknown as ResourceField[];

const translate = (key: string, _options?: Record<string, unknown>, fallback?: string) => key === "qiy.enums.state.values.active" ? "启用" : fallback ?? key;

describe("display templates", () => {
  test("escapes every interpolated value and literal text", () => {
    expect(renderTemplate("<b>{$.name}</b>", { name: "<img src=x onerror=alert(1)>" })).toBe("<b>&lt;img src=x onerror=alert(1)&gt;</b>");
    expect(renderTemplate("{$.value}", { value: "a&b \\"quoted\\" 'single'" })).toBe("a&amp;b &quot;quoted&quot; &#39;single&#39;");
    expect(renderTemplate("1 < 2", {})).toBe("1 &lt; 2");
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("only whitelisted tags survive at render time", () => {
    expect(renderTemplate("<script>{$.id}</script>", { id: "x" })).toBe("x");
    expect(renderTemplate("<img src=x>{$.id}", { id: "x" })).toBe("&lt;img src=x&gt;x");
    expect(renderTemplate("<b>{$.id}</b>", { id: "x" })).toBe("<b>x</b>");
    expect(renderTemplate("{$.a}</br>{$.b}<br/><br>", { a: "1", b: "2" })).toBe("1<br>2<br><br>");
  });

  test("missing placeholders collapse and options.empty is honored", () => {
    expect(renderTemplate("{$.missing}{$.name}", { name: "Ada" })).toBe("Ada");
    expect(renderTemplate("{$.missing}", {}, { empty: "—" })).toBe("—");
    expect(renderTemplate(undefined, {})).toBe("");
  });

  test("plain text strips tags for select options and cell text", () => {
    expect(plainTextTemplate("<b>{$.code}</b></br>{$.status}", { code: "C-1", status: "active" }, { fields, translate })).toBe("C-1 启用");
    expect(plainTextTemplate("{$.code} · {$.status}", { code: "C-1", status: "active" }, { fields, translate })).toBe("C-1 · 启用");
    expect(plainTextTemplate("<div>a</div><div>b</div>", {})).toBe("a b");
  });

  test("record display falls back from template to label field to id", () => {
    const resource = { displayTemplate: "{$.code} · {$.status}", fields } as unknown as ResourceDefinition;
    expect(recordDisplayText(resource, { id: "uuid-1", code: "C-1", status: "active" }, { fields, translate })).toBe("C-1 · 启用");
    const tableResource = { ...resource, tableDisplayTemplate: "TABLE {$.code}" } as unknown as ResourceDefinition;
    expect(recordDisplayText(tableResource, { id: "uuid-1", code: "C-1" }, { fields, translate })).toBe("TABLE C-1");
    const plain = { fields } as unknown as ResourceDefinition;
    expect(recordDisplayText(plain, { id: "uuid-1", code: "C-1" })).toBe("C-1");
    expect(recordDisplayText(plain, { id: "uuid-1" })).toBe("uuid-1");
    expect(recordDisplayText(undefined, { id: "uuid-1" })).toBe("uuid-1");
  });

  test("relation detail is rendered HTML with escaped values", () => {
    const resource = { relationDetailTemplate: "<b>{$.name}</b></br>{$.note}", fields } as unknown as ResourceDefinition;
    expect(relationDetailHtml(resource, { name: "Ada", note: "<b>not markup</b>" })).toBe("<b>Ada</b><br>&lt;b&gt;not markup&lt;/b&gt;");
    expect(relationDetailHtml(resource, {})).toBe("<b></b><br>");
    expect(relationDetailHtml(undefined, { name: "Ada" })).toBe("");
  });

  test("Date/Time placeholders use the same localized formatter as list and detail cells", () => {
    const temporalFields = [
      { name: "dueDate", type: "Date", label: "Due", labelKey: "due", nullable: false, primaryKey: false, visible: true, listVisible: true, formVisible: true, showVisible: true, sortable: true, filterable: true, filterModes: ["eq"] },
      { name: "shiftStart", type: "Time", label: "Shift", labelKey: "shift", nullable: false, primaryKey: false, visible: true, listVisible: true, formVisible: true, showVisible: true, sortable: true, filterable: true, filterModes: ["eq"] },
    ] as unknown as ResourceField[];
    expect(plainTextTemplate("{$.dueDate}", { dueDate: "2026-11-30" }, { fields: temporalFields, locale: "en-US" })).toContain("2026");
    expect(plainTextTemplate("{$.shiftStart}", { shiftStart: "08:30:00" }, { fields: temporalFields, locale: "zh-CN" })).toBe("08:30:00");
    // Unparsable values fall back to the raw stored string instead of disappearing.
    expect(plainTextTemplate("{$.dueDate}", { dueDate: "not-a-date" }, { fields: temporalFields, locale: "en-US" })).toBe("not-a-date");
  });
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
    "web/tests/data-provider.test.ts": `import { describe, expect, test } from "bun:test";\nimport { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";\nconst requests: Array<{ url: string; method: string; body?: string }> = [];\nconst fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); const method = init?.method ?? "GET"; requests.push({ url, method, body: init?.body?.toString() }); const body = method === "GET" && url.includes("?") ? { data: [{ id: "one" }], total: 1 } : method === "DELETE" && url.includes("ids=") ? [{ id: "one" }] : { id: "one" }; return new Response(JSON.stringify(body), { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } }); }) as typeof fetch;\ndescribe("same-origin Refine provider", () => { test("maps list and mutations", async () => { requests.length = 0; const provider = createDataProvider(fetcher); await provider.getList({ resource: "products", pagination: { currentPage: 2, pageSize: 5 } }); await provider.getOne({ resource: "products", id: "one" }); await provider.create({ resource: "products", variables: { title: "New" } }); await provider.update({ resource: "products", id: "one", variables: { title: "Updated" } }); await provider.deleteOne({ resource: "products", id: "one" }); await provider.deleteMany?.({ resource: "products", ids: ["one", "two"] }); expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "POST", "PATCH", "DELETE", "DELETE"]); }); test("encodes table query state", async () => { requests.length = 0; const provider = createDataProvider(fetcher); await provider.getList({ resource: "products", pagination: { currentPage: 3, pageSize: 10 }, sorters: [{ field: "name", order: "desc" }], filters: [{ field: "__search", operator: "contains", value: "phone" }, { field: "status", operator: "eq", value: "approved" }] }); const url = new URL(requests[0]!.url, "http://localhost"); expect(url.searchParams.get("page")).toBe("3"); expect(url.searchParams.get("pageSize")).toBe("10"); expect(url.searchParams.get("sort")).toBe("name"); expect(url.searchParams.get("order")).toBe("desc"); expect(url.searchParams.get("search")).toBe("phone"); expect(JSON.parse(url.searchParams.get("filters") ?? "{}")).toEqual([{ field: "status", operator: "eq", value: "approved" }]); }); test("maps GraphQL list variables", async () => { requests.length = 0; const provider = createGraphQLDataProvider(async (input, init) => { requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body?.toString() }); return new Response(JSON.stringify({ data: { products: { items: [{ id: "one" }], total: 1 } } }), { status: 200, headers: { "Content-Type": "application/json" } }); }); const result = await provider.getList({ resource: "products", pagination: { currentPage: 2, pageSize: 5 }, sorters: [{ field: "name", order: "desc" }] }); expect(result.total).toBe(1); const payload = JSON.parse(requests[0]!.body ?? "{}"); expect(payload.variables).toEqual({ page: 2, pageSize: 5, search: undefined, sort: "name", order: "desc", filters: [] }); }); test("batches getMany ids into one list request", async () => { requests.length = 0; const provider = createDataProvider(async (input) => { requests.push({ url: String(input), method: "GET" }); return Response.json({ data: [{ id: "a" }, { id: "b" }], total: 2 }); }); const result = await provider.getMany?.({ resource: "products", ids: ["a", "b", "a", ""] }); expect(result?.data).toEqual([{ id: "a" }, { id: "b" }]); expect(requests).toHaveLength(1); const url = new URL(requests[0]!.url, "http://localhost"); expect(url.searchParams.get("page")).toBe("1"); expect(url.searchParams.get("pageSize")).toBe("2"); expect(JSON.parse(url.searchParams.get("filters") ?? "[]")).toEqual([{ field: "id", operator: "in", value: "a,b" }]); }); test("coalesces identical getMany id sets into one network request", async () => { requests.length = 0; let calls = 0; const provider = createDataProvider(async (input) => { calls += 1; requests.push({ url: String(input), method: "GET" }); return Response.json({ data: [{ id: "a" }], total: 1 }); }); const [first, second] = await Promise.all([provider.getMany?.({ resource: "warehouses", ids: ["7"] }), provider.getMany?.({ resource: "warehouses", ids: ["7"] })]); expect(first?.data).toEqual([{ id: "a" }]); expect(second?.data).toEqual([{ id: "a" }]); await provider.getMany?.({ resource: "warehouses", ids: ["7"] }); expect(calls).toBe(1); await provider.getMany?.({ resource: "warehouses", ids: ["8"] }); expect(calls).toBe(2); }); test("getMany skips empty ids, caps and chunks large batches", async () => { requests.length = 0; const provider = createDataProvider(async (input) => { requests.push({ url: String(input), method: "GET" }); return Response.json({ data: [{ id: "x" }], total: 1 }); }); expect(await provider.getMany?.({ resource: "products", ids: [] })).toEqual({ data: [] }); expect(requests).toHaveLength(0); const manyIds = Array.from({ length: 250 }, (_, index) => "id-" + index); const batched = await provider.getMany?.({ resource: "products", ids: manyIds }); expect(batched?.data).toEqual([{ id: "x" }, { id: "x" }]); const pages = requests.map((request) => new URL(request.url, "http://localhost")); expect(pages.map((url) => url.searchParams.get("pageSize"))).toEqual(["100", "100"]); expect(pages.every((url) => JSON.parse(url.searchParams.get("filters") ?? "[]")[0].operator === "in")).toBe(true); await expect(provider.getMany?.({ resource: "../secrets", ids: ["x"] })).rejects.toThrow("Unknown resource"); }); test("GraphQL getMany batches ids into one list query", async () => { requests.length = 0; const provider = createGraphQLDataProvider(async (input, init) => { requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body?.toString() }); return new Response(JSON.stringify({ data: { ${JSON.stringify(database.entities[0]!.name)}: { items: [{ id: "a" }, { id: "b" }], total: 2 } } }), { status: 200, headers: { "Content-Type": "application/json" } }); }); const result = await provider.getMany?.({ resource: "products", ids: ["a", "b"] }); expect(result?.data).toEqual([{ id: "a" }, { id: "b" }]); const payload = JSON.parse(requests[0]!.body ?? "{}"); expect(payload.variables).toEqual({ page: 1, pageSize: 2, filters: [{ field: "id", operator: "in", value: "a,b" }] }); }); test("rejects unknown resources", () => { const provider = createDataProvider(fetcher); expect(() => provider.getList({ resource: "../secrets" })).toThrow("Unknown resource"); }); });\n`.replaceAll('"products"', JSON.stringify(database.entities[0]!.tableName)).replace("data: { products:", `data: { ${database.entities[0]!.name}:`),
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
    // Read-only host integrations keep local saved views but must not offer delete.
    list = list.replace(/\n\s*\{canDeleteView\(\{ kind, mine \}\) && <span[\s\S]*?<\/span>\}/, "");
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
      ['<CreateButton resource={resource.name}>{translate("qiy.createResource", { resource: singular }, singular)}</CreateButton>', ""],
      ['    {deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}\n', ""],
      [' rowSelection={deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined}', ""],
    ] as const) list = list.replace(from, to);
    if (/useDelete|useDeleteMany|deletePermission|CreateButton|EditButton|DeleteButton|selectedRowKeys|Popconfirm|DeleteOutlined|routes\/(create|edit)/.test(list)) {
      throw new Error("Could not safely apply read-only integration UI policy");
    }
    generated["web/app/routes/list.tsx"] = list;
    generated["web/app/routes/show.tsx"] = generated["web/app/routes/show.tsx"]!
      // Read-only integrations never offer an edit form; the show page drops the
      // edit button but keeps the shared `RecordDetails` body.
      .replace('<CanAccess resource={resource.name} action="edit"><EditButton resource={resource.name} recordItemId={id}>{t(locale, "edit")}</EditButton></CanAccess>', "");
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
    // Templates already resolve every locale through resolveLocale; keeps older
    // inlined template snapshots working when they still hardcode en-US/zh-CN.
    generated[path] = generated[path]!.replaceAll('getLocale() === "en-US" ? "en-US" : "zh-CN"', 'resolveLocale(getLocale())');
    if (generated[path]!.includes("resolveLocale(getLocale())")) generated[path] = generated[path]!.replace('import { t, type QiyLocale }', 'import { t, resolveLocale, type QiyLocale }');
  }
  if (options.auth) {
    const userTable = database.entities.find((entity) => entity.name === options.auth!.userEntity)!.tableName;
    generated["web/app/auth.ts"] = generated["web/app/auth.ts"]!
      .replace('resource === "users"', `resource === ${JSON.stringify(userTable)}`)
      .replace('if (identity.role === "admin")', 'if (action === "audit") return { can: identity.role === "admin" }; if (identity.role === "admin")');
    generated["web/tests/auth.test.ts"] = generated["web/tests/auth.test.ts"]!.replaceAll('resource: "users"', `resource: ${JSON.stringify(userTable)}`).replaceAll('resource === "users"', `resource === ${JSON.stringify(userTable)}`);
    generated["web/tests/auth.test.ts"] += `
test("fetches the identity once per access token, even for concurrent guards", async () => {
  tokens.set("qiy.access_token", "identity-cache-token");
  let calls = 0;
  const originalFetchImpl = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/auth/me")) calls += 1;
    return originalFetchImpl(input, init);
  }) as typeof fetch;
  try {
    await Promise.all([
      qiyAuthProvider.getIdentity?.({}),
      qiyAuthProvider.getIdentity?.({}),
      qiyAccessControlProvider.can({ resource: ${JSON.stringify(userTable)}, action: "list" }),
      qiyAccessControlProvider.can({ resource: ${JSON.stringify(userTable)}, action: "create" }),
    ]);
    expect(calls).toBe(1);
    await qiyAuthProvider.getIdentity?.({});
    expect(calls).toBe(1);
    tokens.set("qiy.access_token", "identity-cache-token-2");
    await qiyAuthProvider.getIdentity?.({});
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetchImpl;
    tokens.clear();
  }
});
`;
    generated["web/app/root.tsx"] = 'import { auditLogProvider } from "./providers/audit-log-provider";\n' + generated["web/app/root.tsx"]!.replace("authProvider={qiyAuthProvider}", "auditLogProvider={auditLogProvider} authProvider={qiyAuthProvider}").replace("meta: { label: modelLabel(resource.pluralKey", "meta: { audit: [], label: modelLabel(resource.pluralKey");
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
  return <Card title={translate("qiy.auditTitle", {}, "Audit history")} style={{ marginTop: 16 }}>{query.error ? <Alert type="error" message={query.error.message} /> : <Table<AuditEntry> rowKey="id" loading={query.isLoading} dataSource={query.data?.data ?? []} pagination={{ current: page, pageSize: 10, total: query.data?.total ?? 0, showSizeChanger: false, onChange: setPage }} columns={[{ title: translate("qiy.auditAction", {}, "Action"), dataIndex: "action" }, { title: translate("qiy.auditAuthor", {}, "Author"), render: (_, row) => row.author?.name ?? translate("qiy.auditSystem", {}, "System") }, { title: translate("qiy.auditTime", {}, "Time"), dataIndex: "createdAt" }]} />}</Card>;
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
  if (multiProviderAuth) {
    generated["web/app/auth/oidc-multi.ts"] = renderMultiProviderWebClient();
    generated["web/app/routes/oauth-callback.tsx"] = 'export { default } from "./auth-callback";';
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace(
      '  route("auth/login", "./routes/login.tsx"),',
      '  route("auth/login", "./routes/login.tsx"),\n  route("auth/callback", "./routes/auth-callback.tsx"),\n  route("oauth/*", "./routes/oauth-callback.tsx"),',
    );
    generated["web/app/routes/login.tsx"] = `import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "@refinedev/core";
import { beginProviderLogin, fetchAuthProviders, type QiyAuthProviderPublic } from "../auth/oidc-multi";

export default function Login() {
  const { translate } = useTranslation();
  const [providers, setProviders] = useState<QiyAuthProviderPublic[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; void fetchAuthProviders().then((list) => { if (active) { setProviders(list); setLoading(false); } }).catch((caught: unknown) => { if (active) { setError(caught instanceof Error ? caught.message : String(caught)); setLoading(false); } }); return () => { active = false; }; }, []);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}>
    <Card style={{ width: 420 }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Qiy Admin</Typography.Title>
        <Typography.Text type="secondary">{translate("qiy.multiProviderHint", {}, "Choose an identity provider to sign in.")}</Typography.Text>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {loading ? <Spin /> : null}
        <Space direction="vertical" style={{ width: "100%" }}>
          {providers.map((provider) => <Button key={provider.id} block size="large" onClick={() => void beginProviderLogin(provider)}>{provider.label}</Button>)}
        </Space>
        {!loading && providers.length === 0 && !error ? <Alert type="warning" showIcon message={translate("qiy.noProviderConfigured", {}, "No identity provider is configured on the server")} /> : null}
      </Space>
    </Card>
  </main>;
}
`;
    generated["web/app/routes/auth-callback.tsx"] = `import { Alert, Card, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { completeProviderLogin } from "../auth/oidc-multi";

export default function AuthCallback() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (started.current) return; started.current = true; void completeProviderLogin(new URL(window.location.href)).then((target) => navigate(target || "/", { replace: true })).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught))); }, [navigate]);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card>{error ? <Alert type="error" showIcon message={error} /> : <Spin />}</Card></main>;
}
`;
  }
  if (hybridAuth) {
    generated["web/app/auth/oidc-multi.ts"] = renderHybridWebClient();
    generated["web/app/auth/account.ts"] = renderAccountWebClient();
    generated["web/app/routes/oauth-callback.tsx"] = 'export { default } from "./auth-callback";';
    generated["web/app/routes/auth-callback.tsx"] = `import { Alert, Card, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "@refinedev/core";
import { completeProviderCallback } from "../auth/oidc-multi";

/** Finishes a provider sign-in: onboarding, linked provider or a normal session. */
export default function AuthCallback() {
  const navigate = useNavigate();
  const { translate } = useTranslation();
  const started = useRef(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // No "active" cleanup guard here: React StrictMode runs the cleanup between
    // the double-invoked effects, and the second pass is skipped by the ref, so an
    // active flag would silently swallow the navigation and leave the spinner up.
    void completeProviderCallback(new URL(window.location.href))
      .then((target) => navigate(target, { replace: true }))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [navigate]);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card style={{ width: 420 }}>{error ? <Alert type="error" showIcon message={error} /> : <><Spin /><Typography.Paragraph style={{ marginTop: 16 }}>{translate("qiy.completingSignIn", {}, "Completing sign-in…")}</Typography.Paragraph></>}</Card></main>;
}
`;
    generated["web/app/routes/auth-onboarding.tsx"] = renderOnboardingRoute({
      usernameLabel: onboardingUsernameLabel,
      hasEmailField: Boolean(onboardingEmailField),
    });
    generated["web/app/routes/profile.tsx"] = renderProfileRoute({ hasProviderBinding: true, ...(authRoleEnumName && { roleEnumName: authRoleEnumName }) });
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace(
      '  route("auth/login", "./routes/login.tsx"),',
      '  route("auth/login", "./routes/login.tsx"),\n  route("auth/callback", "./routes/auth-callback.tsx"),\n  route("oauth/*", "./routes/oauth-callback.tsx"),\n  route("auth/onboarding", "./routes/auth-onboarding.tsx"),\n  route("profile", "./routes/profile.tsx"),',
    );
  } else if (hasLocalAuth) {
    generated["web/app/auth/account.ts"] = renderAccountWebClient();
    generated["web/app/routes/profile.tsx"] = renderProfileRoute({ hasProviderBinding: false, ...(authRoleEnumName && { roleEnumName: authRoleEnumName }) });
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace(
      '  index("./routes/home.tsx"),',
      '  index("./routes/home.tsx"),\n  route("profile", "./routes/profile.tsx"),',
    );
  }
  if (hasLocalAuth) {
    // The profile page is reachable from the app header for every password-based
    // account, including local-only projects without OAuth providers.
    generated["web/app/root.tsx"] = generated["web/app/root.tsx"]!
      .replace('import { Select, Space, Typography, theme } from "antd";', 'import { Button, Select, Space, Typography, theme } from "antd";')
      .replace('import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";', 'import { Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";')
      .replace("    <QiyThemeControls />", '    <Link to="/profile"><Button type="link">{translate("qiy.profile", {}, "Profile")}</Button></Link>\n    <QiyThemeControls />');
  }

  // System administration: 功能总览 / API 文档 / 访问密钥 pages, gated by features.
  const features = options.features ?? { overview: true, apiDocs: false, apiKeys: false };
  const apiDocsFeature = Boolean(features.apiDocs);
  const apiKeysFeature = Boolean(features.apiKeys);
  const overviewFlag = features.overview !== false;
  const overviewPageEnabled = overviewFlag && (apiDocsFeature || apiKeysFeature);
  const docsHelpersEnabled = overviewPageEnabled || apiDocsFeature;
  generated["web/app/features.ts"] = renderWebFeaturesModule(overviewPageEnabled, apiDocsFeature, apiKeysFeature);
  if (overviewPageEnabled || apiDocsFeature || apiKeysFeature) generated["web/tests/features.test.ts"] = renderWebFeaturesTest(overviewPageEnabled, apiDocsFeature, apiKeysFeature);
  const routeLines: string[] = [];
  const webPackage = JSON.parse(generated["web/package.json"]!) as { dependencies: Record<string, string> };
  if (docsHelpersEnabled) generated["web/app/docs.ts"] = renderWebDocsModule();
  if (apiKeysFeature) generated["web/app/api-keys.ts"] = renderWebApiKeysModule();
  if (overviewPageEnabled) {
    generated["web/app/components/mermaid.tsx"] = renderWebMermaidComponent();
    generated["web/app/components/docs-page.tsx"] = renderWebDocsPageComponent();
    generated["web/app/routes/docs.tsx"] = renderWebDocsRoute();
    generated["web/tests/docs.test.ts"] = renderWebOverviewTest();
    generated["web/tests/docs-render.test.tsx"] = renderWebOverviewRenderTest();
    routeLines.push('  route("system/overview", "./routes/docs.tsx"),');
    // Mermaid is only used by the overview page's entity/dataflow diagrams.
    webPackage.dependencies.mermaid = "12.2.0";
    generated["web/package.json"] = `${JSON.stringify(webPackage, null, 2)}\n`;
  }
  if (apiDocsFeature) {
    generated["web/app/components/api-docs-page.tsx"] = renderWebApiDocsPageComponent();
    generated["web/app/routes/api-docs.tsx"] = renderWebApiDocsRoute();
    generated["web/tests/api-docs.test.ts"] = renderWebApiDocsTest();
    generated["web/tests/api-docs-render.test.tsx"] = renderWebApiDocsRenderTest();
    routeLines.push('  route("system/api-docs", "./routes/api-docs.tsx"),');
  }
  if (apiKeysFeature) {
    generated["web/app/components/api-keys-page.tsx"] = renderWebApiKeysPageComponent();
    generated["web/app/routes/api-keys.tsx"] = renderWebApiKeysRoute();
    generated["web/tests/api-keys.test.ts"] = renderWebApiKeysTest();
    generated["web/tests/api-keys-render.test.tsx"] = renderWebApiKeysRenderTest(apiDocsFeature);
    routeLines.push('  route("system/api-keys", "./routes/api-keys.tsx"),');
  }
  if (routeLines.length > 0) {
    generated["web/app/routes.ts"] = generated["web/app/routes.ts"]!.replace(
      '  index("./routes/home.tsx"),',
      '  index("./routes/home.tsx"),\n' + routeLines.join("\n"),
    );
  }


  return generated;
}

/**
 * Hybrid browser client: the login page and callback for a project that offers
 * password login plus OAuth providers. Unlike the multi-provider-only client it
 * never stores a provider token: the generated server exchanges the code and
 * returns either a Qiy session token, a signed onboarding token (first login), or
 * a linked-provider confirmation. Only the Qiy session token is kept in
 * localStorage, so the API never has to accept opaque provider tokens.
 */
function renderHybridWebClient(): string {
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
function renderAccountWebClient(): string {
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
`;
}

function renderOnboardingRoute(options: { usernameLabel: string; hasEmailField: boolean }): string {
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
function renderProfileRoute(options: { hasProviderBinding: boolean; roleEnumName?: string }): string {
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
${bindImport}import { fetchIdentities, unbindProvider, type QiyIdentities, type QiyIdentityProvider } from "../auth/account";

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
    <Card title={translate("qiy.account", {}, "Account")} extra={<Button onClick={() => logout()}>{translate("qiy.signOut", {}, "Sign out")}</Button>}>
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

/** ------------------------------------------------------------------------- */
/** Web modules for the system overview page (docs + API keys).               */
/** ------------------------------------------------------------------------- */

function renderWebFeaturesModule(overviewPage: boolean, apiDocs: boolean, apiKeys: boolean): string {
  return `/** Generated feature flags and extra sidebar page links. Do not edit by hand. */
export const qiyFeatureFlags = { overview: ${overviewPage ? "true" : "false"}, apiDocs: ${apiDocs ? "true" : "false"}, apiKeys: ${apiKeys ? "true" : "false"} } as const;
export const docsEnabled = qiyFeatureFlags.apiDocs || qiyFeatureFlags.apiKeys;
export const overviewEnabled = qiyFeatureFlags.overview;

export interface QiyMenuLink {
  name: string;
  path: string;
  label: string;
  labelKey: string;
  icon?: string;
  group?: string;
}

/** Developer pages under 系统管理; each entry is only present when its feature is enabled. */
export const qiyMenuLinks: QiyMenuLink[] = [
${overviewPage ? `  { name: "qiy-docs", path: "/system/overview", label: "功能总览", labelKey: "qiy.docs.title", icon: "AppstoreOutlined", group: "system" },` : ""}
${apiDocs ? `  { name: "qiy-api-docs", path: "/system/api-docs", label: "API 文档", labelKey: "qiy.apiDocs.title", icon: "FileTextOutlined", group: "system" },` : ""}
${apiKeys ? `  { name: "qiy-api-keys", path: "/system/api-keys", label: "访问密钥", labelKey: "qiy.apiKey.title", icon: "KeyOutlined", group: "system" },` : ""}
];
`;
}

function renderWebDocsModule(): string {
  return `/** Generated documentation helpers: Mermaid builders, tab gating and API fetchers. */
import { qiyAuthToken } from "./auth";
import { qiyFeatureFlags } from "./features";

export type DocsRole = "admin" | "operator" | "viewer";
export interface DocsEnumValue { name: string; label: string; labelKey: string }
export interface DocsField {
  name: string;
  label: string;
  labelKey: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  enumName?: string;
  enumValues?: DocsEnumValue[];
  annotations: string[];
  relation?: { table: string; field: string; onDelete?: string };
}
export interface DocsEntity {
  name: string;
  tableName: string;
  label: string;
  labelKey: string;
  singular: string;
  plural: string;
  display?: string;
  tableDisplay?: string;
  fields: DocsField[];
  relations: Array<{ field: string; toTable: string; toField: string; onDelete?: string }>;
  restricted?: boolean;
  actions?: string[];
}
export interface DocsRelation { fromTable: string; field: string; toTable: string; toField: string; onDelete?: string }
export interface DocsDataflow {
  name: string;
  label: string;
  labelKey: string;
  allowRoles: string[];
  allowPermissions: string[];
  verification: string | null;
  inputs: Array<{ name: string; type: string; required: boolean; label: string; labelKey: string }>;
  contexts: Array<{ name: string; entity: string }>;
  steps: Array<{ name: string; actions: Array<{ kind: string; summary: string }> }>;
  result: string;
}
export interface DocsPermissionField { name: string; value: string; label: string; labelKey: string }
export interface DocsPermissionGroup { name: string; members: string[]; label: string; labelKey: string }
export interface DocsPermissionVerification { name: string; label: string; labelKey: string; inputs: Array<{ name: string; type: string }> }
export interface DocsModel {
  app: { name: string; description?: string; descriptionKey?: string };
  features: { overview: boolean; apiDocs: boolean; apiKeys: boolean };
  principal: { role: DocsRole; permissions: string[] };
  entities: DocsEntity[];
  relations: DocsRelation[];
  enums: Array<{ name: string; values: DocsEnumValue[] }>;
  dataflows: DocsDataflow[];
  permissions: { fields: DocsPermissionField[]; groups: DocsPermissionGroup[]; verifications: DocsPermissionVerification[] };
}
export interface DocsEnvelope { model: DocsModel; openApi: unknown }

/** 功能总览 page tabs (API docs and access keys are separate pages now). */
export type DocsTabKey = "entities" | "dataflows" | "permissions";

export function docsTabs(flags: { overview?: boolean } = qiyFeatureFlags): DocsTabKey[] {
  return flags.overview === false ? [] : ["entities", "dataflows", "permissions"];
}

export function docsTabLabelKey(tab: DocsTabKey): string {
  return "qiy.docs.tab" + tab.charAt(0).toUpperCase() + tab.slice(1);
}

/** Mermaid identifiers must be stable ASCII: everything else is replaced. */
export function mermaidId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, "_");
  return normalized.length > 0 && /^[A-Za-z_]/.test(normalized) ? normalized : "qiy_" + normalized;
}

/** Escapes text placed inside a Mermaid label: no quotes, braces, semicolons or newlines. */
export function escapeMermaidLabel(value: string): string {
  return value
    .replace(/[\\r\\n]+/g, " ")
    .replace(/"/g, "'")
    .replace(/[{}]/g, (character) => character === "{" ? "(" : ")")
    .replace(/;/g, ",")
    .replace(/[#]/g, "")
    .replace(/\\s+/g, " ")
    .trim();
}

/** UML class diagram from entities + relations, with fields and enum values. */
export function buildEntityDiagram(model: DocsModel): string {
  const lines: string[] = ["classDiagram", "  direction LR"];
  const tableId = new Map(model.entities.map((entity) => [entity.tableName, mermaidId("e_" + entity.tableName)]));
  for (const entity of model.entities) {
    const id = tableId.get(entity.tableName)!;
    lines.push("  class " + id + '["' + escapeMermaidLabel(entity.label) + '"] {');
    for (const field of entity.fields) {
      // Mermaid class members accept +Type field; PK/unique/nullable annotations
      // are not valid in the class body, so they stay in the field table below.
      const type = field.enumName ? field.enumName : field.type;
      lines.push("    +" + mermaidId(field.name) + " " + escapeMermaidLabel(type));
    }
    lines.push("  }");
  }
  const seen = new Set<string>();
  for (const relation of model.relations) {
    const from = tableId.get(relation.fromTable);
    const to = tableId.get(relation.toTable);
    if (!from || !to) continue;
    const key = from + "->" + to + ":" + relation.field;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push("  " + from + " --> " + to + " : " + escapeMermaidLabel(relation.field));
  }
  return lines.join("\\n");
}

/** Flowchart for one dataflow: inputs -> context loads -> steps/actions -> result. */
export function buildDataflowDiagram(flow: DocsDataflow): string {
  const lines: string[] = ["flowchart LR"];
  const inputId = mermaidId("d_" + flow.name + "_input");
  lines.push("  " + inputId + "([\\u8f93\\u5165: " + escapeMermaidLabel(flow.inputs.length ? flow.inputs.map((input) => input.name).join(", ") : "\\u65e0") + "])");
  const contextIds = flow.contexts.map((context, index) => {
    const id = mermaidId("d_" + flow.name + "_ctx_" + index);
    lines.push("  " + id + "[(" + escapeMermaidLabel(context.name + ": " + context.entity) + ")]");
    return id;
  });
  const stepIds = flow.steps.map((step, index) => {
    const id = mermaidId("d_" + flow.name + "_step_" + index);
    lines.push("  " + id + '["' + escapeMermaidLabel(step.name) + '"]');
    return id;
  });
  const actionIds: string[] = [];
  flow.steps.forEach((step, stepIndex) => {
    step.actions.forEach((action, actionIndex) => {
      const id = mermaidId("d_" + flow.name + "_act_" + stepIndex + "_" + actionIndex);
      lines.push("  " + id + '["' + escapeMermaidLabel(action.kind + ": " + action.summary) + '"]');
      actionIds.push(id);
    });
  });
  const resultId = mermaidId("d_" + flow.name + "_result");
  lines.push("  " + resultId + "([" + escapeMermaidLabel("\\u7ed3\\u679c: " + flow.result) + "])");
  const chain = [inputId, ...contextIds, ...stepIds, ...actionIds, resultId];
  for (let index = 1; index < chain.length; index += 1) lines.push("  " + chain[index - 1] + " --> " + chain[index]);
  return lines.join("\\n");
}

export function buildDataflowDiagrams(model: DocsModel): Array<{ name: string; label: string; source: string }> {
  return model.dataflows.map((flow) => ({ name: flow.name, label: flow.label, source: buildDataflowDiagram(flow) }));
}

export function describeDataflow(flow: DocsDataflow): { allowRoles: string[]; allowPermissions: string[]; verification: string | null; inputs: string[] } {
  return { allowRoles: flow.allowRoles, allowPermissions: flow.allowPermissions, verification: flow.verification, inputs: flow.inputs.map((input) => input.name + ": " + input.type + (input.required ? " (required)" : "")) };
}

async function docsFetch(path: string): Promise<Response> {
  const token = qiyAuthToken();
  const response = await fetch(path, { headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" });
  if (!response.ok) throw Object.assign(new Error("Request failed (" + response.status + ")"), { statusCode: response.status });
  return response;
}

/** Model metadata is immutable for a session: fetch once, share the promise. */
let docsModelPromise: Promise<DocsModel> | undefined;

export function fetchDocsModel(force = false): Promise<DocsModel> {
  if (!force && docsModelPromise) return docsModelPromise;
  const promise = docsFetch("/api/v1/docs/model").then(async (response) => await response.json() as DocsModel);
  docsModelPromise = promise.catch((error: unknown) => {
    docsModelPromise = undefined;
    throw error;
  });
  return docsModelPromise;
}

/** The permission-filtered OpenAPI document is fetched once per session. */
let openApiDocumentPromise: Promise<unknown> | undefined;

export function fetchOpenApiDocument(force = false): Promise<unknown> {
  if (!force && openApiDocumentPromise) return openApiDocumentPromise;
  const promise = docsFetch("/api/v1/openapi.json").then(async (response) => await response.json() as unknown);
  openApiDocumentPromise = promise.catch((error: unknown) => {
    openApiDocumentPromise = undefined;
    throw error;
  });
  return openApiDocumentPromise;
}

export interface OpenApiParameter { name: string; in: string; required: boolean; description?: string; schema?: unknown }
export interface OpenApiResponse { status: string; description?: string; schema?: unknown }
export interface OpenApiOperation {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags: string[];
  parameters: OpenApiParameter[];
  requestSchema?: unknown;
  responses: OpenApiResponse[];
  security: string[];
  roles: string[];
  permissions: string[];
  verification?: string | null;
}
export interface OpenApiTagGroup { name: string; description?: string; operations: OpenApiOperation[] }

function openApiRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function openApiString(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function openApiStringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }

/** Short human-readable schema description used by the built-in API explorer. */
export function schemaSummary(schema: unknown, depth = 0): string {
  const record = openApiRecord(schema);
  if (!record) return "\\u2014";
  if (typeof record.$ref === "string") return record.$ref.split("/").pop() ?? record.$ref;
  if (depth > 2) return "\\u2026";
  const type = openApiString(record.type);
  const nullable = record.nullable === true ? "?" : "";
  const enums = Array.isArray(record.enum) ? record.enum.map(String) : [];
  const format = openApiString(record.format);
  if (type === "array") return "array<" + schemaSummary(record.items, depth + 1) + ">" + nullable;
  if (Array.isArray(record.oneOf)) return "oneOf<" + record.oneOf.map((item) => schemaSummary(item, depth + 1)).join(" | ") + ">";
  if (Array.isArray(record.anyOf)) return "anyOf<" + record.anyOf.map((item) => schemaSummary(item, depth + 1)).join(" | ") + ">";
  const properties = openApiRecord(record.properties);
  if (type === "object" || properties) {
    if (!properties) return "object" + nullable;
    const names = Object.keys(properties);
    const shown = names.slice(0, 6).map((name) => name + ": " + schemaSummary(properties[name], depth + 1));
    return "object { " + shown.join("; ") + (names.length > 6 ? "; \\u2026" : "") + " }";
  }
  const base = type ?? "value";
  const enumText = enums.length ? " (" + enums.slice(0, 8).join(" | ") + (enums.length > 8 ? " | \\u2026" : "") + ")" : "";
  return base + (format ? " (" + format + ")" : "") + enumText + nullable;
}

/** Deterministic example value for request bodies and curl snippets. */
export function schemaExample(schema: unknown, depth = 0): unknown {
  const record = openApiRecord(schema);
  if (!record || depth > 4) return null;
  if (typeof record.$ref === "string") return record.$ref.split("/").pop() ?? "";
  if (Array.isArray(record.enum) && record.enum.length > 0) return record.enum[0];
  if (Array.isArray(record.oneOf) && record.oneOf.length > 0) return schemaExample(record.oneOf[0], depth + 1);
  if (Array.isArray(record.anyOf) && record.anyOf.length > 0) return schemaExample(record.anyOf[0], depth + 1);
  const type = openApiString(record.type);
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "array") return [schemaExample(record.items, depth + 1)];
  const properties = openApiRecord(record.properties);
  if (type === "object" || properties) {
    const result: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(properties ?? {})) result[name] = schemaExample(child, depth + 1);
    return result;
  }
  return "";
}

function openApiParameter(raw: unknown): OpenApiParameter | undefined {
  const record = openApiRecord(raw);
  if (!record) return undefined;
  const name = openApiString(record.name);
  if (!name) return undefined;
  return { name, in: openApiString(record.in) ?? "query", required: record.required === true, ...(openApiString(record.description) ? { description: openApiString(record.description) } : {}), ...(record.schema !== undefined ? { schema: record.schema } : {}) };
}

function openApiResponse(raw: unknown): { description?: string; schema?: unknown } | undefined {
  const record = openApiRecord(raw);
  if (!record) return undefined;
  const content = openApiRecord(record.content);
  const jsonContent = content ? openApiRecord(content["application/json"]) : undefined;
  return { ...(openApiString(record.description) ? { description: openApiString(record.description) } : {}), ...(jsonContent?.schema !== undefined ? { schema: jsonContent.schema } : {}) };
}

function openApiSecurityNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names = new Set<string>();
  for (const entry of raw) for (const name of Object.keys(openApiRecord(entry) ?? {})) names.add(name);
  return [...names];
}

function openApiOperation(path: string, method: string, raw: unknown): OpenApiOperation | undefined {
  const record = openApiRecord(raw);
  if (!record) return undefined;
  const requestBody = openApiRecord(record.requestBody);
  const requestContent = requestBody ? openApiRecord(requestBody.content) : undefined;
  const requestJson = requestContent ? openApiRecord(requestContent["application/json"]) : undefined;
  const responses: OpenApiResponse[] = Object.entries(openApiRecord(record.responses) ?? {}).map(([status, value]) => {
    const response = openApiResponse(value);
    return { status, ...(response ?? {}) };
  });
  return {
    method,
    path,
    ...(openApiString(record.summary) ? { summary: openApiString(record.summary) } : {}),
    ...(openApiString(record.description) ? { description: openApiString(record.description) } : {}),
    ...(openApiString(record.operationId) ? { operationId: openApiString(record.operationId) } : {}),
    tags: openApiStringArray(record.tags).length > 0 ? openApiStringArray(record.tags) : ["default"],
    parameters: Array.isArray(record.parameters) ? record.parameters.map(openApiParameter).filter((item): item is OpenApiParameter => Boolean(item)) : [],
    ...(requestJson?.schema !== undefined ? { requestSchema: requestJson.schema } : {}),
    responses,
    security: openApiSecurityNames(record.security),
    roles: openApiStringArray(record["x-qiy-roles"]),
    permissions: openApiStringArray(record["x-qiy-permissions"]),
    ...(record["x-qiy-verification"] !== undefined ? { verification: record["x-qiy-verification"] as string | null } : {}),
  };
}

/** Groups OpenAPI operations by tag in a stable order (declared tags first, then alphabetical). */
export function groupOpenApiOperations(spec: unknown): OpenApiTagGroup[] {
  const document = openApiRecord(spec) ?? {};
  const paths = openApiRecord(document.paths) ?? {};
  const methods = ["get", "post", "patch", "delete"];
  const byTag = new Map<string, OpenApiOperation[]>();
  for (const path of Object.keys(paths)) {
    const item = openApiRecord(paths[path]);
    if (!item) continue;
    for (const method of methods) {
      const operation = openApiOperation(path, method, item[method]);
      if (!operation) continue;
      for (const tag of operation.tags) {
        const list = byTag.get(tag) ?? [];
        list.push(operation);
        byTag.set(tag, list);
      }
    }
  }
  const declared = (Array.isArray(document.tags) ? document.tags : []).map((tag) => openApiRecord(tag)).filter((tag): tag is Record<string, unknown> => Boolean(tag));
  const order = declared.map((tag) => openApiString(tag.name) ?? "").filter(Boolean);
  const names = [...order.filter((name) => byTag.has(name)), ...[...byTag.keys()].filter((name) => !order.includes(name)).sort()];
  return names.map((name) => {
    const tag = declared.find((entry) => openApiString(entry.name) === name);
    const description = tag ? openApiString(tag.description) : undefined;
    return { name, ...(description ? { description } : {}), operations: byTag.get(name) ?? [] };
  });
}

export function openApiOperationCount(spec: unknown): number {
  return groupOpenApiOperations(spec).reduce((total, group) => total + group.operations.length, 0);
}

export function openApiServerBaseUrl(spec: unknown, fallback = "http://localhost:3000"): string {
  const document = openApiRecord(spec) ?? {};
  const servers = Array.isArray(document.servers) ? document.servers : [];
  const first = openApiRecord(servers[0]);
  const url = first ? openApiString(first.url) : undefined;
  if (!url) return fallback;
  if (/^https?:/.test(url)) return url.replace(/\\/+$/, "");
  if (url === "/") return fallback;
  return fallback + (url.startsWith("/") ? "" : "/") + url.replace(/\\/+$/, "");
}

/** Copyable, read-only curl example for one operation (no live requests are made). */
export function buildCurlExample(input: { method: string; path: string; baseUrl?: string; security?: readonly string[]; requestBody?: unknown; locale?: string }): string {
  const method = input.method.toUpperCase();
  const baseUrl = (input.baseUrl ?? "http://localhost:3000").replace(/\\/+$/, "");
  const locale = input.locale ?? "en-US";
  const chinese = locale.toLowerCase().startsWith("zh");
  const token = chinese ? "<\\u4f1a\\u8bdd\\u4ee4\\u724c>" : "<session-token>";
  const apiKey = chinese ? "<\\u4f60\\u7684 API Key>" : "<your-api-key>";
  const lines = ["curl -X " + method + " '" + baseUrl + input.path + "'"];
  const security = input.security ?? [];
  if (security.includes("apiKey") && !security.includes("bearerSession")) lines.push("  -H 'X-API-Key: " + apiKey + "'");
  else lines.push("  -H 'Authorization: Bearer " + token + "'");
  if (method !== "GET" && method !== "DELETE" && input.requestBody !== undefined) {
    lines.push("  -H 'Content-Type: application/json'");
    lines.push("  -d '" + JSON.stringify(input.requestBody) + "'");
  }
  const separator = " " + String.fromCharCode(92) + "\\n";
  return lines.join(separator);
}

/** Case-insensitive match of one operation against path/method/summary/description/tags. */
export function openApiOperationMatches(operation: OpenApiOperation, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return [operation.path, operation.method, operation.summary ?? "", operation.description ?? "", ...operation.tags].some((value) => value.toLowerCase().includes(trimmed));
}

/** Search filter for the API-docs page: drops empty tags and returns the matching count. */
export function filterOpenApiOperations(groups: readonly OpenApiTagGroup[], query: string): { groups: OpenApiTagGroup[]; total: number } {
  const filtered = groups.map((group) => ({ ...group, operations: group.operations.filter((operation) => openApiOperationMatches(operation, query)) })).filter((group) => group.operations.length > 0);
  return { groups: filtered, total: filtered.reduce((total, group) => total + group.operations.length, 0) };
}
`;
}

/** Client for the API-key management tab (list/create/revoke + pure helpers). */
function renderWebApiKeysModule(): string {
  return `/** Generated API-key client and pure helpers for the access-key page. */
import { qiyAuthToken } from "./auth";

export const QIY_API_KEY_MAX_ACTIVE = 10;
export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}
export interface CreatedApiKey { key: string; record: ApiKeyRecord }
export interface QiyIdentityLike { id?: string; role?: string; permissions?: unknown; groups?: unknown }
export type ApiKeyStatusFilter = "all" | "active" | "revoked" | "expired";
export interface ApiKeyPermissionTag { key: string; kind: "role" | "permission" | "group"; value: string }

function authHeaders(): Record<string, string> {
  const token = qiyAuthToken();
  return { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) };
}

async function apiKeyRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw Object.assign(new Error(body?.error ?? "API key request failed (" + response.status + ")"), { statusCode: response.status });
  return body;
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const body = await apiKeyRequest("/api/v1/auth/api-keys") as { items: ApiKeyRecord[] };
  return body.items;
}

export async function createApiKey(input: { name: string; expiresAt?: string | null }): Promise<CreatedApiKey> {
  return await apiKeyRequest("/api/v1/auth/api-keys", { method: "POST", body: JSON.stringify({ name: input.name, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) }) }) as CreatedApiKey;
}

export async function revokeApiKey(id: string): Promise<void> {
  await apiKeyRequest("/api/v1/auth/api-keys/" + encodeURIComponent(id), { method: "DELETE" });
}

export function maskedApiKey(prefix: string): string {
  return "qiy_" + prefix + "_********";
}

/** Number of keys that are neither revoked nor expired (the server enforces the same rule). */
export function countActiveApiKeys(records: readonly ApiKeyRecord[], now: Date = new Date()): number {
  return records.filter((record) => !record.revokedAt && (!record.expiresAt || new Date(record.expiresAt).getTime() > now.getTime())).length;
}

export function canCreateApiKey(records: readonly ApiKeyRecord[], now: Date = new Date()): boolean {
  return countActiveApiKeys(records, now) < QIY_API_KEY_MAX_ACTIVE;
}

export function defaultApiKeyName(records: readonly ApiKeyRecord[], now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return "Key " + stamp;
}

export function formatApiKeyDate(value: string | null, locale: string): string {
  if (!value) return "\\u2014";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale);
}

export type ApiKeyStatus = "active" | "revoked" | "expired";
export function apiKeyStatus(record: Pick<ApiKeyRecord, "revokedAt" | "expiresAt">, now: Date = new Date()): ApiKeyStatus {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

export function apiKeyStatusOptions(): ApiKeyStatusFilter[] {
  return ["all", "active", "revoked", "expired"];
}

/** Case-insensitive search across name, prefix and localized status label. */
export function apiKeyMatches(record: ApiKeyRecord, query: string, now: Date = new Date()): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return [record.name, record.prefix, record.maskedKey, apiKeyStatus(record, now)].some((value) => value.toLowerCase().includes(trimmed));
}

/** Search + status filter used by the access-key page. */
export function filterApiKeys(records: readonly ApiKeyRecord[], input: { search?: string; status?: ApiKeyStatusFilter } = {}, now: Date = new Date()): ApiKeyRecord[] {
  const status = input.status ?? "all";
  const search = input.search ?? "";
  return records.filter((record) => (status === "all" || apiKeyStatus(record, now) === status) && apiKeyMatches(record, search, now));
}

/** Flatten the current identity into role/permission/group tags with hover explanations. */
export function permissionTags(identity: QiyIdentityLike | null | undefined): ApiKeyPermissionTag[] {
  if (!identity) return [];
  const tags: ApiKeyPermissionTag[] = [];
  if (typeof identity.role === "string" && identity.role) tags.push({ key: "role:" + identity.role, kind: "role", value: identity.role });
  const toValues = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : typeof value === "string" ? value.split(/[\\s,]+/).filter(Boolean) : [];
  for (const permission of toValues(identity.permissions)) tags.push({ key: "permission:" + permission, kind: "permission", value: permission });
  for (const group of toValues(identity.groups)) tags.push({ key: "group:" + group, kind: "group", value: group });
  return tags;
}

/** Relative time for last-used/created cells (tooltips carry the full timestamp). */
export function relativeTime(value: string | null, now: Date = new Date(), locale = "en-US"): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const deltaSeconds = Math.round((parsed.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(deltaSeconds);
  const unit: Intl.RelativeTimeFormatUnit = absolute < 60 ? "second" : absolute < 3_600 ? "minute" : absolute < 86_400 ? "hour" : absolute < 2_592_000 ? "day" : "month";
  const divisor = unit === "second" ? 1 : unit === "minute" ? 60 : unit === "hour" ? 3_600 : unit === "day" ? 86_400 : 2_592_000;
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(deltaSeconds / divisor), unit);
}

/** Curl snippets shown on the access-key page. */
export function apiKeyCurlExamples(baseUrl = "http://localhost:3000"): { bearer: string; header: string } {
  const base = baseUrl.replace(/\\/+$/, "");
  return {
    bearer: "curl -H 'Authorization: Bearer qiy_<prefix>_<secret>' " + base + "/api/v1/inventory",
    header: "curl -H 'X-API-Key: qiy_<prefix>_<secret>' " + base + "/api/v1/inventory",
  };
}
`;
}

/** Mermaid renderer: SSR-safe placeholder, dynamic import in the browser. */
function renderWebMermaidComponent(): string {
  return `import { Alert, Spin } from "antd";
import { useEffect, useRef, useState } from "react";

/** Maximum time the deferred Mermaid render may take before the source fallback is shown. */
export const QIY_MERMAID_TIMEOUT_MS = 10_000;

/**
 * Renders one Mermaid diagram. The server render keeps the diagram source in a
 * stable container (so docs SSR tests and bundle checks can see it); the browser
 * defers the heavy dynamic import to a later task, renders asynchronously, and
 * falls back to the raw source after a timeout or on any error instead of
 * leaving a blank/frozen panel.
 */
export function MermaidDiagram({ id, source, ariaLabel, errorText, timeoutText }: { id: string; source: string; ariaLabel: string; errorText: string; timeoutText?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let delay: ReturnType<typeof setTimeout> | undefined;
    let guard: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      guard = setTimeout(() => {
        if (cancelled) return;
        setError(timeoutText ?? "Mermaid rendering timed out");
        setRendering(false);
      }, QIY_MERMAID_TIMEOUT_MS);
      void (async () => {
        try {
          const mermaid = (await import("mermaid")).default;
          const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
          const rendered = await mermaid.render("qiy-mermaid-" + id, source);
          if (!cancelled && container.current) container.current.innerHTML = rendered.svg;
        } catch (cause) {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          if (guard) clearTimeout(guard);
          if (!cancelled) setRendering(false);
        }
      })();
    };
    // Defer the import/render so the tab shell paints first; unmount/remount
    // (tab switches, HMR, StrictMode) cancels the pending render.
    delay = setTimeout(start, 0);
    return () => {
      cancelled = true;
      if (delay) clearTimeout(delay);
      if (guard) clearTimeout(guard);
    };
  }, [id, source, timeoutText]);
  return <div className="qiy-mermaid" data-diagram={source} aria-label={ariaLabel}>
    <div ref={container} />
    {rendering ? <Spin size="small" /> : null}
    {error ? <>
      <Alert type="warning" showIcon message={errorText} description={error} />
      <pre className="qiy-mermaid-fallback" data-mermaid-fallback={source}>{source}</pre>
    </> : null}
  </div>;
}
`;
}

/** Docs page component + route. JSX is generated as a template string. */
function renderWebDocsPageComponent(): string {
  return `import { Alert, Card, Descriptions, Empty, Select, Space, Spin, Table, Tabs, Tag, Typography } from "antd";
import { useTranslation } from "@refinedev/core";
import { Component, useState, type ReactNode } from "react";
import {
  buildDataflowDiagram,
  buildEntityDiagram,
  describeDataflow,
  docsTabLabelKey,
  docsTabs,
  type DocsDataflow,
  type DocsEntity,
  type DocsModel,
  type DocsTabKey,
} from "../docs";
import { MermaidDiagram } from "./mermaid";

/** Keeps a crashing panel from blanking the whole feature page. */
class DocsErrorBoundary extends Component<{ fallback: ReactNode; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface DocsPageProps {
  model?: DocsModel;
  loading?: boolean;
  error?: string;
  initialTab?: DocsTabKey;
}

function fieldColumns(translate: (key: string, params?: Record<string, unknown>, fallback?: string) => string) {
  return [
    { title: translate("qiy.docs.fieldName", {}, "Field"), dataIndex: "name", key: "name" },
    { title: translate("qiy.docs.fieldType", {}, "Type"), dataIndex: "type", key: "type" },
    { title: translate("qiy.docs.fieldNullable", {}, "Nullable"), dataIndex: "nullable", key: "nullable", render: (value: boolean) => value ? translate("qiy.yes", {}, "Yes") : translate("qiy.no", {}, "No") },
    { title: translate("qiy.docs.fieldEnum", {}, "Enum"), dataIndex: "enumName", key: "enumName", render: (value?: string) => value ?? "—" },
    { title: translate("qiy.docs.fieldAnnotations", {}, "Annotations"), dataIndex: "annotations", key: "annotations", render: (value: string[]) => (value ?? []).map((entry) => <Tag key={entry}>{entry}</Tag>) },
  ];
}

function EntityPanel({ model }: { model: DocsModel }) {
  const { translate } = useTranslation();
  const [selected, setSelected] = useState<string | undefined>(model.entities[0]?.tableName);
  const entity = model.entities.find((candidate) => candidate.tableName === selected) ?? model.entities[0];
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={5} style={{ margin: 0 }}>{translate("qiy.docs.entitiesTitle", {}, "Entities & relations")}</Typography.Title>
    <MermaidDiagram id="entities" source={buildEntityDiagram(model)} ariaLabel={translate("qiy.docs.entitiesTitle", {}, "Entities & relations")} errorText={translate("qiy.docs.mermaidError", {}, "Diagram failed to render")} timeoutText={translate("qiy.docs.mermaidTimeout", {}, "Diagram rendering timed out; showing the source instead")} />
    <Table<DocsEntity> size="small" rowKey="tableName" pagination={false} dataSource={model.entities} columns={[
      { title: translate("qiy.docs.entity", {}, "Entity"), key: "entity", render: (_, row) => <Space><span>{translate(row.labelKey, {}, row.label)}</span>{row.restricted ? <Tag color="orange">{translate("qiy.docs.restricted", {}, "Restricted")}</Tag> : null}</Space> },
      { title: translate("qiy.docs.fieldName", {}, "Field"), key: "fields", render: (_, row) => row.fields.length },
      { title: translate("qiy.docs.actions", {}, "Actions"), key: "actions", render: (_, row) => (row.actions ?? []).map((action) => <Tag key={action}>{action}</Tag>) },
    ]} />
    {entity ? <>
      <Space wrap>
        <Typography.Text>{translate("qiy.docs.selectEntity", {}, "Entity")}</Typography.Text>
        <Select value={entity.tableName} style={{ minWidth: 220 }} onChange={(value: string) => setSelected(value)} options={model.entities.map((candidate) => ({ value: candidate.tableName, label: translate(candidate.labelKey, {}, candidate.label) }))} />
      </Space>
      <Table size="small" rowKey="name" pagination={false} dataSource={entity.fields} columns={fieldColumns(translate)} />
    </> : null}
    <Typography.Title level={5} style={{ margin: 0 }}>{translate("qiy.docs.relationsTitle", {}, "Relations")}</Typography.Title>
    <Table size="small" rowKey={(row) => row.fromTable + "." + row.field + "." + row.toTable} pagination={false} dataSource={model.relations} columns={[
      { title: translate("qiy.docs.from", {}, "From"), dataIndex: "fromTable", key: "fromTable" },
      { title: translate("qiy.docs.fieldName", {}, "Field"), dataIndex: "field", key: "field" },
      { title: translate("qiy.docs.to", {}, "To"), dataIndex: "toTable", key: "toTable" },
      { title: translate("qiy.docs.onDelete", {}, "On delete"), dataIndex: "onDelete", key: "onDelete", render: (value?: string) => value ?? "—" },
    ]} />
  </Space>;
}

function DataflowPanel({ model }: { model: DocsModel }) {
  const { translate } = useTranslation();
  const [selected, setSelected] = useState<string | undefined>(model.dataflows[0]?.name);
  const flow = model.dataflows.find((candidate) => candidate.name === selected) ?? model.dataflows[0];
  if (!flow) return <Empty description={translate("qiy.docs.noData", {}, "Nothing to show")} />;
  const info = describeDataflow(flow);
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={5} style={{ margin: 0 }}>{translate("qiy.docs.dataflowsTitle", {}, "Dataflows")}</Typography.Title>
    <Select value={flow.name} style={{ minWidth: 260 }} onChange={(value: string) => setSelected(value)} options={model.dataflows.map((candidate) => ({ value: candidate.name, label: translate(candidate.labelKey, {}, candidate.label) }))} />
    <MermaidDiagram id={"dataflow-" + flow.name} source={buildDataflowDiagram(flow)} ariaLabel={flow.label} errorText={translate("qiy.docs.mermaidError", {}, "Diagram failed to render")} timeoutText={translate("qiy.docs.mermaidTimeout", {}, "Diagram rendering timed out; showing the source instead")} />
    <Descriptions size="small" column={1} bordered items={[
      { key: "roles", label: translate("qiy.docs.allowRoles", {}, "Allowed roles"), children: info.allowRoles.length ? info.allowRoles.join(", ") : "—" },
      { key: "permissions", label: translate("qiy.docs.allowPermissions", {}, "Required permissions"), children: info.allowPermissions.length ? info.allowPermissions.join(", ") : "—" },
      { key: "verification", label: translate("qiy.docs.verification", {}, "Verification"), children: info.verification ?? "—" },
      { key: "inputs", label: translate("qiy.docs.dataflowInputs", {}, "Inputs"), children: info.inputs.length ? info.inputs.join(", ") : "—" },
      { key: "result", label: translate("qiy.docs.dataflowResult", {}, "Result"), children: flow.result },
    ]} />
    <Table size="small" rowKey="name" pagination={false} dataSource={flow.steps} columns={[
      { title: translate("qiy.docs.dataflowSteps", {}, "Steps"), dataIndex: "name", key: "name" },
      { title: translate("qiy.docs.actions", {}, "Actions"), key: "actions", render: (_, row) => <Space direction="vertical" size={2}>{row.actions.map((action, index) => <Typography.Text key={index} code>{action.summary}</Typography.Text>)}</Space> },
    ]} />
  </Space>;
}

function PermissionsPanel({ model }: { model: DocsModel }) {
  const { translate } = useTranslation();
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={5} style={{ margin: 0 }}>{translate("qiy.docs.tabPermissions", {}, "Permissions")}</Typography.Title>
    <Descriptions size="small" column={1} items={[
      { key: "role", label: translate("qiy.docs.role", {}, "Role"), children: model.principal.role },
      { key: "permissions", label: translate("qiy.docs.effectivePermissions", {}, "Effective permissions"), children: model.principal.permissions.length ? model.principal.permissions.join(", ") : "—" },
    ]} />
    <Table size="small" rowKey="name" pagination={false} dataSource={model.permissions.fields} columns={[
      { title: translate("qiy.docs.permissionField", {}, "Permission"), dataIndex: "label", key: "label" },
      { title: translate("qiy.docs.permissionValue", {}, "Value"), dataIndex: "value", key: "value" },
    ]} />
    <Table size="small" rowKey="name" pagination={false} dataSource={model.permissions.groups} columns={[
      { title: translate("qiy.docs.permissionGroups", {}, "Groups"), dataIndex: "label", key: "label" },
      { title: translate("qiy.docs.members", {}, "Members"), dataIndex: "members", key: "members", render: (value: string[]) => value.join(", ") },
    ]} />
    <Table size="small" rowKey="name" pagination={false} dataSource={model.permissions.verifications} columns={[
      { title: translate("qiy.docs.permissionVerifications", {}, "Verifications"), dataIndex: "label", key: "label" },
      { title: translate("qiy.docs.dataflowInputs", {}, "Inputs"), dataIndex: "inputs", key: "inputs", render: (value: Array<{ name: string; type: string }>) => value.map((entry) => entry.name + ": " + entry.type).join(", ") },
    ]} />
  </Space>;
}

function overviewTabChildren(tab: DocsTabKey, props: DocsPageProps): ReactNode {
  if (tab === "entities") return props.model ? <EntityPanel model={props.model} /> : null;
  if (tab === "dataflows") return props.model ? <DataflowPanel model={props.model} /> : null;
  return props.model ? <PermissionsPanel model={props.model} /> : null;
}

/** 功能总览 page: UML entities, dataflow diagrams and the permission model. */
export function DocsOverviewPage(props: DocsPageProps) {
  const { translate } = useTranslation();
  const tabs = docsTabs({ overview: true });
  const [active, setActive] = useState<DocsTabKey | undefined>(props.initialTab && tabs.includes(props.initialTab) ? props.initialTab : tabs[0]);
  if (tabs.length === 0) return <Empty description={translate("qiy.docs.noData", {}, "Nothing to show")} />;
  const current = active && tabs.includes(active) ? active : tabs[0];
  const content = props.loading
    ? <Spin size="large" />
    : props.error
      ? <Alert type="error" showIcon message={translate("qiy.docs.loadError", {}, "Failed to load the overview")} description={props.error} />
      : <DocsErrorBoundary fallback={<Alert type="warning" showIcon message={translate("qiy.docs.panelError", {}, "This section could not be rendered")} />}>{overviewTabChildren(current!, props)}</DocsErrorBoundary>;
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={3} style={{ margin: 0 }}>{translate("qiy.docs.title", {}, "Feature overview")}</Typography.Title>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{props.model?.app.description ?? translate("qiy.docs.subtitle", {}, "Generated entities, dataflows and permission model for this application")}</Typography.Paragraph>
    {props.model?.principal ? <Alert type="info" showIcon message={translate("qiy.docs.accessNote", {}, "This overview only shows what your role and permissions allow")} /> : null}
    <Card size="small">
      {/* Only the active tab is mounted: the Mermaid diagrams are heavy and keeping inactive panes alive froze the page. */}
      <Tabs activeKey={current} onChange={(key: string) => setActive(key as DocsTabKey)} destroyOnHidden items={tabs.map((tab) => ({ key: tab, label: translate(docsTabLabelKey(tab), {}, tab), children: tab === current ? content : null }))} />
    </Card>
  </Space>;
}
`;
}

/** Overview route: feature gate + model fetch. */
function renderWebDocsRoute(): string {
  return `import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { overviewEnabled } from "../features";
import { fetchDocsModel, type DocsModel } from "../docs";
import { DocsOverviewPage } from "../components/docs-page";

export default function DocsRoute() {
  const [state, setState] = useState<{ model?: DocsModel; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // The route lives inside the guarded layout; using auth hooks here caused a
    // render loop, so fetch the model once and let the layout handle redirects.
    let cancelled = false;
    void (async () => {
      try {
        const model = await fetchDocsModel();
        if (!cancelled) setState({ model, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!overviewEnabled) return <Navigate to="/" replace />;
  return <DocsOverviewPage {...state} />;
}
`;
}

/** API-docs page: full-page, searchable, read-only OpenAPI explorer. */
function renderWebApiDocsPageComponent(): string {
  return `import { Alert, Card, Col, Empty, Input, Menu, Row, Space, Spin, Table, Tag, Tooltip, Typography } from "antd";
import { useTranslation } from "@refinedev/core";
import { useMemo, useState } from "react";
import {
  buildCurlExample,
  filterOpenApiOperations,
  groupOpenApiOperations,
  openApiServerBaseUrl,
  schemaExample,
  schemaSummary,
  type OpenApiOperation,
  type OpenApiParameter,
  type OpenApiResponse,
  type OpenApiTagGroup,
} from "../docs";

export interface ApiDocsPageProps {
  spec?: unknown;
  loading?: boolean;
  error?: string;
  identity?: { role?: string; permissions?: string[]; groups?: string[] } | null;
  initialTag?: string;
  initialSearch?: string;
}

function curlFor(operation: OpenApiOperation, baseUrl: string, locale: string): string {
  return buildCurlExample({
    method: operation.method,
    path: operation.path,
    baseUrl,
    security: operation.security,
    ...(operation.requestSchema !== undefined ? { requestBody: schemaExample(operation.requestSchema) } : {}),
    locale,
  });
}

function ApiOperationCard({ operation, baseUrl, translate, locale }: { operation: OpenApiOperation; baseUrl: string; translate: (key: string, params?: Record<string, unknown>, fallback?: string) => string; locale: string }) {
  const method = operation.method.toUpperCase();
  const color = operation.method === "get" ? "blue" : operation.method === "post" ? "green" : operation.method === "patch" ? "orange" : "red";
  const requestExample = operation.requestSchema !== undefined ? JSON.stringify(schemaExample(operation.requestSchema), null, 2) : undefined;
  const curl = curlFor(operation, baseUrl, locale);
  const roleTooltip = translate("qiy.apiDocs.rolesTooltip", {}, "Your role must be one of these roles; this document is already filtered for your account.");
  const permissionTooltip = translate("qiy.apiDocs.permissionsTooltip", {}, "The operation additionally requires every listed permission; this document is already filtered for your account.");
  const securityTooltip = translate("qiy.apiDocs.securityTooltip", {}, "Supported authentication schemes for this operation.");
  const securityLabels = operation.security.map((scheme) => scheme === "apiKey"
    ? translate("qiy.docs.securityApiKey", {}, "X-API-Key header")
    : scheme === "bearerSession" ? translate("qiy.docs.securityBearer", {}, "Session JWT bearer") : scheme);
  return <Card size="small" style={{ marginBottom: 12 }} title={<Space wrap><Tag color={color}>{method}</Tag><Typography.Text code>{operation.path}</Typography.Text>{operation.summary ? <Typography.Text type="secondary">{operation.summary}</Typography.Text> : null}</Space>}>
    {operation.description ? <Typography.Paragraph type="secondary">{operation.description}</Typography.Paragraph> : null}
    {operation.roles.length > 0 || operation.permissions.length > 0 || operation.verification ? <Space wrap style={{ marginBottom: 8 }}>
      {operation.roles.length > 0 ? <Tooltip title={roleTooltip}><Tag color="purple" data-tooltip={roleTooltip}>{translate("qiy.docs.roles", {}, "Roles") + ": " + operation.roles.join(", ")}</Tag></Tooltip> : null}
      {operation.permissions.length > 0 ? <Tooltip title={permissionTooltip}><Tag color="geekblue" data-tooltip={permissionTooltip}>{translate("qiy.docs.permissions", {}, "Permissions") + ": " + operation.permissions.join(", ")}</Tag></Tooltip> : null}
      {operation.verification ? <Tag color="gold">{translate("qiy.docs.verification", {}, "Verification") + ": " + operation.verification}</Tag> : null}
    </Space> : null}
    {operation.parameters.length > 0 ? <>
      <Typography.Text strong style={{ display: "block", marginTop: 8 }}>{translate("qiy.docs.parameters", {}, "Parameters")}</Typography.Text>
      <Table size="small" pagination={false} rowKey={(row: OpenApiParameter) => row.in + ":" + row.name} dataSource={operation.parameters} columns={[
        { title: translate("qiy.docs.paramName", {}, "Name"), dataIndex: "name", key: "name" },
        { title: translate("qiy.docs.paramIn", {}, "In"), dataIndex: "in", key: "in" },
        { title: translate("qiy.docs.paramRequired", {}, "Required"), dataIndex: "required", key: "required", render: (value: boolean) => value ? translate("qiy.yes", {}, "Yes") : translate("qiy.no", {}, "No") },
        { title: translate("qiy.docs.fieldType", {}, "Type"), dataIndex: "schema", key: "schema", render: (schema: unknown) => schemaSummary(schema) },
      ]} />
    </> : null}
    {requestExample ? <>
      <Typography.Text strong style={{ display: "block", marginTop: 12 }}>{translate("qiy.docs.requestBody", {}, "Request body")}</Typography.Text>
      <pre className="qiy-docs-code">{requestExample}</pre>
    </> : null}
    {operation.responses.length > 0 ? <>
      <Typography.Text strong style={{ display: "block", marginTop: 12 }}>{translate("qiy.docs.responses", {}, "Responses")}</Typography.Text>
      <Table size="small" pagination={false} rowKey={(row: OpenApiResponse) => row.status} dataSource={operation.responses} columns={[
        { title: translate("qiy.docs.responseStatus", {}, "Status"), dataIndex: "status", key: "status" },
        { title: translate("qiy.docs.responseDescription", {}, "Description"), dataIndex: "description", key: "description", render: (value?: string) => value ?? "—" },
        { title: translate("qiy.docs.fieldType", {}, "Type"), dataIndex: "schema", key: "schema", render: (schema: unknown) => schema ? schemaSummary(schema) : "—" },
      ]} />
    </> : null}
    <Typography.Text strong style={{ display: "block", marginTop: 12 }}>{translate("qiy.docs.security", {}, "Security")}</Typography.Text>
    <Tooltip title={securityTooltip}><Space wrap>{securityLabels.length > 0 ? securityLabels.map((label) => <Tag key={label} data-tooltip={securityTooltip}>{label}</Tag>) : <Typography.Text type="secondary">—</Typography.Text>}</Space></Tooltip>
    <Typography.Text strong style={{ display: "block", marginTop: 12 }}>{translate("qiy.docs.curl", {}, "curl example")}</Typography.Text>
    <Typography.Paragraph copyable={{ text: curl }}><pre className="qiy-docs-code">{curl}</pre></Typography.Paragraph>
  </Card>;
}

/** Full-page API reference explorer (read-only; no try-it requests). */
export function ApiDocsPage(props: ApiDocsPageProps) {
  const { translate, getLocale } = useTranslation();
  const groups = useMemo(() => groupOpenApiOperations(props.spec), [props.spec]);
  const [query, setQuery] = useState(props.initialSearch ?? "");
  const [tag, setTag] = useState<string | undefined>(props.initialTag);
  const filtered = useMemo(() => filterOpenApiOperations(groups, query), [groups, query]);
  const selected: OpenApiTagGroup | undefined = filtered.groups.find((group) => group.name === tag) ?? filtered.groups[0];
  const document = props.spec !== null && typeof props.spec === "object" && !Array.isArray(props.spec) ? props.spec as Record<string, unknown> : undefined;
  const info = document && document.info !== null && typeof document.info === "object" ? document.info as { title?: string; version?: string } : undefined;
  const principal = props.identity ?? (document && document["x-qiy-principal"] !== null && typeof document["x-qiy-principal"] === "object" ? document["x-qiy-principal"] as { role?: string; permissions?: string[]; groups?: string[] } : undefined);
  const baseUrl = openApiServerBaseUrl(props.spec, typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  const roleTooltip = translate("qiy.apiDocs.roleTooltip", {}, "Your account role is used to filter this document; operations you cannot call are not listed.");
  const permissionTooltip = translate("qiy.apiDocs.permissionTooltip", {}, "Permission values from your role, database column and verified claims. The document only contains operations you may call.");
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={3} style={{ margin: 0 }}>{translate("qiy.apiDocs.pageTitle", {}, "API reference")}</Typography.Title>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{translate("qiy.apiDocs.pageSubtitle", {}, "OpenAPI 3.1 operations allowed for the current account. Read-only: use the curl examples with a session token or an API key.")}</Typography.Paragraph>
    <Space wrap>
      {info?.title ? <Typography.Text strong>{info.title}</Typography.Text> : null}
      {info?.version ? <Tag>{info.version}</Tag> : null}
      {principal?.role ? <Tooltip title={roleTooltip}><Tag color="blue">{translate("qiy.apiDocs.currentRole", {}, "Role") + ": " + principal.role}</Tag></Tooltip> : null}
      {Array.isArray(principal?.permissions) && principal.permissions.length > 0 ? <Tooltip title={permissionTooltip}><Tag color="geekblue">{translate("qiy.apiDocs.currentPermissions", {}, "Permissions") + ": " + principal.permissions.map(String).join(", ")}</Tag></Tooltip> : null}
    </Space>
    <Alert type="info" showIcon message={translate("qiy.docs.apiFiltered", {}, "This document is filtered by the current account permissions")} />
    <Input.Search allowClear value={query} onChange={(event) => { setQuery(event.target.value); setTag(undefined); }} placeholder={translate("qiy.apiDocs.searchPlaceholder", {}, "Search path, method, summary or tag")} />
    {props.loading ? <Spin size="large" /> : props.error ? <Alert type="error" showIcon message={translate("qiy.apiDocs.loadError", {}, "Failed to load the API document")} description={props.error} /> : !document ? <Empty description={translate("qiy.docs.noData", {}, "Nothing to show")} /> : <>
      <Typography.Text type="secondary">{translate("qiy.apiDocs.resultCount", { count: filtered.total }, String(filtered.total) + " operation(s)")}</Typography.Text>
      {filtered.total === 0 ? <Empty description={translate("qiy.apiDocs.noResults", {}, "No operations match this search")} /> : <Row gutter={16}>
        <Col xs={24} md={6}>
          <div style={{ position: "sticky", top: 16 }}>
            <Menu mode="inline" selectedKeys={selected ? [selected.name] : []} onClick={({ key }: { key: string }) => setTag(String(key))} items={filtered.groups.map((group) => ({ key: group.name, label: <Space>{group.name}<Tag>{group.operations.length}</Tag></Space> }))} style={{ borderInlineEnd: "none" }} />
          </div>
        </Col>
        <Col xs={24} md={18}>
          {selected ? <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Title level={5} style={{ margin: 0 }}>{selected.name}{selected.description ? <Typography.Text type="secondary"> {selected.description}</Typography.Text> : null}</Typography.Title>
            {selected.operations.map((operation) => <ApiOperationCard key={operation.method + " " + operation.path} operation={operation} baseUrl={baseUrl} translate={translate} locale={getLocale()} />)}
          </Space> : null}
        </Col>
      </Row>}
    </>}
  </Space>;
}
`;
}

/** API-docs route: feature gate + OpenAPI/identity fetch (no auth hooks). */
function renderWebApiDocsRoute(): string {
  return `import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { qiyFeatureFlags } from "../features";
import { fetchOpenApiDocument } from "../docs";
import { fetchCurrentIdentity } from "../auth";
import { ApiDocsPage, type ApiDocsPageProps } from "../components/api-docs-page";

export default function ApiDocsRoute() {
  const [state, setState] = useState<{ spec?: unknown; identity?: ApiDocsPageProps["identity"]; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // No auth hooks in route modules: they caused a render loop. The guard
    // layout handles redirects; fetch the spec + cached identity once.
    let cancelled = false;
    void (async () => {
      try {
        const [spec, identity] = await Promise.all([fetchOpenApiDocument(), fetchCurrentIdentity()]);
        if (!cancelled) setState({ spec, identity: (identity ?? undefined) as ApiDocsPageProps["identity"], loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!qiyFeatureFlags.apiDocs) return <Navigate to="/" replace />;
  return <ApiDocsPage {...state} />;
}
`;
}

/** Access-keys page: developer-oriented API-key management. */
function renderWebApiKeysPageComponent(): string {
  return `import { Alert, Button, Card, DatePicker, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from "antd";
import { useTranslation } from "@refinedev/core";
import { useState } from "react";
import { Link } from "react-router";
import {
  QIY_API_KEY_MAX_ACTIVE,
  apiKeyCurlExamples,
  apiKeyStatus,
  apiKeyStatusOptions,
  canCreateApiKey,
  countActiveApiKeys,
  createApiKey,
  defaultApiKeyName,
  filterApiKeys,
  formatApiKeyDate,
  permissionTags,
  relativeTime,
  revokeApiKey,
  type ApiKeyRecord,
  type ApiKeyStatusFilter,
  type QiyIdentityLike,
} from "../api-keys";
import { qiyFeatureFlags } from "../features";

export interface ApiKeysPageProps {
  identity?: QiyIdentityLike | null;
  initialRecords?: ApiKeyRecord[];
  loading?: boolean;
  error?: string;
  initialSearch?: string;
  initialStatus?: ApiKeyStatusFilter;
  initialCreateOpen?: boolean;
  initialSecret?: string;
}

const statusColor: Record<string, string> = { active: "green", revoked: "red", expired: "orange" };
type Translate = (key: string, params?: Record<string, unknown>, fallback?: string) => string;

function statusLabel(state: string, translate: Translate): string {
  return translate("qiy.apiKey.status." + state, {}, state.charAt(0).toUpperCase() + state.slice(1));
}

function CreateKeyForm({ translate, form, records }: { translate: Translate; form?: ReturnType<typeof Form.useForm>[0]; records?: ApiKeyRecord[] }) {
  const [fallback] = Form.useForm();
  const usedForm = form ?? fallback;
  return <Form form={usedForm} layout="vertical" initialValues={{ name: defaultApiKeyName(records ?? []) }}>
    <Form.Item name="name" label={translate("qiy.apiKey.name", {}, "Name")} rules={[{ required: true, message: translate("qiy.apiKey.nameRequired", {}, "Name is required") }]}>
      <Input placeholder={translate("qiy.apiKey.namePlaceholder", {}, "e.g. CI deploy")} maxLength={80} />
    </Form.Item>
    <Form.Item name="expiresAt" label={translate("qiy.apiKey.expires", {}, "Expires (optional)")}>
      <DatePicker showTime style={{ width: "100%" }} />
    </Form.Item>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{translate("qiy.apiKey.createExplanation", {}, "The key inherits your current role and permissions. Expired or revoked keys stop working immediately.")}</Typography.Paragraph>
  </Form>;
}

function SecretKeyContent({ secret, translate, copy }: { secret?: string; translate: Translate; copy: (value: string) => Promise<void> }) {
  return <>
    <Alert type="warning" showIcon message={translate("qiy.apiKey.secretHint", {}, "The full key is shown only once and cannot be recovered.")} style={{ marginBottom: 12 }} />
    <Typography.Paragraph><Typography.Text code copyable>{secret}</Typography.Text></Typography.Paragraph>
    <Button onClick={() => secret ? void copy(secret) : undefined}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button>
  </>;
}

/** Full-page API-key management UI. The route wrapper owns fetching. */
export function ApiKeysPage(props: ApiKeysPageProps) {
  const { translate, getLocale } = useTranslation();
  const locale = getLocale();
  const [records, setRecords] = useState<ApiKeyRecord[]>(props.initialRecords ?? []);
  const [search, setSearch] = useState(props.initialSearch ?? "");
  const [status, setStatus] = useState<ApiKeyStatusFilter>(props.initialStatus ?? "all");
  const [createOpen, setCreateOpen] = useState(Boolean(props.initialCreateOpen));
  const [secret, setSecret] = useState<string | undefined>(props.initialSecret);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const filtered = filterApiKeys(records, { search, status });
  const activeCount = countActiveApiKeys(records);
  const tags = permissionTags(props.identity);
  const curls = apiKeyCurlExamples(typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  const roleTooltip = translate("qiy.apiKey.roleTooltip", {}, "Your account role. API keys inherit the role and permissions of the user who created them.");
  const permissionTooltip = translate("qiy.apiKey.permissionTooltip", {}, "Effective permission values for your account; a key created here can call exactly the APIs that you can call.");
  const groupTooltip = translate("qiy.apiKey.groupTooltip", {}, "Permission groups (roles) granted to your account.");
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      void message.success(translate("qiy.apiKey.copied", {}, "Copied"));
    } catch {
      void message.warning(value);
    }
  };
  const create = async () => {
    const values = await form.validateFields() as { name: string; expiresAt?: { toISOString?: () => string } | null };
    setSaving(true);
    try {
      const created = await createApiKey({ name: values.name, expiresAt: values.expiresAt?.toISOString?.() ?? null });
      setRecords((current) => [created.record, ...current]);
      setSecret(created.key);
      setCreateOpen(false);
      form.resetFields();
      void message.success(translate("qiy.apiKey.created", {}, "Created"));
    } catch (cause) {
      void message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  const revoke = async (record: ApiKeyRecord) => {
    try {
      await revokeApiKey(record.id);
      setRecords((current) => current.map((entry) => entry.id === record.id ? { ...entry, revokedAt: new Date().toISOString() } : entry));
      void message.success(translate("qiy.apiKey.revokedMessage", {}, "Revoked"));
    } catch (cause) {
      void message.error(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={3} style={{ margin: 0 }}>{translate("qiy.apiKey.pageTitle", {}, "Access keys")}</Typography.Title>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{translate("qiy.apiKey.pageSubtitle", {}, "Personal API keys for scripts and CI. Each key inherits your role and permissions and can be used as a Bearer token or X-API-Key header.")}</Typography.Paragraph>
    {qiyFeatureFlags.apiDocs ? <Typography.Paragraph style={{ margin: 0 }}><Link to="/system/api-docs">{translate("qiy.apiKey.apiDocsLink", {}, "View the API reference allowed for your account")}</Link></Typography.Paragraph> : null}
    <Card size="small" title={translate("qiy.apiKey.curlTitle", {}, "Using a key with curl")}>
      <Space direction="vertical" size={4} style={{ width: "100%" }}>
        <pre className="qiy-docs-code">{curls.bearer}</pre><Button size="small" onClick={() => void copy(curls.bearer)}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button>
        <pre className="qiy-docs-code">{curls.header}</pre><Button size="small" onClick={() => void copy(curls.header)}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button>
      </Space>
    </Card>
    <Space wrap>
      <Input.Search allowClear value={search} onChange={(event) => setSearch(event.target.value)} placeholder={translate("qiy.apiKey.searchPlaceholder", {}, "Search name, prefix or status")} style={{ width: 320 }} />
      <Select value={status} style={{ width: 160 }} onChange={(value: ApiKeyStatusFilter) => setStatus(value)} options={apiKeyStatusOptions().map((option) => ({ value: option, label: statusLabel(option, translate) }))} />
      <Button type="primary" disabled={!canCreateApiKey(records)} onClick={() => setCreateOpen(true)}>{translate("qiy.apiKey.create", {}, "Create key")}</Button>
      <Typography.Text type="secondary">{activeCount + " / " + QIY_API_KEY_MAX_ACTIVE} {translate("qiy.apiKey.limitHint", {}, "active keys")}</Typography.Text>
    </Space>
    {tags.length > 0 ? <Space wrap>
      {tags.map((tag) => <Tooltip key={tag.key} title={tag.kind === "role" ? roleTooltip : tag.kind === "group" ? groupTooltip : permissionTooltip}><Tag color={tag.kind === "role" ? "blue" : tag.kind === "group" ? "purple" : "geekblue"} data-tooltip={tag.kind === "role" ? roleTooltip : tag.kind === "group" ? groupTooltip : permissionTooltip}>{tag.kind + ": " + tag.value}</Tag></Tooltip>)}
    </Space> : null}
    {props.error ? <Alert type="error" showIcon message={translate("qiy.apiKey.loadError", {}, "Failed to load API keys")} description={props.error} /> : null}
    <Table<ApiKeyRecord> size="small" rowKey="id" loading={props.loading} pagination={false} dataSource={filtered} locale={{ emptyText: translate("qiy.apiKey.empty", {}, "No API keys yet") }} columns={[
      { title: translate("qiy.apiKey.name", {}, "Name"), dataIndex: "name", key: "name" },
      { title: translate("qiy.apiKey.prefix", {}, "Key"), key: "prefix", render: (_, record) => <Space><Typography.Text code>{record.maskedKey}</Typography.Text><Button size="small" type="link" onClick={() => void copy(record.maskedKey)}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button></Space> },
      { title: translate("qiy.apiKey.status", {}, "Status"), key: "status", render: (_, record) => { const state = apiKeyStatus(record); return <Tag color={statusColor[state]}>{statusLabel(state, translate)}</Tag>; } },
      { title: translate("qiy.apiKey.createdAt", {}, "Created"), dataIndex: "createdAt", key: "createdAt", render: (value: string) => formatApiKeyDate(value, locale) },
      { title: translate("qiy.apiKey.lastUsed", {}, "Last used"), dataIndex: "lastUsedAt", key: "lastUsedAt", render: (value: string | null) => value ? <Tooltip title={formatApiKeyDate(value, locale)}>{relativeTime(value, new Date(), locale)}</Tooltip> : translate("qiy.apiKey.never", {}, "Never") },
      { title: translate("qiy.apiKey.expires", {}, "Expires"), dataIndex: "expiresAt", key: "expiresAt", render: (value: string | null) => value ? <Tooltip title={formatApiKeyDate(value, locale)}>{formatApiKeyDate(value, locale)}</Tooltip> : translate("qiy.apiKey.never", {}, "Never") },
      { title: translate("qiy.apiKey.actions", {}, "Actions"), key: "actions", render: (_, record) => record.revokedAt ? null : <Popconfirm title={translate("qiy.apiKey.revokeConfirm", {}, "Revoke this key? It stops working immediately.")} onConfirm={() => void revoke(record)} okText={translate("qiy.apiKey.revoke", {}, "Revoke")} cancelText={translate("qiy.cancel", {}, "Cancel")}><Button danger size="small">{translate("qiy.apiKey.revoke", {}, "Revoke")}</Button></Popconfirm> },
    ]} />
    <Modal open={createOpen} forceRender getContainer={false} title={translate("qiy.apiKey.create", {}, "Create key")} okText={translate("qiy.apiKey.create", {}, "Create key")} confirmLoading={saving} onOk={() => void create()} onCancel={() => setCreateOpen(false)}>
      <CreateKeyForm translate={translate} form={form} records={records} />
    </Modal>
    <Modal open={Boolean(secret)} forceRender getContainer={false} title={translate("qiy.apiKey.secretTitle", {}, "Save this secret now")} onCancel={() => setSecret(undefined)} footer={<Space><Button onClick={() => secret ? void copy(secret) : undefined}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button><Button type="primary" onClick={() => setSecret(undefined)}>{translate("qiy.close", {}, "Close")}</Button></Space>}>
      <SecretKeyContent secret={secret} translate={translate} copy={copy} />
    </Modal>
    {props.initialCreateOpen ? <div hidden data-modal-preview="create"><CreateKeyForm translate={translate} records={records} /></div> : null}
    {props.initialSecret ? <div hidden data-modal-preview="secret"><Typography.Title level={5}>{translate("qiy.apiKey.secretTitle", {}, "Save this secret now")}</Typography.Title><SecretKeyContent secret={props.initialSecret} translate={translate} copy={copy} /></div> : null}
  </Space>;
}
`;
}

/** API-keys route: feature gate + key list/identity fetch (no auth hooks). */
function renderWebApiKeysRoute(): string {
  return `import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { qiyFeatureFlags } from "../features";
import { listApiKeys, type ApiKeyRecord, type QiyIdentityLike } from "../api-keys";
import { fetchCurrentIdentity } from "../auth";
import { ApiKeysPage } from "../components/api-keys-page";

export default function ApiKeysRoute() {
  const [state, setState] = useState<{ records?: ApiKeyRecord[]; identity?: QiyIdentityLike; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // No auth hooks in route modules (render-loop hazard); the guarded layout
    // owns redirects, this effect fetches the key list + cached identity once.
    let cancelled = false;
    void (async () => {
      try {
        const [records, identity] = await Promise.all([listApiKeys(), fetchCurrentIdentity()]);
        if (!cancelled) setState({ records, identity: identity ?? undefined, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!qiyFeatureFlags.apiKeys) return <Navigate to="/" replace />;
  return <ApiKeysPage {...state} />;
}
`;
}

/** Generated web tests for the docs helpers, menu link and API-key pure helpers. */
function renderWebFeaturesTest(overview: boolean, apiDocs: boolean, apiKeys: boolean): string {
  const links: Array<Record<string, string>> = [];
  if (overview) links.push({ name: "qiy-docs", path: "/system/overview", label: "功能总览", labelKey: "qiy.docs.title", icon: "AppstoreOutlined", group: "system" });
  if (apiDocs) links.push({ name: "qiy-api-docs", path: "/system/api-docs", label: "API 文档", labelKey: "qiy.apiDocs.title", icon: "FileTextOutlined", group: "system" });
  if (apiKeys) links.push({ name: "qiy-api-keys", path: "/system/api-keys", label: "访问密钥", labelKey: "qiy.apiKey.title", icon: "KeyOutlined", group: "system" });
  return `import { expect, test } from "bun:test";
import { buildMenuTree } from "../app/components/menu";
import { menuGroups, resources } from "../app/resources";
import { overviewEnabled, qiyFeatureFlags, qiyMenuLinks } from "../app/features";

test("exposes the feature flags and developer-page menu links in order", () => {
  expect(qiyFeatureFlags).toEqual({ overview: ${overview}, apiDocs: ${apiDocs}, apiKeys: ${apiKeys} });
  expect(overviewEnabled).toBe(${overview});
  expect(qiyMenuLinks).toEqual(${JSON.stringify(links, null, 2)});
  const tree = buildMenuTree({ resources, menuGroups, links: qiyMenuLinks });
  const systemGroup = tree.find((node) => node.key === "menu-system") ?? tree.find((node) => node.children.some((child) => qiyMenuLinks.some((link) => link.name === child.key)));
  expect(systemGroup).toBeDefined();
  const linkNodes = systemGroup!.children.filter((child) => qiyMenuLinks.some((link) => link.name === child.key));
  expect(linkNodes.map((node) => node.to)).toEqual(qiyMenuLinks.map((link) => link.path));
});
`;
}

/** Overview helper tests: Mermaid builders and the three-page tab gating. */
function renderWebOverviewTest(): string {
  return `import { expect, test } from "bun:test";
import {
  buildDataflowDiagram,
  buildDataflowDiagrams,
  buildEntityDiagram,
  describeDataflow,
  docsTabLabelKey,
  docsTabs,
  escapeMermaidLabel,
  mermaidId,
  type DocsModel,
} from "../app/docs";

const model: DocsModel = {
  app: { name: "Test app" },
  features: { overview: true, apiDocs: true, apiKeys: true },
  principal: { role: "operator", permissions: ["inventory:receive"] },
  entities: [
    { name: "users", tableName: "users", label: "Users", labelKey: "qiy.resources.users.label", singular: "User", plural: "Users", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.users.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }, { name: "role", label: "Role", labelKey: "qiy.resources.users.fields.role.label", type: "userRole", nullable: false, enumName: "userRole", enumValues: [{ name: "admin", label: "Admin", labelKey: "qiy.enums.userRole.values.admin" }], annotations: [] }], relations: [] },
    { name: "orders", tableName: "orders", label: "Orders", labelKey: "qiy.resources.orders.label", singular: "Order", plural: "Orders", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.orders.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }, { name: "userId", label: "User", labelKey: "qiy.resources.orders.fields.userId.label", type: "UUID", nullable: false, annotations: ["relation:users"], relation: { table: "users", field: "id" } }], relations: [{ field: "userId", toTable: "users", toField: "id" }] },
  ],
  relations: [{ fromTable: "orders", field: "userId", toTable: "users", toField: "id" }],
  enums: [{ name: "userRole", values: [{ name: "admin", label: "Admin", labelKey: "qiy.enums.userRole.values.admin" }] }],
  dataflows: [{ name: "receiveStock", label: "Receive stock", labelKey: "qiy.dataflows.receiveStock.label", allowRoles: ["admin", "operator"], allowPermissions: [], verification: null, inputs: [{ name: "quantity", type: "Integer", required: true, label: "quantity", labelKey: "" }], contexts: [{ name: "inventory", entity: "inventory" }], steps: [{ name: "load", actions: [{ kind: "update", summary: "update inventory" }] }], result: "inventory" }],
  permissions: { fields: [{ name: "InventoryReceivePermission", value: "inventory:receive", label: "Receive", labelKey: "" }], groups: [{ name: "operator", members: ["InventoryReceivePermission"], label: "operator", labelKey: "" }], verifications: [] },
};

test("builds an escaped UML entity diagram", () => {
  const diagram = buildEntityDiagram(model);
  expect(diagram.startsWith("classDiagram")).toBe(true);
  expect(diagram).toContain('class e_users["Users"]');
  expect(diagram).toContain('class e_orders["Orders"]');
  expect(diagram).toContain("+id UUID");
  expect(diagram).toContain("+role userRole");
  expect(diagram).toContain("e_orders --> e_users : userId");
  expect(buildEntityDiagram(model)).toBe(diagram);
  expect(escapeMermaidLabel('a "b" {c};\\nd')).toBe("a 'b' (c), d");
  expect(mermaidId("orders-line")).toBe("orders_line");
  expect(mermaidId("1bad")).toBe("qiy_1bad");
});

test("builds a flowchart per dataflow with inputs, steps and result", () => {
  const flow = model.dataflows[0]!;
  const diagram = buildDataflowDiagram(flow);
  expect(diagram.startsWith("flowchart LR")).toBe(true);
  expect(diagram).toContain("d_receiveStock_input");
  expect(diagram).toContain("d_receiveStock_step_0");
  expect(diagram).toContain("d_receiveStock_result");
  expect(diagram).toContain("update inventory");
  expect(buildDataflowDiagrams(model)).toHaveLength(1);
  expect(describeDataflow(flow).inputs).toEqual(["quantity: Integer (required)"]);
  expect(describeDataflow(flow).allowRoles).toEqual(["admin", "operator"]);
});

test("the overview only exposes entities, dataflows and permissions tabs", () => {
  expect(docsTabs({ overview: true })).toEqual(["entities", "dataflows", "permissions"]);
  expect(docsTabs({ overview: false })).toEqual([]);
  expect(docsTabLabelKey("entities")).toBe("qiy.docs.tabEntities");
  expect(docsTabLabelKey("permissions")).toBe("qiy.docs.tabPermissions");
});
`;
}

/** Pure OpenAPI explorer helper tests for the API-docs page. */
function renderWebApiDocsTest(): string {
  return `import { expect, test } from "bun:test";
import {
  buildCurlExample,
  filterOpenApiOperations,
  groupOpenApiOperations,
  openApiOperationCount,
  openApiOperationMatches,
  openApiServerBaseUrl,
  schemaExample,
  schemaSummary,
} from "../app/docs";

const spec = {
  openapi: "3.1.0",
  info: { title: "Demo API", version: "1.0.0" },
  servers: [{ url: "/", description: "Same origin" }],
  tags: [{ name: "orders", description: "Orders" }, { name: "auth", description: "Auth" }],
  paths: {
    "/api/v1/orders": {
      get: {
        tags: ["orders"],
        summary: "List orders",
        security: [{ bearerSession: [] }, { apiKey: [] }],
        "x-qiy-roles": ["admin", "operator"],
        "x-qiy-permissions": [],
        parameters: [
          { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
          { name: "search", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Paginated records", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { type: "object" } }, total: { type: "integer" } } } } } }, "401": { description: "Authentication required" } },
      },
      post: {
        tags: ["orders"],
        summary: "Create order",
        security: [{ bearerSession: [] }],
        "x-qiy-roles": ["admin"],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { number: { type: "string" }, total: { type: "integer" } }, required: ["number"] } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/auth/me": { get: { tags: ["auth"], summary: "Current principal", security: [{ bearerSession: [] }], responses: { "200": { description: "Principal" } } } },
  },
  "x-qiy-principal": { role: "operator", permissions: ["inventory:receive"] },
};

test("groups OpenAPI operations into stable tag panels", () => {
  const groups = groupOpenApiOperations(spec);
  expect(groups.map((group) => group.name)).toEqual(["orders", "auth"]);
  expect(groups[0]!.operations.map((operation) => operation.method)).toEqual(["get", "post"]);
  expect(groups[0]!.operations[0]!.summary).toBe("List orders");
  expect(groups[0]!.operations[0]!.parameters.map((parameter) => parameter.name)).toEqual(["page", "search"]);
  expect(groups[0]!.operations[0]!.security).toEqual(["bearerSession", "apiKey"]);
  expect(groups[0]!.operations[1]!.requestSchema).toBeDefined();
  expect(groups[0]!.operations[0]!.roles).toEqual(["admin", "operator"]);
  expect(openApiOperationCount(spec)).toBe(3);
  expect(groupOpenApiOperations(undefined)).toEqual([]);
  expect(openApiOperationCount({ paths: {} })).toBe(0);
});

test("searches operations by path, method, summary and tag", () => {
  expect(openApiOperationMatches(groupOpenApiOperations(spec)[0]!.operations[0]!, "orders")).toBe(true);
  expect(openApiOperationMatches(groupOpenApiOperations(spec)[0]!.operations[0]!, "list")).toBe(true);
  expect(openApiOperationMatches(groupOpenApiOperations(spec)[0]!.operations[0]!, "post")).toBe(false);
  const byPath = filterOpenApiOperations(groupOpenApiOperations(spec), "auth/me");
  expect(byPath.total).toBe(1);
  expect(byPath.groups.map((group) => group.name)).toEqual(["auth"]);
  const byMethod = filterOpenApiOperations(groupOpenApiOperations(spec), "get");
  expect(byMethod.total).toBe(2);
  const byTag = filterOpenApiOperations(groupOpenApiOperations(spec), "orders");
  expect(byTag.total).toBe(2);
  const none = filterOpenApiOperations(groupOpenApiOperations(spec), "missing");
  expect(none.total).toBe(0);
  expect(none.groups).toEqual([]);
  expect(filterOpenApiOperations(groupOpenApiOperations(spec), "  ").total).toBe(3);
});

test("summarizes schemas and builds read-only curl examples", () => {
  expect(schemaSummary({ type: "string" })).toBe("string");
  expect(schemaSummary({ type: "string", format: "date-time" })).toBe("string (date-time)");
  expect(schemaSummary({ type: "string", enum: ["a", "b"] })).toBe("string (a | b)");
  expect(schemaSummary({ type: "integer", nullable: true })).toBe("integer?");
  expect(schemaSummary({ type: "array", items: { type: "string" } })).toBe("array<string>");
  expect(schemaSummary({ type: "object", properties: { id: { type: "string" }, total: { type: "integer" } } })).toContain("id: string");
  expect(schemaExample({ type: "object", properties: { number: { type: "string" }, total: { type: "integer" }, active: { type: "boolean" } } })).toEqual({ number: "", total: 0, active: false });
  expect(schemaExample({ type: "array", items: { type: "integer" } })).toEqual([0]);
  const getCurl = buildCurlExample({ method: "get", path: "/api/v1/orders", baseUrl: "http://localhost:3000", security: ["bearerSession"], locale: "en-US" });
  expect(getCurl).toContain("curl -X GET 'http://localhost:3000/api/v1/orders'");
  expect(getCurl).toContain("Authorization: Bearer <session-token>");
  expect(getCurl).not.toContain("Content-Type");
  const postCurl = buildCurlExample({ method: "post", path: "/api/v1/orders", baseUrl: "http://localhost:3000", security: ["apiKey"], requestBody: { number: "A-1" }, locale: "en-US" });
  expect(postCurl).toContain("X-API-Key: <your-api-key>");
  expect(postCurl).toContain("Content-Type: application/json");
  expect(postCurl).toContain('"number":"A-1"');
  expect(postCurl).toContain("\\n");
  expect(openApiServerBaseUrl(spec, "http://localhost:3000")).toBe("http://localhost:3000");
  expect(openApiServerBaseUrl({ servers: [{ url: "https://api.example.com" }] }, "http://localhost:3000")).toBe("https://api.example.com");
});
`;
}

/** Pure API-key helper tests for the access-keys page. */
function renderWebApiKeysTest(): string {
  return `import { expect, test } from "bun:test";
import {
  QIY_API_KEY_MAX_ACTIVE,
  apiKeyCurlExamples,
  apiKeyMatches,
  apiKeyStatus,
  apiKeyStatusOptions,
  canCreateApiKey,
  countActiveApiKeys,
  defaultApiKeyName,
  filterApiKeys,
  formatApiKeyDate,
  maskedApiKey,
  permissionTags,
  relativeTime,
  type ApiKeyRecord,
} from "../app/api-keys";

const now = new Date("2026-01-01T00:00:00Z");
const active: ApiKeyRecord = { id: "a", name: "Deploy", prefix: "abcdef12", maskedKey: "qiy_abcdef12_********", createdAt: "2025-12-01T00:00:00Z", lastUsedAt: null, expiresAt: null, revokedAt: null };
const expired: ApiKeyRecord = { ...active, id: "b", name: "Old key", prefix: "bbbbbbbb", expiresAt: "2025-12-31T00:00:00Z" };
const revoked: ApiKeyRecord = { ...active, id: "c", name: "Revoked key", prefix: "cccccccc", revokedAt: "2025-12-31T00:00:00Z" };

test("status, counts and limits mirror the server rules", () => {
  expect(maskedApiKey("abcdef12")).toBe("qiy_abcdef12_********");
  expect(apiKeyStatus(active, now)).toBe("active");
  expect(apiKeyStatus(expired, now)).toBe("expired");
  expect(apiKeyStatus(revoked, now)).toBe("revoked");
  expect(countActiveApiKeys([active, expired, revoked], now)).toBe(1);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE - 1 }, () => active), now)).toBe(true);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE }, () => active), now)).toBe(false);
  expect(defaultApiKeyName([], now)).toBe("Key 2026-01-01");
  expect(formatApiKeyDate(null, "en-US")).toBe("\\u2014");
  expect(formatApiKeyDate("2026-01-01T00:00:00Z", "en-US")).toContain("2026");
  expect(apiKeyStatusOptions()).toEqual(["all", "active", "revoked", "expired"]);
});

test("searches and filters keys by name, prefix and status", () => {
  expect(apiKeyMatches(active, "dep")).toBe(true);
  expect(apiKeyMatches(active, "abcdef12")).toBe(true);
  expect(apiKeyMatches(active, "revoked")).toBe(false);
  expect(filterApiKeys([active, expired, revoked], { search: "" }, now).map((record) => record.id)).toEqual(["a", "b", "c"]);
  expect(filterApiKeys([active, expired, revoked], { search: "deploy" }, now).map((record) => record.id)).toEqual(["a"]);
  expect(filterApiKeys([active, expired, revoked], { search: "", status: "revoked" }, now).map((record) => record.id)).toEqual(["c"]);
  expect(filterApiKeys([active, expired, revoked], { search: "", status: "expired" }, now).map((record) => record.id)).toEqual(["b"]);
  expect(filterApiKeys([active, expired, revoked], { search: "missing" }, now)).toEqual([]);
});

test("maps identity permissions and formats relative times and curl examples", () => {
  expect(permissionTags({ role: "operator", permissions: ["inventory:receive", "report:read"], groups: ["ManagerRole"] })).toEqual([
    { key: "role:operator", kind: "role", value: "operator" },
    { key: "permission:inventory:receive", kind: "permission", value: "inventory:receive" },
    { key: "permission:report:read", kind: "permission", value: "report:read" },
    { key: "group:ManagerRole", kind: "group", value: "ManagerRole" },
  ]);
  expect(permissionTags(null)).toEqual([]);
  expect(relativeTime("2025-12-31T23:59:00Z", now, "en-US")).toContain("ago");
  expect(relativeTime("2025-12-31T23:59:00Z", now, "zh-CN")).toContain("\\u524d");
  expect(relativeTime(null, now, "en-US")).toBe("");
  const curls = apiKeyCurlExamples("http://localhost:3000/");
  expect(curls.bearer).toContain("Authorization: Bearer qiy_");
  expect(curls.header).toContain("X-API-Key: qiy_");
  expect(curls.bearer).toContain("http://localhost:3000/api/v1/inventory");
});
`;
}

/** SSR render test for the overview page (entities/dataflows/permissions only). */
function renderWebOverviewRenderTest(): string {
  return `import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocsModel } from "../app/docs";

const model: DocsModel = {
  app: { name: "Test app", description: "Supply chain demo" },
  features: { overview: true, apiDocs: true, apiKeys: true },
  principal: { role: "admin", permissions: ["inventory:receive"] },
  entities: [
    { name: "users", tableName: "users", label: "Users", labelKey: "qiy.resources.users.label", singular: "User", plural: "Users", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.users.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }], relations: [] },
    { name: "orders", tableName: "orders", label: "Orders", labelKey: "qiy.resources.orders.label", singular: "Order", plural: "Orders", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.orders.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }], relations: [{ field: "userId", toTable: "users", toField: "id" }] },
  ],
  relations: [{ fromTable: "orders", field: "userId", toTable: "users", toField: "id" }],
  enums: [],
  dataflows: [{ name: "receiveStock", label: "Receive stock", labelKey: "qiy.dataflows.receiveStock.label", allowRoles: ["admin"], allowPermissions: [], verification: null, inputs: [{ name: "quantity", type: "Integer", required: true, label: "quantity", labelKey: "" }], contexts: [{ name: "inventory", entity: "inventory" }], steps: [{ name: "load", actions: [{ kind: "update", summary: "update inventory" }] }], result: "inventory" }],
  permissions: { fields: [], groups: [], verifications: [] },
};

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useGetIdentity: () => ({ data: { id: "admin", role: "admin" }, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({ ...router, Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children), Navigate: () => null }));

const { DocsOverviewPage } = await import("../app/components/docs-page");

test("renders the entity tab with the generated UML source", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, initialTab: "entities" }));
  expect(html).toContain("Feature overview");
  expect(html).toContain('data-diagram="classDiagram');
  expect(html).toContain("e_users");
  expect(html).toContain("Relations");
  expect(html).toContain("entities");
  expect(html).toContain("dataflows");
  expect(html).toContain("permissions");
  expect(html).not.toContain("API reference");
  expect(html).not.toContain("Access keys");
  expect(html).not.toContain("data-diagram=\\"flowchart");
  expect((html.match(/data-diagram=/g) ?? []).length).toBe(1);
});

test("renders the dataflow tab with exactly one flowchart", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, initialTab: "dataflows" }));
  expect(html).toContain('data-diagram="flowchart LR');
  expect(html).toContain("d_receiveStock_step_0");
  expect(html).toContain("Receive stock");
  expect((html.match(/data-diagram=/g) ?? []).length).toBe(1);
});

test("renders the permission model tab without mounting other tabs", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, initialTab: "permissions" }));
  expect(html).toContain("Permissions");
  expect(html).toContain("admin");
  expect(html).not.toContain('data-diagram="classDiagram');
  expect(html).not.toContain('data-diagram="flowchart');
});
`;
}

/** SSR render test for the full-page API-docs explorer. */
function renderWebApiDocsRenderTest(): string {
  return `import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const spec = {
  openapi: "3.1.0",
  info: { title: "Demo API", version: "1.0.0" },
  servers: [{ url: "/", description: "Same origin" }],
  tags: [{ name: "orders", description: "Orders" }, { name: "auth", description: "Auth" }],
  paths: {
    "/api/v1/orders": {
      get: {
        tags: ["orders"],
        summary: "List orders",
        security: [{ bearerSession: [] }, { apiKey: [] }],
        "x-qiy-roles": ["admin", "operator"],
        "x-qiy-permissions": [],
        parameters: [{ name: "page", in: "query", required: false, schema: { type: "integer" } }],
        responses: { "200": { description: "Paginated records" } },
      },
      post: {
        tags: ["orders"],
        summary: "Create order",
        security: [{ bearerSession: [] }],
        "x-qiy-roles": ["admin"],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { number: { type: "string" } } } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/auth/me": { get: { tags: ["auth"], summary: "Current principal", security: [{ bearerSession: [] }], responses: { "200": { description: "Principal" } } } },
  },
  "x-qiy-principal": { role: "operator", permissions: ["inventory:receive"] },
};

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useGetIdentity: () => ({ data: { id: "admin", role: "admin" }, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({ ...router, Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children), Navigate: () => null }));

const { ApiDocsPage } = await import("../app/components/api-docs-page");

test("renders the API reference page with tags, operations, parameters and curl", () => {
  const html = renderToStaticMarkup(createElement(ApiDocsPage, { spec }));
  expect(html).toContain("API reference");
  expect(html).toContain("Demo API");
  expect(html).toContain("orders");
  expect(html).toContain("auth");
  expect(html).toContain("GET");
  expect(html).toContain("/api/v1/orders");
  expect(html).toContain("List orders");
  expect(html).toContain("Parameters");
  expect(html).toContain("Request body");
  expect(html).toContain("Responses");
  expect(html).toContain("Security");
  expect(html).toContain("curl -X GET");
  expect(html).toContain("Authorization: Bearer");
  expect(html).toContain("Role: operator");
  expect(html).toContain("Permissions: inventory:receive");
  expect(html).toContain("data-tooltip");
  expect(html).toContain("filtered by the current account permissions");
  expect(html).toContain("operation(s)");
});

test("filters operations with the search box", () => {
  const filtered = renderToStaticMarkup(createElement(ApiDocsPage, { spec, initialSearch: "auth/me" }));
  expect(filtered).toContain("Current principal");
  expect(filtered).not.toContain("List orders");
  const noResults = renderToStaticMarkup(createElement(ApiDocsPage, { spec, initialSearch: "does-not-exist" }));
  expect(noResults).toContain("No operations match this search");
  expect(noResults).not.toContain("/api/v1/orders");
});

test("renders loading, error and empty states without network effects", () => {
  const empty = renderToStaticMarkup(createElement(ApiDocsPage, { spec: undefined }));
  expect(empty).toContain("Nothing to show");
  const loading = renderToStaticMarkup(createElement(ApiDocsPage, { spec, loading: true }));
  expect(loading).toContain("ant-spin");
  const error = renderToStaticMarkup(createElement(ApiDocsPage, { spec, error: "boom" }));
  expect(error).toContain("boom");
});
`;
}

/** SSR render test for the access-keys page. */
function renderWebApiKeysRenderTest(apiDocs: boolean): string {
  return `import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiKeyRecord } from "../app/api-keys";

const records: ApiKeyRecord[] = [
  { id: "a", name: "Deploy", prefix: "abcdef12", maskedKey: "qiy_abcdef12_********", createdAt: "2025-12-01T00:00:00Z", lastUsedAt: "2025-12-31T23:59:00Z", expiresAt: null, revokedAt: null },
  { id: "b", name: "Old key", prefix: "bbbbbbbb", maskedKey: "qiy_bbbbbbbb_********", createdAt: "2025-11-01T00:00:00Z", lastUsedAt: null, expiresAt: "2025-12-31T00:00:00Z", revokedAt: null },
  { id: "c", name: "Revoked key", prefix: "cccccccc", maskedKey: "qiy_cccccccc_********", createdAt: "2025-10-01T00:00:00Z", lastUsedAt: null, expiresAt: null, revokedAt: "2025-12-31T00:00:00Z" },
];
const identity = { id: "admin", role: "operator", permissions: ["inventory:receive", "report:read"], groups: ["ManagerRole"] };

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useGetIdentity: () => ({ data: identity, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({ ...router, Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children), Navigate: () => null }));

const { ApiKeysPage } = await import("../app/components/api-keys-page");

test("renders the access-keys page with curl examples, permission tags and rows", () => {
  const html = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records }));
  expect(html).toContain("Access keys");
  expect(html).toContain("Authorization: Bearer qiy_");
  expect(html).toContain("X-API-Key: qiy_");
  expect(html).toContain("role: operator");
  expect(html).toContain("permission: inventory:receive");
  expect(html).toContain("group: ManagerRole");
  expect(html).toContain("data-tooltip");
  expect(html).toContain("Deploy");
  expect(html).toContain("qiy_abcdef12_********");
  expect(html).toContain("Active");
  expect(html).toContain("Expired");
  expect(html).toContain("Revoked");
  expect(html).toContain("Create key");
${apiDocs ? `  expect(html).toContain("/system/api-docs");` : ""}
});

test("filters keys by search and status", () => {
  const search = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialSearch: "Old key" }));
  expect(search).toContain("Old key");
  expect(search).not.toContain("Deploy");
  const revoked = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialStatus: "revoked" }));
  expect(revoked).toContain("Revoked key");
  expect(revoked).not.toContain("Deploy");
});

test("renders the create modal and the one-time secret flow", () => {
  const create = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialCreateOpen: true }));
  expect(create).toContain("Create key");
  expect(create).toContain("Expires (optional)");
  expect(create).toContain("inherits your current role and permissions");
  const secret = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialSecret: "qiy_abcdef12_one-time-secret" }));
  expect(secret).toContain("Save this secret now");
  expect(secret).toContain("shown only once");
  expect(secret).toContain("qiy_abcdef12_one-time-secret");
});
`;
}
