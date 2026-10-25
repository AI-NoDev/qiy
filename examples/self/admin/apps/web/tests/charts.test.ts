import { expect, test } from "bun:test";
import { chartPanels, charts, findChart, flattenChartViews, flattenPanelCharts, hasChartDashboard } from "../app/charts";
import { getResource } from "../app/resources";

/**
 * The chart page layout is generated metadata, so its ordering/span invariants
 * can be checked without a browser: panels keep their declaration order, rows and
 * columns keep the DSL order, view indexes match their i18n keys and every chart
 * reference resolves. A project without a `chart` block keeps empty arrays.
 */
test("chart layout metadata preserves row/column/view order and label keys", () => {
  expect(Array.isArray(charts)).toBe(true);
  expect(Array.isArray(chartPanels)).toBe(true);
  expect(hasChartDashboard).toBe(charts.length > 0);
  for (const chart of charts) {
    expect(chart.rows.length).toBeGreaterThan(0);
    expect(getResource(chart.source)).toBeDefined();
    expect(chart.labelKey).toBe("qiy.charts." + chart.name + ".label");
    let expectedIndex = 0;
    for (const row of chart.rows) {
      expect(row.columns.length).toBeGreaterThan(0);
      expect(row.columns.reduce((sum, column) => sum + column.span, 0)).toBeLessThanOrEqual(24);
      for (const column of row.columns) {
        expect(column.span).toBeGreaterThanOrEqual(1);
        expect(column.span).toBeLessThanOrEqual(24);
        for (const view of column.views) {
          expect(view.index).toBe(expectedIndex);
          expect(view.labelKey).toBe("qiy.charts." + chart.name + ".views." + expectedIndex + ".label");
          expect(["stat", "bar", "line", "pie", "table"]).toContain(view.kind);
          expectedIndex += 1;
        }
      }
    }
    // flattenChartViews is the single source of the visual/view order.
    expect(flattenChartViews(chart).map((view) => view.index)).toEqual([...Array(expectedIndex).keys()]);
  }
});

test("panels reference existing charts in row/column order with valid spans", () => {
  for (const panel of chartPanels) {
    expect(panel.rows.length).toBeGreaterThan(0);
    expect(panel.labelKey).toBe("qiy.charts." + panel.name + ".label");
    for (const row of panel.rows) {
      expect(row.columns.length).toBeGreaterThan(0);
      expect(row.columns.reduce((sum, column) => sum + column.span, 0)).toBeLessThanOrEqual(24);
      expect(row.columns.every((column) => column.charts.length > 0)).toBe(true);
    }
    const references = flattenPanelCharts(panel);
    expect(references.length).toBeGreaterThan(0);
    expect(references.map((reference) => [reference.row, reference.column, reference.chart])).toEqual(panel.rows.flatMap((row, rowIndex) => row.columns.flatMap((column, columnIndex) => column.charts.map((chart) => [rowIndex, columnIndex, chart]))));
    for (const reference of references) {
      expect(findChart(reference.chart)).toBeDefined();
      expect(reference.span).toBeGreaterThanOrEqual(1);
      expect(reference.span).toBeLessThanOrEqual(24);
    }
  }
});
