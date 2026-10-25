import { Alert, Button, Card, DatePicker, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from "antd";
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
