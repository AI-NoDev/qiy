import { CanAccess, useCustom, useList, useTranslation } from "@refinedev/core";
import { Alert, Card, Col, Empty, Progress, Row, Select, Space, Spin, Statistic, Table, Typography, theme } from "antd";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
  chartViewKindLabelKey,
  chartViewportBreakpoints,
  chartViewportCategory,
  defaultChartView,
  readStoredChartPanel,
  resolveChartPanel,
  selectChartPlacement,
  storeChartPanel,
  type ChartDefinition,
  type ChartPanelDefinition,
  type ChartPlacement,
  type ChartViewDefinition,
  type ChartViewKind,
  type ChartViewportCategory,
} from "../charts";
import { getResource, type ResourceField } from "../resources";
import { resolveLocale, type QiyLocale } from "../i18n";
import { qiyIcons } from "../icons";
import { RecordFieldValue } from "./record-details";
import type { DisplayTranslate } from "../display-template";

/**
 * Multi-view chart page renderer.
 *
 * The DSL (`chart [kind] Name { data = ...; }` + `chart panels Name { grid ...; }`)
 * is compiled into `app/charts.ts`. This component renders one panel at a time on
 * a CSS grid whose cells come from the declared `grid <cols> <rows>`: every chart
 * placement becomes `grid-column`/`grid-row` numbers, so sizes are the declared
 * grid cells (never fixed pixel strings). The active variant is chosen with
 * matchMedia (`larger` >=1200px, `medium` >=768px, `small` below) and a chart with
 * several views gets a top-right view-kind selector.
 */

const viewKindFallback: Record<ChartViewKind, string> = { const: "Stat", pie: "Pie chart", bar: "Bar chart", line: "Line chart", area: "Area chart", scatter: "Scatter chart", table: "Table" };
const chartPalette = ["#1677ff", "#52c41a", "#faad14", "#eb2f96", "#722ed1", "#13c2c2", "#fa541c", "#8c8c8c"];

function useChartViewportCategory(): ChartViewportCategory {
  const [category, setCategory] = useState<ChartViewportCategory>(() => typeof window === "undefined" ? "small" : chartViewportCategory(window.innerWidth));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const large = window.matchMedia("(min-width: " + chartViewportBreakpoints.larger + "px)");
    const medium = window.matchMedia("(min-width: " + chartViewportBreakpoints.medium + "px)");
    const update = () => setCategory(large.matches ? "larger" : medium.matches ? "medium" : "small");
    update();
    large.addEventListener("change", update);
    medium.addEventListener("change", update);
    return () => {
      large.removeEventListener("change", update);
      medium.removeEventListener("change", update);
    };
  }, []);
  return category;
}

function ViewState({ loading, error, children }: { loading: boolean; error: unknown; children: ReactNode }) {
  if (loading) return <Spin size="small" />;
  if (error) return <Alert type="error" showIcon message={String(error)} />;
  return <>{children}</>;
}

function kindLabel(kind: ChartViewKind, translate: (key: string, params?: Record<string, unknown>, fallback?: string) => string): string {
  return translate(chartViewKindLabelKey(kind), {}, viewKindFallback[kind]);
}

/** `const`: one aggregate number (list total for count, SQL aggregate otherwise). */
function StatView({ chart, view, title }: { chart: ChartDefinition; view: ChartViewDefinition; title: string }) {
  const { translate, getLocale } = useTranslation();
  const locale = resolveLocale(getLocale());
  const data = view.data;
  const source = getResource(data.entity);
  const field = data.field ? source?.fields.find((candidate) => candidate.name === data.field) : undefined;
  void chart;
  const isCount = data.operation === "count";
  const countQuery = useList({ resource: data.entity, pagination: { currentPage: 1, pageSize: 1 }, queryOptions: { enabled: isCount } });
  const aggregateQuery = useCustom<{ value: number | null; operator?: string }>({
    url: `/api/v1/${data.entity}/aggregate`,
    method: "get",
    config: { query: { field: data.field, op: data.operation } },
    queryOptions: { enabled: !isCount },
  });
  const loading = isCount ? countQuery.query.isLoading : aggregateQuery.query.isLoading;
  const error = isCount ? countQuery.query.error : aggregateQuery.query.error;
  const raw = isCount ? countQuery.result.total ?? 0 : aggregateQuery.result.data?.value ?? 0;
  const numeric = Number(raw);
  const precision = field?.type === "Money" || field?.type === "Decimal" ? 2 : 0;
  const formatted = Number.isFinite(numeric) ? numeric.toLocaleString(locale, { minimumFractionDigits: precision, maximumFractionDigits: precision }) : String(raw ?? "—");
  const aggregateKey = data.operation === "sum" ? "qiy.aggSum" : data.operation === "avg" ? "qiy.aggAvg" : data.operation === "min" ? "qiy.aggMin" : data.operation === "max" ? "qiy.aggMax" : undefined;
  const suffix = isCount || !aggregateKey ? undefined : (field ? translate(aggregateKey, {}, data.operation) + " · " + translate(field.labelKey, {}, field.label) : translate(aggregateKey, {}, data.operation));
  return (
    <ViewState loading={loading} error={error}>
      <Statistic title={title} value={loading ? "…" : formatted} suffix={suffix ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{suffix}</Typography.Text> : undefined} />
    </ViewState>
  );
}

