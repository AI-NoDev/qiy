import { useList } from "@refinedev/core";
import { useTranslation } from "@refinedev/core";
import { Alert, Card, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router";
import { canSeeField, getResource } from "../resources";
import { RelationCell } from "./relation-field";
import { formatFieldValue } from "../date-fields";
import { t, resolveLocale, type QiyLocale } from "../i18n";

interface RelatedResource { resource: string; field: string; label: string; labelKey: string; }

export function RelatedRecords({ relation, recordId }: { relation: RelatedResource; recordId: string }) {
  const { getLocale, translate } = useTranslation();
  const locale: QiyLocale = resolveLocale(getLocale());
  const resource = getResource(relation.resource);
  const { result, query } = useList<Record<string, unknown>>({
    resource: relation.resource,
    filters: [{ field: relation.field, operator: "eq", value: recordId }],
    pagination: { currentPage: 1, pageSize: 10 },
    queryOptions: { enabled: Boolean(recordId) },
  });
  const fields = resource?.fields.filter((field) => field.listVisible && !field.primaryKey && field.type !== "Vector").slice(0, 5) ?? [];
  const columns: ColumnsType<Record<string, unknown>> = fields.map((field) => ({ title: translate(field.labelKey, {}, field.label), dataIndex: field.name, key: field.name, render: (value: unknown) => field.relation ? <RelationCell field={field} value={value} /> : formatFieldValue(field.type, value, locale) || "—" }));
  columns.push({ title: t(locale, "actions"), key: "actions", render: (_value, record) => <Link to={"/" + relation.resource + "/" + String(record.id)}>{t(locale, "view")}</Link> });
  if (!resource) return <Alert type="error" message={translate("qiy.relatedUnknown", { resource: relation.resource })} />;
  const total = result.total ?? 0;
  return <Card size="small" title={translate(relation.labelKey, {}, relation.label)} style={{ marginTop: 16 }}><Table<Record<string, unknown>> rowKey="id" loading={query.isLoading} dataSource={result.data} columns={columns} pagination={total > 10 ? { pageSize: 10, total, showSizeChanger: false } : false} scroll={{ x: "max-content" }} /></Card>;
}
