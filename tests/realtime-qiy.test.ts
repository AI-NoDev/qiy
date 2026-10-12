import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const source = `qiy v0;
application realtime-admin {
  database sqlite {}
  api { client rest; }
  realtime {
    mode auto;
    resource orders {
      events created, updated, deleted;
      roles admin, operator;
    }
  }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable @listVisible(false) @showVisible(false) @formVisible(false);
    field role userRole;
  }
  entity orders {
    field id UUID @id;
    field number Text;
  }
}`;

describe("Qiy realtime", () => {
  test("round-trips role-scoped resource subscriptions", () => {
    const project = parseQiyProject(source);
    expect(project.realtime).toEqual({
      mode: "auto",
      resources: [{ resource: "orders", events: ["created", "updated", "deleted"], roles: ["admin", "operator"] }],
    });
    expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
  });

  test("generates Refine Ably and commit-after-transaction publication paths", () => {
    const project = parseQiyProject(source);
    const files = generateProject(project.database, project.name, { apiClient: project.apiClient, realtime: project.realtime, auth: project.auth });
    expect(JSON.parse(files["apps/web/package.json"]!).dependencies.ably).toBe("2.29.0");
    expect(JSON.parse(files["apps/server/package.json"]!).dependencies.ably).toBe("2.29.0");
    expect(files["apps/web/app/root.tsx"]).toContain("liveProvider={qiyLiveProvider}");
    expect(files["apps/web/app/resources.ts"]).toContain('"liveMode": "auto"');
    expect(files["apps/server/src/realtime.ts"]).toContain('["subscribe"]');
    expect(files["apps/server/src/realtime.ts"]).toContain("QIY_ABLY_API_KEY");
    expect(files["apps/server/src/realtime.ts"]).toContain("dispatchRealtimeOutbox");
    expect(files["apps/server/src/realtime.ts"]).toContain("startRealtimeOutboxWorker");
    expect(files["apps/server/src/schema.ts"]).toContain('qiy_realtime_outbox');
    expect(files["apps/server/src/schema.ts"]).toContain('leaseOwner');
    expect(files["apps/server/src/schema.ts"]).toContain('leaseUntil');
    expect(files["apps/server/src/schema.ts"]).toContain('deadLetteredAt');
    expect(files["apps/server/src/realtime.ts"]).toContain('QIY_REALTIME_LEASE_MS');
    expect(files["apps/server/tests/realtime.test.ts"]).toContain("rejects anonymous principals and roles without subscribed channels");
    expect(files["apps/server/tests/realtime.test.ts"]).toContain("keeps failed outbox records pending and retries them");
    expect(files["apps/server/tests/realtime.test.ts"]).toContain("claims an outbox record only once across concurrent workers");
    expect(files["apps/server/tests/realtime.test.ts"]).toContain("dead-letters exhausted events and restricts replay and cleanup to admins");
    expect(files["apps/server/src/realtime.ts"]).toContain('/outbox/metrics');
    expect(files["apps/server/src/realtime.ts"]).toContain('/outbox/metrics/prometheus');
    expect(files["apps/server/src/realtime.ts"]).toContain('/outbox/health');
    expect(files["apps/server/src/realtime.ts"]).toContain('qiy_realtime_outbox_oldest_pending_age_seconds');
    expect(files["apps/server/src/realtime.ts"]).toContain('QIY_REALTIME_ALERT_MAX_DEAD_LETTERED');
    expect(files["apps/server/src/realtime.ts"]).toContain('/outbox/replay');
    expect(files["apps/server/src/realtime-admin.ts"]).toContain("QIY_REALTIME_ADMIN_TOKEN is required");
    expect(files["apps/server/src/realtime-admin.ts"]).toContain('Authorization: `Bearer ${token}`');
    expect(files["apps/server/tests/realtime-admin.test.ts"]).toContain("routes replay and cleanup through authenticated audited HTTP endpoints");
    expect(files["apps/server/tests/realtime-admin.test.ts"]).toContain("reads health JSON and Prometheus text");
    expect(JSON.parse(files["apps/server/package.json"]!).scripts["realtime:admin"]).toBe("bun --env-file=.env.production src/realtime-admin.ts");
    expect(files["apps/server/src/realtime.ts"]).toContain('oldestPendingAt');
    expect(files["apps/server/tests/realtime-outbox-transaction.test.ts"]).toContain("commits CRUD records and realtime outbox rows atomically");
    expect(files["apps/server/tests/realtime.test.ts"]).toContain("Authentication required");
    expect(files["apps/server/tests/realtime.test.ts"]).toContain("Realtime subscription is not permitted");
    const service = files["apps/server/src/modules/orders/orders.service.ts"]!;
    const repository = files["apps/server/src/modules/orders/orders.repository.ts"]!;
    expect(repository).toContain("tx.insert(realtimeOutbox)");
    expect(repository.indexOf("tx.insert(orders)")).toBeLessThan(repository.indexOf("tx.insert(realtimeOutbox)"));
    expect(service.indexOf("await repository.create")).toBeLessThan(service.indexOf("await dispatchCommitted()"));
    expect(service.indexOf("await repository.update")).toBeLessThan(service.lastIndexOf("await dispatchCommitted()"));
    expect(files["apps/server/.env.production"]).toContain("QIY_ABLY_API_KEY=");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_POLL_MS=5000");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_LEASE_MS=30000");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_MAX_ATTEMPTS=10");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_RETENTION_DAYS=7");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_CLEANUP_MS=86400000");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_ADMIN_URL=");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_ADMIN_TOKEN=");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_METRICS_TOKEN=");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_ALERT_MAX_PENDING=1000");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_ALERT_MAX_DEAD_LETTERED=0");
    expect(files["apps/server/.env.production"]).toContain("QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS=300000");
    expect(files["apps/server/tests/setup.ts"]).toContain('QIY_REALTIME_DISABLED = "1"');
    expect(files["deploy/kubernetes/service.yaml"]).toContain("name: http");
    expect(files["deploy/kubernetes/realtime-servicemonitor.yaml"]).toContain("/api/v1/realtime/outbox/metrics/prometheus");
    expect(files["deploy/kubernetes/realtime-servicemonitor.yaml"]).toContain("key: QIY_REALTIME_METRICS_TOKEN");
    expect(files["deploy/kubernetes/deployment.yaml"]).toContain("name: QIY_REALTIME_METRICS_TOKEN");
    expect(files["deploy/kubernetes/secret.example.yaml"]).toContain("QIY_REALTIME_METRICS_TOKEN");
    expect(files["deploy/kubernetes/realtime-prometheusrule.yaml"]).toContain("QiyRealtimeOutboxDegraded");
    expect(files["deploy/kubernetes/realtime-prometheusrule.yaml"]).toContain("QiyRealtimeMetricsAbsent");
    expect(JSON.parse(files["deploy/observability/grafana/qiy-realtime-outbox.json"]!).title).toBe("Qiy Realtime Outbox");
    for (const dialect of ["postgresql", "mysql"] as const) {
      const lockedProject = parseQiyProject(source.replace("database sqlite", `database ${dialect}`));
      const lockedFiles = generateProject(lockedProject.database, lockedProject.name, { apiClient: lockedProject.apiClient, realtime: lockedProject.realtime, auth: lockedProject.auth });
      expect(lockedFiles["apps/server/src/realtime.ts"]).toContain('.for("update", { skipLocked: true })');
    }
  });

  test("fails closed for unknown resources, duplicate settings and unfinished GraphQL subscriptions", () => {
    const withoutAuth = source.replace(/\n  auth \{[^\n]+\}/, "");
    expect(() => parseQiyProject(withoutAuth)).toThrow("Realtime requires generated authentication");
    const parsed = parseQiyProject(source);
    expect(() => generateProject(parsed.database, parsed.name, { realtime: parsed.realtime })).toThrow("Realtime requires generated authentication");
    expect(() => serializeQiyProject({ ...parsed, auth: undefined })).toThrow("Realtime requires generated authentication");
    expect(() => parseQiyProject(source.replace("resource orders", "resource missing"))).toThrow("Realtime: unknown resource missing");
    expect(() => parseQiyProject(source.replace("created, updated, deleted", "created, created"))).toThrow("duplicate event created");
    expect(() => parseQiyProject(source.replace("roles admin, operator", "roles admin, owner"))).toThrow("unsupported role owner");
    const graphql = parseQiyProject(source.replace("client rest", "client graphql"));
    expect(() => generateProject(graphql.database, graphql.name, { apiClient: graphql.apiClient, realtime: graphql.realtime, auth: graphql.auth })).toThrow("GraphQL realtime subscriptions are not implemented yet");
  });

  test("queues Dataflow emit events for durable realtime delivery", () => {
    const project = parseQiyProject(`qiy v0; application realtime-dataflow {
      database sqlite {}
      api { client rest; }
      realtime { mode auto; resource orders { events updated; roles admin, operator; } }
      auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
      enum userRole { value admin; value operator; value viewer; }
      entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable @listVisible(false) @showVisible(false) @formVisible(false); field role userRole; }
      entity orders { field id UUID @id; field status Text; }
      dataflow approveOrder {
        allow roles admin, operator;
        input { field orderId UUID @required; }
        context { order = entity orders by id input.orderId @required; }
        step approve { update order { status = "approved"; } emit "order.approved" { orderId = order.id; status = order.status; } }
        result { return order; }
      }
    }`);
    const files = generateProject(project.database, project.name, { apiClient: project.apiClient, realtime: project.realtime, dataflows: project.dataflows, actions: project.actions, scopes: project.scopes, auth: project.auth });
    expect(files["apps/server/src/dataflows/index.ts"]).toContain("tx.insert(realtimeOutbox)");
    expect(files["apps/server/src/dataflows/index.ts"]).toContain('channel: "qiy:event:order.approved"');
    expect(files["apps/server/src/realtime.ts"]).toContain('"event":"order.approved","roles":["admin","operator"]');
    expect(files["apps/server/tests/dataflow.test.ts"]).toContain("CREATE TABLE IF NOT EXISTS qiy_realtime_outbox");
  });
});
