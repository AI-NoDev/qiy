import { DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Empty, Input, Menu, Row, Space, Spin, Table, Tag, Tooltip, Typography } from "antd";
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

/** Downloads the permission-filtered OpenAPI document currently shown on screen. */
function downloadOpenApiDocument(spec: unknown, title: string | undefined): void {
  if (spec === null || typeof spec !== "object") return;
  const stem = (title ?? "qiy").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "qiy";
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = stem + ".openapi.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

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
      {document ? <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadOpenApiDocument(document, info?.title)}>{translate("qiy.apiDocs.download", {}, "Download OpenAPI")}</Button> : null}
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
