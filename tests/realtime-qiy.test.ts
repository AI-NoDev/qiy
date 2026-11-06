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

  test("generates the self-hosted SSE transport and commit-after-transaction publication paths", () => {
    const project = parseQiyProject(source);
    const files = generateProject(project.database, project.name, { apiClient: project.apiClient, realtime: project.realtime, auth: project.auth });
    expect(JSON.parse(files["apps/web/package.json"]!).dependencies.ably).toBeUndefined();
    expect(JSON.parse(files["apps/server/package.json"]!).dependencies.ably).toBeUndefined();
    expect(files["apps/web/app/root.tsx"]).toContain("liveProvider={qiyLiveProvider}");
    expect(files["apps/web/app/resources.ts"]).toContain('"liveMode": "auto"');
    const live = files["apps/web/app/providers/live-provider.ts"]!;
    expect(live).toContain("export function createQiyLiveProvider(options: QiyLiveProviderOptions = {}): LiveProvider | undefined");
    expect(live).toContain("/api/v1/realtime/stream");
    expect(files["apps/web/tests/live-provider.test.ts"]).toContain("shares one stream and scopes record subscriptions to the requested ids");
    const realtime = files["apps/server/src/realtime.ts"]!;
    expect(realtime).toContain("export const qiyRealtimeSubscriptions: readonly QiyRealtimeSubscription[] =");
    expect(realtime).toContain("export const qiyRealtimeEventSubscriptions: readonly QiyRealtimeEventSubscription[] =");
    expect(realtime).toContain("export interface QiyRealtimeSubscription { resource: string; events: string[]; roles: string[]; claim?: { field: string; claim: string } }");
    expect(realtime).toContain('.get("/stream"');
    expect(realtime).toContain("export function pollRealtimeOutbox(): Promise<void>");
    expect(realtime).toContain("export function realtimeChannelIterator");
    expect(realtime).toContain("export function startRealtimeOutboxCleanup");
    for (const removed of ["QIY_ABLY_API_KEY", "dispatchRealtimeOutbox", "/outbox/metrics", "/outbox/replay", "QIY_REALTIME_LEASE_MS"]) expect(realtime).not.toContain(removed);
    const schema = files["apps/server/src/schema.ts"]!;
    expect(schema).toContain("qiy_realtime_outbox");
    expect(schema).toContain("qiy_realtime_outbox_created_idx");
    const outboxTable = schema.slice(schema.indexOf('"qiy_realtime_outbox"'), schema.indexOf("qiy_realtime_outbox_created_idx"));
    for (const removed of ["leaseOwner", "leaseUntil", "deadLetteredAt", "attempts"]) expect(outboxTable).not.toContain(removed);
    const tests = files["apps/server/tests/realtime.test.ts"]!;
    expect(tests).toContain("rejects anonymous callers, roles without channels and a disabled transport");
    expect(tests).toContain("streams only the channels granted to the caller");
    expect(tests).toContain("computes the outbox cleanup cutoff from the retention window");
    expect(files["apps/server/src/realtime-admin.ts"]).toBeUndefined();
    expect(JSON.parse(files["apps/server/package.json"]!).scripts["realtime:admin"]).toBeUndefined();
    expect(files["apps/server/tests/realtime-outbox-transaction.test.ts"]).toContain("commits CRUD records and realtime outbox rows atomically");
    const service = files["apps/server/src/modules/orders/orders.service.ts"]!;
    const repository = files["apps/server/src/modules/orders/orders.repository.ts"]!;
    expect(repository).toContain("tx.insert(realtimeOutbox)");
    expect(repository.indexOf("tx.insert(orders)")).toBeLessThan(repository.indexOf("tx.insert(realtimeOutbox)"));
    expect(service.indexOf("await repository.create")).toBeLessThan(service.indexOf("await dispatchCommitted()"));
    expect(service.indexOf("await repository.update")).toBeLessThan(service.lastIndexOf("await dispatchCommitted()"));
    const environment = files["apps/server/.env.production"]!;
    for (const key of ["QIY_REALTIME_POLL_MS=1000", "QIY_REALTIME_RETENTION_DAYS=1", "QIY_REALTIME_CLEANUP_MS=3600000"]) expect(environment).toContain(key);
    for (const removed of ["QIY_ABLY_API_KEY", "QIY_REALTIME_ADMIN_TOKEN", "QIY_REALTIME_METRICS_TOKEN"]) expect(environment).not.toContain(removed);
    expect(files["apps/server/tests/setup.ts"]).toContain('QIY_REALTIME_DISABLED = "1"');
    expect(files["deploy/kubernetes/service.yaml"]).toContain("name: http");
    expect(files["deploy/kubernetes/realtime-servicemonitor.yaml"]).toBeUndefined();
    expect(files["deploy/observability/grafana/qiy-realtime-outbox.json"]).toBeUndefined();
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
    // GraphQL apps share the outbox tail with the REST stream.
    const graphql = parseQiyProject(source.replace("client rest", "client graphql"));
    const files = generateProject(graphql.database, graphql.name, { apiClient: graphql.apiClient, realtime: graphql.realtime, auth: graphql.auth });
    expect(files["apps/server/src/graphql.ts"]).toContain("type Subscription {");
    expect(files["apps/server/src/graphql.ts"]).toContain('.get("/subscribe"');
    // The web client half is generated only for GraphQL apps with realtime.
    expect(files["apps/web/app/subscriptions.ts"]).toContain("export function subscribeGraphql");
    expect(files["apps/web/tests/subscriptions.test.ts"]).toContain("parses SSE frames split across chunks");
    // Subscriptions tail the outbox so events from other replicas are delivered too.
    expect(files["apps/server/src/realtime.ts"]).toContain("export function realtimeChannelIterator");
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

    // Fail closed on declarations that cannot build a stable segment.
    const nullableClaim = parseQiyProject(serializeQiyProject(claimed).replace("field tenantId Text;", "field tenantId Text @nullable;"));
    expect(() => generateProject(nullableClaim.database, nullableClaim.name, { realtime: nullableClaim.realtime, auth: nullableClaim.auth })).toThrow("claim field tenantId must be non-nullable");
    const unknownClaim = parseQiyProject(serializeQiyProject(claimed).replace("when tenantId claim tenant;", "when missing claim tenant;"));
    expect(() => generateProject(unknownClaim.database, unknownClaim.name, { realtime: unknownClaim.realtime, auth: unknownClaim.auth })).toThrow("unknown claim field missing");
  });
});
