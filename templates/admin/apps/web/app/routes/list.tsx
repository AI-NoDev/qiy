import { useDelete, useDeleteMany, useTranslation } from "@refinedev/core";
import { useTable } from "@refinedev/antd";
import { Alert, Button, Card, Checkbox, Dropdown, Popconfirm, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, SettingOutlined } from "@ant-design/icons";
import { Link, useParams } from "react-router";
import { useState } from "react";
import { getResource } from "../resources";
import { t, type QiyLocale } from "../i18n";
export default function ResourceList() {
  const { resource: name } = useParams(); const resource = getResource(name); const { getLocale } = useTranslation(); const locale: QiyLocale = getLocale() === "en-US" ? "en-US" : "zh-CN";
  const { tableProps, tableQuery } = useTable<Record<string, unknown>>({ resource: name ?? "", pagination: { currentPage: 1, pageSize: 10 }, syncWithLocation: true, queryOptions: { enabled: !!resource } });
  const { mutateAsync: remove } = useDelete(); const { mutateAsync: removeMany } = useDeleteMany();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(resource?.fields.filter((field) => field.visible).map((field) => field.name) ?? []);
  if (!resource) return <Alert type="error" message="Unknown resource" />;
  const fields = resource.fields.filter((field) => field.type !== "Vector" && visibleKeys.includes(field.name));
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => ({ title: field.label, dataIndex: field.name, key: field.name, sorter: field.sortable, render: (value: unknown) => String(value ?? "") }));
  columns.push({ title: t(locale, "actions"), key: "actions", render: (_value, record) => <Space><Link to={"/" + resource.name + "/" + record.id}>View</Link><Link to={"/" + resource.name + "/" + record.id + "/edit"}>Edit</Link><Popconfirm title="Delete this record?" onConfirm={async () => { await remove({ resource: resource.name, id: String(record.id) }); message.success(t(locale, "deleted")); }}><Button danger type="link" icon={<DeleteOutlined />}>{t(locale, "delete")}</Button></Popconfirm></Space> });
  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); message.success(t(locale, "deleted")); };
  return <Card title={<Typography.Title level={3} style={{ margin: 0 }}>{resource.label}</Typography.Title>} extra={<Space><Dropdown menu={{ items: resource.fields.filter((field) => field.type !== "Vector").map((field) => ({ key: field.name, label: <Checkbox checked={visibleKeys.includes(field.name)} onChange={(event) => setVisibleKeys((keys) => event.target.checked ? [...keys, field.name] : keys.filter((key) => key !== field.name))}>{field.label}</Checkbox> })) }}><Button icon={<SettingOutlined />}>{t(locale, "visibleColumns")}</Button></Dropdown><Link to={"/" + resource.name + "/new"}><Button type="primary">{t(locale, "new")}</Button></Link></Space>}>
    {tableQuery.error && <Alert type="error" showIcon message={String(tableQuery.error)} style={{ marginBottom: 16 }} />}
    {selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}
    <Table<Record<string, unknown>> {...tableProps} rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} rowKey="id" columns={columns} />
  </Card>;
}
