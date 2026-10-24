export interface DashboardMetric { name: string; resource: string; label: string; labelKey: string; icon?: string; comment?: string; commentKey?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend" | "aggregate"; groupBy?: string; days?: number; field?: string; agg?: "sum" | "avg" | "min" | "max" }
export const dashboardMetrics: DashboardMetric[] = [
  {
    "name": "inventoryRecords",
    "resource": "inventory",
    "label": "Inventory records",
    "span": 8,
    "icon": "DatabaseOutlined",
    "labelKey": "qiy.dashboard.inventoryRecords.label"
  },
  {
    "name": "productCount",
    "resource": "products",
    "label": "Products",
    "span": 8,
    "icon": "ShoppingOutlined",
    "labelKey": "qiy.dashboard.productCount.label"
  },
  {
    "name": "purchaseOrderCount",
    "resource": "purchase_orders",
    "label": "Purchase orders",
    "span": 8,
    "icon": "FileTextOutlined",
    "labelKey": "qiy.dashboard.purchaseOrderCount.label"
  },
  {
    "name": "shipmentCount",
    "resource": "shipments",
    "label": "Shipments",
    "span": 12,
    "icon": "CarOutlined",
    "labelKey": "qiy.dashboard.shipmentCount.label"
  },
  {
    "name": "movementBreakdown",
    "resource": "stock_movements",
    "label": "Movements by type",
    "span": 12,
    "icon": "SwapOutlined",
    "type": "distribution",
    "groupBy": "type",
    "labelKey": "qiy.dashboard.movementBreakdown.label"
  },
  {
    "name": "movementTrend",
    "resource": "stock_movements",
    "label": "Movements (30 days)",
    "span": 24,
    "icon": "SwapOutlined",
    "type": "trend",
    "groupBy": "occurredAt",
    "days": 30,
    "labelKey": "qiy.dashboard.movementTrend.label"
  }
];
