import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resources } from "../app/resources";
import type { ChartDefinition, ChartLabelsDefinition, ChartPanelDefinition, ChartViewDefinition } from "../app/charts";

/**
 * Browser-free render test for the chart page. Only Refine data hooks are mocked;
 * the real chart components, Ant Design shell and resource metadata render through
 * `react-dom/server`. The chart metadata is synthetic so the test is independent
 * of the project's own `chart` declarations.
 */
const resource = resources[0]!;
const enumCandidate = resources.flatMap((candidate) => candidate.fields.filter((field) => field.enumValues?.length).map((field) => ({ resource: candidate, field })))[0];
const entity = resource.name;
const enumEntity = enumCandidate?.resource.name ?? entity;
const enumField = enumCandidate?.field.name ?? resource.fields[0]!.name;
const tableColumns = resource.fields.filter((field) => field.type !== "Vector").slice(0, 2).map((field) => field.name);
const tableLabels = tableColumns.map((name) => resource.fields.find((field) => field.name === name)?.label ?? name);
const enumLabels: ChartLabelsDefinition = {
  values: (enumCandidate?.field.enumValues ?? []).map((value) => ({ value: value.name, label: value.label ?? value.name, labelKey: "qiy.charts.TestDistribution.labels." + value.name })),
};

function view(kind: ChartViewDefinition["kind"], label: string, data: ChartViewDefinition["data"], labels?: ChartLabelsDefinition): ChartViewDefinition {
  return { kind, label, labelKey: "qiy.charts.Test" + kind + ".views." + kind + ".label", data, ...(labels ? { labels } : {}) };
}

const charts: ChartDefinition[] = [
  { name: "TestStat", title: "Stat chart", labelKey: "qiy.charts.TestStat.label", icon: "TeamOutlined", views: [view("const", "Stat chart", { operation: "count", entity })] },
  { name: "TestDistribution", title: "Distribution chart", labelKey: "qiy.charts.TestDistribution.label", views: [
    view("pie", "Pie by status", { operation: "count", entity: enumEntity, groupBy: enumField }, enumLabels),
    view("bar", "Bar by status", { operation: "count", entity: enumEntity, groupBy: enumField }, enumLabels),
  ] },
  { name: "TestBar", title: "Bar chart", labelKey: "qiy.charts.TestBar.label", views: [view("bar", "Bar by status", { operation: "count", entity: enumEntity, groupBy: enumField }, enumLabels)] },
  { name: "TestTrend", title: "Trend chart", labelKey: "qiy.charts.TestTrend.label", views: [view("line", "Trend by day", { operation: "trend", entity, field: "createdAt", days: 30 })] },
  { name: "TestTable", title: "Table chart", labelKey: "qiy.charts.TestTable.label", views: [view("table", "Inventory rows", { operation: "list", entity, columns: tableColumns })] },
];

function panel(name: string, title: string, placements: ChartPanelDefinition["charts"]): ChartPanelDefinition {
  return { name, title, labelKey: "qiy.charts." + name + ".label", grid: { columns: 24, rows: 24 }, charts: placements };
}

