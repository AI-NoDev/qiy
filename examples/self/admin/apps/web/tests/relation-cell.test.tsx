import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Regression test for the relational cell: Refine's `useOne` returns the record
 * itself (not `{ data: record }`), so the cell used to fall back to the raw UUID
 * and the drawer body stayed empty. Only the data hooks are mocked so the real
 * components (AntD, display templates, resource metadata) still render.
 *
 * The batch tests cover the batched path: a list page wraps its table in
 * `RelationBatchProvider`, which loads every FK id of a resource with one
 * `useMany` call. The cell renders from that batch and disables its own `useOne`
 * query, including while the batch is still loading, so the per-cell detail
 * request is gone.
 */
const related = { id: "00000000-0000-4000-8000-000000000010", code: "ACME", name: "ACME Supply Group" };

type UseOneProps = { resource: string; id: string; queryOptions?: { enabled?: boolean } };
const useOneCalls: UseOneProps[] = [];
let batchPending = false;

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useOne: (props: UseOneProps) => {
    useOneCalls.push(props);
    // A disabled query has no data until something else fills it (the batch context).
    return { result: props.queryOptions?.enabled === false ? undefined : related, query: { isLoading: false, error: undefined } };
  },
  useMany: () => ({
    result: { data: batchPending ? [] : [related] },
    query: { isLoading: batchPending, isPending: batchPending, isFetching: batchPending, error: undefined },
  }),
  useDataProvider: () => () => ({
    getMany: async ({ ids }: { ids: string[] }) => ({ data: ids.filter((id) => id === related.id).map(() => related) }),
  }),
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
const { RelationBatchProvider } = await import("../app/components/relation-batch");

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
  useOneCalls.length = 0;
  const html = renderToStaticMarkup(createElement(RelationCell, { field: field as never, value: related.id }));
  expect(html).toContain("ACME · ACME Supply Group");
  expect(html).not.toContain(">" + related.id + "<");
  expect(useOneCalls).toHaveLength(1);
  expect(useOneCalls[0]!.queryOptions?.enabled).toBe(true);
});

test("renders from the batch provider without a per-cell detail request", () => {
  batchPending = false;
  useOneCalls.length = 0;
  const html = renderToStaticMarkup(
    createElement(RelationBatchProvider, {
      plan: [{ resource: "orgs", ids: [related.id] }],
      children: createElement(RelationCell, { field: field as never, value: related.id }),
    }),
  );
  expect(html).toContain("ACME · ACME Supply Group");
  expect(html).not.toContain(">" + related.id + "<");
  // The hook still mounts (rules of hooks), but its query is disabled because the
  // batched record is already available — no GET /api/v1/orgs/<id> per cell.
  expect(useOneCalls).toHaveLength(1);
  expect(useOneCalls[0]!.queryOptions?.enabled).toBe(false);
});

test("keeps the per-cell query disabled while the batch is still loading", () => {
  batchPending = true;
  useOneCalls.length = 0;
  try {
    const html = renderToStaticMarkup(
      createElement(RelationBatchProvider, {
        plan: [{ resource: "orgs", ids: [related.id] }],
        children: createElement(RelationCell, { field: field as never, value: related.id }),
      }),
    );
    // The first paint shows the loading placeholder, not the raw id, and still
    // never enables the per-cell query.
    expect(html).toContain("…");
    expect(html).not.toContain(">" + related.id + "<");
    expect(useOneCalls).toHaveLength(1);
    expect(useOneCalls[0]!.queryOptions?.enabled).toBe(false);
  } finally {
    batchPending = false;
  }
});
