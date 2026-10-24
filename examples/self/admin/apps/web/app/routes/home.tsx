import { CanAccess, useCustom, useList, useTranslation } from "@refinedev/core";
import { Card, Col, Progress, Row, Space, Statistic, Typography, theme } from "antd";
import { Link } from "react-router";
import { resources } from "../resources";
 import { dashboardMetrics, type DashboardMetric } from "../dashboard";
 import { qiyIcons } from "../icons";
 import { projectMessage } from "../messages";
import { t, resolveLocale, type QiyLocale } from "../i18n";

 function MetricDescription({ metric }: { metric: DashboardMetric }) {
   const { getLocale } = useTranslation();
   const description = metric.commentKey ? projectMessage(getLocale(), metric.commentKey) ?? metric.comment : metric.comment;
   return description ? <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>{description}</Typography.Paragraph> : null;
 }

 function DistributionSummary({ metric }: { metric: DashboardMetric }) {
   const { translate } = useTranslation();
   const { token } = theme.useToken();
   const { result, query } = useCustom<{ items: Array<{ value: string | null; count: number }> }>({ url: `/api/v1/${metric.resource}/distribution`, method: "get", config: { query: { field: metric.groupBy } } });
   const resource = resources.find((item) => item.name === metric.resource);
   const field = resource?.fields.find((item) => item.name === metric.groupBy);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const rows = result.data?.items ?? [];
   const total = rows.reduce((sum, row) => sum + row.count, 0);
   return <Col xs={24} sm={12} lg={metric.span}><Card title={<Space><Icon style={{ color: token.colorPrimary }} /><span>{translate(metric.labelKey, {}, metric.label)}</span></Space>} loading={query.isLoading}><MetricDescription metric={metric} />{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map(({ value, count }) => { const item = field?.enumValues?.find((option) => option.name === value); const comment = item?.commentKey ? translate(item.commentKey, {}, item.comment) : item?.comment; return <div key={value ?? "null"}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text title={comment}>{item ? translate(item.labelKey, {}, item.label ?? value ?? "—") : value ?? "—"}</Typography.Text><Typography.Text type="secondary">{count}</Typography.Text></Space><Progress percent={total ? Math.round(count / total * 100) : 0} showInfo={false} /></div>; })}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
 }
 function TrendSummary({ metric }: { metric: DashboardMetric }) {
   const { translate } = useTranslation();
   const { result, query } = useCustom<{ items: Array<{ day: string; count: number }> }>({ url: `/api/v1/${metric.resource}/trend`, method: "get", config: { query: { field: metric.groupBy, days: metric.days } } });
   const { token } = theme.useToken();
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const rows = result.data?.items ?? [];
   const max = Math.max(...rows.map((row) => row.count), 0);
   return <Col xs={24} lg={metric.span}><Card title={<Space><Icon style={{ color: token.colorPrimary }} /><span>{translate(metric.labelKey, {}, metric.label)}</span></Space>} loading={query.isLoading}><MetricDescription metric={metric} />{query.error && <Typography.Text type="danger">{String(query.error)}</Typography.Text>}{rows.map((row) => <div key={row.day}><Space style={{ width: "100%", justifyContent: "space-between" }}><Typography.Text>{row.day}</Typography.Text><Typography.Text type="secondary">{row.count}</Typography.Text></Space><Progress percent={max ? Math.round(row.count / max * 100) : 0} showInfo={false} /></div>)}{!query.isLoading && !rows.length && !query.error && <Typography.Text type="secondary">—</Typography.Text>}</Card></Col>;
 }
 function AggregateSummary({ metric }: { metric: DashboardMetric }) {
   const { translate } = useTranslation();
   const { result, query } = useCustom<{ value: number | null; operator: string }>({ url: `/api/v1/${metric.resource}/aggregate`, method: "get", config: { query: { field: metric.field, op: metric.agg ?? "sum" } } });
   const { token } = theme.useToken();
   const resource = resources.find((item) => item.name === metric.resource);
   const field = resource?.fields.find((item) => item.name === metric.field);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   const value = result.data?.value;
   const precision = field?.type === "Money" || field?.type === "Decimal" ? 2 : 0;
   const label = field ? translate(field.labelKey, {}, field.label) : metric.field ?? "";
   const aggKey = ({ sum: "qiy.aggSum", avg: "qiy.aggAvg", min: "qiy.aggMin", max: "qiy.aggMax" } as const)[metric.agg ?? "sum"];
   return <Col xs={24} sm={12} lg={metric.span}><Card title={<Space><Icon style={{ color: token.colorPrimary }} /><span>{translate(metric.labelKey, {}, metric.label)}</span></Space>} loading={query.isLoading}><MetricDescription metric={metric} />{query.error ? <Typography.Text type="danger">{String(query.error)}</Typography.Text> : <Statistic value={value ?? 0} precision={precision} suffix={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{translate(aggKey, {}, metric.agg ?? "sum") + " · " + label}</Typography.Text>} />}{value === null && !query.isLoading && !query.error && <Typography.Text type="secondary">{translate("qiy.noData", {}, "No data")}</Typography.Text>}</Card></Col>;
 }
 function ResourceSummary({ metric }: { metric: DashboardMetric }) {
   if (metric.type === "distribution") return <DistributionSummary metric={metric} />;
   if (metric.type === "trend") return <TrendSummary metric={metric} />;
   if (metric.type === "aggregate") return <AggregateSummary metric={metric} />;
   return <CountSummary metric={metric} />;
 }
 function CountSummary({ metric }: { metric: DashboardMetric }) {
   const { translate } = useTranslation();
   const { result, query } = useList({ resource: metric.resource, pagination: { currentPage: 1, pageSize: 1 } });
   const { token } = theme.useToken();
   const resource = resources.find((item) => item.name === metric.resource);
   const Icon = qiyIcons[(metric.icon ?? resource?.icon ?? "TableOutlined") as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
   return <Col xs={24} sm={12} lg={metric.span}><Link to={`/${metric.resource}`}><Card hoverable><Space><Icon style={{ fontSize: 24, color: token.colorPrimary }} /><div><Typography.Text type="secondary">{translate(metric.labelKey, {}, metric.label)}</Typography.Text><MetricDescription metric={metric} /><Statistic value={query.isLoading ? "—" : result.total ?? 0} /></div></Space></Card></Link></Col>;
}
export default function Home() {
  const { getLocale, translate } = useTranslation(); const locale: QiyLocale = resolveLocale(getLocale());
   return <Space direction="vertical" size="large" style={{ width: "100%" }}><div><Typography.Title level={2}>{t(locale, "overview")}</Typography.Title><Typography.Paragraph type="secondary">{t(locale, "overviewDescription")}</Typography.Paragraph></div><Row gutter={[16, 16]}>{dashboardMetrics.map((metric) => <CanAccess key={metric.name} resource={metric.resource} action="list"><ResourceSummary metric={metric} /></CanAccess>)}</Row><Card title={t(locale, "quickAccess")}><Space wrap>{resources.slice(0, 4).map((resource) => <CanAccess key={resource.name} resource={resource.name} action="list"><Link to={`/${resource.name}`}>{translate(resource.labelKey, {}, resource.label)}</Link></CanAccess>)}</Space></Card></Space>;
}
