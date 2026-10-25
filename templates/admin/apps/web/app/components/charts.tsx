import { CanAccess, useCustom, useList, useTranslation } from "@refinedev/core";
import { Alert, Card, Col, Empty, Progress, Row, Space, Spin, Statistic, Table, Typography, theme } from "antd";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { findChart, type ChartDefinition, type ChartPanelDefinition, type ChartViewDefinition } from "../charts";
import { getResource, type ResourceField } from "../resources";
import { resolveLocale, type QiyLocale } from "../i18n";
import { RecordFieldValue } from "./record-details";
import type { DisplayTranslate } from "../display-template";

/**
 * Multi-view chart page renderer.
 *
 * `app/charts.ts` carries the generated rows/cols layout; this component only
 * renders it with the existing data endpoints: list totals for `stat` counts,
 * `/aggregate` for stat sum/avg/min/max, `/distribution` for bar/pie, `/trend`
 * for line and the list endpoint for tables. Every view owns its query, loading
 * and error state, and chart cards are wrapped in `CanAccess` so data scopes and
 * page permissions are not bypassed by the dashboard.
 */

const chartPalette = ["#1677ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1", "#13c2c2", "#fa541c", "#8c8c8c"];

function viewTitle(view: ChartViewDefinition, translate: (key: string, params?: Record<string, unknown>, fallback?: string) => string): string {
  return translate(view.labelKey, {}, view.label);
}

function ViewState({ loading, error, children }: { loading: boolean; error: unknown; children: ReactNode }) {
  if (loading) return <Spin size="small" />;
  if (error) return <Alert type="error" showIcon message={String(error)} />;
  return <>{children}</>;
}

function enumLabel(field: ResourceField | undefined, value: string | null, translate: (key: string, params?: Record<string, unknown>, fallback?: string) => string): string {
  if (!field) return value ?? "—";
  const option = field.enumValues?.find((candidate) => candidate.name === value);
  if (!option) return value ?? "—";
  return translate(option.labelKey, {}, option.label ?? option.name);
}

/** `stat`: one aggregate number (list total for count, SQL aggregate otherwise). */
function StatView({ chart, view, title }: { chart: ChartDefinition; view: ChartViewDefinition; title: string }) {
  const { translate, getLocale } = useTranslation();
  const locale = resolveLocale(getLocale());
  const operator = view.aggregate ?? "count";
  const source = getResource(chart.source);
  const field = view.field ? source?.fields.find((candidate) => candidate.name === view.field) : undefined;
  const countQuery = useList({ resource: chart.source, pagination: { currentPage: 1, pageSize: 1 }, queryOptions: { enabled: operator === "count" } });
  const aggregateQuery = useCustom<{ value: number | null; operator?: string }>({
    url: `/api/v1/${chart.source}/aggregate`,
    method: "get",
    config: { query: { field: view.field, op: operator } },
    queryOptions: { enabled: operator !== "count" },
  });
  const loading = operator === "count" ? countQuery.query.isLoading : aggregateQuery.query.isLoading;
  const error = operator === "count" ? countQuery.query.error : aggregateQuery.query.error;
  const raw = operator === "count" ? countQuery.result.total ?? 0 : aggregateQuery.result.data?.value ?? 0;
  const numeric = Number(raw);
  const precision = field?.type === "Money" || field?.type === "Decimal" ? 2 : 0;
  const formatted = Number.isFinite(numeric) ? numeric.toLocaleString(locale, { minimumFractionDigits: precision, maximumFractionDigits: precision }) : String(raw ?? "—");
  const aggregateKey = ({ sum: "qiy.aggSum", avg: "qiy.aggAvg", min: "qiy.aggMin", max: "qiy.aggMax" } as const)[operator === "count" ? "sum" : operator];
  const suffix = operator === "count" ? "" : (field ? translate(aggregateKey, {}, operator) + " · " + translate(field.labelKey, {}, field.label) : translate(aggregateKey, {}, operator));
  return (
    <ViewState loading={loading} error={error}>
      <Statistic title={title} value={loading ? "…" : formatted} suffix={suffix ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{suffix}</Typography.Text> : undefined} />
    </ViewState>
  );
}

