import { CanAccess, useCan, useDeleteMany, useDelete, useTranslation } from "@refinedev/core";
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
