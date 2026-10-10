import { validateDatabaseIR, type DatabaseIR, type EntityIR, type FieldIR, type IndexIR, type IndexColumnIR, type RelationIR } from "./database-ir";

export interface QiyProject {
  name: string;
  database: DatabaseIR;
  workspace?: QiyWorkspaceConfig;
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
  auth?: { provider: "local" | "oidc" | "oauth2" | "sso"; userEntity: string; subjectField: string; roleField: string; usernameField?: string; passwordField?: string };
  menuGroups?: Array<{ name: string; label: string; icon?: string; parent?: string; resources: string[] }>;
  dashboardMetrics?: Array<{ name: string; resource: string; label: string; icon?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend"; groupBy?: string; days?: number }>;
  scopes?: Array<{ resource: string; field: string; claim: string }>;
  workflows?: Array<"orderInventory">;
}

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
  const pattern = /\s+|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[a-zA-Z_][a-zA-Z_0-9-]*|\d+|[{}();,@.]/g;
  const tokens: string[] = []; 
  let end = 0;
  for (const match of input.matchAll(pattern)) {
    if (match.index !== end) throw new Error(`Unexpected Qiy syntax at offset ${end}`);
    if (!/^\s|^\/\//.test(match[0])) tokens.push(match[0]);
    end += match[0].length;
  }
  if (end !== input.length) throw new Error(`Unexpected Qiy syntax at offset ${end}`);
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
    if (!["UUID", "Text", "Integer", "Decimal", "Money", "DateTime", "File", "Vector"].includes(type) && !enumNames.has(type)) throw new Error(`Unsupported field type ${type}`);
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
      else if (attribute === "icon") { expect("("); result.icon = value(); expect(")"); }
      else if (attribute === "visible") { expect("("); result.visible = boolean(); expect(")"); }
      else if (attribute === "listVisible") { expect("("); result.listVisible = boolean(); expect(")"); }
      else if (attribute === "formVisible") { expect("("); result.formVisible = boolean(); expect(")"); }
      else if (attribute === "showVisible") { expect("("); result.showVisible = boolean(); expect(")"); }
      else if (attribute === "sortable") { expect("("); result.sortable = boolean(); expect(")"); }
      else if (attribute === "filterable") { expect("("); result.filterable = boolean(); expect(")"); }
      else if (attribute === "extension") {
        expect("(");
        const extension = value();
        if (extension) result.extension = extension;
        expect(")");
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
      else throw new Error(`Unsupported index attribute @${attribute}`);
    }
    expect(";");
    return result;
  }
  function entity(enumNames: Set<string>): EntityIR {
    expect("entity");
    const name = identifier();
    let tableName = name;
    if (peek() === "table") { expect("table"); tableName = identifier(); }
    let label: string | undefined;
    let icon: string | undefined;
    while (peek() === "@") {
      expect("@");
      const attribute = identifier();
      expect("(");
      if (attribute === "label") label = value();
      else if (attribute === "icon") icon = value();
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
    return { name, tableName, fields, indexes, ...(label && { label }), ...(icon && { icon }) };
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
    while (peek() === "@") {
      expect("@");
      const attribute = identifier();
      if (attribute !== "onDelete") throw new Error(`Unsupported relation attribute @${attribute}`);
      expect("(");
      const action = value();
      if (!action) { expect(")"); continue; }
      if (action !== "restrict" && action !== "cascade" && action !== "setNull") throw new Error(`Unsupported onDelete action ${action}`);
      onDelete = action;
      expect(")");
    }
    expect(";");
    return { name, fromEntity, fromField, toEntity, toField, cardinality, ...(onDelete && { onDelete }) };
  }
  function menuGroup(): NonNullable<QiyProject["menuGroups"]>[number] {
    expect("group");
    const name = identifier();
    let label = name;
    let icon: string | undefined;
    let parent: string | undefined;
    while (peek() === "@") {
      expect("@");
      const attribute = identifier();
      expect("(");
      if (attribute === "label") label = value();
      else if (attribute === "icon") icon = value();
      else if (attribute === "parent") parent = value();
      else throw new Error(`Unsupported menu group attribute @${attribute}`);
      expect(")");
    }
    expect("{");
    const resources: string[] = [];
    while (peek() !== "}") { expect("resource"); resources.push(identifier()); expect(";"); }
    expect("}");
    return { name, label, ...(icon && { icon }), ...(parent && { parent }), resources };
  }
  function dashboardMetric(): NonNullable<QiyProject["dashboardMetrics"]>[number] {
    expect("metric");
    const name = identifier();
    const resource = identifier();
    let label = name;
    let icon: string | undefined;
    let span: 8 | 12 | 24 = 8;
    let type: "count" | "distribution" | "trend" = "count";
    let groupBy: string | undefined;
    let days: number | undefined;
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
        if (metricType !== "" && metricType !== "count" && metricType !== "distribution" && metricType !== "trend") throw new Error(`Dashboard metric ${name}: type must be count, distribution or trend`);
        type = metricType === "" ? "count" : metricType;
      } else if (attribute === "groupBy") groupBy = value() || undefined;
      else if (attribute === "days") { const metricDays = integer(); days = metricDays > 0 ? metricDays : undefined; }
      else throw new Error(`Unsupported dashboard metric attribute @${attribute}`);
      expect(")");
    }
    expect(";");
    return { name, resource, label, span, ...(icon && { icon }), ...(type !== "count" && { type }), ...(groupBy && { groupBy }), ...(days !== undefined && { days }) };
  }
  function enumeration(): import("./database-ir").EnumIR {
    expect("enum");
    const name = identifier();
    expect("{");
    const values: import("./database-ir").EnumValueIR[] = [];
    while (peek() !== "}") {
      expect("value");
      const valueName = identifier();
      const item: import("./database-ir").EnumValueIR = { name: valueName };
      while (peek() === "label" || peek() === "color" || peek() === "icon") {
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
    return { name, values };
  }
  expect("qiy");
  expect("v0");
  expect(";");
  expect("application");
  const name = identifier();
  const packageName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!/^[a-z][a-z0-9-]*$/.test(packageName)) throw new Error("Qiy project name must normalize to a lowercase package name");
  expect("{");
  expect("database");
  const dialect = identifier();
  if (!["postgresql", "mysql", "sqlite"].includes(dialect)) throw new Error(`Unsupported database dialect ${dialect}`);
  expect("{");
  const extensions: string[] = [];
  while (peek() !== "}") { expect("extension"); extensions.push(identifier()); expect(";"); }
  expect("}");
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
    while (peek() !== "}") {
      const key = identifier();
      if (!["provider", "user", "subjectField", "roleField", "usernameField", "passwordField"].includes(key)) throw new Error(`Unsupported auth attribute ${key}`);
      if (Object.hasOwn(attributes, key)) throw new Error(`Duplicate auth attribute ${key}`);
      attributes[key] = identifier();
      expect(";");
    }
    expect("}");
    const provider = attributes.provider ?? "";
    if (provider !== "local" && provider !== "oidc" && provider !== "oauth2" && provider !== "sso") throw new Error(`Unsupported auth provider ${provider || "(missing)"}`);
    if (!attributes.user) throw new Error("Auth requires a user entity");
    if (!attributes.roleField) throw new Error("Auth requires roleField");
    const subjectField = attributes.subjectField ?? "";
    if (provider !== "local" && !subjectField) throw new Error(`Auth provider ${provider} requires subjectField`);
    const usernameField = attributes.usernameField ?? "";
    const passwordField = attributes.passwordField ?? "";
    if (provider === "local" && (!usernameField || !passwordField)) throw new Error("Auth provider local requires usernameField and passwordField");
    if (provider !== "local" && (usernameField || passwordField)) throw new Error(`Auth provider ${provider} does not accept usernameField or passwordField`);
    auth = {
      provider: provider as "local" | "oidc" | "oauth2" | "sso",
      userEntity: attributes.user,
      subjectField,
      roleField: attributes.roleField,
      ...(usernameField && { usernameField }),
      ...(passwordField && { passwordField }),
    };
  }
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
    expect(";");
    scopes.push({ resource, field, claim });
  }
  const menuGroups: NonNullable<QiyProject["menuGroups"]> = [];
  if (peek() === "menu") {
    expect("menu"); expect("{");
    while (peek() !== "}") menuGroups.push(menuGroup());
    expect("}");
  }
  const dashboardMetrics: NonNullable<QiyProject["dashboardMetrics"]> = [];
  if (peek() === "dashboard") {
    expect("dashboard"); expect("{");
    while (peek() !== "}") dashboardMetrics.push(dashboardMetric());
    expect("}");
  }
  expect("}");
  expect("<end>");
  return { name: packageName, database: { dialect: dialect as DatabaseIR["dialect"], extensions, entities, ...(enums.length ? { enums } : {}), ...(relations.length ? { relations } : {}) }, ...(workspace && { workspace }), ...(apiClient && { apiClient }), ...(corsOrigins && { corsOrigins }), ...(elysiaPlugins && { elysiaPlugins }), ...(storageProvider && { storageProvider }), ...(auth && { auth }), ...(scopes.length ? { scopes } : {}), ...(workflows.length ? { workflows } : {}), ...(menuGroups.length && { menuGroups }), ...(dashboardMetrics.length && { dashboardMetrics }) };
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

