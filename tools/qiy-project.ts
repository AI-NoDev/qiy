import { validateDatabaseIR, validateEntityDisplayTemplates, type DatabaseIR, type EntityIR, type FieldIR, type FilterMode, type IndexIR, type IndexColumnIR, type RelationIR } from "./database-ir";
import { validateCodeTemplate } from "./code-template";
import { isQiyV1Source, translateQiyV1 } from "./qiy-v1";
import {
  formatPermissionExpression,
  validatePermissionModel,
  type QiyPermissionClaimIR,
  type QiyPermissionComparisonOperator,
  type QiyPermissionDatabaseIR,
  type QiyPermissionExpressionIR,
  type QiyPermissionFieldIR,
  type QiyPermissionGroupIR,
  type QiyPermissionInputType,
  type QiyPermissionModel,
  type QiyPermissionOperandIR,
  type QiyPermissionVerificationInputIR,
  type QiyPermissionVerificationIR,
} from "./permissions";
/**
 * Declarative contract for an existing host API. It describes only what the
 * generated Refine admin needs in order to talk to that API automatically: the
 * base URL, the auth transport, where the list envelope and total live in the
 * JSON body, the pagination convention, and how the host tenant is forwarded.
 * URL mapping and business rules stay in the unowned host adapter.
 */
export interface QiyIntegrationConfig {
  apiBase: string;
  authTransport: "none" | "bearer" | "cookie" | "portal";
  csrfCookie?: string;
  csrfHeader?: string;
  /** Dotted JSON paths inside the host response body. */
  response?: { data?: string; total?: string; error?: string };
  /** Query-parameter convention used for list pagination. Defaults to `page`. */
  pagination?: "page" | "offset" | "none";
  /** Forwards one host identity key to the API as a required request header. */
  tenant?: { header: string; identity: string };
}

/** Chart view kinds. `const` is the stat view (the old `stat` name is gone). */
export type QiyChartViewKind = "const" | "pie" | "bar" | "line" | "table";
export type QiyChartAggregate = "count" | "sum" | "avg" | "min" | "max";
export type QiyChartDataOperation = "count" | "sum" | "avg" | "min" | "max" | "trend" | "list";

export const qiyChartKinds = ["const", "pie", "bar", "line", "table"] as const;
/** Supported placement variant names and the breakpoint bucket each one belongs to. */
export const qiyChartVariants = ["larger", "xl", "lg", "large", "medium", "md", "small", "sm", "xs"] as const;
export type QiyChartVariant = (typeof qiyChartVariants)[number];

/** Parsed `data = ...` mini language of one chart view. */
export interface QiyChartData {
  operation: QiyChartDataOperation;
  /** Entity or table name; normalized to the table name during validation. */
  entity: string;
  field?: string;
  groupBy?: string;
  days?: number;
  columns?: string[];
}

export interface QiyChartLabelValue {
  value: string;
  label: string;
}

/** `labels = <enum field>;` or an explicit mapping block `labels { value "Text"; }`. */
export interface QiyChartLabels {
  field?: string;
  values?: QiyChartLabelValue[];
}

/**
 * One declaration (`chart pie UserStatusCount { ... }`). Declarations with the
 * same chart name but different kinds become the views of that chart.
 */
export interface QiyChartView {
  kind: QiyChartViewKind;
  title?: string;
  icon?: string;
  data: QiyChartData;
  labels?: QiyChartLabels;
}

/** A chart: one or more view declarations sharing a name, plus fallback title/icon. */
export interface QiyChart {
  name: string;
  title?: string;
  icon?: string;
  views: QiyChartView[];
}

