import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { generateWeb } from "../tools/generate-web";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

/**
 * Chart DSL (v2, assignment syntax + responsive grid panels):
 *
 *   chart [kind] <Name> { icon = "..."; title = "..."; data = ...; labels = ...; }
 *   chart panels <Name> { title = "..."; grid <cols> <rows>; <Chart> { <variant> <x> <y> <w> <h>; } }
 *
 * Views of one chart are declared by repeating the name with different kinds;
 * panels place charts on a declared grid with responsive variants.
 */
const model = (body: string) => `qiy v0; application chart-demo {
  database sqlite {}
  enum userRole { value admin; value operator; value viewer; }
  enum orderStatus { value draft; value approved; }
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
  icon = "TeamOutlined";
  title = "Users";
  data = count users;
}
chart pie UserStatusCount {
  icon = "PieChartOutlined";
  title = "Users by status";
  data = count users group by role;
  labels = role;
}
chart bar UserStatusCount {
  title = "Users by status";
  data = count users group by role;
  labels {
    admin "Admins";
    viewer "Viewers";
  }
}
chart line OrderTrend {
  title = "Orders per day";
  data = trend orders.createdAt days 30;
}
chart table OrderTable {
  title = "Recent orders";
  data = list orders columns number, status, total;
}
chart panels Overview {
  title = "Overview";
  grid 24 24;
  UserCount {
    larger 0 0 6 2;
    medium 0 0 12 2;
    small 0 0 24 3;
  }
  UserStatusCount {
    larger 6 0 12 2;
  }
}
`;

