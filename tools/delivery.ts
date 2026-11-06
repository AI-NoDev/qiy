import { createHash } from "node:crypto";
import type { DatabaseIR, EntityIR } from "./database-ir";
import type { DataflowIR, QiyProject } from "./qiy-project";
import { fullAccessRoles, type QiyRoleDeclaration } from "./roles";

/**
 * Webhooks, notifications and scheduled dataflows. Emitted events are the only
 * trigger: a dataflow `emit` writes one `qiy_deliveries` row per subscribed
 * webhook/notification inside its transaction, and a background worker delivers
 * those rows after commit with retries.
 */

export type QiyNotificationProvider = "smtp" | "resend" | "webhook" | "console";
export const NOTIFICATION_PROVIDERS: readonly QiyNotificationProvider[] = ["smtp", "resend", "webhook", "console"];

export interface QiyNotificationSettings {
  provider: QiyNotificationProvider;
  from: string;
}

export interface QiyWebhook {
  name: string;
  events: string[];
  urlEnv: string;
  secretEnv: string;
}

export type QiyNotificationRecipient = { kind: "address"; address: string } | { kind: "payload"; field: string };

export interface QiyNotification {
  name: string;
  event: string;
  to: QiyNotificationRecipient[];
  subject: string;
  subjectKey?: string;
  body: string;
  bodyKey?: string;
}

export type QiyCronJob =
  | { name: string; pattern: string; task: "cleanupMissingAttachments" }
  | { name: string; pattern: string; dataflow: string };

export const DELIVERY_MAX_ATTEMPTS = 8;

const placeholderPattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const addressPattern = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const fromPattern = /^(?:[^<>@\r\n]+<[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+>|[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+)$/;
const envNamePattern = /^[A-Z_][A-Z0-9_]*$/;

export function isDataflowCronJob(job: QiyCronJob): job is Extract<QiyCronJob, { dataflow: string }> {
  return "dataflow" in job;
}

/** Payload keys every emit of `event` carries (`flow` is always present). */
export function eventPayloadKeys(event: string, dataflows: readonly DataflowIR[]): string[] | undefined {
  let keys: string[] | undefined;
  for (const flow of dataflows) for (const step of flow.steps) for (const action of step.actions) {
    if (action.kind !== "emit" || action.event !== event) continue;
    const emitted = ["flow", ...(action.payload ?? []).map((value) => value.name)];
    keys = keys ? keys.filter((key) => emitted.includes(key)) : emitted;
  }
  return keys;
}

export function deliveryTargetsByEvent(webhooks: readonly QiyWebhook[] = [], notifications: readonly QiyNotification[] = []): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  const add = (event: string, target: string) => targets.set(event, [...(targets.get(event) ?? []), target]);
  for (const webhook of webhooks) for (const event of webhook.events) add(event, `webhook:${webhook.name}`);
  for (const notification of notifications) add(notification.event, `notification:${notification.name}`);
  return targets;
}

export function usesDeliveries(options: Pick<QiyProject, "webhooks" | "notifications">): boolean {
  return Boolean(options.webhooks?.length || options.notifications?.length);
}

export function validateDeliveries(project: Pick<QiyProject, "webhooks" | "notifications" | "notificationSettings">, dataflows: readonly DataflowIR[]): void {
  const webhooks = project.webhooks ?? [];
  const notifications = project.notifications ?? [];
  const seen = new Set<string>();
  for (const webhook of webhooks) {
    if (seen.has(`webhook:${webhook.name}`)) throw new Error(`Duplicate webhook ${webhook.name}`);
    seen.add(`webhook:${webhook.name}`);
    if (!webhook.events.length) throw new Error(`Webhook ${webhook.name}: event requires at least one event name`);
    if (new Set(webhook.events).size !== webhook.events.length) throw new Error(`Webhook ${webhook.name}: duplicate event`);
    for (const event of webhook.events) {
      if (!eventPayloadKeys(event, dataflows)) throw new Error(`Webhook ${webhook.name}: no dataflow or statemachine emits "${event}"`);
    }
    for (const name of [webhook.urlEnv, webhook.secretEnv]) {
      if (!envNamePattern.test(name)) throw new Error(`Webhook ${webhook.name}: ${name} must be an uppercase environment variable name`);
      if (name.startsWith("VITE_")) throw new Error(`Webhook ${webhook.name}: ${name} would be exposed to the browser; drop the VITE_ prefix`);
    }
    if (webhook.urlEnv === webhook.secretEnv) throw new Error(`Webhook ${webhook.name}: url and secret need different environment variables`);
  }
  if (notifications.length && !project.notificationSettings) throw new Error(`Notification ${notifications[0]!.name} requires a notifications { provider ...; from "..."; } block`);
  if (project.notificationSettings && !notifications.length) throw new Error("The notifications block has no notification declarations; remove it or declare a notification");
  if (project.notificationSettings && !fromPattern.test(project.notificationSettings.from)) throw new Error(`notifications from must be an address or "Name <address>", got ${project.notificationSettings.from}`);
  for (const notification of notifications) {
    if (seen.has(`notification:${notification.name}`)) throw new Error(`Duplicate notification ${notification.name}`);
    seen.add(`notification:${notification.name}`);
    const keys = eventPayloadKeys(notification.event, dataflows);
    if (!keys) throw new Error(`Notification ${notification.name}: no dataflow or statemachine emits "${notification.event}"`);
    if (!notification.to.length) throw new Error(`Notification ${notification.name}: to requires at least one recipient`);
    for (const recipient of notification.to) {
      if (recipient.kind === "address" && !addressPattern.test(recipient.address)) throw new Error(`Notification ${notification.name}: ${recipient.address} is not an email address`);
      if (recipient.kind === "payload" && !keys.includes(recipient.field)) throw new Error(`Notification ${notification.name}: payload.${recipient.field} is not in every "${notification.event}" payload (${keys.join(", ")})`);
    }
    for (const [part, text] of [["subject", notification.subject], ["body", notification.body]] as const) {
      if (!text.trim()) throw new Error(`Notification ${notification.name}: ${part} cannot be empty`);
      for (const [, key] of text.matchAll(placeholderPattern)) {
        if (!keys.includes(key!)) throw new Error(`Notification ${notification.name}: ${part} placeholder {${key}} is not in every "${notification.event}" payload (${keys.join(", ")})`);
      }
    }
  }
}

function entityTouches(flow: DataflowIR): string[] {
  return [...new Set([
    ...flow.context.map((binding) => binding.entity),
    ...flow.steps.flatMap((step) => step.actions.flatMap((action) => action.kind === "create" ? [action.entity] : [])),
  ])];
}

/** A scheduled run has no caller: no input, no claims, and the first full-access role. */
export function validateCronDataflows(jobs: readonly QiyCronJob[], dataflows: readonly DataflowIR[], entities: readonly EntityIR[], scopes: NonNullable<QiyProject["scopes"]>, auth?: { roles?: readonly QiyRoleDeclaration[] }): void {
  const fullRoles = fullAccessRoles(auth);
  for (const job of jobs) {
    if (!isDataflowCronJob(job)) continue;
    const flow = dataflows.find((candidate) => candidate.name === job.dataflow);
    const where = `Cron job ${job.name}: dataflow ${job.dataflow}`;
    if (!flow) throw new Error(`Cron job ${job.name}: unknown dataflow ${job.dataflow}`);
    const required = flow.input.find((field) => field.required);
    if (required) throw new Error(`${where} requires input ${required.name}; scheduled runs send no input`);
    if (flow.permission || flow.verification) throw new Error(`${where} uses allow ${flow.permission ? "permission" : "verification"}, which a scheduled run cannot satisfy; use allow roles`);
    if (flow.roles && !flow.roles.some((role) => fullRoles.includes(role))) throw new Error(`${where} must allow a full-access role (${fullRoles.join(", ")}); scheduled runs use ${fullRoles[0]}`);
    for (const name of entityTouches(flow)) {
      const entity = entities.find((candidate) => candidate.name === name);
      const scoped = scopes.some((scope) => scope.resource === name || scope.resource === entity?.tableName) || entity?.fields.some((field) => field.tenantClaim !== undefined);
      if (scoped) throw new Error(`${where} uses scoped resource ${name}; scheduled runs carry no data scope claims`);
    }
  }
}

/** Deterministic actor id for a job so its audit rows stay attributable across restarts. */
export function cronPrincipalId(job: string): string {
  const hex = createHash("sha256").update(`qiy-cron:${job}`).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type Dialect = DatabaseIR["dialect"];

function tableFactory(dialect: Dialect): string {
  return dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
}

function stringColumn(dialect: Dialect, name: string, length: number): string {
  return dialect === "mysql" ? `varchar(${JSON.stringify(name)}, { length: ${length} })` : `text(${JSON.stringify(name)})`;
}

function dateColumn(dialect: Dialect, name: string): string {
  return dialect === "postgresql" ? `timestamp(${JSON.stringify(name)}, { withTimezone: true })` : dialect === "sqlite" ? `integer(${JSON.stringify(name)}, { mode: "timestamp_ms" })` : `datetime(${JSON.stringify(name)}, { mode: "date", fsp: 3 })`;
}

export function renderDeliverySchema(dialect: Dialect): string {
  const attempts = dialect === "mysql" ? 'int("attempts")' : 'integer("attempts")';
  return `\n\n/** Webhook and notification deliveries written with the emitting dataflow and sent after commit. */\nexport const qiyDeliveries = ${tableFactory(dialect)}("qiy_deliveries", {
  id: ${stringColumn(dialect, "id", 36)}.primaryKey(),
  target: ${stringColumn(dialect, "target", 160)}.notNull(),
  event: ${stringColumn(dialect, "event", 190)}.notNull(),
  payload: text("payload").notNull(),
  status: ${stringColumn(dialect, "status", 16)}.notNull(),
  attempts: ${attempts}.notNull(),
  nextAttemptAt: ${dateColumn(dialect, "nextAttemptAt")}.notNull(),
  lastError: text("lastError"),
  createdAt: ${dateColumn(dialect, "createdAt")}.notNull(),
  deliveredAt: ${dateColumn(dialect, "deliveredAt")},
}, (table) => [index("qiy_deliveries_due_idx").on(table.status, table.nextAttemptAt)]);\n`;
}

export function renderJobLeaseSchema(dialect: Dialect): string {
  return `\n\n/** Last claimed tick per cron job, so only one instance runs each scheduled tick. */\nexport const qiyJobLeases = ${tableFactory(dialect)}("qiy_job_leases", {
  name: ${stringColumn(dialect, "name", 160)}.primaryKey(),
  tick: ${dateColumn(dialect, "tick")}.notNull(),
  claimedAt: ${dateColumn(dialect, "claimedAt")}.notNull(),
});\n`;
}

export const sqliteDeliveryDdl = "CREATE TABLE IF NOT EXISTS qiy_deliveries (id text primary key, target text not null, event text not null, payload text not null, status text not null, attempts integer not null, nextAttemptAt integer not null, lastError text, createdAt integer not null, deliveredAt integer)";
export const sqliteJobLeaseDdl = "CREATE TABLE IF NOT EXISTS qiy_job_leases (name text primary key, tick integer not null, claimedAt integer not null)";

/** Test DDL matching the Drizzle tables; generated suites run against an empty disposable database. */
const deliveryDdl: Record<Dialect, string> = {
  sqlite: sqliteDeliveryDdl,
  postgresql: 'CREATE TABLE IF NOT EXISTS "qiy_deliveries" ("id" text primary key, "target" text not null, "event" text not null, "payload" text not null, "status" text not null, "attempts" integer not null, "nextAttemptAt" timestamp with time zone not null, "lastError" text, "createdAt" timestamp with time zone not null, "deliveredAt" timestamp with time zone)',
  mysql: "CREATE TABLE IF NOT EXISTS `qiy_deliveries` (`id` varchar(36) primary key, `target` varchar(160) not null, `event` varchar(190) not null, `payload` text not null, `status` varchar(16) not null, `attempts` int not null, `nextAttemptAt` datetime(3) not null, `lastError` text, `createdAt` datetime(3) not null, `deliveredAt` datetime(3))",
};
const jobLeaseDdl: Record<Dialect, string> = {
  sqlite: sqliteJobLeaseDdl,
  postgresql: 'CREATE TABLE IF NOT EXISTS "qiy_job_leases" ("name" text primary key, "tick" timestamp with time zone not null, "claimedAt" timestamp with time zone not null)',
  mysql: "CREATE TABLE IF NOT EXISTS `qiy_job_leases` (`name` varchar(160) primary key, `tick` datetime(3) not null, `claimedAt` datetime(3) not null)",
};

/** Creates and empties `table` before the suite; database tests skip without QIY_TEST_DATABASE_URL outside SQLite. */
function renderTestTable(dialect: Dialect, ddl: string, table: string): string {
  const exec = dialect === "sqlite" ? "client.exec(ddl)" : dialect === "postgresql" ? "await client.unsafe(ddl)" : "await client.query(ddl)";
  return `const available = ${dialect === "sqlite" ? "true" : "Boolean(Bun.env.QIY_TEST_DATABASE_URL)"};
const dbTest = available ? test : test.skip;
const ddl = ${JSON.stringify(ddl)};

beforeAll(async () => {
  if (!available) return;
  const { client } = await import("../src/db");
  ${exec};
  await db.delete(${table});
});`;
}

/** Statement for a dataflow transaction: one pending delivery per subscribed target. */
export function renderDeliveryInsert(dialect: Dialect, targets: readonly string[], event: string, payload: string): string {
  const rows = targets.map((target) => `{ id: crypto.randomUUID(), target: ${JSON.stringify(target)}, event: ${JSON.stringify(event)}, payload: deliveryPayload, status: "pending", attempts: 0, nextAttemptAt: deliveryNow, createdAt: deliveryNow }`).join(", ");
  const insert = `tx.insert(qiyDeliveries).values([${rows}])`;
  return `        {\n          const deliveryPayload = ${payload};\n          const deliveryNow = new Date();\n          ${dialect === "sqlite" ? `${insert}.run();` : `await ${insert};`}\n        }`;
}

function claimedCount(dialect: Dialect, statement: string, returning: string): string {
  return dialect === "mysql"
    ? `((await ${statement}) as unknown as [{ affectedRows: number }])[0].affectedRows`
    : `(await ${statement}.returning(${returning})).length`;
}

export function renderDeliveryModule(dialect: Dialect, project: Pick<QiyProject, "webhooks" | "notifications" | "notificationSettings">): string {
  const webhooks = project.webhooks ?? [];
  const notifications = project.notifications ?? [];
  const settings = project.notificationSettings;
  const targets = [
    ...webhooks.map((webhook) => `  ${JSON.stringify(`webhook:${webhook.name}`)}: { kind: "webhook", urlEnv: ${JSON.stringify(webhook.urlEnv)}, secretEnv: ${JSON.stringify(webhook.secretEnv)} },`),
    ...notifications.map((notification) => `  ${JSON.stringify(`notification:${notification.name}`)}: { kind: "notification", to: [${notification.to.map((recipient) => recipient.kind === "address" ? `{ address: ${JSON.stringify(recipient.address)} }` : `{ field: ${JSON.stringify(recipient.field)} }`).join(", ")}], subject: ${JSON.stringify(notification.subject)}, body: ${JSON.stringify(notification.body)} },`),
  ].join("\n");
  const claim = claimedCount(dialect, "db.update(qiyDeliveries).set({ nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS) }).where(and(eq(qiyDeliveries.id, id), eq(qiyDeliveries.status, \"pending\"), lte(qiyDeliveries.nextAttemptAt, now)))", "{ id: qiyDeliveries.id }");
  const webhookTypes = webhooks.length ? `\ntype WebhookTarget = { kind: "webhook"; urlEnv: string; secretEnv: string };` : "";
  const notificationTypes = notifications.length ? `\ntype NotificationTarget = { kind: "notification"; to: Array<{ address: string } | { field: string }>; subject: string; body: string };` : "";
  const targetType = [webhooks.length ? "WebhookTarget" : "", notifications.length ? "NotificationTarget" : ""].filter(Boolean).join(" | ");
  const mail = notifications.length ? `
export interface MailMessage { id: string; from: string; to: string[]; subject: string; text: string }

export const notificationFrom = ${JSON.stringify(settings!.from)};
export const defaultNotificationProvider = ${JSON.stringify(settings!.provider)};

type MailTransport = { sendMail(message: Record<string, unknown>): Promise<unknown> };
const smtpTransports = new Map<string, Promise<MailTransport>>();

async function sendSmtpMail(message: MailMessage, smtpUrl: string): Promise<void> {
  let transport = smtpTransports.get(smtpUrl);
  if (!transport) {
    transport = import("nodemailer").then(({ createTransport }) => createTransport(smtpUrl) as MailTransport);
    smtpTransports.set(smtpUrl, transport);
  }
  await (await transport).sendMail({ from: message.from, to: message.to, subject: message.subject, text: message.text, headers: { "X-Qiy-Delivery": message.id } });
}
` : "";
  const runtimeMail = notifications.length ? "\n  sendMail: (message: MailMessage, smtpUrl: string) => Promise<void>;" : "";
  const defaultMail = notifications.length ? ", sendMail: sendSmtpMail" : "";
  const webhookDelivery = webhooks.length ? `
  if (target.kind === "webhook") {
    const url = runtime.env[target.urlEnv];
    const secret = runtime.env[target.secretEnv];
    if (!url) throw new DeliveryNotConfigured(target.urlEnv);
    if (!secret) throw new DeliveryNotConfigured(target.secretEnv);
    await postSigned(runtime, url, secret, row.id, row.event, JSON.stringify({ id: row.id, event: row.event, createdAt: row.createdAt.toISOString(), data: payload }));
    return;
  }` : "";
  const notificationDelivery = notifications.length ? `
  if (target.kind === "notification") {
    const to = [...new Set(target.to.flatMap((recipient) => {
      if ("address" in recipient) return [recipient.address];
      const value = payload[recipient.field];
      return typeof value === "string" && value.trim() ? [value.trim()] : [];
    }))];
    if (!to.length) throw new PermanentDeliveryError("The event payload has no recipient address");
    const message: MailMessage = { id: row.id, from: notificationFrom, to, subject: renderDeliveryTemplate(target.subject, payload).replace(/[\\r\\n]+/g, " "), text: renderDeliveryTemplate(target.body, payload) };
    const provider = runtime.env.QIY_NOTIFY_PROVIDER || defaultNotificationProvider;
    if (provider === "console") {
      console.info("[qiy:notify]", JSON.stringify({ id: message.id, to: message.to, subject: message.subject, text: message.text }));
      return;
    }
    if (provider === "smtp") {
      const smtpUrl = runtime.env.QIY_SMTP_URL;
      if (!smtpUrl) throw new DeliveryNotConfigured("QIY_SMTP_URL");
      await runtime.sendMail(message, smtpUrl);
      return;
    }
    if (provider === "resend") {
      const apiKey = runtime.env.QIY_RESEND_API_KEY;
      if (!apiKey) throw new DeliveryNotConfigured("QIY_RESEND_API_KEY");
      const response = await runtime.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: "Bearer " + apiKey, "content-type": "application/json", "idempotency-key": message.id },
        body: JSON.stringify({ from: message.from, to: message.to, subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("Resend responded " + response.status + ": " + (await response.text()).slice(0, 200));
      return;
    }
    if (provider === "webhook") {
      const url = runtime.env.QIY_NOTIFY_WEBHOOK_URL;
      const secret = runtime.env.QIY_NOTIFY_WEBHOOK_SECRET;
      if (!url) throw new DeliveryNotConfigured("QIY_NOTIFY_WEBHOOK_URL");
      if (!secret) throw new DeliveryNotConfigured("QIY_NOTIFY_WEBHOOK_SECRET");
      await postSigned(runtime, url, secret, row.id, row.event, JSON.stringify({ id: message.id, event: row.event, from: message.from, to: message.to, subject: message.subject, text: message.text }));
      return;
    }
    throw new DeliveryNotConfigured("QIY_NOTIFY_PROVIDER (" + provider + " is not smtp, resend, webhook or console)");
  }` : "";
  return `import { createHmac } from "node:crypto";
import { and, asc, eq, lt, lte } from "drizzle-orm";
import { db } from "../db";
import { qiyDeliveries } from "../schema";

type Payload = Record<string, unknown>;
type Delivery = typeof qiyDeliveries.$inferSelect;${webhookTypes}${notificationTypes}

/** Generated from the webhook and notification declarations; the key is stored on each delivery row. */
export const deliveryTargets: Record<string, ${targetType}> = {
${targets}
};

export const DELIVERY_MAX_ATTEMPTS = ${DELIVERY_MAX_ATTEMPTS};
const DELIVERY_BATCH = 20;
const DELIVERY_TIMEOUT_MS = 10_000;
// Claiming a row pushes nextAttemptAt this far ahead, so a crashed sender's rows come back on their own.
const DELIVERY_LEASE_MS = 60_000;
const DELIVERED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Fails the delivery without retrying. */
export class PermanentDeliveryError extends Error {}
/** A required setting is missing; the delivery waits without spending an attempt. */
export class DeliveryNotConfigured extends Error {}
${mail}
export interface DeliveryRuntime {
  env: Record<string, string | undefined>;
  fetch: (input: string, init: RequestInit) => Promise<Response>;${runtimeMail}
  now: () => Date;
}

function defaultRuntime(): DeliveryRuntime {
  return { env: Bun.env, fetch: (input, init) => fetch(input, init)${defaultMail}, now: () => new Date() };
}

export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1000);
}

/** \`X-Qiy-Signature\`: HMAC-SHA256 over "<X-Qiy-Timestamp>.<raw body>". */
export function signDeliveryBody(secret: string, timestamp: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
}

export function renderDeliveryTemplate(template: string, payload: Payload): string {
  return template.replace(/\\{([A-Za-z_][A-Za-z0-9_]*)\\}/g, (_match, key: string) => {
    const value = payload[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

async function postSigned(runtime: DeliveryRuntime, url: string, secret: string, id: string, event: string, body: string): Promise<void> {
  const timestamp = String(Math.floor(runtime.now().getTime() / 1000));
  const response = await runtime.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "qiy-delivery", "x-qiy-delivery": id, "x-qiy-event": event, "x-qiy-timestamp": timestamp, "x-qiy-signature": signDeliveryBody(secret, timestamp, body) },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Endpoint responded " + response.status);
}

async function deliver(row: Delivery, runtime: DeliveryRuntime): Promise<void> {
  const target = deliveryTargets[row.target];
  if (!target) throw new PermanentDeliveryError("Unknown delivery target " + row.target);
  const payload = JSON.parse(row.payload) as Payload;${webhookDelivery}${notificationDelivery}
}

async function claimDelivery(id: string, now: Date): Promise<boolean> {
  return ${claim} === 1;
}

export interface DispatchResult { delivered: number; retried: number; failed: number; waiting: string[] }

/** Sends due deliveries once. Safe to run on several instances: each row is claimed before it is sent. */
export async function dispatchDeliveries(overrides: Partial<DeliveryRuntime> = {}): Promise<DispatchResult> {
  const runtime = { ...defaultRuntime(), ...overrides };
  const now = runtime.now();
  const result: DispatchResult = { delivered: 0, retried: 0, failed: 0, waiting: [] };
  const due = await db.select().from(qiyDeliveries)
    .where(and(eq(qiyDeliveries.status, "pending"), lte(qiyDeliveries.nextAttemptAt, now)))
    .orderBy(asc(qiyDeliveries.nextAttemptAt))
    .limit(DELIVERY_BATCH);
  for (const row of due) {
    if (!(await claimDelivery(row.id, now))) continue;
    try {
      await deliver(row, runtime);
      await db.update(qiyDeliveries).set({ status: "delivered", deliveredAt: runtime.now(), lastError: null }).where(eq(qiyDeliveries.id, row.id));
      result.delivered += 1;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      if (error instanceof DeliveryNotConfigured) {
        await db.update(qiyDeliveries).set({ lastError: "Not configured: " + message }).where(eq(qiyDeliveries.id, row.id));
        if (!result.waiting.includes(message)) result.waiting.push(message);
        continue;
      }
      const attempts = row.attempts + 1;
      const failed = error instanceof PermanentDeliveryError || attempts >= DELIVERY_MAX_ATTEMPTS;
      await db.update(qiyDeliveries)
        .set(failed ? { status: "failed", attempts, lastError: message } : { attempts, nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)), lastError: message })
        .where(eq(qiyDeliveries.id, row.id));
      if (failed) {
        result.failed += 1;
        console.error("[qiy:delivery] " + row.target + " gave up on " + row.id + " after " + attempts + " attempt(s): " + message);
      } else result.retried += 1;
    }
  }
  return result;
}

export async function pruneDeliveredDeliveries(now = new Date()): Promise<void> {
  await db.delete(qiyDeliveries).where(and(eq(qiyDeliveries.status, "delivered"), lt(qiyDeliveries.deliveredAt, new Date(now.getTime() - DELIVERED_RETENTION_MS))));
}

/** Polls for due deliveries until stopped. Disabled with QIY_DELIVERY_DISABLED=1. */
export function startDeliveryWorker(): () => void {
  if (Bun.env.QIY_DELIVERY_DISABLED === "1") return () => {};
  const pollMs = Number(Bun.env.QIY_DELIVERY_POLL_MS ?? 5000);
  if (!Number.isSafeInteger(pollMs) || pollMs < 250) throw new Error("QIY_DELIVERY_POLL_MS must be an integer of at least 250");
  const warned = new Set<string>();
  let running = false;
  let lastPrune = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await dispatchDeliveries();
      for (const setting of result.waiting) {
        if (warned.has(setting)) continue;
        warned.add(setting);
        console.warn("[qiy:delivery] " + setting + " is not configured; matching deliveries stay pending");
      }
      if (Date.now() - lastPrune > 60 * 60 * 1000) {
        lastPrune = Date.now();
        await pruneDeliveredDeliveries();
      }
    } catch (error) {
      console.error("[qiy:delivery] dispatch failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), pollMs);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
`;
}

export function renderJobLeaseModule(dialect: Dialect): string {
  const ensure = dialect === "mysql"
    ? "await db.insert(qiyJobLeases).ignore().values({ name, tick: new Date(0), claimedAt: new Date() });"
    : "await db.insert(qiyJobLeases).values({ name, tick: new Date(0), claimedAt: new Date() }).onConflictDoNothing();";
  const claim = claimedCount(dialect, "db.update(qiyJobLeases).set({ tick, claimedAt: new Date() }).where(and(eq(qiyJobLeases.name, name), lt(qiyJobLeases.tick, tick)))", "{ name: qiyJobLeases.name }");
  return `import { and, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { qiyJobLeases } from "../schema";

/** Start of the cron tick \`now\` falls in: seconds for 6-field patterns, minutes otherwise. Instances need synchronized clocks. */
export function scheduledTick(pattern: string, now = new Date()): Date {
  const step = pattern.trim().split(/\\s+/).length === 6 ? 1000 : 60_000;
  return new Date(Math.floor(now.getTime() / step) * step);
}

/** True for exactly one caller per job and tick, across every instance sharing the database. */
export async function claimJobTick(name: string, tick: Date): Promise<boolean> {
  ${ensure}
  return ${claim} === 1;
}
`;
}

export function renderScheduledDataflowModule(jobs: readonly QiyCronJob[], auth?: { roles?: readonly QiyRoleDeclaration[] }): string {
  const role = fullAccessRoles(auth)[0]!;
  const principals = jobs.filter(isDataflowCronJob).map((job) => `  ${JSON.stringify(job.name)}: { id: ${JSON.stringify(cronPrincipalId(job.name))}, name: ${JSON.stringify(`cron:${job.name}`)}, role: ${JSON.stringify(role)}, claims: {} },`).join("\n");
  return `import type { Principal } from "../auth/guard";
import { createDataflowRoutes } from "../dataflows";
import { claimJobTick } from "./lease";

/** Scheduled runs act as the first full-access role under a fixed per-job actor id. */
export const scheduledPrincipals: Record<string, Principal> = {
${principals}
};

export type DataflowInvoker = (request: Request, principal: Principal) => Promise<Response>;

const invokeDataflow: DataflowInvoker = (request, principal) => createDataflowRoutes(async () => principal).handle(request);

export type ScheduledOutcome = { skipped: true } | { skipped: false; result: unknown };

/** Runs \`flow\` once for \`tick\`; the tick also keys idempotent flows, so a replayed tick returns its first result. */
export async function runScheduledDataflow(job: string, flow: string, tick: Date, invoke: DataflowInvoker = invokeDataflow, claim = claimJobTick): Promise<ScheduledOutcome> {
  const principal = scheduledPrincipals[job];
  if (!principal) throw new Error("Unknown scheduled job " + job);
  if (!(await claim(job, tick))) return { skipped: true };
  const response = await invoke(new Request("http://qiy.cron/api/v1/commands/" + flow, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "cron:" + job + ":" + tick.toISOString() },
    body: "{}",
  }), principal);
  const text = await response.text();
  if (!response.ok) throw new Error(flow + " responded " + response.status + ": " + text.slice(0, 500));
  return { skipped: false, result: text ? JSON.parse(text) : null };
}
`;
}

export function renderScheduledDataflowTest(jobs: readonly QiyCronJob[], dialect: Dialect): string {
  const job = jobs.find(isDataflowCronJob)!;
  return `import { beforeAll, expect, test } from "bun:test";
import { claimJobTick, scheduledTick } from "../src/jobs/lease";
import { runScheduledDataflow, scheduledPrincipals } from "../src/jobs/scheduled";
import { db } from "../src/db";
import { qiyJobLeases } from "../src/schema";

${renderTestTable(dialect, jobLeaseDdl[dialect], "qiyJobLeases")}

test("scheduled ticks round down to the cron resolution", () => {
  const now = new Date("2026-01-02T03:04:05.678Z");
  expect(scheduledTick("0 3 * * *", now).toISOString()).toBe("2026-01-02T03:04:00.000Z");
  expect(scheduledTick("*/10 * * * * *", now).toISOString()).toBe("2026-01-02T03:04:05.000Z");
});

dbTest("only one claim wins each tick", async () => {
  const name = "lease-" + crypto.randomUUID();
  const tick = new Date("2026-01-02T03:04:00.000Z");
  expect(await claimJobTick(name, tick)).toBe(true);
  expect(await claimJobTick(name, tick)).toBe(false);
  expect(await claimJobTick(name, new Date(tick.getTime() - 60_000))).toBe(false);
  expect(await claimJobTick(name, new Date(tick.getTime() + 60_000))).toBe(true);
});

dbTest(${JSON.stringify(`${job.name} posts ${job.dataflow} once per tick as the scheduled principal`)}, async () => {
  const tick = new Date(Date.UTC(2026, 0, 2, 3, Math.floor(Math.random() * 60)));
  const calls: Array<{ request: Request; principal: unknown }> = [];
  const invoke = async (request: Request, principal: unknown) => {
    calls.push({ request, principal });
    return Response.json({ ok: true });
  };
  const first = await runScheduledDataflow(${JSON.stringify(job.name)}, ${JSON.stringify(job.dataflow)}, tick, invoke);
  const second = await runScheduledDataflow(${JSON.stringify(job.name)}, ${JSON.stringify(job.dataflow)}, tick, invoke);
  expect(first).toEqual({ skipped: false, result: { ok: true } });
  expect(second).toEqual({ skipped: true });
  expect(calls).toHaveLength(1);
  const [{ request, principal }] = calls;
  expect(new URL(request!.url).pathname).toBe(${JSON.stringify(`/api/v1/commands/${job.dataflow}`)});
  expect(request!.headers.get("idempotency-key")).toBe(${JSON.stringify(`cron:${job.name}:`)} + tick.toISOString());
  expect(await request!.text()).toBe("{}");
  expect(principal).toEqual(scheduledPrincipals[${JSON.stringify(job.name)}]);
});

dbTest("a failed command surfaces its status", async () => {
  const tick = new Date(Date.UTC(2027, 0, 2, 3, Math.floor(Math.random() * 60)));
  const invoke = async () => Response.json({ error: "Ticket is already closed" }, { status: 409 });
  await expect(runScheduledDataflow(${JSON.stringify(job.name)}, ${JSON.stringify(job.dataflow)}, tick, invoke)).rejects.toThrow("responded 409");
});
`;
}

export function renderDeliveryTest(dialect: Dialect, project: Pick<QiyProject, "webhooks" | "notifications" | "notificationSettings">): string {
  const webhook = project.webhooks?.[0];
  const notification = project.notifications?.find((candidate) => candidate.to.some((recipient) => recipient.kind === "address")) ?? project.notifications?.[0];
  const insertHelper = `async function pending(target: string, payload: Record<string, unknown>, attempts = 0): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date(Date.now() - 1000);
  await db.insert(qiyDeliveries).values({ id, target, event: "test.event", payload: JSON.stringify(payload), status: "pending", attempts, nextAttemptAt: now, createdAt: now });
  return id;
}

async function row(id: string) {
  return (await db.select().from(qiyDeliveries).where(eq(qiyDeliveries.id, id)))[0]!;
}`;
  const webhookTests = webhook ? `
dbTest("webhook deliveries are signed and marked delivered", async () => {
  const id = await pending(${JSON.stringify(`webhook:${webhook.name}`)}, { flow: "test", id: "42" });
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const result = await dispatchDeliveries({
    env: { ${JSON.stringify(webhook.urlEnv)}: "https://hooks.example.test/qiy", ${JSON.stringify(webhook.secretEnv)}: "test-secret" },
    fetch: async (url, init) => { requests.push({ url, init }); return new Response(null, { status: 204 }); },
  });
  expect(result.delivered).toBeGreaterThanOrEqual(1);
  const sent = requests.find((request) => (request.init.headers as Record<string, string>)["x-qiy-delivery"] === id)!;
  expect(sent.url).toBe("https://hooks.example.test/qiy");
  const headers = sent.init.headers as Record<string, string>;
  expect(headers["x-qiy-signature"]).toBe(signDeliveryBody("test-secret", headers["x-qiy-timestamp"]!, String(sent.init.body)));
  expect(JSON.parse(String(sent.init.body))).toMatchObject({ id, event: "test.event", data: { flow: "test", id: "42" } });
  expect((await row(id)).status).toBe("delivered");
});

dbTest("failed webhook deliveries back off and finally give up", async () => {
  const id = await pending(${JSON.stringify(`webhook:${webhook.name}`)}, { flow: "test" });
  const env = { ${JSON.stringify(webhook.urlEnv)}: "https://hooks.example.test/qiy", ${JSON.stringify(webhook.secretEnv)}: "test-secret" };
  const failing = async () => new Response("unavailable", { status: 503 });
  await dispatchDeliveries({ env, fetch: failing });
  const retried = await row(id);
  expect(retried.status).toBe("pending");
  expect(retried.attempts).toBe(1);
  expect(retried.lastError).toContain("503");
  expect(retried.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  await db.update(qiyDeliveries).set({ attempts: DELIVERY_MAX_ATTEMPTS - 1, nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(qiyDeliveries.id, id));
  const previous = console.error;
  console.error = () => {};
  try {
    await dispatchDeliveries({ env, fetch: failing });
  } finally {
    console.error = previous;
  }
  expect((await row(id)).status).toBe("failed");
});

dbTest("unconfigured webhooks wait without spending attempts", async () => {
  const id = await pending(${JSON.stringify(`webhook:${webhook.name}`)}, { flow: "test" });
  const result = await dispatchDeliveries({ env: {}, fetch: async () => { throw new Error("must not send"); } });
  expect(result.waiting).toContain(${JSON.stringify(webhook.urlEnv)});
  const waiting = await row(id);
  expect(waiting.status).toBe("pending");
  expect(waiting.attempts).toBe(0);
});
` : "";
  const notificationTests = notification ? `
dbTest("notifications render the payload through the console provider", async () => {
  const payload = { flow: "test" } as Record<string, unknown>;
  for (const field of ${JSON.stringify(notification.to.flatMap((recipient) => recipient.kind === "payload" ? [recipient.field] : []))}) payload[field] = "owner@example.com";
  const id = await pending(${JSON.stringify(`notification:${notification.name}`)}, payload);
  const logged: unknown[][] = [];
  const previous = console.info;
  console.info = (...args: unknown[]) => { logged.push(args); };
  try {
    await dispatchDeliveries({ env: { QIY_NOTIFY_PROVIDER: "console" } });
  } finally {
    console.info = previous;
  }
  const entry = logged.find((args) => String(args[1]).includes(id));
  expect(entry?.[0]).toBe("[qiy:notify]");
  expect((await row(id)).status).toBe("delivered");
});

dbTest("smtp notifications go through the configured transport", async () => {
  const payload = { flow: "test" } as Record<string, unknown>;
  for (const field of ${JSON.stringify(notification.to.flatMap((recipient) => recipient.kind === "payload" ? [recipient.field] : []))}) payload[field] = "owner@example.com";
  const id = await pending(${JSON.stringify(`notification:${notification.name}`)}, payload);
  const sent: Array<{ message: { id: string; from: string; to: string[] }; url: string }> = [];
  await dispatchDeliveries({ env: { QIY_NOTIFY_PROVIDER: "smtp", QIY_SMTP_URL: "smtp://mail.example.test:2525" }, sendMail: async (message, url) => { sent.push({ message, url }); } });
  const mail = sent.find((entry) => entry.message.id === id)!;
  expect(mail.url).toBe("smtp://mail.example.test:2525");
  expect(mail.message.from).toBe(${JSON.stringify(project.notificationSettings!.from)});
  expect(mail.message.to.length).toBeGreaterThan(0);
  expect((await row(id)).status).toBe("delivered");
});
` : "";
  return `import { beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { qiyDeliveries } from "../src/schema";
import { DELIVERY_MAX_ATTEMPTS, dispatchDeliveries, renderDeliveryTemplate, retryDelayMs, signDeliveryBody } from "../src/delivery";

${renderTestTable(dialect, deliveryDdl[dialect], "qiyDeliveries")}

${insertHelper}

test("templates and backoff", () => {
  expect(renderDeliveryTemplate("Ticket {id} by {missing}", { id: 7 })).toBe("Ticket 7 by ");
  expect(retryDelayMs(1)).toBe(30_000);
  expect(retryDelayMs(3)).toBe(120_000);
  expect(retryDelayMs(40)).toBe(6 * 60 * 60 * 1000);
});

dbTest("unknown targets fail without retrying", async () => {
  const id = await pending("webhook:removed", { flow: "test" });
  const previous = console.error;
  console.error = () => {};
  try {
    await dispatchDeliveries({ env: {} });
  } finally {
    console.error = previous;
  }
  expect((await row(id)).status).toBe("failed");
});
${webhookTests}${notificationTests}`;
}

/** Server environment entries for deliveries, in generated order. */
export function deliveryEnvironment(project: Pick<QiyProject, "webhooks" | "notifications" | "notificationSettings">, mode: "development" | "production" | "example", generatedSecret: string): Array<[string, string]> {
  if (!usesDeliveries(project)) return [];
  const development = mode === "development";
  const example = mode === "example";
  const entries: Array<[string, string]> = [["QIY_DELIVERY_DISABLED", "0"], ["QIY_DELIVERY_POLL_MS", "5000"]];
  for (const webhook of project.webhooks ?? []) {
    entries.push([webhook.urlEnv, example ? `https://hooks.example.com/${webhook.name}` : ""]);
    entries.push([webhook.secretEnv, development ? generatedSecret : ""]);
  }
  const settings = project.notificationSettings;
  if (settings) {
    entries.push(["QIY_NOTIFY_PROVIDER", development ? "console" : settings.provider]);
    if (settings.provider === "smtp") entries.push(["QIY_SMTP_URL", example ? "smtps://USER:PASSWORD@smtp.example.com:465" : ""]);
    if (settings.provider === "resend") entries.push(["QIY_RESEND_API_KEY", ""]);
    if (settings.provider === "webhook") {
      entries.push(["QIY_NOTIFY_WEBHOOK_URL", example ? "https://hooks.example.com/notifications" : ""]);
      entries.push(["QIY_NOTIFY_WEBHOOK_SECRET", development ? generatedSecret : ""]);
    }
  }
  return entries;
}

export function deliveryEnvironmentComments(project: Pick<QiyProject, "webhooks" | "notifications" | "notificationSettings">): string[] {
  if (!usesDeliveries(project)) return [];
  const lines = ["", "# Webhook and notification deliveries are sent by the server process; set QIY_DELIVERY_DISABLED=1 on instances that should not send."];
  for (const webhook of project.webhooks ?? []) lines.push(`# Webhook ${webhook.name}: deliveries wait until ${webhook.urlEnv} and ${webhook.secretEnv} are set; receivers verify X-Qiy-Signature with the secret.`);
  if (project.notificationSettings) lines.push(`# Notifications use QIY_NOTIFY_PROVIDER (smtp, resend, webhook or console); development logs them to the console.`);
  return lines;
}
