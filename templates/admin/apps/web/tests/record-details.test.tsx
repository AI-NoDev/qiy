import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatFieldValue } from "../app/date-fields";
import type { ResourceDefinition, ResourceField } from "../app/resources";

/**
 * The foreign-key drawer shows the same record details as the detail page: the
 * show page and the drawer both mount `RecordDetails`, and the drawer header is
 * a breadcrumb. These are regression tests for that contract.
 *
 * Only the Refine data/i18n/identity hooks are mocked; the real Ant Design
 * components, resource metadata handling and display templates still render
 * through `react-dom/server`, so the assertions are DOM-free but not fake.
 */
const related = { id: "00000000-0000-4000-8000-000000000010", name: "ACME Supply Group" };
let currentRole: string | undefined = "admin";
const messages: Record<string, string> = {
  "qiy.drawerBreadcrumb": "Related record path",
  "qiy.recordDetails": "Field details",
  "qiy.recordSummary": "Relation summary",
  "qiy.openDetail": "Open details",
};
const translate = (key: string, _params?: unknown, fallback?: string) => messages[key] ?? fallback ?? "";

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useOne: () => ({ result: related, query: { isLoading: false, error: undefined } }),
  useTranslation: () => ({ translate, getLocale: () => "zh-CN" }),
  useGetIdentity: () => ({ data: { role: currentRole } }),
  useNotification: () => ({ open: () => undefined }),
}));

const router = await import("react-router");
mock.module("react-router", () => ({
  ...router,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children),
}));

const { RecordDetails } = await import("../app/components/record-details");
const { RelatedRecordBody, RelatedRecordBreadcrumb } = await import("../app/components/relation-field");

function field(name: string, type: ResourceField["type"], extra: Partial<ResourceField> = {}): ResourceField {
  return {
    name,
    label: name,
    labelKey: "qiy.resources.orders.fields." + name + ".label",
    type,
    nullable: true,
    primaryKey: false,
    visible: true,
    listVisible: true,
    formVisible: true,
    showVisible: true,
    sortable: true,
    filterable: true,
    filterModes: ["eq"],
    ...extra,
  };
}

const orderResource = {
  name: "orders",
  apiName: "Order",
  label: "Orders",
  labelKey: "qiy.resources.orders.label",
  singular: "Order",
  singularKey: "qiy.resources.orders.singular",
  plural: "Orders",
  pluralKey: "qiy.resources.orders.plural",
  icon: "ShoppingOutlined",
  liveMode: "off",
  fields: [
    field("id", "UUID", { label: "内部 ID", primaryKey: true, showVisible: false }),
    field("number", "Text", { label: "订单号", nullable: false }),
    field("status", "Text", { label: "状态", enumValues: [{ name: "approved", label: "已批准", labelKey: "qiy.enums.purchaseStatus.values.approved", color: "green" }] }),
    field("expectedDate", "Date", { label: "预计日期" }),
    field("supplierId", "UUID", { label: "供应商", relation: { resource: "suppliers", labelField: "name" } }),
    field("note", "Text", { label: "备注" }),
    field("internalNote", "Text", { label: "内部备注", roles: ["admin"] }),
  ],
} as ResourceDefinition;

const orderRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  number: "PO-2026-001",
  status: "approved",
  expectedDate: "2026-01-05",
  supplierId: related.id,
  note: null,
  internalNote: "only for admins",
};

const supplierResource = {
  name: "suppliers",
  apiName: "Supplier",
  label: "Suppliers",
  labelKey: "qiy.resources.suppliers.label",
  singular: "Supplier",
  singularKey: "qiy.resources.suppliers.singular",
  plural: "Suppliers",
  pluralKey: "qiy.resources.suppliers.plural",
  icon: "ShopOutlined",
  liveMode: "off",
  displayTemplate: "{$.name}",
  tableDisplayTemplate: "{$.name}",
  relationDetailTemplate: "<b>{$.name}</b></br>{$.code}",
  fields: [
    field("id", "UUID", { primaryKey: true, showVisible: false }),
    field("name", "Text", { label: "供应商名称" }),
    field("code", "Text", { label: "供应商编码" }),
  ],
} as ResourceDefinition;

const supplierRecord = { id: related.id, name: "ACME Supply Group", code: "SUP-1" };

test("renders every detail-visible field with the detail page formatting", () => {
  currentRole = "admin";
  const html = renderToStaticMarkup(createElement(RecordDetails, { resource: orderResource, record: orderRecord }));
  // Visible labels and plain values.
  expect(html).toContain("订单号");
  expect(html).toContain("PO-2026-001");
  expect(html).toContain("预计日期");
  expect(html).toContain("供应商");
  // Enum values become the same colored tag as the list cell.
  expect(html).toContain("状态");
  expect(html).toContain("已批准");
  expect(html).toContain("ant-tag-green");
  // Date values use the shared localized formatter instead of the raw ISO string.
  expect(html).toContain(formatFieldValue("Date", "2026-01-05", "zh-CN"));
  expect(html).not.toContain("2026-01-05");
  // Foreign keys render the RelationCell link to the target record.
  expect(html).toContain('href="/suppliers/' + related.id + '"');
  // Empty values use the shared placeholder instead of a blank cell.
  expect(html).toContain("备注");
  expect(html).toContain("—");
  // Fields the detail view hides never reach the DOM.
  expect(html).not.toContain("内部 ID");
});

test("omits fields the current role may not see", () => {
  currentRole = "viewer";
  const html = renderToStaticMarkup(createElement(RecordDetails, { resource: orderResource, record: orderRecord }));
  expect(html).toContain("订单号");
  expect(html).not.toContain("内部备注");
  currentRole = "admin";
  const visible = renderToStaticMarkup(createElement(RecordDetails, { resource: orderResource, record: orderRecord }));
  expect(visible).toContain("内部备注");
});

test("renders the @relationDetail summary above the shared field details", () => {
  const html = renderToStaticMarkup(createElement(RelatedRecordBody, { target: supplierResource, record: supplierRecord }));
  expect(html).toContain("Relation summary");
  expect(html).toContain("<b>ACME Supply Group</b>");
  expect(html).toContain("Field details");
  expect(html).toContain("供应商编码");
  expect(html).toContain("SUP-1");
  // The summary is the optional top block; the field descriptions follow it.
  expect(html.indexOf("Relation summary")).toBeLessThan(html.indexOf("Field details"));
});

test("skips the summary block when the entity declares no @relationDetail", () => {
  const { relationDetailTemplate: _displayTemplate, ...plainTarget } = supplierResource;
  const html = renderToStaticMarkup(createElement(RelatedRecordBody, { target: plainTarget, record: supplierRecord }));
  expect(html).not.toContain("Relation summary");
  expect(html).toContain("Field details");
  expect(html).toContain("供应商名称");
});

test("renders the drawer breadcrumb with list and detail links", () => {
  const html = renderToStaticMarkup(createElement(RelatedRecordBreadcrumb, {
    ariaLabel: "Related record path",
    listHref: "/suppliers",
    listLabel: "供应商",
    showHref: "/suppliers/" + related.id,
    recordText: "ACME Supply Group",
  }));
  expect(html).toContain('href="/suppliers"');
  expect(html).toContain('href="/suppliers/' + related.id + '"');
  expect(html).toContain("供应商");
  expect(html).toContain("ACME Supply Group");
  expect(html).toContain('aria-label="Related record path"');
});
