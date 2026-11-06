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
  const pathParameters = operation.parameters.filter((parameter) => parameter.in === "path");
  const queryParameters = operation.parameters.filter((parameter) => parameter.in === "query");
  const [tryOpen, setTryOpen] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [bodyDraft, setBodyDraft] = useState(requestExample ?? "");
  const [apiKey, setApiKey] = useState("");
  const [sending, setSending] = useState(false);
  const [tryError, setTryError] = useState<string | undefined>();
  const [result, setResult] = useState<{ status: number; statusText: string; body: string } | undefined>();
  const sendTryIt = async () => {
    setSending(true);
    setTryError(undefined);
    setResult(undefined);
    try {
      let url = baseUrl.replace(/\/+$/, "") + operation.path;
      for (const parameter of pathParameters) {
        url = url.replace("{" + parameter.name + "}", encodeURIComponent(paramValues[parameter.name] ?? ""));
      }
      const query = new URLSearchParams();
      for (const parameter of queryParameters) {
        const value = paramValues[parameter.name];
        if (value) query.set(parameter.name, value);
      }
      const token = typeof window === "undefined" ? null : window.localStorage.getItem("qiy.access_token");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = "Bearer " + token;
      if (apiKey.trim()) headers["X-API-Key"] = apiKey.trim();
      let body: string | undefined;
      if (operation.method !== "get" && bodyDraft.trim()) {
        headers["Content-Type"] = "application/json";
        body = bodyDraft;
      }
      const response = await fetch(url + (query.toString() ? "?" + query.toString() : ""), {
        method,
        headers,
        ...(body ? { body } : {}),
        credentials: "include",
      });
      const text = await response.text();
      setResult({ status: response.status, statusText: response.statusText, body: text.slice(0, 20000) });
    } catch (error) {
      setTryError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };
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
    <Space wrap>
      <Button size="small" onClick={() => setTryOpen((open) => !open)}>{tryOpen ? translate("qiy.apiDocs.tryHide", {}, "Hide try it") : translate("qiy.apiDocs.tryOpen", {}, "Try it")}</Button>
    </Space>
    {tryOpen ? <Card size="small" type="inner" style={{ marginTop: 8 }}>
      <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={translate("qiy.apiDocs.tryWarning", {}, "Requests run from this browser using your current session token (or the API key below). Responses are shown raw and truncated to 20k characters.")} />
      {operation.security.includes("apiKey") ? <Input.Password style={{ marginBottom: 8 }} placeholder={translate("qiy.apiDocs.tryApiKey", {}, "Optional X-API-Key")} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /> : null}
      {pathParameters.length > 0 || queryParameters.length > 0 ? <Space direction="vertical" style={{ width: "100%", marginBottom: 8 }}>
        {[...pathParameters, ...queryParameters].map((parameter) => <Input key={parameter.in + ":" + parameter.name} addonBefore={parameter.in + " " + parameter.name} placeholder={parameter.required ? translate("qiy.apiDocs.tryRequired", {}, "required") : translate("qiy.apiDocs.tryOptional", {}, "optional")} value={paramValues[parameter.name] ?? ""} onChange={(event) => setParamValues({ ...paramValues, [parameter.name]: event.target.value })} />)}
      </Space> : null}
      {operation.method !== "get" && requestExample ? <Input.TextArea rows={6} style={{ marginBottom: 8, fontFamily: "monospace" }} value={bodyDraft} onChange={(event) => setBodyDraft(event.target.value)} /> : null}
      <Space style={{ marginBottom: 8 }}>
        <Button type="primary" size="small" loading={sending} onClick={sendTryIt}>{translate("qiy.apiDocs.trySend", {}, "Send request")}</Button>
        <Typography.Text type="secondary">{translate("qiy.apiDocs.tryAuth", {}, "Authorization: current session token / X-API-Key")}</Typography.Text>
      </Space>
      {tryError ? <Alert type="error" showIcon message={tryError} /> : null}
      {result ? <div style={{ marginTop: 8 }}>
        <Space style={{ marginBottom: 4 }}><Tag color={result.status >= 200 && result.status < 300 ? "green" : result.status >= 400 ? "red" : "orange"}>{result.status + " " + result.statusText}</Tag></Space>
        <pre className="qiy-docs-code">{result.body || "(empty response)"}</pre>
      </div> : null}
    </Card> : null}
  </Card>;
}

/** Full-page API reference explorer with session-scoped try-it requests. */
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
  const hiddenOperations = useMemo(() => {
    const hidden = document?.["x-qiy-hidden"];
    return Array.isArray(hidden) ? hidden.filter((entry): entry is { method?: string; path?: string; reason?: string; verification?: string; label?: string } => entry !== null && typeof entry === "object") : [];
  }, [props.spec]);
  const baseUrl = openApiServerBaseUrl(props.spec, typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  const roleTooltip = translate("qiy.apiDocs.roleTooltip", {}, "Your account role is used to filter this document; operations you cannot call are not listed.");
  const permissionTooltip = translate("qiy.apiDocs.permissionTooltip", {}, "Permission values from your role, database column and verified claims. The document only contains operations you may call.");
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={3} style={{ margin: 0 }}>{translate("qiy.apiDocs.pageTitle", {}, "API reference")}</Typography.Title>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{translate("qiy.apiDocs.pageSubtitle", {}, "OpenAPI 3.1 operations allowed for the current account. Try them with your session token or an API key, or copy the curl example.")}</Typography.Paragraph>
    {hiddenOperations.length > 0 ? <Alert type="info" showIcon message={translate("qiy.apiDocs.hiddenTitle", { count: hiddenOperations.length }, hiddenOperations.length + " verification-gated operations are hidden")} description={<Space direction="vertical" size={2}>{hiddenOperations.map((operation) => <Typography.Text key={(operation.method ?? "post") + ":" + (operation.path ?? "")} type="secondary">{(operation.label ?? operation.path ?? "") + " — " + translate("qiy.apiDocs.hiddenVerification", { verification: operation.verification ?? "" }, "requires runtime verification: " + (operation.verification ?? ""))}</Typography.Text>)}</Space>} /> : null}
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
