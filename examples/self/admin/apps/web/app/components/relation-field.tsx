import { useSelect } from "@refinedev/antd";
import { useOne, useTranslation } from "@refinedev/core";
import { Alert, Breadcrumb, Button, Drawer, Select, Skeleton, Space, Spin, Typography, type SelectProps } from "antd";
import { useMemo, useState, type FC, type ReactNode } from "react";
import { Link } from "react-router";
import { mergeRelationOptions, type QiyRelationOption } from "../relation-options";
import { getResource, type ResourceDefinition, type ResourceField } from "../resources";
import { recordDisplayText, relationDetailHtml, type DisplayTemplateOptions, type DisplayTranslate } from "../display-template";
import { formatFieldValue } from "../date-fields";
import { RecordDetails } from "./record-details";
import { useBatchedRelation } from "./relation-batch";

/**
 * Foreign-key rendering. A FK cell never shows a raw UUID: it shows the target
 * entity's `@tableDisplay`/`@display` text (falling back to the target's label
 * field, then the id) as a link. Clicking the link opens a drawer that mirrors
 * the target record's detail page: a breadcrumb in the header (target resource
 * list / current record detail page), the optional `@relationDetail` summary,
 * then every `showVisible` field via the shared `RecordDetails` component.
 * Foreign keys inside the drawer open their own stacked drawer.
 *
 * Records normally arrive from the surrounding `RelationBatchProvider`
 * (`./relation-batch`), which loads a list page's FK ids per target resource with
 * one `useMany`/`getMany` request. The per-cell `useOne` lookup stays as the
 * fallback for pages without a batch provider (show-page related tables, drawer
 * bodies, selects) and for host integrations whose data provider has no
 * `getMany`; it is disabled whenever a batched record is already available.
 */
export function displayOptions(resource: ResourceDefinition | undefined, translate: DisplayTranslate, locale?: string): DisplayTemplateOptions {
  return { fields: resource?.fields, translate, ...(locale ? { locale } : {}) };
}

/** Plain text label for a related record (drawer title, list cell, select option). */
export function relatedRecordLabel(resource: ResourceDefinition | undefined, record: Record<string, unknown> | undefined, translate: DisplayTranslate, labelField?: string, locale?: string): string {
  return recordDisplayText(resource, record, displayOptions(resource, translate, locale), labelField);
}

export function relatedEntityTitle(resource: ResourceDefinition | undefined, translate: DisplayTranslate): string {
  if (!resource) return "";
  return translate(resource.singularKey, {}, translate(resource.labelKey, {}, resource.singular));
}

export interface RelatedRecordBreadcrumbProps {
  /** Accessible name of the breadcrumb (e.g. "Related record path"). */
  ariaLabel: string;
  /** Target resource list route. */
  listHref: string;
  /** Localized target resource label. */
  listLabel: string;
  /** Target record detail route. */
  showHref: string;
  /** Localized display text of the current drawer record. */
  recordText: string;
}

/** antd's BreadcrumbProps omit generic DOM attributes even though antd forwards them to <nav>. */
const BreadcrumbNav = Breadcrumb as unknown as FC<{ className?: string; items: Array<{ title: ReactNode }>; "aria-label"?: string }>;

/**
 * Drawer header breadcrumb: target resource list → current record detail page.
 * It is presentational so the generated test can render it without a browser.
 */
export function RelatedRecordBreadcrumb({ ariaLabel, listHref, listLabel, showHref, recordText }: RelatedRecordBreadcrumbProps) {
  return (
    <BreadcrumbNav
      className="qiy-record-breadcrumb"
      aria-label={ariaLabel}
      items={[
        { title: <Link to={listHref}>{listLabel}</Link> },
        { title: <Link to={showHref}>{recordText}</Link> },
      ]}
    />
  );
}

/**
 * Drawer body: the optional `@relationDetail` summary followed by the same field
 * descriptions the detail page renders. It only needs the i18n hooks, so the
 * generated test renders it directly to prove the drawer mirrors the show page.
 */
export function RelatedRecordBody({ target, record }: { target: ResourceDefinition; record: Record<string, unknown> }) {
  const { translate, getLocale } = useTranslation();
  const display = translate as unknown as DisplayTranslate;
  const summary = relationDetailHtml(target, record, displayOptions(target, display, getLocale()));
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }} className="qiy-related-record">
      {summary && (
        <section className="qiy-record-summary">
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>{translate("qiy.recordSummary", {}, "Relation summary")}</Typography.Text>
          <div className="qiy-relation-detail" dangerouslySetInnerHTML={{ __html: summary }} />
        </section>
      )}
      <section className="qiy-record-details-section">
        <Typography.Title level={5} style={{ marginTop: 0 }}>{translate("qiy.recordDetails", {}, "Field details")}</Typography.Title>
        <RecordDetails resource={target} record={record} size="small" />
      </section>
    </Space>
  );
}

interface RelationLinkProps {
  target: ResourceDefinition | undefined;
  resource: string;
  id: string;
  labelField?: string;
}

