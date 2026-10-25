# UI 与主题

Qiy 当前生成 Refine + Ant Design 管理后台。UI 配置写在 `.qiy` 的 `application` 内，不需要额外的 TypeScript 配置文件；主题、色彩模式、侧边栏折叠与语言都由生成代码统一处理。

## 语法

`ui` 块位于 `application {}` 内，位置固定：`workspace` 之后、`api` 之前。

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

  entity Product table products @label("Products") @icon(AppstoreOutlined) {
    field id UUID @id;
    field name Text @label("Name");
    field price Decimal(12,2) @label("Price");
  }
}
```

```text
ui {
  library antd;
  theme <blue|purple|green|orange|red>;
  themes <key>, <key>, ...;
  colorMode <light|dark|system>;
  allowThemeSwitch <true|false>;
  allowColorModeSwitch <true|false>;
}
```

- 每个设置 `key value;` 形式，`;` 必需；同一个 `ui` 块内键不能重复。
- `themes` 用逗号分隔多个标识符（不是字符串）。
- `library` 只支持 `antd`；`mui`、`mantine`、`chakra` 等会在解析阶段报 `Unsupported UI library <x>; only antd is implemented`，不会生成半套 adapter。
- 一个模型最多一个 `ui` 块；写多个会在固定槽位之外再次遇到 `ui` 而解析失败。

## 参数表

| 配置 | 可选值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `library` | `antd` | `antd` | 唯一完整实现的 UI adapter |
| `theme` | `blue`、`purple`、`green`、`orange`、`red` | `themes` 的第一个；未声明 `themes` 时 `blue` | 初始品牌主题，必须包含在 `themes` 中 |
| `themes` | 上述 key 的逗号列表，至少一个 | 全部五个 | Header 主题下拉的候选集合 |
| `colorMode` | `light`、`dark`、`system` | `system` | 初始明暗模式；`system` 跟随操作系统 |
| `allowThemeSwitch` | `true` / `false` | `true` | 是否显示品牌主题选择器 |
| `allowColorModeSwitch` | `true` / `false` | `true` | 是否显示亮色/暗色/系统切换 |

默认值总结：

- 不写 `ui`：`library=antd`、`theme=blue`、`themes=[blue,purple,green,orange,red]`、`colorMode=system`、两个开关都是 `true`。
- 只写 `themes purple, blue;`：默认主题取 `purple`。
- 写了 `theme` 但不在 `themes` 中：`UI default theme <t> must be included in themes`。

## 默认值与校验

| 场景 | 报错 |
| --- | --- |
| 未知 library | `Unsupported UI library <x>; only antd is implemented` |
| 未知主题 key | `Unsupported UI theme <x>` |
| `themes` 重复 | `Duplicate UI theme <x>` |
| `themes` 为空 | `UI themes requires at least one theme key` |
| 默认主题不在 themes | `UI default theme <x> must be included in themes` |
| 未知 colorMode | `Unsupported UI color mode <x>` |
| 开关不是布尔 | `Expected true or false near token <n>` |
| 未知设置 | `Unsupported UI setting <x>` |
| 同一设置重复 | `Duplicate UI setting <x>` |

`themes` 的结尾逗号非法（必须 `a, b`，不能 `a, b,`）；`themes` 只写一个 key 合法，但主题选择器会因候选不足而隐藏。

## 主题注册表

生成代码内置五个主题，每个主题只覆盖 Ant Design 的 `colorPrimary`，其余 token 与圆角统一：

| key | 色值 | 控件文案 key | 内置文案（zh / en） |
| --- | --- | --- | --- |
| `blue` | `#1677ff` | `qiy.themeBlue` | 蓝色 / Blue |
| `purple` | `#722ed1` | `qiy.themePurple` | 紫色 / Purple |
| `green` | `#389e0d` | `qiy.themeGreen` | 绿色 / Green |
| `orange` | `#d46b08` | `qiy.themeOrange` | 橙色 / Orange |
| `red` | `#cf1322` | `qiy.themeRed` | 红色 / Red |

- `ConfigProvider.theme.token` = `{ borderRadius: 6, ...selectedTheme.token }`；只有 `colorPrimary` 随主题变化。
- 主题名由 `"qiy.theme" + Key` 动态拼 key，因此项目 `messages` 可以用 `qiy.themeBlue` 等覆盖显示名。
- 品牌名 "Qiy Admin" 是固定字符串，不参与翻译；可在生成的 `root.tsx` 的 `QiyThemedTitle`/Header 中改（注意 `--sync`）。

