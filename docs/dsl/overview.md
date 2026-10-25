# Qiy DSL 总览

Qiy 项目文件以 `qiy v0;` 开头，随后是一个 `application` 块。当前语法是受限文本方言，由 Qiy CLI 解析并生成完整的管理后台、API、数据层和部署配置。

```ts
qiy v0;

application qiy-erp-admin @comment("Operations administration") {
  database postgresql @comment("Primary operational database") {}
  storage { provider local; }
  auth { provider oidc; user users; subjectField externalSubject; roleField role; }
  workflow orderInventory;
}
```

## 顶层结构

| 块 | 作用 |
| --- | --- |
| `database` | 目标数据库方言与扩展 |
| `ui` | Refine UI adapter、主题 key、品牌色和明暗模式 |
| `api` | 前端 DataProvider 选择与 CORS |
| `features` | 系统管理功能开关：`apiDocs`（功能总览/OpenAPI/Mermaid）与 `apiKeys`（API Key 表、认证与管理页签） |
| `elysia` | 服务端插件组合 |
| `storage` | 文件存储 provider |
| `auth` | 外部身份映射 |
| `messages` | 多语言消息字典与默认语言，供模型描述和 Refine 界面引用 |
| `workflow` | 业务工作流声明 |
| `enum` | 有限枚举与配色、icon |
| `entity` | 实体、字段与索引 |
| `relation` | 实体关系与外键策略 |
| `scope` | 单字段租户数据范围 |
| `restrict` | 记录级条件与字段脱敏；与 `scope` 叠加，不替代它 |
| `permission` | 原子权限、权限组（角色即权限组）、provider 来源与权限校验表达式 |
| `menu` | 菜单分组与层级 |
| `dashboard` | 概览页指标（旧式单卡片） |
| `chart` / `chart panels` | 概览页多视图图表 + 响应式栅格面板（`data = ...` 迷你语言、`grid`/变体） |
| `dataflow` | 声明式服务端业务命令；当前可执行受限的加载、条件校验与事务更新 |
| `action` | 将显式 Dataflow 命令或手写业务页挂载到列表与详情操作区 |

## UI adapter 与主题

当前生成器以 Ant Design 为已验收 UI adapter。`.qiy` 的 `ui` 块可以声明主题 key 列表、默认主题、`light` / `dark` / `system` 模式及 Header 切换开关。生成代码将主题状态和 Ant Design `ConfigProvider` 收敛到 `app/ui/`，Header 同时保留语言选择器。CRUD 页面优先采用 Refine Ant Design 官方页面壳与按钮，再使用 Ant Design 原生组件补足动态字段、批量操作和业务 Action。

```qiy [app.qiy]
ui {
  library antd;
  theme green;
  themes green, blue, purple;
  colorMode system;
  allowThemeSwitch true;
  allowColorModeSwitch true;
}
```

完整例子见 [themes/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/themes/app.qiy)。Material UI、Mantine 和 Chakra 尚未实现完整 adapter；在 Layout、Notification、Auth、CRUD 和表单都通过真实生成验收前，不会标记为支持。

## 标识符与注释