/** One responsive placement (`larger 0 0 4 2;`) inside a panel grid. */
export interface QiyChartPlacement {
  variant: QiyChartVariant;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface QiyChartPanelChart {
  name: string;
  placements: QiyChartPlacement[];
}

/** `chart panels <Name> { grid 24 24; ChartName { variant x y w h; } }`. */
export interface QiyChartPanel {
  name: string;
  title?: string;
  grid: { columns: number; rows: number };
  charts: QiyChartPanelChart[];
}

export interface QiyProject {
  name: string;
  comment?: string;
  commentKey?: string;
  database: DatabaseIR;
  mode?: "standalone" | "integration";
  integration?: QiyIntegrationConfig;
  workspace?: QiyWorkspaceConfig;
  ui?: QiyUiConfig;
  apiClient?: "rest" | "graphql";
  corsOrigins?: string[];
  elysiaPlugins?: {
    bearer?: boolean;
    cron?: { name: string; pattern: string; task: "cleanupMissingAttachments" }[];
    serverTiming?: boolean;
    graphqlAdapter?: "native" | "yoga" | "apollo";
    jwt?: { name: string; secretEnv: string };
    static?: { assets: string; prefix: string };
    html?: boolean;
    drizzle?: boolean;
  };
  storageProvider?: "local" | "s3";
  /**
   * Optional system-administration feature flags declared with a `features`
   * block. Both default to false; when enabled the generator adds the matching
   * routes/UI (`apiDocs`: 功能总览 + OpenAPI/Mermaid docs, `apiKeys`: API keys).
   */
  features?: QiyFeaturesConfig;
  /**
   * Authentication. `provider` names the single configured provider for the legacy
   * single-provider forms (`provider local;`, `provider oidc;`, `provider otp;`).
   * A `providers` list may mix `local` with OAuth providers: `local: true` then means
   * password login is enabled in addition to the OAuth providers in `providers`.
   * `providers` never contains `otp` and never contains `local`.
   */
  auth?: { provider: QiyAuthProvider; providers?: QiyAuthProvider[]; local?: boolean; userEntity: string; subjectField: string; providerMappings?: QiyAuthProviderMapping[]; roleField: string; usernameField?: string; passwordField?: string; profileField?: string };
  environment?: QiyEnvironmentVariable[];
  messages?: { defaultLocale: string; locales: Record<string, Record<string, string>> };
  menuGroups?: Array<{ name: string; label: string; icon?: string; parent?: string; comment?: string; commentKey?: string; resources: string[] }>;
  dashboardMetrics?: Array<{ name: string; resource: string; label: string; icon?: string; comment?: string; commentKey?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend" | "aggregate"; groupBy?: string; days?: number; field?: string; agg?: "sum" | "avg" | "min" | "max" }>;
  /** Multi-view charts declared with top-level `chart <Name> { ... }` blocks. */
  charts?: QiyChart[];
  /** `chart panels <Name> { ... }` dashboard layouts referencing charts by name. */
  chartPanels?: QiyChartPanel[];
  realtime?: QiyRealtimeConfig;
  scopes?: Array<{ resource: string; field: string; claim: string; tree?: { entity: string; parentField: string } }>;
  restrictions?: QiyResourceRestriction[];
  /**
   * Page-level rules: per resource and per page action, the roles allowed to open
   * that page. They refine `restrict.roles` (which only decides "may use resource
   * at all") and are enforced both in the generated UI and by the API guard.
   */
  pages?: Array<{ resource: string; actions: Array<{ action: QiyPageAction; roles: QiyRole[] }>; fields?: Array<{ field: string; roles: QiyRole[] }> }>;
  workflows?: Array<"orderInventory">;
  /**
   * Permission declarations: atomic permission fields, permission groups (roles
   * are groups whose name equals a role), OAuth claim/database provider sources,
   * and permission verification expressions. See tools/permissions.ts.
   */
  permissions?: QiyPermissionModel;
  dataflows?: DataflowIR[];
  actions?: QiyAction[];
}

export type QiyRole = "admin" | "operator" | "viewer";
export type QiyPageAction = "list" | "show" | "create" | "edit" | "delete";

/**
 * Row-level and field-level policy for one resource. This is deliberately a
 * closed, statically checkable set of predicates: every condition names a
 * declared resource field and compares it either to an authenticated claim or
 * to declared literal values, so authorization can be pushed into the database
 * query instead of being enforced with client-side filtering.
 */
export interface QiyResourceRestriction {
  resource: string;
  /** Roles allowed to read or write the resource at all. Empty means "no role restriction". */
  roles?: QiyRole[];
  /** Row predicates combined with AND. Every predicate must hold for a row to be visible. */
  rows?: QiyRowPredicate[];
  /**
   * Disjunctive groups: each group is OR-ed internally and AND-ed with `rows`.
   * Lets a resource express "my tenant OR my own records" without leaving the
   * closed, statically checkable predicate language.
   */
  groups?: QiyRowPredicate[][];
  /**
   * General boolean policy expressions (AND/OR/NOT nesting and cross-field
   * comparisons). AND-ed with `rows` and `groups`; the language stays closed and
   * statically checkable because every leaf names declared fields or claims.
   */
  expressions?: QiyPolicyExpression[];
  /** Field masks. A mask removes the field from responses for the matching principal. */
  masks?: QiyFieldMask[];
}

/** Comparison operators usable between two declared fields. */
export type QiyCrossOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type QiyPolicyExpression =
  | { kind: "predicate"; predicate: QiyRowPredicate }
  | { kind: "cross"; field: string; operator: QiyCrossOperator; otherField: string }
  | { kind: "scope" }
  | { kind: "not"; expression: QiyPolicyExpression }
  | { kind: "and"; children: QiyPolicyExpression[] }
  | { kind: "or"; children: QiyPolicyExpression[] };

export interface QiyRowPredicate {
  field: string;
  /** `claim` compares the field to an authenticated claim; `values` compares it to literals. */
  source: "claim" | "values";
  operator: "==" | "!=" | "in" | "notIn";
  /** Claim path for `source: "claim"`. */
  claim?: string;
  /** Literal values for `source: "values"`. */
  values?: string[];
  /**
   * When the principal lacks the claim (or the claim is empty), `deny` fails the
   * request with 403 instead of silently returning no rows. `hide` keeps the
   * predicate always-false so the row is simply not visible.
   */
  missing: "deny" | "hide";
}

export interface QiyFieldMask {
  field: string;
  /** Roles the mask applies to. Empty means the mask applies to every role. */
  roles?: QiyRole[];
  /** Optional claim guard: the mask only applies when the claim is present. */
  claim?: string;
  claimState?: "present" | "absent";
  /**
   * How the field is hidden. `omit` removes the key; `null` returns null so the
   * client can render an explicit "restricted" placeholder without leaking the
   * value; `redact` returns a fixed replacement string.
   */
  mode: "omit" | "null" | "redact";
  replacement?: string;
}

export type QiyRealtimeMode = "auto" | "manual";
export type QiyRealtimeEvent = "created" | "updated" | "deleted";

export interface QiyRealtimeConfig {
  mode: QiyRealtimeMode;
  resources: Array<{
    resource: string;
    events: QiyRealtimeEvent[];
    roles: Array<"admin" | "operator" | "viewer">;
    /** Row-scoped channel: subscribers only receive records whose field matches their claim. */
    claim?: { field: string; claim: string };
  }>;
}

export type QiyUiLibrary = "antd";
export type QiyThemeKey = "blue" | "purple" | "green" | "orange" | "red";
export type QiyColorMode = "light" | "dark" | "system";

export interface QiyUiConfig {
  library: QiyUiLibrary;
  theme: QiyThemeKey;
  themes: QiyThemeKey[];
  colorMode: QiyColorMode;
  allowThemeSwitch: boolean;
  allowColorModeSwitch: boolean;
}

const qiyThemeKeys = new Set<QiyThemeKey>(["blue", "purple", "green", "orange", "red"]);

/**
 * `features { overview true; apiDocs true; apiKeys true; }`: system
 * administration feature flags. `overview` defaults to true and gates the
 * 功能总览 page/menu entry; `apiDocs` gates the API-docs page and OpenAPI
 * endpoint; `apiKeys` gates the access-keys page, table and authentication.
 */
export interface QiyFeaturesConfig {
  overview: boolean;
  apiDocs: boolean;
  apiKeys: boolean;
}

export type QiyAuthProvider = "local" | "oidc" | "oauth2" | "sso" | "okta" | "auth0" | "azure-ad-b2c" | "keycloak" | "google" | "kinde" | "otp";

/** Per-provider identity mapping: which user-table field stores the provider identifier and which claim carries it. */
export interface QiyAuthProviderMapping {
  provider: QiyAuthProvider;
  subjectField: string;
  claim?: string;
}

const qiyAuthProviders = new Set<QiyAuthProvider>(["local", "oidc", "oauth2", "sso", "okta", "auth0", "azure-ad-b2c", "keycloak", "google", "kinde", "otp"]);

type ResolvedAuth = NonNullable<QiyProject["auth"]>;

/** OAuth/OIDC providers configured for an auth block; never includes local or otp. */
export function authOAuthProviders(auth: ResolvedAuth): QiyAuthProvider[] {
  return auth.providers ?? (auth.provider !== "local" && auth.provider !== "otp" ? [auth.provider] : []);
}

/** True when password (local) login is enabled, alone or next to OAuth providers. */
export function authHasLocal(auth: ResolvedAuth): boolean {
  return auth.local === true || auth.provider === "local";
}

/**
 * True for the mixed mode: a `providers` list that contains `local` plus at least
 * one OAuth provider. The generated app then exposes one login page with both a
 * password form and OAuth provider buttons, plus first-login onboarding and
 * account binding endpoints.
 */
export function authIsHybrid(auth: ResolvedAuth | undefined): boolean {
  if (!auth) return false;
  return authHasLocal(auth) && authOAuthProviders(auth).length > 0;
}

/** True when the auth block needs the multi-provider (browser PKCE + BFF) web client. */
export function authUsesProviderChooser(auth: ResolvedAuth | undefined): boolean {
  if (!auth) return false;
  return authIsHybrid(auth) || authOAuthProviders(auth).length > 1;
}

/** Effective subject column for one OAuth provider: its mapping override or the auth-level fallback. */
export function authProviderSubjectField(auth: ResolvedAuth, provider: QiyAuthProvider): string {
  return auth.providerMappings?.find((mapping) => mapping.provider === provider)?.subjectField ?? auth.subjectField;
}

/** Configured claim override for one OAuth provider, if any. */
export function authProviderClaim(auth: ResolvedAuth, provider: QiyAuthProvider): string | undefined {
  return auth.providerMappings?.find((mapping) => mapping.provider === provider)?.claim;
}


export interface QiyAction {
  name: string;
  roles?: Array<"admin" | "operator" | "viewer">;
  /** `allow permission ...`: principal must hold every expanded permission value. */
  permission?: string[];
  /** `allow verification ...`: evaluate that permission verification for the principal. */
  verification?: string;
  resource: string;
  placements: Array<"list" | "show">;
  batch?: boolean;
  label: string;
  labelKey?: string;
  condition?: { field: string; operator: "==" | "!="; value: string };
  target:
    | { kind: "dataflow"; dataflow: string; confirm?: string; confirmKey?: string }
    | { kind: "navigate"; path: string; page: "manual"; comment: string; commentKey?: string };
}

export interface DataflowIR {
  name: string;
  label?: string;
  labelKey?: string;
  confirm?: string;
  confirmKey?: string;
  comment?: string;
  commentKey?: string;
  idempotency?: { required: boolean };
  audit?: string;
  roles?: Array<"admin" | "operator">;
  /** `allow permission A, B;`: principal must hold every expanded permission value. */
  permission?: string[];
  /** `allow verification Name;`: evaluate a permission verification against the flow inputs. */
  verification?: string;
  input: Array<{ name: string; type: string; required: boolean; comment?: string; commentKey?: string }>;
  context: Array<{ name: string; entity: string; id: string; required: boolean; comment?: string; commentKey?: string }>;
  steps: Array<{
    name: string;
    order: number;
    comment?: string;
    commentKey?: string;
    actions: Array<
      | { kind: "require"; left: string; operator: "==" | "!=" | ">" | ">=" | "<" | "<="; right: string | number; error: string; errorKey?: string }
      | { kind: "update"; context: string; values: Array<{ field: string; value: string; source?: "input" }> }
      | { kind: "create"; context: string; entity: string; values: Array<{ field: string; value: string; source?: "input" }> }
      | { kind: "delete"; context: string }
      | { kind: "emit"; event: string; payload?: DataflowEmitValue[] }
      | { kind: "call"; adapter: string; payload?: DataflowEmitValue[] }
    >;
  }>;
  result: string;
}

export interface DataflowEmitValue {
  name: string;
  source: "input" | "context" | "literal";
  value: string | number;
  context?: string;
}

export interface QiyEnvironmentVariable {
  name: string;
  secret?: boolean;
  development?: QiyEnvironmentValue;
  production?: QiyEnvironmentValue;
  example?: QiyEnvironmentValue;
}

export type QiyEnvironmentValue = { kind: "value"; value: string } | { kind: "required" | "generate" };

export interface QiyWorkspaceConfig {
  name?: string;
  aliases?: {
    server?: string;
    web?: string;
    deploy?: string;
  };
  packages?: {
    server?: string;
    web?: string;
  };
}

export function parseQiyProject(input: string): QiyProject {
  const source = isQiyV1Source(input) ? translateQiyV1(input) : input;
  let messages: QiyProject["messages"];
  // `&&`, `||`, `!`, `&` are only used by permission declarations and
  // verification expressions; they stay separate tokens so the rest of the
  // grammar is unaffected.
  const pattern = /\s+|\/\/[^\r\n]*|#[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|&&|\|\||==|!=|>=|<=|[a-zA-Z_][a-zA-Z_0-9-]*|-?\d+|[{}();,@.=<>!&|]/g;
  const tokens: string[] = []; 
  let end = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index !== end) throw new Error(`Unexpected Qiy syntax at offset ${end}`);
    if (!/^\s|^\/\/|^#/.test(match[0])) tokens.push(match[0]);
    end += match[0].length;
  }
  if (end !== source.length) throw new Error(`Unexpected Qiy syntax at offset ${end}`);
  tokens.push("<end>");
  let position = 0;
  const peek = () => tokens[position]!;
  const take = () => tokens[position++]!;
  function expect(value: string): void {
    if (take() !== value) throw new Error(`Expected ${value} near token ${position}`);
  }
  function identifier(): string {
    const value = take();
    if (!/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(value)) throw new Error(`Expected identifier near token ${position}`);
    return value;
  }
  function claimIdentifier(): string {
    if (peek().startsWith("\"") || peek().startsWith("'")) return stringLiteral();
    const parts = [identifier()];
    while (peek() === ".") { expect("."); parts.push(identifier()); }
    return parts.join(".");
  }
  function value(): string {
    const token = take();
    if (token.startsWith("\"")) return JSON.parse(token) as string;
    if (token.startsWith("'")) return token.slice(1, -1).replace(/\\([\\'])/g, "$1");
    if (/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(token)) return token;
    throw new Error(`Expected value near token ${position}`);
  }
  function boolean(): boolean {
    const token = identifier();
    if (token === "true") return true;
    if (token === "false") return false;
    throw new Error(`Expected true or false near token ${position}`);
  }
  function booleanAttribute(): boolean {
    if (peek() !== "(") return true;
    expect("(");
    const result = boolean();
    expect(")");
    return result;
  }
  function integer(): number {
    const value = take();
    if (!/^\d+$/.test(value)) throw new Error(`Expected integer near token ${position}`);
    return Number(value);
  }
  function dottedPath(): string {
    const parts = [identifier()];
    while (peek() === ".") { expect("."); parts.push(identifier()); }
    return parts.join(".");
  }
  function stringLiteral(): string {
    const token = take();
    if (token.startsWith('"')) return JSON.parse(token) as string;
    if (token.startsWith("'")) return token.slice(1, -1).replace(/\\([\\'])/g, "$1");
    throw new Error(`Expected a quoted string near token ${position}`);
  }
  function documentation(purpose = "comment"): { comment: string; commentKey?: string } {
    const reference = documentationReference();
    return resolveDocumentation(reference, purpose);
  }
  function documentationReference(): { comment: string; commentKey?: string } {
    if (peek() !== "t") return { comment: stringLiteral() };
    expect("t"); expect("("); const key = stringLiteral(); expect(")");
    return { comment: "", commentKey: key };
  }
  function resolveDocumentation(reference: { comment: string; commentKey?: string }, purpose: string): { comment: string; commentKey?: string } {
    if (!reference.commentKey) return reference;
    const translated = messages?.locales[messages.defaultLocale]?.[reference.commentKey];
    if (translated === undefined) throw new Error(`Missing default locale message for ${purpose}: ${reference.commentKey}`);
    return { comment: translated, commentKey: reference.commentKey };
  }
  /**
   * Permission declarations. One `permission` keyword introduces every form:
   *
   *   permission field ApiGetUserPermission "api:getUser" @label("...");
   *   permission group UserApiPermissionGroup { ApiGetUserPermission, ApiPutUserPermission }
   *   permission group SuperAdminManager = UserApiPermissionGroup & ManagerRole;
   *   permission from database field users.permissions;
   *   permission from claim azure-ad-b2c "roles";
   *   permission verification CanAccessUserApi {
   *     input { field permission Array<String>; }
   *     return input.permission all included in self.permissions;
   *   }
   *
   * `&` is a union operator: a group is always the union of its members.
   */
  function permissionDeclarations(): QiyPermissionModel {
    const fields: QiyPermissionFieldIR[] = [];
    const groups: QiyPermissionGroupIR[] = [];
    const claims: QiyPermissionClaimIR[] = [];
    const verifications: QiyPermissionVerificationIR[] = [];
    let database: QiyPermissionDatabaseIR | undefined;
    const annotations = (context: string): { label?: { comment: string; commentKey?: string }; description?: { comment: string; commentKey?: string } } => {
      const result: { label?: { comment: string; commentKey?: string }; description?: { comment: string; commentKey?: string } } = {};
      while (peek() === "@") {
        expect("@");
        const annotation = identifier();
        expect("(");
        if (annotation === "label") {
          if (result.label) throw new Error(`${context}: duplicate @label annotation`);
          result.label = documentation(`${context} label`);
        } else if (annotation === "comment") {
          if (result.description) throw new Error(`${context}: duplicate @comment annotation`);
          result.description = documentation(`${context} comment`);
        } else throw new Error(`${context}: unsupported annotation @${annotation}`);
        expect(")");
      }
      return result;
    };
    const documentationFields = (annotationsValue: { label?: { comment: string; commentKey?: string }; description?: { comment: string; commentKey?: string } }) => ({
      ...(annotationsValue.label ? { label: annotationsValue.label.comment, ...(annotationsValue.label.commentKey ? { labelKey: annotationsValue.label.commentKey } : {}) } : {}),
      ...(annotationsValue.description ? { comment: annotationsValue.description.comment, ...(annotationsValue.description.commentKey ? { commentKey: annotationsValue.description.commentKey } : {}) } : {}),
    });
    const operand = (): QiyPermissionOperandIR => {
      if (peek() === "self") {
        expect("self"); expect(".");
        const set = identifier();
        if (set !== "permissions" && set !== "groups" && set !== "role") throw new Error(`Permission verification: unsupported self set self.${set}`);
        return { kind: "self", set };
      }
      if (peek() === "input") {
        expect("input"); expect(".");
        return { kind: "input", name: identifier() };
      }
      const token = peek();
      if (token.startsWith("\"") || token.startsWith("'")) return { kind: "literal", value: stringLiteral() };
      throw new Error(`Permission verification: expected self.*, input.* or a quoted string near token ${position}`);
    };
    const comparison = (): QiyPermissionExpressionIR => {
      const left = operand();
      let operator: QiyPermissionComparisonOperator;
      if (peek() === "not") {
        expect("not");
        const mode = identifier();
        if (mode !== "some" && mode !== "all") throw new Error(`Permission verification: expected some or all after not near token ${position}`);
        if (peek() === "included") { expect("included"); expect("in"); }
        else if (peek() === "in") expect("in");
        else throw new Error(`Permission verification: expected included in or in near token ${position}`);
        operator = mode === "some" ? "not-some-in" : "not-all-in";
      } else if (peek() === "some" || peek() === "all") {
        const mode = identifier();
        if (peek() === "included") { expect("included"); expect("in"); }
        else if (peek() === "in") expect("in");
        else throw new Error(`Permission verification: expected included in or in near token ${position}`);
        operator = mode === "some" ? "some-in" : "all-in";
      } else if (peek() === "=") {
        expect("=");
        operator = "equals";
      } else if (peek() === "!=") {
        expect("!=");
        operator = "not-equals";
      } else throw new Error(`Permission verification: expected some/all included in, = or != near token ${position}`);
      return { kind: "comparison", operator, left, right: operand() };
    };
    const unary = (): QiyPermissionExpressionIR => {
      if (peek() === "!") {
        expect("!");
        return { kind: "not", expression: unary() };
      }
      if (peek() === "(") {
        expect("(");
        const inner = logicalOr();
        expect(")");
        return inner;
      }
      return comparison();
    };
    const logicalAnd = (): QiyPermissionExpressionIR => {
      const children = [unary()];
      while (peek() === "&&") { expect("&&"); children.push(unary()); }
      return children.length === 1 ? children[0]! : { kind: "and", children };
    };
    const logicalOr = (): QiyPermissionExpressionIR => {
      const children = [logicalAnd()];
      while (peek() === "||") { expect("||"); children.push(logicalAnd()); }
      return children.length === 1 ? children[0]! : { kind: "or", children };
    };
    while (peek() === "permission") {
      expect("permission");
      const keyword = identifier();
      if (keyword === "field") {
        const name = identifier();
        const fieldValue = stringLiteral();
        if (!fieldValue.trim()) throw new Error(`Permission field ${name}: value cannot be empty`);
        const annotationValues = annotations(`Permission field ${name}`);
        expect(";");
        fields.push({ name, value: fieldValue, ...documentationFields(annotationValues) });
        continue;
      }
      if (keyword === "group") {
        const name = identifier();
        const annotationValues = annotations(`Permission group ${name}`);
        let members: string[];
        let form: "list" | "union";
        if (peek() === "{") {
          form = "list";
          expect("{");
          members = [];
          while (peek() !== "}") {
            members.push(identifier());
            if (peek() !== ",") break;
            expect(",");
          }
          expect("}");
          if (peek() === ";") expect(";");
        } else {
          form = "union";
          expect("=");
          members = [identifier()];
          while (peek() === "&") { expect("&"); members.push(identifier()); }
          expect(";");
        }
        groups.push({ name, members, form, ...documentationFields(annotationValues) });
        continue;
      }
      if (keyword === "from") {
        const source = identifier();
        if (source === "database") {
          expect("field");
          const entity = identifier();
          expect(".");
          const field = identifier();
          expect(";");
          if (database) throw new Error("Permission from database: duplicate database source declaration");
          database = { entity, field };
          continue;
        }
        if (source === "claim") {
          const provider = identifier();
          const claimName = peek().startsWith("\"") || peek().startsWith("'") ? stringLiteral() : identifier();
          expect(";");
          claims.push({ provider, claim: claimName });
          continue;
        }
        throw new Error(`Permission from: expected claim or database near token ${position}`);
      }
      if (keyword === "verification") {
        const name = identifier();
        const annotationValues = annotations(`Permission verification ${name}`);
        const inputs: QiyPermissionVerificationInputIR[] = [];
        let expression: QiyPermissionExpressionIR | undefined;
        expect("{");
        while (peek() !== "}") {
          const section = identifier();
          if (section === "input") {
            expect("{");
            while (peek() !== "}") {
              expect("field");
              const inputName = identifier();
              const typeName = identifier();
              let inputType: QiyPermissionInputType;
              if (typeName === "Text") inputType = "Text";
              else if (typeName === "Array") {
                expect("<");
                const innerType = identifier();
                expect(">");
                if (innerType !== "String") throw new Error(`Permission verification ${name}: Array requires String (Array<String>) near token ${position}`);
                inputType = "Array<String>";
              } else throw new Error(`Permission verification ${name}: unsupported input type ${typeName}`);
              expect(";");
              inputs.push({ name: inputName, type: inputType });
            }
            expect("}");
            continue;
          }
          if (section === "return") {
            if (expression) throw new Error(`Permission verification ${name}: duplicate return statement`);
            expression = logicalOr();
            expect(";");
            continue;
          }
          throw new Error(`Permission verification ${name}: unsupported section ${section}`);
        }
        expect("}");
        if (peek() === ";") expect(";");
        if (!expression) throw new Error(`Permission verification ${name}: requires a return statement`);
        verifications.push({ name, inputs, expression, ...documentationFields(annotationValues) });
        continue;
      }
      throw new Error(`Unsupported permission declaration ${keyword}`);
    }
    return {
      fields,
      groups,
      ...(claims.length ? { claims } : {}),
      ...(database ? { database } : {}),
      verifications,
    };
  }
  function dataflow(): DataflowIR {
    expect("dataflow");
    const name = identifier();
    let label: { comment: string; commentKey?: string } | undefined;
    let confirm: { comment: string; commentKey?: string } | undefined;
    let description: { comment: string; commentKey?: string } | undefined;
    while (peek() === "@") {
      expect("@");
      const annotation = identifier();
      expect("(");
      if (annotation === "label") {
        if (label) throw new Error(`Dataflow ${name}: duplicate @label annotation`);
        label = documentation("dataflow label");
      } else if (annotation === "confirm") {
        if (confirm) throw new Error(`Dataflow ${name}: duplicate @confirm annotation`);
        confirm = documentation("dataflow confirmation");
      } else if (annotation === "comment") {
        if (description) throw new Error(`Dataflow ${name}: duplicate @comment annotation`);
        description = documentation("dataflow comment");
      } else throw new Error(`Dataflow ${name}: unsupported annotation @${annotation}`);
      expect(")");
    }
    const input: DataflowIR["input"] = [];
    const context: DataflowIR["context"] = [];
    const steps: DataflowIR["steps"] = [];
    let result = "";
    let idempotency: DataflowIR["idempotency"];
    let audit: string | undefined;
    let roles: DataflowIR["roles"];
    let permission: DataflowIR["permission"];
    let verification: DataflowIR["verification"];
    let seenInput = false;
    let seenContext = false;
    let seenResult = false;
    const seenSteps = new Set<string>();
    expect("{");
    while (peek() !== "}") {
      const section = identifier();
      if (section === "allow") {
        if (roles || permission || verification) throw new Error(`Dataflow ${name}: duplicate allow declaration`);
        const allowKind = identifier();
        if (allowKind === "roles") {
          roles = [];
          do {
            const role = identifier();
            if (role !== "admin" && role !== "operator") throw new Error(`Dataflow ${name}: unsupported command role ${role}`);
            if (roles.includes(role)) throw new Error(`Dataflow ${name}: duplicate command role ${role}`);
            roles.push(role);
            if (peek() !== ",") break;
            expect(",");
          } while (true);
          expect(";");
          continue;
        }
        if (allowKind === "permission") {
          const required: string[] = [];
          do {
            const reference = identifier();
            if (required.includes(reference)) throw new Error(`Dataflow ${name}: duplicate permission ${reference}`);
            required.push(reference);
            if (peek() !== ",") break;
            expect(",");
          } while (true);
          expect(";");
          permission = required;
          continue;
        }
        if (allowKind === "verification") {
          verification = identifier();
          expect(";");
          continue;
        }
        throw new Error(`Dataflow ${name}: allow must be roles, permission or verification`);
      }
      if (section === "idempotency") {
        if (idempotency) throw new Error(`Dataflow ${name}: duplicate idempotency declaration`);
        const mode = identifier();
        if (mode !== "required") throw new Error(`Dataflow ${name}: idempotency must be required`);
        expect(";");
        idempotency = { required: true };
        continue;
      }
      if (section === "audit") {
        if (audit !== undefined) throw new Error(`Dataflow ${name}: duplicate audit declaration`);
        audit = stringLiteral();
        if (!audit.trim()) throw new Error(`Dataflow ${name}: audit action cannot be empty`);
        expect(";");
        continue;
      }
      if (section === "input") {
        if (seenInput) throw new Error(`Dataflow ${name}: duplicate input block`);
        seenInput = true;
        expect("{");
        while (peek() !== "}") {
          expect("field");
          const fieldName = identifier();
          const type = identifier();
          if (!new Set(["UUID", "Text", "Integer", "Decimal", "Boolean"]).has(type) && !enumNames.has(type)) throw new Error(`Dataflow ${name}: unsupported input type ${type}`);
          let required = false;
          let description: { comment?: string; commentKey?: string } = {};
          while (peek() === "@") {
            expect("@");
            const annotation = identifier();
            if (annotation === "required") required = true;
            else if (annotation === "comment") { expect("("); description = documentation(); expect(")"); }
            else throw new Error(`Dataflow ${name}: unsupported input annotation @${annotation}`);
          }
          expect(";");
          if (input.some((field) => field.name === fieldName)) throw new Error(`Dataflow ${name}: duplicate input field ${fieldName}`);
          input.push({ name: fieldName, type, required, ...description });
        }
        expect("}");
        continue;
      }
      if (section === "context") {
        if (seenContext) throw new Error(`Dataflow ${name}: duplicate context block`);
        seenContext = true;
        expect("{");
        while (peek() !== "}") {
          const binding = identifier(); expect("="); expect("entity");
          const entity = identifier(); expect("by"); const key = identifier();
          const id = dottedPath();
          let required = false;
          let description: { comment?: string; commentKey?: string } = {};
          while (peek() === "@") {
            expect("@");
            const annotation = identifier();
            if (annotation === "required") required = true;
            else if (annotation === "comment") { expect("("); description = documentation(); expect(")"); }
            else throw new Error(`Dataflow ${name}: unsupported context annotation @${annotation}`);
          }
          expect(";");
          if (context.some((item) => item.name === binding)) throw new Error(`Dataflow ${name}: duplicate context binding ${binding}`);
          context.push({ name: binding, entity, id: `${key}:${id}`, required, ...description });
        }
        expect("}");
        continue;
      }
      if (section === "step") {
        const stepName = identifier();
        if (seenSteps.has(stepName)) throw new Error(`Dataflow ${name}: duplicate step ${stepName}`);
        seenSteps.add(stepName);
        let order = steps.length + 1;
        let description: { comment?: string; commentKey?: string } = {};
        while (peek() === "@") {
          expect("@"); const annotation = identifier(); expect("(");
          if (annotation === "order") order = integer();
          else if (annotation === "comment") description = documentation();
          else throw new Error(`Dataflow ${name}: unsupported step annotation @${annotation}`);
          expect(")");
        }
        expect("{");
        const actions: DataflowIR["steps"][number]["actions"] = [];
        while (peek() !== "}") {
          const action = identifier();
          if (action === "require") {
            const left = dottedPath(); const operator = take();
            if (operator !== "==" && operator !== "!=" && operator !== ">" && operator !== ">=" && operator !== "<" && operator !== "<=") throw new Error(`Dataflow ${name}: unsupported require comparison`);
            const right = /^-?\d+$/.test(peek()) ? Number(take()) : stringLiteral();
            if (typeof right === "number" && (!Number.isInteger(right) || right < -2147483648 || right > 2147483647)) throw new Error(`Dataflow ${name}: require integer literal must fit signed 32-bit range`);
            expect("@"); expect("error"); expect("("); const description = documentation("error"); expect(")"); expect(";");
            actions.push({ kind: "require", left, operator, right, error: description.comment, ...(description.commentKey ? { errorKey: description.commentKey } : {}) });
          } else if (action === "update") {
            const binding = identifier(); expect("{");
            const values: Array<{ field: string; value: string; source?: "input" }> = [];
            while (peek() !== "}") {
              const fieldName = identifier(); expect("=");
              if (peek() === "input") {
                expect("input"); expect(".");
                values.push({ field: fieldName, value: identifier(), source: "input" });
              } else {
                values.push({ field: fieldName, value: stringLiteral() });
              }
              expect(";");
            }
            expect("}");
            actions.push({ kind: "update", context: binding, values });
          } else if (action === "create") {
            const binding = identifier(); expect("="); expect("entity"); const entity = identifier(); expect("{");
            const values: Array<{ field: string; value: string; source?: "input" }> = [];
            while (peek() !== "}") {
              const fieldName = identifier(); expect("=");
              if (peek() === "input") {
                expect("input"); expect(".");
                values.push({ field: fieldName, value: identifier(), source: "input" });
              } else {
                values.push({ field: fieldName, value: stringLiteral() });
              }
              expect(";");
            }
            expect("}");
            actions.push({ kind: "create", context: binding, entity, values });
          } else if (action === "delete") {
            actions.push({ kind: "delete", context: identifier() });
            expect(";");
          } else if (action === "emit") {
            const event = stringLiteral();
            if (!event.trim()) throw new Error(`Dataflow ${name}: emitted event cannot be empty`);
            const payload: DataflowEmitValue[] = [];
            if (peek() === "{") {
              expect("{");
              while (peek() !== "}") {
                const payloadName = identifier(); expect("=");
                if (/^-?\d+$/.test(peek())) {
                  const numericValue = Number(take());
                  if (!Number.isSafeInteger(numericValue)) throw new Error(`Dataflow ${name}: emit integer literal must be a safe integer`);
                  payload.push({ name: payloadName, source: "literal", value: numericValue });
                }
                else if (peek().startsWith("\"") || peek().startsWith("'")) payload.push({ name: payloadName, source: "literal", value: stringLiteral() });
                else {
                  const root = identifier(); expect("."); const fieldName = identifier();
                  payload.push(root === "input"
                    ? { name: payloadName, source: "input", value: fieldName }
                    : { name: payloadName, source: "context", context: root, value: fieldName });
                }
                expect(";");
              }
              expect("}");
              if (peek() === ";") expect(";");
            } else expect(";");
            actions.push({ kind: "emit", event, ...(payload.length ? { payload } : {}) });
          } else if (action === "call") {
            const adapter = identifier();
            const payload: DataflowEmitValue[] = [];
            if (peek() === "{") {
              expect("{");
              while (peek() !== "}") {
                const payloadName = identifier(); expect("=");
                if (/^-?\d+$/.test(peek())) {
                  const numericValue = Number(take());
                  if (!Number.isSafeInteger(numericValue)) throw new Error(`Dataflow ${name}: call integer literal must be a safe integer`);
                  payload.push({ name: payloadName, source: "literal", value: numericValue });
                } else if (peek().startsWith("\"") || peek().startsWith("'")) {
                  payload.push({ name: payloadName, source: "literal", value: stringLiteral() });
                } else {
                  const root = identifier(); expect("."); const fieldName = identifier();
                  payload.push(root === "input"
                    ? { name: payloadName, source: "input", value: fieldName }
                    : { name: payloadName, source: "context", context: root, value: fieldName });
                }
                expect(";");
              }
              expect("}");
              if (peek() === ";") expect(";");
            } else expect(";");
            actions.push({ kind: "call", adapter, ...(payload.length ? { payload } : {}) });
          } else throw new Error(`Dataflow ${name}: unsupported action ${action}`);
        }
        expect("}");
        steps.push({ name: stepName, order, ...description, actions });
        continue;
      }
      if (section === "result") {
        if (seenResult) throw new Error(`Dataflow ${name}: duplicate result block`);
        seenResult = true; expect("{"); expect("return"); result = identifier(); expect(";"); expect("}"); continue;
      }
      throw new Error(`Dataflow ${name}: unsupported section ${section}`);
    }
    expect("}");
    if (!seenInput || !seenContext || !seenResult) throw new Error(`Dataflow ${name} requires input, context, and result blocks`);
    if (!steps.length) throw new Error(`Dataflow ${name} requires at least one step`);
    const orders = new Set<number>();
    for (const step of steps) {
      if (!Number.isSafeInteger(step.order) || step.order < 1 || orders.has(step.order)) throw new Error(`Dataflow ${name}: step order must be a unique positive integer`);
      orders.add(step.order);
    }
    steps.sort((left, right) => left.order - right.order);
    return {
      name,
      ...(label && { label: label.comment, ...(label.commentKey && { labelKey: label.commentKey }) }),
      ...(confirm && { confirm: confirm.comment, ...(confirm.commentKey && { confirmKey: confirm.commentKey }) }),
      ...(description && { comment: description.comment, ...(description.commentKey && { commentKey: description.commentKey }) }),
      ...(idempotency && { idempotency }),
      ...(audit !== undefined && { audit }),
      ...(roles && { roles }),
      ...(permission && { permission }),
      ...(verification !== undefined && { verification }),
      input,
      context,
      steps,
      result,
    };
  }
  function action(): QiyAction {
    expect("action");
    const name = identifier();
    let resource: string | undefined;
    let label: string | undefined;
    let labelKey: string | undefined;
    let dataflowName: string | undefined;
    let navigatePath: string | undefined;
    let confirm: string | undefined;
    let confirmKey: string | undefined;
    let manualComment: { comment: string; commentKey?: string } | undefined;
    let roles: QiyAction["roles"];
    let permission: QiyAction["permission"];
    let verification: QiyAction["verification"];
    let condition: QiyAction["condition"];
    let batch = false;
    const placements: QiyAction["placements"] = [];
    expect("{");
    while (peek() !== "}") {
      const property = identifier();
      if (property === "resource") resource = identifier();
      else if (property === "dataflow") dataflowName = identifier();
      else if (property === "navigate") navigatePath = stringLiteral();
      else if (property === "label") { const description = documentation("action label"); label = description.comment; labelKey = description.commentKey; }
      else if (property === "confirm") { const description = documentation("action confirmation"); confirm = description.comment; confirmKey = description.commentKey; }
      else if (property === "batch") {
        if (batch) throw new Error(`Action ${name}: duplicate batch declaration`);
        if (identifier() !== "true") throw new Error(`Action ${name}: batch currently requires true`);
        batch = true;
      }
      else if (property === "when") {
        if (condition) throw new Error(`Action ${name}: duplicate when declaration`);
        const field = identifier();
        const operator = take();
        if (operator !== "==" && operator !== "!=") throw new Error(`Action ${name}: when operator must be == or !=`);
        condition = { field, operator, value: stringLiteral() };
      }
      else if (property === "allow") {
        if (roles || permission || verification) throw new Error(`Action ${name}: duplicate allow declaration`);
        const allowKind = identifier();
        if (allowKind === "roles") {
          roles = [];
          do {
            const role = identifier();
            if (role !== "admin" && role !== "operator" && role !== "viewer") throw new Error(`Action ${name}: unsupported role ${role}`);
            if (roles.includes(role)) throw new Error(`Action ${name}: duplicate role ${role}`);
            roles.push(role);
            if (peek() !== ",") break;
            expect(",");
          } while (true);
        } else if (allowKind === "permission") {
          const required: string[] = [];
          do {
            const reference = identifier();
            if (required.includes(reference)) throw new Error(`Action ${name}: duplicate permission ${reference}`);
            required.push(reference);
            if (peek() !== ",") break;
            expect(",");
          } while (true);
          permission = required;
        } else if (allowKind === "verification") {
          verification = identifier();
        } else throw new Error(`Action ${name}: allow must be roles, permission or verification`);
      }
      else if (property === "placement") {
        do {
          const placement = identifier();
          if (placement !== "list" && placement !== "show") throw new Error(`Action ${name}: placement must be list or show`);
          if (placements.includes(placement)) throw new Error(`Action ${name}: duplicate placement ${placement}`);
          placements.push(placement);
          if (peek() !== ",") break;
          expect(",");
        } while (true);
      } else if (property === "page") {
        if (identifier() !== "manual") throw new Error(`Action ${name}: only page manual is supported`);
        expect("@"); expect("comment"); expect("("); manualComment = documentation(); expect(")");
      } else throw new Error(`Action ${name}: unsupported property ${property}`);
      expect(";");
    }
    expect("}");
    if (!resource) throw new Error(`Action ${name}: resource is required`);
    if (!placements.length) throw new Error(`Action ${name}: at least one placement is required`);
    if (Boolean(dataflowName) === Boolean(navigatePath)) throw new Error(`Action ${name}: exactly one of dataflow or navigate is required`);
    if (dataflowName) {
      if (roles) throw new Error(`Action ${name}: declare roles on the dataflow instead`);
      if (permission) throw new Error(`Action ${name}: declare allow permission on the dataflow instead`);
      if (verification) throw new Error(`Action ${name}: declare allow verification on the dataflow instead`);
      if (manualComment !== undefined) throw new Error(`Action ${name}: page manual is only valid for navigate actions`);
      return { name, resource, placements, ...(batch && { batch }), label: label ?? "", ...(labelKey && { labelKey }), ...(condition && { condition }), target: { kind: "dataflow", dataflow: dataflowName, ...(confirm !== undefined && { confirm }), ...(confirmKey && { confirmKey }) } };
    }
    if (confirm !== undefined) throw new Error(`Action ${name}: confirm is only valid for dataflow actions`);
    if (batch) throw new Error(`Action ${name}: batch is only valid for dataflow actions`);
    if (!label) throw new Error(`Action ${name}: label is required`);
    if (!manualComment?.comment) throw new Error(`Action ${name}: navigate actions require page manual @comment(...)`);
    return { name, ...(roles && { roles }), ...(permission && { permission }), ...(verification !== undefined && { verification }), resource, placements, label, ...(labelKey && { labelKey }), ...(condition && { condition }), target: { kind: "navigate", path: navigatePath!, page: "manual", ...manualComment } };
  }
  function validateCorsOrigins(origins: string[]): string[] {
    for (const origin of origins) {
      if (origin === "*" || origin.includes("*")) throw new Error(`CORS origin must be an exact http(s) origin without a path or wildcard: ${origin}`);
      let parsed: URL;
      try { parsed = new URL(origin); } catch { throw new Error(`Invalid CORS origin ${origin}`); }
      if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== origin || parsed.username || parsed.password) {
        throw new Error(`CORS origin must be an exact http(s) origin without a path or wildcard: ${origin}`);
      }
    }
    return [...new Set(origins)];
  }
  function field(enumNames: Set<string>): FieldIR {
    expect("field");
    const name = identifier();
    const type = identifier();
    if (!["UUID", "Text", "Integer", "Decimal", "Money", "Date", "Time", "DateTime", "File", "Files", "Vector"].includes(type) && !enumNames.has(type)) throw new Error(`Unsupported field type ${type}`);
    const result: FieldIR = { name, type: type as FieldIR["type"] };
    if (enumNames.has(type)) { result.type = "Text"; result.enumName = type; }
    if (peek() === "(") {
      expect("(");
      if (type === "Vector") result.dimension = integer();
      else if (type === "Decimal" || type === "Money") {
        result.precision = integer();
          if (peek() === ",") { expect(","); result.scale = integer(); }
      } else throw new Error(`Field type ${type} has no parameters`);
      expect(")");
    }
    while (peek() === "@") {
      expect("@");
      const attribute = identifier();
      if (attribute === "id") result.primaryKey = booleanAttribute();
      else if (attribute === "nullable") result.nullable = booleanAttribute();
      else if (attribute === "unique") result.unique = booleanAttribute();
      else if (attribute === "label") { expect("("); result.label = value(); expect(")"); }
      else if (attribute === "comment") { expect("("); Object.assign(result, documentation()); expect(")"); }
      else if (attribute === "icon") { expect("("); result.icon = value(); expect(")"); }
      else if (attribute === "visible") { expect("("); result.visible = boolean(); expect(")"); }
      else if (attribute === "listVisible") { expect("("); result.listVisible = boolean(); expect(")"); }
      else if (attribute === "formVisible") { expect("("); result.formVisible = boolean(); expect(")"); }
      else if (attribute === "showVisible") { expect("("); result.showVisible = boolean(); expect(")"); }
      else if (attribute === "sortable") { expect("("); result.sortable = boolean(); expect(")"); }
      else if (attribute === "filterable") { expect("("); result.filterable = boolean(); expect(")"); }
      else if (attribute === "filter") {
        expect("(");
        const modes: FilterMode[] = [];
        do {
          const mode = identifier() as FilterMode;
          if (!["eq", "contains", "startsWith", "endsWith", "gt", "gte", "lt", "lte", "between", "in"].includes(mode)) throw new Error(`Unsupported filter mode ${mode}`);
          if (modes.includes(mode)) throw new Error(`Duplicate filter mode ${mode}`);
          modes.push(mode);
          if (peek() !== ",") break;
          expect(",");
        } while (true);
        expect(")");
        result.filterable = true;
        result.filterModes = modes;
      }
      else if (attribute === "upload") {
        expect("("); const mode = identifier(); expect(")");
        if (type !== "File" && type !== "Files") throw new Error(`Field attribute @upload is only valid for File and Files fields`);
        if (mode !== "binary" && mode !== "base64" && mode !== "both") throw new Error(`File upload mode must be binary, base64 or both; received ${mode}`);
        result.uploadMode = mode;
      }
      else if (attribute === "maxBytes") {
        expect("("); const maxBytes = integer(); expect(")");
        if (type !== "File" && type !== "Files") throw new Error(`Field attribute @maxBytes is only valid for File and Files fields`);
        if (maxBytes < 1 || maxBytes > 100 * 1024 * 1024) throw new Error(`File maxBytes must be between 1 and 104857600`);
        result.maxBytes = maxBytes;
      }
      else if (attribute === "maxFiles") {
        expect("("); const maxFiles = integer(); expect(")");
        if (type !== "File" && type !== "Files") throw new Error(`Field attribute @maxFiles is only valid for File and Files fields`);
        if (type === "File" && maxFiles !== 1) throw new Error(`File fields support maxFiles(1); declare the field as Files for multiple files`);
        if (type === "Files" && (maxFiles < 1 || maxFiles > 20)) throw new Error(`Files maxFiles must be between 1 and 20; received ${maxFiles}`);
        result.maxFiles = maxFiles;
      }
      else if (attribute === "mime") {
        expect("("); const mimeTypes = [...(result.mimeTypes ?? [])];
        do {
          const mime = stringLiteral().toLowerCase();
          if (!/^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/.test(mime)) throw new Error(`Invalid File MIME type ${mime}`);
          if (mimeTypes.includes(mime)) throw new Error(`Duplicate File MIME type ${mime}`);
          mimeTypes.push(mime);
          if (peek() !== ",") break;
          expect(",");
        } while (true);
        expect(")");
        if (type !== "File" && type !== "Files") throw new Error(`Field attribute @mime is only valid for File and Files fields`);
        if (!mimeTypes.length) throw new Error(`File @mime requires at least one MIME type`);
        result.mimeTypes = mimeTypes;
      }
      else if (attribute === "extension") {
        expect("(");
        const extension = value();
        if (extension) result.extension = extension;
        expect(")");
      } else if (attribute === "code") {
        expect("(");
        const template = stringLiteral();
        expect(")");
        if (result.codeTemplate !== undefined) throw new Error(`Field ${name}: duplicate @code annotation`);
        if (result.generatedValue !== undefined) throw new Error(`Field ${name}: @code and @generated cannot be combined`);
        if (type !== "Text" || enumNames.has(type)) throw new Error(`Field ${name}: @code requires a Text field without an enum`);
        const templateErrors = validateCodeTemplate(template);
        if (templateErrors.length) throw new Error(`Field ${name}: ${templateErrors.join("; ")}`);
        result.codeTemplate = template;
      } else if (attribute === "generated") {
        let kind = "uuid";
        if (peek() === "(") {
          expect("(");
          kind = value();
          expect(")");
        }
        if (kind !== "uuid") throw new Error(`Field ${name}: unsupported @generated value ${kind}; only uuid is supported`);
        if (result.generatedValue !== undefined) throw new Error(`Field ${name}: duplicate @generated annotation`);
        if (result.codeTemplate !== undefined) throw new Error(`Field ${name}: @generated and @code cannot be combined`);
        if (type !== "UUID") throw new Error(`Field ${name}: @generated(uuid) requires a UUID field`);
        result.generatedValue = "uuid";
      } else if (attribute === "column") {
        expect("(");
        const columnName = value();
        if (columnName) result.columnName = columnName;
        expect(")");
      } else if (attribute === "dimension" || attribute === "precision" || attribute === "scale") {
        expect("(");
        const numericValue = integer();
        expect(")");
        if (attribute === "dimension" && type === "Vector") result.dimension = numericValue;
        else if (attribute === "precision" && (type === "Decimal" || type === "Money")) result.precision = numericValue;
        else if (attribute === "scale" && (type === "Decimal" || type === "Money")) result.scale = numericValue;
      } else throw new Error(`Unsupported field attribute @${attribute}`);
    }
    expect(";");
    // A JSON array of storage keys has no meaningful sort or filter semantics.
    if (result.type === "Files") {
      result.sortable ??= false;
      result.filterable ??= false;
    }
    return result;
  }
  function index(): IndexIR {
    expect("index");
    const name = identifier();
    const method = identifier();
    if (!["btree", "hnsw", "ivfflat"].includes(method)) throw new Error(`Unsupported index method ${method}`);
    expect("(");
    const columns: IndexColumnIR[] = [];
    do {
      const fieldName = identifier();
      const opclass = peek() !== "," && peek() !== ")" ? (peek().startsWith("\"") || peek().startsWith("'") ? value() : identifier()) : undefined;
      columns.push({ fieldName, ...(opclass && { opclass }) });
      if (peek() !== ",") break;
      expect(",");
      if (peek() === ")") break;
    } while (true);
    expect(")");
    const result: IndexIR = { name, method: method as IndexIR["method"], columns };
    while (peek() === "@") {
      expect("@");
      const attribute = identifier();
      if (attribute === "unique") result.unique = booleanAttribute();
      else if (attribute === "concurrently") result.concurrently = booleanAttribute();
      else if (attribute === "comment") { expect("("); Object.assign(result, documentation()); expect(")"); }
      else throw new Error(`Unsupported index attribute @${attribute}`);
    }
    expect(";");
    return result;
  }
  function roleList(context: string): QiyRole[] {
    const roles: QiyRole[] = [];
    do {
      const role = identifier();
      if (role !== "admin" && role !== "operator" && role !== "viewer") throw new Error(`${context}: unsupported role ${role}`);
      if (roles.includes(role)) throw new Error(`${context}: duplicate role ${role}`);
      roles.push(role);
      if (peek() !== ",") break;
      expect(",");
    } while (true);
    return roles;
  }
  function resourceRestriction(): QiyResourceRestriction {
    expect("restrict");
    const resource = identifier();
    const restriction: QiyResourceRestriction = { resource };
    const rows: QiyRowPredicate[] = [];
    const groups: QiyRowPredicate[][] = [];
    const expressions: QiyPolicyExpression[] = [];
    const masks: QiyFieldMask[] = [];
    expect("{");
    /** Atom: a claim/value predicate, or a cross-field comparison (`amount > field cost`). */
    const expressionAtom = (): QiyPolicyExpression => {
      if (peek() === "scope") {
        expect("scope");
        return { kind: "scope" };
      }
      const field = identifier();
      const comparison = (): QiyCrossOperator | "in" | "notIn" | undefined => {
        if (peek() === "==") { expect("=="); return "=="; }
        if (peek() === "!=") { expect("!="); return "!="; }
        if (peek() === "<") { expect("<"); return "<"; }
        if (peek() === "<=") { expect("<="); return "<="; }
        if (peek() === ">") { expect(">"); return ">"; }
        if (peek() === ">=") { expect(">="); return ">="; }
        if (peek() === "in") { expect("in"); return "in"; }
        if (peek() === "notIn") { expect("notIn"); return "notIn"; }
        return undefined;
      };
      if (peek() === "claim") {
        expect("claim");
        return { kind: "predicate", predicate: { field, source: "claim", operator: "==", claim: claimIdentifier(), missing: "deny" } };
      }
      const operator = comparison();
      if (!operator) throw new Error(`Restrict ${resource}: row condition on ${field} requires claim, ==, !=, <, <=, >, >=, in or notIn`);
      const membership = operator === "in" || operator === "notIn";
      if (!membership && peek() === "field") {
        expect("field");
        return { kind: "cross", field, operator: operator as QiyCrossOperator, otherField: identifier() };
      }
      if (!membership && (operator === "<" || operator === "<=" || operator === ">" || operator === ">=")) {
        throw new Error(`Restrict ${resource}: ${operator} on ${field} must compare two fields (use ==/!=/in/notIn for literals)`);
      }
      const values: string[] = [];
      do {
        const literal = stringLiteral();
        if (values.includes(literal)) throw new Error(`Restrict ${resource}: duplicate row value ${literal}`);
        values.push(literal);
        if (peek() !== ",") break;
        expect(",");
      } while (true);
      if (!values.length) throw new Error(`Restrict ${resource}: row condition on ${field} requires at least one value`);
      if (!membership && values.length !== 1) throw new Error(`Restrict ${resource}: ${operator} on ${field} requires exactly one value`);
      return { kind: "predicate", predicate: { field, source: "values", operator: membership ? operator : operator as "==" | "!=", values, missing: "hide" } };
    };
    const expressionUnary = (): QiyPolicyExpression => {
      if (peek() === "not") {
        expect("not");
        return { kind: "not", expression: expressionUnary() };
      }
      if (peek() === "(") {
        expect("(");
        const inner = expressionOr();
        expect(")");
        return inner;
      }
      return expressionAtom();
    };
    const expressionAnd = (): QiyPolicyExpression => {
      const children = [expressionUnary()];
      while (peek() === "and") {
        expect("and");
        children.push(expressionUnary());
      }
      return children.length === 1 ? children[0]! : { kind: "and", children };
    };
    const expressionOr = (): QiyPolicyExpression => {
      const children = [expressionAnd()];
      while (peek() === "or") {
        expect("or");
        children.push(expressionAnd());
      }
      return children.length === 1 ? children[0]! : { kind: "or", children };
    };
    const whenExpression = expressionOr;
    while (peek() !== "}") {
      const section = identifier();
      if (section === "allow") {
        if (restriction.roles) throw new Error(`Restrict ${resource}: duplicate allow roles declaration`);
        expect("roles");
        const roles = roleList(`Restrict ${resource}`);
        if (!roles.length) throw new Error(`Restrict ${resource}: roles requires at least one role`);
        expect(";");
        restriction.roles = roles;
        continue;
      }
      if (section === "when") {
        // `when` accepts a plain predicate, a flat OR group, or a general boolean
        // expression with `and`/`or`/`not`, parentheses and cross-field comparisons.
        const expression = whenExpression();
        expect(";");
        if (expression.kind === "predicate") {
          const row = expression.predicate;
          if (rows.some((existing) => existing.field === row.field)) throw new Error(`Restrict ${resource}: duplicate row condition on ${row.field}`);
          rows.push(row);
          continue;
        }
        if (expression.kind === "or" && expression.children.every((child) => child.kind === "predicate")) {
          const group = expression.children.map((child) => (child as { kind: "predicate"; predicate: QiyRowPredicate }).predicate);
          if (group.length < 2) throw new Error(`Restrict ${resource}: a when group needs at least two conditions`);
          for (const row of group) {
            if (rows.some((existing) => existing.field === row.field)) throw new Error(`Restrict ${resource}: duplicate row condition on ${row.field}`);
          }
          groups.push(group);
          continue;
        }
        expressions.push(expression);
        continue;
      }
      if (section === "mask") {
        const field = identifier();
        const mask: QiyFieldMask = { field, mode: "omit" };
        while (peek() === "roles" || peek() === "claim" || peek() === "mode" || peek() === "replacement") {
          const option = identifier();
          if (option === "roles") {
            if (mask.roles) throw new Error(`Restrict ${resource}: duplicate mask roles for ${field}`);
            const roles = roleList(`Restrict ${resource} mask ${field}`);
            if (!roles.length) throw new Error(`Restrict ${resource}: mask roles for ${field} requires at least one role`);
            mask.roles = roles;
            continue;
          }
          if (option === "claim") {
            if (mask.claim) throw new Error(`Restrict ${resource}: duplicate mask claim for ${field}`);
            const state = identifier();
            if (state !== "present" && state !== "absent") throw new Error(`Restrict ${resource}: mask claim for ${field} must state present or absent`);
            const claim = claimIdentifier();
            mask.claim = claim;
            mask.claimState = state;
            continue;
          }
          if (option === "mode") {
            const mode = identifier();
            if (mode !== "omit" && mode !== "null" && mode !== "redact") throw new Error(`Restrict ${resource}: unsupported mask mode ${mode}`);
            mask.mode = mode;
            continue;
          }
          if (mask.replacement !== undefined) throw new Error(`Restrict ${resource}: duplicate mask replacement for ${field}`);
          mask.replacement = stringLiteral();
        }
        expect(";");
        if (mask.replacement !== undefined && mask.mode !== "redact") throw new Error(`Restrict ${resource}: mask replacement for ${field} requires mode redact`);
        if (mask.mode === "redact" && mask.replacement === undefined) throw new Error(`Restrict ${resource}: mask mode redact for ${field} requires a replacement string`);
        if (masks.some((candidate) => candidate.field === field)) throw new Error(`Restrict ${resource}: duplicate mask for ${field}`);
        masks.push(mask);
        continue;
      }
      throw new Error(`Restrict ${resource}: unsupported setting ${section}`);
    }
    expect("}");
    if (rows.length) restriction.rows = rows;
    if (groups.length) restriction.groups = groups;
    if (expressions.length) restriction.expressions = expressions;
    if (masks.length) restriction.masks = masks;
    return restriction;
  }
  function entity(enumNames: Set<string>): EntityIR {
    expect("entity");
    const name = identifier();
    let tableName = name;
    if (peek() === "table") { expect("table"); tableName = identifier(); }
    let label: string | undefined;
    let icon: string | undefined;
    let singular: string | undefined;
    let plural: string | undefined;
    let display: string | undefined;
    let tableDisplay: string | undefined;
    let relationDetail: string | undefined;
    let description: { comment?: string; commentKey?: string } = {};
    while (peek() === "@") {
      expect("@");
      const attribute = identifier();
      expect("(");
      if (attribute === "label") label = value();
      else if (attribute === "icon") icon = value();
      else if (attribute === "comment") description = documentation();
      else if (attribute === "singular" || attribute === "plural" || attribute === "display" || attribute === "tableDisplay" || attribute === "relationDetail") {
        const annotationValue = value();
        if (attribute === "singular") { if (singular !== undefined) throw new Error(`Entity ${name}: duplicate @singular annotation`); singular = annotationValue; }
        else if (attribute === "plural") { if (plural !== undefined) throw new Error(`Entity ${name}: duplicate @plural annotation`); plural = annotationValue; }
        else if (attribute === "display") { if (display !== undefined) throw new Error(`Entity ${name}: duplicate @display annotation`); display = annotationValue; }
        else if (attribute === "tableDisplay") { if (tableDisplay !== undefined) throw new Error(`Entity ${name}: duplicate @tableDisplay annotation`); tableDisplay = annotationValue; }
        else { if (relationDetail !== undefined) throw new Error(`Entity ${name}: duplicate @relationDetail annotation`); relationDetail = annotationValue; }
      }
      else throw new Error(`Unsupported entity attribute @${attribute}`);
      expect(")");
    }
    expect("{");
    const fields: FieldIR[] = [];
    const indexes: IndexIR[] = [];
    while (peek() !== "}") {
      if (peek() === "field") fields.push(field(enumNames));
      else if (peek() === "index") indexes.push(index());
      else throw new Error(`Expected field or index near token ${position}`);
    }
    expect("}");
    const result: EntityIR = {
      name, tableName, fields, indexes,
      ...(label && { label }), ...(icon && { icon }),
      ...(singular !== undefined && { singular }), ...(plural !== undefined && { plural }),
      ...(display !== undefined && { display }), ...(tableDisplay !== undefined && { tableDisplay }), ...(relationDetail !== undefined && { relationDetail }),
      ...description,
    };
    // Grammar and field references fail here; relation-aware checks run in validateDatabaseIR.
    const displayErrors = validateEntityDisplayTemplates(result);
    if (displayErrors.length) throw new Error(displayErrors.join("\n"));
    return result;
  }
  function relation(): RelationIR {
    expect("relation");
    const name = identifier();
    const fromEntity = identifier();
    const fromField = identifier();
    const toEntity = identifier();
    const toField = identifier();
    const cardinality = identifier();
    if (cardinality !== "one" && cardinality !== "many") throw new Error(`Unsupported relation cardinality ${cardinality}`);
    let onDelete: RelationIR["onDelete"];
    let description: { comment?: string; commentKey?: string } = {};
    while (peek() === "@") {
      expect("@");
      const attribute = identifier();
      if (attribute === "comment") { expect("("); description = documentation(); expect(")"); continue; }
      if (attribute !== "onDelete") throw new Error(`Unsupported relation attribute @${attribute}`);
      expect("(");
      const action = value();
      if (!action) { expect(")"); continue; }
      if (action !== "restrict" && action !== "cascade" && action !== "setNull") throw new Error(`Unsupported onDelete action ${action}`);
      onDelete = action;
      expect(")");
    }
    expect(";");
    return { name, fromEntity, fromField, toEntity, toField, cardinality, ...(onDelete && { onDelete }), ...description };
  }
  function menuGroup(): NonNullable<QiyProject["menuGroups"]>[number] {
    expect("group");
    const name = identifier();
    let label = name;
    let icon: string | undefined;
    let parent: string | undefined;
    let description: { comment: string; commentKey?: string } | undefined;
    while (peek() === "@") {
      expect("@");
      const attribute = identifier();
      expect("(");
      if (attribute === "label") label = value();
      else if (attribute === "icon") icon = value();
      else if (attribute === "parent") parent = value();
      else if (attribute === "comment") {
        if (description) throw new Error(`Menu group ${name}: duplicate @comment annotation`);
        description = documentation("menu group comment");
      }
      else throw new Error(`Unsupported menu group attribute @${attribute}`);
      expect(")");
    }
    expect("{");
    const resources: string[] = [];
    while (peek() !== "}") { expect("resource"); resources.push(identifier()); expect(";"); }
    expect("}");
    return { name, label, ...(icon && { icon }), ...(parent && { parent }), ...(description && description), resources };
  }
  function dashboardMetric(): NonNullable<QiyProject["dashboardMetrics"]>[number] {
    expect("metric");
    const name = identifier();
    const resource = identifier();
    let label = name;
    let icon: string | undefined;
    let span: 8 | 12 | 24 = 8;
    let type: "count" | "distribution" | "trend" | "aggregate" = "count";
    let groupBy: string | undefined;
    let days: number | undefined;
    let field: string | undefined;
    let agg: "sum" | "avg" | "min" | "max" | undefined;
    let description: { comment: string; commentKey?: string } | undefined;
    while (peek() === "@") {
      expect("@");
      const attribute = identifier();
      expect("(");
      if (attribute === "label") label = value();
      else if (attribute === "icon") icon = value();
      else if (attribute === "span") {
        const width = integer();
        if (width !== 8 && width !== 12 && width !== 24) throw new Error(`Dashboard metric ${name}: span must be 8, 12 or 24`);
        span = width;
      } else if (attribute === "type") {
        const metricType = value();
        if (metricType !== "" && metricType !== "count" && metricType !== "distribution" && metricType !== "trend" && metricType !== "aggregate") throw new Error(`Dashboard metric ${name}: type must be count, distribution, trend or aggregate`);
        type = metricType === "" ? "count" : metricType;
      } else if (attribute === "groupBy") groupBy = value() || undefined;
      else if (attribute === "field") field = value() || undefined;
      else if (attribute === "agg") {
        const operator = value();
        if (operator !== "sum" && operator !== "avg" && operator !== "min" && operator !== "max") throw new Error(`Dashboard metric ${name}: agg must be sum, avg, min or max`);
        agg = operator;
      } else if (attribute === "days") { const metricDays = integer(); days = metricDays > 0 ? metricDays : undefined; }
      else if (attribute === "comment") {
        if (description) throw new Error(`Dashboard metric ${name}: duplicate @comment annotation`);
        description = documentation("dashboard metric comment");
      }
      else throw new Error(`Unsupported dashboard metric attribute @${attribute}`);
      expect(")");
    }
    expect(";");
    return { name, resource, label, span, ...(icon && { icon }), ...(description && description), ...(type !== "count" && { type }), ...(groupBy && { groupBy }), ...(days !== undefined && { days }), ...(field && { field }), ...(agg && { agg }) };
  }
  /**
   * Chart DSL (multi-view declarations + responsive panel grid):
   *
   *   chart const UserCount {
   *     icon = "TeamOutlined";
   *     title = "用户总数";
   *     data = count users;
   *   }
   *   chart pie UserStatusCount {
   *     title = "用户状态分布";
   *     data = count users group by role;
   *     labels = role;
   *   }
   *   chart bar UserStatusCount { ... }             // second view of the same chart
   *   chart panels ChartsPanel1 {
   *     grid 24 24;
   *     UserCount {
   *       larger 0 0 4 2;
   *       medium 0 0 12 3;
   *       small 0 0 24 4;
   *     }
   *   }
   *
   * Declarations sharing a chart name but using different kinds are the views of
   * one chart. Assignments are `key = value;` (`;` may be omitted before `}`).
   */
  function chartPropertySemicolon(context: string): void {
    if (peek() === ";") { expect(";"); return; }
    if (peek() === "}") return;
    throw new Error(`${context}: expected ; after the property value but found ${peek()}`);
  }
  function chartKindToken(token: string): QiyChartViewKind | undefined {
    return (qiyChartKinds as ReadonlyArray<string>).includes(token) ? token as QiyChartViewKind : undefined;
  }
  function chartData(chartName: string, kind: QiyChartViewKind): QiyChartData {
    const prefix = `Chart ${chartName} ${kind} view`;
    const operation = identifier();
    if (operation === "count") {
      const entity = identifier();
      if (peek() === "group") {
        expect("group"); expect("by");
        return { operation: "count", entity, groupBy: identifier() };
      }
      return { operation: "count", entity };
    }
    if (operation === "sum" || operation === "avg" || operation === "min" || operation === "max") {
      const entity = identifier();
      expect(".");
      const field = identifier();
      if (peek() === "group") {
        expect("group"); expect("by");
        return { operation, entity, field, groupBy: identifier() };
      }
      return { operation, entity, field };
    }
    if (operation === "trend") {
      const entity = identifier();
      expect(".");
      const field = identifier();
      if (peek() !== "days") throw new Error(`${prefix}: trend data requires "days <1..365>"`);
      expect("days");
      const days = integer();
      if (days < 1 || days > 365) throw new Error(`${prefix}: days must be between 1 and 365`);
      return { operation: "trend", entity, field, days };
    }
    if (operation === "list") {
      const entity = identifier();
      if (peek() !== "columns") throw new Error(`${prefix}: list data requires "columns <field>, ..."`);
      expect("columns");
      const columns = [identifier()];
      while (peek() === ",") { expect(","); columns.push(identifier()); }
      return { operation: "list", entity, columns };
    }
    throw new Error(`${prefix}: unknown data operation ${operation}; expected count, sum, avg, min, max, trend or list`);
  }
  function chartLabels(chartName: string, kind: QiyChartViewKind): QiyChartLabels {
    const prefix = `Chart ${chartName} ${kind} view`;
    if (peek() !== "{") return { field: identifier() };
    expect("{");
    const values: QiyChartLabelValue[] = [];
    const seen = new Set<string>();
    while (peek() !== "}") {
      const raw = peek().startsWith("\"") || peek().startsWith("'") ? stringLiteral() : identifier();
      if (seen.has(raw)) throw new Error(`${prefix}: duplicate labels mapping ${raw}`);
      seen.add(raw);
      values.push({ value: raw, label: stringLiteral() });
      expect(";");
    }
    expect("}");
    if (values.length === 0) throw new Error(`${prefix}: labels mapping needs at least one entry`);
    return { values };
  }
  function chartView(chartName: string, kind: QiyChartViewKind): QiyChartView {
    const prefix = `Chart ${chartName} ${kind} view`;
    const view: QiyChartView = { kind, data: { operation: "count", entity: "" } };
    expect("{");
    const seenProps = new Set<string>();
    let hasData = false;
    while (peek() !== "}") {
      const property = identifier();
      if (seenProps.has(property)) throw new Error(`${prefix}: duplicate ${property} property`);
      seenProps.add(property);
      // `labels { value "Text"; }` is the mapping form and omits `=`;
      // `labels = role;` / `labels = { ... };` are also accepted.
      if (property === "labels") {
        if (peek() !== "{") expect("=");
        view.labels = chartLabels(chartName, kind);
      } else {
        expect("=");
        if (property === "icon") view.icon = value();
        else if (property === "title") view.title = value();
        else if (property === "data") { view.data = chartData(chartName, kind); hasData = true; }
        else throw new Error(`${prefix}: unknown property ${property}; expected icon, title, data or labels`);
      }
      chartPropertySemicolon(`${prefix} property ${property}`);
    }
    expect("}");
    if (!hasData) throw new Error(`${prefix}: missing data property`);
    return view;
  }
  /** One `chart [kind] <Name> { ... }` declaration; same names are grouped into one chart. */
  function chartDeclaration(): { name: string; view: QiyChartView } {
    let kind: QiyChartViewKind = "const";
    const declaredKind = chartKindToken(peek());
    if (declaredKind) { expect(peek()); kind = declaredKind; }
    const name = identifier();
    if (name === "panels") throw new Error("Chart name panels is reserved for chart panels blocks");
    if (name === "title" || name === "grid") throw new Error(`Chart name ${name} is reserved inside chart panels blocks`);
    return { name, view: chartView(name, kind) };
  }
  function chartPlacement(panelName: string, chartName: string, seen: Set<string>): QiyChartPlacement {
    const variantToken = identifier();
    if (!(qiyChartVariants as ReadonlyArray<string>).includes(variantToken)) throw new Error(`Chart panel ${panelName} chart ${chartName}: unknown variant ${variantToken}; expected one of ${qiyChartVariants.join(", ")}`);
    const variant = variantToken as QiyChartVariant;
    if (seen.has(variant)) throw new Error(`Chart panel ${panelName} chart ${chartName}: duplicate ${variant} placement`);
    seen.add(variant);
    const x = integer();
    const y = integer();
    const w = integer();
    const h = integer();
    expect(";");
    return { variant, x, y, w, h };
  }
  function chartPanel(): QiyChartPanel {
    const name = identifier();
    expect("{");
    const panel: QiyChartPanel = { name, grid: { columns: 0, rows: 0 }, charts: [] };
    let hasGrid = false;
    const seenCharts = new Set<string>();
    while (peek() !== "}") {
      if (peek() === "title") {
        expect("title"); expect("=");
        panel.title = value();
        chartPropertySemicolon(`Chart panel ${name} title`);
        continue;
      }
      if (peek() === "grid") {
        expect("grid");
        if (hasGrid) throw new Error(`Chart panel ${name}: duplicate grid property`);
        hasGrid = true;
        panel.grid = { columns: integer(), rows: integer() };
        expect(";");
        continue;
      }
      const chartName = identifier();
      if (seenCharts.has(chartName)) throw new Error(`Chart panel ${name}: duplicate chart ${chartName}`);
      seenCharts.add(chartName);
      expect("{");
      const placements: QiyChartPlacement[] = [];
      const seenVariants = new Set<string>();
      while (peek() !== "}") placements.push(chartPlacement(name, chartName, seenVariants));
      expect("}");
      if (placements.length === 0) throw new Error(`Chart panel ${name}: chart ${chartName} needs at least one placement`);
      panel.charts.push({ name: chartName, placements });
    }
    expect("}");
    if (!hasGrid) throw new Error(`Chart panel ${name}: missing grid property`);
    if (panel.charts.length === 0) throw new Error(`Chart panel ${name}: needs at least one chart`);
    return panel;
  }
  /** Groups declarations by chart name (views) and checks panel references. */
  function collectChartDeclarations(declarations: Array<{ name: string; view: QiyChartView }>, panels: QiyChartPanel[]): QiyChart[] {
    const byName = new Map<string, QiyChart>();
    const panelNames = new Set(panels.map((panel) => panel.name));
    for (const declaration of declarations) {
      if (panelNames.has(declaration.name)) throw new Error(`Chart ${declaration.name}: name already used by a chart panel`);
      const chart = byName.get(declaration.name) ?? { name: declaration.name, views: [] };
      if (chart.views.some((view) => view.kind === declaration.view.kind)) throw new Error(`Chart ${declaration.name}: duplicate ${declaration.view.kind} view`);
      chart.views.push(declaration.view);
      chart.title ??= declaration.view.title;
      chart.icon ??= declaration.view.icon;
      byName.set(declaration.name, chart);
    }
    const chartNames = new Set(byName.keys());
    for (const panel of panels) for (const chart of panel.charts) {
      if (!chartNames.has(chart.name)) throw new Error(`Chart panel ${panel.name}: unknown chart ${chart.name}`);
    }
    return [...byName.values()];
  }
  /** Validates chart data/labels and panel grids/placements against the parsed database. */
  function validateCharts(charts: QiyChart[], chartPanels: QiyChartPanel[]): void {
    const bySource = new Map<string, EntityIR>();
    for (const entity of entities) {
      bySource.set(entity.name, entity);
      bySource.set(entity.tableName, entity);
    }
    const usedNames = new Set<string>();
    for (const chart of charts) {
      if (usedNames.has(chart.name)) throw new Error(`Duplicate chart or panel name ${chart.name}`);
      usedNames.add(chart.name);
    }
    for (const panel of chartPanels) {
      if (usedNames.has(panel.name)) throw new Error(`Duplicate chart or panel name ${panel.name}`);
      usedNames.add(panel.name);
      if (panel.grid.columns < 1 || panel.grid.columns > 24) throw new Error(`Chart panel ${panel.name}: grid columns must be between 1 and 24`);
      if (panel.grid.rows < 1 || panel.grid.rows > 200) throw new Error(`Chart panel ${panel.name}: grid rows must be between 1 and 200`);
      for (const chart of panel.charts) for (const placement of chart.placements) {
        if (placement.x < 0 || placement.y < 0) throw new Error(`Chart panel ${panel.name}: placement origin must be >= 0`);
        if (placement.w < 1 || placement.h < 1) throw new Error(`Chart panel ${panel.name}: placement size must be >= 1`);
        if (placement.x + placement.w > panel.grid.columns) throw new Error(`Chart panel ${panel.name}: placement ${placement.variant} exceeds ${panel.grid.columns} grid columns`);
        if (placement.y + placement.h > panel.grid.rows) throw new Error(`Chart panel ${panel.name}: placement ${placement.variant} exceeds ${panel.grid.rows} grid rows`);
      }
    }
    for (const chart of charts) {
      for (const view of chart.views) {
        const data = view.data;
        const target = bySource.get(data.entity);
        if (!target) throw new Error(`Chart ${chart.name} ${view.kind} view: unknown entity ${data.entity}`);
        data.entity = target.tableName; // generated routes and data-provider calls use table names
        const prefix = `Chart ${chart.name} ${view.kind} view`;
        const fieldOf = (name: string): FieldIR => {
          const field = target.fields.find((candidate) => candidate.name === name);
          if (!field) throw new Error(`${prefix}: unknown field ${name}`);
          return field;
        };
        if (view.kind === "const") {
          if (data.operation === "count") {
            if (data.groupBy) throw new Error(`${prefix}: count data cannot group by (use pie or bar)`);
          } else if (data.operation === "sum" || data.operation === "avg" || data.operation === "min" || data.operation === "max") {
            if (data.groupBy) throw new Error(`${prefix}: ${data.operation} ... group by is not supported`);
            const field = fieldOf(data.field!);
            if (field.type !== "Integer" && field.type !== "Decimal" && field.type !== "Money") throw new Error(`${prefix}: aggregate field ${data.field} must be Integer, Decimal or Money`);
          } else {
            throw new Error(`${prefix}: const views require count or sum/avg/min/max data`);
          }
        } else if (view.kind === "pie" || view.kind === "bar") {
          if (data.operation !== "count" || !data.groupBy) throw new Error(`${prefix}: pie/bar views require "count <entity> group by <enum field>" data`);
          const grouped = fieldOf(data.groupBy);
          if (!grouped.enumName) throw new Error(`${prefix}: group by field ${data.groupBy} must be an enum field`);
          if (view.labels?.field) {
            const labeled = fieldOf(view.labels.field);
            if (!labeled.enumName) throw new Error(`${prefix}: labels field ${view.labels.field} must be an enum field`);
          }
        } else if (view.kind === "line") {
          if (data.operation !== "trend") throw new Error(`${prefix}: line views require "trend <entity>.<DateTime field> days <n>" data`);
          const dateField = fieldOf(data.field!);
          if (dateField.type !== "DateTime") throw new Error(`${prefix}: trend field ${data.field} must be a DateTime field`);
        } else {
          if (data.operation !== "list") throw new Error(`${prefix}: table views require "list <entity> columns ..." data`);
          for (const column of data.columns ?? []) {
            const field = fieldOf(column);
            if (field.type === "Vector") throw new Error(`${prefix}: cannot render a Vector column (${column})`);
          }
        }
      }
    }
  }
function enumeration(): import("./database-ir").EnumIR {
    expect("enum");
    const name = identifier();
    let description: { comment: string; commentKey?: string } | undefined;
    while (peek() === "@") {
      expect("@");
      const annotation = identifier();
      expect("(");
      if (annotation !== "comment") throw new Error(`Enum ${name}: unsupported annotation @${annotation}`);
      if (description) throw new Error(`Enum ${name}: duplicate @comment annotation`);
      description = documentation("enum comment");
      expect(")");
    }
    expect("{");
    const values: import("./database-ir").EnumValueIR[] = [];
    while (peek() !== "}") {
      expect("value");
      const valueName = identifier();
      const item: import("./database-ir").EnumValueIR = { name: valueName };
      while (peek() === "label" || peek() === "color" || peek() === "icon" || peek() === "@") {
        if (peek() === "@") {
          expect("@");
          const annotation = identifier();
          expect("(");
          if (annotation !== "comment") throw new Error(`Enum ${name}.${valueName}: unsupported annotation @${annotation}`);
          if (item.comment !== undefined) throw new Error(`Enum ${name}.${valueName}: duplicate @comment annotation`);
          Object.assign(item, documentation("enum value comment"));
          expect(")");
          continue;
        }
        const attribute = identifier();
        const valueKey = value();
        if (attribute === "label" && valueKey !== "") item.label = valueKey;
        else if (attribute === "color" && valueKey !== "") item.color = valueKey;
        else if (attribute === "icon" && valueKey !== "") item.icon = valueKey;
      }
      expect(";");
      values.push(item);
    }
    expect("}");
    return { name, ...(description && description), values };
  }
  expect("qiy");
  expect("v0");
  expect(";");
  expect("application");
  const name = identifier();
  let applicationDescription: { comment: string; commentKey?: string } | undefined;
  while (peek() === "@") {
    expect("@");
    const annotation = identifier();
    expect("(");
    if (annotation !== "comment") throw new Error(`Application ${name}: unsupported annotation @${annotation}`);
    if (applicationDescription) throw new Error(`Application ${name}: duplicate @comment annotation`);
    applicationDescription = documentationReference();
    expect(")");
  }
  const packageName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!/^[a-z][a-z0-9-]*$/.test(packageName)) throw new Error("Qiy project name must normalize to a lowercase package name");
  expect("{");
  expect("database");
  const dialect = identifier();
  if (!["postgresql", "mysql", "sqlite"].includes(dialect)) throw new Error(`Unsupported database dialect ${dialect}`);
  let databaseDescription: { comment: string; commentKey?: string } | undefined;
  while (peek() === "@") {
    expect("@");
    const annotation = identifier();
    expect("(");
    if (annotation !== "comment") throw new Error(`Database ${dialect}: unsupported annotation @${annotation}`);
    if (databaseDescription) throw new Error(`Database ${dialect}: duplicate @comment annotation`);
    databaseDescription = documentationReference();
    expect(")");
  }
  expect("{");
  const extensions: string[] = [];
  while (peek() !== "}") { expect("extension"); extensions.push(identifier()); expect(";"); }
  expect("}");
  let mode: QiyProject["mode"];
  if (peek() === "mode") {
    expect("mode");
    const configuredMode = identifier();
    if (configuredMode !== "standalone" && configuredMode !== "integration") throw new Error(`Unsupported application mode ${configuredMode}`);
    mode = configuredMode;
    expect(";");
  }
  let integration: QiyProject["integration"];
  if (peek() === "integration") {
    expect("integration"); expect("{");
    let apiBase: string | undefined;
    let authTransport: "none" | "bearer" | "cookie" | "portal" = "none";
    let csrfCookie: string | undefined;
    let csrfHeader: string | undefined;
    let response: NonNullable<QiyIntegrationConfig["response"]> | undefined;
    let pagination: NonNullable<QiyIntegrationConfig["pagination"]> | undefined;
    let tenant: NonNullable<QiyIntegrationConfig["tenant"]> | undefined;
    const seen = new Set<string>();
    while (peek() !== "}") {
      const key = identifier();
      if (seen.has(key)) throw new Error(`Duplicate integration setting ${key}`);
      seen.add(key);
      if (key === "apiBase") {
        apiBase = value();
        if (!apiBase.startsWith("/") && !/^https?:\/\//.test(apiBase)) throw new Error("integration apiBase must be an absolute http(s) URL or a path starting with /");
      } else if (key === "auth") {
        const transport = identifier();
        if (transport !== "none" && transport !== "bearer" && transport !== "cookie" && transport !== "portal") throw new Error(`Unsupported integration auth transport ${transport}`);
        authTransport = transport;
        if (peek() === "{") {
          if (transport !== "cookie") throw new Error(`Integration auth options are only supported for cookie transport`);
          expect("{");
          const authOptions = new Set<string>();
          while (peek() !== "}") {
            const option = identifier();
            if (authOptions.has(option)) throw new Error(`Duplicate integration auth setting ${option}`);
            authOptions.add(option);
            const optionValue = value();
            if (option === "csrfCookie") csrfCookie = optionValue;
            else if (option === "csrfHeader") csrfHeader = optionValue;
            else throw new Error(`Unsupported integration auth setting ${option}`);
            expect(";");
          }
          expect("}");
          if (csrfCookie !== undefined && !/^[A-Za-z0-9_-]+$/.test(csrfCookie)) throw new Error("integration csrfCookie must be a simple cookie name");
          if (csrfHeader !== undefined && !/^[A-Za-z0-9-]+$/.test(csrfHeader)) throw new Error("integration csrfHeader must be a simple HTTP header name");
        }
      } else if (key === "response") {
        if (peek() !== "{") throw new Error("integration response requires a block");
        expect("{");
        const contract: NonNullable<QiyIntegrationConfig["response"]> = {};
        const contractSeen = new Set<string>();
        while (peek() !== "}") {
          const option = identifier();
          if (contractSeen.has(option)) throw new Error(`Duplicate integration response setting ${option}`);
          if (option !== "data" && option !== "total" && option !== "error") throw new Error(`Unsupported integration response setting ${option}`);
          contractSeen.add(option);
          const path = value();
          if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path)) throw new Error(`integration response ${option} must be a dotted JSON path of plain keys`);
          if (option === "data") contract.data = path;
          else if (option === "total") contract.total = path;
          else contract.error = path;
          expect(";");
        }
        expect("}");
        if (!contractSeen.size) throw new Error("integration response requires at least one of data, total or error");
        response = contract;
      } else if (key === "pagination") {
        const style = identifier();
        if (style !== "page" && style !== "offset" && style !== "none") throw new Error(`Unsupported integration pagination style ${style}`);
        pagination = style;
      } else if (key === "tenant") {
        if (peek() !== "{") throw new Error("integration tenant requires a block");
        expect("{");
        let tenantHeader: string | undefined;
        let tenantIdentity: string | undefined;
        const tenantSeen = new Set<string>();
        while (peek() !== "}") {
          const option = identifier();
          if (tenantSeen.has(option)) throw new Error(`Duplicate integration tenant setting ${option}`);
          if (option !== "header" && option !== "identity") throw new Error(`Unsupported integration tenant setting ${option}`);
          tenantSeen.add(option);
          const optionValue = value();
          if (option === "header") tenantHeader = optionValue;
          else tenantIdentity = optionValue;
          expect(";");
        }
        expect("}");
        if (!tenantHeader || !tenantIdentity) throw new Error("integration tenant requires header and identity");
        if (!/^[A-Za-z0-9-]+$/.test(tenantHeader)) throw new Error("integration tenant header must be a simple HTTP header name");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tenantIdentity)) throw new Error("integration tenant identity must be a simple identity key");
        tenant = { header: tenantHeader, identity: tenantIdentity };
      } else throw new Error(`Unsupported integration setting ${key}`);
      expect(";");
    }
    expect("}");
    if (!apiBase) throw new Error("integration requires apiBase");
    integration = { apiBase, authTransport, ...(csrfCookie && { csrfCookie }), ...(csrfHeader && { csrfHeader }), ...(response && { response }), ...(pagination && { pagination }), ...(tenant && { tenant }) };
  }
  if (mode === "integration" && !integration) throw new Error("application mode integration requires an integration block");
  if (integration && mode !== "integration") throw new Error("integration block requires application mode integration");
  let workspace: QiyProject["workspace"];
  if (peek() === "workspace") {
    expect("workspace"); expect("{");
    const result: QiyWorkspaceConfig = {};
    const seen = new Set<string>();
    while (peek() !== "}") {
      const section = identifier();
      if (section === "name") {
        if (seen.has(section)) throw new Error("Duplicate workspace name");
        seen.add(section);
        result.name = identifier();
        expect(";");
        continue;
      }
      if (section !== "aliases" && section !== "packages") throw new Error(`Unsupported workspace configuration ${section}`);
      if (seen.has(section)) throw new Error(`Duplicate workspace ${section} configuration`);
      seen.add(section);
      expect("{");
      const values: Record<string, string> = {};
      while (peek() !== "}") {
        const key = identifier();
        if (Object.hasOwn(values, key)) throw new Error(`Duplicate workspace ${section}.${key}`);
        if (section === "aliases" && !["server", "web", "deploy"].includes(key)) throw new Error(`Unsupported workspace alias ${key}`);
        if (section === "packages" && !["server", "web"].includes(key)) throw new Error(`Unsupported workspace package ${key}`);
        values[key] = value();
        expect(";");
      }
      expect("}");
      if (section === "aliases") result.aliases = values as QiyWorkspaceConfig["aliases"];
      else result.packages = values as QiyWorkspaceConfig["packages"];
    }
    expect("}");
    workspace = result;
  }
  let ui: QiyProject["ui"];
  if (peek() === "ui") {
    expect("ui"); expect("{");
    let library: QiyUiLibrary | undefined;
    let theme: QiyThemeKey | undefined;
    let themes: QiyThemeKey[] | undefined;
    let colorMode: QiyColorMode | undefined;
    let allowThemeSwitch: boolean | undefined;
    let allowColorModeSwitch: boolean | undefined;
    const seen = new Set<string>();
    while (peek() !== "}") {
      const key = identifier();
      if (seen.has(key)) throw new Error(`Duplicate UI setting ${key}`);
      seen.add(key);
      if (key === "library") {
        const configured = identifier();
        if (configured !== "antd") throw new Error(`Unsupported UI library ${configured}; only antd is implemented`);
        library = configured;
      } else if (key === "theme") {
        const configured = identifier() as QiyThemeKey;
        if (!qiyThemeKeys.has(configured)) throw new Error(`Unsupported UI theme ${configured}`);
        theme = configured;
      } else if (key === "themes") {
        themes = [];
        do {
          const configured = identifier() as QiyThemeKey;
          if (!qiyThemeKeys.has(configured)) throw new Error(`Unsupported UI theme ${configured}`);
          if (themes.includes(configured)) throw new Error(`Duplicate UI theme ${configured}`);
          themes.push(configured);
          if (peek() !== ",") break;
          expect(",");
        } while (true);
        if (!themes.length) throw new Error("UI themes requires at least one theme key");
      } else if (key === "colorMode") {
        const configured = identifier();
        if (configured !== "light" && configured !== "dark" && configured !== "system") throw new Error(`Unsupported UI color mode ${configured}`);
        colorMode = configured;
      } else if (key === "allowThemeSwitch") allowThemeSwitch = boolean();
      else if (key === "allowColorModeSwitch") allowColorModeSwitch = boolean();
      else throw new Error(`Unsupported UI setting ${key}`);
      expect(";");
    }
    expect("}");
    const configuredThemes = themes ?? ["blue", "purple", "green", "orange", "red"];
    const configuredTheme = theme ?? configuredThemes[0]!;
    if (!configuredThemes.includes(configuredTheme)) throw new Error(`UI default theme ${configuredTheme} must be included in themes`);
    ui = {
      library: library ?? "antd",
      theme: configuredTheme,
      themes: configuredThemes,
      colorMode: colorMode ?? "system",
      allowThemeSwitch: allowThemeSwitch ?? true,
      allowColorModeSwitch: allowColorModeSwitch ?? true,
    };
  }
  let apiClient: QiyProject["apiClient"];
  let corsOrigins: QiyProject["corsOrigins"];
  if (peek() === "api") {
    expect("api"); expect("{"); expect("client");
    const client = identifier();
    if (client !== "rest" && client !== "graphql") throw new Error(`Unsupported API client ${client}`);
    apiClient = client;
    expect(";");
    if (peek() === "cors") {
      expect("cors"); expect("{");
      corsOrigins = [];
      while (peek() !== "}") {
        expect("origin");
        const token = peek();
        if (!token.startsWith("\"") && !token.startsWith("'")) throw new Error("CORS origins must be quoted strings");
        corsOrigins.push(value());
        expect(";");
      }
      expect("}");
      if (corsOrigins.length === 0) throw new Error("CORS configuration requires at least one origin");
      corsOrigins = validateCorsOrigins(corsOrigins);
    }
    expect("}");
  }
  let features: QiyProject["features"];
  if (peek() === "features") {
    expect("features"); expect("{");
    const result: QiyFeaturesConfig = { overview: true, apiDocs: false, apiKeys: false };
    const seen = new Set<string>();
    while (peek() !== "}") {
      const key = identifier();
      if (seen.has(key)) throw new Error(`Duplicate features setting ${key}`);
      seen.add(key);
      if (key !== "overview" && key !== "apiDocs" && key !== "apiKeys") throw new Error(`Unsupported features setting ${key}; expected overview, apiDocs or apiKeys`);
      result[key] = boolean();
      expect(";");
    }
    expect("}");
    features = result;
  }
  let realtime: QiyProject["realtime"];
  if (peek() === "realtime") {
    expect("realtime"); expect("{");
    let mode: QiyRealtimeMode = "auto";
    const resources: QiyRealtimeConfig["resources"] = [];
    const seenResources = new Set<string>();
    if (peek() === "mode") {
      expect("mode");
      const configuredMode = identifier();
      if (configuredMode !== "auto" && configuredMode !== "manual") throw new Error(`Unsupported realtime mode ${configuredMode}`);
      mode = configuredMode;
      expect(";");
    }
    while (peek() !== "}") {
      expect("resource");
      const resource = identifier();
      if (seenResources.has(resource)) throw new Error(`Duplicate realtime resource ${resource}`);
      seenResources.add(resource);
      expect("{");
      let events: QiyRealtimeEvent[] | undefined;
      let roles: Array<"admin" | "operator" | "viewer"> | undefined;
      let claim: { field: string; claim: string } | undefined;
      while (peek() !== "}") {
        const setting = identifier();
        if (setting === "events") {
          if (events) throw new Error(`Realtime resource ${resource}: duplicate events`);
          events = [];
          do {
            const event = identifier();
            if (event !== "created" && event !== "updated" && event !== "deleted") throw new Error(`Realtime resource ${resource}: unsupported event ${event}`);
            if (events.includes(event)) throw new Error(`Realtime resource ${resource}: duplicate event ${event}`);
            events.push(event);
            if (peek() !== ",") break;
            expect(",");
          } while (true);
          expect(";");
          continue;
        }
        if (setting === "roles") {
          if (roles) throw new Error(`Realtime resource ${resource}: duplicate roles`);
          roles = [];
          do {
            const role = identifier();
            if (role !== "admin" && role !== "operator" && role !== "viewer") throw new Error(`Realtime resource ${resource}: unsupported role ${role}`);
            if (roles.includes(role)) throw new Error(`Realtime resource ${resource}: duplicate role ${role}`);
            roles.push(role);
            if (peek() !== ",") break;
            expect(",");
          } while (true);
          expect(";");
          continue;
        }
        if (setting === "when") {
          if (claim) throw new Error(`Realtime resource ${resource}: duplicate when clause`);
          const field = identifier();
          const keyword = identifier();
          if (keyword !== "claim") throw new Error(`Realtime resource ${resource}: when requires "claim"`);
          claim = { field, claim: claimIdentifier() };
          expect(";");
          continue;
        }
        throw new Error(`Realtime resource ${resource}: unsupported setting ${setting}`);
      }
      expect("}");
      if (!events?.length) throw new Error(`Realtime resource ${resource}: events requires at least one event`);
      if (!roles?.length) throw new Error(`Realtime resource ${resource}: roles requires at least one role`);
      resources.push({ resource, events, roles, ...(claim && { claim }) });
    }
    expect("}");
    if (!resources.length) throw new Error("Realtime requires at least one resource");
    realtime = { mode, resources };
  }
  let elysiaPlugins: QiyProject["elysiaPlugins"];
  if (peek() === "elysia") {
    expect("elysia"); expect("{");
    const result: NonNullable<QiyProject["elysiaPlugins"]> = {};
    while (peek() !== "}") {
      const plugin = identifier();
      if (plugin === "bearer") { expect(";"); result.bearer = true; continue; }
      if (plugin === "serverTiming") { expect(";"); result.serverTiming = true; continue; }
      if (plugin === "html") { expect(";"); result.html = true; continue; }
      if (plugin === "drizzle") { expect(";"); result.drizzle = true; continue; }
      if (plugin === "jwt") {
        if (peek() === ";") { expect(";"); result.jwt = { name: "jwt", secretEnv: "QIY_JWT_SECRET" }; continue; }
        expect("{"); expect("name"); const name = identifier(); expect(";");
        expect("secretEnv"); const secretEnv = identifier(); expect(";"); expect("}");
        result.jwt = { name, secretEnv }; continue;
      }
      if (plugin === "static") {
        if (peek() === ";") { expect(";"); result.static = { assets: "public", prefix: "/public" }; continue; }
        expect("{"); expect("assets"); const assets = value(); expect(";");
        expect("prefix"); const prefix = value(); expect(";"); expect("}");
        if (!prefix.startsWith("/")) throw new Error("Elysia static prefix must start with /");
        result.static = { assets, prefix }; continue;
      }
      if (plugin === "graphqlAdapter") {
        const adapter = ((expect("adapter"), identifier()));
        if (adapter !== "native" && adapter !== "yoga" && adapter !== "apollo") throw new Error(`Unsupported GraphQL adapter ${adapter}`);
        expect(";"); result.graphqlAdapter = adapter; continue;
      }
      if (plugin === "cron") {
        expect("{");
        const jobs: Array<{ name: string; pattern: string; task: "cleanupMissingAttachments" }> = [];
        while (peek() !== "}") {
          expect("job");
          const name = identifier();
          expect("pattern");
          const pattern = value();
          expect("task");
          const task = identifier();
          if (task !== "cleanupMissingAttachments") throw new Error(
            `Unsupported Cron task ${task}`
          );
          expect(";");
          jobs.push({ name, pattern, task });
        }
        expect("}"); result.cron = jobs; continue;
      }
      throw new Error(`Unsupported Elysia plugin configuration ${plugin}`);
    }
    expect("}"); elysiaPlugins = result;
  }  let storageProvider: QiyProject["storageProvider"];
  if (peek() === "storage") {
    expect("storage"); expect("{"); expect("provider");
    const provider = identifier();
    if (provider !== "local" && provider !== "s3") throw new Error(`Unsupported storage provider ${provider}`);
    storageProvider = provider;
    expect(";"); expect("}");
  }
  let auth: QiyProject["auth"];
  if (peek() === "auth") {
    expect("auth"); expect("{");
    const attributes: Record<string, string> = {};
    const providerMappings: QiyAuthProviderMapping[] = [];
    while (peek() !== "}") {
      const key = identifier();
      if (!["provider", "providers", "user", "subjectField", "roleField", "usernameField", "passwordField", "profileField"].includes(key)) throw new Error(`Unsupported auth attribute ${key}`);
      if (key === "provider") {
        const providerId = identifier();
        if (peek() === "{") {
          expect("{");
          const mapping: QiyAuthProviderMapping = { provider: providerId as QiyAuthProvider, subjectField: "" };
          const mappingOptions = new Set<string>();
          while (peek() !== "}") {
            const option = identifier();
            if (mappingOptions.has(option)) throw new Error(`Duplicate provider mapping option ${option}`);
            mappingOptions.add(option);
            const optionValue = identifier();
            if (option === "subjectField") mapping.subjectField = optionValue;
            else if (option === "claim") mapping.claim = optionValue;
            else throw new Error(`Unsupported provider mapping option ${option}`);
            expect(";");
          }
          expect("}");
          if (!mapping.subjectField) throw new Error("Provider mapping requires subjectField");
          if (!qiyAuthProviders.has(mapping.provider)) throw new Error(`Unsupported auth provider ${mapping.provider}`);
          if (mapping.claim && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(mapping.claim)) throw new Error(`Provider mapping claim must be a plain claim name: ${mapping.claim}`);
          providerMappings.push(mapping);
          continue;
        }
        if (Object.hasOwn(attributes, "provider")) throw new Error("Duplicate auth attribute provider");
        attributes.provider = providerId;
        expect(";");
        continue;
      }
      if (Object.hasOwn(attributes, key)) throw new Error(`Duplicate auth attribute ${key}`);
      if (key === "providers") {
        const list = [identifier()];
        while (peek() === ",") { expect(","); list.push(identifier()); }
        attributes.providers = list.join(",");
        expect(";");
        continue;
      }
      attributes[key] = identifier();
      expect(";");
    }
    expect("}");
    const providerList = attributes.providers ? attributes.providers.split(",") : undefined;
    if (providerList && attributes.provider) throw new Error("Auth accepts either provider or providers, not both");
    for (const candidate of providerList ?? []) {
      if (!qiyAuthProviders.has(candidate as QiyAuthProvider)) throw new Error(`Unsupported auth provider ${candidate}`);
    }
    if (providerList && new Set(providerList).size !== providerList.length) throw new Error("Auth providers must be unique");
    if (providerList?.includes("otp")) throw new Error("Auth providers cannot include otp; use provider otp for one-time-password login");
    // `local` may appear in a providers list to add password login next to OAuth
    // providers. `providers` itself never stores local or otp.
    const listLocal = Boolean(providerList?.includes("local"));
    const configuredOAuthProviders = (providerList ?? []).filter((candidate) => candidate !== "local") as QiyAuthProvider[];
    const hasLocalProvider = listLocal || attributes.provider === "local";
    const provider = attributes.provider ?? configuredOAuthProviders[0] ?? (listLocal ? "local" : "");
    const hasOidcProvider = attributes.provider ? attributes.provider !== "local" && attributes.provider !== "otp" : configuredOAuthProviders.length > 0;
    for (const mapping of providerMappings) {
      const configured = providerList ? configuredOAuthProviders.includes(mapping.provider) : mapping.provider === provider;
      if (!configured) throw new Error(`Provider mapping ${mapping.provider} is not part of the configured providers`);
    }
    if (new Set(providerMappings.map((mapping) => mapping.provider)).size !== providerMappings.length) throw new Error("Provider mappings must be unique per provider");
    if (!qiyAuthProviders.has(provider as QiyAuthProvider)) throw new Error(`Unsupported auth provider ${provider || "(missing)"}`);
    if (!attributes.user) throw new Error("Auth requires a user entity");
    if (!attributes.roleField) throw new Error("Auth requires roleField");
    const subjectField = attributes.subjectField ?? "";
    if (hasOidcProvider && !subjectField) throw new Error("Auth requires subjectField for OAuth/OIDC providers");
    const usernameField = attributes.usernameField ?? "";
    const passwordField = attributes.passwordField ?? "";
    if (hasLocalProvider && (!usernameField || !passwordField)) throw new Error("Auth provider local requires usernameField and passwordField");
    if (provider === "otp" && !usernameField) throw new Error("Auth provider otp requires usernameField");
    if (provider === "otp" && passwordField) throw new Error("Auth provider otp does not accept passwordField");
    if (!hasLocalProvider && provider !== "otp" && (usernameField || passwordField)) throw new Error(`Auth provider ${provider} does not accept usernameField or passwordField`);
    const profileField = attributes.profileField ?? "";
    if (profileField && !hasOidcProvider) throw new Error("Auth profileField requires at least one OAuth/OIDC provider");
    // A `providers` list is stored when it chooses between several OAuth providers
    // or when it adds password login to a single OAuth provider (hybrid mode).
    const storedProviders = configuredOAuthProviders.length > 1 || (hasLocalProvider && configuredOAuthProviders.length > 0)
      ? configuredOAuthProviders
      : undefined;
    auth = {
      provider: provider as QiyAuthProvider,
      ...(storedProviders ? { providers: storedProviders } : {}),
      ...(hasLocalProvider ? { local: true } : {}),
      userEntity: attributes.user,
      subjectField,
      roleField: attributes.roleField,
      ...(providerMappings.length ? { providerMappings } : {}),
      ...(usernameField && { usernameField }),
      ...(passwordField && { passwordField }),
      ...(profileField && { profileField }),
    };
  }
  if (features?.apiKeys && !auth) {
    // API keys resolve a user row for role/claims, so the user table must exist.
    throw new Error("features apiKeys requires an auth block");
  }
  let environment: QiyEnvironmentVariable[] | undefined;
  if (peek() === "env") {
    expect("env"); expect("{");
    environment = [];
    const names = new Set<string>();
    while (peek() !== "}") {
      expect("variable");
      const variableName = identifier();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(variableName)) throw new Error(`Environment variable name must use uppercase letters, digits and underscores: ${variableName}`);
      if (names.has(variableName)) throw new Error(`Duplicate environment variable ${variableName}`);
      names.add(variableName);
      expect("{");
      const variable: QiyEnvironmentVariable = { name: variableName };
      const modes = new Set<string>();
      while (peek() !== "}") {
        const key = identifier();
        if (key === "secret") {
          if (variable.secret) throw new Error(`Duplicate env ${variableName}.secret`);
          variable.secret = true;
          expect(";");
          continue;
        }
        if (key !== "development" && key !== "production" && key !== "example") throw new Error(`Unsupported env mode ${key}`);
        if (modes.has(key)) throw new Error(`Duplicate env ${variableName}.${key}`);
        modes.add(key);
        const token = peek();
        let configuredValue: QiyEnvironmentValue;
        if (token.startsWith("\"") || token.startsWith("'")) configuredValue = { kind: "value", value: value() };
        else {
          const kind = identifier();
          if (kind !== "required" && kind !== "generate") throw new Error(`Expected a quoted value, required or generate for env ${variableName}.${key}`);
          configuredValue = { kind };
        }
        if (configuredValue.kind === "generate" && (key !== "development" || !variable.secret)) {
          throw new Error(`env ${variableName}: generate is only allowed for secret development values`);
        }
        variable[key] = configuredValue;
        expect(";");
      }
      expect("}");
      if (variable.secret && [variable.development, variable.production, variable.example].some((configuredValue) => configuredValue?.kind === "value")) {
        throw new Error(`env ${variableName}: secret variables cannot contain literal values`);
      }
      if (variable.secret && variableName.startsWith("VITE_")) throw new Error(`env ${variableName}: frontend VITE_ variables cannot be secret`);
      if (/(?:SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY)/.test(variableName) && !variable.secret) {
        throw new Error(`env ${variableName}: mark credential-like values as secret`);
      }
      environment.push(variable);
    }
    expect("}");
  }
  if (peek() === "messages") {
    expect("messages"); expect("{"); expect("default");
    const defaultLocale = stringLiteral(); expect(";");
    const validateLocale = (locale: string) => {
      try {
        if (Intl.getCanonicalLocales(locale)[0] !== locale) throw new Error("Noncanonical locale");
      } catch { throw new Error(`Invalid message locale ${locale}: use a canonical BCP 47 language tag`); }
    };
    validateLocale(defaultLocale);
    const locales: NonNullable<QiyProject["messages"]>["locales"] = {};
    while (peek() !== "}") {
      expect("locale"); const locale = stringLiteral();
      validateLocale(locale);
      if (Object.hasOwn(locales, locale)) throw new Error(`Duplicate message locale ${locale}`);
      const entries: Record<string, string> = Object.create(null);
      expect("{");
      while (peek() !== "}") {
        const key = stringLiteral();
        if (!/^[a-zA-Z_][a-zA-Z_0-9.-]*$/.test(key) || key.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part))) throw new Error(`Invalid message key ${key}`);
        if (Object.hasOwn(entries, key)) throw new Error(`Duplicate message key ${locale}.${key}`);
        entries[key] = stringLiteral(); expect(";");
      }
      expect("}"); locales[locale] = entries;
    }
    expect("}");
    if (!locales[defaultLocale]) throw new Error(`Missing default message locale ${defaultLocale}`);
    messages = { defaultLocale, locales };
  }
  let permissions: QiyProject["permissions"];
  if (peek() === "permission") permissions = permissionDeclarations();
  if (applicationDescription) applicationDescription = resolveDocumentation(applicationDescription, "application comment");
  if (databaseDescription) databaseDescription = resolveDocumentation(databaseDescription, "database comment");
  const workflows: NonNullable<QiyProject["workflows"]> = [];
  while (peek() === "workflow") {
    expect("workflow");
    const workflow = identifier();
    if (workflow !== "orderInventory") throw new Error(`Unsupported workflow ${workflow}`);
    expect(";");
    if (workflows.includes(workflow)) throw new Error(`Duplicate workflow ${workflow}`);
    workflows.push(workflow);
  }
  const enums: import("./database-ir").EnumIR[] = [];
  while (peek() === "enum") enums.push(enumeration());
  const enumNames = new Set(enums.map((enumeration) => enumeration.name));
  const entities: EntityIR[] = [];
  while (peek() === "entity") entities.push(entity(enumNames));
  const relations: RelationIR[] = [];
  while (peek() === "relation") relations.push(relation());
  const scopes: NonNullable<QiyProject["scopes"]> = [];
  while (peek() === "scope") {
    expect("scope");
    const resource = identifier();
    const field = identifier();
    expect("claim");
    const claim = claimIdentifier();
    // `tree <entity> <parentField>` widens the claim from one org to its whole subtree.
    let tree: { entity: string; parentField: string } | undefined;
    if (peek() === "tree") {
      expect("tree");
      tree = { entity: identifier(), parentField: identifier() };
    }
    expect(";");
    scopes.push({ resource, field, claim, ...(tree && { tree }) });
  }
  const restrictions: NonNullable<QiyProject["restrictions"]> = [];
  while (peek() === "restrict") restrictions.push(resourceRestriction());
  const pages: NonNullable<QiyProject["pages"]> = [];
  while (peek() === "pages") {
    expect("pages");
    const resource = identifier();
    expect("{");
    const actions: Array<{ action: QiyPageAction; roles: QiyRole[] }> = [];
    const fields: Array<{ field: string; roles: QiyRole[] }> = [];
    while (peek() !== "}") {
      const section = identifier();
      if (section === "field") {
        // Page-level field layout: the field is only rendered for these roles.
        const field = identifier();
        if (fields.some((entry) => entry.field === field)) throw new Error(`Pages ${resource}: duplicate field rule ${field}`);
        expect("roles");
        const roles = roleList(`Pages ${resource} field ${field}`);
        if (!roles.length) throw new Error(`Pages ${resource}: field ${field} requires at least one role`);
        expect(";");
        fields.push({ field, roles });
        continue;
      }
      if (!["list", "show", "create", "edit", "delete"].includes(section)) throw new Error(`Pages ${resource}: unsupported page action ${section}`);
      if (actions.some((entry) => entry.action === section)) throw new Error(`Pages ${resource}: duplicate page action ${section}`);
      expect("roles");
      const roles = roleList(`Pages ${resource}`);
      if (!roles.length) throw new Error(`Pages ${resource}: ${section} requires at least one role`);
      expect(";");
      actions.push({ action: section as QiyPageAction, roles });
    }
    expect("}");
    if (!actions.length && !fields.length) throw new Error(`Pages ${resource}: requires at least one page action or field rule`);
    pages.push({ resource, actions, ...(fields.length ? { fields } : {}) });
  }
  const pageResources = new Set<string>();
  for (const page of pages) {
    const entity = entities.find((candidate) => candidate.name === page.resource || candidate.tableName === page.resource);
    if (!entity) throw new Error(`Pages ${page.resource}: unknown resource`);
    if (pageResources.has(entity.name)) throw new Error(`Pages ${entity.name}: duplicate page rules`);
    pageResources.add(entity.name);
    page.resource = entity.name;
  }
  const restrictedResources = new Set<string>();
  for (const restriction of restrictions) {
    const entity = entities.find((candidate) => candidate.name === restriction.resource || candidate.tableName === restriction.resource);
    if (!entity) throw new Error(`Restrict ${restriction.resource}: unknown resource`);
    if (restrictedResources.has(entity.name)) throw new Error(`Restrict ${entity.name}: duplicate resource restriction`);
    restrictedResources.add(entity.name);
    restriction.resource = entity.name;
    const validateRow = (row: QiyRowPredicate) => {
      const field = entity.fields.find((candidate) => candidate.name === row.field);
      if (!field) throw new Error(`Restrict ${entity.name}: unknown row condition field ${row.field}`);
      if (field.primaryKey) throw new Error(`Restrict ${entity.name}: row conditions cannot target primary key ${row.field}`);
      if (row.source === "values" && !["Text", "Integer", "Decimal", "Money", "Date", "Time", "DateTime"].includes(field.type) && !field.enumName) {
        throw new Error(`Restrict ${entity.name}: row value comparisons require Text, enum, Integer, Decimal, Money, Date, Time or DateTime field ${row.field}`);
      }
      if (row.source === "claim" && field.nullable) throw new Error(`Restrict ${entity.name}: row condition on nullable field ${row.field} is not supported`);
    };
    for (const row of restriction.rows ?? []) validateRow(row);
    for (const group of restriction.groups ?? []) for (const row of group) validateRow(row);
    /** Cross-field comparisons must name two declared, comparable fields. */
    const comparisonClass = (type: string, enumName?: string): string | undefined => {
      if (enumName || type === "Text" || type === "UUID") return "text";
      if (type === "Integer" || type === "Decimal" || type === "Money") return "number";
      if (type === "DateTime" || type === "Date" || type === "Time") return "date";
      return undefined;
    };
    const validateExpression = (node: QiyPolicyExpression) => {
      if (node.kind === "predicate") { validateRow(node.predicate); return; }
      if (node.kind === "cross") {
        const left = entity.fields.find((candidate) => candidate.name === node.field);
        const right = entity.fields.find((candidate) => candidate.name === node.otherField);
        if (!left) throw new Error(`Restrict ${entity.name}: unknown row condition field ${node.field}`);
        if (!right) throw new Error(`Restrict ${entity.name}: unknown cross-field ${node.otherField}`);
        if (left.primaryKey || right.primaryKey) throw new Error(`Restrict ${entity.name}: cross-field comparisons cannot target a primary key`);
        const leftClass = comparisonClass(left.type, left.enumName);
        const rightClass = comparisonClass(right.type, right.enumName);
        if (!leftClass || !rightClass) throw new Error(`Restrict ${entity.name}: cross-field comparison requires Text, enum, Integer, Decimal, Money, Date, Time or DateTime fields`);
        if (leftClass !== rightClass) throw new Error(`Restrict ${entity.name}: ${node.field} (${left.type}) and ${node.otherField} (${right.type}) are not comparable`);
        if ((node.operator === "<" || node.operator === "<=" || node.operator === ">" || node.operator === ">=") && leftClass === "text" && left.type === "UUID") throw new Error(`Restrict ${entity.name}: UUID fields only support == and !=`);
        return;
      }
      if (node.kind === "scope") return;
      if (node.kind === "not") { validateExpression(node.expression); return; }
      for (const child of node.children) validateExpression(child);
    };
    for (const expression of restriction.expressions ?? []) validateExpression(expression);
    for (const mask of restriction.masks ?? []) {
      const field = entity.fields.find((candidate) => candidate.name === mask.field);
      if (!field) throw new Error(`Restrict ${entity.name}: unknown mask field ${mask.field}`);
      if (field.primaryKey) throw new Error(`Restrict ${entity.name}: primary key ${mask.field} cannot be masked`);
      if (field.type === "Vector") throw new Error(`Restrict ${entity.name}: Vector field ${mask.field} cannot be masked`);
    }
  }
  if (permissions) {
    const permissionErrors = validatePermissionModel(permissions, {
      oauthProviders: auth ? authOAuthProviders(auth) : [],
      allProviders: auth ? [auth.provider, ...(auth.providers ?? [])].filter((provider) => provider !== "local" && provider !== "otp") : [],
      entities,
      ...(auth?.userEntity ? { userEntity: auth.userEntity } : {}),
      hasAuth: Boolean(auth),
    });
    if (permissionErrors.length) throw new Error(permissionErrors.join("\n"));
  }
  const menuGroups: NonNullable<QiyProject["menuGroups"]> = [];
  if (peek() === "menu") {
    expect("menu"); expect("{");
    while (peek() !== "}") menuGroups.push(menuGroup());
    expect("}");
  }
  const dashboardMetrics: NonNullable<QiyProject["dashboardMetrics"]> = [];
  const chartDeclarations: Array<{ name: string; view: QiyChartView }> = [];
  const chartPanels: NonNullable<QiyProject["chartPanels"]> = [];
  // Dashboard metrics and chart blocks share one position (after menu, before
  // dataflows) and may be written in either order.
  while (peek() === "dashboard" || peek() === "chart") {
    if (peek() === "dashboard") {
      expect("dashboard"); expect("{");
      while (peek() !== "}") dashboardMetrics.push(dashboardMetric());
      expect("}");
      continue;
    }
    expect("chart");
    if (peek() === "panels") {
      expect("panels");
      chartPanels.push(chartPanel());
    } else {
      chartDeclarations.push(chartDeclaration());
    }
  }
  const charts = collectChartDeclarations(chartDeclarations, chartPanels);
  if (charts.length || chartPanels.length) validateCharts(charts, chartPanels);
  const dataflows: DataflowIR[] = [];
  while (peek() === "dataflow") dataflows.push(dataflow());
  const dataflowNames = new Set<string>();
  for (const flow of dataflows) {
    if (dataflowNames.has(flow.name)) throw new Error(`Duplicate dataflow ${flow.name}`);
    dataflowNames.add(flow.name);
    const inputNames = new Set(flow.input.map((field) => field.name));
    const permissionFieldNames = new Set(permissions?.fields.map((field) => field.name) ?? []);
    const permissionGroupNames = new Set(permissions?.groups.map((group) => group.name) ?? []);
    if (flow.permission) {
      if (!permissions) throw new Error(`Dataflow ${flow.name}: allow permission requires permission declarations`);
      for (const reference of flow.permission) {
        if (!permissionFieldNames.has(reference) && !permissionGroupNames.has(reference)) throw new Error(`Dataflow ${flow.name}: unknown permission field or group ${reference}`);
      }
    }
    if (flow.verification) {
      if (!permissions) throw new Error(`Dataflow ${flow.name}: allow verification requires permission declarations`);
      const declaredVerification = permissions.verifications.find((candidate) => candidate.name === flow.verification);
      if (!declaredVerification) throw new Error(`Dataflow ${flow.name}: unknown permission verification ${flow.verification}`);
      for (const declaredInput of declaredVerification.inputs) {
        const flowInput = flow.input.find((field) => field.name === declaredInput.name);
        if (!flowInput) throw new Error(`Dataflow ${flow.name}: permission verification ${declaredVerification.name} input ${declaredInput.name} has no matching dataflow input`);
        if (!flowInput.required) throw new Error(`Dataflow ${flow.name}: permission verification ${declaredVerification.name} input ${declaredInput.name} must be @required`);
        if (flowInput.type !== "Text" && !enumNames.has(flowInput.type)) throw new Error(`Dataflow ${flow.name}: permission verification ${declaredVerification.name} input ${declaredInput.name} requires a Text or enum dataflow input`);
      }
    }
    const contextByName = new Map<string, { entity: string }>(flow.context.map((binding) => [binding.name, { entity: binding.entity }]));
    const deletedContexts = new Set<string>();
    for (const binding of flow.context) {
      if (binding.name === "input") throw new Error(`Dataflow ${flow.name}: input is a reserved context name`);
      const entity = entities.find((candidate) => candidate.name === binding.entity);
      if (!entity) throw new Error(`Dataflow ${flow.name}: unknown entity ${binding.entity}`);
      const [key, source] = binding.id.split(":", 2);
      if (!entity.fields.some((field) => field.name === key && field.primaryKey)) throw new Error(`Dataflow ${flow.name}: ${binding.entity}.${key} must be a primary key`);
      const [root, fieldName] = source!.split(".", 2);
      if (root !== "input" || !fieldName || !inputNames.has(fieldName)) throw new Error(`Dataflow ${flow.name}: context ${binding.name} must load by an input field`);
      if (!flow.input.find((input) => input.name === fieldName)?.required) throw new Error(`Dataflow ${flow.name}: context ${binding.name} requires input.${fieldName} to be @required`);
      if (!binding.required) throw new Error(`Dataflow ${flow.name}: context bindings must declare @required until optional-flow semantics are implemented`);
    }
    for (const step of flow.steps) for (const action of step.actions) {
      if (action.kind === "require") {
        const [bindingName, fieldName] = action.left.split(".", 2);
        if (bindingName !== "input" && deletedContexts.has(bindingName!)) throw new Error(`Dataflow ${flow.name}: cannot use deleted context ${bindingName}`);
        const binding = contextByName.get(bindingName!);
        const entity = entities.find((candidate) => candidate.name === binding?.entity);
        const input = bindingName === "input" ? flow.input.find((candidate) => candidate.name === fieldName) : undefined;
        const field = entity?.fields.find((candidate) => candidate.name === fieldName);
        if (!fieldName || (!field && !input)) throw new Error(`Dataflow ${flow.name}: unknown field reference ${action.left}`);
        if (input && !input.required) throw new Error(`Dataflow ${flow.name}: require input must be @required (${action.left})`);
        const type = input?.type ?? field!.type;
        const enumName = input && enumNames.has(input.type) ? input.type : field?.enumName;
        if (type === "Integer") {
          if (typeof action.right !== "number") throw new Error(`Dataflow ${flow.name}: Integer require must compare an integer literal (${action.left})`);
          if (field?.nullable) throw new Error(`Dataflow ${flow.name}: nullable Integer require is not supported (${action.left})`);
        } else {
          if (type !== "Text" && !enumName) throw new Error(`Dataflow ${flow.name}: require comparisons support Text, enum and Integer fields only (${action.left})`);
          if (typeof action.right !== "string" || (action.operator !== "==" && action.operator !== "!=")) throw new Error(`Dataflow ${flow.name}: Text and enum require support == and != string comparisons only (${action.left})`);
        }
        if (enumName && !enums.find((enumeration) => enumeration.name === enumName)?.values.some((value) => value.name === action.right)) throw new Error(`Dataflow ${flow.name}: unknown enum value ${enumName}.${action.right}`);
      } else if (action.kind === "update") {
        const binding = contextByName.get(action.context);
        const entity = entities.find((candidate) => candidate.name === binding?.entity);
        if (!binding) throw new Error(`Dataflow ${flow.name}: unknown context binding ${action.context}`);
        if (deletedContexts.has(action.context)) throw new Error(`Dataflow ${flow.name}: cannot update deleted context ${action.context}`);
        if (!action.values.length) throw new Error(`Dataflow ${flow.name}: update must write at least one field`);
        const written = new Set<string>();
        for (const value of action.values) {
          const field = entity?.fields.find((candidate) => candidate.name === value.field);
          if (!field) throw new Error(`Dataflow ${flow.name}: unknown update field ${binding.entity}.${value.field}`);
          if (field.primaryKey) throw new Error(`Dataflow ${flow.name}: cannot update primary key ${binding.entity}.${value.field}`);
          if (scopes.some((scope) => (scope.resource === entity?.name || scope.resource === entity?.tableName) && scope.field === value.field)) throw new Error(`Dataflow ${flow.name}: cannot update scope field ${binding.entity}.${value.field}`);
          if (auth?.provider === "local" && auth.userEntity === binding.entity && auth.passwordField === value.field) throw new Error(`Dataflow ${flow.name}: cannot update password field ${binding.entity}.${value.field}`);
          if (value.source === "input") {
            const input = flow.input.find((candidate) => candidate.name === value.value);
            if (!input) throw new Error(`Dataflow ${flow.name}: unknown input field input.${value.value}`);
            if (!input.required) throw new Error(`Dataflow ${flow.name}: update requires input.${value.value} to be @required`);
            if (field.enumName ? input.type !== field.enumName : !["Text", "Integer", "UUID"].includes(field.type) || input.type !== field.type) throw new Error(`Dataflow ${flow.name}: input updates require matching Text, Integer or UUID fields, or the same declared enum (${binding.entity}.${value.field})`);
          } else {
            if (field.type !== "Text" && !field.enumName) throw new Error(`Dataflow ${flow.name}: literal updates currently support Text and enum fields only (${binding.entity}.${value.field})`);
            if (field.enumName && !enums.find((enumeration) => enumeration.name === field.enumName)?.values.some((candidate) => candidate.name === value.value)) throw new Error(`Dataflow ${flow.name}: unknown enum value ${field.enumName}.${value.value}`);
          }
          if (written.has(value.field)) throw new Error(`Dataflow ${flow.name}: duplicate update field ${binding.entity}.${value.field}`);
          written.add(value.field);
        }
      } else if (action.kind === "create") {
        if (action.context === "input" || contextByName.has(action.context)) throw new Error(`Dataflow ${flow.name}: duplicate or reserved created context ${action.context}`);
        const entity = entities.find((candidate) => candidate.name === action.entity);
        if (!entity) throw new Error(`Dataflow ${flow.name}: unknown create entity ${action.entity}`);
        if (!action.values.length) throw new Error(`Dataflow ${flow.name}: create must write at least one field`);
        const written = new Set<string>();
        const scope = scopes.find((candidate) => (candidate.resource === entity.name || candidate.resource === entity.tableName));
        for (const value of action.values) {
          const field = entity.fields.find((candidate) => candidate.name === value.field);
          if (!field) throw new Error(`Dataflow ${flow.name}: unknown create field ${entity.name}.${value.field}`);
          if (field.primaryKey) throw new Error(`Dataflow ${flow.name}: create primary key ${entity.name}.${value.field} is generated automatically`);
          if (scope?.field === value.field) throw new Error(`Dataflow ${flow.name}: create scope field ${entity.name}.${value.field} is derived from the authenticated principal`);
          if (auth?.provider === "local" && auth.userEntity === entity.name && auth.passwordField === value.field) throw new Error(`Dataflow ${flow.name}: cannot create password field ${entity.name}.${value.field}`);
          if (value.source === "input") {
            const input = flow.input.find((candidate) => candidate.name === value.value);
            if (!input) throw new Error(`Dataflow ${flow.name}: unknown input field input.${value.value}`);
            if (!input.required) throw new Error(`Dataflow ${flow.name}: create requires input.${value.value} to be @required`);
            const matches = field.enumName ? input.type === field.enumName : input.type === field.type && ["UUID", "Text", "Integer", "Decimal"].includes(field.type);
            if (!matches) throw new Error(`Dataflow ${flow.name}: create input requires a matching UUID, Text, Integer, Decimal or declared enum field (${entity.name}.${value.field})`);
          } else {
            if (field.type !== "Text" && !field.enumName) throw new Error(`Dataflow ${flow.name}: create literals currently support Text and enum fields only (${entity.name}.${value.field})`);
            if (field.enumName && !enums.find((enumeration) => enumeration.name === field.enumName)?.values.some((candidate) => candidate.name === value.value)) throw new Error(`Dataflow ${flow.name}: unknown enum value ${field.enumName}.${value.value}`);
          }
          if (written.has(value.field)) throw new Error(`Dataflow ${flow.name}: duplicate create field ${entity.name}.${value.field}`);
          written.add(value.field);
        }
        for (const field of entity.fields) {
          if (field.primaryKey || field.nullable || field.name === scope?.field) continue;
          if (!written.has(field.name)) throw new Error(`Dataflow ${flow.name}: create requires value for ${entity.name}.${field.name}`);
        }
        contextByName.set(action.context, { entity: entity.name });
      } else if (action.kind === "delete") {
        if (!contextByName.has(action.context)) throw new Error(`Dataflow ${flow.name}: unknown context binding ${action.context}`);
        if (deletedContexts.has(action.context)) throw new Error(`Dataflow ${flow.name}: context ${action.context} is already deleted`);
        deletedContexts.add(action.context);
      } else if (action.kind === "emit") {
        if ((action.payload?.length ?? 0) > 32) throw new Error(`Dataflow ${flow.name}: emit payload supports at most 32 fields`);
        const payloadNames = new Set<string>();
        for (const value of action.payload ?? []) {
          if (payloadNames.has(value.name)) throw new Error(`Dataflow ${flow.name}: duplicate emit payload field ${value.name}`);
          payloadNames.add(value.name);
          if (value.source === "input") {
            const input = flow.input.find((candidate) => candidate.name === value.value);
            if (!input) throw new Error(`Dataflow ${flow.name}: unknown emit input input.${value.value}`);
            if (!input.required) throw new Error(`Dataflow ${flow.name}: emit input must be @required (input.${value.value})`);
          } else if (value.source === "context") {
            if (!value.context || deletedContexts.has(value.context)) throw new Error(`Dataflow ${flow.name}: cannot emit from deleted or unknown context ${value.context}`);
            const binding = contextByName.get(value.context);
            const entity = entities.find((candidate) => candidate.name === binding?.entity);
            const field = entity?.fields.find((candidate) => candidate.name === value.value);
            if (!binding || !field) throw new Error(`Dataflow ${flow.name}: unknown emit field ${value.context}.${value.value}`);
            if (auth?.provider === "local" && auth.userEntity === binding.entity && auth.passwordField === field.name) throw new Error(`Dataflow ${flow.name}: cannot emit password field ${binding.entity}.${field.name}`);
          }
        }
      } else if (action.kind === "call") {
        if ((action.payload?.length ?? 0) > 32) throw new Error(`Dataflow ${flow.name}: call payload supports at most 32 fields`);
        const payloadNames = new Set<string>();
        for (const value of action.payload ?? []) {
          if (payloadNames.has(value.name)) throw new Error(`Dataflow ${flow.name}: duplicate call payload field ${value.name}`);
          payloadNames.add(value.name);
          if (value.source === "input") {
            const input = flow.input.find((candidate) => candidate.name === value.value);
            if (!input) throw new Error(`Dataflow ${flow.name}: unknown call input input.${value.value}`);
            if (!input.required) throw new Error(`Dataflow ${flow.name}: call input must be @required (input.${value.value})`);
          } else if (value.source === "context") {
            if (!value.context || deletedContexts.has(value.context)) throw new Error(`Dataflow ${flow.name}: cannot call with deleted or unknown context ${value.context}`);
            const binding = contextByName.get(value.context);
            const entity = entities.find((candidate) => candidate.name === binding?.entity);
            const field = entity?.fields.find((candidate) => candidate.name === value.value);
            if (!binding || !field) throw new Error(`Dataflow ${flow.name}: unknown call field ${value.context}.${value.value}`);
            if (auth?.provider === "local" && auth.userEntity === binding.entity && auth.passwordField === field.name) throw new Error(`Dataflow ${flow.name}: cannot pass password field to call ${binding.entity}.${field.name}`);
          }
        }
      }
    }
    if (!contextByName.has(flow.result)) throw new Error(`Dataflow ${flow.name}: result must return a declared context binding`);
  }
  const actions: QiyAction[] = [];
  while (peek() === "action") actions.push(action());
  const actionNames = new Set<string>();
  for (const item of actions) {
    if (actionNames.has(item.name)) throw new Error(`Duplicate action ${item.name}`);
    actionNames.add(item.name);
    const entity = entities.find((candidate) => candidate.name === item.resource || candidate.tableName === item.resource);
    if (!entity) throw new Error(`Action ${item.name}: unknown resource ${item.resource}`);
    item.resource = entity.tableName;
    if (item.condition) {
      const field = entity.fields.find((candidate) => candidate.name === item.condition!.field);
      if (!field) throw new Error(`Action ${item.name}: unknown condition field ${entity.name}.${item.condition.field}`);
      if (field.type !== "Text") throw new Error(`Action ${item.name}: condition field ${entity.name}.${field.name} must be Text or enum`);
      if (field.enumName) {
        const enumeration = enums.find((candidate) => candidate.name === field.enumName)!;
        if (!enumeration.values.some((candidate) => candidate.name === item.condition!.value)) throw new Error(`Action ${item.name}: unknown enum value ${field.enumName}.${item.condition.value}`);
      }
    }
    if (item.roles && !auth) throw new Error(`Action ${item.name}: allow roles requires generated authentication; integration permissions belong in the host access-control adapter`);
    if (item.permission) {
      if (!auth) throw new Error(`Action ${item.name}: allow permission requires generated authentication`);
      if (!permissions) throw new Error(`Action ${item.name}: allow permission requires permission declarations`);
      const fieldNames = new Set(permissions.fields.map((field) => field.name));
      const groupNames = new Set(permissions.groups.map((group) => group.name));
      for (const reference of item.permission) {
        if (!fieldNames.has(reference) && !groupNames.has(reference)) throw new Error(`Action ${item.name}: unknown permission field or group ${reference}`);
      }
    }
    if (item.verification) {
      if (!auth) throw new Error(`Action ${item.name}: allow verification requires generated authentication`);
      if (!permissions) throw new Error(`Action ${item.name}: allow verification requires permission declarations`);
      const declaredVerification = permissions.verifications.find((candidate) => candidate.name === item.verification);
      if (!declaredVerification) throw new Error(`Action ${item.name}: unknown permission verification ${item.verification}`);
      if (declaredVerification.inputs.length) throw new Error(`Action ${item.name}: permission verification ${declaredVerification.name} requires inputs and cannot guard a navigate action`);
    }
    if (item.target.kind === "dataflow") {
      const target = item.target;
      const flow = dataflows.find((candidate) => candidate.name === target.dataflow);
      if (!flow) throw new Error(`Action ${item.name}: unknown dataflow ${target.dataflow}`);
      if (!item.label) {
        if (!flow.label) throw new Error(`Action ${item.name}: label is required when dataflow ${flow.name} has no @label`);
        item.label = flow.label;
        if (flow.labelKey) item.labelKey = flow.labelKey;
      }
      if (target.confirm === undefined && flow.confirm !== undefined) {
        target.confirm = flow.confirm;
        if (flow.confirmKey) target.confirmKey = flow.confirmKey;
      }
      const bindsResource = flow.context.some((binding) => binding.entity === entity.name);
      if (!bindsResource) throw new Error(`Action ${item.name}: dataflow ${flow.name} does not load resource ${entity.tableName}`);
      if (item.batch) {
        if (item.placements.length !== 1 || item.placements[0] !== "list") throw new Error(`Action ${item.name}: batch actions require placement list only`);
        if (item.condition) throw new Error(`Action ${item.name}: batch actions do not support record when conditions`);
        if (!flow.idempotency?.required) throw new Error(`Action ${item.name}: batch actions require dataflow ${flow.name} to declare idempotency required`);
        const bindings = flow.context.filter((binding) => binding.entity === entity.name);
        if (bindings.length !== 1) throw new Error(`Action ${item.name}: batch dataflow ${flow.name} must load resource ${entity.tableName} exactly once`);
        const source = bindings[0]!.id.split(":", 2)[1];
        const inputName = source?.startsWith("input.") ? source.slice("input.".length) : undefined;
        const input = inputName ? flow.input.find((candidate) => candidate.name === inputName) : undefined;
        if (!input || input.type !== "UUID" || !input.required) throw new Error(`Action ${item.name}: batch dataflow ${flow.name} must load the resource from one required UUID input`);
      }
    } else {
      const path = item.target.path;
      if (!/^\/[a-z0-9_-]+(?:\/(?:[a-z0-9_-]+|:[a-z][a-zA-Z0-9_]*))*$/.test(path) || path.includes("..") || path.includes("\\") || path.includes("?") || path.includes("#")) {
        throw new Error(`Action ${item.name}: navigate path must be an absolute safe application route`);
      }
      if (!path.includes(":id")) throw new Error(`Action ${item.name}: navigate path must include :id`);
    }
  }
  if (realtime) {
    if (mode === "integration") throw new Error("application mode integration cannot generate standalone realtime; use the host LiveProvider adapter instead.");
    if (!auth) throw new Error("Realtime requires generated authentication");
    for (const subscription of realtime.resources) {
      const entity = entities.find((candidate) => candidate.name === subscription.resource || candidate.tableName === subscription.resource);
      if (!entity) throw new Error(`Realtime: unknown resource ${subscription.resource}`);
      subscription.resource = entity.tableName;
    }
  }
  expect("}");
  expect("<end>");
  if (mode === "integration" && (corsOrigins || elysiaPlugins || storageProvider || auth || environment || scopes.length || restrictions.length || workflows.length || dataflows.length || permissions)) {
    throw new Error("application mode integration cannot configure generated server features; use integration auth and host adapters instead.");
  }
  return { name: packageName, ...(applicationDescription && applicationDescription), database: { ...(databaseDescription && databaseDescription), dialect: dialect as DatabaseIR["dialect"], extensions, entities, ...(enums.length ? { enums } : {}), ...(relations.length ? { relations } : {}) }, ...(mode && { mode }), ...(integration && { integration }), ...(workspace && { workspace }), ...(ui && { ui }), ...(apiClient && { apiClient }), ...(corsOrigins && { corsOrigins }), ...(elysiaPlugins && { elysiaPlugins }), ...(storageProvider && { storageProvider }), ...(features && { features }), ...(auth && { auth }), ...(environment && { environment }), ...(messages && { messages }), ...(permissions && { permissions }), ...(scopes.length ? { scopes } : {}), ...(restrictions.length ? { restrictions } : {}), ...(pages.length ? { pages } : {}), ...(workflows.length ? { workflows } : {}), ...(menuGroups.length && { menuGroups }), ...(dashboardMetrics.length && { dashboardMetrics }), ...(charts.length && { charts }), ...(chartPanels.length && { chartPanels }), ...(realtime && { realtime }), ...(dataflows.length && { dataflows }), ...(actions.length && { actions }) };
}

