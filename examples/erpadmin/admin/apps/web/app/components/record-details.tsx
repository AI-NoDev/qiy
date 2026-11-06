import { useGetIdentity, useNotification, useTranslation } from "@refinedev/core";
import { Descriptions, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import { canSeeField, type ResourceDefinition, type ResourceField } from "../resources";
import { RelationCell } from "./relation-field";
import { formatFieldValue } from "../date-fields";
import { downloadFile } from "../hooks/download-file";
import { qiyIcons } from "../icons";
import { resolveLocale, t, type QiyLocale } from "../i18n";
import type { DisplayTranslate } from "../display-template";

/**
 * One record rendered field by field.
 *
 * This is the single source of truth for "detail" rendering: the show page
 * (`routes/show.tsx`) and the foreign-key drawer (`components/relation-field.tsx`)
 * both mount `RecordDetails`, so the two views cannot drift in field visibility,
 * role permissions, formatting, or labels. The component is presentational apart
 * from the i18n/identity hooks, which is what the generated
 * `tests/record-details.test.tsx` mocks to render it with `react-dom/server`.
 *
 * `components/relation-field.tsx` imports `RecordDetails` for its drawer body
 * while this module imports `RelationCell` for foreign keys. The cycle only
 * links function declarations that are called during rendering, which is safe
 * for ESM; splitting it would duplicate the recursive
 * "record → foreign key → record" wiring.
 */

/** Shown for empty values, matching the list page instead of a blank cell. */
export const emptyFieldPlaceholder = "—";

/** Authenticated download links for `File` / `Files` values. */
export function FileLinks({ value }: { value: unknown }) {
  const { open: notify } = useNotification();
  const keys = Array.isArray(value) ? value.map(String).filter(Boolean) : typeof value === "string" && value ? [value] : [];
  if (!keys.length) return <>{emptyFieldPlaceholder}</>;
  return (
    <Space wrap>
      {keys.map((key) => (
        <Typography.Link
          key={key}
          onClick={() => void downloadFile(key).catch((error) => { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); })}
        >
          {key.split("/").pop()}
        </Typography.Link>
      ))}
    </Space>
  );
}

/**
 * Renders one field value with the same rules the list page uses: enums become
 * colored tags, foreign keys delegate to `RelationCell`, files become download
 * links, vectors stay a placeholder (the API never returns the embedding), dates
 * go through the shared localized formatter, and empty values become "—".
 */
export function RecordFieldValue({ field, value, locale, translate }: {
  field: ResourceField;
  value: unknown;
  locale: QiyLocale;
  translate: DisplayTranslate;
}) {
  // A vector is never rendered inline; the details view only confirms it exists.
  if (field.type === "Vector") return <>{t(locale, "vectorData")}</>;
  if (value === null || value === undefined || value === "") return <>{emptyFieldPlaceholder}</>;
  if (field.relation) return <RelationCell field={field} value={value} />;
  if (field.type === "File" || field.type === "Files") return <FileLinks value={value} />;
  const enumValue = field.enumValues?.find((item) => item.name === String(value));
  if (enumValue) {
    const Icon = enumValue.icon ? qiyIcons[enumValue.icon as keyof typeof qiyIcons] : undefined;
    const comment = enumValue.commentKey ? translate(enumValue.commentKey, {}, enumValue.comment) : enumValue.comment;
    return <Tag title={comment} color={enumValue.color} icon={Icon ? <Icon /> : undefined}>{translate(enumValue.labelKey, {}, enumValue.label ?? enumValue.name)}</Tag>;
  }
  if (field.type === "Money" || field.type === "Decimal") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return <>{numeric.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>;
  }
  return <>{formatFieldValue(field.type, value, locale) || emptyFieldPlaceholder}</>;
}

export interface RecordDetailsProps {
  /** Resource metadata of the rendered record (target entity of the show page or FK drawer). */
  resource: ResourceDefinition;
  /** The record to render, as returned by Refine's data provider. */
  record: Record<string, unknown>;
  /** Ant Design `Descriptions` density; the drawer uses `small`. */
  size?: "default" | "small";
}

/**
 * The fields a detail view renders for `role`. Shared by `RecordDetails` and by
 * pages that pre-plan batched FK lookups, so hidden fields are never fetched.
 */
export function visibleDetailFields(resource: ResourceDefinition, role: string | undefined | null): ResourceField[] {
  return resource.fields.filter((field) => field.showVisible && canSeeField(field, role));
}

/**
 * Renders every field a detail view may show for the current role. Both the
 * show page and the related-record drawer use it, so the field list, labels,
 * permissions and formatting are identical in both places.
 */
export function RecordDetails({ resource, record, size = "default" }: RecordDetailsProps) {
  const { translate, getLocale } = useTranslation();
  const { data: identity } = useGetIdentity<{ role?: string }>();
  const locale: QiyLocale = resolveLocale(getLocale());
  const display = translate as unknown as DisplayTranslate;
  const fields: ResourceField[] = visibleDetailFields(resource, identity?.role);
  return (
    <Descriptions bordered column={1} size={size} className="qiy-record-details">
      {fields.map((field) => (
        <Descriptions.Item key={field.name} label={translate(field.labelKey, {}, field.label)}>
          <RecordFieldValue field={field} value={record[field.name]} locale={locale} translate={display} />
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}