function labelFor(view: ChartViewDefinition, value: string | null, translate: (key: string, params?: Record<string, unknown>, fallback?: string) => string): string {
  const entry = view.labels?.values.find((candidate) => candidate.value === value);
  if (entry) return translate(entry.labelKey, {}, entry.label);
  return value ?? "—";
}

/** `pie` / `bar`: enum distribution from the existing `/distribution` endpoint. */
function DistributionView({ view, title, shape }: { view: ChartViewDefinition; title: string; shape: "bar" | "pie" }) {
  const { translate } = useTranslation();
  const { result, query } = useCustom<{ items: Array<{ value: string | null; count: number }> }>({
    url: `/api/v1/${view.data.entity}/distribution`,
    method: "get",
    config: { query: { field: view.data.groupBy } },
  });
  const items = result.data?.items ?? [];
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <ViewState loading={query.isLoading} error={query.error}>
      {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <>
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>{title}</Typography.Text>
        {shape === "bar" ? items.map((item) => (
          <div key={item.value ?? "null"} className="qiy-chart-bar-row">
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Typography.Text>{labelFor(view, item.value, translate)}</Typography.Text>
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
                  <Typography.Text>{labelFor(view, item.value, translate)}</Typography.Text>
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

/** `line`: daily count trend from the existing `/trend` endpoint (inline SVG polyline). */
function TrendView({ view, title, area = false }: { view: ChartViewDefinition; title: string; area?: boolean }) {
  const { translate } = useTranslation();
  const { result, query } = useCustom<{ items: Array<{ day: string; count: number }> }>({
    url: `/api/v1/${view.data.entity}/trend`,
    method: "get",
    config: { query: { field: view.data.field, days: view.data.days ?? 30 } },
  });
  const items = result.data?.items ?? [];
  const max = Math.max(...items.map((item) => item.count), 0);
  const width = 320;
  const height = 120;
  const step = items.length > 1 ? width / (items.length - 1) : width;
  const y = (count: number) => Math.round(height - (max ? count / max : 0) * (height - 16) - 8);
  const points = items.map((item, index) => `${Math.round(index * step)},${y(item.count)}`).join(" ");
  return (
    <ViewState loading={query.isLoading} error={query.error}>
      {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">{title}</Typography.Text>
          <Typography.Text type="secondary">{translate("qiy.aggMax", {}, "max") + " " + max}</Typography.Text>
        </Space>
        <svg className="qiy-chart-line" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} preserveAspectRatio="none">
          {area && <polygon fill="rgba(22,119,255,0.18)" points={`0,${height} ${points} ${width},${height}`} />}
          <polyline fill="none" stroke="#1677ff" strokeWidth={2} points={points} />
          {items.map((item, index) => <circle key={item.day} cx={Math.round(index * step)} cy={y(item.count)} r={2} fill="#1677ff" />)}
        </svg>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">{items[0]?.day}</Typography.Text>
          <Typography.Text type="secondary">{items[items.length - 1]?.day}</Typography.Text>
        </Space>
      </>}
    </ViewState>
  );
}

/** `scatter`: client-side numeric x/y points from the list endpoint; click opens the record. */
function ScatterView({ view, title }: { view: ChartViewDefinition; title: string }) {
  const navigate = useNavigate();
  const { translate } = useTranslation();
  const { result, query } = useList<Record<string, unknown>>({ resource: view.data.entity, pagination: { currentPage: 1, pageSize: 200 } });
  const [xName, yName] = view.data.columns ?? [];
  const rows = (result.data?.data ?? []).flatMap((row) => {
    const x = Number(row[xName ?? ""]);
    const y = Number(row[yName ?? ""]);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ id: String(row.id ?? ""), x, y }] : [];
  });
  const width = 320;
  const height = 160;
  const maxX = Math.max(...rows.map((row) => row.x), 1);
  const maxY = Math.max(...rows.map((row) => row.y), 1);
  const minX = Math.min(...rows.map((row) => row.x), 0);
  const minY = Math.min(...rows.map((row) => row.y), 0);
  const px = (value: number) => 12 + ((value - minX) / (maxX - minX || 1)) * (width - 24);
  const py = (value: number) => height - 12 - ((value - minY) / (maxY - minY || 1)) * (height - 24);
  return (
    <ViewState loading={query.isLoading} error={query.error}>
      {rows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">{title}</Typography.Text>
          <Typography.Text type="secondary">{`${xName} / ${yName}`}</Typography.Text>
        </Space>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ width: "100%", height: 160 }}>
          <line x1={12} y1={height - 12} x2={width - 12} y2={height - 12} stroke="#d9d9d9" />
          <line x1={12} y1={12} x2={12} y2={height - 12} stroke="#d9d9d9" />
          {rows.map((row) => <circle key={row.id || `${row.x}-${row.y}`} cx={px(row.x)} cy={py(row.y)} r={4} fill="#1677ff" style={row.id ? { cursor: "pointer" } : undefined} onClick={() => row.id && navigate(`/${view.data.entity}/show/${row.id}`)} />)}
        </svg>
        <Typography.Text type="secondary">{translate("qiy.scatterHint", {}, "Click a point to open the record")}</Typography.Text>
      </>}
    </ViewState>
  );
}

