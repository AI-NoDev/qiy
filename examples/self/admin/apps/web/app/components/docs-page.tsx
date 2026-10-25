import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { useTranslation } from "@refinedev/core";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import "@scalar/api-reference-react/style.css";
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
import {
  QIY_API_KEY_MAX_ACTIVE,
  apiKeyStatus,
  canCreateApiKey,
  countActiveApiKeys,
  createApiKey,
  defaultApiKeyName,
  formatApiKeyDate,
  listApiKeys,
  maskedApiKey,
  revokeApiKey,
  type ApiKeyRecord,
} from "../api-keys";
import { MermaidDiagram } from "./mermaid";
import { qiyFeatureFlags } from "../features";

const ScalarApiReference = lazy(async () => {
  const module = await import("@scalar/api-reference-react");
  return { default: module.ApiReferenceReact };
});

export interface DocsPageProps {
  model?: DocsModel;
  openApi?: unknown;
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
    <MermaidDiagram id="entities" source={buildEntityDiagram(model)} ariaLabel={translate("qiy.docs.entitiesTitle", {}, "Entities & relations")} errorText={translate("qiy.docs.mermaidError", {}, "Diagram failed to render")} />
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
    <MermaidDiagram id={"dataflow-" + flow.name} source={buildDataflowDiagram(flow)} ariaLabel={flow.label} errorText={translate("qiy.docs.mermaidError", {}, "Diagram failed to render")} />
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

function ApiPanel({ openApi }: { openApi?: unknown }) {
  const { translate } = useTranslation();
  if (!openApi) return <Empty description={translate("qiy.docs.noData", {}, "Nothing to show")} />;
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Alert type="info" showIcon message={translate("qiy.docs.apiFiltered", {}, "This document is filtered by the current account permissions")} />
    <div className="qiy-docs-scalar">
      <Suspense fallback={<div className="qiy-docs-scalar-placeholder" data-scalar="pending">{translate("qiy.docs.scalarLoading", {}, "Loading API reference")}</div>}>
        <ScalarApiReference configuration={{ spec: { content: openApi as Record<string, unknown> } }} />
      </Suspense>
    </div>
  </Space>;
}

function ApiKeysPanel() {
  const { translate, getLocale } = useTranslation();
  const locale = getLocale();
  const [items, setItems] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | undefined>();
  const [form] = Form.useForm();
  const load = async () => {
    setLoading(true);
    try {
      setItems(await listApiKeys());
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const create = async () => {
    const values = await form.validateFields() as { name: string; expiresAt?: { toISOString?: () => string } | null };
    setCreating(true);
    try {
      const created = await createApiKey({ name: values.name, expiresAt: values.expiresAt?.toISOString?.() ?? null });
      setSecret(created.key);
      form.resetFields();
      await load();
      void message.success(translate("qiy.apiKey.created", {}, "Created"));
    } catch (cause) {
      void message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };
  const revoke = async (id: string) => {
    try {
      await revokeApiKey(id);
      await load();
    } catch (cause) {
      void message.error(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      void message.success(translate("qiy.apiKey.copied", {}, "Copied"));
    } catch {
      void message.warning(secret);
    }
  };
  const columns = [
    { title: translate("qiy.apiKey.name", {}, "Name"), dataIndex: "name", key: "name" },
    { title: translate("qiy.apiKey.prefix", {}, "Prefix"), dataIndex: "maskedKey", key: "maskedKey", render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: translate("qiy.apiKey.createdAt", {}, "Created"), dataIndex: "createdAt", key: "createdAt", render: (value: string) => formatApiKeyDate(value, locale) },
    { title: translate("qiy.apiKey.lastUsed", {}, "Last used"), dataIndex: "lastUsedAt", key: "lastUsedAt", render: (value: string | null) => formatApiKeyDate(value, locale) },
    { title: translate("qiy.apiKey.expires", {}, "Expires"), dataIndex: "expiresAt", key: "expiresAt", render: (value: string | null) => formatApiKeyDate(value, locale) },
    { title: translate("qiy.apiKey.status", {}, "Status"), key: "status", render: (_: unknown, record: ApiKeyRecord) => { const status = apiKeyStatus(record); return <Tag color={status === "active" ? "green" : status === "revoked" ? "red" : "orange"}>{translate("qiy.apiKey." + status, {}, status)}</Tag>; } },
    { title: translate("qiy.apiKey.actions", {}, "Actions"), key: "actions", render: (_: unknown, record: ApiKeyRecord) => record.revokedAt ? null : <Popconfirm title={translate("qiy.apiKey.revokeConfirm", {}, "Revoke this key? It stops working immediately.")} onConfirm={() => void revoke(record.id)} okText={translate("qiy.apiKey.revoke", {}, "Revoke")} cancelText={translate("qiy.cancel", {}, "Cancel")}><Button danger size="small">{translate("qiy.apiKey.revoke", {}, "Revoke")}</Button></Popconfirm> },
  ];
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={5} style={{ margin: 0 }}>{translate("qiy.apiKey.title", {}, "API keys")}</Typography.Title>
    <Typography.Paragraph type="secondary">{translate("qiy.apiKey.description", {}, "Personal API keys for scripts and CI; the secret is shown once.") + " " + translate("qiy.apiKey.limit", { count: QIY_API_KEY_MAX_ACTIVE }, "Up to " + QIY_API_KEY_MAX_ACTIVE + " active keys per user")}</Typography.Paragraph>
    <Space>
      <Button type="primary" disabled={!canCreateApiKey(items)} onClick={() => setCreating(true)}>{translate("qiy.apiKey.create", {}, "Create key")}</Button>
      <Typography.Text type="secondary">{countActiveApiKeys(items) + " / " + QIY_API_KEY_MAX_ACTIVE}</Typography.Text>
    </Space>
    {error ? <Alert type="error" showIcon message={translate("qiy.apiKey.loadError", {}, "Failed to load")} description={error} /> : null}
    <Table<ApiKeyRecord> size="small" rowKey="id" loading={loading} pagination={false} dataSource={items} columns={columns} locale={{ emptyText: translate("qiy.apiKey.empty", {}, "No API keys yet") }} />
    <Modal open={creating} title={translate("qiy.apiKey.create", {}, "Create key")} okText={translate("qiy.apiKey.create", {}, "Create key")} confirmLoading={creating} onOk={() => void create()} onCancel={() => setCreating(false)}>
      <Form form={form} layout="vertical" initialValues={{ name: defaultApiKeyName(items) }}>
        <Form.Item name="name" label={translate("qiy.apiKey.name", {}, "Name")} rules={[{ required: true, message: translate("qiy.apiKey.nameRequired", {}, "Name is required") }]}>
          <Input placeholder={translate("qiy.apiKey.namePlaceholder", {}, "e.g. CI deploy")} maxLength={80} />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{translate("qiy.apiKey.expiresHint", {}, "Leave the server-side expiry empty for a non-expiring key (POST expiresAt is optional).")}</Typography.Paragraph>
      </Form>
    </Modal>
    <Modal open={Boolean(secret)} title={translate("qiy.apiKey.secretTitle", {}, "Save this secret now")} onCancel={() => setSecret(undefined)} footer={<Space><Button onClick={() => void copySecret()}>{translate("qiy.apiKey.copy", {}, "Copy")}</Button><Button type="primary" onClick={() => setSecret(undefined)}>{translate("qiy.close", {}, "Close")}</Button></Space>}>
      <Alert type="warning" showIcon message={translate("qiy.apiKey.secretHint", {}, "The full key is shown only once and cannot be recovered.")} style={{ marginBottom: 12 }} />
      <Typography.Paragraph><Typography.Text code copyable>{secret}</Typography.Text></Typography.Paragraph>
    </Modal>
  </Space>;
}

function tabChildren(tab: DocsTabKey, props: DocsPageProps): ReactNode {
  if (tab === "entities") return props.model ? <EntityPanel model={props.model} /> : null;
  if (tab === "dataflows") return props.model ? <DataflowPanel model={props.model} /> : null;
  if (tab === "api") return <ApiPanel openApi={props.openApi} />;
  if (tab === "permissions") return props.model ? <PermissionsPanel model={props.model} /> : null;
  return <ApiKeysPanel />;
}

/** Feature overview page: rendered when apiDocs or apiKeys is enabled. */
export function DocsOverviewPage(props: DocsPageProps) {
  const { translate } = useTranslation();
  const tabs = docsTabs(qiyFeatureFlags);
  const fallbackTab = tabs[0];
  const [active, setActive] = useState<DocsTabKey | undefined>(props.initialTab && tabs.includes(props.initialTab) ? props.initialTab : fallbackTab);
  if (tabs.length === 0) return <Empty description={translate("qiy.docs.noData", {}, "Nothing to show")} />;
  const current = active && tabs.includes(active) ? active : fallbackTab;
  const body = props.loading
    ? <Spin size="large" />
    : props.error
      ? <Alert type="error" showIcon message={translate("qiy.docs.loadError", {}, "Failed to load the overview")} description={props.error} />
      : tabChildren(current!, props);
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <Typography.Title level={3} style={{ margin: 0 }}>{translate("qiy.docs.title", {}, "Feature overview")}</Typography.Title>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{props.model?.app.description ?? translate("qiy.docs.subtitle", {}, "Generated entities, dataflows, API reference and access keys for this application")}</Typography.Paragraph>
    {props.model?.principal ? <Alert type="info" showIcon message={translate("qiy.docs.accessNote", {}, "The API reference only lists operations allowed for your role and permissions")} /> : null}
    <Card size="small">
      <Tabs activeKey={current} onChange={(key: string) => setActive(key as DocsTabKey)} items={tabs.map((tab) => ({ key: tab, label: translate(docsTabLabelKey(tab), {}, tab), children: tabChildren(tab, props) }))} />
    </Card>
  </Space>;
}