export function serializeQiyProject(project: QiyProject): string {
  const errors = validateDatabaseIR(project.database);
  if (errors.length) throw new Error(errors.join("`n"));
  const name = normalizePackageName(project.name);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Qiy project name must normalize to a lowercase package name");
  const lines = ["qiy v0;", `application ${name} {`, `  database ${project.database.dialect} {`];
  for (const extension of project.database.extensions) lines.push(`    extension ${qiyIdentifier(extension, "Database extension")};`);
  lines.push("  }");
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
    lines.push(`    provider ${project.auth.provider};`);
    lines.push(`    user ${qiyIdentifier(project.auth.userEntity, "Auth user entity")};`);
    if (project.auth.subjectField) lines.push(`    subjectField ${qiyIdentifier(project.auth.subjectField, "Auth subject field")};`);
    lines.push(`    roleField ${qiyIdentifier(project.auth.roleField, "Auth role field")};`);
    if (project.auth.usernameField) lines.push(`    usernameField ${qiyIdentifier(project.auth.usernameField, "Auth username field")};`);
    if (project.auth.passwordField) lines.push(`    passwordField ${qiyIdentifier(project.auth.passwordField, "Auth password field")};`);
    lines.push("  }");
  }
  for (const workflow of project.workflows ?? []) lines.push(`  workflow ${qiyIdentifier(workflow, "Workflow name")};`);
  for (const enumeration of project.database.enums ?? []) {
    lines.push(`  enum ${qiyIdentifier(enumeration.name, "Enum name")} {`);
    for (const item of enumeration.values) {
      const attributes = [
        ...(item.label !== undefined ? [`label ${qiyString(item.label)}`] : []),
        ...(item.color !== undefined ? [`color ${qiyString(item.color)}`] : []),
        ...(item.icon !== undefined ? [`icon ${qiyString(item.icon)}`] : []),
      ];
      lines.push(`    value ${qiyIdentifier(item.name, "Enum value")}${attributes.length ? ` ${attributes.join(" ")}` : ""};`);
    }
    lines.push("  }");
  }
  for (const entity of project.database.entities) {
    lines.push(`  entity ${qiyIdentifier(entity.name, "Entity name")} table ${qiyIdentifier(entity.tableName, "Table name")}${entity.label !== undefined ? ` @label(${qiyString(entity.label)})` : ""}${entity.icon !== undefined ? ` @icon(${qiyString(entity.icon)})` : ""} {`);
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
      lines.push(`${declaration};`);
    }
    for (const index of entity.indexes ?? []) {
      const columns = index.columns.map((column) => `${qiyIdentifier(column.fieldName, "Index field")}${column.opclass ? ` ${qiyIdentifier(column.opclass, "Index operator class")}` : ""}`).join(", ");
      let declaration = `    index ${qiyIdentifier(index.name, "Index name")} ${index.method} (${columns})`;
      if (index.unique !== undefined) declaration += ` @unique${index.unique ? "" : "(false)"}`;
      if (index.concurrently !== undefined) declaration += ` @concurrently${index.concurrently ? "" : "(false)"}`;
      lines.push(`${declaration};`);
    }
    lines.push("  }");
  }
  for (const relation of project.database.relations ?? []) {
    let declaration = `  relation ${qiyIdentifier(relation.name, "Relation name")} ${qiyIdentifier(relation.fromEntity, "Relation source entity")} ${qiyIdentifier(relation.fromField, "Relation source field")} ${qiyIdentifier(relation.toEntity, "Relation target entity")} ${qiyIdentifier(relation.toField, "Relation target field")} ${relation.cardinality}`;
    if (relation.onDelete) declaration += ` @onDelete(${relation.onDelete})`;
    lines.push(`${declaration};`);
  }
  for (const scope of project.scopes ?? []) {
    lines.push(`  scope ${qiyIdentifier(scope.resource, "Scope resource")} ${qiyIdentifier(scope.field, "Scope field")} claim ${scope.claim.split(".").map((part) => qiyIdentifier(part, "Scope claim")).join(".")};`);
  }
  if (project.menuGroups?.length) {
    lines.push("  menu {");
    for (const group of project.menuGroups) {
      let declaration = `    group ${qiyIdentifier(group.name, "Menu group name")} @label(${qiyString(group.label)})`;
      if (group.icon) declaration += ` @icon(${qiyString(group.icon)})`;
      if (group.parent) declaration += ` @parent(${qiyString(group.parent)})`;
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
      if (metric.days !== undefined) declaration += ` @days(${metric.days})`;
      lines.push(`${declaration};`);
    }
    lines.push("  }");
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}



