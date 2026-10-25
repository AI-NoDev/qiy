import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { generateWeb } from "../tools/generate-web";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

/**
 * Multi-view chart DSL:
 *
 *   chart [const] <Name> { source <entity>; Row { Col [span N] { view <kind> ... } } }
 *   chart panels <Name> { Row { Col [span N] { chart <Name>; } } }
 *
 * Parsing validates the whole layout against the model (sources, fields, enum
 * grouping, DateTime trends, spans ≤ 24, panel references), the serializer
 * round-trips it and generation emits the `app/charts.ts` layout metadata plus
 * the chart renderer/home-page wiring.
 */
const model = (body: string) => `qiy v0; application chart-demo {
  database sqlite {}
  enum orderStatus { value draft; value approved; }
  enum userRole { value admin; value viewer; }
  entity users {
    field id UUID @id;
    field email Text;
    field role userRole;
  }
  entity orders {
    field id UUID @id;
    field number Text;
    field status orderStatus;
    field total Integer;
    field createdAt DateTime;
  }
  ${body}
}`;

const chartBody = `chart const UserCount {
  source users;
  Row {
    Col span 12 { view stat @label("Users") { aggregate count; } }
    Col span 12 { view pie @label("By role") { groupBy role; } }
  }
}
chart const OrderTotals {
  source orders;
  Row {
    Col span 8 { view stat @label("Total") { aggregate sum; field total; } }
    Col span 16 { view line @label("Orders per day") { dateField createdAt; days 30; } }
  }
}
chart panels Overview {
  Row {
    Col span 8 { chart UserCount; }
    Col span 16 { chart OrderTotals; }
  }
}`;

