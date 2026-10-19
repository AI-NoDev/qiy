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
    // The live provider scopes show/many pages to their own record ids.
    expect(files["apps/web/app/providers/live-provider.ts"]).toContain("export function createQiyLiveProvider(fetcher: typeof fetch = fetch, injected?: Ably.Realtime)");
    expect(files["apps/web/app/providers/live-provider.ts"]).toContain("const scopedIds = [params?.id, ...(Array.isArray(params?.ids) ? params.ids : [])]");
    expect(files["apps/web/tests/live-provider.test.ts"]).toContain("scopes record subscriptions to the requested ids");
    expect(files["apps/server/src/realtime.ts"]).toContain('["subscribe"]');
    // Capability arrays are explicitly typed, and the database store is exported for
    // tests and operations; an empty list must not degrade to readonly never[].
    expect(files["apps/server/src/realtime.ts"]).toContain("export const qiyRealtimeSubscriptions: readonly QiyRealtimeSubscription[] =");
    expect(files["apps/server/src/realtime.ts"]).toContain("export const qiyRealtimeEventSubscriptions: readonly QiyRealtimeEventSubscription[] =");
    expect(files["apps/server/src/realtime.ts"]).toContain("export const databaseOutboxStore: RealtimeOutboxStore =");
    expect(files["apps/server/src/realtime.ts"]).toContain("export interface QiyRealtimeSubscription { resource: string; events: string[]; roles: string[]; claim?: { field: string; claim: string } }");
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

  test("fails closed for unknown resources and duplicate settings, and supports GraphQL subscriptions", () => {
    const withoutAuth = source.replace(/\n  auth \{[^\n]+\}/, "");
    expect(() => parseQiyProject(withoutAuth)).toThrow("Realtime requires generated authentication");
    const parsed = parseQiyProject(source);
    expect(() => generateProject(parsed.database, parsed.name, { realtime: parsed.realtime })).toThrow("Realtime requires generated authentication");
    expect(() => serializeQiyProject({ ...parsed, auth: undefined })).toThrow("Realtime requires generated authentication");
    expect(() => parseQiyProject(source.replace("resource orders", "resource missing"))).toThrow("Realtime: unknown resource missing");
    expect(() => parseQiyProject(source.replace("created, updated, deleted", "created, created"))).toThrow("duplicate event created");
    expect(() => parseQiyProject(source.replace("roles admin, operator", "roles owner"))).toThrow("unsupported role owner");
    // GraphQL apps keep Ably for live updates and gain the SSE subscription transport.
    const graphql = parseQiyProject(source.replace("client rest", "client graphql"));
    const files = generateProject(graphql.database, graphql.name, { apiClient: graphql.apiClient, realtime: graphql.realtime, auth: graphql.auth });
    expect(files["apps/server/src/graphql.ts"]).toContain("type Subscription {");
    expect(files["apps/server/src/graphql.ts"]).toContain('.get("/subscribe"');
    expect(files["apps/server/src/realtime-bus.ts"]).toContain("export function realtimeEventIterator");
    // The web client half is generated only for GraphQL apps with realtime.
    expect(files["apps/web/app/subscriptions.ts"]).toContain("export function subscribeGraphql");
    expect(files["apps/web/tests/subscriptions.test.ts"]).toContain("parses SSE frames split across chunks");
    // Subscriptions tail the outbox so events from other replicas are delivered too.
    expect(files["apps/server/src/realtime.ts"]).toContain("export function realtimeChannelIterator");
    expect(files["apps/server/src/realtime.ts"]).toContain("QIY_REALTIME_SUBSCRIBE_POLL_MS");
    expect(files["apps/server/src/graphql.ts"]).toContain('import { realtimeChannelIterator } from "./realtime";');
    expect(files["apps/server/src/graphql.ts"]).toContain("const events = realtimeChannelIterator(channel);");
    const restRealtime = generateProject(parsed.database, parsed.name, { apiClient: parsed.apiClient, realtime: parsed.realtime, auth: parsed.auth });
    expect(restRealtime["apps/web/app/subscriptions.ts"]).toBeUndefined();
  });

  test("types empty realtime capability lists so generated servers still compile", () => {
    // A realtime app without any Dataflow emit has no event subscriptions at all.
    const project = parseQiyProject(`qiy v0; application realtime-empty {
      database sqlite {}
      realtime { mode auto; resource orders { events created; roles admin; } }
      auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
      enum userRole { value admin; value operator; value viewer; }
      entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role userRole; }
      entity orders { field id UUID @id; field status Text; }
    }`);
    const files = generateProject(project.database, project.name, { apiClient: project.apiClient, realtime: project.realtime, auth: project.auth });
    const realtime = files["apps/server/src/realtime.ts"]!;
    expect(realtime).toContain("export const qiyRealtimeEventSubscriptions: readonly QiyRealtimeEventSubscription[] = [];");
    expect(realtime).not.toContain("] as const;");
    expect(files["apps/server/src/realtime.ts"]).toContain("export const qiyRealtimeSubscriptions: readonly QiyRealtimeSubscription[] = ");
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

  test("keeps masked fields out of published payloads and refuses row predicates", () => {
    const source = (restriction: string) => parseQiyProject(`qiy v0; application realtime-policy {
      database sqlite {}
      api { client rest; }
      realtime { mode auto; resource orders { events created, updated, deleted; roles operator; } }
      auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
      enum userRole { value admin; value operator; value viewer; }
      entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role userRole; }
      entity orders { field id UUID @id; field title Text; field salary Integer @nullable; field secret Text @nullable; field tenantId Text; }
      ${restriction}
    }`);
    const generate = (project: ReturnType<typeof parseQiyProject>) => generateProject(project.database, project.name, { apiClient: project.apiClient, realtime: project.realtime, auth: project.auth, restrictions: project.restrictions });

    // salary is masked for operator, which can subscribe; secret is masked for admin, which cannot.
    const masked = generate(source("restrict orders { mask salary roles operator mode omit; mask secret roles admin mode omit; }"));
    const repository = masked["apps/server/src/modules/orders/orders.repository.ts"]!;
    expect(repository).toContain("function qiyRealtimePayload(record: Record<string, unknown>)");
    expect(repository).toContain('for (const field of ["salary"]) delete safe[field];');
    expect(repository).toContain("payload: JSON.stringify(qiyRealtimePayload(record))");
    expect(repository).not.toContain('delete safe["secret"]');
    // Without any mask for a subscriber the payload stays untouched.
    const plain = generate(source(""));
    expect(plain["apps/server/src/modules/orders/orders.repository.ts"]).not.toContain("qiyRealtimePayload");
    // A row predicate cannot be scoped per subscriber, so generation fails closed.
    expect(() => generate(source("restrict orders { when tenantId claim tenant; }"))).toThrow("restrict row predicates cannot be enforced on a shared channel");
  });

  test("round-trips claim-scoped channels and publishes per segment", () => {
    const claimed = parseQiyProject(`qiy v0; application realtime-claim {
      database sqlite {}
      api { client rest; }
      realtime { mode auto; resource orders { events created; roles admin, operator; when tenantId claim tenant; } }
      auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
      enum userRole { value admin; value operator; value viewer; }
      entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role userRole; }
      entity orders { field id UUID @id; field title Text; field tenantId Text; }
    }`);
    expect(claimed.realtime?.resources[0]).toEqual({ resource: "orders", events: ["created"], roles: ["admin", "operator"], claim: { field: "tenantId", claim: "tenant" } });
    expect(parseQiyProject(serializeQiyProject(claimed))).toEqual(claimed);
    expect(serializeQiyProject(claimed)).toContain("when tenantId claim tenant;");

    const files = generateProject(claimed.database, claimed.name, { apiClient: claimed.apiClient, realtime: claimed.realtime, auth: claimed.auth });
    const realtime = files["apps/server/src/realtime.ts"]!;
    expect(realtime).toContain("export function realtimeChannel(resource: string, claimValue?: string | number | null)");
    // The outbox row carries the segment so the dispatcher publishes per tenant.
    const repository = files["apps/server/src/modules/orders/orders.repository.ts"]!;
    expect(repository).toContain('"qiy:orders:" + String(');
    // The browser resolves the granted segment from the token capability.
    expect(files["apps/web/app/providers/live-provider.ts"]).toContain("function grantedChannel(capabilities: QiyCapabilityMap, resource: string)");

    // Fail closed on declarations that cannot build a stable segment.
    const nullableClaim = parseQiyProject(serializeQiyProject(claimed).replace("field tenantId Text;", "field tenantId Text @nullable;"));
    expect(() => generateProject(nullableClaim.database, nullableClaim.name, { realtime: nullableClaim.realtime, auth: nullableClaim.auth })).toThrow("claim field tenantId must be non-nullable");
    const unknownClaim = parseQiyProject(serializeQiyProject(claimed).replace("when tenantId claim tenant;", "when missing claim tenant;"));
    expect(() => generateProject(unknownClaim.database, unknownClaim.name, { realtime: unknownClaim.realtime, auth: unknownClaim.auth })).toThrow("unknown claim field missing");
  });
});
