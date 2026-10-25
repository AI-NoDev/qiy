import { expect, test } from "bun:test";
import {
  chartPanelStorageKey,
  chartVariantBreakpoint,
  chartVariantNames,
  chartViewKinds,
  chartViewportBreakpoints,
  chartViewportCategory,
  chartPanels,
  charts,
  defaultChartView,
  findChart,
  readStoredChartPanel,
  resolveChartPanel,
  selectChartPlacement,
  storeChartPanel,
  type ChartPlacement,
} from "../app/charts";
import { getResource } from "../app/resources";

/**
 * The chart page is generated metadata, so its grouping/grid/selector invariants
 * are testable without a browser. A project without chart declarations keeps
 * empty arrays and these tests still pass.
 */
test("chart metadata groups view declarations with stable i18n keys", () => {
  expect(Array.isArray(charts)).toBe(true);
  expect(Array.isArray(chartPanels)).toBe(true);
  for (const chart of charts) {
    expect(chart.views.length).toBeGreaterThan(0);
    expect(chart.labelKey).toBe("qiy.charts." + chart.name + ".label");
    expect(defaultChartView(chart)).toBe(chart.views[0]);
    const kinds = new Set<string>();
    for (const view of chart.views) {
      expect(chartViewKinds).toContain(view.kind);
      expect(kinds.has(view.kind)).toBe(false);
      kinds.add(view.kind);
      expect(view.labelKey).toBe("qiy.charts." + chart.name + ".views." + view.kind + ".label");
      expect(getResource(view.data.entity)).toBeDefined();
      for (const entry of view.labels?.values ?? []) expect(entry.labelKey).toBe("qiy.charts." + chart.name + ".labels." + entry.value);
    }
  }
});

test("panel grids and placements stay inside the declared grid", () => {
  for (const panel of chartPanels) {
    expect(panel.grid.columns).toBeGreaterThanOrEqual(1);
    expect(panel.grid.columns).toBeLessThanOrEqual(24);
    expect(panel.grid.rows).toBeGreaterThanOrEqual(1);
    expect(panel.labelKey).toBe("qiy.charts." + panel.name + ".label");
    expect(panel.charts.length).toBeGreaterThan(0);
    for (const entry of panel.charts) {
      expect(findChart(entry.name)).toBeDefined();
      expect(entry.placements.length).toBeGreaterThan(0);
      const variants = new Set<string>();
      for (const placement of entry.placements) {
        expect(chartVariantNames).toContain(placement.variant);
        expect(variants.has(placement.variant)).toBe(false);
        variants.add(placement.variant);
        expect(placement.x).toBeGreaterThanOrEqual(0);
        expect(placement.y).toBeGreaterThanOrEqual(0);
        expect(placement.w).toBeGreaterThanOrEqual(1);
        expect(placement.h).toBeGreaterThanOrEqual(1);
        expect(placement.x + placement.w).toBeLessThanOrEqual(panel.grid.columns);
        expect(placement.y + placement.h).toBeLessThanOrEqual(panel.grid.rows);
      }
    }
  }
});

test("variant selection shrinks larger -> medium -> small and falls back", () => {
  const placement = (variant: ChartPlacement["variant"]): ChartPlacement => ({ variant, x: 0, y: 0, w: 6, h: 2 });
  const all = [placement("larger"), placement("medium"), placement("small")];
  expect(selectChartPlacement(all, "larger")?.variant).toBe("larger");
  expect(selectChartPlacement(all, "medium")?.variant).toBe("medium");
  expect(selectChartPlacement(all, "small")?.variant).toBe("small");
  // Missing buckets fall back to the nearest declared size (largest smaller, then larger).
  expect(selectChartPlacement([placement("medium"), placement("small")], "larger")?.variant).toBe("medium");
  expect(selectChartPlacement([placement("larger")], "small")?.variant).toBe("larger");
  expect(selectChartPlacement([], "larger")).toBeUndefined();
  // Aliases map to the documented breakpoint buckets.
  expect(chartVariantBreakpoint.xl).toBe("larger");
  expect(chartVariantBreakpoint.lg).toBe("larger");
  expect(chartVariantBreakpoint.md).toBe("medium");
  expect(chartVariantBreakpoint.xs).toBe("small");
  // Breakpoints: >=1200 larger, >=768 medium, below small.
  expect(chartViewportCategory(chartViewportBreakpoints.larger)).toBe("larger");
  expect(chartViewportCategory(chartViewportBreakpoints.larger - 1)).toBe("medium");
  expect(chartViewportCategory(chartViewportBreakpoints.medium)).toBe("medium");
  expect(chartViewportCategory(chartViewportBreakpoints.medium - 1)).toBe("small");
});

test("panel selection persists and falls back to the first panel", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  expect(chartPanelStorageKey.length).toBeGreaterThan(0);
  expect(readStoredChartPanel(storage)).toBeUndefined();
  storeChartPanel("Second", storage);
  expect(readStoredChartPanel(storage)).toBe("Second");
  const panels = [
    { name: "First", title: "First", labelKey: "qiy.charts.First.label", grid: { columns: 24, rows: 24 }, charts: [] },
    { name: "Second", title: "Second", labelKey: "qiy.charts.Second.label", grid: { columns: 24, rows: 24 }, charts: [] },
  ];
  expect(resolveChartPanel(panels, readStoredChartPanel(storage))?.name).toBe("Second");
  expect(resolveChartPanel(panels, "Missing")?.name).toBe("First");
  expect(resolveChartPanel([], undefined)).toBeUndefined();
});