describe("chart DSL", () => {
  test("groups same-name declarations into multi-view charts", () => {
    const project = parseQiyProject(model(chartBody));
    expect(project.dashboardMetrics).toBeUndefined();
    expect(project.charts?.map((chart) => chart.name)).toEqual(["UserCount", "UserStatusCount", "OrderTrend", "OrderTable"]);
    expect(project.charts?.[0]).toMatchObject({ name: "UserCount", title: "Users", icon: "TeamOutlined", views: [{ kind: "const", data: { operation: "count", entity: "users" } }] });
    const multi = project.charts?.[1]!;
    expect(multi.title).toBe("Users by status");
    expect(multi.views.map((view) => view.kind)).toEqual(["pie", "bar"]);
    expect(multi.views[0]).toMatchObject({ data: { operation: "count", entity: "users", groupBy: "role" }, labels: { field: "role" } });
    expect(multi.views[1]?.labels).toEqual({ values: [{ value: "admin", label: "Admins" }, { value: "viewer", label: "Viewers" }] });
    expect(project.charts?.[2]?.views[0]?.data).toEqual({ operation: "trend", entity: "orders", field: "createdAt", days: 30 });
    expect(project.charts?.[3]?.views[0]?.data).toEqual({ operation: "list", entity: "orders", columns: ["number", "status", "total"] });
    expect(project.chartPanels).toEqual([{
      name: "Overview",
      title: "Overview",
      grid: { columns: 24, rows: 24 },
      charts: [
        { name: "UserCount", placements: [
          { variant: "larger", x: 0, y: 0, w: 6, h: 2 },
          { variant: "medium", x: 0, y: 0, w: 12, h: 2 },
          { variant: "small", x: 0, y: 0, w: 24, h: 3 },
        ] },
        { name: "UserStatusCount", placements: [{ variant: "larger", x: 6, y: 0, w: 12, h: 2 }] },
      ],
    }]);
  });

  test("area charts reuse the trend contract and render a filled view", () => {
    const project = parseQiyProject(model(`chart area OrderTrend {
  title = "Orders per day";
  data = trend orders.createdAt days 7;
}
`));
    expect(project.charts?.[0]?.views[0]?.kind).toBe("area");
    const files = generateProject(project.database, "chart-demo", project);
    expect(files["apps/web/app/charts.ts"]).toContain('"area"');
    expect(files["apps/web/app/components/charts.tsx"]).toContain('area={view.kind === "area"}');
  });

  test("round-trips chart views and panels through the serializer", () => {
    const project = parseQiyProject(model(chartBody));
    const serialized = serializeQiyProject(project);
    expect(serialized).toContain("chart const UserCount");
    expect(serialized).toContain("chart pie UserStatusCount");
    expect(serialized).toContain("chart bar UserStatusCount");
    expect(serialized).toContain('data = count users group by role;');
    expect(serialized).toContain('labels = role;');
    expect(serialized).toContain('data = list orders columns number, status, total;');
    expect(serialized).toContain("chart panels Overview");
    expect(serialized).toContain("grid 24 24;");
    expect(serialized).toContain("larger 0 0 6 2;");
    expect(parseQiyProject(serialized)).toEqual(project);
  });

  test("accepts optional const kind and an omitted trailing semicolon", () => {
    const project = parseQiyProject(model(`chart UserCount {
  title = "Users";
  data = count users
}
chart panels Overview {
  title = "Overview";
  grid 12 12;
  UserCount { small 0 0 12 4; }
}`));
    expect(project.charts?.[0]?.views[0]?.kind).toBe("const");
    expect(project.chartPanels?.[0]?.grid).toEqual({ columns: 12, rows: 12 });
  });

  test("reports clear validation errors", () => {
    const fails = (body: string, message: string) => expect(() => parseQiyProject(model(body))).toThrow(message);
    // data mini language
    fails(`chart const A { data = total users; }`, "unknown data operation total");
    fails(`chart const A { data = count missing; }`, "unknown entity missing");
    fails(`chart const A { data = sum users.nope; }`, "unknown field nope");
    fails(`chart const A { data = sum users.email; }`, "must be Integer, Decimal or Money");
    fails(`chart const A { data = count users group by role; }`, "count data cannot group by");
    fails(`chart const A { data = sum orders.total group by status; }`, "group by is not supported");
    fails(`chart pie A { data = count users; }`, "pie/bar views require");
    fails(`chart pie A { data = count users group by email; }`, "group by field email must be an enum field");
    fails(`chart bar A { data = count users group by role; labels = email; }`, "labels field email must be an enum field");
    fails(`chart line A { data = count users; }`, "line views require");
    fails(`chart line A { data = trend orders.total days 30; }`, "must be a DateTime field");
    fails(`chart line A { data = trend orders.createdAt; }`, 'trend data requires "days <1..365>"');
    fails(`chart line A { data = trend orders.createdAt days 400; }`, "days must be between 1 and 365");
    fails(`chart table A { data = count users; }`, "table views require");
    fails(`chart table A { data = list orders columns nope; }`, "unknown field nope");
    // properties
    fails(`chart const A { }`, "missing data property");
    fails(`chart const A { colour = "x"; data = count users; }`, "unknown property colour");
    fails(`chart const A { title = "a"; title = "b"; data = count users; }`, "duplicate title property");
    fails(`chart const A { data = count users title = "a"; }`, "expected ; after the property value");
    fails(`chart pie A { data = count users group by role; labels { admin "a"; admin "b"; } }`, "duplicate labels mapping admin");
    // view grouping
    fails(`chart const A { data = count users; }\nchart const A { data = count users; }`, "duplicate const view");
    fails(`chart const A { data = count users; }\nchart bar A { data = count users group by role; }\nchart bar A { data = count users group by role; }`, "duplicate bar view");
    // panels
    fails(`chart const A { data = count users; }\nchart panels P { A { larger 0 0 6 2; } }`, "missing grid property");
    fails(`chart const A { data = count users; }\nchart panels P { grid 24 24; A { huge 0 0 6 2; } }`, "unknown variant huge");
    fails(`chart const A { data = count users; }\nchart panels P { grid 24 24; A { larger 0 0 6 2; larger 0 0 6 2; } }`, "duplicate larger placement");
    fails(`chart const A { data = count users; }\nchart panels P { grid 24 24; A { larger 20 0 6 2; } }`, "exceeds 24 grid columns");
    fails(`chart const A { data = count users; }\nchart panels P { grid 24 24; A { larger 0 23 6 2; } }`, "exceeds 24 grid rows");
    fails(`chart const A { data = count users; }\nchart panels P { grid 24 24; B { larger 0 0 6 2; } }`, "unknown chart B");
    fails(`chart const A { data = count users; }\nchart panels P { grid 30 24; A { larger 0 0 6 2; } }`, "grid columns must be between 1 and 24");
    fails(`chart const A { data = count users; }\nchart panels A { grid 24 24; A { larger 0 0 6 2; } }`, "name already used by a chart panel");
    fails(`chart panels P { grid 24 24; A { larger 0 0 6 2; } }`, "unknown chart A");
    fails(`chart panels P { grid 24 24; }`, "needs at least one chart");
    fails(`chart grid { data = count users; }`, "reserved inside chart panels");
  });

  test("generates chart metadata, helpers, selectors and the home-page branch", () => {
    const project = parseQiyProject(model(chartBody));
    const files = generateWeb(project.database, project);
    const charts = files["web/app/charts.ts"]!;
    expect(charts).toContain('"name": "UserStatusCount"');
    expect(charts).toContain('"kind": "pie"');
    expect(charts).toContain('"kind": "bar"');
    expect(charts).toContain('"labelKey": "qiy.charts.UserStatusCount.views.pie.label"');
    expect(charts).toContain('"labelKey": "qiy.charts.UserStatusCount.labels.admin"');
    expect(charts).toContain('"grid": {');
    expect(charts).toContain('"columns": 24');
    expect(charts).toContain('"variant": "larger"');
    expect(charts).toContain("export function selectChartPlacement");
    expect(charts).toContain("export function chartViewportCategory");
    expect(charts).toContain('export const chartPanelStorageKey = "qiy.charts.panel"');
    expect(charts).toContain("export function resolveChartPanel");
    // Home renders the chart dashboard; the legacy metric cards stay the fallback.
    expect(files["web/app/routes/home.tsx"]).toContain("ChartDashboard");
    expect(files["web/app/routes/home.tsx"]).toContain("charts.length > 0");
    // Renderer: view-kind selector, panel selector, CSS grid placements, matchMedia variants.
    expect(files["web/app/components/charts.tsx"]).toContain("export function ChartCard");
    expect(files["web/app/components/charts.tsx"]).toContain("export function ChartDashboard");
    expect(files["web/app/components/charts.tsx"]).toContain("selectChartPlacement");
    expect(files["web/app/components/charts.tsx"]).toContain("matchMedia");
    expect(files["web/app/components/charts.tsx"]).toContain("gridColumn");
    expect(files["web/app/components/charts.tsx"]).toContain('translate("qiy.chartView"');
    expect(files["web/app/components/charts.tsx"]).toContain("CanAccess");
    // Per-view data reuses the existing endpoints.
    expect(files["web/app/components/charts.tsx"]).toContain("/aggregate");
    expect(files["web/app/components/charts.tsx"]).toContain("/distribution");
    expect(files["web/app/components/charts.tsx"]).toContain("/trend");
    expect(files["web/app/data-provider.ts"]).toContain("(distribution|trend|aggregate)");
    // Generated tests: pure layout helpers + SSR render of all kinds/selectors.
    expect(files["web/tests/charts.test.ts"]).toContain("variant selection shrinks larger -> medium -> small");
    expect(files["web/tests/charts.test.ts"]).toContain("panel selection persists");
    expect(files["web/tests/charts-render.test.tsx"]).toContain("renders every chart kind with grid placements and selectors");
    expect(files["web/tests/model-i18n.test.ts"]).toContain("import { chartPanels, charts }");
    // Chart page replaces the default metric fallback metadata.
    expect(files["web/app/dashboard.ts"]).toContain("export const dashboardMetrics: DashboardMetric[] = []");
  });

  test("projects without charts keep the legacy metric dashboard", () => {
    const project = parseQiyProject(model(""));
    const files = generateWeb(project.database, project);
    expect(files["web/app/charts.ts"]).toContain("export const charts: ChartDefinition[] = []");
    expect(files["web/app/charts.ts"]).toContain("export const chartPanels: ChartPanelDefinition[] = []");
    expect(files["web/app/dashboard.ts"]).toContain('"resource": "users"');
    expect(files["web/app/routes/home.tsx"]).toContain("dashboardMetrics.map((metric)");
    expect(parseQiyProject(serializeQiyProject(project)).charts).toBeUndefined();
    const generated = generateProject(project.database, project.name, project);
    expect(generated["apps/web/tests/charts-render.test.tsx"]).toContain("renderToStaticMarkup");
  });
});
