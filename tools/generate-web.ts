import type { DatabaseIR, FieldIR } from "./database-ir";
import { renderAppTemplate } from "./admin-template";
import { validateDatabaseIR } from "./database-ir";
import type { QiyProject } from "./qiy-project";

type WebOptions = Pick<QiyProject, "apiClient" | "menuGroups" | "dashboardMetrics" | "auth" | "workflows">;

function resourceFields(database: DatabaseIR, menuGroups: NonNullable<QiyProject["menuGroups"]>): string {
  const enumByName = new Map((database.enums ?? []).map((enumeration) => [enumeration.name, enumeration.values]));
  const entityByName = new Map(database.entities.map((entity) => [entity.name, entity]));
  const parentByResource = new Map(menuGroups.flatMap((group) => group.resources.map((resource) => [resource, `menu-${group.name}`] as const)));
  return JSON.stringify(database.entities.map((entity) => ({
    name: entity.tableName,
    apiName: entity.name,
    label: entity.label ?? entity.name,
    icon: entity.icon ?? (entity.name.toLowerCase().includes("user") ? "UserOutlined" : entity.name.toLowerCase().includes("order") ? "ShoppingOutlined" : entity.name.toLowerCase().includes("warehouse") ? "DatabaseOutlined" : "TableOutlined"),
    ...(parentByResource.has(entity.tableName) && { menuParent: parentByResource.get(entity.tableName) }),
    ...(database.relations?.some((relation) => relation.toEntity === entity.name) && { relatedResources: database.relations.filter((relation) => relation.toEntity === entity.name).map((relation) => ({ resource: entityByName.get(relation.fromEntity)!.tableName, field: relation.fromField, label: entityByName.get(relation.fromEntity)!.label ?? entityByName.get(relation.fromEntity)!.name })) }),
    fields: entity.fields.map((field) => {
      const relation = (database.relations ?? []).find((candidate) => candidate.fromEntity === entity.name && candidate.fromField === field.name);
      const target = relation && entityByName.get(relation.toEntity);
      return {
      name: field.name,
      label: field.label ?? field.name,
      type: field.type,
      nullable: Boolean(field.nullable),
      primaryKey: Boolean(field.primaryKey),
      visible: field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      listVisible: field.listVisible ?? field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      formVisible: field.formVisible ?? field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      showVisible: field.showVisible ?? field.visible ?? (!field.primaryKey && field.type !== "Vector"),
      sortable: field.sortable ?? true,
      filterable: field.filterable ?? true,
      ...(field.enumName && { enumName: field.enumName, enumValues: enumByName.get(field.enumName) ?? [] }),
      ...(target && { relation: { resource: target.tableName, labelField: target.fields.find((candidate) => ["name", "title", "displayName", "code"].includes(candidate.name))?.name ?? "id" } }),
      ...(field.icon && { icon: field.icon }),
      ...(field.type === "Vector" && { dimension: field.dimension }),
    }; }),
  })), null, 2);
}

function editable(field: FieldIR): boolean { return !field.primaryKey && field.type !== "Vector"; }

