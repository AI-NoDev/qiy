import { useDeleteMany, useNotification, useTranslation } from "@refinedev/core";
import { CreateButton, DeleteButton, EditButton, List, ShowButton, useTable } from "@refinedev/antd";
import { Alert, Button, Checkbox, Dropdown, Popconfirm, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, SettingOutlined } from "@ant-design/icons";
import { useParams } from "react-router";
import { useState } from "react";
import { getResource } from "../resources";
import { t, type QiyLocale } from "../i18n";
export default function ResourceList() {
  const { resource: name } = useParams(); const resource = getResource(name); const { getLocale } = useTranslation(); const { open: notify } = useNotification(); const locale: QiyLocale = getLocale() === "en-US" ? "en-US" : "zh-CN";
  const { tableProps, tableQuery } = useTable<Record<string, unknown>>({ resource: name ?? "", liveMode: resource?.liveMode ?? "off", pagination: { currentPage: 1, pageSize: 10 }, syncWithLocation: true, queryOptions: { enabled: !!resource } });
  const { mutateAsync: removeMany } = useDeleteMany();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(resource?.fields.filter((field) => field.visible).map((field) => field.name) ?? []);
  if (!resource) return <Alert type="error" message="Unknown resource" />;
  const fields = resource.fields.filter((field) => field.type !== "Vector" && visibleKeys.includes(field.name));
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => ({ title: field.label, dataIndex: field.name, key: field.name, sorter: field.sortable, render: (value: unknown) => String(value ?? "") }));
  columns.push({ title: t(locale, "actions"), key: "actions", render: (_value, record) => <Space><ShowButton resource={resource.name} recordItemId={String(record.id)} hideText /><EditButton resource={resource.name} recordItemId={String(record.id)} hideText /><DeleteButton resource={resource.name} recordItemId={String(record.id)} hideText /></Space> });
  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); notify?.({ type: "success", message: t(locale, "deleted") }); };
  return <List resource={resource.name} title={<Typography.Title level={3} style={{ margin: 0 }}>{resource.label}</Typography.Title>} headerButtons={() => <Space><Dropdown menu={{ items: resource.fields.filter((field) => field.type !== "Vector").map((field) => ({ key: field.name, label: <Checkbox checked={visibleKeys.includes(field.name)} onChange={(event) => setVisibleKeys((keys) => event.target.checked ? [...keys, field.name] : keys.filter((key) => key !== field.name))}>{field.label}</Checkbox> })) }}><Button icon={<SettingOutlined />}>{t(locale, "visibleColumns")}</Button></Dropdown><CreateButton resource={resource.name}>{t(locale, "new")}</CreateButton></Space>}>
    {tableQuery.error && <Alert type="error" showIcon message={String(tableQuery.error)} style={{ marginBottom: 16 }} />}
    {selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}
    <Table<Record<string, unknown>> {...tableProps} rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} rowKey="id" columns={columns} />
  </List>;
}
