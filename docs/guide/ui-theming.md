# UI 与主题

Qiy 当前生成 Refine + Ant Design 管理后台。UI 配置写在 `.qiy` 的 `application` 内，不需要额外的 TypeScript 配置文件。

## 配置主题

```qiy [app.qiy]
qiy v0;

application operations-admin {
  database sqlite {}

  ui {
    library antd;
    theme purple;
    themes purple, blue, green, orange;
    colorMode system;
    allowThemeSwitch true;
    allowColorModeSwitch true;
  }

  entity products @label("Products") @icon(AppstoreOutlined) {
    field id UUID @id;
    field name Text @label("Name");
  }
}
```

| 配置 | 可选值 | 说明 |
| --- | --- | --- |
| `library` | `antd` | 当前唯一已验收的完整 UI adapter |
| `theme` | `blue`、`purple`、`green`、`orange`、`red` | 初始品牌主题，必须包含在 `themes` 中 |
| `themes` | 一个或多个主题 key | Header 中允许用户切换的主题 |
| `colorMode` | `light`、`dark`、`system` | 初始明暗模式；`system` 跟随操作系统 |
| `allowThemeSwitch` | `true` / `false` | 是否显示品牌主题选择器 |
| `allowColorModeSwitch` | `true` / `false` | 是否显示亮色、暗色、系统模式切换 |

未声明 `ui` 时，Qiy 默认启用全部五个主题，以 `blue` 和 `system` 启动，并显示两个切换控件。

## 生成结果

```text [apps/web/app/ui/]
ui/
├── index.tsx          # Ant Design adapter、主题状态和 Header 控件
└── theme-config.ts    # 从 .qiy 生成的只读主题配置
```

用户选择会写入浏览器 `localStorage`；`system` 模式监听 `prefers-color-scheme`。语言选择单独保存在 `qiy.locale`（生成的 `readStoredLocale` / `storeLocale`），切换语言后 Ant Design locale 与页面 `lang` / `dir` 由 Qiy 的 I18nProvider 同步更新，刷新后保持；模型 label 的翻译键见 [DSL 总览 · 模型 label 的自动翻译键](/dsl/overview#模型-label-的自动翻译键)。

CRUD 页面按以下顺序选择组件：

1. 对应 UI adapter 的 Refine 官方组件，例如 `List`、`Show`、`Create`、`Edit`、`CreateButton`；
2. UI 库原生组件，例如 Ant Design Table、Form、Select；
3. Qiy 自定义组件，用于动态字段、批量操作、业务 Action、审计和文件能力。

## 二次开发

`app/ui/` 是 Qiy manifest 管理的生成文件，执行 `--sync` 时会更新。业务级视觉扩展应放到未托管的插件或扩展文件中，再从生成入口接入；不要直接修改 `theme-config.ts` 代替 `.qiy` 配置。

Material UI、Mantine 和 Chakra 目前不会生成半套 adapter。配置这些名称会在解析阶段失败；只有 Layout、Notification、Auth、CRUD、表单、图标和主题全部实现并通过生成项目 typecheck/test/build 后，才会加入支持列表。

完整模型见 [`examples/themes/app.qiy`](https://github.com/AI-NoDev/qiy/blob/main/examples/themes/app.qiy)。
