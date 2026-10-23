export interface DashboardMetric { name: string; resource: string; label: string; icon?: string; comment?: string; commentKey?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend" | "aggregate"; groupBy?: string; days?: number; field?: string; agg?: "sum" | "avg" | "min" | "max" }
export const dashboardMetrics: DashboardMetric[] = [
  {
    "name": "inventoryRecords",
    "resource": "inventory",
    "label": "Inventory records",
    "span": 8,
    "icon": "DatabaseOutlined"
  },
  {
    "name": "productCount",
    "resource": "products",
    "label": "Products",
    "span": 8,
    "icon": "ShoppingOutlined"
  },
  {
    "name": "purchaseOrderCount",
    "resource": "purchase_orders",
    "label": "Purchase orders",
    "span": 8,
    "icon": "FileTextOutlined"
  },
  {
    "name": "shipmentCount",
    "resource": "shipments",
    "label": "Shipments",
    "span": 12,
    "icon": "CarOutlined"
  },
  {
    "name": "movementBreakdown",
    "resource": "stock_movements",
    "label": "Movements by type",
    "span": 12,
    "icon": "SwapOutlined",
    "type": "distribution",
    "groupBy": "type"
  },
  {
    "name": "movementTrend",
    "resource": "stock_movements",
    "label": "Movements (30 days)",
    "span": 24,
    "icon": "SwapOutlined",
    "type": "trend",
    "groupBy": "occurredAt",
    "days": 30
  }
];
