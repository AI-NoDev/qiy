# 业务 Action

`dataflow` 只声明服务端命令，**不会**自动变成界面按钮。`action` 负责把「命令」或「手写业务页」挂到列表/详情操作区，并声明可见性、确认文案、批量语义。这种分离保证：新增一个命令不会意外暴露一个新的 UI 入口。

```qiy
action revokeConnector {
  resource connectors;
  dataflow revokeConnector;
  placement list, show;
  label "撤销";
  when status == "active";
  confirm "确认撤销该连接器？";
}

action reviewConnector {
  allow roles operator, viewer;
  resource connectors;
  placement list, show;
  label "审核";
  navigate "/connectors/:id/review";
  page manual @comment("运营审核、审批记录和第三方信息由开发者实现");
}
```

## 语法

```text
action <Name> {
  "resource" <entity> ";"
  ( "dataflow" <Name> | "navigate" <string> ) ";"
  "placement" ( "list" | "show" ) ( "," ( "list" | "show" ) )* ";"
  [ "label" doc ";" ]
  [ "confirm" doc ";" ]            // 仅 dataflow action
  [ "when" <field> ( "==" | "!=" ) <string> ";" ]
  [ "allow" ( "roles" role ("," role)* | "permission" ref ("," ref)* | "verification" <Name> ) ";" ]   // 仅 navigate action
  [ "batch" "true" ";" ]           // 仅 dataflow action
  [ "page" "manual" "@comment" "(" doc ")" ";" ]   // 仅 navigate action
}
```

`resource`、`placement`、以及 `dataflow`/`navigate` 二选一是必填；其余可选。`doc` 可以是字符串字面量或 `t("key")`。

## 属性表

| 属性 | 必填 | 默认 | 语义与校验 |
| --- | --- | --- | --- |
| `resource` | 是 | — | 实体名或表名；未知资源报 `unknown resource` |
| `dataflow <Name>` | 二选一 | — | 必须指向已声明 flow；该 flow 的 `context` 必须**加载该资源**，否则 `does not load resource <table>` |
| `navigate "<path>"` | 二选一 | — | 绝对路由，必须匹配 `^/[a-z0-9_-]+(/[a-z0-9_-]+|:[a-z][a-zA-Z0-9_]*)*$`、必须含 `:id`，禁止 `..`、`\`、`?`、`#` |
| `placement list` / `show` | 是（≥1） | — | 分别进入资源表格 actions 列与详情页 action 区；重复报 `duplicate placement` |
| `label` | navigate 必填；dataflow 可省 | dataflow 继承 flow 的 `@label` | 显示名；`t("key")` 走 i18n；两者都没有时生成失败 |
| `confirm` | 否 | 继承 flow 的 `@confirm` | 确认弹窗文案；只在 dataflow action 上合法 |
| `when <field> == \| != "<value>"` | 否 | 无（始终显示） | 记录级可见性；字段必须是当前资源的 `Text` 或 enum；enum 值必须已声明；只支持 `==`/`!=` |
| `allow roles …` | 否 | 继承 flow 的 `allow roles`（dataflow action） | navigate action 可用 `admin`/`operator`/`viewer` 非空子集；dataflow action 上**禁止**声明 |
| `allow permission …` / `allow verification …` | 否 | 继承 flow | 仅 navigate action；`verification` 不能有 input |
| `batch true` | 否 | `false` | 批量模式；必须 `placement list` 唯一、无 `when`、flow 有 `idempotency required`、资源由必填 UUID input 加载 |
| `page manual @comment(...)` | navigate 必填 | — | 生成占位业务页 + 未托管扩展文件；`@comment` 必填（可为 `t("key")`） |

## 默认值与继承

