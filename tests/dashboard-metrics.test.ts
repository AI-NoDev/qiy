import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const model = (metric: string) => `qiy v0; application dashboard-metrics {
  database sqlite {}
  entity orders {
    field id UUID @id;
    field title Text;
    field amount Integer;
  }
  dashboard {
    metric ${metric};
  }
}`;

describe("dashboard aggregate metrics", () => {
  test("round-trips aggregate annotations and generates the read path", () => {
    const project = parseQiyProject(model('orderTotal orders @label("Total") @type(aggregate) @field(amount) @agg(sum)'));
    expect(project.dashboardMetrics).toEqual([{ name: "orderTotal", resource: "orders", label: "Total", span: 8, type: "aggregate", field: "amount", agg: "sum" }]);
    expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);

    const files = generateProject(project.database, project.name, { dashboardMetrics: project.dashboardMetrics });
    const route = files["apps/server/src/modules/orders/orders.routes.ts"]!;
    expect(route).toContain('.get("/aggregate"');
    expect(route).toContain('"Unsupported aggregate operator"');
    // The repository aggregates in SQL, not in memory.
    const repository = files["apps/server/src/modules/orders/orders.repository.ts"]!;
    expect(repository).toContain("async aggregate(field, operator, scope)");
    expect(repository).toContain("sum(column)");
    expect(repository).toContain("avg(column)");
    expect(files["apps/server/src/graphql.ts"]).toContain("ordersAggregate(field: String!, op: String!): Float");
    expect(files["apps/web/app/dashboard.ts"]).toContain('"type": "aggregate"');
    expect(files["apps/web/app/routes/home.tsx"]).toContain("function AggregateSummary");
    expect(files["apps/web/app/routes/home.tsx"]).toContain("/aggregate");
  });

  test("rejects invalid aggregate declarations", () => {
    expect(() => parseQiyProject(model('orderTotal orders @type(aggregate) @field(amount) @agg(median)'))).toThrow("agg must be sum, avg, min or max");
    expect(() => parseQiyProject(model('orderTotal orders @type(total)'))).toThrow("type must be count, distribution, trend or aggregate");
    // field/agg only make sense for aggregate metrics.
    const missingField = parseQiyProject(model("orderTotal orders @type(aggregate) @agg(sum)"));
    expect(() => generateProject(missingField.database, missingField.name, { dashboardMetrics: missingField.dashboardMetrics })).toThrow("aggregate requires a numeric field");
    const textField = parseQiyProject(model("orderTotal orders @type(aggregate) @field(title) @agg(sum)"));
    expect(() => generateProject(textField.database, textField.name, { dashboardMetrics: textField.dashboardMetrics })).toThrow("aggregate requires a numeric field");
    const leaky = parseQiyProject(model("orderTotal orders @field(amount)"));
    expect(() => generateProject(leaky.database, leaky.name, { dashboardMetrics: leaky.dashboardMetrics })).toThrow("field and agg require aggregate type");
  });
});
