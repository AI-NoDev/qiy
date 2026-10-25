export interface DashboardMetric { name: string; resource: string; label: string; labelKey: string; icon?: string; comment?: string; commentKey?: string; span: 8 | 12 | 24; type?: "count" | "distribution" | "trend" | "aggregate"; groupBy?: string; days?: number; field?: string; agg?: "sum" | "avg" | "min" | "max" }
export const dashboardMetrics: DashboardMetric[] = [];
