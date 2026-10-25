import { useOne, useTranslation, CanAccess } from "@refinedev/core";
import { EditButton, ListButton, Show } from "@refinedev/antd";
import { Alert, Space } from "antd";
import { useParams } from "react-router";
import { getResource } from "../resources";
import { RecordDetails } from "../components/record-details";
import { t, resolveLocale, type QiyLocale } from "../i18n";
__QIY_ORDER_IMPORT__
/**
 * Detail page. The field list is rendered by the shared `RecordDetails`
 * component so the foreign-key drawer shows exactly the same content.
 */
export default function ResourceShow() { const { resource: name, id } = useParams(); const resource = getResource(name); const { getLocale, translate } = useTranslation(); const locale: QiyLocale = resolveLocale(getLocale()); const { result, query } = useOne({ resource: name ?? "", id: id ?? "", liveMode: resource?.liveMode ?? "off", queryOptions: { enabled: !!resource && !!id } }); if (!resource) return <Alert type="error" message={t(locale, "unknownResource")} />; return <Show resource={resource.name} recordItemId={id} isLoading={query.isLoading} title={`${translate(resource.singularKey, {}, translate(resource.labelKey, {}, resource.singular))} ${t(locale, "detail")}`} headerButtons={() => <Space><CanAccess resource={resource.name} action="edit"><EditButton resource={resource.name} recordItemId={id}>{t(locale, "edit")}</EditButton></CanAccess><ListButton resource={resource.name}>{t(locale, "back")}</ListButton></Space>}>{query.error && <Alert type="error" message={String(query.error)} />}{result && <RecordDetails resource={resource} record={result} />}__QIY_ORDER_ACTIONS__</Show>; }
