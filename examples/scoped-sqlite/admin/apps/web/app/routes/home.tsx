import { CanAccess, useCustom, useList, useTranslation } from "@refinedev/core";
import { Card, Col, Progress, Row, Space, Statistic, Typography } from "antd";
import { Link } from "react-router";
import { resources } from "../resources";
 import { dashboardMetrics, type DashboardMetric } from "../dashboard";
 import { qiyIcons } from "../icons";
import { t, type QiyLocale } from "../i18n";

 function DistributionSummary({ metric }: { metric: DashboardMetric }) {
   const { result, query } = useCustom<{ items: Array<{ value: string | null; count: number }> }>({ url: `/api/v1/${metric.resource}/distribution`, method: "get", config: { query: { field: metric.groupBy } } });
   const resource = resources.find((item) => item.name === metric.resource);
   const field = resource?.fields.find((item) => item.name === metric.groupBy);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const rows = result.data?.items ?? [];
   const total = rows.reduce((sum, row) => sum + row.count, 0);
   return <Col xs={24} sm={12} lg={metric.span}><Card title={<Space><Icon style={{ color: "#1677ff" }} /><span>{metric.label}</span></Space>} loading={query.isLoading}>{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map(({ value, count }) => { const item = field?.enumValues?.find((option) => option.name === value); return <div key={value ?? "null"}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text>{item?.label ?? value ?? "—"}</Typography.Text><Typography.Text type="secondary">{count}</Typography.Text></Space><Progress percent={total ? Math.round(count / total * 100) : 0} showInfo={false} /></div>; })}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
 }
 function TrendSummary({ metric }: { metric: DashboardMetric }) {
   const { result, query } = useCustom<{ items: Array<{ day: string; count: number }> }>({ url: `/api/v1/${metric.resource}/trend`, method: "get", config: { query: { field: metric.groupBy, days: metric.days } } });
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const rows = result.data?.items ?? [];
   const max = Math.max(...rows.map((row) => row.count), 0);
   return <Col xs={24} lg={metric.span}><Card title={<Space><Icon style={{ color: "#1677ff" }} /><span>{metric.label}</span></Space>} loading={query.isLoading}>{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map((row) => <div key={row.day}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text>{row.day}</Typography.Text><Typography.Text type="secondary">{row.count}</Typography.Text></Space><Progress percent={max ? Math.round(row.count / max * 100) : 0} showInfo={false} /></div>)}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
 }
 function ResourceSummary({ metric }: { metric: DashboardMetric }) {
   if (metric.type === "distribution") return <DistributionSummary metric={metric} />;
   if (metric.type === "trend") return <TrendSummary metric={metric} />;
   return <CountSummary metric={metric} />;
 }
 function CountSummary({ metric }: { metric: DashboardMetric }) {
   const { result, query } = useList({ resource: metric.resource, pagination: { currentPage: 1, pageSize: 1 } });
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   return <Col xs={24} sm={12} lg={metric.span}><Link to={`/${metric.resource}`}><Card hoverable><Space><Icon style={{ fontSize: 24, color: "#1677ff" }} /><div><Typography.Text type="secondary">{metric.label}</Typography.Text><Statistic value={query.isLoading ? "—" : result.total ?? 0} /></div></Space></Card></Link></Col>;
}
export default function Home() {
  const { getLocale } = useTranslation(); const locale: QiyLocale = getLocale() === "en-US" ? "en-US" : "zh-CN";
   return <Space direction="vertical" size="large" style={{ width: "100%" }}><div><Typography.Title level={2}>{locale === "zh-CN" ? "工作台" : "Dashboard"}</Typography.Title><Typography.Paragraph type="secondary">{locale === "zh-CN" ? "从数据资源快速进入业务管理。" : "Jump into your data resources from one place."}</Typography.Paragraph></div><Row gutter={[16, 16]}>{dashboardMetrics.map((metric) => <CanAccess key={metric.name} resource={metric.resource} action="list"><ResourceSummary metric={metric} /></CanAccess>)}</Row><Card title={t(locale, "quickAccess")}><Space wrap>{resources.slice(0, 4).map((resource) => <CanAccess key={resource.name} resource={resource.name} action="list"><Link to={`/${resource.name}`}>{resource.label}</Link></CanAccess>)}</Space></Card></Space>;
}