| 场景 | 行为 |
| --- | --- |
| dataflow action 省略 `label` | 继承 flow `@label`（含 `labelKey`） |
| dataflow action 省略 `confirm` | 继承 flow `@confirm`；若 flow 也没有，则不弹确认 |
| dataflow action 声明 `confirm` | 覆盖 flow 的默认值 |
| navigate action 省略 `allow` | 沿用资源默认页面权限（`restrict.roles` / 角色模型） |
| navigate action 省略 `label` | 报 `label is required`（navigate 没有可继承来源） |

## `when`：记录级可见性

```qiy
action approveReceipt {
  resource purchase_orders;
  dataflow approvePurchaseOrder;
  placement list, show;
  label "审批";
  when status == "submitted";
}
```

- 只有当前行的该字段**等于/不等于**字面量时按钮才渲染；记录缺少该字段或值不匹配 → 隐藏。
- 只接受 `Text` 或 enum：`Action <a>: condition field <e>.<f> must be Text or enum`；enum 值必须在声明集合内（`unknown enum value`）。
- **`when` 不是安全策略**：它只是 UI 规则。直接调用命令端点仍由服务端角色/权限/`require` 决定。`when` 也不影响批量（批量禁止 `when`）。

## 生成结果

### 列表与详情

- `placement list` → 表格行 actions 列多一个按钮；`placement show` → 详情页操作区多一个按钮。
- 按钮标签用 `label`/`labelKey`；`confirm` 存在时先弹 Ant Design `Modal.confirm`，取消不发送请求。
- 可见性由 Refine `CanAccess`（`qiyAccessControlProvider`）判定：先看资源角色策略与页面规则，再看命令策略（`roles` → `permissions` → 无 input 的 `verification`）。
- 成功 → `useNotification` 提示并刷新列表/详情缓存；失败 → 保留弹窗与输入，按 `errorKey` 翻译错误；批量成功后清空选择。

### 命令表单

- `dataflow` 的主键 input（如 `input.reviewId`）由当前行/详情记录自动注入，不显示在表单里（`idInput`）。
- 其余 `@required` input 生成 Ant Design 表单字段：Text → Input，Integer → InputNumber，enum → Select（用 enum 的 label），UUID → Input；`@comment`/`t("key")` 作为字段标签与提示。
- 表单校验失败 → 不发送命令；`idempotency required` 的 flow 自动带 `Idempotency-Key`，失败重试保留同一键、成功后换新键。
- 请求固定发往 `/api/v1/commands/<flow>`；Refine DataProvider 只允许声明的命令 URL（fail-closed）。

### 手写业务页

```qiy
action reviewConnector {
  allow roles operator, viewer;
  resource connectors;
  placement list, show;
  label "审核";
  navigate "/connectors/:id/review";
  page manual @comment(t("review.pageHelp"));
}
```

- 生成路由 `/connectors/:id/review`，页面用 `CanAccess`（`action: "reviewConnector"`）包裹；直接输入 URL 也会检查。
- 生成 `apps/web/app/extensions/` 下的占位页（说明文案 + 空状态），该目录**不受** `qiy create --sync` / `qiy init --sync` 管理，可安全实现自己的界面。
- 页面只能拿到 `:id` 参数；数据读取用 Refine hooks 或自己的 API。服务端授权仍要独立实现（`restrict`/`scope`/宿主 API）。

### 批量

```qiy
action archiveSelected {
  resource reviews;
  dataflow archiveReview;
  placement list;
  batch true;
}
```

