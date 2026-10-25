export type ChartViewKind = "const" | "pie" | "bar" | "line" | "table";
export type ChartAggregate = "sum" | "avg" | "min" | "max";
export type ChartDataOperation = "count" | "sum" | "avg" | "min" | "max" | "trend" | "list";
export interface ChartDataDefinition { operation: ChartDataOperation; entity: string; field?: string; groupBy?: string; days?: number; columns?: string[]; }
export interface ChartLabelValue { value: string; label: string; labelKey: string; }
export interface ChartLabelsDefinition { field?: string; values: ChartLabelValue[]; }
export interface ChartViewDefinition { kind: ChartViewKind; label: string; labelKey: string; data: ChartDataDefinition; labels?: ChartLabelsDefinition; }
export interface ChartDefinition { name: string; title: string; labelKey: string; icon?: string; views: ChartViewDefinition[]; }
export type ChartVariant = "larger" | "xl" | "lg" | "large" | "medium" | "md" | "small" | "sm" | "xs";
export interface ChartPlacement { variant: ChartVariant; x: number; y: number; w: number; h: number; }
export interface ChartPanelChart { name: string; placements: ChartPlacement[]; }
export interface ChartPanelDefinition { name: string; title: string; labelKey: string; grid: { columns: number; rows: number }; charts: ChartPanelChart[]; }
export type ChartViewportCategory = "larger" | "medium" | "small";
export const chartViewKinds: ChartViewKind[] = ["const", "pie", "bar", "line", "table"];
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
    "name": "UserCount",
    "title": "用户总数",
    "labelKey": "qiy.charts.UserCount.label",
    "icon": "TeamOutlined",
    "views": [
      {
        "kind": "const",
        "label": "用户总数",
        "labelKey": "qiy.charts.UserCount.views.const.label",
        "data": {
          "operation": "count",
          "entity": "users"
        }
      }
    ]
  },
  {
    "name": "UserStatusCount",
    "title": "用户状态分布",
    "labelKey": "qiy.charts.UserStatusCount.label",
    "icon": "PieChartOutlined",
    "views": [
      {
        "kind": "pie",
        "label": "用户状态分布",
        "labelKey": "qiy.charts.UserStatusCount.views.pie.label",
        "data": {
          "operation": "count",
          "entity": "users",
          "groupBy": "role"
        },
        "labels": {
          "field": "role",
          "values": [
            {
              "value": "admin",
              "label": "Administrator",
              "labelKey": "qiy.charts.UserStatusCount.labels.admin"
            },
            {
              "value": "operator",
              "label": "Operator",
              "labelKey": "qiy.charts.UserStatusCount.labels.operator"
            },
            {
              "value": "viewer",
              "label": "Viewer",
              "labelKey": "qiy.charts.UserStatusCount.labels.viewer"
            }
          ]
        }
      },
      {
        "kind": "bar",
        "label": "用户状态分布",
        "labelKey": "qiy.charts.UserStatusCount.views.bar.label",
        "data": {
          "operation": "count",
          "entity": "users",
          "groupBy": "role"
        },
        "labels": {
          "values": [
            {
              "value": "admin",
              "label": "管理员",
              "labelKey": "qiy.charts.UserStatusCount.labels.admin"
            },
            {
              "value": "operator",
              "label": "运营",
              "labelKey": "qiy.charts.UserStatusCount.labels.operator"
            },
            {
              "value": "viewer",
              "label": "只读",
              "labelKey": "qiy.charts.UserStatusCount.labels.viewer"
            }
          ]
        }
      }
    ]
  },
  {
    "name": "MovementTrend",
    "title": "库存流水趋势",
    "labelKey": "qiy.charts.MovementTrend.label",
    "icon": "LineChartOutlined",
    "views": [
      {
        "kind": "line",
        "label": "库存流水趋势",
        "labelKey": "qiy.charts.MovementTrend.views.line.label",
        "data": {
          "operation": "trend",
          "entity": "stock_movements",
          "field": "occurredAt",
          "days": 30
        }
      }
    ]
  },
  {
    "name": "InventoryTable",
    "title": "按仓库的库存记录",
    "labelKey": "qiy.charts.InventoryTable.label",
    "icon": "TableOutlined",
    "views": [
      {
        "kind": "table",
        "label": "按仓库的库存记录",
        "labelKey": "qiy.charts.InventoryTable.views.table.label",
        "data": {
          "operation": "list",
          "entity": "inventory",
          "columns": [
            "inventoryKey",
            "warehouseId",
            "quantity",
            "reserved"
          ]
        }
      }
    ]
  }
];
export const chartPanels: ChartPanelDefinition[] = [
  {
    "name": "Overview",
    "title": "概览",
    "labelKey": "qiy.charts.Overview.label",
    "grid": {
      "columns": 24,
      "rows": 24
    },
    "charts": [
      {
        "name": "UserCount",
        "placements": [
          {
            "variant": "larger",
            "x": 0,
            "y": 0,
            "w": 6,
            "h": 2
          },
          {
            "variant": "medium",
            "x": 0,
            "y": 0,
            "w": 12,
            "h": 2
          },
          {
            "variant": "small",
            "x": 0,
            "y": 0,
            "w": 24,
            "h": 3
          }
        ]
      },
      {
        "name": "UserStatusCount",
        "placements": [
          {
            "variant": "larger",
            "x": 6,
            "y": 0,
            "w": 12,
            "h": 2
          },
          {
            "variant": "medium",
            "x": 12,
            "y": 0,
            "w": 12,
            "h": 3
          },
          {
            "variant": "small",
            "x": 0,
            "y": 3,
            "w": 24,
            "h": 4
          }
        ]
      },
      {
        "name": "MovementTrend",
        "placements": [
          {
            "variant": "larger",
            "x": 18,
            "y": 0,
            "w": 6,
            "h": 2
          },
          {
            "variant": "medium",
            "x": 0,
            "y": 3,
            "w": 24,
            "h": 3
          },
          {
            "variant": "small",
            "x": 0,
            "y": 7,
            "w": 24,
            "h": 4
          }
        ]
      },
      {
        "name": "InventoryTable",
        "placements": [
          {
            "variant": "larger",
            "x": 0,
            "y": 2,
            "w": 24,
            "h": 6
          },
          {
            "variant": "medium",
            "x": 0,
            "y": 6,
            "w": 24,
            "h": 5
          },
          {
            "variant": "small",
            "x": 0,
            "y": 11,
            "w": 24,
            "h": 6
          }
        ]
      }
    ]
  },
  {
    "name": "Operations",
    "title": "运营",
    "labelKey": "qiy.charts.Operations.label",
    "grid": {
      "columns": 24,
      "rows": 24
    },
    "charts": [
      {
        "name": "UserStatusCount",
        "placements": [
          {
            "variant": "larger",
            "x": 0,
            "y": 0,
            "w": 12,
            "h": 3
          },
          {
            "variant": "medium",
            "x": 0,
            "y": 0,
            "w": 24,
            "h": 4
          },
          {
            "variant": "small",
            "x": 0,
            "y": 0,
            "w": 24,
            "h": 4
          }
        ]
      },
      {
        "name": "MovementTrend",
        "placements": [
          {
            "variant": "larger",
            "x": 12,
            "y": 0,
            "w": 12,
            "h": 3
          },
          {
            "variant": "medium",
            "x": 0,
            "y": 4,
            "w": 24,
            "h": 4
          },
          {
            "variant": "small",
            "x": 0,
            "y": 4,
            "w": 24,
            "h": 4
          }
        ]
      },
      {
        "name": "InventoryTable",
        "placements": [
          {
            "variant": "larger",
            "x": 0,
            "y": 3,
            "w": 24,
            "h": 6
          },
          {
            "variant": "medium",
            "x": 0,
            "y": 8,
            "w": 24,
            "h": 5
          },
          {
            "variant": "small",
            "x": 0,
            "y": 8,
            "w": 24,
            "h": 6
          }
        ]
      }
    ]
  }
];
export const hasChartDashboard = charts.length > 0;
export function findChart(name: string): ChartDefinition | undefined { return charts.find((chart) => chart.name === name); }