describe("chart DSL", () => {
  test("parses chart definitions and panel layouts", () => {
    const project = parseQiyProject(model(chartBody));
    expect(project.dashboardMetrics).toBeUndefined();
    expect(project.charts).toEqual([
      {
        name: "UserCount",
        source: "users",
        rows: [{ columns: [
          { span: 12, views: [{ kind: "stat", label: "Users", aggregate: "count" }] },
          { span: 12, views: [{ kind: "pie", label: "By role", groupBy: "role" }] },
        ] }],
      },
      {
        name: "OrderTotals",
        source: "orders",
        rows: [{ columns: [
          { span: 8, views: [{ kind: "stat", label: "Total", aggregate: "sum", field: "total" }] },
          { span: 16, views: [{ kind: "line", label: "Orders per day", dateField: "createdAt", days: 30 }] },
        ] }],
      },
    ]);
    expect(project.chartPanels).toEqual([{
      name: "Overview",
      rows: [{ columns: [
        { span: 8, charts: ["UserCount"] },
        { span: 16, charts: ["OrderTotals"] },
      ] }],
    }]);
  });

  test("round-trips charts and panels through the serializer", () => {
    const project = parseQiyProject(model(chartBody));
    const serialized = serializeQiyProject(project);
    expect(serialized).toContain("chart const UserCount");
    expect(serialized).toContain("chart const OrderTotals");
    expect(serialized).toContain("chart panels Overview");
    expect(serialized).toContain("source users;");
    expect(serialized).toContain("aggregate count;");
    expect(parseQiyProject(serialized)).toEqual(project);
  });

  test("accepts table views and default spans", () => {
    const project = parseQiyProject(model(`chart const InventoryBoard {
  source orders;
  Row {
    Col { view table { columns number, status, total; } }
  }
}
chart panels Board {
  Row { Col { chart InventoryBoard; } }
}`));
    expect(project.charts?.[0]?.rows[0]?.columns[0]).toEqual({ span: 24, views: [{ kind: "table", columns: ["number", "status", "total"] }] });
    expect(project.chartPanels?.[0]?.rows[0]?.columns[0]).toEqual({ span: 8, charts: ["InventoryBoard"] });
  });

  test("reports clear validation errors", () => {
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 12 { view radar { } } } }"))).toThrow("unknown view kind radar");
    expect(() => parseQiyProject(model("chart const A { Row { Col span 12 { view stat { aggregate count; } } } }"))).toThrow("missing source statement");
    expect(() => parseQiyProject(model("chart const A { source missing; Row { Col span 12 { view stat { aggregate count; } } } }"))).toThrow("unknown source entity missing");
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 12 { view stat { aggregate sum; field nope; } } } }"))).toThrow("unknown field nope");
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 12 { view stat { aggregate count; field email; } } } }"))).toThrow("aggregate count does not take field");
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 12 { view stat { aggregate sum; } } } }"))).toThrow("aggregate sum requires field");
    expect(() => parseQiyProject(model("chart const A { source orders; Row { Col span 12 { view stat { aggregate sum; field number; } } } }"))).toThrow("must be Integer, Decimal or Money");
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 12 { view bar { groupBy email; } } } }"))).toThrow("groupBy field email must be an enum field");
    expect(() => parseQiyProject(model("chart const A { source orders; Row { Col span 12 { view line { dateField number; } } } }"))).toThrow("must be a DateTime field");
    expect(() => parseQiyProject(model("chart const A { source orders; Row { Col span 12 { view line { dateField createdAt; aggregate sum; field total; } } } }"))).toThrow("only support aggregate count");
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 12 { view stat { aggregate count; groupBy role; } } } }"))).toThrow("does not support groupBy");
    expect(() => parseQiyProject(model("chart const A { source orders; Row { Col span 12 { view table { columns id; } } } }"))).not.toThrow();
    expect(() => parseQiyProject(model("chart const A { source orders; Row { Col span 12 { view table { } } } }"))).toThrow("requires columns");
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 25 { view stat { aggregate count; } } } }"))).toThrow("span must be between 1 and 24");
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 16 { view stat { aggregate count; } } Col span 16 { view stat { aggregate count; } } } }"))).toThrow("row spans exceed 24");
    expect(() => parseQiyProject(model("chart const A { source users; }"))).toThrow("missing Row layout");
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 12 { } } }"))).toThrow("needs at least one view");
    expect(() => parseQiyProject(model("chart const A { source users; Row { Col span 12 { view line { dateField createdAt; days 400; } } } }"))).toThrow("days must be between 1 and 365");
    // Panels: unknown references, empty columns/rows and duplicate names.
    expect(() => parseQiyProject(model("chart panels Board { Row { Col span 8 { chart Missing; } } }"))).toThrow("unknown chart Missing");
    expect(() => parseQiyProject(model("chart panels Board { Row { Col span 8 { } } }"))).toThrow("Col needs at least one chart");
    expect(() => parseQiyProject(model(`${chartBody}\nchart panels Overview { Row { Col span 8 { chart UserCount; } } }`))).toThrow("Duplicate chart or panel name Overview");
    expect(() => parseQiyProject(model(`chart const A { source users; Row { Col span 12 { view stat { aggregate count; } } } }\nchart const A { source users; Row { Col span 12 { view stat { aggregate count; } } } }`))).toThrow("Duplicate chart or panel name A");
    expect(() => parseQiyProject(model("chart panels Board { Row { Col span 8 { chart UserCount; } } }"))).toThrow("unknown chart UserCount");
  });

  test("generates chart metadata, renderers and the home-page branch", () => {
    const project = parseQiyProject(model(chartBody));
    const files = generateWeb(project.database, project);
    const charts = files["web/app/charts.ts"]!;
    expect(charts).toContain('"name": "UserCount"');
    expect(charts).toContain('"labelKey": "qiy.charts.UserCount.label"');
    expect(charts).toContain('"labelKey": "qiy.charts.UserCount.views.0.label"');
    expect(charts).toContain('"labelKey": "qiy.charts.UserCount.views.1.label"');
    expect(charts).toContain('"name": "Overview"');
    expect(charts).toContain('"source": "users"');
    expect(charts).toContain('"aggregate": "sum"');
    expect(charts).toContain('"days": 30');
    expect(charts).toContain('"columns": [' );
    // Home prefers the chart page; the legacy metric cards remain the fallback.
    expect(files["web/app/routes/home.tsx"]).toContain("ChartDashboard");
    expect(files["web/app/routes/home.tsx"]).toContain("charts.length > 0");
    expect(files["web/app/routes/home.tsx"]).toContain("dashboardMetrics.map((metric)");
    expect(files["web/app/components/charts.tsx"]).toContain("export function ChartDashboard");
    expect(files["web/app/components/charts.tsx"]).toContain("/distribution");
    expect(files["web/app/components/charts.tsx"]).toContain("/trend");
    expect(files["web/app/components/charts.tsx"]).toContain("/aggregate");
    expect(files["web/app/components/charts.tsx"]).toContain("CanAccess");
    // Chart views aggregate through the data provider (REST and GraphQL).
    expect(files["web/app/data-provider.ts"]).toContain("(distribution|trend|aggregate)");
    expect(files["web/app/data-provider.ts"]).toContain("Aggregate`");
    // Generated tests cover layout ordering/spans and i18n keys.
    expect(files["web/tests/charts.test.ts"]).toContain("chart layout metadata preserves row/column/view order");
    expect(files["web/tests/model-i18n.test.ts"]).toContain("import { chartPanels, charts, flattenChartViews }");
    // A chart page replaces the default metric fallback metadata.
    expect(files["web/app/dashboard.ts"]).toContain("export const dashboardMetrics: DashboardMetric[] = []");
  });

  test("projects without charts keep the legacy metric dashboard", () => {
    const project = parseQiyProject(model(""));
    const files = generateWeb(project.database, project);
    expect(files["web/app/charts.ts"]).toContain("export const charts: ChartDefinition[] = []");
    expect(files["web/app/dashboard.ts"]).toContain('"resource": "users"');
    expect(files["web/app/routes/home.tsx"]).toContain("dashboardMetrics.map((metric)");
    expect(parseQiyProject(serializeQiyProject(project)).charts).toBeUndefined();
    const generated = generateProject(project.database, project.name, project);
    expect(generated["apps/web/app/charts.ts"]).toContain("export const chartPanels: ChartPanelDefinition[] = []");
  });
});
