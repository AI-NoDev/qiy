import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Regression test for the relational cell: Refine's `useOne` returns the record
 * itself (not `{ data: record }`), so the cell used to fall back to the raw UUID
 * and the drawer body stayed empty. Only the data hooks are mocked so the real
 * components (AntD, display templates, resource metadata) still render.
 */
const related = { id: "00000000-0000-4000-8000-000000000010", code: "ACME", name: "ACME Supply Group" };

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useOne: () => ({ result: related, query: { isLoading: false, error: undefined } }),
  useTranslation: () => ({
    translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "",
    getLocale: () => "zh-CN",
  }),
}));

const router = await import("react-router");
mock.module("react-router", () => ({
  ...router,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children),
}));

const { RelationCell } = await import("../app/components/relation-field");

const field = {
  name: "parentId",
  label: "parentId",
  labelKey: "qiy.resources.orgs.fields.parentId.label",
  type: "UUID",
  nullable: true,
  primaryKey: false,
  visible: true,
  listVisible: true,
  formVisible: true,
  showVisible: true,
  sortable: true,
  filterable: true,
  filterModes: ["eq"],
  relation: { resource: "orgs", labelField: "name" },
};

test("renders the related record's display template instead of the raw id", () => {
  const html = renderToStaticMarkup(createElement(RelationCell, { field: field as never, value: related.id }));
  expect(html).toContain("ACME · ACME Supply Group");
  expect(html).not.toContain(">" + related.id + "<");
});