- 生成 `POST /api/v1/commands/archiveReview/batch` 调用；选中 ID 与一次填写的共享输入合并为 `{ items: [...] }`。
- 服务端限制 1–100 个唯一 ID，单事务执行，任意一项失败整批回滚并返回 `item: { index, id }`。
- GraphQL 同步生成 `runArchiveReviewBatch`，与 REST 共用同一事务与幂等回执。
- 约束：`placement list` only、无 `when`、flow 必须 `idempotency required`、资源由单个必填 UUID input 加载（否则生成期报错）。
- 详见 [dataflow · 批量执行](/dsl/dataflow#批量执行batch)。

## 权限集成

| 命令类型 | 按钮可见性来源 | 服务端权威 |
| --- | --- | --- |
| dataflow action | flow 的 `roles` → `permissions`（展开为权限值） → 无 input 的 `verification` | 命令路由：角色/权限/校验式 + `require` + scope |
| navigate action | 自身 `allow roles` / `allow permission` / 无 input 的 `allow verification`，否则资源默认权限 | 页面守卫只决定是否渲染；业务 API 需自行授权 |

- **admin 不绕过**显式白名单（`allow roles operator;` 也会拒绝 admin）。
- 有 input 的 `allow verification` 无法在浏览器求值 → 按钮回退角色列表；服务端仍强制校验。
- 集成（`mode integration`）模式下 `qiyHostAuth.can` 是唯一判定来源，`action` 的 `allow` 不能代替宿主策略。

## i18n 与提示

- `label` / `confirm` / `page manual @comment` 支持 `t("key")`；key 必须存在于 `messages.default`。
- input 的 `@comment(t("key"))` 作为表单字段标签；enum 选项用 enum 值的 `@label`。
- 成功/失败通知走 Refine NotificationProvider（挂在 Ant Design `App` 上下文，继承主题与语言）；业务失败按 `errorKey` 翻译，未知 key 用 API 原文。
- 自动生成的 i18n key：`qiy.actions.<action>.label`、`qiy.actions.<action>.confirm`、`qiy.actions.<action>.inputs.<input>.label`（在 `label`/`confirm`/`@comment` 未声明时使用）。

## 完整示例

```qiy [examples/dataflow/browser-actions.qiy]
qiy v0;
application browser-actions {
  database sqlite {}
  api { client rest; }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }

  enum userRole { value admin; value operator; value viewer; }

  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }

  entity reviews {
    field id UUID @id;
    field status Text;
    field note Text @nullable;
  }

  dataflow archiveReview @label("归档所选") @confirm("归档选中的审核记录？") {
    allow roles admin, operator;
    idempotency required;
    input {
      field reviewId UUID @required;
      field reason Text @required @comment("归档原因");
    }
    context { review = entity reviews by id input.reviewId @required; }
    step guard {
      require review.status != "locked" @error("锁定记录不能归档");
    }
    step archive {
      update review { status = "archived"; note = input.reason; }
    }
    result { return review; }
  }

  action archiveOne {
    resource reviews;
    dataflow archiveReview;
    placement list, show;
    when status != "archived";
  }

  action archiveSelected {
    resource reviews;
    dataflow archiveReview;
    placement list;
    batch true;
  }

  action reviewHistory {
    allow roles admin, operator, viewer;
    resource reviews;
    placement show;
    label "审核历史";
    navigate "/reviews/:id/history";
    page manual @comment("用 Refine hooks 读取审计记录并渲染时间线");
  }
}
```

## 校验错误

| 错误（节选） | 触发 |
| --- | --- |
| `resource is required` / `at least one placement is required` | 缺必填属性 |
| `exactly one of dataflow or navigate is required` | 两个都写或都不写 |
| `unsupported property <p>` | 未知属性 |
| `placement must be list or show` / `duplicate placement list` | 非法或重复 placement |
| `when operator must be == or !=` / `duplicate when declaration` | `when` 语法 |
| `condition field <e>.<f> must be Text or enum` / `unknown enum value` | `when` 字段/值非法 |
| `unknown resource <r>` | 资源不存在 |
| `label is required` | navigate 缺 label |
| `navigate actions require page manual @comment(...)` | navigate 缺 `page manual` |
| `navigate path must be an absolute safe application route` / `must include :id` | 路由非法 |
| `only page manual is supported` | 写了别的 page 类型 |
| `allow roles` / `allow permission` 在 dataflow action 上 | `declare roles on the dataflow instead` 等 |
| `permission verification <v> requires inputs and cannot guard a navigate action` | navigate 用了带 input 的校验块 |
| `unsupported role <r>` / `duplicate role` / `duplicate allow declaration` | `allow` 语法 |
| `batch currently requires true` / `duplicate batch declaration` | `batch` 语法 |
| `confirm is only valid for dataflow actions` / `batch is only valid for dataflow actions` | 属性用错对象 |
| `dataflow <f> does not load resource <t>` | flow 的 context 没加载该资源 |
| `batch actions require placement list only` / `do not support record when conditions` / `require dataflow <f> to declare idempotency required` / `must load the resource from one required UUID input` | 批量约束 |
| `allow roles requires generated authentication` | 无 auth 却用 allow |
| `action <a>: unknown permission field or group <r>` / `unknown permission verification <v>` | 权限引用不存在 |

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 按钮不显示 | `when` 不匹配 / `CanAccess` 拒绝 / 服务端未提供 `permissions` 元数据 | 检查记录字段值、角色、`/auth/me` 的 `permissions` |
| 点击后 403 | 服务端 `allow` 或命令内 `require` 拒绝（按钮隐藏不能替代服务端判定） | 检查 flow 的 `allow` 与业务状态 |
| 表单里没有主键字段 | 主键 input 由当前记录自动注入 | 正常行为；`idInput` 已处理 |
| 批量按钮不可用 | 忘写 `batch true` / flow 没有 `idempotency required` / 有 `when` | 按批量约束调整 |
| 手写页被 `--sync` 覆盖 | 页面实现了 `app/extensions/` 之外的文件 | 只改 `app/extensions/`（未托管） |
| 直接打开业务页 403 | navigate action 的 `allow roles` 不含当前角色 | 调整 `allow` 或依赖资源默认权限 |
| 通知文案是英文 key | `messages` 缺对应语言条目 | 在 `messages` 补齐，或接受默认语言回退 |

## 进阶用法

**1）同一 flow 暴露成多个入口**：单条按钮 + 批量按钮 + 不同 `when` 的状态入口。

```qiy
action submitOrder       { resource orders; dataflow submitOrder; placement list, show; when status == "draft"; }
action submitSelected    { resource orders; dataflow submitOrder; placement list; batch true; }
```

**2）复杂审批交给手写页**：命令只做原子状态变更，审核历史/第三方信息放在 `page manual` 扩展页。

```qiy
action openReview {
  allow roles admin, operator;
  resource orders;
  placement show;
  label "审批详情";
  navigate "/orders/:id/review";
  page manual @comment("读取审计与外部信息，提交时仍调用 approveOrder 命令");
}
```

**3）权限最小化**：navigate action 的 `allow` 只写真正需要的角色；页面内部的写操作仍由服务端命令的 `allow` 决定，避免「页面可见 = 可写」。

**4）失败重试与幂等**：批量失败时保留选择与输入；单条失败时同一 `Idempotency-Key` 重试可安全重复提交（服务端回放首次结果）。输入改变会换键，避免误回放。

**5）按钮文案完全走 messages**：`label(t("orders.submit"))` + `confirm(t("orders.submit.confirm"))`，切语言不需要改代码。

## 相关

- [dataflow](/dsl/dataflow)：命令本身、幂等、批量、错误契约。
- [权限（permission）](/dsl/permissions)：`CanAccess` 与命令策略的判定顺序。
- [realtime](/dsl/realtime)：命令事件如何推送到页面。
- [Refine Providers](/guide/refine-providers)：`AccessControlProvider` 与通知的生成约定。
- 示例：[browser-actions.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/browser-actions.qiy)、[batch-actions.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/batch-actions.qiy)、[examples/self/modules/actions.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/self/modules/actions.qiy)。
- 测试：`tests/action-qiy.test.ts`、`tools/verify-action-browser-api.ts`。
