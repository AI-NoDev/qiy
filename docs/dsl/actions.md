# 业务 Action

`dataflow` 只声明服务端命令。界面按钮、跳转和非 CRUD 业务页通过独立 `action` 声明；这避免把任意 Dataflow 隐式暴露为 UI 操作。

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

生成边界：

- `placement list, show` 会分别进入资源表格的 actions 列和详情页 action 区；
- 可选的 `when <field> ==|!= "<value>"` 根据当前记录的 Text 或枚举字段控制按钮显示；未知字段、非文本字段、非法枚举值和其他运算符会在生成前失败；
- `dataflow` action 调用已声明的 command endpoint，可选确认弹窗；
- Dataflow 可通过 `@label(...)` 与 `@confirm(...)` 提供默认按钮名称和确认文案；Action 省略相应声明时继承，也可显式覆盖；
- 启用认证时，Dataflow action 通过 Refine `CanAccess` 继承命令的 `allow roles` 白名单；admin 不会绕过 operator-only 声明。未登录或角色不匹配时不显示该操作，服务端同时独立验证权限；
- Dataflow 的主键输入会从当前行或详情记录自动注入，其他必填输入会生成 Ant Design 表单弹窗；
- `navigate` action 生成 React Router 页面与菜单外路由；
- 启用生成认证时，导航 action 可声明 `allow roles admin, operator, viewer;` 的非空子集。按钮和业务页路由共用 Refine `CanAccess`，直接打开 URL 也会检查；admin 不绕过显式白名单。未声明时使用默认资源权限；
- 按钮及页面守卫向权限适配器传递 `params.id`。集成模式由宿主 `window.qiyHostAuth.can` 决定权限，不允许用 action 的 `allow roles` 代替宿主策略；
- `page manual` 只生成带 `@comment` 描述的空状态页和扩展文件，不猜测复杂业务 UI；支持 `@comment(t("key"))` 引用 application 的 `messages` 字典，说明随界面语言切换。已有扩展文件仍由开发者维护，`--sync` 不覆盖旧占位页或手写页面；
- 业务页面的手写内容位于 `apps/web/app/extensions/` 未托管扩展目录，后续 `qiy create --sync` 与 `qiy init --sync` 都不会覆盖；
- Action 名称、资源、Dataflow、placement 和 navigate 路径均在生成前校验，未声明命令和不安全路由会 fail-closed。

当前版本已贯通 `.qiy` 解析、序列化、Refine 列表/详情操作、Text/枚举字段条件显示、DataProvider 命令白名单、Dataflow 角色继承、导航角色声明、业务页守卫、手写业务页扩展和生成包测试。`when` 只是界面可见性规则，不是安全策略；直接 API 调用仍由服务端权限和 Dataflow 状态校验决定。受限的原子批量模式见下一节；它由服务端集合端点和单事务实现，不使用前端逐条请求。

## 原子批量 Action

列表页可以把一个启用持久化幂等的 Dataflow 暴露为批量操作：

```qiy [examples/dataflow/batch-actions.qiy]
dataflow archiveReview @label("Archive selected") @confirm("Archive all selected reviews?") {
  input {
    field reviewId UUID @required;
    field reason Text @required;
  }
  context {
    review = entity reviews by id input.reviewId @required;
  }
  step validate {
    require review.status != "locked" @error("Locked reviews cannot be archived");
  }
  step archive {
    update review { status = "archived"; note = input.reason; }
  }
  idempotency required;
  result { return review; }
}

action archiveSelected {
  resource reviews;
  dataflow archiveReview;
  placement list;
  batch true;
}
```

生成的 Refine 列表把选中 ID 与一次填写的共享输入组成单个 `{ items: [...] }` 请求，调用 `POST /api/v1/commands/archiveReview/batch`。服务端最多接受 100 个唯一记录 ID，在同一个数据库事务中按顺序执行现有 Dataflow；任意一项认证、scope、加载、业务校验、同步 call、审计、outbox 或幂等回执失败都会回滚整批。业务失败响应包含失败项的 `index` 和 `id`，不会返回部分成功。

服务端同时发布 `runArchiveReviewBatch(items: [ArchiveReviewCommandInput!]!, idempotencyKey: String!): [Reviews!]!` GraphQL mutation。native、Yoga 与 Apollo resolver 都委托同一个 REST batch route，因此事务、授权、scope、错误状态、失败项定位和持久化幂等回执不会出现第二套实现。相同 key/body 可以在 GraphQL 与 REST 之间回放同一回执；Refine 的生成按钮仍默认使用受保护 REST command URL，避免把业务命令伪装成通用 CRUD DataProvider 操作。

批量 Action 当前必须仅使用 `placement list`、不能声明记录级 `when`、必须绑定 `idempotency required` 的 Dataflow，并且目标资源必须由一个必填 UUID input 加载。整批只写一条持久化幂等回执；相同 key 与相同 items 回放原响应，相同 key 与不同顺序或内容返回 409。当前没有后台异步 job、部分成功模式或超过 100 条的分片执行；这些不能由客户端循环请求替代。

## 表单、提示与业务页

必填输入使用 Ant Design Form 校验；校验失败保留弹窗并显示字段提示，不发送命令。取消弹窗不执行 Dataflow。命令成功通过 Refine NotificationProvider 提示并刷新列表/详情缓存，批量成功清空选择；业务失败保留输入与选择，允许修正后重试。通知在 Ant Design App 上下文中挂载，继承当前主题与语言配置。

输入 `@comment(t("review.reason"))`、规则 `@error(t("review.blocked"))` 和手写页面 `@comment(t("review.page"))` 可以引用项目 messages。服务端业务错误返回 `errorKey`，前端通知按当前语言翻译；字段和页面描述同样随语言选择更新。按钮隐藏不能代替服务端权限检查。

完整模型见 [browser-actions.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/browser-actions.qiy)，包括本地认证、必填原因、锁定记录拒绝、单条/批量归档和带角色守卫的手写历史页。示例中的页面只生成业务说明，审核历史界面仍由开发者实现。