const placements: ChartPanelDefinition["charts"] = [
  { name: "TestStat", placements: [{ variant: "larger", x: 0, y: 0, w: 6, h: 2 }, { variant: "medium", x: 0, y: 0, w: 12, h: 2 }, { variant: "small", x: 0, y: 0, w: 24, h: 3 }] },
  { name: "TestDistribution", placements: [{ variant: "larger", x: 6, y: 0, w: 12, h: 2 }, { variant: "medium", x: 12, y: 0, w: 12, h: 3 }, { variant: "small", x: 0, y: 3, w: 24, h: 4 }] },
  { name: "TestBar", placements: [{ variant: "larger", x: 0, y: 2, w: 12, h: 4 }, { variant: "small", x: 0, y: 7, w: 24, h: 4 }] },
  { name: "TestTrend", placements: [{ variant: "larger", x: 12, y: 2, w: 12, h: 4 }, { variant: "small", x: 0, y: 11, w: 24, h: 4 }] },
  { name: "TestTable", placements: [{ variant: "larger", x: 0, y: 6, w: 24, h: 6 }, { variant: "small", x: 0, y: 15, w: 24, h: 6 }] },
];

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  CanAccess: ({ children }: { children?: ReactNode }) => children,
  useTranslation: () => ({
    translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "",
    getLocale: () => "zh-CN",
    changeLocale: async () => "zh-CN",
  }),
  useList: () => ({ result: { data: [{ id: "row-1", [tableColumns[0]!]: "A" }], total: 235 }, query: { isLoading: false, error: undefined } }),
  useCustom: ({ url }: { url: string }) => {
    if (url.includes("/aggregate")) return { result: { data: { value: 235, operator: "sum" } }, query: { isLoading: false, error: undefined } };
    if (url.includes("/distribution")) return { result: { data: { items: [{ value: enumCandidate?.field.enumValues?.[0]?.name ?? "admin", count: 3 }, { value: "other", count: 2 }] } }, query: { isLoading: false, error: undefined } };
    return { result: { data: { items: [{ day: "2026-10-01", count: 2 }, { day: "2026-10-02", count: 5 }] } }, query: { isLoading: false, error: undefined } };
  },
  useNotification: () => ({ open: () => undefined }),
  // Table views may include FK columns; render their cells with a resolved record.
  useOne: ({ id }: { id: string }) => ({ result: { id, name: "row" }, query: { isLoading: false, error: undefined } }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({
  ...router,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children),
}));

const { ChartDashboard } = await import("../app/components/charts");

// Ant Design renders the aria-label on both the Select wrapper and its search input.
const viewSelectors = (html: string) => (html.match(/aria-label="View"/g)?.length ?? 0) / 2;

test("renders every chart kind with grid placements and selectors", () => {
  const html = renderToStaticMarkup(createElement(ChartDashboard, { charts, panels: [panel("PanelOne", "Panel one", placements), panel("PanelTwo", "Panel two", placements)] }));
  // Panel title and stat value.
  expect(html).toContain("Panel one");
  expect(html).toContain("235");
  // Pie/line render inline SVG for the selected view; table renders the field labels.
  expect(html).toContain('aria-label="Pie by status"');
  expect(html).toContain('aria-label="Trend by day"');
  for (const label of tableLabels) expect(html).toContain(label);
  // Bar-only chart renders its distribution rows (raw enum values are the fallback labels).
  expect(html).toContain("Bar by status");
  // Sizes are grid cells: the small variant maps to explicit grid-column/grid-row spans.
  expect(html).toContain("grid-column:");
  expect(html).toContain("grid-row:");
  expect(html).toContain("span 24");
  // Two selectors: the page-level panel selector and the multi-view chart kind selector.
  expect(viewSelectors(html)).toBe(2);
});

test("renders a single panel without a page-level selector", () => {
  const singleViewCharts = charts.filter((chart) => chart.views.length === 1);
  const html = renderToStaticMarkup(createElement(ChartDashboard, { charts: singleViewCharts, panels: [panel("OnlyPanel", "Only panel", placements.filter((entry) => singleViewCharts.some((chart) => chart.name === entry.name)))] }));
  expect(html).toContain("Only panel");
  expect(viewSelectors(html)).toBe(0);
});

test("multi-view chart defaults to its first view and shows the view selector", () => {
  const multi = charts.find((chart) => chart.name === "TestDistribution")!;
  expect(multi.views[0]!.kind).toBe("pie");
  const html = renderToStaticMarkup(createElement(ChartDashboard, { charts: [multi], panels: [panel("Panel", "Panel", [{ name: "TestDistribution", placements: [{ variant: "small", x: 0, y: 0, w: 24, h: 4 }] }])] }));
  // First view (pie) renders by default; the kind selector is present.
  expect(html).toContain('aria-label="Pie by status"');
  expect(viewSelectors(html)).toBe(1);
});