/** `table`: read-only preview page (no edit actions) rendered with the shared field formatters. */
function ChartTableView({ view }: { view: ChartViewDefinition }) {
  const { translate, getLocale } = useTranslation();
  const locale: QiyLocale = resolveLocale(getLocale());
  const display = translate as unknown as DisplayTranslate;
  const source = getResource(view.data.entity);
  const fields = (view.data.columns ?? []).map((name) => source?.fields.find((candidate) => candidate.name === name)).filter((field): field is ResourceField => Boolean(field));
  const { result, query } = useList<Record<string, unknown>>({ resource: view.data.entity, pagination: { currentPage: 1, pageSize: 5 } });
  const columns = fields.map((field) => ({
    title: translate(field.labelKey, {}, field.label),
    dataIndex: field.name,
    key: field.name,
    render: (_value: unknown, record: Record<string, unknown>) => <RecordFieldValue field={field} value={record[field.name]} locale={locale} translate={display} />,
  }));
  return (
    <ViewState loading={query.isLoading} error={query.error}>
      <Table<Record<string, unknown>> size="small" rowKey="id" dataSource={result.data ?? []} columns={columns} pagination={false} scroll={{ x: "max-content" }} locale={{ emptyText: translate("qiy.noData", {}, "No data") }} />
      <Link to={"/" + view.data.entity} style={{ display: "inline-block", marginTop: 8 }}>
        {translate("qiy.viewResource", { resource: translate(source?.pluralKey ?? "", {}, source?.plural ?? view.data.entity) }, "View " + (source?.plural ?? view.data.entity))}
      </Link>
    </ViewState>
  );
}

function ChartViewBody({ chart, view, title }: { chart: ChartDefinition; view: ChartViewDefinition; title: string }) {
  if (view.kind === "const") return <StatView chart={chart} view={view} title={title} />;
  if (view.kind === "bar") return <DistributionView view={view} title={title} shape="bar" />;
  if (view.kind === "pie") return <DistributionView view={view} title={title} shape="pie" />;
  if (view.kind === "line" || view.kind === "area") return <TrendView view={view} title={title} area={view.kind === "area"} />;
  if (view.kind === "scatter") return <ScatterView view={view} title={title} />;
  return <ChartTableView view={view} />;
}