export function generateWeb(database: DatabaseIR, options: WebOptions = {}): Record<string, string> {
  const supportsExternalToken = options.auth?.provider !== "local";
  const errors = validateDatabaseIR(database);
  const menuGroups = options.menuGroups ?? [];
  const groupNames = new Set<string>();
  const assignedResources = new Set<string>();
  const resourceNames = database.entities.map((entity) => entity.tableName);
  const dashboardNames = new Set<string>();
  const iconNames = [...new Set([
    "AppstoreOutlined", "DatabaseOutlined", "ShoppingOutlined", "TableOutlined", "UserOutlined",
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
    if (entity.fields.some((field) => field.type === "Vector" && !field.nullable)) errors.push(`${entity.name}: V0 dashboard cannot edit a required Vector field`);
    for (const field of entity.fields) {
      if (!field.primaryKey && !field.nullable && field.type !== "Vector" && !(field.formVisible ?? field.visible ?? true)) errors.push(`${entity.name}.${field.name}: required field cannot be hidden from the create form`);
    }
    if (!entity.fields.some(editable)) errors.push(`${entity.name}: V0 dashboard requires an editable field`);
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
  return {
    ...template,
    "web/app/root.tsx": root
      .replace("__QIY_AUTH_IMPORT__", options.auth ? 'import { qiyAccessControlProvider, qiyAuthProvider } from "./auth";\nimport { Authenticated } from "@refinedev/core";\nimport { Navigate, useLocation } from "react-router";' : "")
      .replace("__QIY_AUTH_PROPS__", options.auth ? "authProvider={qiyAuthProvider} accessControlProvider={qiyAccessControlProvider}" : "")
      .replace("__QIY_AUTH_LOCATION__", options.auth ? "const location = useLocation();" : "")
      .replace("__QIY_LAYOUT_START__", options.auth ? '{location.pathname === "/auth/login" ? <Outlet /> : <Authenticated key="protected" fallback={<Navigate to="/auth/login" replace />}> ' : "")
      .replace("__QIY_LAYOUT_END__", options.auth ? "</Authenticated>}" : ""),
    "web/app/routes/show.tsx": show
      .replace("__QIY_ORDER_IMPORT__", [hasOrderWorkflow ? 'import { OrderWorkflowActions } from "../features/orders/order-actions";' : "", hasRelatedResources ? 'import { RelatedRecords } from "../components/related-records";' : ""].filter(Boolean).join("\n"))
      .replace("__QIY_ORDER_ACTIONS__", [hasOrderWorkflow ? '{resource.name === "orders" && result && id && <OrderWorkflowActions id={id} status={String(result.status ?? "")} />}' : "", hasRelatedResources ? '{result && id && (resource.relatedResources ?? []).map((relation) => <RelatedRecords key={relation.resource + relation.field} relation={relation} recordId={id} />)}' : ""].join("")),
    ...(hasOrderWorkflow ? {
      "web/app/features/orders/order-actions.tsx": `import { CanAccess, useCustomMutation, useGetIdentity, useInvalidate } from "@refinedev/core";
import { Button, Popconfirm, Space, message } from "antd";

type Command = "submit" | "approve" | "ship" | "cancel";
export function OrderWorkflowActions({ id, status }: { id: string; status: string }) {
  const { data: identity } = useGetIdentity<{ role?: string }>();
  const { mutateAsync, mutation } = useCustomMutation();
  const invalidate = useInvalidate();
  const run = async (command: Command) => {
    try {
      await mutateAsync({ url: \`/api/v1/orders/\${encodeURIComponent(id)}/\${command}\`, method: "post", values: {}, ...(command === "submit" ? { meta: { idempotencyKey: crypto.randomUUID() } } : {}) });
      await invalidate({ resource: "orders", id, invalidates: ["detail", "list"] });
      void message.success("操作成功");
    } catch (error) { void message.error(String(error)); }
  };
  return <CanAccess resource="orders" action="edit"><Space wrap style={{ marginTop: 16 }}>
    {status === "draft" && <Button type="primary" loading={mutation.isPending} onClick={() => void run("submit")}>提交订单</Button>}
    {status === "submitted" && identity?.role === "admin" && <Button type="primary" loading={mutation.isPending} onClick={() => void run("approve")}>审批订单</Button>}
    {status === "approved" && <Popconfirm title="确认出库并扣减库存？" onConfirm={() => void run("ship")}><Button type="primary" loading={mutation.isPending}>出库</Button></Popconfirm>}
    {(status === "draft" || status === "submitted") && <Popconfirm title="确认取消订单并释放预占？" onConfirm={() => void run("cancel")}><Button danger loading={mutation.isPending}>取消订单</Button></Popconfirm>}
  </Space></CanAccess>;
}
`,
    } : {}),
    "web/app/icons.tsx": `import { ${iconNames.join(", ")} } from "@ant-design/icons";
export const qiyIcons = { ${iconNames.join(", ")} };
`,
    "web/app/data-provider.ts": renderAppTemplate("web", "web")["web/app/data-provider.ts"]!.replaceAll("__QIY_DEFAULT_API_TRANSPORT__", options.apiClient ?? "rest"),
    "web/app/dashboard.ts": `export interface DashboardMetric { name: string; resource: string; label: string; icon?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend"; groupBy?: string; days?: number; }
export const dashboardMetrics: DashboardMetric[] = ${JSON.stringify(dashboardMetrics, null, 2)};
`,
    ...(options.auth ? {
      "web/app/auth.ts": `import type { AccessControlProvider, AuthProvider } from "@refinedev/core";

const tokenKey = "qiy.access_token";
type QiyIdentity = { id?: string; name?: string; role?: string };
const token = () => typeof window === "undefined" ? undefined : window.localStorage.getItem(tokenKey) ?? undefined;
export const qiyAuthProvider: AuthProvider = {
  login: async ({ token: nextToken, username, password }: { token?: string; username?: string; password?: string }) => {
    if (username && password) {
      const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (!response.ok) return { success: false, error: { name: "LoginFailed", message: (await response.json().catch(() => null) as { error?: string } | null)?.error ?? "Invalid username or password" } };
      const result = await response.json() as { accessToken?: string };
      if (!result.accessToken) return { success: false, error: { name: "LoginFailed", message: "Login response did not contain an access token" } };
      window.localStorage.setItem(tokenKey, result.accessToken);
      return { success: true, redirectTo: "/" };
    }
    ${supportsExternalToken ? 'if (nextToken) { window.localStorage.setItem(tokenKey, nextToken); return { success: true, redirectTo: "/" }; }' : ""}
    return { success: false, error: { name: "CredentialsRequired", message: ${JSON.stringify(supportsExternalToken ? "Username and password or an OAuth2/OIDC/SSO access token are required" : "Username and password are required")} } };
  },
  logout: async () => { window.localStorage.removeItem(tokenKey); return { success: true, redirectTo: "/auth/login" }; },
  check: async () => token() ? { authenticated: true } : { authenticated: false, redirectTo: "/auth/login" },
  getIdentity: async () => { const response = await fetch("/api/v1/auth/me", { headers: token() ? { Authorization: "Bearer " + token() } : {} }); if (!response.ok) return null; return await response.json() as QiyIdentity; },
  getPermissions: async () => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; return identity?.role ?? null; },
  onError: async ({ error }) => error?.statusCode === 401 ? { logout: true, redirectTo: "/auth/login" } : {},
};
export const qiyAccessControlProvider: AccessControlProvider = { can: async ({ resource, action }) => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; if (!identity) return { can: false, reason: "Authentication required" }; if (identity.role === "admin") return { can: true }; if (resource === "users") return { can: false, reason: "User administration is restricted" }; const can = identity.role === "operator" || action === "list" || action === "show"; return can ? { can: true } : { can: false, reason: "Role " + (identity.role ?? "unknown") + " cannot " + action + " " + resource }; }, options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true }, queryOptions: { staleTime: 30_000 } } };
export function qiyAuthToken(): string | undefined { return token(); }
`,
      "web/app/routes/login.tsx": `import { Alert, Button, Card, ${supportsExternalToken ? "Divider, " : ""}Input, Space, Typography } from "antd";
import { useState } from "react";
import { useLogin } from "@refinedev/core";
export default function Login() { const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); ${supportsExternalToken ? 'const [value, setValue] = useState("");' : ""} const { mutate, isPending, error } = useLogin(); return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}><Card title="Qiy Admin 登录" style={{ width: 420 }}><Space direction="vertical" style={{ width: "100%" }}>${options.auth?.provider === "local" ? '<Typography.Text strong>用户名和密码</Typography.Text><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" autoComplete="username" /><Input.Password value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" autoComplete="current-password" /><Button type="primary" loading={isPending} block onClick={() => mutate({ username, password })}>登录</Button>' : '<Typography.Paragraph type="secondary">粘贴 OAuth2/OIDC/企业 SSO access token 以登录。</Typography.Paragraph><Input.TextArea rows={4} value={value} onChange={(event) => setValue(event.target.value)} placeholder="Bearer token" /><Button type="primary" loading={isPending} block onClick={() => mutate({ token: value.replace(/^Bearer\\s+/i, "") })}>登录</Button>'}{error && <Alert type="error" message={error.message ?? String(error)} />}</Space></Card></div>; }
`,
      "web/tests/auth.test.ts": `import { afterAll, beforeAll, expect, test } from "bun:test";
import { qiyAccessControlProvider, qiyAuthProvider } from "../app/auth";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const tokens = new Map<string, string>();
let role = "viewer";
beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => tokens.get(key) ?? null, setItem: (key: string, value: string) => { tokens.set(key, value); }, removeItem: (key: string) => { tokens.delete(key); } } } });
  globalThis.fetch = (async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("/auth/login") ? { accessToken: "local-test-token" } : { id: "test-user", role }), { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
});
afterAll(() => { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); globalThis.fetch = originalFetch; });

test("authenticates using ${options.auth?.provider === "local" ? "username and password" : "an external access token"}", async () => {
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
  ${options.auth?.provider === "local" ? 'expect((await qiyAuthProvider.login({ username: "admin", password: "correct-password" })).success).toBe(true); expect(tokens.get("qiy.access_token")).toBe("local-test-token");' : 'expect((await qiyAuthProvider.login({ token: "" })).success).toBe(false); expect((await qiyAuthProvider.login({ token: "test-token" })).success).toBe(true);'}
  expect((await qiyAuthProvider.check({})).authenticated).toBe(true);
});

test("matches server admin, operator and viewer role policy", async () => {
  role = "viewer";
  expect((await qiyAccessControlProvider.can({ resource: "orders", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "orders", action: "delete" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "users", action: "list" })).can).toBe(false);
  role = "operator";
  expect((await qiyAccessControlProvider.can({ resource: "orders", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "users", action: "show" })).can).toBe(false);
  role = "admin";
  expect((await qiyAccessControlProvider.can({ resource: "users", action: "delete" })).can).toBe(true);
  await qiyAuthProvider.logout({});
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
});
`,
    } : {}),
    "web/app/hooks/index.ts": `export function useQiyTitle(title: string): string { return "Qiy · " + title; }\n`,
    "web/app/components/related-records.tsx": `import { useList } from "@refinedev/core";
import { useTranslation } from "@refinedev/core";
import { Alert, Card, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router";
import { getResource } from "../resources";
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
    "web/app/resources.ts": `export type FieldType = "UUID" | "Text" | "Integer" | "Decimal" | "Money" | "DateTime" | "File" | "Vector";
export interface ResourceEnumValue { name: string; label?: string; color?: string; icon?: string; }
export interface ResourceField { name: string; label: string; type: FieldType; nullable: boolean; primaryKey: boolean; visible: boolean; listVisible: boolean; formVisible: boolean; showVisible: boolean; sortable: boolean; filterable: boolean; enumName?: string; enumValues?: ResourceEnumValue[]; relation?: { resource: string; labelField: string }; icon?: string; dimension?: number; }
export interface ResourceDefinition { name: string; apiName: string; label: string; icon: string; menuParent?: string; fields: ResourceField[]; relatedResources?: Array<{ resource: string; field: string; label: string }>; }
export const menuGroups = ${JSON.stringify(menuGroups.map((group) => ({ name: `menu-${group.name}`, label: group.label, icon: group.icon ?? "AppstoreOutlined", ...(group.parent && { parent: `menu-${group.parent}` }) })), null, 2)} as Array<{ name: string; label: string; icon: string; parent?: string }>;
export const resources: ResourceDefinition[] = ${resourceFields(database, menuGroups)};
export const resourceNames = ${JSON.stringify(resourceNames)} as const;
export function getResource(name: string | undefined): ResourceDefinition | undefined { return resources.find((resource) => resource.name === name); }
`,
    "web/app/routes/home.tsx": `import { CanAccess, useCustom, useList, useTranslation } from "@refinedev/core";
import { Card, Col, Progress, Row, Space, Statistic, Typography } from "antd";
import { Link } from "react-router";
import { resources } from "../resources";
 import { dashboardMetrics, type DashboardMetric } from "../dashboard";
 import { qiyIcons } from "../icons";
import { t, type QiyLocale } from "../i18n";

 function DistributionSummary({ metric }: { metric: DashboardMetric }) {
   const { result, query } = useCustom<{ items: Array<{ value: string | null; count: number }> }>({ url: \`/api/v1/\${metric.resource}/distribution\`, method: "get", config: { query: { field: metric.groupBy } } });
   const resource = resources.find((item) => item.name === metric.resource);
   const field = resource?.fields.find((item) => item.name === metric.groupBy);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const rows = result.data?.items ?? [];
   const total = rows.reduce((sum, row) => sum + row.count, 0);
   return <Col xs={24} sm={12} lg={metric.span}><Card title={<Space><Icon style={{ color: "#1677ff" }} /><span>{metric.label}</span></Space>} loading={query.isLoading}>{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map(({ value, count }) => { const item = field?.enumValues?.find((option) => option.name === value); return <div key={value ?? "null"}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text>{item?.label ?? value ?? "—"}</Typography.Text><Typography.Text type="secondary">{count}</Typography.Text></Space><Progress percent={total ? Math.round(count / total * 100) : 0} showInfo={false} /></div>; })}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
 }
 function TrendSummary({ metric }: { metric: DashboardMetric }) {
   const { result, query } = useCustom<{ items: Array<{ day: string; count: number }> }>({ url: \`/api/v1/\${metric.resource}/trend\`, method: "get", config: { query: { field: metric.groupBy, days: metric.days } } });
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const rows = result.data?.items ?? [];
   const max = Math.max(...rows.map((row) => row.count), 0);
   return <Col xs={24} lg={metric.span}><Card title={<Space><Icon style={{ color: "#1677ff" }} /><span>{metric.label}</span></Space>} loading={query.isLoading}>{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map((row) => <div key={row.day}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text>{row.day}</Typography.Text><Typography.Text type="secondary">{row.count}</Typography.Text></Space><Progress percent={max ? Math.round(row.count / max * 100) : 0} showInfo={false} /></div>)}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
 }
 function ResourceSummary({ metric }: { metric: DashboardMetric }) {
   if (metric.type === "distribution") return <DistributionSummary metric={metric} />;
   if (metric.type === "trend") return <TrendSummary metric={metric} />;
   return <CountSummary metric={metric} />;
 }
 function CountSummary({ metric }: { metric: DashboardMetric }) {
   const { result, query } = useList({ resource: metric.resource, pagination: { currentPage: 1, pageSize: 1 } });
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   return <Col xs={24} sm={12} lg={metric.span}><Link to={\`/\${metric.resource}\`}><Card hoverable><Space><Icon style={{ fontSize: 24, color: "#1677ff" }} /><div><Typography.Text type="secondary">{metric.label}</Typography.Text><Statistic value={query.isLoading ? "—" : result.total ?? 0} /></div></Space></Card></Link></Col>;
}
export default function Home() {
  const { getLocale } = useTranslation(); const locale: QiyLocale = getLocale() === "en-US" ? "en-US" : "zh-CN";
   return <Space direction="vertical" size="large" style={{ width: "100%" }}><div><Typography.Title level={2}>{locale === "zh-CN" ? "工作台" : "Dashboard"}</Typography.Title><Typography.Paragraph type="secondary">{locale === "zh-CN" ? "从数据资源快速进入业务管理。" : "Jump into your data resources from one place."}</Typography.Paragraph></div><Row gutter={[16, 16]}>{dashboardMetrics.map((metric) => <CanAccess key={metric.name} resource={metric.resource} action="list"><ResourceSummary metric={metric} /></CanAccess>)}</Row><Card title={t(locale, "quickAccess")}><Space wrap>{resources.slice(0, 4).map((resource) => <CanAccess key={resource.name} resource={resource.name} action="list"><Link to={\`/\${resource.name}\`}>{resource.label}</Link></CanAccess>)}</Space></Card></Space>;
}
`,
    "web/app/i18n.ts": `import type { I18nProvider } from "@refinedev/core";
import type { Locale } from "antd/es/locale";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
export type QiyLocale = "zh-CN" | "en-US";
export const localeMessages = { "zh-CN": { new: "新建", edit: "编辑", view: "查看", back: "返回列表", delete: "删除", batchDelete: "批量删除", actions: "操作", visibleColumns: "显示列", confirmDelete: "确认删除选中记录？", deleted: "删除成功", unknownResource: "未知资源", detail: "详情", language: "语言", save: "保存", cancel: "取消", deleteSuccess: "删除成功", quickAccess: "快速访问" }, "en-US": { new: "New", edit: "Edit", view: "View", back: "Back to list", delete: "Delete", batchDelete: "Batch delete", actions: "Actions", visibleColumns: "Columns", confirmDelete: "Delete selected records?", deleted: "Deleted", unknownResource: "Unknown resource", detail: "Detail", language: "Language", save: "Save", cancel: "Cancel", deleteSuccess: "Deleted", quickAccess: "Quick access" } } as const;
export const refineMessages: Record<QiyLocale, Record<string, string>> = {
  "zh-CN": { "buttons.logout": "退出登录", "buttons.create": "新建", "buttons.save": "保存", "buttons.delete": "删除", "buttons.edit": "编辑", "buttons.show": "查看", "buttons.cancel": "取消", "buttons.confirm": "确认", "buttons.refresh": "刷新", "buttons.search": "搜索", "buttons.filter": "筛选", "buttons.clear": "清除", "buttons.export": "导出", "buttons.import": "导入", "warnWhenUnsavedChanges": "更改尚未保存，确定离开吗？" },
  "en-US": { "buttons.logout": "Log out", "buttons.create": "Create", "buttons.save": "Save", "buttons.delete": "Delete", "buttons.edit": "Edit", "buttons.show": "View", "buttons.cancel": "Cancel", "buttons.confirm": "Confirm", "buttons.refresh": "Refresh", "buttons.search": "Search", "buttons.filter": "Filter", "buttons.clear": "Clear", "buttons.export": "Export", "buttons.import": "Import", "warnWhenUnsavedChanges": "You have unsaved changes. Leave this page?" },
};
export const antdLocales: Record<QiyLocale, Locale> = { "zh-CN": zhCN, "en-US": enUS };
export function t(locale: QiyLocale, key: keyof typeof localeMessages["zh-CN"]): string { return localeMessages[locale][key]; }
export function createI18nProvider(locale: QiyLocale, setLocale?: (next: QiyLocale) => void): I18nProvider { return { getLocale: () => locale, changeLocale: (next) => { if (next === "zh-CN" || next === "en-US") setLocale?.(next); return next; }, translate: (key, _options, defaultMessage) => { const shortKey = key.replace(/^qiy\\./, "") as keyof typeof localeMessages["zh-CN"]; return refineMessages[locale][key] ?? localeMessages[locale][shortKey] ?? defaultMessage ?? key; } }; }
`,
    "web/app/routes/list.tsx": `import { CanAccess, useCan, useDeleteMany, useDelete, useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Checkbox, Dropdown, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, SettingOutlined } from "@ant-design/icons";
import { Link, useParams } from "react-router";
import { useState } from "react";
import { getResource } from "../resources";
import { useColumnVisibility } from "../hooks/use-column-visibility";
import { qiyIcons } from "../icons";
import { t, type QiyLocale } from "../i18n";
import { downloadFile } from "../hooks/download-file";
import { useTable } from "@refinedev/antd";
import type { BaseRecord } from "@refinedev/core";

function renderCell(field: { name: string; type: string; enumValues?: Array<{ name: string; label?: string; color?: string; icon?: string }> }, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "File") return <Typography.Link onClick={() => void downloadFile(String(value)).catch((error) => { void message.error(String(error)); })}>{String(value)}</Typography.Link>;
  const enumValue = field.enumValues?.find((item) => item.name === String(value));
  if (enumValue) { const Icon = enumValue.icon ? qiyIcons[enumValue.icon as keyof typeof qiyIcons] : undefined; return <Tag color={enumValue.color} icon={Icon ? <Icon /> : undefined}>{enumValue.label ?? enumValue.name}</Tag>; }
  if (field.name.toLowerCase().includes("status") || field.name.toLowerCase() === "role") return <Typography.Text code>{String(value)}</Typography.Text>;
  if (field.type === "Money" || field.type === "Decimal") return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}
export default function ResourceList() {
  const { resource: name } = useParams(); const resource = getResource(name); const { translate, getLocale } = useTranslation(); const locale: QiyLocale = getLocale() === "en-US" ? "en-US" : "zh-CN";
  const { tableProps, tableQuery, setFilters } = useTable<Record<string, unknown>>({ resource: name ?? "", pagination: { currentPage: 1, pageSize: 10 }, syncWithLocation: true, queryOptions: { enabled: !!resource } });
  const { mutateAsync: remove } = useDelete(); const { mutateAsync: removeMany } = useDeleteMany(); const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const { data: deletePermission } = useCan({ resource: name ?? "", action: "delete", queryOptions: { enabled: !!resource } });
  const [search, setSearch] = useState(""); const enumFields = resource?.fields.filter((field) => field.filterable && field.enumValues?.length) ?? []; const [enumFilters, setEnumFilters] = useState<Record<string, string | undefined>>({});
  const { visibleKeys, setVisibleKeys } = useColumnVisibility(resource);
  if (!resource) return <Alert type="error" message={translate("qiy.unknownResource", {}, t(locale, "unknownResource"))} />;
  const fields = resource.fields.filter((field) => field.type !== "Vector" && visibleKeys.includes(field.name));
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => {
    const Icon = field.icon ? qiyIcons[field.icon as keyof typeof qiyIcons] : undefined;
    return { title: <Space>{Icon && <Icon />}<span>{field.label}</span></Space>, dataIndex: field.name, key: field.name, sorter: field.sortable, render: (value: unknown) => renderCell(field, value) };
  });
  columns.push({ title: t(locale, "actions"), key: "actions", fixed: "right", render: (_value, record) => <Space>
    <CanAccess resource={resource.name} action="show"><Link to={"/" + resource.name + "/" + record.id}>{t(locale, "view")}</Link></CanAccess>
    <CanAccess resource={resource.name} action="edit"><Link to={"/" + resource.name + "/" + record.id + "/edit"}>{t(locale, "edit")}</Link></CanAccess>
    <CanAccess resource={resource.name} action="delete"><Popconfirm title={t(locale, "confirmDelete")} onConfirm={async () => { await remove({ resource: resource.name, id: String(record.id) }); message.success(t(locale, "deleteSuccess")); }}><Button danger type="link" icon={<DeleteOutlined />}>{t(locale, "delete")}</Button></Popconfirm></CanAccess>
  </Space> });
  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); message.success(t(locale, "deleteSuccess")); };
  const applyFilters = (nextSearch = search, nextEnums = enumFilters) => { const filters: Array<{ field: string; operator: "contains" | "eq"; value: string }> = nextSearch ? [{ field: "__search", operator: "contains", value: nextSearch }] : []; for (const [field, value] of Object.entries(nextEnums)) if (value) filters.push({ field, operator: "eq", value }); setFilters(filters); };
  return <Card title={<Typography.Title level={3} style={{ margin: 0 }}>{resource.label}</Typography.Title>} extra={<Space wrap><Input.Search allowClear value={search} placeholder={locale === "zh-CN" ? "搜索" : "Search"} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => { setSearch(value); applyFilters(value); }} />{enumFields.map((field) => <Select key={field.name} allowClear value={enumFilters[field.name]} placeholder={field.label} options={field.enumValues?.map((item) => ({ value: item.name, label: item.label ?? item.name }))} onChange={(value) => { const next = { ...enumFilters, [field.name]: value }; setEnumFilters(next); applyFilters(search, next); }} />)}<Dropdown menu={{ items: resource.fields.filter((field) => field.type !== "Vector").map((field) => ({ key: field.name, label: <Checkbox checked={visibleKeys.includes(field.name)} onChange={(event) => setVisibleKeys((keys) => event.target.checked ? [...keys, field.name] : keys.filter((key) => key !== field.name))}>{field.label}</Checkbox> })) }}><Button icon={<SettingOutlined />}>{t(locale, "visibleColumns")}</Button></Dropdown><CanAccess resource={resource.name} action="create"><Link to={"/" + resource.name + "/new"}><Button type="primary">{t(locale, "new")}</Button></Link></CanAccess></Space>}>
    {tableQuery.error && <Alert type="error" showIcon message={String(tableQuery.error)} style={{ marginBottom: 16 }} />}
    {deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}
    <Table<Record<string, unknown>> {...tableProps} pagination={{ ...tableProps.pagination, showSizeChanger: true, pageSizeOptions: ["10", "20", "50", "100"] }} rowSelection={deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined} rowKey="id" columns={columns} scroll={{ x: "max-content" }} />
  </Card>;
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
`,
    "web/tests/data-provider.test.ts": `import { describe, expect, test } from "bun:test";\nimport { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";\nconst requests: Array<{ url: string; method: string; body?: string }> = [];\nconst fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { const url = String(input); const method = init?.method ?? "GET"; requests.push({ url, method, body: init?.body?.toString() }); const body = method === "GET" && url.includes("?") ? { data: [{ id: "one" }], total: 1 } : method === "DELETE" && url.includes("ids=") ? [{ id: "one" }] : { id: "one" }; return new Response(JSON.stringify(body), { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } }); }) as typeof fetch;\ndescribe("same-origin Refine provider", () => { test("maps list and mutations", async () => { requests.length = 0; const provider = createDataProvider(fetcher); await provider.getList({ resource: "products", pagination: { currentPage: 2, pageSize: 5 } }); await provider.getOne({ resource: "products", id: "one" }); await provider.create({ resource: "products", variables: { title: "New" } }); await provider.update({ resource: "products", id: "one", variables: { title: "Updated" } }); await provider.deleteOne({ resource: "products", id: "one" }); await provider.deleteMany?.({ resource: "products", ids: ["one", "two"] }); expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "POST", "PATCH", "DELETE", "DELETE"]); }); test("encodes table query state", async () => { requests.length = 0; const provider = createDataProvider(fetcher); await provider.getList({ resource: "products", pagination: { currentPage: 3, pageSize: 10 }, sorters: [{ field: "name", order: "desc" }], filters: [{ field: "__search", operator: "contains", value: "phone" }, { field: "status", operator: "eq", value: "approved" }] }); const url = new URL(requests[0]!.url, "http://localhost"); expect(url.searchParams.get("page")).toBe("3"); expect(url.searchParams.get("pageSize")).toBe("10"); expect(url.searchParams.get("sort")).toBe("name"); expect(url.searchParams.get("order")).toBe("desc"); expect(url.searchParams.get("search")).toBe("phone"); expect(JSON.parse(url.searchParams.get("filters") ?? "{}")).toEqual({ status: "approved" }); }); test("maps GraphQL list variables", async () => { requests.length = 0; const provider = createGraphQLDataProvider(async (input, init) => { requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body?.toString() }); return new Response(JSON.stringify({ data: { products: { items: [{ id: "one" }], total: 1 } } }), { status: 200, headers: { "Content-Type": "application/json" } }); }); const result = await provider.getList({ resource: "products", pagination: { currentPage: 2, pageSize: 5 }, sorters: [{ field: "name", order: "desc" }] }); expect(result.total).toBe(1); const payload = JSON.parse(requests[0]!.body ?? "{}"); expect(payload.variables).toEqual({ page: 2, pageSize: 5, search: undefined, sort: "name", order: "desc", filters: [] }); }); test("rejects unknown resources", () => { const provider = createDataProvider(fetcher); expect(() => provider.getList({ resource: "../secrets" })).toThrow("Unknown resource"); }); });\n`.replaceAll('"products"', JSON.stringify(database.entities[0]!.tableName)).replace("data: { products:", `data: { ${database.entities[0]!.name}:`),
  };
}







