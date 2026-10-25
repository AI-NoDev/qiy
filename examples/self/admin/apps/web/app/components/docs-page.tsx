import { Alert, Card, Descriptions, Empty, Select, Space, Spin, Table, Tabs, Tag, Typography } from "antd";
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
