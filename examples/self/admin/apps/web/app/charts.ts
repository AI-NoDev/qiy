export type ChartViewKind = "stat" | "bar" | "line" | "pie" | "table";
export type ChartAggregate = "count" | "sum" | "avg" | "min" | "max";
export interface ChartViewDefinition { /** Flat layout index; also the suffix of the i18n label key. */ index: number; kind: ChartViewKind; label: string; labelKey: string; aggregate?: ChartAggregate; field?: string; groupBy?: string; dateField?: string; days?: number; columns?: string[]; }
export interface ChartLayoutColumn { span: number; views: ChartViewDefinition[]; }
export interface ChartLayoutRow { columns: ChartLayoutColumn[]; }
export interface ChartDefinition { name: string; label: string; labelKey: string; source: string; rows: ChartLayoutRow[]; }
export interface ChartPanelColumn { span: number; charts: string[]; }
export interface ChartPanelRow { columns: ChartPanelColumn[]; }
export interface ChartPanelDefinition { name: string; label: string; labelKey: string; rows: ChartPanelRow[]; }
export const charts: ChartDefinition[] = [
  {
    "name": "UserCount",
    "label": "UserCount",
    "labelKey": "qiy.charts.UserCount.label",
    "source": "users",
    "rows": [
      {
        "columns": [
          {
            "span": 24,
            "views": [
              {
                "index": 0,
                "kind": "stat",
                "label": "用户总数",
                "labelKey": "qiy.charts.UserCount.views.0.label",
                "aggregate": "count"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "PurchaseOrderCount",
    "label": "PurchaseOrderCount",
    "labelKey": "qiy.charts.PurchaseOrderCount.label",
    "source": "purchase_orders",
    "rows": [
      {
        "columns": [
          {
            "span": 24,
            "views": [
              {
                "index": 0,
                "kind": "stat",
                "label": "采购单总数",
                "labelKey": "qiy.charts.PurchaseOrderCount.views.0.label",
                "aggregate": "count"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "ShipmentCount",
    "label": "ShipmentCount",
    "labelKey": "qiy.charts.ShipmentCount.label",
    "source": "shipments",
    "rows": [
      {
        "columns": [
          {
            "span": 24,
            "views": [
              {
                "index": 0,
                "kind": "stat",
                "label": "发运单总数",
                "labelKey": "qiy.charts.ShipmentCount.views.0.label",
                "aggregate": "count"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "InventorySnapshot",
    "label": "InventorySnapshot",
    "labelKey": "qiy.charts.InventorySnapshot.label",
    "source": "inventory",
    "rows": [
      {
        "columns": [
          {
            "span": 12,
            "views": [
              {
                "index": 0,
                "kind": "stat",
                "label": "在库总量",
                "labelKey": "qiy.charts.InventorySnapshot.views.0.label",
                "aggregate": "sum",
                "field": "quantity"
              }
            ]
          },
          {
            "span": 12,
            "views": [
              {
                "index": 1,
                "kind": "stat",
                "label": "平均在库",
                "labelKey": "qiy.charts.InventorySnapshot.views.1.label",
                "aggregate": "avg",
                "field": "quantity"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "MovementByType",
    "label": "MovementByType",
    "labelKey": "qiy.charts.MovementByType.label",
    "source": "stock_movements",
    "rows": [
      {
        "columns": [
          {
            "span": 24,
            "views": [
              {
                "index": 0,
                "kind": "bar",
                "label": "按类型统计的库存流水",
                "labelKey": "qiy.charts.MovementByType.views.0.label",
                "groupBy": "type"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "PurchaseStatus",
    "label": "PurchaseStatus",
    "labelKey": "qiy.charts.PurchaseStatus.label",
    "source": "purchase_orders",
    "rows": [
      {
        "columns": [
          {
            "span": 24,
            "views": [
              {
                "index": 0,
                "kind": "pie",
                "label": "采购单状态",
                "labelKey": "qiy.charts.PurchaseStatus.views.0.label",
                "groupBy": "status"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "MovementTrend",
    "label": "MovementTrend",
    "labelKey": "qiy.charts.MovementTrend.label",
    "source": "stock_movements",
    "rows": [
      {
        "columns": [
          {
            "span": 24,
            "views": [
              {
                "index": 0,
                "kind": "line",
                "label": "近 30 天库存流水",
                "labelKey": "qiy.charts.MovementTrend.views.0.label",
                "dateField": "occurredAt",
                "days": 30
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "InventoryByWarehouse",
    "label": "InventoryByWarehouse",
    "labelKey": "qiy.charts.InventoryByWarehouse.label",
    "source": "inventory",
    "rows": [
      {
        "columns": [
          {
            "span": 24,
            "views": [
              {
                "index": 0,
                "kind": "table",
                "label": "按仓库的库存记录",
                "labelKey": "qiy.charts.InventoryByWarehouse.views.0.label",
                "columns": [
                  "inventoryKey",
                  "warehouseId",
                  "quantity",
                  "reserved"
                ]
              }
            ]
          }
        ]
      }
    ]
  }
];
export const chartPanels: ChartPanelDefinition[] = [
  {
    "name": "OverviewKpis",
    "label": "OverviewKpis",
    "labelKey": "qiy.charts.OverviewKpis.label",
    "rows": [
      {
        "columns": [
          {
            "span": 8,
            "charts": [
              "UserCount"
            ]
          },
          {
            "span": 8,
            "charts": [
              "PurchaseOrderCount"
            ]
          },
          {
            "span": 8,
            "charts": [
              "ShipmentCount"
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Operations",
    "label": "Operations",
    "labelKey": "qiy.charts.Operations.label",
    "rows": [
      {
        "columns": [
          {
            "span": 8,
            "charts": [
              "MovementByType"
            ]
          },
          {
            "span": 16,
            "charts": [
              "MovementTrend"
            ]
          }
        ]
      },
      {
        "columns": [
          {
            "span": 12,
            "charts": [
              "PurchaseStatus"
            ]
          },
          {
            "span": 12,
            "charts": [
              "InventorySnapshot"
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "InventoryBoard",
    "label": "InventoryBoard",
    "labelKey": "qiy.charts.InventoryBoard.label",
    "rows": [
      {
        "columns": [
          {
            "span": 24,
            "charts": [
              "InventoryByWarehouse"
            ]
          }
        ]
      }
    ]
  }
];
export const hasChartDashboard = charts.length > 0;
export function findChart(name: string): ChartDefinition | undefined { return charts.find((chart) => chart.name === name); }
/** Views in visual order (row, then column, then stacked views). */
export function flattenChartViews(chart: ChartDefinition): ChartViewDefinition[] { return chart.rows.flatMap((row) => row.columns.flatMap((column) => column.views)); }
/** Chart references in panel/row/column order, with the column span they occupy. */
export function flattenPanelCharts(panel: ChartPanelDefinition): Array<{ row: number; column: number; span: number; chart: string }> { return panel.rows.flatMap((row, rowIndex) => row.columns.flatMap((column, columnIndex) => column.charts.map((chart) => ({ row: rowIndex, column: columnIndex, span: column.span, chart })))); }
