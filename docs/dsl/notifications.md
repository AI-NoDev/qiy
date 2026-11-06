# 通知与 Webhook（notification / webhook）

Dataflow 和状态机发出的事件（`emit`）可以被 `webhook` 与 `notification` 订阅。事件提交时，每个订阅者在**同一个事务**里得到一行待投递记录（`qiy_deliveries`）；Server 进程里的投递 worker 在提交后发送，失败按指数退避重试。业务写入回滚时不会产生任何投递，投递失败也不会回滚业务写入。

配合 `elysia { cron { … dataflow … } }`，可以按计划运行一个 dataflow，例如每天早上生成摘要并通知相关人员。

```qiy
notifications {
  provider smtp;
  from "Support Desk <desk@example.com>";
}

dataflow closeTicket {
  allow roles agent;
  idempotency required;
  input { field ticketId UUID @required; }
  context { ticket = entity tickets by id input.ticketId @required; }
  step close {
    update ticket { status = "closed"; }
    emit "ticket.closed" { ticketId = input.ticketId; contactEmail = ticket.contactEmail; }
  }
  result { return ticket; }
}

webhook ticketFeed {
  event "ticket.closed", "announcements.publish";
  url env TICKET_WEBHOOK_URL;
  secret env TICKET_WEBHOOK_SECRET;
}

notification ticketClosedMail {
  event "ticket.closed";
  to "desk@example.com", payload.contactEmail;
  subject "Ticket {ticketId} closed";
  body t("notify.ticketClosed");
}
```

## 语法

```text
notifications {
  "provider" ( smtp | resend | webhook | console ) ";"    // 可省略，默认 smtp
  "from" "<address>" | "<Name <address>>" ";"
}

webhook <Name> {
  "event" "<event>" ( "," "<event>" )* ";"
  "url" "env" <ENV_NAME> ";"
  "secret" "env" <ENV_NAME> ";"
}

notification <Name> {
  "event" "<event>" ";"
  "to" recipient ( "," recipient )* ";"      // recipient = "<address>" | payload.<field>
  "subject" doc ";"
  "body" doc ";"
}
```

