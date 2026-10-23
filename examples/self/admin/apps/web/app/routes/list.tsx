import { useCan, useDeleteMany, useGetIdentity, useNotification, useTranslation } from "@refinedev/core";
import { CreateButton, DeleteButton, EditButton, List, ShowButton, useTable } from "@refinedev/antd";
import { Alert, Button, Checkbox, Dropdown, Input, Popconfirm, Popover, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, DownloadOutlined, SaveOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";
import { Link, useParams } from "react-router";
import { useEffect, useState } from "react";
import { canSeeField, getResource } from "../resources";
import { fetchServerViews, publishServerView, type QiyServerView } from "../views-api";
import { useColumnVisibility } from "../hooks/use-column-visibility";
import { qiyIcons } from "../icons";
import { downloadExport, exportUrl, startImport, waitForImport } from "../export";
import { deleteSavedView, listSavedViews, saveView } from "../views";
import { t, resolveLocale, type QiyLocale } from "../i18n";
import { downloadFile } from "../hooks/download-file";
import { BatchBusinessActions, BusinessActions } from "../components/business-actions";
import type { BaseRecord } from "@refinedev/core";

function renderCell(field: { name: string; type: string; enumValues?: Array<{ name: string; label?: string; color?: string; icon?: string; comment?: string; commentKey?: string }> }, value: unknown, notify: ReturnType<typeof useNotification>["open"], translate: ReturnType<typeof useTranslation>["translate"]) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "File") return <Typography.Link onClick={() => void downloadFile(String(value)).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{String(value)}</Typography.Link>;
  if (field.type === "Files") {
    const keys = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    if (!keys.length) return "—";
    return <Space wrap>{keys.map((key) => <Typography.Link key={key} onClick={() => void downloadFile(key).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{key.split("/").pop()}</Typography.Link>)}</Space>;
  }
  const enumValue = field.enumValues?.find((item) => item.name === String(value));
  if (enumValue) { const Icon = enumValue.icon ? qiyIcons[enumValue.icon as keyof typeof qiyIcons] : undefined; const comment = enumValue.commentKey ? translate(enumValue.commentKey, {}, enumValue.comment) : enumValue.comment; return <Tag title={comment} color={enumValue.color} icon={Icon ? <Icon /> : undefined}>{enumValue.label ?? enumValue.name}</Tag>; }
  if (field.name.toLowerCase().includes("status") || field.name.toLowerCase() === "role") return <Typography.Text code>{String(value)}</Typography.Text>;
  if (field.type === "Money" || field.type === "Decimal") return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}
export default function ResourceList() {
  const { resource: name } = useParams(); const resource = getResource(name); const { translate, getLocale } = useTranslation(); const { open: notify } = useNotification(); const { data: identity } = useGetIdentity<{ role?: string }>(); const locale: QiyLocale = resolveLocale(getLocale());
  const { tableProps, tableQuery, setFilters, setSorters, filters, sorters } = useTable<Record<string, unknown>>({ resource: name ?? "", pagination: { currentPage: 1, pageSize: 10 }, syncWithLocation: true, queryOptions: { enabled: !!resource } });
  const { mutateAsync: removeMany } = useDeleteMany(); const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savedViews, setSavedViews] = useState(() => listSavedViews(name ?? ""));
  const [activeView, setActiveView] = useState<string | undefined>(undefined);
  const [viewName, setViewName] = useState("");
  const [serverViews, setServerViews] = useState<QiyServerView[]>([]);
  useEffect(() => {
    if (!name) return undefined;
    let active = true;
    void fetchServerViews(name).then((items) => { if (active) setServerViews(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [name]);
  const applySavedView = (id: string | undefined) => { setActiveView(id); const shared = id?.startsWith("server:") ?? false; const view = shared ? serverViews.find((item) => "server:" + item.id === id) : savedViews.find((item) => item.id === id); if (!view) return; setSearch(view.search ?? ""); setFilters((view.filters ?? []) as never); setSorters((view.sorters ?? []) as never); if (view.columns?.length) { const columns = view.columns; setVisibleKeys(() => columns); } };
  const storeSavedView = () => { if (!viewName.trim() || !resource) return; setSavedViews(saveView(resource.name, { name: viewName, search, filters: filters as unknown[], sorters: sorters as unknown[], columns: visibleKeys })); setViewName(""); notify?.({ type: "success", message: translate("qiy.saved", {}, "View saved") }); };
  const removeSavedView = () => { if (!resource) return; if (!activeView) return; setSavedViews(deleteSavedView(resource.name, activeView)); setActiveView(undefined); };
  const publishSavedView = async (shared: boolean) => {
    if (!resource || !activeView) return;
    const personal = savedViews.find((item) => item.id === activeView);
    const server = activeView.startsWith("server:") ? serverViews.find((item) => "server:" + item.id === activeView) : undefined;
    const view = personal ?? server;
    if (!view) return;
    try {
      await publishServerView({ resource: resource.name, name: view.name, shared, search: view.search, filters: view.filters as unknown[] | undefined, sorters: view.sorters as unknown[] | undefined, columns: view.columns });
      setServerViews(await fetchServerViews(resource.name));
      notify?.({ type: "success", message: shared ? translate("qiy.viewShared", {}, "View shared with everyone") : translate("qiy.viewPublished", {}, "View saved to server") });
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Publishing the view failed" });
    }
  };
  const runExport = () => { if (!resource) return; setExporting(true); void downloadExport(exportUrl(resource.name, { filters, sorters, columns: visibleKeys, ids: selectedRowKeys.map(String) })).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setExporting(false)); };
  const { data: deletePermission } = useCan({ resource: name ?? "", action: "delete", queryOptions: { enabled: !!resource } });
  const [search, setSearch] = useState(""); const enumFields = resource?.fields.filter((field) => field.filterable && field.enumValues?.length) ?? []; const advancedFields = resource?.fields.filter((field) => field.filterable && !field.enumValues?.length && field.filterModes?.length) ?? []; const [enumFilters, setEnumFilters] = useState<Record<string, string | undefined>>({}); const [advancedFilters, setAdvancedFilters] = useState<Record<string, { operator: string; value: string }>>({}); const [advancedJoin, setAdvancedJoin] = useState<"and" | "or">("and");
  const { visibleKeys, setVisibleKeys } = useColumnVisibility(resource);
  if (!resource) return <Alert type="error" message={translate("qiy.unknownResource", {}, t(locale, "unknownResource"))} />;
  const fields = resource.fields.filter((field) => field.type !== "Vector" && visibleKeys.includes(field.name) && canSeeField(field, identity?.role));
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => {
    const Icon = field.icon ? qiyIcons[field.icon as keyof typeof qiyIcons] : undefined;
    return { title: <Space>{Icon && <Icon />}<span>{field.label}</span></Space>, dataIndex: field.name, key: field.name, sorter: field.sortable, render: (value: unknown) => renderCell(field, value, notify, translate) };
  });
  columns.push({ title: t(locale, "actions"), key: "actions", fixed: "right", render: (_value, record) => <Space>
    <ShowButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <EditButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <DeleteButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <BusinessActions resource={resource.name} placement="list" record={record} />
  </Space> });
  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); notify?.({ type: "success", message: t(locale, "deleteSuccess") }); };
  const applyFilters = (nextSearch = search, nextEnums = enumFilters, nextAdvanced = advancedFilters, nextAdvancedJoin = advancedJoin) => { const filters: Array<{ field: string; operator: string; value: string | string[] } | { operator: "and" | "or"; value: Array<{ field: string; operator: string; value: string | string[] }> }> = nextSearch ? [{ field: "__search", operator: "contains", value: nextSearch }] : []; for (const [field, value] of Object.entries(nextEnums)) if (value) filters.push({ field, operator: "eq", value }); const advanced = Object.entries(nextAdvanced).flatMap(([field, condition]) => !condition.value ? [] : [{ field, operator: condition.operator, value: condition.operator === "in" || condition.operator === "between" ? condition.value.split(",").map((item) => item.trim()) : condition.value }]); if (advanced.length === 1) filters.push(advanced[0]!); else if (advanced.length > 1) filters.push({ operator: nextAdvancedJoin, value: advanced }); setFilters(filters as never); };
  return <List resource={resource.name} title={<Typography.Title level={3} style={{ margin: 0 }}>{resource.label}</Typography.Title>} headerButtons={() => <Space wrap><Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(file) => { setImporting(true); void startImport(resource.name, file).then(({ jobId }) => waitForImport(resource.name, jobId, { onProgress: (progress) => notify?.({ type: "progress", message: String(progress.processed) + "/" + String(progress.total) + " row(s) imported" }) })).then((job) => { if (job.status === "failed") throw new Error(job.errors[0] ?? "Import failed"); notify?.({ type: "success", message: String(job.processed) + " row(s) imported" }); return tableQuery.refetch(); }).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setImporting(false)); return Upload.LIST_IGNORE; }}><Button icon={<UploadOutlined />} loading={importing}>{translate("qiy.import", {}, "Import CSV")}</Button></Upload><Button icon={<DownloadOutlined />} loading={exporting} onClick={runExport}>{selectedRowKeys.length > 0 ? translate("qiy.exportSelected", {}, "Export selected") + " (" + selectedRowKeys.length + ")" : translate("qiy.export", {}, "Export CSV")}</Button><Dropdown menu={{ items: resource.fields.filter((field) => field.type !== "Vector").map((field) => ({ key: field.name, label: <Checkbox checked={visibleKeys.includes(field.name)} onChange={(event) => setVisibleKeys((keys) => event.target.checked ? [...keys, field.name] : keys.filter((key) => key !== field.name))}>{field.label}</Checkbox> })) }}><Button icon={<SettingOutlined />}>{t(locale, "visibleColumns")}</Button></Dropdown><Select allowClear style={{ minWidth: 160 }} placeholder={translate("qiy.views", {}, "Saved views")} value={activeView} options={[...savedViews.map((view) => ({ value: view.id, label: view.name })), ...serverViews.map((view) => ({ value: "server:" + view.id, label: view.name + " (shared)" }))]} onChange={(value) => applySavedView(value)} /><Popover trigger="click" content={<Space direction="vertical"><Input value={viewName} placeholder={translate("qiy.viewName", {}, "View name")} onChange={(event) => setViewName(event.target.value)} onPressEnter={storeSavedView} /><Button type="primary" disabled={!viewName.trim()} onClick={storeSavedView}>{translate("qiy.save", {}, "Save")}</Button></Space>}><Button icon={<SaveOutlined />}>{translate("qiy.saveView", {}, "Save view")}</Button></Popover>{activeView && <Popover trigger="click" content={<Space direction="vertical"><Button onClick={() => void publishSavedView(false)}>{translate("qiy.saveToServer", {}, "Save to server")}</Button><Button onClick={() => void publishSavedView(true)}>{translate("qiy.shareView", {}, "Share with everyone")}</Button></Space>}><Button icon={<UploadOutlined />}>{translate("qiy.publishView", {}, "Publish view")}</Button></Popover>}
    {activeView && <Button danger onClick={removeSavedView}>{translate("qiy.deleteView", {}, "Delete view")}</Button>}<CreateButton resource={resource.name}>{t(locale, "new")}</CreateButton></Space>}>
    <div className="qiy-list-filters" role="search" aria-label={locale === "zh-CN" ? "筛选" : "Filters"}><Input.Search allowClear value={search} placeholder={locale === "zh-CN" ? "搜索" : "Search"} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => { setSearch(value); applyFilters(value); }} />{enumFields.map((field) => <Select key={field.name} allowClear value={enumFilters[field.name]} placeholder={field.label} options={field.enumValues?.map((item) => ({ value: item.name, label: item.label ?? item.name }))} onChange={(value) => { const next = { ...enumFilters, [field.name]: value }; setEnumFilters(next); applyFilters(search, next); }} />)}{advancedFields.length > 1 && <Select value={advancedJoin} style={{ minWidth: 116 }} options={[{ value: "and", label: locale === "zh-CN" ? "全部满足" : "Match all" }, { value: "or", label: locale === "zh-CN" ? "任一满足" : "Match any" }]} onChange={(value: "and" | "or") => { setAdvancedJoin(value); applyFilters(search, enumFilters, advancedFilters, value); }} />}{advancedFields.map((field) => { const condition = advancedFilters[field.name] ?? { operator: field.filterModes[0] ?? "eq", value: "" }; return <Space.Compact key={field.name}><Select value={condition.operator} style={{ width: 120 }} options={field.filterModes.map((mode) => ({ value: mode, label: mode }))} onChange={(operator) => { const next = { ...advancedFilters, [field.name]: { ...condition, operator } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} /><Input allowClear value={condition.value} placeholder={field.label + (condition.operator === "in" || condition.operator === "between" ? " (comma separated)" : "")} onChange={(event) => { const next = { ...advancedFilters, [field.name]: { ...condition, value: event.target.value } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} /></Space.Compact>; })}</div>
    {tableQuery.error && <Alert type="error" showIcon message={String(tableQuery.error)} style={{ marginBottom: 16 }} />}
    {deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}
    <Table<Record<string, unknown>> {...tableProps} pagination={{ ...tableProps.pagination, showSizeChanger: true, pageSizeOptions: ["10", "20", "50", "100"] }} rowSelection={deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined} rowKey="id" columns={columns} scroll={{ x: "max-content" }} />
  </List>;
}
