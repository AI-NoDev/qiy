import { describe, expect, test } from "bun:test";
import { cronPrincipalId, deliveryTargetsByEvent, eventPayloadKeys, renderDeliveryInsert, validateCronDataflows } from "../tools/delivery";
import { generateProject, projectGenerationOptions } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const flow = `dataflow closeOrder {
    allow roles admin;
    idempotency required;
    input { field orderId UUID @required; }
    context { order = entity orders by id input.orderId @required; }
    step close {
      update order { status = "closed"; }
      emit "order.closed" { orderId = input.orderId; email = order.email; }
    }
    result { return order; }
  }`;
const digest = `dataflow nightlyDigest {
    allow roles admin;
    idempotency required;
    input { }
    context { }
    step post { create note = entity notes { title = "Digest"; } }
    result { return note; }
  }`;
const webhook = `webhook orderFeed { event "order.closed"; url env ORDER_WEBHOOK_URL; secret env ORDER_WEBHOOK_SECRET; }`;
const notification = `notification orderClosedMail { event "order.closed"; to "ops@example.com", payload.email; subject "Order {orderId} closed"; body "Hi, order {orderId} is closed."; }`;
const settings = `notifications { provider resend; from "Shop <shop@example.com>"; }`;
const cron = `elysia { cron { job digest pattern "0 2 * * *" dataflow nightlyDigest; } }`;

const app = (body: string, config = settings) => `qiy v0;
application delivery-demo {
  database sqlite {}
  ${config}
  entity orders { field id UUID @id; field email Email @nullable; field status Text; }
  entity notes { field id UUID @id; field title Text; field revision Integer @version; field pinned Boolean @default(false); }
  ${body}
}`;