## 色彩模式解析

```text
colorMode = light | dark | system
systemDark = matchMedia("(prefers-color-scheme: dark)").matches
resolvedColorMode = colorMode === "system" ? (systemDark ? "dark" : "light") : colorMode
```

- `resolvedColorMode` 决定 Ant Design `theme.algorithm`：`darkAlgorithm` 或 `defaultAlgorithm`。
- 同时写入 `<html>`：
  - `data-theme="<blue|purple|green|orange|red>"`
  - `data-color-mode="<light|dark>"`
  - `style.colorScheme = "<light|dark>"`
- `system` 模式监听 `prefers-color-scheme` 的 `change` 事件，系统切换时实时重渲染。
- 自定义 CSS 应使用 `[data-color-mode="dark"]` 选择器或 Ant Design token，而不要假设 `@media (prefers-color-scheme: dark)` 一定与当前模式一致（用户可能手动选了 `dark` 而系统是 light）。
- `styles.css` 的 `:root { color-scheme: light }` 只是初始值；provider 挂载后会设置内联 `colorScheme`，以内联值为准。

## 持久化键

| 存储 | key | 值 | 读取/写入 |
| --- | --- | --- | --- |
| `localStorage` | `qiy.ui.theme` | 主题 key | 挂载时读取，合法且在 `themes` 内才采用，否则用配置默认；每次变化写入 |
| `localStorage` | `qiy.ui.color-mode` | `light`/`dark`/`system` | 挂载时读取，非法值回退配置默认；每次变化写入 |
| `localStorage` | `qiy.ui.sider-collapsed` | `collapsed`/`expanded` | `QiyThemedLayout` 挂载时读取，折叠变化时写入 |
| `localStorage` | `qiy.locale` | BCP 47 标签 | 语言选择；见 [多语言](/dsl/i18n#语言选择与持久化) |
| `localStorage` | `qiy.charts.panel` | panel 名 | 概览页面板选择；见 [chart](/dsl/charts) |
| `localStorage` | `qiy.columns.<resource>` | `{ fields, selected }` JSON | 列表可见列偏好 |
| `localStorage` | `qiy.access_token` | 会话 JWT | DataProvider/AuthProvider 的 Bearer |
| `localStorage` | `qiy.id_token`、`qiy.expires_at` | OIDC id token 与过期时间 | OIDC 会话 |
| `sessionStorage` | `qiy.oidc.verifier`、`qiy.oidc.state`、`qiy.oidc.return_to`、`qiy.oidc.silent_attempt` | PKCE 中间态 | 登录/回调/静默续期 |

- 所有读取都包在 `try/catch` 中：隐私模式、配额满、禁用存储时静默回退默认值，不阻塞渲染。
- 主题与色彩模式**每次挂载都会写回**（即使没有用户操作），所以默认值也会被固化；修改 `ui` 默认值后，已访问过的用户仍保留旧选择。
- 清理浏览器存储会同时重置语言、主题、色彩模式、侧边栏、面板与列偏好。

## 生成结果

```text
apps/web/app/ui/
├── index.tsx          # QiyUiProvider、主题注册表、QiyThemeControls、sider 持久化
└── theme-config.ts    # 从 .qiy 生成的只读配置（qiyUiConfig）
apps/web/app/root.tsx  # QiyUiProvider 包裹 Refine；Header 渲染 QiyThemeControls + 语言选择
apps/web/app/styles.css# 布局/图表/文档/Mermaid 的 CSS
```

`app/ui/index.tsx` 的导出：

| 导出 | 用途 |
| --- | --- |
| `QiyThemeKey` / `QiyColorMode` | 类型 |
| `QiyUiProvider` | 读取/持久化主题与色彩模式，设置 `<html>` 属性，生成 AntD `ConfigProvider` + `App` |
| `useQiyUi()` | 读取 `themeKey`、`colorMode`、`resolvedColorMode`、`setThemeKey`、`setColorMode`；不在 provider 内会抛错 |
| `useQiyUiOptional()` | 同上，但 provider 外返回 `undefined`（SSR/独立组件用） |
| `QiyThemeControls` | Header 的主题下拉 + 色彩模式 `Segmented` |
| `siderCollapsedStorageKey` / `readStoredSiderCollapsed` / `storeSiderCollapsed` | 侧边栏折叠持久化 |
| `QiyThemedLayout` | 带持久化折叠状态的 `ThemedLayout`，默认使用 `QiySider` |
| `QiyThemedTitle` / `useQiyNotificationProvider` | 透传 Refine 的标题与通知 provider |

`theme-config.ts` 是 `as const` 的对象；生成器写入 `library`、`theme`、`themes`、`colorMode`、两个开关。页面代码只读取它，不写回。

## 控件行为

- 主题下拉：仅当 `allowThemeSwitch === true` **且** `qiyUiConfig.themes.length > 1` 时渲染；`aria-label` 为 `qiy.themeColor`；选项文案走 `qiy.theme<Key>`。
- 色彩模式：`Segmented`，仅当 `allowColorModeSwitch === true` 时渲染；`aria-label` 为 `qiy.colorMode`；三个选项 `qiy.colorLight` / `qiy.colorDark` / `qiy.colorSystem`。
- 语言选择：`Select`，`aria-label` 为 `qiy.language`；选项来自 `languageOptions`。
- Header 还显示"个人中心"入口（`qiy.profile`）。
- 两个开关都关闭时，界面固定使用配置的 `theme` 与 `colorMode`，用户无法在界面切换。

## 二次开发

### 支持的方式

1. **优先改 `.qiy`**：主题 key、默认主题、候选集合、初始明暗模式、是否允许切换，全部由 `ui` 块表达。
2. **业务页面级样式**：在未托管的扩展页面/组件中使用 Ant Design token（`theme.useToken()`）或自带 CSS Module，不要依赖全局覆盖。
3. **读取当前主题**：在 `QiyUiProvider` 内使用生成的 hook；叶子组件在可能脱离 provider 的场景用 `useQiyUiOptional()`。

```tsx
import { theme } from "antd";
import { useQiyUi, useQiyUiOptional } from "../ui";

export function BrandPreview() {
  const { themeKey, colorMode, resolvedColorMode } = useQiyUi();
  const { token } = theme.useToken();
  return (
    <span style={{ color: token.colorPrimary }}>
      {themeKey} / {colorMode} / {resolvedColorMode}
    </span>
  );
}

// SSR 测试或独立组件：provider 外返回 undefined，不抛错
const optional = useQiyUiOptional();
const mode = optional?.resolvedColorMode ?? "light";
```

4. **宿主级包装**：`qiy init` 挂在现有 Bun 项目时，宿主可以在 admin 外层再包一层 `ConfigProvider` 或主题脚本；这是宿主职责，不属于生成文件。
5. **文档/代码块外观**：生成的 `styles.css` 已为 `[data-color-mode="dark"]` 调整 Mermaid fallback 与代码块背景；更多覆盖可加在宿主全局样式（优先级高于生成样式即可）。

### 不要做

- 不要直接改 `app/ui/theme-config.ts` 来代替 `.qiy` 配置：它是 manifest 管理的生成文件，`--sync` 会覆盖。
- 不要假设可以长期手改 `app/ui/index.tsx` 或 `app/styles.css`：两者都在 `.qiy-generated.json` 的文件清单里，`--sync` 会重写；需要的品牌定制应记录在生成后补丁/宿主包装中，或在团队内维护 fork。
- 不要通过 CSS 强行改 Ant Design 主题色 token（如 `.ant-btn-primary`）：暗色算法、hover/active 派生色与 `data-theme` 会不同步，优先用 `ui.theme`/`ui.themes`。
- 不要为 Material UI / Mantine / Chakra 配置名字：解析阶段直接失败。

### 新增品牌色

当前主题 key 是封闭集合（`blue`、`purple`、`green`、`orange`、`red`），不能通过 `themes` 声明新名字，也没有 `primaryColor` 之类的自由色值配置。需要第六种品牌色时：

- 选最接近的内置 key，或在宿主层覆盖 `colorPrimary`；
- 或者维护生成器 fork（属于未支持范围，发布说明中应明确）。

## 暗色模式注意事项

| 区域 | 行为 |
| --- | --- |
| Ant Design 组件 | 使用 `darkAlgorithm`，背景/文字/边框自动适配 |
| Mermaid（功能总览） | `MermaidDiagram` 读取 `resolvedColorMode`，以 `theme: "dark"` / `"default"` 重新渲染；每次模式变化增加 render id，避免重复定义警告 |
| Mermaid 失败回退 | 显示原始源码；`[data-color-mode="dark"] .qiy-mermaid-fallback` 使用浅色半透明背景 |
| 文档代码块 | `.qiy-docs-code` 同样在暗色下切换背景；其他自定义 `<pre>` 需自己处理 |
| 图表（chart） | 卡片/表格/文字随 AntD 适配；**饼图调色板与折线颜色是硬编码浅色值**，不随主题/暗色变化 |
| 自定义 CSS | 用 `[data-color-mode="dark"]` 或 token；不要只写 `@media (prefers-color-scheme: dark)` |
| `color-scheme` | provider 在内联样式设置；表单控件、滚动条会跟随 |
| 首屏闪烁 | SSR/首次渲染时 `systemDark` 初始为 `false`，`system` 模式可能先以亮色绘制再切暗色；`dark` 模式在挂载时也会先按配置值渲染。对闪烁敏感的场景应在宿主 HTML 里预置 `data-color-mode`/背景色 |
| 图片/Logo | 不会自动反色；需要准备两套资源或使用 CSS filter |
| 第三方组件 | 未接入 AntD token 的库不会自动变暗 |

## SSR 与无头渲染

- 没有 `window` 时：`initialTheme()` / `initialColorMode()` 返回配置默认值；`matchMedia` effect 不执行；`readStoredSiderCollapsed` 返回 `false`。
- `QiyUiProvider` 的 `useEffect` 只在浏览器执行，因此 SSR 输出始终是配置默认主题与色彩模式，hydration 后再按存储/系统修正。
- `useQiyUiOptional()` 让 Mermaid 等叶子组件在不带 provider 的 SSR 测试中也能渲染（回退 `light`）。

## i18n

| key | 用途 |
| --- | --- |
| `qiy.themeColor` | 主题选择器无障碍标签 |
| `qiy.themeBlue` / `qiy.themePurple` / `qiy.themeGreen` / `qiy.themeOrange` / `qiy.themeRed` | 主题名 |
| `qiy.colorMode` | 色彩模式控件无障碍标签 |
| `qiy.colorLight` / `qiy.colorDark` / `qiy.colorSystem` | 模式名 |
| `qiy.language` | 语言选择器无障碍标签 |
| `qiy.profile` | 个人中心入口 |

这些键都在内置 chrome 词典里，项目 `messages` 可用同名 key 覆盖；键的动态拼接规则见 [多语言 · 主题与界面文案](/dsl/i18n#主题与界面文案)。

## 常见错误

| 现象/报错 | 原因 | 修复 |
| --- | --- | --- |
| `Unsupported UI library mui; only antd is implemented` | 配了其它 UI 库 | 改 `antd` |
| `Unsupported UI theme teal` | 主题 key 不在五个内置值 | 用内置 key |
| `UI default theme purple must be included in themes` | `theme` 不在 `themes` | 把默认主题加进 `themes` |
| `Duplicate UI setting theme` | 同一设置写两次 | 删除重复 |
| 主题下拉不出现 | `allowThemeSwitch false` 或 `themes` 只有一个 | 打开开关 / 增加候选 |
| 色彩模式控件不出现 | `allowColorModeSwitch false` | 打开开关 |
| 切换后刷新丢失 | `localStorage` 被禁用 | 属预期降级；可在宿主层接管持久化 |
| 改 `ui` 默认值后老用户不变 | 存储里的旧选择优先 | 清理 `qiy.ui.theme`/`qiy.ui.color-mode`，或换 key |
| 暗色下图表颜色不协调 | 图表调色板硬编码 | 属已知限制，见上表 |
| 生成后手改样式被覆盖 | `--sync` 重写 manifest 文件 | 改到宿主/扩展样式，或维护 fork |
| Mermaid 一直显示源码 | 渲染超时（10s）或抛错 | 检查图表语法/体积；fallback 是刻意降级 |

## 相关

- [application · ui](/dsl/application#ui)：`ui` 块在 `application` 中的位置与字段级说明。
- [多语言（messages / i18n）](/dsl/i18n)：主题/色彩模式文案与回退链。
- [chart（多视图图表）](/dsl/charts)：图表在暗色模式下的表现。
- [菜单与 Dashboard](/guide/menu-dashboard)：侧边栏折叠持久化与移动端抽屉。
- [Refine Providers](/guide/refine-providers)：`QiyUiProvider` 在 Refine 树中的位置与 Header。
- 完整示例：[`examples/themes/app.qiy`](https://github.com/AI-NoDev/qiy/blob/main/examples/themes/app.qiy)。