/** One chart card; multi-view charts get a top-right view-kind selector. */
export function ChartCard({ chart }: { chart: ChartDefinition }) {
  const { translate } = useTranslation();
  const { token } = theme.useToken();
  const [kind, setKind] = useState<ChartViewKind | undefined>(() => defaultChartView(chart)?.kind);
  const selected = chart.views.find((view) => view.kind === kind) ?? defaultChartView(chart);
  if (!selected) return null;
  const Icon = chart.icon ? qiyIcons[chart.icon as keyof typeof qiyIcons] : undefined;
  const title = translate(selected.labelKey, {}, selected.label || chart.title);
  const selector = chart.views.length > 1
    ? <Select
        size="small"
        aria-label={translate("qiy.chartView", {}, "View")}
        value={selected.kind}
        style={{ minWidth: 108 }}
        options={chart.views.map((view) => ({ value: view.kind, label: kindLabel(view.kind, translate) }))}
        onChange={(next: ChartViewKind) => setKind(next)}
      />
    : undefined;
  return <Card
    className="qiy-chart-card"
    size="small"
    title={<Space>{Icon ? <Icon style={{ color: token.colorPrimary }} /> : null}<span>{translate(chart.labelKey, {}, chart.title)}</span></Space>}
    extra={selector}
  >
    <CanAccess resource={selected.data.entity} action="list">
      <ChartViewBody chart={chart} view={selected} title={title} />
    </CanAccess>
  </Card>;
}

function panelGridStyle(panel: ChartPanelDefinition): CSSProperties {
  return {
    display: "grid",
    width: "100%",
    gap: 16,
    gridTemplateColumns: "repeat(" + panel.grid.columns + ", minmax(0, 1fr))",
    gridAutoRows: "minmax(0, auto)",
  };
}

function placementStyle(placement: ChartPlacement): CSSProperties {
  // Grid cells, not pixels: `x`/`y` are the 0-based origin, `w`/`h` the size.
  return { gridColumn: `${placement.x + 1} / span ${placement.w}`, gridRow: `${placement.y + 1} / span ${placement.h}`, minWidth: 0 };
}

/** Whole chart page: one selected panel (panel selector only when several exist). */
export function ChartDashboard({ charts, panels }: { charts: ChartDefinition[]; panels: ChartPanelDefinition[] }) {
  const { translate } = useTranslation();
  const category = useChartViewportCategory();
  const [panelName, setPanelName] = useState<string | undefined>(() => readStoredChartPanel());
  if (charts.length === 0) return <Empty description={translate("qiy.noData", {}, "No data")} />;
  if (panels.length === 0) {
    return <Row gutter={[16, 16]}>{charts.map((chart) => (
      <Col key={chart.name} xs={24} lg={12}><ChartCard chart={chart} /></Col>
    ))}</Row>;
  }
  const selected = resolveChartPanel(panels, panelName);
  if (!selected) return <Empty description={translate("qiy.noData", {}, "No data")} />;
  const chartByName = new Map(charts.map((chart) => [chart.name, chart]));
  const choosePanel = (name: string) => { setPanelName(name); storeChartPanel(name); };
  return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
    <div className="qiy-chart-panel-header">
      <Typography.Title level={4} style={{ margin: 0 }}>{translate(selected.labelKey, {}, selected.title)}</Typography.Title>
      {panels.length > 1
        ? <Select
            aria-label={translate("qiy.chartView", {}, "View")}
            value={selected.name}
            style={{ minWidth: 160 }}
            options={panels.map((panel) => ({ value: panel.name, label: translate(panel.labelKey, {}, panel.title) }))}
            onChange={choosePanel}
          />
        : null}
    </div>
    <div className="qiy-chart-grid" style={panelGridStyle(selected)}>
      {selected.charts.map((entry) => {
        const chart = chartByName.get(entry.name);
        if (!chart) return null;
        const placement = selectChartPlacement(entry.placements, category);
        return <div key={entry.name} className="qiy-chart-grid-cell" style={placement ? placementStyle(placement) : { minWidth: 0 }}>
          <CanAccess resource={chart.views[0]?.data.entity ?? ""} action="list"><ChartCard chart={chart} /></CanAccess>
        </div>;
      })}
    </div>
  </Space>;
}