function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function qiyIdentifier(value: string, context: string): string {
  if (!/^[a-zA-Z_][a-zA-Z_0-9-]*$/.test(value)) throw new Error(`${context} cannot be represented in Qiy syntax: ${value}`);
  return value;
}

function qiyString(value: string): string {
  return JSON.stringify(value);
}

function qiyClaim(value: string): string {
  return /^[a-zA-Z_][a-zA-Z_0-9-]*(\.[a-zA-Z_][a-zA-Z_0-9-]*)*$/.test(value) ? value : qiyString(value);
}

function qiyComment(target: { comment?: string; commentKey?: string }): string {
  return target.commentKey !== undefined ? `t(${qiyString(target.commentKey)})` : qiyString(target.comment!);
}

export function serializeQiyProject(project: QiyProject): string {
  const errors = validateDatabaseIR(project.database);
  if (errors.length) throw new Error(errors.join("\n"));
  if (project.permissions) {
    const permissionErrors = validatePermissionModel(project.permissions, {
      oauthProviders: project.auth ? authOAuthProviders(project.auth) : [],
      allProviders: project.auth ? [project.auth.provider, ...(project.auth.providers ?? [])].filter((provider) => provider !== "local" && provider !== "otp") : [],
      entities: project.database.entities,
      ...(project.auth?.userEntity ? { userEntity: project.auth.userEntity } : {}),
      hasAuth: Boolean(project.auth),
    });
    if (permissionErrors.length) throw new Error(permissionErrors.join("\n"));
  }
  const name = normalizePackageName(project.name);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Qiy project name must normalize to a lowercase package name");
  const applicationAnnotation = project.comment !== undefined ? ` @comment(${qiyComment(project)})` : "";
  const databaseAnnotation = project.database.comment !== undefined ? ` @comment(${qiyComment(project.database)})` : "";
  const lines = ["qiy v0;", `application ${name}${applicationAnnotation} {`, `  database ${project.database.dialect}${databaseAnnotation} {`];
  for (const extension of project.database.extensions) lines.push(`    extension ${qiyIdentifier(extension, "Database extension")};`);
  lines.push("  }");
  if (project.mode === "standalone") lines.push("  mode standalone;");
  if (project.mode === "integration") {
    if (!project.integration) throw new Error("application mode integration requires integration settings");
    lines.push("  mode integration;", "  integration {");
    lines.push(`    apiBase ${qiyString(project.integration.apiBase)};`);
    if (project.integration.authTransport === "cookie" && (project.integration.csrfCookie || project.integration.csrfHeader)) {
      lines.push("    auth cookie {");
      if (project.integration.csrfCookie) lines.push(`      csrfCookie ${qiyString(project.integration.csrfCookie)};`);
      if (project.integration.csrfHeader) lines.push(`      csrfHeader ${qiyString(project.integration.csrfHeader)};`);
      lines.push("    };");
    } else lines.push(`    auth ${project.integration.authTransport};`);
    if (project.integration.response) {
      lines.push("    response {");
      for (const key of ["data", "total", "error"] as const) {
        const path = project.integration.response[key];
        if (path) lines.push(`      ${key} ${qiyString(path)};`);
      }
      lines.push("    };");
    }
    if (project.integration.pagination) lines.push(`    pagination ${project.integration.pagination};`);
    if (project.integration.tenant) {
      lines.push("    tenant {");
      lines.push(`      header ${qiyString(project.integration.tenant.header)};`);
      lines.push(`      identity ${qiyString(project.integration.tenant.identity)};`);
      lines.push("    };");
    }
    lines.push("  }");
  }
  if (project.workspace) {
    lines.push("  workspace {");
    if (project.workspace.name) lines.push(`    name ${qiyIdentifier(project.workspace.name, "Workspace name")};`);
    if (project.workspace.aliases) {
      lines.push("    aliases {");
      for (const key of ["server", "web", "deploy"] as const) {
        const value = project.workspace.aliases[key];
        if (value) lines.push(`      ${key} ${qiyIdentifier(value, `Workspace ${key} alias`)};`);
      }
      lines.push("    }");
    }
    if (project.workspace.packages) {
      lines.push("    packages {");
      for (const key of ["server", "web"] as const) {
        const value = project.workspace.packages[key];
        if (value) lines.push(`      ${key} ${qiyString(value)};`);
      }
      lines.push("    }");
    }
    lines.push("  }");
  }
  if (project.ui) {
    if (project.ui.library !== "antd") throw new Error(`Unsupported UI library ${project.ui.library}; only antd is implemented`);
    if (!qiyThemeKeys.has(project.ui.theme)) throw new Error(`Unsupported UI theme ${project.ui.theme}`);
    if (!project.ui.themes.length) throw new Error("UI themes requires at least one theme key");
    if (!project.ui.themes.includes(project.ui.theme)) throw new Error(`UI default theme ${project.ui.theme} must be included in themes`);
    if (new Set(project.ui.themes).size !== project.ui.themes.length) throw new Error("UI themes must not contain duplicates");
    for (const theme of project.ui.themes) if (!qiyThemeKeys.has(theme)) throw new Error(`Unsupported UI theme ${theme}`);
    lines.push("  ui {");
    lines.push(`    library ${project.ui.library};`);
    lines.push(`    theme ${project.ui.theme};`);
    lines.push(`    themes ${project.ui.themes.join(", ")};`);
    lines.push(`    colorMode ${project.ui.colorMode};`);
    lines.push(`    allowThemeSwitch ${project.ui.allowThemeSwitch};`);
    lines.push(`    allowColorModeSwitch ${project.ui.allowColorModeSwitch};`);
    lines.push("  }");
  }
  const corsOrigins = project.corsOrigins ? [...new Set(project.corsOrigins)] : [];
  if (corsOrigins.length) {
    if (!project.apiClient && corsOrigins.some((origin) => !/^(https?):\/\//.test(origin))) throw new Error("CORS origins require valid http(s) origins");
    for (const origin of corsOrigins) {
      if (origin === "*" || origin.includes("*")) throw new Error(`CORS origin must be an exact http(s) origin without a path or wildcard: ${origin}`);
      const parsed = new URL(origin);
      if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== origin || parsed.username || parsed.password) throw new Error(`CORS origin must be an exact http(s) origin without a path or wildcard: ${origin}`);
    }
    lines.push("  api {", `    client ${project.apiClient ?? "rest"};`, "    cors {");
    for (const origin of corsOrigins) lines.push(`      origin ${qiyString(origin)};`);
    lines.push("    }", "  }");
  } else if (project.apiClient) lines.push(`  api { client ${project.apiClient}; }`);
  if (project.features) {
    lines.push("  features {", `    overview ${project.features.overview ? "true" : "false"};`, `    apiDocs ${project.features.apiDocs ? "true" : "false"};`, `    apiKeys ${project.features.apiKeys ? "true" : "false"};`, "  }");
  }
  if (project.realtime) {
    if (!project.auth) throw new Error("Realtime requires generated authentication");
    if (!project.realtime.resources.length) throw new Error("Realtime requires at least one resource");
    lines.push("  realtime {", `    mode ${project.realtime.mode};`);
    const resources = new Set<string>();
    for (const subscription of project.realtime.resources) {
      if (resources.has(subscription.resource)) throw new Error(`Duplicate realtime resource ${subscription.resource}`);
      resources.add(subscription.resource);
      if (!subscription.events.length || new Set(subscription.events).size !== subscription.events.length) throw new Error(`Realtime resource ${subscription.resource}: events must be unique and non-empty`);
      if (!subscription.roles.length || new Set(subscription.roles).size !== subscription.roles.length) throw new Error(`Realtime resource ${subscription.resource}: roles must be unique and non-empty`);
      lines.push(`    resource ${qiyIdentifier(subscription.resource, "Realtime resource")} {`);
      lines.push(`      events ${subscription.events.join(", ")};`);
      lines.push(`      roles ${subscription.roles.join(", ")};`);
      if (subscription.claim) lines.push(`      when ${qiyIdentifier(subscription.claim.field, "Realtime claim field")} claim ${qiyClaim(subscription.claim.claim)};`);
      lines.push("    }");
    }
    lines.push("  }");
  }
  if (project.elysiaPlugins) {
    lines.push("  elysia {");
    if (project.elysiaPlugins.bearer) lines.push("    bearer;");
    if (project.elysiaPlugins.serverTiming) lines.push("    serverTiming;");
    if (project.elysiaPlugins.html) lines.push("    html;");
    if (project.elysiaPlugins.drizzle) lines.push("    drizzle;");
    if (project.elysiaPlugins.jwt) {
      lines.push("    jwt {");
      lines.push(`      name ${qiyIdentifier(project.elysiaPlugins.jwt.name, "JWT namespace")};`);
      lines.push(`      secretEnv ${qiyIdentifier(project.elysiaPlugins.jwt.secretEnv, "JWT secret env")};`);
      lines.push("    }");
    }
    if (project.elysiaPlugins.static) {
      lines.push("    static {");
      lines.push(`      assets ${qiyString(project.elysiaPlugins.static.assets)};`);
      lines.push(`      prefix ${qiyString(project.elysiaPlugins.static.prefix)};`);
      lines.push("    }");
    }
    if (project.elysiaPlugins.graphqlAdapter) lines.push(`    graphqlAdapter adapter ${project.elysiaPlugins.graphqlAdapter};`);
    if (project.elysiaPlugins.cron?.length) {
      lines.push("    cron {");
      for (const job of project.elysiaPlugins.cron) lines.push(`      job ${qiyIdentifier(job.name, "Cron job name")} pattern ${qiyString(job.pattern)} task ${job.task};`);
      lines.push("    }");
    }
    lines.push("  }");
  }  if (project.storageProvider) lines.push(`  storage { provider ${project.storageProvider}; }`);
  if (project.auth) {
    lines.push("  auth {");
  const providerList = project.auth.local ? ["local", ...(project.auth.providers ?? [])] : project.auth.providers ?? [];
  if (providerList.length > 1) lines.push(`    providers ${providerList.join(", ")};`);
  else lines.push(`    provider ${project.auth.provider};`);
  for (const mapping of project.auth.providerMappings ?? []) lines.push(`    provider ${mapping.provider} { subjectField ${mapping.subjectField};${mapping.claim ? ` claim ${mapping.claim};` : ""} }`);
    lines.push(`    user ${qiyIdentifier(project.auth.userEntity, "Auth user entity")};`);
    if (project.auth.subjectField) lines.push(`    subjectField ${qiyIdentifier(project.auth.subjectField, "Auth subject field")};`);
    lines.push(`    roleField ${qiyIdentifier(project.auth.roleField, "Auth role field")};`);
    if (project.auth.usernameField) lines.push(`    usernameField ${qiyIdentifier(project.auth.usernameField, "Auth username field")};`);
    if (project.auth.passwordField) lines.push(`    passwordField ${qiyIdentifier(project.auth.passwordField, "Auth password field")};`);
    if (project.auth.profileField) lines.push(`    profileField ${qiyIdentifier(project.auth.profileField, "Auth profile field")};`);
    lines.push("  }");
  }
  if (project.environment?.length) {
    lines.push("  env {");
    for (const variable of project.environment) {
      lines.push(`    variable ${qiyIdentifier(variable.name, "Environment variable")} {`);
      if (variable.secret) lines.push("      secret;");
      for (const mode of ["development", "production", "example"] as const) {
        const configuredValue = variable[mode];
        if (!configuredValue) continue;
        const formatted = configuredValue.kind === "value" ? qiyString(configuredValue.value) : configuredValue.kind;
        lines.push(`      ${mode} ${formatted};`);
      }
      lines.push("    }");
    }
    lines.push("  }");
  }
  if (project.messages) {
    lines.push("  messages {", `    default ${qiyString(project.messages.defaultLocale)};`);
    for (const [locale, entries] of Object.entries(project.messages.locales)) {
      lines.push(`    locale ${qiyString(locale)} {`);
      for (const [key, message] of Object.entries(entries)) lines.push(`      ${qiyString(key)} ${qiyString(message)};`);
      lines.push("    }");
    }
    lines.push("  }");
  }
  if (project.permissions) {
    const permissionAnnotations = (declaration: { label?: string; labelKey?: string; comment?: string; commentKey?: string }) => [
      declaration.label !== undefined ? ` @label(${qiyComment({ comment: declaration.label, commentKey: declaration.labelKey })})` : "",
      declaration.comment !== undefined ? ` @comment(${qiyComment({ comment: declaration.comment, commentKey: declaration.commentKey })})` : "",
    ].join("");
    for (const field of project.permissions.fields) {
      lines.push(`  permission field ${qiyIdentifier(field.name, "Permission field")} ${qiyString(field.value)}${permissionAnnotations(field)};`);
    }
    for (const group of project.permissions.groups) {
      const declaration = `  permission group ${qiyIdentifier(group.name, "Permission group")}${permissionAnnotations(group)}`;
      if (group.form === "union") lines.push(`${declaration} = ${group.members.map((member) => qiyIdentifier(member, "Permission group member")).join(" & ")};`);
      else lines.push(`${declaration} { ${group.members.map((member) => qiyIdentifier(member, "Permission group member")).join(", ")} }`);
    }
    for (const claim of project.permissions.claims ?? []) {
      lines.push(`  permission from claim ${qiyIdentifier(claim.provider, "Permission claim provider")} ${qiyClaim(claim.claim)};`);
    }
    if (project.permissions.database) {
      lines.push(`  permission from database field ${qiyIdentifier(project.permissions.database.entity, "Permission database entity")}.${qiyIdentifier(project.permissions.database.field, "Permission database field")};`);
    }
    for (const verification of project.permissions.verifications) {
      lines.push(`  permission verification ${qiyIdentifier(verification.name, "Permission verification")}${permissionAnnotations(verification)} {`);
      if (verification.inputs.length) {
        lines.push("    input {");
        for (const input of verification.inputs) lines.push(`      field ${qiyIdentifier(input.name, "Permission verification input")} ${input.type};`);
        lines.push("    }");
      }
      lines.push(`    return ${formatPermissionExpression(verification.expression)};`, "  }");
    }
  }
  for (const workflow of project.workflows ?? []) lines.push(`  workflow ${qiyIdentifier(workflow, "Workflow name")};`);
  for (const enumeration of project.database.enums ?? []) {
    lines.push(`  enum ${qiyIdentifier(enumeration.name, "Enum name")}${enumeration.comment !== undefined ? ` @comment(${qiyComment(enumeration)})` : ""} {`);
    for (const item of enumeration.values) {
      const attributes = [
        ...(item.label !== undefined ? [`label ${qiyString(item.label)}`] : []),
        ...(item.color !== undefined ? [`color ${qiyString(item.color)}`] : []),
        ...(item.icon !== undefined ? [`icon ${qiyString(item.icon)}`] : []),
        ...(item.comment !== undefined ? [`@comment(${qiyComment(item)})`] : []),
      ];
      lines.push(`    value ${qiyIdentifier(item.name, "Enum value")}${attributes.length ? ` ${attributes.join(" ")}` : ""};`);
    }
    lines.push("  }");
  }
  for (const entity of project.database.entities) {
    lines.push(`  entity ${qiyIdentifier(entity.name, "Entity name")} table ${qiyIdentifier(entity.tableName, "Table name")}${entity.label !== undefined ? ` @label(${qiyString(entity.label)})` : ""}${entity.icon !== undefined ? ` @icon(${qiyString(entity.icon)})` : ""}${entity.singular !== undefined ? ` @singular(${qiyString(entity.singular)})` : ""}${entity.plural !== undefined ? ` @plural(${qiyString(entity.plural)})` : ""}${entity.display !== undefined ? ` @display(${qiyString(entity.display)})` : ""}${entity.tableDisplay !== undefined ? ` @tableDisplay(${qiyString(entity.tableDisplay)})` : ""}${entity.relationDetail !== undefined ? ` @relationDetail(${qiyString(entity.relationDetail)})` : ""}${entity.comment !== undefined ? ` @comment(${qiyComment(entity)})` : ""} {`);
    for (const field of entity.fields) {
      const typeName = field.enumName ?? field.type;
      let declaration = `    field ${qiyIdentifier(field.name, "Field name")} ${qiyIdentifier(typeName, "Field type")}`;
      if (field.type === "Vector") declaration += `(${field.dimension})`;
      if (field.type === "Decimal" || field.type === "Money") declaration += `(${field.precision}${field.scale !== undefined ? `,${field.scale}` : ""})`;
      if (field.primaryKey !== undefined) declaration += ` @id${field.primaryKey ? "" : "(false)"}`;
      if (field.nullable !== undefined) declaration += ` @nullable${field.nullable ? "" : "(false)"}`;
      if (field.unique !== undefined) declaration += ` @unique${field.unique ? "" : "(false)"}`;
      if (field.columnName !== undefined) declaration += ` @column(${qiyString(field.columnName)})`;
      if (field.extension !== undefined) declaration += ` @extension(${qiyIdentifier(field.extension, "Field extension")})`;
      if (field.label !== undefined) declaration += ` @label(${qiyString(field.label)})`;
      if (field.comment !== undefined) declaration += ` @comment(${qiyComment(field)})`;
      if (field.icon !== undefined) declaration += ` @icon(${qiyString(field.icon)})`;
      for (const [attribute, value] of [
        ["visible", field.visible],
        ["listVisible", field.listVisible],
        ["formVisible", field.formVisible],
        ["showVisible", field.showVisible],
        ["sortable", field.sortable],
        ["filterable", field.filterable],
      ] as const) {
        if (value !== undefined) declaration += ` @${attribute}(${value})`;
      }
      if (field.filterModes?.length) declaration += ` @filter(${field.filterModes.join(",")})`;
      if (field.uploadMode !== undefined) declaration += ` @upload(${field.uploadMode})`;
      if (field.maxBytes !== undefined) declaration += ` @maxBytes(${field.maxBytes})`;
      if (field.mimeTypes?.length) declaration += ` @mime(${field.mimeTypes.map(qiyString).join(",")})`;
      if (field.maxFiles !== undefined) declaration += ` @maxFiles(${field.maxFiles})`;
      if (field.codeTemplate !== undefined) declaration += ` @code(${qiyString(field.codeTemplate)})`;
      if (field.generatedValue !== undefined) declaration += ` @generated(${field.generatedValue})`;
      lines.push(`${declaration};`);
    }
    for (const index of entity.indexes ?? []) {
      const columns = index.columns.map((column) => `${qiyIdentifier(column.fieldName, "Index field")}${column.opclass ? ` ${qiyIdentifier(column.opclass, "Index operator class")}` : ""}`).join(", ");
      let declaration = `    index ${qiyIdentifier(index.name, "Index name")} ${index.method} (${columns})`;
      if (index.unique !== undefined) declaration += ` @unique${index.unique ? "" : "(false)"}`;
      if (index.concurrently !== undefined) declaration += ` @concurrently${index.concurrently ? "" : "(false)"}`;
      if (index.comment !== undefined) declaration += ` @comment(${qiyComment(index)})`;
      lines.push(`${declaration};`);
    }
    lines.push("  }");
  }
  for (const relation of project.database.relations ?? []) {
    let declaration = `  relation ${qiyIdentifier(relation.name, "Relation name")} ${qiyIdentifier(relation.fromEntity, "Relation source entity")} ${qiyIdentifier(relation.fromField, "Relation source field")} ${qiyIdentifier(relation.toEntity, "Relation target entity")} ${qiyIdentifier(relation.toField, "Relation target field")} ${relation.cardinality}`;
    if (relation.onDelete) declaration += ` @onDelete(${relation.onDelete})`;
    if (relation.comment !== undefined) declaration += ` @comment(${qiyComment(relation)})`;
    lines.push(`${declaration};`);
  }
  for (const scope of project.scopes ?? []) {
    const tree = scope.tree ? ` tree ${qiyIdentifier(scope.tree.entity, "Scope tree entity")} ${qiyIdentifier(scope.tree.parentField, "Scope tree parent field")}` : "";
    lines.push(`  scope ${qiyIdentifier(scope.resource, "Scope resource")} ${qiyIdentifier(scope.field, "Scope field")} claim ${scope.claim.split(".").map((part) => qiyIdentifier(part, "Scope claim")).join(".")}${tree};`);
  }
  for (const restriction of project.restrictions ?? []) {
    lines.push(`  restrict ${qiyIdentifier(restriction.resource, "Restrict resource")} {`);
    if (restriction.roles) lines.push(`    allow roles ${restriction.roles.join(", ")};`);
    const predicateText = (row: QiyRowPredicate) => row.source === "claim"
      ? `${qiyIdentifier(row.field, "Restrict field")} claim ${qiyClaim(row.claim!)}`
      : `${qiyIdentifier(row.field, "Restrict field")} ${row.operator} ${row.values!.map(qiyString).join(", ")}`;
    for (const row of restriction.rows ?? []) lines.push(`    when ${predicateText(row)};`);
    for (const group of restriction.groups ?? []) lines.push(`    when ( ${group.map(predicateText).join(" or ")} );`);
    /** Prints an expression, parenthesizing nested groups so the output re-parses to the same tree. */
    const expressionText = (node: QiyPolicyExpression): string => {
      if (node.kind === "predicate") return predicateText(node.predicate);
      if (node.kind === "cross") return `${qiyIdentifier(node.field, "Restrict field")} ${node.operator} field ${qiyIdentifier(node.otherField, "Restrict cross field")}`;
      if (node.kind === "scope") return "scope";
      if (node.kind === "not") {
        const inner = expressionText(node.expression);
        const needsParens = node.expression.kind === "and" || node.expression.kind === "or";
        return `not ${needsParens ? `( ${inner} )` : inner}`;
      }
      return node.children.map((child) => {
        const inner = expressionText(child);
        return child.kind === "and" || child.kind === "or" ? `( ${inner} )` : inner;
      }).join(` ${node.kind} `);
    };
    for (const expression of restriction.expressions ?? []) lines.push(`    when ${expressionText(expression)};`);
    for (const mask of restriction.masks ?? []) {
      let declaration = `    mask ${qiyIdentifier(mask.field, "Mask field")}`;
      if (mask.roles) declaration += ` roles ${mask.roles.join(", ")}`;
      if (mask.claim) declaration += ` claim ${mask.claimState ?? "present"} ${qiyClaim(mask.claim)}`;
      declaration += ` mode ${mask.mode}`;
      if (mask.replacement !== undefined) declaration += ` replacement ${qiyString(mask.replacement)}`;
      lines.push(`${declaration};`);
    }
    lines.push("  }");
  }
  for (const page of project.pages ?? []) {
    lines.push(`  pages ${qiyIdentifier(page.resource, "Pages resource")} {`);
    for (const entry of page.actions) lines.push(`    ${entry.action} roles ${entry.roles.join(", ")};`);
    for (const entry of page.fields ?? []) lines.push(`    field ${qiyIdentifier(entry.field, "Pages field")} roles ${entry.roles.join(", ")};`);
    lines.push("  }");
  }
  if (project.menuGroups?.length) {
    lines.push("  menu {");
    for (const group of project.menuGroups) {
      let declaration = `    group ${qiyIdentifier(group.name, "Menu group name")} @label(${qiyString(group.label)})`;
      if (group.icon) declaration += ` @icon(${qiyString(group.icon)})`;
      if (group.parent) declaration += ` @parent(${qiyString(group.parent)})`;
      if (group.comment !== undefined) declaration += ` @comment(${qiyComment(group)})`;
      lines.push(`${declaration} {`);
      for (const resource of group.resources) lines.push(`      resource ${qiyIdentifier(resource, "Menu resource")};`);
      lines.push("    }");
    }
    lines.push("  }");
  }
  if (project.dashboardMetrics?.length) {
    lines.push("  dashboard {");
    for (const metric of project.dashboardMetrics) {
      let declaration = `    metric ${qiyIdentifier(metric.name, "Metric name")} ${qiyIdentifier(metric.resource, "Metric resource")} @label(${qiyString(metric.label)}) @span(${metric.span})`;
      if (metric.icon) declaration += ` @icon(${qiyString(metric.icon)})`;
      if (metric.type) declaration += ` @type(${metric.type})`;
      if (metric.groupBy) declaration += ` @groupBy(${qiyString(metric.groupBy)})`;
      if (metric.field) declaration += ` @field(${qiyString(metric.field)})`;
      if (metric.agg) declaration += ` @agg(${metric.agg})`;
      if (metric.days !== undefined) declaration += ` @days(${metric.days})`;
      if (metric.comment !== undefined) declaration += ` @comment(${qiyComment(metric)})`;
      lines.push(`${declaration};`);
    }
    lines.push("  }");
  }
  for (const chart of project.charts ?? []) {
    for (const view of chart.views) {
      const data = view.data;
      const operation = data.operation;
      const dataText = operation === "count"
        ? `count ${qiyIdentifier(data.entity, "Chart entity")}${data.groupBy ? ` group by ${qiyIdentifier(data.groupBy, "Chart group by field")}` : ""}`
        : operation === "trend"
          ? `trend ${qiyIdentifier(data.entity, "Chart entity")}.${qiyIdentifier(data.field!, "Chart trend field")} days ${data.days}`
          : operation === "list"
            ? `list ${qiyIdentifier(data.entity, "Chart entity")} columns ${(data.columns ?? []).map((column) => qiyIdentifier(column, "Chart table column")).join(", ")}`
            : `${operation} ${qiyIdentifier(data.entity, "Chart entity")}.${qiyIdentifier(data.field!, "Chart aggregate field")}${data.groupBy ? ` group by ${qiyIdentifier(data.groupBy, "Chart group by field")}` : ""}`;
      lines.push(`  chart ${view.kind === "const" ? "const" : view.kind} ${qiyIdentifier(chart.name, "Chart name")} {`);
      if (view.icon !== undefined) lines.push(`    icon = ${qiyString(view.icon)};`);
      if (view.title !== undefined) lines.push(`    title = ${qiyString(view.title)};`);
      lines.push(`    data = ${dataText};`);
      if (view.labels?.field !== undefined) lines.push(`    labels = ${qiyIdentifier(view.labels.field, "Chart labels field")};`);
      else if (view.labels?.values?.length) {
        lines.push("    labels {");
        for (const entry of view.labels.values) lines.push(`      ${qiyIdentifier(entry.value, "Chart label value")} ${qiyString(entry.label)};`);
        lines.push("    }");
      }
      lines.push("  }");
    }
  }
  for (const panel of project.chartPanels ?? []) {
    lines.push(`  chart panels ${qiyIdentifier(panel.name, "Chart panel name")} {`);
    if (panel.title !== undefined) lines.push(`    title = ${qiyString(panel.title)};`);
    lines.push(`    grid ${panel.grid.columns} ${panel.grid.rows};`);
    for (const chart of panel.charts) {
      lines.push(`    ${qiyIdentifier(chart.name, "Chart panel reference")} {`);
      for (const placement of chart.placements) lines.push(`      ${placement.variant} ${placement.x} ${placement.y} ${placement.w} ${placement.h};`);
      lines.push("    }");
    }
    lines.push("  }");
  }
  for (const flow of project.dataflows ?? []) {
    const annotations = [
      flow.label !== undefined ? ` @label(${qiyComment({ comment: flow.label, commentKey: flow.labelKey })})` : "",
      flow.confirm !== undefined ? ` @confirm(${qiyComment({ comment: flow.confirm, commentKey: flow.confirmKey })})` : "",
      flow.comment !== undefined ? ` @comment(${qiyComment(flow)})` : "",
    ].join("");
    lines.push(`  dataflow ${qiyIdentifier(flow.name, "Dataflow name")}${annotations} {`);
    if (flow.roles) lines.push(`    allow roles ${flow.roles.join(", ")};`);
    else if (flow.permission) lines.push(`    allow permission ${flow.permission.map((reference) => qiyIdentifier(reference, "Dataflow permission")).join(", ")};`);
    else if (flow.verification) lines.push(`    allow verification ${qiyIdentifier(flow.verification, "Dataflow permission verification")};`);
    if (flow.idempotency?.required) lines.push("    idempotency required;");
    if (flow.audit !== undefined) lines.push(`    audit ${qiyString(flow.audit)};`);
    lines.push("    input {");
    for (const field of flow.input) {
      const attributes = [field.required ? " @required" : "", field.comment !== undefined ? ` @comment(${qiyComment(field)})` : ""].join("");
      lines.push(`      field ${qiyIdentifier(field.name, "Dataflow input")} ${qiyIdentifier(field.type, "Dataflow input type")}${attributes};`);
    }
    lines.push("    }", "    context {");
    for (const binding of flow.context) {
      const [key, source] = binding.id.split(":", 2);
      const attributes = [binding.required ? " @required" : "", binding.comment !== undefined ? ` @comment(${qiyComment(binding)})` : ""].join("");
      lines.push(`      ${qiyIdentifier(binding.name, "Dataflow context")} = entity ${qiyIdentifier(binding.entity, "Dataflow entity")} by ${qiyIdentifier(key!, "Dataflow key")} ${source}${attributes};`);
    }
    lines.push("    }");
    for (const step of flow.steps) {
      const comment = step.comment !== undefined ? ` @comment(${qiyComment(step)})` : "";
      lines.push(`    step ${qiyIdentifier(step.name, "Dataflow step")} @order(${step.order})${comment} {`);
      for (const action of step.actions) {
        if (action.kind === "require") lines.push(`      require ${action.left} ${action.operator} ${typeof action.right === "number" ? action.right : qiyString(action.right)} @error(${action.errorKey ? `t(${qiyString(action.errorKey)})` : qiyString(action.error)});`);
        else if (action.kind === "update") {
          lines.push(`      update ${qiyIdentifier(action.context, "Dataflow context")} {`);
          for (const value of action.values) lines.push(`        ${qiyIdentifier(value.field, "Dataflow update field")} = ${value.source === "input" ? `input.${qiyIdentifier(value.value, "Dataflow input field")}` : qiyString(value.value)};`);
          lines.push("      }");
        } else if (action.kind === "create") {
          lines.push(`      create ${qiyIdentifier(action.context, "Dataflow created context")} = entity ${qiyIdentifier(action.entity, "Dataflow create entity")} {`);
          for (const value of action.values) lines.push(`        ${qiyIdentifier(value.field, "Dataflow create field")} = ${value.source === "input" ? `input.${qiyIdentifier(value.value, "Dataflow input field")}` : qiyString(value.value)};`);
          lines.push("      }");
        } else if (action.kind === "delete") {
          lines.push(`      delete ${qiyIdentifier(action.context, "Dataflow deleted context")};`);
        } else if (action.kind === "call") {
          if (action.payload?.length) {
            lines.push(`      call ${qiyIdentifier(action.adapter, "Dataflow call adapter")} {`);
            for (const value of action.payload) {
              const source = value.source === "literal" ? (typeof value.value === "number" ? String(value.value) : qiyString(value.value)) : value.source === "input" ? `input.${qiyIdentifier(String(value.value), "Dataflow call input")}` : `${qiyIdentifier(value.context!, "Dataflow call context")}.${qiyIdentifier(String(value.value), "Dataflow call field")}`;
              lines.push(`        ${qiyIdentifier(value.name, "Dataflow call payload field")} = ${source};`);
            }
            lines.push("      }");
          } else {
            lines.push(`      call ${qiyIdentifier(action.adapter, "Dataflow call adapter")};`);
          }
        } else if (action.payload?.length) {
          lines.push(`      emit ${qiyString(action.event)} {`);
          for (const value of action.payload) {
            const source = value.source === "literal" ? (typeof value.value === "number" ? String(value.value) : qiyString(value.value)) : value.source === "input" ? `input.${qiyIdentifier(String(value.value), "Dataflow emit input")}` : `${qiyIdentifier(value.context!, "Dataflow emit context")}.${qiyIdentifier(String(value.value), "Dataflow emit field")}`;
            lines.push(`        ${qiyIdentifier(value.name, "Dataflow emit payload field")} = ${source};`);
          }
          lines.push("      }");
        } else {
          lines.push(`      emit ${qiyString(action.event)};`);
        }
      }
      lines.push("    }");
    }
    lines.push(`    result { return ${qiyIdentifier(flow.result, "Dataflow result")}; }`, "  }");
  }
  for (const action of project.actions ?? []) {
    lines.push(`  action ${qiyIdentifier(action.name, "Action name")} {`);
    if (action.roles) lines.push(`    allow roles ${action.roles.join(", ")};`);
    else if (action.permission) lines.push(`    allow permission ${action.permission.map((reference) => qiyIdentifier(reference, "Action permission")).join(", ")};`);
    else if (action.verification) lines.push(`    allow verification ${qiyIdentifier(action.verification, "Action permission verification")};`);
    lines.push(`    resource ${qiyIdentifier(action.resource, "Action resource")};`);
    if (action.target.kind === "dataflow") {
      lines.push(`    dataflow ${qiyIdentifier(action.target.dataflow, "Action dataflow")};`);
    } else {
      lines.push(`    navigate ${qiyString(action.target.path)};`);
    }
    lines.push(`    placement ${action.placements.join(", ")};`);
    if (action.batch) lines.push("    batch true;");
    lines.push(`    label ${action.labelKey ? `t(${qiyString(action.labelKey)})` : qiyString(action.label)};`);
    if (action.condition) lines.push(`    when ${qiyIdentifier(action.condition.field, "Action condition field")} ${action.condition.operator} ${qiyString(action.condition.value)};`);
    if (action.target.kind === "dataflow" && action.target.confirm !== undefined) lines.push(`    confirm ${action.target.confirmKey ? `t(${qiyString(action.target.confirmKey)})` : qiyString(action.target.confirm)};`);
    if (action.target.kind === "navigate") lines.push(`    page manual @comment(${qiyComment(action.target)});`);
    lines.push("  }");
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}