/** `bar` / `pie`: enum distribution from the existing server aggregate. */
function DistributionView({ chart, view, title, shape }: { chart: ChartDefinition; view: ChartViewDefinition; title: string; shape: "bar" | "pie" }) {
  const { translate } = useTranslation();
  const { result, query } = useCustom<{ items: Array<{ value: string | null; count: number }> }>({
    url: `/api/v1/${chart.source}/distribution`,
    method: "get",
    config: { query: { field: view.groupBy } },
  });
  const source = getResource(chart.source);
  const field = source?.fields.find((candidate) => candidate.name === view.groupBy);
  const items = result.data?.items ?? [];
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <ViewState loading={query.isLoading} error={query.error}>
      {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <>
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>{title}</Typography.Text>
        {shape === "bar" ? items.map((item) => (
          <div key={item.value ?? "null"} className="qiy-chart-bar-row">
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Typography.Text>{enumLabel(field, item.value, translate)}</Typography.Text>
              <Typography.Text type="secondary">{item.count}</Typography.Text>
            </Space>
            <Progress percent={total ? Math.round(item.count / total * 100) : 0} showInfo={false} />
          </div>
        )) : <>
          <div className="qiy-chart-pie">
            <svg viewBox="0 0 120 120" role="img" aria-label={title}>
              {(() => {
                const radius = 42;
                const circumference = 2 * Math.PI * radius;
                let offset = 0;
                return items.map((item, index) => {
                  const fraction = total ? item.count / total : 0;
                  const dash = fraction * circumference;
                  const circle = <circle
                    key={item.value ?? "null"}
                    r={radius}
                    cx={60}
                    cy={60}
                    fill="none"
                    stroke={chartPalette[index % chartPalette.length]}
                    strokeWidth={18}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 60 60)"
                  />;
                  offset += dash;
                  return circle;
                });
              })()}
            </svg>
          </div>
          <div className="qiy-chart-legend">
            {items.map((item, index) => (
              <Space key={item.value ?? "null"} style={{ width: "100%", justifyContent: "space-between" }}>
                <Space>
                  <span className="qiy-chart-legend-swatch" style={{ background: chartPalette[index % chartPalette.length] }} />
                  <Typography.Text>{enumLabel(field, item.value, translate)}</Typography.Text>
                </Space>
                <Typography.Text type="secondary">{item.count}</Typography.Text>
              </Space>
            ))}
          </div>
        </>}
      </>}
    </ViewState>
  );
}

/** `line`: daily count trend from the existing `/trend` endpoint (SVG polyline). */
function TrendView({ chart, view, title }: { chart: ChartDefinition; view: ChartViewDefinition; title: string }) {
  const { translate } = useTranslation();
  const { result, query } = useCustom<{ items: Array<{ day: string; count: number }> }>({
    url: `/api/v1/${chart.source}/trend`,
    method: "get",
    config: { query: { field: view.dateField, days: view.days ?? 30 } },
  });
  const items = result.data?.items ?? [];
  const max = Math.max(...items.map((item) => item.count), 0);
  const width = 320;
  const height = 120;
  const step = items.length > 1 ? width / (items.length - 1) : width;
  const points = items.map((item, index) => `${Math.round(index * step)},${Math.round(height - (max ? item.count / max : 0) * (height - 16) - 8)}`).join(" ");
  return (
    <ViewState loading={query.isLoading} error={query.error}>
      {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">{title}</Typography.Text>
          <Typography.Text type="secondary">{translate("qiy.chartMax", {}, "max") + " " + max}</Typography.Text>
        </Space>
        <svg className="qiy-chart-line" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} preserveAspectRatio="none">
          <polyline fill="none" stroke="#1677ff" strokeWidth={2} points={points} />
          {items.map((item, index) => <circle key={item.day} cx={Math.round(index * step)} cy={Math.round(height - (max ? item.count / max : 0) * (height - 16) - 8)} r={2} fill="#1677ff" />)}
        </svg>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">{items[0]?.day}</Typography.Text>
          <Typography.Text type="secondary">{items[items.length - 1]?.day}</Typography.Text>
        </Space>
      </>}
    </ViewState>
  );
}