describe("Qiy webhooks, notifications and scheduled dataflows", () => {
  test("parses, round-trips and keeps payload recipients and template keys", () => {
    const project = parseQiyProject(app(`${flow} ${webhook} ${notification}`));
    expect(project.notificationSettings).toEqual({ provider: "resend", from: "Shop <shop@example.com>" });
    expect(project.webhooks).toEqual([{ name: "orderFeed", events: ["order.closed"], urlEnv: "ORDER_WEBHOOK_URL", secretEnv: "ORDER_WEBHOOK_SECRET" }]);
    expect(project.notifications).toEqual([{
      name: "orderClosedMail", event: "order.closed",
      to: [{ kind: "address", address: "ops@example.com" }, { kind: "payload", field: "email" }],
      subject: "Order {orderId} closed", body: "Hi, order {orderId} is closed.",
    }]);
    const again = parseQiyProject(serializeQiyProject(project));
    expect(again.webhooks).toEqual(project.webhooks);
    expect(again.notifications).toEqual(project.notifications);
    expect(again.notificationSettings).toEqual(project.notificationSettings);
  });

  test("routes every emitted event to its subscribed targets", () => {
    const project = parseQiyProject(app(`${flow} ${webhook} ${notification}`));
    expect(eventPayloadKeys("order.closed", project.dataflows!)).toEqual(["flow", "orderId", "email"]);
    expect(eventPayloadKeys("order.opened", project.dataflows!)).toBeUndefined();
    expect([...deliveryTargetsByEvent(project.webhooks, project.notifications)]).toEqual([["order.closed", ["webhook:orderFeed", "notification:orderClosedMail"]]]);
    expect(renderDeliveryInsert("sqlite", ["webhook:orderFeed"], "order.closed", "payload")).toContain(".run();");
    expect(renderDeliveryInsert("postgresql", ["webhook:orderFeed"], "order.closed", "payload")).toContain("await tx.insert(qiyDeliveries)");
  });

  test("generates the delivery worker, outbox rows and environment for subscribed events", () => {
    const project = parseQiyProject(app(`${flow} ${webhook} ${notification}`));
    const files = generateProject(project.database, project.name, projectGenerationOptions(project));
    expect(files["apps/server/src/delivery/index.ts"]).toContain("startDeliveryWorker");
    expect(files["apps/server/tests/delivery.test.ts"]).toBeDefined();
    expect(files["apps/server/src/schema.ts"]).toContain('"qiy_deliveries"');
    expect(files["apps/server/src/server.ts"]).toContain("startDeliveryWorker");
    const routes = Object.entries(files).find(([path, content]) => path.startsWith("apps/server/src/") && content.includes('"notification:orderClosedMail"') && content.includes("tx.insert(qiyDeliveries)"));
    expect(routes).toBeDefined();
    const env = files["apps/server/.env.example"] ?? files[".env.example"] ?? "";
    for (const name of ["ORDER_WEBHOOK_URL", "ORDER_WEBHOOK_SECRET", "QIY_NOTIFY_PROVIDER"]) expect(env, name).toContain(name);
  });

  test("skips the worker when nothing subscribes", () => {
    const project = parseQiyProject(app(flow, ""));
    const files = generateProject(project.database, project.name, projectGenerationOptions(project));
    expect(files["apps/server/src/delivery/index.ts"]).toBeUndefined();
    expect(files["apps/server/src/schema.ts"]).not.toContain("qiy_deliveries");
  });

  test("rejects deliveries that could never send", () => {
    const fails = (body: string, config?: string) => expect(() => parseQiyProject(app(`${flow} ${body}`, config)));
    fails(`${webhook} ${webhook}`).toThrow("Duplicate webhook orderFeed");
    fails(webhook.replace('"order.closed"', '"order.lost"')).toThrow('no dataflow or statemachine emits "order.lost"');
    fails(webhook.replace("ORDER_WEBHOOK_URL", "VITE_ORDER_URL")).toThrow("drop the VITE_ prefix");
    fails(webhook.replace("ORDER_WEBHOOK_SECRET", "ORDER_WEBHOOK_URL")).toThrow("different environment variables");
    fails(notification, "").toThrow("requires a notifications { provider");
    fails(webhook).toThrow("The notifications block has no notification declarations");
    fails(notification, settings.replace("Shop <shop@example.com>", "shop")).toThrow("notifications from must be an address");
    fails(notification.replace('"ops@example.com"', '"ops"')).toThrow("ops is not an email address");
    fails(notification.replace("payload.email", "payload.phone")).toThrow('payload.phone is not in every "order.closed" payload');
    fails(notification.replace("Order {orderId}", "Order {total}")).toThrow("subject placeholder {total}");
  });

  test("schedules a dataflow and fills omitted defaults on create", () => {
    const project = parseQiyProject(app(`${flow} ${digest}`, cron));
    expect(project.elysiaPlugins?.cron).toEqual([{ name: "digest", pattern: "0 2 * * *", dataflow: "nightlyDigest" }]);
    expect(parseQiyProject(serializeQiyProject(project)).elysiaPlugins?.cron).toEqual(project.elysiaPlugins?.cron);
    const files = generateProject(project.database, project.name, projectGenerationOptions(project));
    expect(files["apps/server/src/jobs/scheduled.ts"]).toContain(cronPrincipalId("digest"));
    expect(files["apps/server/src/jobs/lease.ts"]).toContain("claimJobTick");
    expect(files["apps/server/src/schema.ts"]).toContain('"qiy_job_leases"');
    expect(cronPrincipalId("digest")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(cronPrincipalId("digest")).toBe(cronPrincipalId("digest"));
  });

  test("rejects scheduled dataflows a caller-less run cannot satisfy", () => {
    const fails = (body: string) => expect(() => parseQiyProject(app(`${flow} ${body}`, cron)));
    fails(digest.replace("nightlyDigest", "other")).toThrow("unknown dataflow nightlyDigest");
    fails(digest.replace("input { }", "input { field day Text @required; }")).toThrow("requires input day");
    fails(digest.replace("allow roles admin;", "allow roles operator;")).toThrow("must allow a full-access role (admin)");
    const project = parseQiyProject(app(`${flow} ${digest}`, cron));
    const scheduled = project.dataflows!.find((candidate) => candidate.name === "nightlyDigest")!;
    const check = (changes: object, scopes: NonNullable<typeof project.scopes> = []) => () => validateCronDataflows(project.elysiaPlugins!.cron!, [{ ...scheduled, ...changes }], project.database.entities, scopes);
    expect(check({ roles: undefined, permission: "DigestPermission" })).toThrow("uses allow permission");
    expect(check({ roles: undefined, verification: "CanDigest" })).toThrow("uses allow verification");
    expect(check({}, [{ resource: "notes" } as NonNullable<typeof project.scopes>[number]])).toThrow("uses scoped resource notes");
    expect(check({})).not.toThrow();
  });
});
