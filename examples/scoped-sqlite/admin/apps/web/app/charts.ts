export type ChartViewKind = "const" | "pie" | "bar" | "line" | "area" | "scatter" | "stacked" | "table";
export type ChartAggregate = "sum" | "avg" | "min" | "max";
export type ChartDataOperation = "count" | "sum" | "avg" | "min" | "max" | "trend" | "list";
export interface ChartDataDefinition { operation: ChartDataOperation; entity: string; field?: string; groupBy?: string; days?: number; columns?: string[]; }
export interface ChartLabelValue { value: string; label: string; labelKey: string; }
export interface ChartLabelsDefinition { field?: string; values: ChartLabelValue[]; }
export interface ChartViewDefinition { kind: ChartViewKind; label: string; labelKey: string; data: ChartDataDefinition; labels?: ChartLabelsDefinition; color?: string; legend?: boolean; }
export interface ChartDefinition { name: string; title: string; labelKey: string; icon?: string; views: ChartViewDefinition[]; }
export type ChartVariant = "larger" | "xl" | "lg" | "large" | "medium" | "md" | "small" | "sm" | "xs";
export interface ChartPlacement { variant: ChartVariant; x: number; y: number; w: number; h: number; }
export interface ChartPanelChart { name: string; placements: ChartPlacement[]; }
export interface ChartPanelDefinition { name: string; title: string; labelKey: string; grid: { columns: number; rows: number }; charts: ChartPanelChart[]; }
export type ChartViewportCategory = "larger" | "medium" | "small";
export const chartViewKinds: ChartViewKind[] = ["const", "pie", "bar", "line", "area", "scatter", "stacked", "table"];
export const chartVariantNames: ChartVariant[] = ["larger","xl","lg","large","medium","md","small","sm","xs"];
export const chartVariantBreakpoint: Record<ChartVariant, ChartViewportCategory> = { larger: "larger", xl: "larger", lg: "larger", large: "larger", medium: "medium", md: "medium", small: "small", sm: "small", xs: "small" };
export const chartViewportBreakpoints = { larger: 1200, medium: 768 } as const;
export function chartViewportCategory(width: number): ChartViewportCategory { return width >= chartViewportBreakpoints.larger ? "larger" : width >= chartViewportBreakpoints.medium ? "medium" : "small"; }
export function chartViewKindLabelKey(kind: ChartViewKind): string { return "qiy.chartViewKind." + kind; }
/** Largest declared placement that fits the viewport category, falling back to the smallest declared one. */
export function selectChartPlacement(placements: ChartPlacement[], category: ChartViewportCategory): ChartPlacement | undefined {
  const buckets: ChartViewportCategory[] = ["larger", "medium", "small"];
  const byBucket = new Map<ChartViewportCategory, ChartPlacement>();
  for (const placement of placements) {
    const bucket = chartVariantBreakpoint[placement.variant];
    if (bucket && !byBucket.has(bucket)) byBucket.set(bucket, placement);
  }
  const start = buckets.indexOf(category);
  for (const bucket of buckets.slice(start)) { const found = byBucket.get(bucket); if (found) return found; }
  for (const bucket of buckets.slice(0, start).reverse()) { const found = byBucket.get(bucket); if (found) return found; }
  return placements[0];
}
export function defaultChartView(chart: ChartDefinition): ChartViewDefinition | undefined { return chart.views[0]; }
export const chartPanelStorageKey = "qiy.charts.panel";
type ChartPanelStorage = Pick<Storage, "getItem" | "setItem">;
function chartPanelStorage(): ChartPanelStorage | undefined { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } }
export function readStoredChartPanel(storage: ChartPanelStorage | undefined = chartPanelStorage()): string | undefined { try { return storage?.getItem(chartPanelStorageKey) ?? undefined; } catch { return undefined; } }
export function storeChartPanel(name: string, storage: ChartPanelStorage | undefined = chartPanelStorage()): void { try { storage?.setItem(chartPanelStorageKey, name); } catch { /* quota or private mode */ } }
export function resolveChartPanel(panels: ChartPanelDefinition[], stored: string | undefined): ChartPanelDefinition | undefined { return panels.find((panel) => panel.name === stored) ?? panels[0]; }
export const charts: ChartDefinition[] = [];
export const chartPanels: ChartPanelDefinition[] = [];
export const hasChartDashboard = charts.length > 0;
export function findChart(name: string): ChartDefinition | undefined { return charts.find((chart) => chart.name === name); }
