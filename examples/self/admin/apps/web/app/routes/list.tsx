import { useCan, useDeleteMany, useGetIdentity, useNotification, useTranslation } from "@refinedev/core";
import { CreateButton, DeleteButton, EditButton, List, ShowButton, useTable } from "@refinedev/antd";
import { Alert, Button, Checkbox, Dropdown, Input, Popconfirm, Popover, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, DownloadOutlined, SaveOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";
import { Link, useParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { canSeeField, getResource, type ResourceField } from "../resources";
import { RelationCell } from "../components/relation-field";
import { RelationBatchProvider, buildRelationBatchPlan } from "../components/relation-batch";
import { DateFieldInput } from "../components/date-field";
import { formatFieldValue, isDateFieldType, type DateFieldType } from "../date-fields";
import { fetchServerViews, publishServerView, deleteServerView, type QiyServerView } from "../views-api";
import { useColumnVisibility } from "../hooks/use-column-visibility";
import { qiyIcons } from "../icons";
import { downloadExport, exportUrl, startImport, waitForImport } from "../export";
import { canDeleteView, deleteSavedView, listSavedViews, saveView, serverViewId, serverViewKey, viewMarker, type QiySavedViewKind } from "../views";
import { t, filterModeLabel, resolveLocale, type QiyLocale } from "../i18n";
import { downloadFile } from "../hooks/download-file";
import { BatchBusinessActions, BusinessActions } from "../components/business-actions";
import type { BaseRecord } from "@refinedev/core";

function renderCell(field: ResourceField, value: unknown, notify: ReturnType<typeof useNotification>["open"], translate: ReturnType<typeof useTranslation>["translate"], locale: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.relation) return <RelationCell field={field} value={value} />;
  if (field.type === "File") return <Typography.Link onClick={() => void downloadFile(String(value)).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{String(value)}</Typography.Link>;
  if (field.type === "Files") {
    const keys = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    if (!keys.length) return "—";
    return <Space wrap>{keys.map((key) => <Typography.Link key={key} onClick={() => void downloadFile(key).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}>{key.split("/").pop()}</Typography.Link>)}</Space>;
  }
  if (isDateFieldType(field.type)) return formatFieldValue(field.type, value, locale);
  const enumValue = field.enumValues?.find((item) => item.name === String(value));
  if (enumValue) { const Icon = enumValue.icon ? qiyIcons[enumValue.icon as keyof typeof qiyIcons] : undefined; const comment = enumValue.commentKey ? translate(enumValue.commentKey, {}, enumValue.comment) : enumValue.comment; return <Tag title={comment} color={enumValue.color} icon={Icon ? <Icon /> : undefined}>{translate(enumValue.labelKey, {}, enumValue.label ?? enumValue.name)}</Tag>; }
  if (field.name.toLowerCase().includes("status") || field.name.toLowerCase() === "role") return <Typography.Text code>{String(value)}</Typography.Text>;
  if (field.type === "Money" || field.type === "Decimal") return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}
/**
 * One row of the "Saved views" dropdown. Browser views are personal, published
 * server views are private to their owner and shared views are visible to everyone.
 * Only deletable rows (own server rows and local rows) render the trash action, and
 * the action stops propagation so deleting never selects the view first.
 */
function SavedViewLabel({ viewKey, name, kind, shared, mine, deleting, onDelete, translate }: { viewKey: string; name: string; kind: QiySavedViewKind; shared: boolean; mine?: boolean; deleting: boolean; onDelete: (key: string) => void; translate: ReturnType<typeof useTranslation>["translate"] }) {
  const marker = viewMarker(kind, shared);
  const markerKey = marker === "local" ? "qiy.viewMine" : marker === "shared" ? "qiy.viewSharedTag" : "qiy.viewPublishedTag";
  const markerFallback = marker === "local" ? "Personal" : marker === "shared" ? "Shared" : "Published";
  const markerColor = marker === "local" ? "default" : marker === "shared" ? "green" : "blue";
  return <Space>
    <span>{name}</span>
    <Tag color={markerColor} style={{ marginInlineEnd: 0 }}>{translate(markerKey, {}, markerFallback)}</Tag>
    {canDeleteView({ kind, mine }) && <span onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <Popconfirm title={translate("qiy.confirmDeleteView", {}, "Delete this view?")} okText={translate("qiy.delete", {}, "Delete")} cancelText={translate("qiy.cancel", {}, "Cancel")} onConfirm={() => onDelete(viewKey)}>
        <Button type="text" size="small" danger loading={deleting} icon={<DeleteOutlined />} aria-label={translate("qiy.deleteView", {}, "Delete view")} />
      </Popconfirm>
    </span>}
  </Space>;
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
  const [deletingView, setDeletingView] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!name) return undefined;
    let active = true;
    void fetchServerViews(name).then((items) => { if (active) setServerViews(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [name]);
  const applySavedView = (id: string | undefined) => { setActiveView(id); const serverId = serverViewId(id); const view = serverId ? serverViews.find((item) => item.id === serverId) : savedViews.find((item) => item.id === id); if (!view) return; setSearch(view.search ?? ""); setFilters((view.filters ?? []) as never); setSorters((view.sorters ?? []) as never); if (view.columns?.length) { const columns = view.columns; setVisibleKeys(() => columns); } };
  const storeSavedView = () => { if (!viewName.trim() || !resource) return; setSavedViews(saveView(resource.name, { name: viewName, search, filters: filters as unknown[], sorters: sorters as unknown[], columns: visibleKeys })); setViewName(""); notify?.({ type: "success", message: translate("qiy.saved", {}, "View saved") }); };
  /**
   * Deletes browser views from localStorage and server views through
   * DELETE /api/v1/saved-views/:id, then refetches so the dropdown matches the server.
   */
  const removeSavedView = async (key: string) => {
    if (!resource) return;
    setDeletingView(key);
    const serverId = serverViewId(key);
    try {
      if (serverId) {
        await deleteServerView({ resource: resource.name, id: serverId });
        setServerViews(await fetchServerViews(resource.name));
      } else {
        setSavedViews(deleteSavedView(resource.name, key));
      }
      if (activeView === key) setActiveView(undefined);
      notify?.({ type: "success", message: translate("qiy.viewDeleted", {}, "View deleted") });
    } catch {
      // Leave the row in place on failure: only the server may confirm a remote delete.
      notify?.({ type: "error", message: translate("qiy.viewDeleteFailed", {}, "Deleting the view failed") });
    } finally {
      setDeletingView(undefined);
    }
  };
  const publishSavedView = async (shared: boolean) => {
    if (!resource || !activeView) return;
    const personal = savedViews.find((item) => item.id === activeView);
    const serverId = serverViewId(activeView);
    const server = serverId ? serverViews.find((item) => item.id === serverId) : undefined;
    const view = personal ?? server;
    if (!view) return;
    try {
      // POST is an upsert keyed by name, so republishing never adds a duplicate row.
      const published = await publishServerView({ resource: resource.name, name: view.name, shared, search: view.search, filters: view.filters as unknown[] | undefined, sorters: view.sorters as unknown[] | undefined, columns: view.columns });
      setServerViews(await fetchServerViews(resource.name));
      // A published local view now lives on the server; drop the browser copy and follow the server row.
      if (!serverId) setSavedViews(deleteSavedView(resource.name, activeView));
      setActiveView(serverViewKey(published.id));
      notify?.({ type: "success", message: shared ? translate("qiy.viewShared", {}, "View shared with everyone") : translate("qiy.viewPublished", {}, "View saved to server") });
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : translate("qiy.publishFailed", {}, "Publishing the view failed") });
    }
  };
  const runExport = () => { if (!resource) return; setExporting(true); void downloadExport(exportUrl(resource.name, { filters, sorters, columns: visibleKeys, ids: selectedRowKeys.map(String) })).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setExporting(false)); };
  const { data: deletePermission } = useCan({ resource: name ?? "", action: "delete", queryOptions: { enabled: !!resource } });
  const [search, setSearch] = useState(""); const enumFields = resource?.fields.filter((field) => field.filterable && field.enumValues?.length) ?? []; const advancedFields = resource?.fields.filter((field) => field.filterable && !field.enumValues?.length && field.filterModes?.length) ?? []; const [enumFilters, setEnumFilters] = useState<Record<string, string | undefined>>({}); const [advancedFilters, setAdvancedFilters] = useState<Record<string, { operator: string; value: string }>>({}); const [advancedJoin, setAdvancedJoin] = useState<"and" | "or">("and");
  const { visibleKeys, setVisibleKeys } = useColumnVisibility(resource);
  const relationBatchFields = useMemo(() => (resource?.fields ?? []).filter((field) => field.relation && field.listVisible && canSeeField(field, identity?.role)), [resource, identity?.role]);
  const relationBatchRows = (tableProps.dataSource ?? []) as Array<Record<string, unknown>>;
  // One batched FK request per target resource instead of one getOne per cell. The
  // plan is memoized so a re-render (e.g. an identity or selection update) cannot
  // retrigger the batch queries.
  const relationBatchPlan = useMemo(() => buildRelationBatchPlan(relationBatchFields, relationBatchRows), [relationBatchFields, relationBatchRows]);
  if (!resource) return <Alert type="error" message={translate("qiy.unknownResource", {}, t(locale, "unknownResource"))} />;
  // Menu/list titles use @plural, create/edit titles use @singular; both fall
  // back to the translated resource label so older dictionaries keep working.
  const singular = translate(resource.singularKey, {}, translate(resource.labelKey, {}, resource.singular));
  const plural = translate(resource.pluralKey, {}, translate(resource.labelKey, {}, resource.label));
  const fields = resource.fields.filter((field) => field.type !== "Vector" && visibleKeys.includes(field.name) && canSeeField(field, identity?.role));
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => {
    const Icon = field.icon ? qiyIcons[field.icon as keyof typeof qiyIcons] : undefined;
    return { title: <Space>{Icon && <Icon />}<span>{translate(field.labelKey, {}, field.label)}</span></Space>, dataIndex: field.name, key: field.name, sorter: field.sortable, render: (value: unknown) => renderCell(field, value, notify, translate, locale) };
  });
  columns.push({ title: t(locale, "actions"), key: "actions", fixed: "right", render: (_value, record) => <Space>
    <ShowButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <EditButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <DeleteButton resource={resource.name} recordItemId={String(record.id)} hideText />
    <BusinessActions resource={resource.name} placement="list" record={record} />
  </Space> });
  const deleteSelected = async () => { await removeMany({ resource: resource.name, ids: selectedRowKeys.map(String) }); setSelectedRowKeys([]); notify?.({ type: "success", message: t(locale, "deleteSuccess") }); };
  const applyFilters = (nextSearch = search, nextEnums = enumFilters, nextAdvanced = advancedFilters, nextAdvancedJoin = advancedJoin) => { const filters: Array<{ field: string; operator: string; value: string | string[] } | { operator: "and" | "or"; value: Array<{ field: string; operator: string; value: string | string[] }> }> = nextSearch ? [{ field: "__search", operator: "contains", value: nextSearch }] : []; for (const [field, value] of Object.entries(nextEnums)) if (value) filters.push({ field, operator: "eq", value }); const advanced = Object.entries(nextAdvanced).flatMap(([field, condition]) => !condition.value ? [] : [{ field, operator: condition.operator, value: condition.operator === "in" || condition.operator === "between" ? condition.value.split(",").map((item) => item.trim()) : condition.value }]); if (advanced.length === 1) filters.push(advanced[0]!); else if (advanced.length > 1) filters.push({ operator: nextAdvancedJoin, value: advanced }); setFilters(filters as never); };
  return <List resource={resource.name} title={<Typography.Title level={3} style={{ margin: 0 }}>{plural}</Typography.Title>} headerButtons={() => <Space wrap><Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(file) => { setImporting(true); void startImport(resource.name, file).then(({ jobId }) => waitForImport(resource.name, jobId, { onProgress: (progress) => notify?.({ type: "progress", message: translate("qiy.importProgress", { processed: progress.processed, total: progress.total }) }) })).then((job) => { if (job.status === "failed") throw new Error(job.errors[0] ?? translate("qiy.importFailed", {}, "Import failed")); notify?.({ type: "success", message: translate("qiy.importedRows", { rows: job.processed }) }); return tableQuery.refetch(); }).catch((error) => notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) })).finally(() => setImporting(false)); return Upload.LIST_IGNORE; }}><Button icon={<UploadOutlined />} loading={importing}>{translate("qiy.import", {}, "Import CSV")}</Button></Upload><Button icon={<DownloadOutlined />} loading={exporting} onClick={runExport}>{selectedRowKeys.length > 0 ? translate("qiy.exportSelected", {}, "Export selected") + " (" + selectedRowKeys.length + ")" : translate("qiy.export", {}, "Export CSV")}</Button><Dropdown menu={{ items: resource.fields.filter((field) => field.type !== "Vector").map((field) => ({ key: field.name, label: <Checkbox checked={visibleKeys.includes(field.name)} onChange={(event) => setVisibleKeys((keys) => event.target.checked ? [...keys, field.name] : keys.filter((key) => key !== field.name))}>{translate(field.labelKey, {}, field.label)}</Checkbox> })) }}><Button icon={<SettingOutlined />}>{t(locale, "visibleColumns")}</Button></Dropdown><Select allowClear style={{ minWidth: 160 }} placeholder={translate("qiy.views", {}, "Saved views")} value={activeView} options={[...savedViews.map((view) => ({ value: view.id, label: <SavedViewLabel viewKey={view.id} name={view.name} kind="local" shared={false} deleting={deletingView === view.id} onDelete={removeSavedView} translate={translate} /> })), ...serverViews.map((view) => { const key = serverViewKey(view.id); return { value: key, label: <SavedViewLabel viewKey={key} name={view.name} kind="server" shared={view.shared} mine={view.mine} deleting={deletingView === key} onDelete={removeSavedView} translate={translate} /> }; })]} onChange={(value) => applySavedView(value)} /><Popover trigger="click" content={<Space direction="vertical"><Input value={viewName} placeholder={translate("qiy.viewName", {}, "View name")} onChange={(event) => setViewName(event.target.value)} onPressEnter={storeSavedView} /><Button type="primary" disabled={!viewName.trim()} onClick={storeSavedView}>{translate("qiy.save", {}, "Save")}</Button></Space>}><Button icon={<SaveOutlined />}>{translate("qiy.saveView", {}, "Save view")}</Button></Popover>{activeView && <Popover trigger="click" content={<Space direction="vertical"><Button onClick={() => void publishSavedView(false)}>{translate("qiy.saveToServer", {}, "Save to server")}</Button><Button onClick={() => void publishSavedView(true)}>{translate("qiy.shareView", {}, "Share with everyone")}</Button></Space>}><Button icon={<UploadOutlined />}>{translate("qiy.publishView", {}, "Publish view")}</Button></Popover>}
    <CreateButton resource={resource.name}>{translate("qiy.createResource", { resource: singular }, singular)}</CreateButton></Space>}>
    <div className="qiy-list-filters" role="search" aria-label={t(locale, "filters")}><Input.Search allowClear value={search} placeholder={t(locale, "search")} onChange={(event) => setSearch(event.target.value)} onSearch={(value) => { setSearch(value); applyFilters(value); }} />{enumFields.map((field) => <Select key={field.name} allowClear value={enumFilters[field.name]} placeholder={translate(field.labelKey, {}, field.label)} options={field.enumValues?.map((item) => ({ value: item.name, label: translate(item.labelKey, {}, item.label ?? item.name) }))} onChange={(value) => { const next = { ...enumFilters, [field.name]: value }; setEnumFilters(next); applyFilters(search, next); }} />)}{advancedFields.length > 1 && <Select value={advancedJoin} style={{ minWidth: 116 }} options={[{ value: "and", label: t(locale, "matchAll") }, { value: "or", label: t(locale, "matchAny") }]} onChange={(value: "and" | "or") => { setAdvancedJoin(value); applyFilters(search, enumFilters, advancedFilters, value); }} />}{advancedFields.map((field) => { const condition = advancedFilters[field.name] ?? { operator: field.filterModes[0] ?? "eq", value: "" }; return <Space.Compact key={field.name}><Select value={condition.operator} style={{ width: 120 }} options={field.filterModes.map((mode) => ({ value: mode, label: filterModeLabel(locale, mode) }))} onChange={(operator) => { const next = { ...advancedFilters, [field.name]: { ...condition, operator } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} />{isDateFieldType(field.type) && condition.operator !== "in" && condition.operator !== "between" ? <DateFieldInput type={field.type as DateFieldType} value={condition.value} placeholder={translate(field.labelKey, {}, field.label)} onChange={(next) => { const nextFilters = { ...advancedFilters, [field.name]: { ...condition, value: next ?? "" } }; setAdvancedFilters(nextFilters); applyFilters(search, enumFilters, nextFilters); }} /> : <Input allowClear value={condition.value} placeholder={translate(field.labelKey, {}, field.label) + (condition.operator === "in" || condition.operator === "between" ? t(locale, "commaSeparated") : "")} onChange={(event) => { const next = { ...advancedFilters, [field.name]: { ...condition, value: event.target.value } }; setAdvancedFilters(next); applyFilters(search, enumFilters, next); }} />}</Space.Compact>; })}</div>
    {tableQuery.error && <Alert type="error" showIcon message={String(tableQuery.error)} style={{ marginBottom: 16 }} />}
    {deletePermission?.can && selectedRowKeys.length > 0 && <Popconfirm title={t(locale, "confirmDelete")} onConfirm={() => void deleteSelected()}><Button danger icon={<DeleteOutlined />}>{t(locale, "batchDelete")} ({selectedRowKeys.length})</Button></Popconfirm>}
    <RelationBatchProvider plan={relationBatchPlan}>
    <Table<Record<string, unknown>> {...tableProps} pagination={{ ...tableProps.pagination, showSizeChanger: true, pageSizeOptions: ["10", "20", "50", "100"], showTotal: (total: number, range: [number, number]) => translate("qiy.paginationTotal", { start: range[0], end: range[1], total }), locale: { items_per_page: t(locale, "perPage"), page: t(locale, "page") } }} rowSelection={deletePermission?.can ? { selectedRowKeys, onChange: setSelectedRowKeys } : undefined} rowKey="id" columns={columns} scroll={{ x: "max-content" }} />
    </RelationBatchProvider>
  </List>;
}
