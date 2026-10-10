export interface DashboardMetric { name: string; resource: string; label: string; icon?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend"; groupBy?: string; days?: number; }
export const dashboardMetrics: DashboardMetric[] = [
  {
    "name": "products",
    "resource": "products",
    "label": "products",
    "span": 8
  }
];
