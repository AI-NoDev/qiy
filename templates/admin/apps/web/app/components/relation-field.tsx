import { useSelect } from "@refinedev/antd";
import { useOne, useTranslation } from "@refinedev/core";
import { Alert, Button, Descriptions, Drawer, Form, Select, Space, Spin, Tag } from "antd";
import { useState } from "react";
import { Link } from "react-router";
import { getResource, type ResourceDefinition, type ResourceField } from "../resources";
import { displayFieldValue, recordDisplayText, relationDetailHtml, type DisplayTemplateOptions, type DisplayTranslate } from "../display-template";

/**
 * Foreign-key rendering. A FK cell never shows a raw UUID: it shows the target
 * entity's `@tableDisplay`/`@display` text (falling back to the target's label
 * field, then the id) as a link. Clicking the link opens a drawer with the target
 * record's `@relationDetail` body, rendered from the entity display template and
 * therefore escaped. The same component is used by list cells, detail pages and
 * related-record tables so every foreign-key column behaves the same way.
 *
 * Records are fetched per id through Refine's `useOne`: React Query dedupes
 * identical ids and caches them for a minute, which keeps repeated FK values on
 * one page to a single request. Batching distinct ids through `getList` with an
 * `id in [...]` filter was rejected because it needs a page-level provider that
 * related-record tables and drawers cannot share without duplicating the fetch
 * path; each FK cell already needs its target record for the drawer body.
 */
export function displayOptions(resource: ResourceDefinition | undefined, translate: DisplayTranslate): DisplayTemplateOptions {
  return { fields: resource?.fields, translate };
}

/** Plain text label for a related record (drawer title, list cell, select option). */
export function relatedRecordLabel(resource: ResourceDefinition | undefined, record: Record<string, unknown> | undefined, translate: DisplayTranslate, labelField?: string): string {
  return recordDisplayText(resource, record, displayOptions(resource, translate), labelField);
}

export function relatedEntityTitle(resource: ResourceDefinition | undefined, translate: DisplayTranslate): string {
  if (!resource) return "";
  return translate(resource.singularKey, {}, translate(resource.labelKey, {}, resource.singular));
}

interface RelationLinkProps {
  target: ResourceDefinition | undefined;
  resource: string;
  id: string;
  labelField?: string;
}

function RelationLink({ target, resource, id, labelField }: RelationLinkProps) {
  const { translate } = useTranslation();
  const [open, setOpen] = useState(false);
  const { result, query } = useOne<Record<string, unknown>>({ resource, id, queryOptions: { enabled: Boolean(resource && id), staleTime: 60_000, retry: false } });
  const record = (result?.data ?? undefined) as Record<string, unknown> | undefined;
  const display = translate as unknown as DisplayTranslate;
  const text = relatedRecordLabel(target, record, display, labelField);
  const title = relatedEntityTitle(target, display);
  const detailHtml = relationDetailHtml(target, record, displayOptions(target, display));
  return (
    <>
      <Link
        to={"/" + resource + "/" + encodeURIComponent(id)}
        onClick={(event) => {
          // Keep modifier-click/new-tab behavior; a plain click opens the drawer.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {text || (query.isLoading ? "…" : id)}
      </Link>
      <Drawer open={open} onClose={() => setOpen(false)} width={520} title={title ? title + " · " + (text || id) : text || id} destroyOnClose>
        {query.isLoading && <Spin />}
        {query.error && <Alert type="error" showIcon message={String(query.error)} />}
        {record && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {detailHtml ? (
              <div className="qiy-relation-detail" dangerouslySetInnerHTML={{ __html: detailHtml }} />
            ) : (
              <Descriptions bordered size="small" column={1}>
                {(target?.fields ?? []).filter((field) => field.showVisible && field.type !== "Vector" && field.type !== "File" && field.type !== "Files").slice(0, 8).map((field) => (
                  <Descriptions.Item key={field.name} label={translate(field.labelKey, {}, field.label)}>
                    {field.enumValues ? <Tag>{displayFieldValue(field.name, record, displayOptions(target, display)) ?? "—"}</Tag> : String(record[field.name] ?? "—")}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            )}
            <Link to={"/" + resource + "/" + encodeURIComponent(id)}>
              <Button type="primary">{translate("qiy.openDetail", {}, "Open details")}</Button>
            </Link>
          </Space>
        )}
      </Drawer>
    </>
  );
}

/** Renders one foreign-key value. A missing relation (or empty value) degrades to plain text. */
export function RelationCell({ field, value }: { field: ResourceField; value: unknown }) {
  const relation = field.relation;
  if (!relation) return <>{value === null || value === undefined || value === "" ? "—" : String(value)}</>;
  const id = value === null || value === undefined || value === "" ? "" : String(value);
  if (!id) return <>—</>;
  return <RelationLink target={getResource(relation.resource)} resource={relation.resource} id={id} labelField={relation.labelField} />;
}

/** Form select for a foreign key: options are labelled with the target entity's display template. */
export function RelationSelect({ relation, fieldName }: { relation: NonNullable<ResourceField["relation"]>; fieldName: string }) {
  const { translate } = useTranslation();
  const form = Form.useFormInstance();
  const current = Form.useWatch(fieldName, form) as unknown;
  const target = getResource(relation.resource);
  const display = translate as unknown as DisplayTranslate;
  const { selectProps } = useSelect<Record<string, unknown>>({
    resource: relation.resource,
    optionLabel: (item) => relatedRecordLabel(target, item, display, relation.labelField) || String(item.id ?? ""),
    optionValue: "id",
    searchField: relation.labelField,
    pagination: { pageSize: 100 },
    ...(current ? { defaultValue: String(current) } : {}),
    queryOptions: { staleTime: 60_000 },
    onSearch: (value) => [{ field: "__search", operator: "contains", value }],
  });
  return <Select {...selectProps} showSearch optionFilterProp="label" allowClear />;
}
