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
export const charts: ChartDefinition[] = [
  {
    "name": "OrderCount",
    "title": "订单总数",
    "labelKey": "qiy.charts.OrderCount.label",
    "icon": "ShoppingOutlined",
    "views": [
      {
        "kind": "const",
        "label": "订单总数",
        "labelKey": "qiy.charts.OrderCount.views.const.label",
        "data": {
          "operation": "count",
          "entity": "orders"
        }
      }
    ]
  },
  {
    "name": "InventoryCount",
    "title": "库存记录",
    "labelKey": "qiy.charts.InventoryCount.label",
    "icon": "DatabaseOutlined",
    "views": [
      {
        "kind": "const",
        "label": "库存记录",
        "labelKey": "qiy.charts.InventoryCount.views.const.label",
        "data": {
          "operation": "count",
          "entity": "inventory_items"
        }
      }
    ]
  },
  {
    "name": "ProductCount",
    "title": "产品品类",
    "labelKey": "qiy.charts.ProductCount.label",
    "icon": "AppstoreOutlined",
    "views": [
      {
        "kind": "const",
        "label": "产品品类",
        "labelKey": "qiy.charts.ProductCount.views.const.label",
        "data": {
          "operation": "count",
          "entity": "products"
        }
      }
    ]
  },
  {
    "name": "CustomerCount",
    "title": "客户数",
    "labelKey": "qiy.charts.CustomerCount.label",
    "icon": "UserOutlined",
    "views": [
      {
        "kind": "const",
        "label": "客户数",
        "labelKey": "qiy.charts.CustomerCount.views.const.label",
        "data": {
          "operation": "count",
          "entity": "customers"
        }
      }
    ]
  },
  {
    "name": "OrderStatusBreakdown",
    "title": "订单状态",
    "labelKey": "qiy.charts.OrderStatusBreakdown.label",
    "icon": "CheckOutlined",
    "views": [
      {
        "kind": "pie",
        "label": "订单状态",
        "labelKey": "qiy.charts.OrderStatusBreakdown.views.pie.label",
        "data": {
          "operation": "count",
          "entity": "orders",
          "groupBy": "status"
        },
        "labels": {
          "field": "status",
          "values": [
            {
              "value": "draft",
              "label": "草稿",
              "labelKey": "qiy.charts.OrderStatusBreakdown.labels.draft"
            },
            {
              "value": "submitted",
              "label": "已提交",
              "labelKey": "qiy.charts.OrderStatusBreakdown.labels.submitted"
            },
            {
              "value": "approved",
              "label": "已审批",
              "labelKey": "qiy.charts.OrderStatusBreakdown.labels.approved"
            },
            {
              "value": "shipped",
              "label": "已出库",
              "labelKey": "qiy.charts.OrderStatusBreakdown.labels.shipped"
            },
            {
              "value": "cancelled",
              "label": "已取消",
              "labelKey": "qiy.charts.OrderStatusBreakdown.labels.cancelled"
            }
          ]
        }
      }
    ]
  },
  {
    "name": "OrderTrend",
    "title": "近30天订单",
    "labelKey": "qiy.charts.OrderTrend.label",
    "icon": "ShoppingOutlined",
    "views": [
      {
        "kind": "line",
        "label": "近30天订单",
        "labelKey": "qiy.charts.OrderTrend.views.line.label",
        "data": {
          "operation": "trend",
          "entity": "orders",
          "field": "createdAt",
          "days": 30
        }
      }
    ]
  }
];
export const chartPanels: ChartPanelDefinition[] = [];
export const hasChartDashboard = charts.length > 0;
export function findChart(name: string): ChartDefinition | undefined { return charts.find((chart) => chart.name === name); }
