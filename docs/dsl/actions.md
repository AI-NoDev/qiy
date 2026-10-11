# 业务 Action

`dataflow` 只声明服务端命令。界面按钮、跳转和非 CRUD 业务页通过独立 `action` 声明；这避免把任意 Dataflow 隐式暴露为 UI 操作。

```qiy
action revokeConnector {
  resource connectors;
  dataflow revokeConnector;
  placement list, show;
  label "撤销";
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
- `dataflow` action 调用已声明的 command endpoint，可选确认弹窗；
- 启用认证时，Dataflow action 通过 Refine `CanAccess` 继承命令的 `allow roles` 白名单；admin 不会绕过 operator-only 声明。未登录或角色不匹配时不显示该操作，服务端同时独立验证权限；
- Dataflow 的主键输入会从当前行或详情记录自动注入，其他必填输入会生成 Ant Design 表单弹窗；
- `navigate` action 生成 React Router 页面与菜单外路由；
- 启用生成认证时，导航 action 可声明 `allow roles admin, operator, viewer;` 的非空子集。按钮和业务页路由共用 Refine `CanAccess`，直接打开 URL 也会检查；admin 不绕过显式白名单。未声明时使用默认资源权限；
- 按钮及页面守卫向权限适配器传递 `params.id`。集成模式由宿主 `window.qiyHostAuth.can` 决定权限，不允许用 action 的 `allow roles` 代替宿主策略；
- `page manual` 只生成带 `@comment` 描述的空状态页和扩展文件，不猜测复杂业务 UI；支持 `@comment(t("key"))` 引用 application 的 `messages` 字典，说明随界面语言切换。已有扩展文件仍由开发者维护，`--sync` 不覆盖旧占位页或手写页面；
- 业务页面的手写内容位于 `apps/web/app/extensions/` 未托管扩展目录，后续 `qiy create --sync` 与 `qiy init --sync` 都不会覆盖；
- Action 名称、资源、Dataflow、placement 和 navigate 路径均在生成前校验，未声明命令和不安全路由会 fail-closed。

当前版本已贯通 `.qiy` 解析、序列化、Refine 列表/详情操作、DataProvider 命令白名单、Dataflow 角色继承、导航角色声明、业务页守卫、手写业务页扩展和生成包测试。条件显示与批量业务操作尚未实现。导航权限只控制界面，手写页面调用的 API 必须独立执行服务端授权；复杂页面内容仍由开发者在扩展文件中实现，服务端业务一致性仍由 Dataflow/API 保证。
