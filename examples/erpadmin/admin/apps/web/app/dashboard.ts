export interface DashboardMetric { name: string; resource: string; label: string; icon?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend"; groupBy?: string; days?: number; }
export const dashboardMetrics: DashboardMetric[] = [
  {
    "name": "orderCount",
    "resource": "orders",
    "label": "订单总数",
    "span": 8,
    "icon": "ShoppingOutlined"
  },
  {
    "name": "inventoryCount",
    "resource": "inventory_items",
    "label": "库存记录",
    "span": 8,
    "icon": "DatabaseOutlined"
  },
  {
    "name": "productCount",
    "resource": "products",
    "label": "产品品类",
    "span": 8,
    "icon": "AppstoreOutlined"
  },
  {
    "name": "customerCount",
    "resource": "customers",
    "label": "客户数",
    "span": 12,
    "icon": "UserOutlined"
  },
  {
    "name": "orderStatusBreakdown",
    "resource": "orders",
    "label": "订单状态",
    "span": 12,
    "icon": "CheckOutlined",
    "type": "distribution",
    "groupBy": "status"
  },
  {
    "name": "orderTrend",
    "resource": "orders",
    "label": "近30天订单",
    "span": 24,
    "icon": "ShoppingOutlined",
    "type": "trend",
    "groupBy": "createdAt",
    "days": 30
  }
];
