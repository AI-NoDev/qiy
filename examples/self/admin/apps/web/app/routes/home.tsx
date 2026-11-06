import { CanAccess, useList, useTranslation } from "@refinedev/core";
import { Card, Col, Row, Space, Statistic, Typography, theme } from "antd";
import { Link } from "react-router";
import { resources, type ResourceDefinition } from "../resources";
import { chartPanels, charts } from "../charts";
import { ChartDashboard } from "../components/charts";
import { qiyIcons } from "../icons";
import { t, resolveLocale, type QiyLocale } from "../i18n";

function ResourceSummary({ resource }: { resource: ResourceDefinition }) {
  const { translate } = useTranslation();
  const { result, query } = useList({ resource: resource.name, pagination: { currentPage: 1, pageSize: 1 } });
  const { token } = theme.useToken();
  const Icon = qiyIcons[resource.icon as keyof typeof qiyIcons] ?? qiyIcons.TableOutlined;
  return <Col xs={24} sm={12} lg={8}><Link to={`/${resource.name}`}><Card hoverable><Space><Icon style={{ fontSize: 24, color: token.colorPrimary }} /><div><Typography.Text type="secondary">{translate(resource.pluralKey, {}, translate(resource.labelKey, {}, resource.label))}</Typography.Text><Statistic value={query.isLoading ? "—" : result.total ?? 0} /></div></Space></Card></Link></Col>;
}
export default function Home() {
  const { getLocale, translate } = useTranslation(); const locale: QiyLocale = resolveLocale(getLocale());
   return <Space direction="vertical" size="large" style={{ width: "100%" }}><div><Typography.Title level={2}>{t(locale, "overview")}</Typography.Title><Typography.Paragraph type="secondary">{t(locale, "overviewDescription")}</Typography.Paragraph></div>{charts.length > 0 ? <ChartDashboard charts={charts} panels={chartPanels} /> : <Row gutter={[16, 16]}>{resources.filter((resource) => !resource.readOnly).map((resource) => <CanAccess key={resource.name} resource={resource.name} action="list"><ResourceSummary resource={resource} /></CanAccess>)}</Row>}<Card title={t(locale, "quickAccess")}><Space wrap>{resources.slice(0, 4).map((resource) => <CanAccess key={resource.name} resource={resource.name} action="list"><Link to={`/${resource.name}`}>{translate(resource.pluralKey, {}, translate(resource.labelKey, {}, resource.label))}</Link></CanAccess>)}</Space></Card></Space>;
}