- 标识符匹配 `[a-zA-Z_][a-zA-Z_0-9-]*`；
- `//` 和 `#` 都可用于行注释；`application`、`database`、实体、字段、索引、关系、枚举、枚举值、菜单分组、Dashboard 指标、Dataflow 的根/input/context/step 及手写 Action 页支持 `@comment("...")` 与 `@comment(t("key"))`。尚未列出的配置块不能假定支持注释，未知或重复注解会在生成前失败。
- `application` 注释成为根、Server 和 Web `package.json` 的 `description`；`database` 注释成为生成 Drizzle `schema.ts` 的文件级 JSDoc。实体、字段、索引与外键关系说明进入 PostgreSQL/MySQL/SQLite Drizzle schema 的 JSDoc；实体说明也进入 repository 接口和 service 工厂函数。生成代码使用默认语言并保留 `i18n: key`，前端继续在运行时切换语言。这些是源码和包元数据说明，不会执行数据库 `COMMENT ON` 或修改迁移行为。
- 字符串使用双引号或单引号。
- `entity` 支持显示注解 `@singular`、`@plural`、`@display`、`@tableDisplay`、`@relationDetail`：外键列按目标实体的显示模板渲染成链接与 Drawer，而不是裸 UUID；列表页的外键值按目标资源批量加载（`getMany` + `useMany` 的 `id in (...)` 过滤，一页每资源一条请求），详情页/抽屉/下拉保留单条 `useOne` 回退；模板语法与校验见 [entity 与 field 的实体显示注解](/dsl/entity#实体显示注解-django-风格)。
- `field` 支持服务端生成值：`@code("ORG-{YYYY}{MM}-{seq:4}")` 渲染业务编码，`@generated(uuid)` 生成 UUIDv4；非主键且没有 relation 的 `UUID` 字段默认由服务端生成并在表单中隐藏。语法、模板 token、时区与并发唯一性见 [自动生成值与业务编码](/dsl/generated-values)。
- 项目可以通过 [`include` 模块](../guide/modules) 将 `application` 内容拆分到多个相对 `.qiy` 文件。

## 消息与模型描述

`messages` 放在 `env`（若有）之后、`workflow` / `enum` / `entity` 之前；先声明默认语言，再声明各语言字典。语言标识使用规范 BCP 47 格式，例如 `en-US`、`zh-CN`、`fr-FR`、`ja-JP` 和 `ar-EG`；`fr_fr` 或大小写不规范的 `FR-fr` 会被拒绝。

```qiy [app.qiy]
qiy v0;
application reviews-admin @comment(t("application.reviews")) {
  database sqlite @comment(t("database.reviews")) {}
  messages {
    default "en-US";
    locale "en-US" {
      "application.reviews" "Review operations console";
      "database.reviews" "Review workflow records";
      "review.note" "Explain the decision";
    }
    locale "zh-CN" {
      "application.reviews" "审核运营后台";
      "database.reviews" "审核流程记录";
      "review.note" "请说明审核决定";
    }
  }
  entity reviews @comment("Review requests") {
    field id UUID @id;
    field note Text @comment(t("review.note"));
  }
}
```

默认语言必须存在，引用的 key 必须在默认字典中声明；重复语言、重复 key 与危险属性名会在生成前报错。Web 优先使用项目消息，缺失翻译回退到默认语言，字段提示、命令输入描述、Action 的 `label`/`confirm` 和新生成的手写 Action 占位页说明随界面语言切换。REST CRUD 与命令的 TypeBox/OpenAPI 描述使用默认语言；GraphQL 实体类型、Create/UpdateInput 及公开字段描述也使用默认语言，密码字段保持排除。

应用、数据库、索引、关系、context 和 step 描述均保存在模型并支持序列化往返；各对象只生成本章节明确列出的元数据、源码文档或界面说明，不会自动创建数据库注释迁移。业务错误本地化仍待完善；`include "modules/catalog.qiy" @messages;` 已可只导入目标文件唯一的顶层 `messages` 块，`@message` 是兼容别名。其他选择器尚未实现。完整描述示例见 [documented-inputs.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/dataflow/documented-inputs.qiy)。

### Refine 界面翻译

生成的 `app/i18n.ts` 使用 i18next 实现 [Refine I18nProvider](https://refine.dev/core/docs/i18n/i18n-provider/)：`translate(key, options, defaultMessage)` 和 `translate(key, defaultMessage)` 均返回字符串；`changeLocale` 返回 Promise，未声明的语言会被拒绝。使用 Refine 的 `useTranslation()`，无需额外用户配置文件。

```qiy [modules/messages.qiy]
messages {
  default "fr-FR";
  locale "fr-FR" {
    "product.description" "Description du produit";
    "qiy.new" "Nouveau";
    "buttons.save" "Enregistrer";
    "notifications.createSuccess" "{{resource}} créé";
    "product.items_one" "{{count}} produit";
    "product.items_other" "{{count}} produits";
  }
  locale "en-US" {
    "product.description" "Product description";
    "product.items_one" "{{count}} product";
    "product.items_other" "{{count}} products";
  }
}
```

在主文件的 `application` 内通过 `include "modules/messages.qiy";` 引入完整片段；若文件还包含其他声明，可使用 `include "modules/messages.qiy" @messages;` 仅引入消息字典。`qiy.*` 覆盖生成页面操作文字，`buttons.*`、`notifications.*`、`actions.*`、`table.actions` 等使用 Refine 官方翻译键；`{{resource}}`、`{{seconds}}` 等参数交由 i18next 插值。复数使用 `_one` / `_other` 等 CLDR 分类，并传入 `translate("product.items", { count: 2 })`。

### 模型 label 的自动翻译键

除了 `@comment(t("key"))` 这种显式引用，生成器会为每个模型派生 label 自动生成稳定 key，并在渲染时用 `translate(key, {}, "<声明的原文>")` 查询词典：词典缺失时回退到 DSL 原文，因此没有 `messages` 块的项目行为与旧版本一致。key 只由声明的标识符推导，修改 label 文案不会破坏翻译：

| Key | 覆盖的界面文案 |
| --- | --- |
| `qiy.resources.<resource>.label` | 菜单、面包屑、列表/新建/编辑/详情标题、关联记录卡片 |
| `qiy.resources.<resource>.singular` / `.plural` | 新建/编辑/详情/抽屉标题、按钮（单数）与菜单、列表标题（复数） |
| `qiy.resources.<resource>.fields.<field>.label` | 列表列头、详情字段名、表单 label、筛选占位符、关联表列头 |
| `qiy.enums.<enum>.label` / `qiy.enums.<enum>.values.<value>` | 枚举值 Tag、下拉选项（显示模板中的枚举字段同样走这里） |
| `qiy.menu.<group>.label` | 菜单分组 |
| `qiy.charts.<chart>.label` / `qiy.charts.<chart>.views.<kind>.label` / `qiy.charts.<chart>.labels.<value>` | 概览页图表卡片/面板标题、视图标题（kind = const/pie/bar/line/table）与分布数值文案覆盖 |
| `qiy.dashboard.<metric>.label` | Dashboard 指标卡 |
| `qiy.actions.<action>.label` / `.confirm` / `.inputs.<input>.label` | 业务命令按钮、确认文案、命令表单字段与枚举选项 |

系统管理功能的界面文案（功能总览页签、Mermaid/API/权限表头）与访问密钥按钮使用内置 chrome 键 `qiy.docs.*`、`qiy.apiKey.*`、`qiy.chartViewKind.*`（zh-CN/en-US 随生成器输出，可在 `messages` 中用同名 key 覆盖）；它们不是模型派生 key，所以不参与 `model-i18n` 的完整性断言。

`singular` / `plural` 缺失时分别回退到 `label` 与 DSL 里的 `@singular` / `@plural` / `@label` 原文；`@display`、`@tableDisplay`、`@relationDetail` 模板本身由字段引用和分隔符组成，不参与翻译。生成器会为每个实体输出这两个 key，并在 `web/tests/model-i18n.test.ts` 中断言。

其中 `<resource>` 使用资源名（实体默认取 `table` 名）。生成的 `web/tests/model-i18n.test.ts` 会遍历所有资源、字段、枚举、菜单、Dashboard 指标与命令，断言 key 稳定、词典按语言解析、缺失时回退原文；仓库侧 `tests/example-modules.test.ts` 校验示例模型的词典完整覆盖全部模型 label。`apps/web/app/i18n.ts` 还提供 `qiy.filters.mode.<mode>`（筛选操作符）等 `qiy.*` 覆盖点。

### 界面 chrome 文案

生成页面自身的操作文案（不来自模型）使用同一套 `qiy.*` 键，并随生成的 `app/i18n.ts` 内置中英文词典一起发布；项目 `messages` 块仍可用相同 key 覆盖。生成的 `web/tests/chrome-i18n.test.ts` 断言这些键在中英文下都能解析。主要分组：

| Key 分组 | 覆盖的界面文案 |
| --- | --- |
| `qiy.new` / `qiy.edit` / `qiy.delete` / `qiy.search` / `qiy.visibleColumns` … | 列表工具栏、批量操作、详情/表单按钮 |
| `qiy.import` / `qiy.export` / `qiy.exportSelected` / `qiy.importProgress` / `qiy.importedRows` | CSV 导入导出按钮、进度与结果通知 |
| `qiy.views` / `qiy.viewName` / `qiy.saveView` / `qiy.saveToServer` / `qiy.shareView` / `qiy.publishView` / `qiy.saved` / `qiy.deleteView` / `qiy.shared` | 已存视图的下拉、弹层、共享标记与通知 |
| `qiy.viewDeleted` / `qiy.viewDeleteFailed` / `qiy.confirmDeleteView` / `qiy.viewMine` / `qiy.viewPublishedTag` / `qiy.viewSharedTag` | 视图删除结果通知、删除确认，以及下拉中"个人 / 发布 / 共享"三种来源标记 |
| `qiy.matchAll` / `qiy.matchAny` / `qiy.commaSeparated` / `qiy.filters.mode.*` | 筛选组合与操作符名称 |
| `qiy.paginationTotal` / `qiy.perPage` / `qiy.page` | 分页总数与每页条数文案 |
| `qiy.themeColor` / `qiy.themeBlue` … `qiy.themeRed` / `qiy.colorMode` / `qiy.colorLight` / `qiy.colorDark` / `qiy.colorSystem` | Header 主题色与明暗模式控件（品牌名 "Qiy Admin" 不翻译） |
| `qiy.profileTitle` / `qiy.account` / `qiy.signOut` / `qiy.bind` / `qiy.unbind` / `qiy.unlinkTitle` … | 个人中心、账号信息、绑定/解绑与最后登录方式提示 |
| `qiy.finishAccount` / `qiy.confirmAccount` / `qiy.fieldRequired` / `qiy.passwordMin` / `qiy.createAccount` … | 首次 OAuth 账号开通表单与校验提示 |
| `qiy.completingSignIn` / `qiy.providerLoginFailed` / `qiy.multiProviderHint` / `qiy.otp*` / `qiy.oidc*` | 登录/回调/OTP/OIDC 页面文案 |
| `qiy.forbidden` / `qiy.createForbidden` / `qiy.auditTitle` / `qiy.treeNodesCount` / `qiy.relatedUnknown` | 403 页、页面级权限提示、审计历史、树视图与关联记录 |
| `qiy.createResource` / `qiy.editResource` / `qiy.openDetail` / `qiy.searchRelation` | 新建/编辑资源标题（插入单数名）、外键抽屉的“打开详情”按钮与关联下拉搜索占位符 |
| `qiy.drawerBreadcrumb` / `qiy.recordDetails` / `qiy.recordSummary` / `qiy.close` | 外键抽屉的面包屑无障碍名称、字段详情区标题、`@relationDetail` 摘要区标题与底部关闭按钮 |
| `qiy.autoGenerated` | 新建（隐藏生成字段时的只读提示）与编辑（禁用输入框的 tooltip）：生成字段由服务端填写 |

这些键的默认值写在生成器的 chrome 词典中（`app/i18n.ts` 的 `localeMessages`），与 Refine 官方键（`buttons.*`、`notifications.*`、`pages.login.*`）一起注入 i18n provider；`t(locale, key)` 会先查项目 `messages` 中的 `qiy.<key>`，再回退内置词典。

### 语言选择与持久化

语言选择器切换后同时更新 Refine i18n、Ant Design `ConfigProvider` locale 和 `document.documentElement.lang/dir`；选择写入 `localStorage` 的 `qiy.locale`（由生成的 `readStoredLocale` / `storeLocale` 读写），刷新后保持上次选择，未声明或损坏的值回退到 `messages` 的默认语言（无 `messages` 时为 `zh-CN`）。

语言选择器包含内置中英文及模型声明的语言。Ant Design 组件按已声明的语言自动加载中英、日、韩、法、德、西班牙、巴西葡萄牙、俄、埃及阿拉伯、印地、意大利及繁体中文语言包；其他标签的组件暂回退英语。阿拉伯语、波斯语、希伯来语和乌尔都语切换为 RTL，并同步页面 `lang` / `dir`。

当前模型 label（资源、字段、枚举值、菜单、Dashboard、命令与命令输入）与生成页面的 UI chrome（列表工具栏、已存视图、分页、主题/明暗控件、403 页、个人中心、首次登录 onboarding、登录/回调页面）均已由自动键或内置 chrome 词典覆盖，Refine 内置按钮与通知使用预置中英文键。仍未覆盖的是 Refine/第三方组件自身未预置的文案、登录提供方品牌名等外部数据，以及需要业务自定义的扩展页面文案（可在项目 `messages` 中补充 `qiy.*` 或其他自定义 key）。四语言完整例子见 [multilingual/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/multilingual/app.qiy)，中文/英文全量示例见 [examples/self](https://github.com/AI-NoDev/qiy/blob/main/examples/self/app.qiy)。

## CLI 使用

```powershell
bun run tools/generate-app.ts <source> <output-dir> [--sync]
```

`source` 是 `.qiy` 项目文件。输出目录必须为空，除非显式传入 `--sync`。

## 各章节

- [application](/dsl/application)：数据库、API、认证、存储、工作流
- [entity 与 field](/dsl/entity)：字段类型与属性
- [自动生成值与业务编码](/dsl/generated-values)：`@code` / `@generated`、模板语法、时区与并发唯一性
- [relation 与 index](/dsl/relation-index)：关系与索引
- [enum / menu / dashboard](/dsl/enum-menu-dashboard)：界面配置
- [chart（多视图图表）](/dsl/charts)：`chart` / `chart panels` 语法、视图类型与校验规则
- [features（系统管理功能开关）](/dsl/features)：`features { apiDocs; apiKeys }`、OpenAPI 过滤规则与 API Key 模型
- [dataflow](/dsl/dataflow)：可执行子集、生命周期与后续路线
- [权限（permission）](/dsl/permissions)：原子权限、权限组、provider 来源与校验表达式
- [action](/dsl/actions)：列表/详情操作、命令确认与手写业务页扩展
- [realtime](/dsl/realtime)：资源订阅、角色 capability 与 Refine LiveProvider