/** `table`: read-only preview page (no edit actions) rendered with the shared field formatters. */
function ChartTableView({ chart, view }: { chart: ChartDefinition; view: ChartViewDefinition }) {
  const { translate, getLocale } = useTranslation();
  const locale: QiyLocale = resolveLocale(getLocale());
  const display = translate as unknown as DisplayTranslate;
  const source = getResource(chart.source);
  const fields = (view.columns ?? []).map((name) => source?.fields.find((candidate) => candidate.name === name)).filter((field): field is ResourceField => Boolean(field));
  const { result, query } = useList<Record<string, unknown>>({ resource: chart.source, pagination: { currentPage: 1, pageSize: 5 } });
  const columns = fields.map((field) => ({
    title: translate(field.labelKey, {}, field.label),
    dataIndex: field.name,
    key: field.name,
    render: (_value: unknown, record: Record<string, unknown>) => <RecordFieldValue field={field} value={record[field.name]} locale={locale} translate={display} />,
  }));
  return (
    <ViewState loading={query.isLoading} error={query.error}>
      <Table<Record<string, unknown>> size="small" rowKey="id" dataSource={result.data ?? []} columns={columns} pagination={false} scroll={{ x: "max-content" }} locale={{ emptyText: translate("qiy.noData", {}, "No data") }} />
      <Link to={"/" + chart.source} style={{ display: "inline-block", marginTop: 8 }}>{translate("qiy.view", {}, "View") + " " + (source?.plural ?? chart.source)}</Link>
    </ViewState>
  );
}

function ChartViewBlock({ chart, view }: { chart: ChartDefinition; view: ChartViewDefinition }) {
  const { translate } = useTranslation();
  const title = viewTitle(view, translate);
  return <div className="qiy-chart-view">
    {view.kind === "stat" ? <StatView chart={chart} view={view} title={title} /> : null}
    {view.kind === "bar" ? <DistributionView chart={chart} view={view} title={title} shape="bar" /> : null}
    {view.kind === "pie" ? <DistributionView chart={chart} view={view} title={title} shape="pie" /> : null}
    {view.kind === "line" ? <TrendView chart={chart} view={view} title={title} /> : null}
    {view.kind === "table" ? <ChartTableView chart={chart} view={view} /> : null}
  </div>;
}

/** One chart card: its Rows/Cols layout with every view in place. */
export function ChartCard({ chart }: { chart: ChartDefinition }) {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  return <Card title={<span style={{ color: token.colorPrimary }}>{translate(chart.labelKey, {}, chart.label)}</span>} size="small">
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {chart.rows.map((row, rowIndex) => (
        <Row gutter={[16, 16]} key={rowIndex} align="top">
          {row.columns.map((column, columnIndex) => (
            <Col key={columnIndex} xs={24} lg={column.span}>
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                {column.views.map((view) => <ChartViewBlock key={view.index} chart={chart} view={view} />)}
              </Space>
            </Col>
          ))}
        </Row>
      ))}
    </Space>
  </Card>;
}

/** Whole chart page: panels in declaration order, or all charts when no panel layout is declared. */
export function ChartDashboard({ charts, panels }: { charts: ChartDefinition[]; panels: ChartPanelDefinition[] }) {
  const { translate } = useTranslation();
  if (charts.length === 0) return <Empty description={translate("qiy.noData", {}, "No data")} />;
  if (panels.length === 0) {
    return <Row gutter={[16, 16]}>{charts.map((chart) => (
      <Col key={chart.name} xs={24} lg={12}><CanAccess resource={chart.source} action="list"><ChartCard chart={chart} /></CanAccess></Col>
    ))}</Row>;
  }
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    {panels.map((panel) => <section key={panel.name} className="qiy-chart-panel">
      <Typography.Title level={4} style={{ marginTop: 0 }}>{translate(panel.labelKey, {}, panel.label)}</Typography.Title>
      {panel.rows.map((row, rowIndex) => (
        <Row gutter={[16, 16]} key={rowIndex} style={{ marginBottom: 16 }}>
          {row.columns.map((column, columnIndex) => (
            <Col key={columnIndex} xs={24} lg={column.span}>
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                {column.charts.map((name) => {
                  const chart = findChart(name);
                  return chart ? <CanAccess key={name} resource={chart.source} action="list"><ChartCard chart={chart} /></CanAccess> : null;
                })}
              </Space>
            </Col>
          ))}
        </Row>
      ))}
    </section>)}
  </Space>;
}