function RelationLink({ target, resource, id, labelField }: RelationLinkProps) {
  const { translate, getLocale } = useTranslation();
  const locale = getLocale();
  const [open, setOpen] = useState(false);
  // A list page batches all FK ids through RelationBatchProvider; while that batch
  // is loading (or once its record arrived) the per-cell `useOne` query stays
  // disabled, so the first paint does not fire one detail request per cell.
  // Without a batch provider the single-record fallback runs as before.
  const batched = useBatchedRelation(resource, id);
  const { result, query } = useOne<Record<string, unknown>>({ resource, id, queryOptions: { enabled: !batched.record && !batched.pending && Boolean(resource && id), staleTime: 60_000, retry: false } });
  // Refine's `useOne` returns the record itself in `result` (the data provider's
  // response is already unwrapped); wrapping it in `.data` produced an empty label
  // and an empty drawer for every foreign key.
  const record = (batched.record ?? result ?? undefined) as Record<string, unknown> | undefined;
  const loading = query.isLoading || batched.pending;
  const display = translate as unknown as DisplayTranslate;
  const text = relatedRecordLabel(target, record, display, labelField, locale);
  const title = relatedEntityTitle(target, display);
  const showHref = "/" + resource + "/" + encodeURIComponent(id);
  return (
    <>
      <Link
        to={showHref}
        onClick={(event) => {
          // Keep modifier-click/new-tab behavior; a plain click opens the drawer.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {text ? text : loading ? <Skeleton.Input active size="small" style={{ width: 120, height: 16 }} aria-label={translate("qiy.loading", {}, "Loading")} /> : id}
      </Link>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width="min(92vw, 760px)"
        destroyOnClose
        title={<RelatedRecordBreadcrumb
          ariaLabel={translate("qiy.drawerBreadcrumb", {}, "Related record path")}
          listHref={"/" + resource}
          listLabel={title || resource}
          showHref={showHref}
          recordText={text || id}
        />}
        extra={<Link to={showHref}><Button type="link" size="small">{translate("qiy.openDetail", {}, "Open details")}</Button></Link>}
        footer={<Space style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}><Button onClick={() => setOpen(false)}>{translate("qiy.close", {}, "Close")}</Button></Space>}
        styles={{ body: { paddingTop: 12 } }}
      >
        {loading && <Spin />}
        {query.error && <Alert type="error" showIcon message={String(query.error)} />}
        {!target && <Alert type="error" showIcon message={translate("qiy.relatedUnknown", { resource }, "Unknown related resource: {{resource}}")} />}
        {target && record && <RelatedRecordBody target={target} record={record} />}
      </Drawer>
    </>
  );
}

/** Renders one foreign-key value. A missing relation (or empty value) degrades to plain text. */
export function RelationCell({ field, value }: { field: ResourceField; value: unknown }) {
  const { getLocale } = useTranslation();
  const relation = field.relation;
  if (!relation) return <>{formatFieldValue(field.type, value, getLocale()) || "—"}</>;
  const id = value === null || value === undefined || value === "" ? "" : String(value);
  if (!id) return <>—</>;
  return <RelationLink target={getResource(relation.resource)} resource={relation.resource} id={id} labelField={relation.labelField} />;
}

/**
 * Form select for a foreign key: options are labelled with the target entity's
 * display template.
 *
 * `Form.Item` injects `value` and `onChange` into its child. They must be
 * forwarded to the underlying `Select`, otherwise the picker renders but the
 * form value stays `undefined` (the field then fails its required rule).
 */
export function RelationSelect({ relation, fieldName, value, onChange }: {
  relation: NonNullable<ResourceField["relation"]>;
  fieldName: string;
  /** Current form value injected by Form.Item (the related record id). */
  value?: unknown;
  /** Form.Item setter; receives the selected id or undefined when cleared. */
  onChange?: (next?: string) => void;
}) {
  const { translate } = useTranslation();
  const target = getResource(relation.resource);
  const display = translate as unknown as DisplayTranslate;
  const currentId = value === null || value === undefined || value === "" ? undefined : String(value);
  const { selectProps } = useSelect<Record<string, unknown>>({
    resource: relation.resource,
    optionLabel: (item) => relatedRecordLabel(target, item, display, relation.labelField) || String(item.id ?? ""),
    optionValue: "id",
    searchField: relation.labelField,
    pagination: { pageSize: 100 },
    queryOptions: { staleTime: 60_000 },
    onSearch: (value) => [{ field: "__search", operator: "contains", value }],
  });
  // `defaultValue`/`onChange` from useSelect target its own uncontrolled option
  // type; the form value is controlled here, so both are replaced by the value
  // and change handler below.
  const { defaultValue, onChange: selectOnChange, ...selectRestProps } = selectProps;
  void defaultValue;
  void selectOnChange;
  // The selected record may not be on the first options page (or the options may
  // still be loading), so resolve it explicitly and merge it into the options.
  const { result: selected } = useOne<Record<string, unknown>>({
    resource: relation.resource,
    id: currentId ?? "",
    queryOptions: { enabled: Boolean(currentId), staleTime: 60_000, retry: false },
  });
  const selectedRecord = (selected ?? undefined) as Record<string, unknown> | undefined;
  const selectedLabel = selectedRecord ? relatedRecordLabel(target, selectedRecord, display, relation.labelField) : undefined;
  const options = useMemo(
    () => mergeRelationOptions((selectRestProps.options ?? []) as QiyRelationOption[], currentId, selectedLabel),
    [selectRestProps.options, currentId, selectedLabel],
  );
  // Refine's `useSelect` returns props typed for its own option shape; the form
  // owns the value, so the remaining props are adapted to this option type.
  const rest = selectRestProps as SelectProps<string | undefined, QiyRelationOption>;
  return (
    <Select
      {...rest}
      options={options}
      value={currentId}
      onChange={(next: string | undefined) => onChange?.(next)}
      data-field={fieldName}
      showSearch
      optionFilterProp="label"
      allowClear
    />
  );
}
