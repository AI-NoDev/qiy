import { useOne, useGetIdentity, useTranslation, CanAccess } from "@refinedev/core";
import { EditButton, ListButton, Show } from "@refinedev/antd";
import { Alert, Space } from "antd";
import { useParams } from "react-router";
import { getResource } from "../resources";
import { RecordDetails, visibleDetailFields } from "../components/record-details";
import { RelationBatchProvider, buildRelationBatchPlan } from "../components/relation-batch";
import { t, resolveLocale, type QiyLocale } from "../i18n";
__QIY_ORDER_IMPORT__
/**
 * Detail page. The field list is rendered by the shared `RecordDetails`
 * component so the foreign-key drawer shows exactly the same content, and its
 * FK values are batched into one request per target resource.
 */
export default function ResourceShow() { const { resource: name, id } = useParams(); const resource = getResource(name); const { getLocale, translate } = useTranslation(); const { data: identity } = useGetIdentity<{ role?: string }>(); const locale: QiyLocale = resolveLocale(getLocale()); const { result, query } = useOne({ resource: name ?? "", id: id ?? "", liveMode: resource?.liveMode ?? "off", queryOptions: { enabled: !!resource && !!id } }); if (!resource) return <Alert type="error" message={t(locale, "unknownResource")} />; return <Show resource={resource.name} recordItemId={id} isLoading={query.isLoading} title={`${translate(resource.singularKey, {}, translate(resource.labelKey, {}, resource.singular))} ${t(locale, "detail")}`} headerButtons={() => <Space><CanAccess resource={resource.name} action="edit"><EditButton resource={resource.name} recordItemId={id}>{t(locale, "edit")}</EditButton></CanAccess><ListButton resource={resource.name}>{t(locale, "back")}</ListButton></Space>}>{query.error && <Alert type="error" message={String(query.error)} />}{result && <RelationBatchProvider plan={buildRelationBatchPlan(visibleDetailFields(resource, identity?.role), [result])}><RecordDetails resource={resource} record={result} /></RelationBatchProvider>}__QIY_ORDER_ACTIONS__</Show>; }
