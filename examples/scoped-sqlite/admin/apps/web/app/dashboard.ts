export interface DashboardMetric { name: string; resource: string; label: string; icon?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend"; groupBy?: string; days?: number; }
export const dashboardMetrics: DashboardMetric[] = [
  {
    "name": "records",
    "resource": "records",
    "label": "records",
    "span": 8
  }
];