- `notifications` 是应用配置块，位于 `storage` 之后、`auth` 之前（见 [application · 块顺序](/dsl/application#块顺序与基数)）。
- `webhook` 与 `notification` 和 `dataflow`、`statemachine`、`action` 一样位于 `chart` 之后，可以任意交错。
- `doc` 是字符串字面量或 `t("key")`。`t()` 在生成时取**默认语言**的文案，邮件不按收件人语言切换。
- `{field}` 占位符在发送时替换为事件 payload 中的值，缺失或 `null` 替换为空字符串。

## 事件与 payload

| 来源 | 事件名 | payload |
| --- | --- | --- |
| dataflow `emit "x" { a = …; }` | `x` | `{ flow, a, … }` |
| statemachine transition | `<表名>.<transition>`（如 `orders.submit`） | `{ flow, id, <状态字段> }` |

`flow` 总是存在，值为发出事件的命令名。同一事件被多个 dataflow 发出时，`payload.<field>` 与 `{field}` 只能引用**每一处** emit 都带的字段，否则解析期报错。

## Webhook

每次投递是一个 `POST`，body 为 JSON：

```json
{ "id": "<delivery id>", "event": "ticket.closed", "createdAt": "2026-11-07T08:00:00.000Z", "data": { "flow": "closeTicket", "ticketId": "…" } }
```

| 请求头 | 含义 |
| --- | --- |
| `X-Qiy-Delivery` | 投递 id；重试时不变，接收方用它去重 |
| `X-Qiy-Event` | 事件名 |
| `X-Qiy-Timestamp` | 发送时刻的 Unix 秒 |
| `X-Qiy-Signature` | `sha256=` + HMAC-SHA256(secret, `<timestamp>.<原始 body>`) 的十六进制 |

接收方校验签名（Bun / Node）：

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyQiyWebhook(secret: string, headers: Headers, rawBody: string): boolean {
  const timestamp = headers.get("x-qiy-timestamp") ?? "";
  const signature = headers.get("x-qiy-signature") ?? "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

- 只有 2xx 视为成功。重定向不跟随（3xx 按失败重试），单次请求超时 10 秒。
- URL 与 secret 只从环境变量读取，模型里只写变量名。变量名必须是大写，不能以 `VITE_` 开头（会被打进浏览器包），两者不能相同。

## 通知

| provider | 发送方式 | 需要的环境变量 |
| --- | --- | --- |
| `smtp` | nodemailer，`createTransport(QIY_SMTP_URL)`，带 `X-Qiy-Delivery` 头 | `QIY_SMTP_URL`（如 `smtps://user:pass@smtp.example.com:465`） |
| `resend` | `POST https://api.resend.com/emails`，`Idempotency-Key` 为投递 id | `QIY_RESEND_API_KEY` |
| `webhook` | 把渲染好的邮件（`from`、`to`、`subject`、`text`）以签名 POST 发给你自己的服务 | `QIY_NOTIFY_WEBHOOK_URL`、`QIY_NOTIFY_WEBHOOK_SECRET` |
| `console` | 打印 `[qiy:notify] {…}` 到标准输出 | 无 |

- 运行时 `QIY_NOTIFY_PROVIDER` 覆盖模型里的 `provider`。生成的 `.env.development` 设为 `console`，本地开发不会真的发信。
- 收件人去重后发送；`payload.<field>` 的值不是非空字符串时跳过该收件人。一个收件人都没有时，这次投递直接标记失败，不重试。
- 正文是纯文本；主题中的换行会被替换为空格。

## 投递语义

| 行为 | 说明 |
| --- | --- |
| 写入 | `emit` 所在事务为每个订阅者插入一行 `pending` 记录（`target` = `webhook:<name>` 或 `notification:<name>`） |
| 发送 | worker 每 `QIY_DELIVERY_POLL_MS`（默认 5000，最小 250）取最多 20 条到期记录；先抢占（把 `nextAttemptAt` 推后 60 秒）再发送，多实例不会重复发送同一行；进程崩溃后 60 秒自动重新可取 |
| 重试 | 失败后等待 `min(30s × 2^(n-1), 6h)`，最多 8 次，之后标记 `failed` 并输出 `[qiy:delivery] … gave up` 错误日志 |
| 未配置 | 缺少 URL、secret、`QIY_SMTP_URL` 等时记录保持 `pending`、不消耗重试次数，worker 对每个缺失变量只告警一次；补上变量后自动发出 |
| 清理 | 已投递超过 7 天的记录每小时清理一次；`failed` 记录保留，便于排查 |
| 关闭 | `QIY_DELIVERY_DISABLED=1` 时该实例不发送（记录照常写入，由其他实例发送） |

投递是**至少一次**：发送成功但标记前进程退出时会重发，接收方应按 `X-Qiy-Delivery` 去重。

## 定时运行 dataflow

```qiy
elysia {
  cron {
    job dailyDigest pattern "0 7 * * 1-5" dataflow postDailyDigest;
  }
}

dataflow postDailyDigest {
  allow roles owner;
  idempotency required;
  input { }
  context { }
  step post {
    create digest = entity announcements { title = "Daily digest"; queue = "support"; }
    emit "announcement.digest" { id = digest.id; title = digest.title; }
  }
  result { return digest; }
}
```

- 每个 tick 只有一个实例执行：实例共用 `qiy_job_leases` 表抢占「job + tick」，tick 按 6 段 pattern 取整到秒，否则取整到分钟。各实例需要同步时钟。
- 执行身份是第一个 `full` 角色，用户 id 由 job 名确定（审计记录可追溯到具体 job），幂等键为 `cron:<job>:<tick ISO 时间>`，所以同一 tick 被重复触发也只生效一次。
- 定时运行没有调用者：dataflow 不能有必填 input，不能用 `allow permission` / `allow verification`，`allow roles` 必须包含一个 `full` 角色，也不能读写带 `scope` 或 `@tenant` 的资源。
- 和清理任务一样，cron 需要 `QIY_CRON_ENABLED=1` 才会启动。
- dataflow 的 `create` 可以省略带 `@default`、`@version` 的字段和状态机字段，分别取默认值、`1` 和 `initial`。

## 环境变量

| 变量 | 出现条件 | 说明 |
| --- | --- | --- |
| `QIY_DELIVERY_DISABLED` | 有 webhook 或 notification | `1` 时本实例不发送 |
| `QIY_DELIVERY_POLL_MS` | 同上 | 轮询间隔，默认 5000 |
| `<url env>` / `<secret env>` | 每个 webhook | 开发环境自动生成 secret；生产必须自行设置 |
| `QIY_NOTIFY_PROVIDER` | 有 `notifications` | 覆盖 provider；开发环境为 `console` |
| `QIY_SMTP_URL` / `QIY_RESEND_API_KEY` / `QIY_NOTIFY_WEBHOOK_URL` + `QIY_NOTIFY_WEBHOOK_SECRET` | 对应 provider | 见上文通知表 |

## 生成结果

| 产物 | 内容 |
| --- | --- |
| 表 | `qiy_deliveries`（有 webhook/notification）、`qiy_job_leases`（有 cron job） |
| Server | `src/delivery/index.ts`（目标表、发送、重试、签名、worker），`src/jobs/lease.ts`、`src/jobs/scheduled.ts`；`server.ts` 启动 worker |
| 依赖 | 有 notification 时加入 `nodemailer` |
| 测试 | `tests/delivery.test.ts`（签名、退避、未配置等待、console/SMTP 通知），`tests/scheduled.test.ts`（tick 取整、单实例抢占、执行身份），dataflow 测试断言写入的待投递行数 |

## 校验错误

| 错误（节选） | 触发 |
| --- | --- |
| `Webhook <w>: no dataflow or statemachine emits "<e>"` / `Notification <n>: …` | 订阅了没有被发出的事件 |
| `Webhook <w>: <NAME> would be exposed to the browser; drop the VITE_ prefix` | 环境变量以 `VITE_` 开头 |
| `Webhook <w>: url and secret need different environment variables` | url 与 secret 用了同一个变量 |
| `Notification <n> requires a notifications { provider ...; from "..."; } block` | 有 notification 但没有 `notifications` 块 |
| `The notifications block has no notification declarations; …` | 有 `notifications` 块但没有 notification |
| `notifications from must be an address or "Name <address>", got …` | `from` 格式错误 |
| `Notification <n>: payload.<f> is not in every "<e>" payload (…)` | 收件人字段不是所有 emit 都带 |
| `Notification <n>: subject placeholder {<f>} is not in every "<e>" payload (…)` | 占位符字段不存在 |
| `Cron job <j>: dataflow <d> requires input <f>; scheduled runs send no input` | 定时 dataflow 有必填 input |
| `Cron job <j>: dataflow <d> must allow a full-access role (…)` | `allow roles` 不含 `full` 角色 |
| `Cron job <j>: dataflow <d> uses scoped resource <r>; …` | 定时 dataflow 触及数据范围资源 |
| `application mode integration cannot configure generated server features …` | integration 模式下声明了 webhook / notifications |

## 相关

- [dataflow](/dsl/dataflow)：`emit` 与事务语义。
- [statemachine](/dsl/statemachine)：transition 发出的事件。
- [application · elysia](/dsl/application#elysia)：cron 配置与 `QIY_CRON_ENABLED`。
- 示例：`tests/fixtures/kitchen-sink/modules/commands.qiy`。
