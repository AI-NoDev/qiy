# Qiy DSL 总览

Qiy 项目文件（`.qiy`）是一份**声明式全栈模型**：一个 `application` 块描述数据库、服务端能力、认证、界面与业务命令，Qiy CLI 把它编译成可编辑的 Refine + React Router 管理端、Bun + Elysia API、Drizzle 数据层、测试与部署配置。

```qiy
qiy v0;

application qiy-erp-admin @comment("Operations administration") {
  database postgresql @comment("Primary operational database") {}
  storage { provider local; }
  auth { provider oidc; user users; subjectField externalSubject; roleField role; }

  enum role { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field externalSubject Text @unique;
    field role role;
  }
}
```

这是一个**可生成**的最小模型：一个实体、一个枚举、OIDC 认证与本地存储。

- 一个文件只有一个 `application`；大型项目用 [`include`](/dsl/modules) 拆分。
- 语法是**受限文本方言**：没有表达式、没有函数、没有模板字符串；取值、顺序、可选值全部在生成前校验。
- 解析成功 ≠ 生成成功：还有一层生成期校验（主键、图标名、认证列、scope 资源等），见[校验流水线](#校验流水线)。

## 词法规则

### 字符与 token

| 类别 | 规则 | 示例 |
| --- | --- | --- |
| 标识符 | `[a-zA-Z_][a-zA-Z_0-9-]*`（**允许内部连字符**） | `orders`、`azure-ad-b2c`、`userRole`、`order_items` |
| 整数 | `-?\d+`（负数只用于 dataflow 的整数比较） | `1536`、`8`、`-1` |
| 双引号字符串 | JSON 字符串字面量：支持 `\" \\ \/ \b \f \n \r \t \uXXXX` | `"用户总数"`、`"a\nb"` |
| 单引号字符串 | 只转义 `\\` 与 `\'`，其他反斜杠**原样保留** | `'C:\path'`、`'it\'s'` |
| 注释 | `#` 或 `//` 到行尾（字符串内的不算） | `# 领域说明`、`// legacy note` |
| 多字符符号 | `&&`、`\|\|`、`==`、`!=`、`>=`、`<=` | 权限与策略表达式 |
| 单字符符号 | `{ } ( ) ; , @ . = < > ! & \|` | 结构 |
| 空白 | 任意数量，仅用于分隔 | — |

任何不在上表的字符（`:`、`[`、`]`、`*`、`+`、`%`、`?`、`$`、反引号、非 ASCII 字符等）都会让词法阶段报：

```text
Unexpected Qiy syntax at offset 123
```

因此**中文、空格、冒号、点号等内容必须放在引号里**（`"CN-0001"`、`"https://…"`、`"{seq:4}"` 都在字符串内）。标识符允许连字符，所以 `azure-ad-b2c` 可以裸写，但 `bad key` 不行。

### 注释与文档

- 只有行注释：`#` 与 `//`。**没有块注释，也没有“文档注释”语法**。
- 模型文档用 `@comment("…")` 或 `@comment(t("key"))` 表达，会进入生成的 JSDoc、i18n key 与界面提示（见 [注解总览](/dsl/annotations)）。
- 注释在 include 展开时原样保留，但不参与任何校验。

### 字符串与取值

很多位置接受“字符串或裸标识符”两种写法（`value()`）：

```qiy
@label("产品")          // 推荐：显式字符串
@label(Products)        // 合法：ASCII 标识符
@icon(AppstoreOutlined)
@color(red)
theme blue
@onDelete(setNull)
```

裸值不能包含空格、冒号或非 ASCII 字符；一旦需要，就必须加引号。**双引号与单引号不是等价的**：`"a\nb"` 是换行，`'a\nb'` 是字面量反斜杠加 `n`；写路径或模板时建议统一用双引号。

### 分号与分隔符

| 位置 | 分号 | 说明 |
| --- | --- | --- |
| `field` / `index` / `relation` / `scope` / `metric` / `permission field` / `permission from` / `workflow` / `variable` 声明 | 必须 | 缺少时报 `Expected ; near token N` |
| 块（`database`、`ui`、`entity`、`enum`、`menu`、`chart` …）的 `}` | **不加** `;` | 多写一个 `;` 会报 `Expected … near token N` |
| `permission group … { … }` | 可选 | 列表形式后面可以跟 `;` |
| `permission verification … { … }` | 可选 | 同上 |
| `chart` 视图属性 `icon = …; title = …; data = …;` | 属性之间必须 `;`；**最后一个属性在 `}` 前可以省略** | `Chart X: expected ; after the property value but found …` |
| `emit`/`call` 的 `{ … }` 负载块 | 块后的 `;` 可选 | 负载内每个赋值必须 `;` |
| `require … @error("…");` | 必须 | — |

### 数字

整数只用于数值参数与坐标：类型参数（`Decimal(12,2)`、`Vector(1536)`）、`@span`/`@days`/`@maxBytes`/`@maxFiles`/`@order`/`@dimension` 等注解、`chart panels` 的 `grid` 与坐标、dataflow 的整数比较。浮点数没有语法；需要小数时用 `Decimal`/`Money` 类型。

## 顶层构造地图

`application` 内的声明顺序固定（下一节），下图按“出现顺序”列出所有构造及其文档：

| # | 构造 | 作用 | 文档 |
| --- | --- | --- | --- |
| 0 | `qiy v0;` | 版本头，必须第一行 | 本页 |
| 1 | `application <name> [@comment] { … }` | 应用根 | [application](/dsl/application) |
| 2 | `database <dialect> [@comment] { extension …; }` | 方言与扩展 | [application · database](/dsl/application#database) |
| 3 | `mode standalone\|integration;` + `integration { … }` | 独立生成 / 宿主集成 | [application · integration](/dsl/application#mode-与-integration) |
| 4 | `workspace { … }` | `qiy init` 的目录/包名 | [application · workspace](/dsl/application#workspace) |
| 5 | `ui { … }` | UI adapter、主题、明暗模式 | [application · ui](/dsl/application#ui) |
| 6 | `api { client …; cors { … } }` | 前端 transport 与 CORS | [application · api](/dsl/application#api) |
| 7 | `features { … }` | 系统管理页面开关 | [features](/dsl/features) |
| 8 | `realtime { … }` | 实时订阅 | [realtime](/dsl/realtime) |
| 9 | `elysia { … }` | 服务端插件 | [application · elysia](/dsl/application#elysia) |
| 10 | `storage { provider …; }` | 文件存储 | [storage](/guide/storage) |
| 11 | `auth { … }` | 认证与身份映射 | [auth](/dsl/auth) |
| 12 | `env { variable … { … } }` | 自定义环境变量 | [application · env](/dsl/application#env) |
| 13 | `messages { … }` | 多语言词典 | [多语言](/dsl/i18n) |
| 14 | `permission …` | 原子权限/组/来源/校验 | [权限](/dsl/permissions) |
| 15 | `workflow orderInventory;` | 业务流程 | [application · workflow](/dsl/application#workflow) |
| 16 | `enum … { value …; }` | 枚举 | [enum/menu/dashboard](/dsl/enum-menu-dashboard#enum) |
| 17 | `entity … { field …; index …; }` | 实体与字段/索引 | [entity 与 field](/dsl/entity) |
| 18 | `relation …;` | 外键与关联 | [relation 与 index](/dsl/relation-index) |
| 19 | `scope …;` | 数据范围 | [application · scope](/dsl/application#scope) |
| 20 | `restrict … { … }` | 行级/字段级策略 | [application · restrict](/dsl/application#restrict) |
| 21 | `pages … { … }` | 页面级角色规则 | [application · pages](/dsl/application#pages) |
| 22 | `menu { group … { resource …; } }` | 侧边栏 | [enum/menu/dashboard · menu](/dsl/enum-menu-dashboard#menu) |
| 23 | `dashboard { metric …; }` / `chart …` / `chart panels …` | 概览页 | [dashboard](/dsl/enum-menu-dashboard#dashboard)、[chart](/dsl/charts) |
| 24 | `dataflow … { … }` | 事务型命令 | [dataflow](/dsl/dataflow) |
| 25 | `action … { … }` | 命令按钮/手写页 | [action](/dsl/actions) |

## 顺序即语法

解析器是**单遍递归下降**：它按固定顺序 `expect` 下一个关键字，看到不认识的东西就报 `Expected <关键字> near token N`。所以：

- 块必须按上表顺序出现；`enum` 必须在 `entity` 之前，`entity` 必须在 `relation` 之前，`menu` 在 `pages` 之后、`dashboard`/`chart` 之前，`dataflow` 在 `action` 之前。
- `database` 必须是 `application {` 后的第一个声明。
- `permission` 必须紧跟在 `messages` 之后（在 `workflow`/`enum` 之前）。
- `dashboard` 与 `chart` 共享同一位置，可以交替书写；`menu` 最多一个。
- 可选的单例块（`mode`、`integration`、`workspace`、`ui`、`api`、`features`、`realtime`、`elysia`、`storage`、`auth`、`env`、`messages`）缺省即用默认值，但**位置不能乱**：跳过的块不影响后面块的位置要求。
- 展开 include 后仍必须满足上述顺序——这是[模块化](/dsl/modules)最容易踩的坑。

完整顺序表见 [application · 块顺序与基数](/dsl/application#块顺序与基数)。

## 校验流水线

```text
include 展开  →  词法/语法解析  →  IR 校验  →  生成期校验  →  写文件
```

| 阶段 | 实现 | 检查内容 | 典型错误 |
| --- | --- | --- | --- |
| 1. include 展开 | `tools/qiy-include.ts` | 相对路径、`.qiy` 后缀、符号链接与 `..` 逃逸、循环引用、选择器 | `Qiy include cycle detected: …`、`include path cannot contain ..` |
| 2. 词法 + 语法 | `parseQiyProject` | token、块顺序、枚举/注解取值、重复声明、模板语法、图表语义、权限模型、跨块引用（pages/restrict/menu/chart/dataflow/action） | `Expected entity near token 42`、`Unsupported field attribute @required` |
| 3. IR 校验 | `validateDatabaseIR` | 名称/类型/索引/关系/显示模板（带外键信息） | `V3 foreign keys require UUID fields`、`cannot interpolate foreign key field X` |
| 4. 生成期校验 | `generateServer` / `generateWeb` / `generateProject` | 主键形态、图标名、路由名、认证列、scope/restrict、菜单/指标、CORS、cron/static、features 依赖、权限来源 | `V0 CRUD requires exactly one UUID primary key named id`、`Auth: roleField must be an enum …` |
| 5. 写文件 | `generateApp` | 路径安全、env 合并、manifest、`--sync` 清理 | `Invalid generated file path`、`Output directory must be empty` |

要点：

- 阶段 2 的语法错误**立即抛出**（只报第一处）；阶段 3/4 会**收集全部错误**并用换行拼接后一次抛出（`errors.join("\n")`）。
- 失败时 CLI 以退出码 1 结束，且生成阶段失败不会写入文件（`--sync` 的清理也在生成成功之后才开始）。
- 解析成功不代表能生成：例如实体缺 `id UUID @id`、`@icon` 不是 `*Outlined`、`auth` 的 `roleField` 不是三值枚举，都在阶段 4 才失败。
- `qiy generate` 还要求输出目录为空（除非 `--sync`），并且源文件必须是 `.qiy`。

## 消息与模型描述

`messages` 块声明默认语言与词典，位置在 `env` 之后、`permission`/`workflow`/`enum`/`entity` 之前：

```qiy
messages {
  default "zh-CN";
  locale "zh-CN" {
    "app.title" "运营后台";
    "review.note" "请说明审核决定";
  }
  locale "en-US" {
    "app.title" "Operations console";
    "review.note" "Explain the decision";
  }
}
```

- `default` 必须是规范 BCP 47 标签，且必须存在同名 `locale` 块（缺失报 `Missing default message locale X`）。
- key 必须匹配 `[a-zA-Z_][a-zA-Z_0-9.-]*`，且不能包含 `__proto__` / `prototype` / `constructor` 段。
- 模型描述用 `@comment(t("key"))` / `@label(t("key"))` 引用词典；生成代码保存默认语言文案，并在 JSDoc 里写 `i18n: key`，界面运行时按当前语言切换。
- 词典缺失时回退到声明的原文（DSL label），因此没有 `messages` 的项目行为与旧版本一致。
- 生成的 `apps/web/app/i18n.ts` 实现 Refine `I18nProvider`（`translate(key, options, defaultMessage)`）；语言选择持久化在 `localStorage` 的 `qiy.locale`。

完整词典语法、复数（`_one`/`_other`）、RTL 与 Ant Design locale 加载规则见 [多语言（messages / i18n）](/dsl/i18n)。

## i18n 键

Qiy 有三类翻译来源，按优先级合并：

1. **项目 `messages` 词典**（默认语言 + 各语言）；
2. **模型派生键**（由标识符推导，见下表），词典缺失时回退到 DSL 原文；
3. **生成器内置 chrome 词典**（界面自身文案，`qiy.*`），可用同名 key 覆盖。

### 模型派生键

| Key | 覆盖内容 | 来源 |
| --- | --- | --- |
| `qiy.resources.<resource>.label` | 菜单、面包屑、列表/新建/编辑/详情标题 | `entity` 的 `table` 名 |
| `qiy.resources.<resource>.singular` / `.plural` | 单数/复数文案（按钮/菜单/标题） | `entity` 的 `@singular` / `@plural` |
| `qiy.resources.<resource>.fields.<field>.label` | 列头、详情字段名、表单 label、筛选占位符 | `field` 名 |
| `qiy.enums.<enum>.label` / `.values.<value>` | 枚举名与枚举值 Tag/选项 | `enum` 名与值名 |
| `qiy.menu.<group>.label` | 菜单分组 | `menu group` 名 |
| `qiy.dashboard.<metric>.label` | 概览指标卡 | `metric` 名 |
| `qiy.charts.<chart>.label` / `.views.<kind>.label` / `.labels.<value>` | 图表面板/视图/分布文案 | `chart` 名、视图 kind、值 |
| `qiy.actions.<action>.label` / `.confirm` / `.inputs.<input>.label` | 业务命令按钮、确认文案、输入表单 | `action` 名与输入名 |

`<resource>` 使用实体的 `table` 名（`entity products table catalog_products` → `qiy.resources.catalog_products.*`）。键只由声明的标识符推导，改文案不会破坏翻译。

### 显式注释键

`@comment(t("key"))` / `@label(t("key"))` 直接引用词典键；生成代码使用默认语言的文案，同时在 JSDoc 里保留 `i18n: key`，界面运行时按当前语言解析。key 必须在**默认语言**里存在，否则报 `Missing default locale message for <purpose>: <key>`。

```qiy
qiy v0;
application reviews-admin @comment(t("application.reviews")) {
  database sqlite @comment(t("database.reviews")) {}
  messages {
    default "en-US";
    locale "en-US" { "application.reviews" "Review operations console"; "database.reviews" "Review workflow records"; }
    locale "zh-CN" { "application.reviews" "审核运营后台"; "database.reviews" "审核流程记录"; }
  }
  entity reviews @comment("Review requests") { field id UUID @id; field note Text; }
}
```

### 界面 chrome 文案

生成页面自身的文案使用内置 `qiy.*` 键（zh-CN / en-US 随生成器输出），项目 `messages` 可用同名 key 覆盖：

| Key 分组 | 覆盖内容 |
| --- | --- |
| `qiy.new` / `qiy.edit` / `qiy.delete` / `qiy.batchDelete` / `qiy.search` / `qiy.filters` / `qiy.visibleColumns` / `qiy.detail` / `qiy.yes` / `qiy.no` / `qiy.noData` | 列表工具栏、批量操作、确认弹窗、详情/表单按钮 |
| `qiy.import` / `qiy.export` / `qiy.exportSelected` / `qiy.importedRows` / `qiy.importFailed` | CSV 导入导出 |
| `qiy.views` / `qiy.viewName` / `qiy.saveView` / `qiy.saveToServer` / `qiy.shareView` / `qiy.publishView` / `qiy.saved` / `qiy.deleteView` / `qiy.viewDeleted` / `qiy.viewDeleteFailed` / `qiy.confirmDeleteView` / `qiy.viewMine` / `qiy.viewPublishedTag` / `qiy.viewSharedTag` | 已存视图（本地 + 服务端） |
| `qiy.matchAll` / `qiy.matchAny` / `qiy.commaSeparated` / `qiy.filters.mode.*` | 筛选组合与 operator 名称 |
| `qiy.paginationTotal` / `qiy.perPage` / `qiy.page` | 分页文案 |
| `qiy.themeColor` / `qiy.themeBlue` … `qiy.themeRed` / `qiy.colorMode` / `qiy.colorLight` / `qiy.colorDark` / `qiy.colorSystem` | Header 主题色与明暗控件 |
| `qiy.profileTitle` / `qiy.account` / `qiy.username` / `qiy.email` / `qiy.role` / `qiy.passwordSet` / `qiy.passwordNotSet` / `qiy.bind` / `qiy.unbind` / `qiy.linked` / `qiy.notLinked` / `qiy.signOut` | 个人中心与绑定 |
| `qiy.finishAccount` / `qiy.confirmAccount` / `qiy.fieldRequired` / `qiy.passwordMin` / `qiy.passwordMismatch` / `qiy.createAccount` | 首次 OAuth 登录 onboarding |
| `qiy.completingSignIn` / `qiy.multiProviderHint` / `qiy.otpHint` / `qiy.otpCode` / `qiy.oidcHint` / `qiy.loginNotConfigured` | 登录/回调/OTP/OIDC 页面 |
| `qiy.forbidden` / `qiy.createForbidden` / `qiy.editForbidden` / `qiy.auditTitle` / `qiy.treeView` / `qiy.treeNodesCount` / `qiy.relatedUnknown` | 403、审计历史、树视图 |
| `qiy.createResource` / `qiy.editResource` / `qiy.openDetail` / `qiy.searchRelation` / `qiy.drawerBreadcrumb` / `qiy.recordDetails` / `qiy.recordSummary` / `qiy.close` | 资源标题、外键抽屉与面包屑 |
| `qiy.autoGenerated` | 生成字段的只读提示 |
| `qiy.chartView` / `qiy.chartViewKind.*` | 图表视图切换 |
| `qiy.docs.*` / `qiy.apiDocs.*` / `qiy.apiKey.*` | 系统管理：功能总览、API 文档、访问密钥 |
| `qiy.pickDate` / `qiy.pickTime` / `qiy.pickDateTime` | 日期/时间选择器占位符 |

语言选择写入 `localStorage` 的 `qiy.locale`；缺失/损坏/未声明的值回退到 `messages` 默认语言（无 `messages` 时为 `zh-CN`）。生成器随包输出中英、日、韩、法、德、西、葡（巴西）、俄、阿拉伯（埃及）等 Ant Design 语言包；阿拉伯语等 RTL 语言会同步 `<html dir="rtl">`。完整词典语法与复数规则见 [多语言（messages / i18n）](/dsl/i18n)。

## 生成结果

一次成功的生成会写出一个 **Turborepo + Bun workspace**（结构见[生成的项目结构](/guide/project-structure)）：

| 路径 | 内容 | 由谁生成 |
| --- | --- | --- |
| `apps/server/src/` | Drizzle schema、repository、service、REST/GraphQL 路由、auth、storage、realtime、`generated-values.ts`、`http.ts` | `generate-server.ts` |
| `apps/server/tests/` | 契约/过滤/策略/生成值等测试 | `generate-server.ts` |
| `apps/web/app/` | `resources.ts`、`routes/`、`components/`、`providers/`、`ui/`、`i18n.ts`、`data-provider.ts`、`root.tsx` | `generate-web.ts` |
| `apps/web/tests/` | 列可见性、字段规则、i18n、菜单树、访问控制等测试 | `generate-web.ts` |
| `apps/*/.env.{development,production,example}` | 环境文件（缺失值留空、`generate` 写随机 secret） | `environment-files.ts` |
| `deploy/`、`Dockerfile`、`docker-compose.yml`、`turbo.json`、`package.json` | 部署与工作区配置 | `generate-project.ts` |
| `.qiy-generated.json` | Qiy 拥有的文件清单（`schemaVersion`、`qiyVersion`、`projectName`、`mode`、`files`） | `generateApp` |
| `openwiki/`、`AGENTS.md` / `AGENT.MD` | 生成项目的文档与 agent 入口（`AGENTS.md`/`AGENT.MD` 不纳入 manifest，`openwiki/` 随生成更新） | `generatedWiki` |

`apps/web/app/extensions/` 与 `apps/server/src/extensions/` 是**未登记**目录：`--sync` 不会覆盖其中的手写页面/插件，模型生成的页面可以链接过去（见 [action](/dsl/actions) 的手写页）。

## 版本与兼容

- 文件必须以 `qiy v0;` 作为第一个声明（前面只能有空白与注释），版本 token 目前**只有 `v0`**；其它写法在解析期就失败（`Expected v0 near token N`）。
- 序列化器（`serializeQiyProject`）输出标准 `qiy v0;` 形式：块顺序固定、注解顺序固定、`entity … table …` 显式写出。它是**规范化**而非逐字保留：显式写的默认值可能被省略（例如 `mode standalone;` 不会回写），语义不变；`@code` 字段、权限与图表会重新渲染成等价文本（用于往返测试与 MPS 导出）。
- `.qiy-generated.json` 记录 `schemaVersion: 1` 与生成它的 `qiyVersion`；manifest schema 变更会让旧的 `--sync` 明确失败，而不是猜测。
- 语法本身**没有向前兼容**：未知构造/注解直接报错。升级 CLI 后请用 `qiy generate … --sync` 或 `qiy init --sync` 重新生成，并检查生成的迁移。
- `--sync` 只重写 manifest 登记的文件并删除不再生成的登记文件；未登记文件不会被触碰。

## 常见错误

| 错误（阶段） | 原因 | 修复 |
| --- | --- | --- |
| `Unexpected Qiy syntax at offset N`（词法） | 出现未加引号的中文、冒号、方括号、`/`、`*`、`$` 等 | 把值放进引号；结构符号只用受支持的那些 |
| `Expected database near token N`（语法） | `database` 不是 `application` 的第一个声明 | 移到最前 |
| `Expected <block> near token N`（语法） | 块顺序错误 | 按[顶层构造地图](#顶层构造地图)重排 |
| `Expected <end> near token N`（语法） | `}` 之后还有内容，或漏了 `application` 的 `}` | 检查括号 |
| `Expected value near token N`（语法） | 该位置需要字符串/标识符，却给了数字或符号 | 加引号或改成标识符 |
| `Expected ; near token N`（语法） | 漏了分号，或在块 `}` 后多写分号 | 补/删分号 |
| `Unsupported field type X`（语法） | 类型不在闭集（`String`、`Boolean`、`Json`…） | 用 `Text`/`Integer`/枚举等受支持类型 |
| `Unsupported field attribute @X` / `Unsupported entity attribute @X`（语法） | 注解用错位置或拼错 | 对照 [注解总览](/dsl/annotations) |
| `duplicate … annotation`（语法） | 同一注解写了两遍 | 只保留一处 |
| `Missing default locale message for comment: key`（语法） | `messages` 在引用它的声明之后 | 把 `messages`（或它的 include）提前 |
| `Unsupported database dialect X`（语法） | 方言拼错 | 只用 `postgresql`/`mysql`/`sqlite` |
| `Invalid Ant Design icon X`（生成期） | 图标不是 `*Outlined` | 改用 Ant Design 图标名 |
| `V0 CRUD requires exactly one UUID primary key named id`（生成期） | 实体缺/改了主键 | 每个实体保留 `field id UUID @id` |
| `route path must be lowercase and URL-safe`（生成期） | `table` 名含大写或非法字符 | 改成 `^[a-z][a-z0-9_-]*$` |
| `required field cannot be hidden from the create form`（生成期） | 非空字段被隐藏 | 加 `@nullable` 或恢复表单可见 |
| `Auth: …`（生成期） | 用户表列不满足认证要求 | 见 [application · auth](/dsl/application#auth) |
| `Scope …` / `Restrict …`（生成期） | 数据范围/策略引用不存在的资源或字段 | 见 [application · scope/restrict](/dsl/application#scope) |
| `Output directory must be empty`（CLI） | 目标目录非空且没加 `--sync` | 清空目录或使用 `--sync` |

## 覆盖清单

| 语法域 | 覆盖位置 |
| --- | --- |
| 文件/版本/注释/标识符/字符串/数字/分号 | 本页 §词法规则 |
| include / 模块化 | [模块化模型](/dsl/modules) |
| `application` 全部块与设置 | [application](/dsl/application)（含设置总表、块顺序表） |
| 全部注解 | [注解总览](/dsl/annotations)（42 个注解 + `t()` 参考） |
| entity / field / 类型 / 属性 / 显示模板 / 筛选 | [entity 与 field](/dsl/entity) |
| relation / index | [relation 与 index](/dsl/relation-index) |
| `@code` / `@generated` / 模板 / 序号 / 并发 | [自动生成值与业务编码](/dsl/generated-values) |
| enum / menu / dashboard | [enum / menu / dashboard](/dsl/enum-menu-dashboard) |
| chart / chart panels | [chart](/dsl/charts) |
| messages / i18n 键 | 本页 §i18n 键 + [多语言](/dsl/i18n) |
| permission | [权限（permission）](/dsl/permissions) |
| dataflow / action | [dataflow](/dsl/dataflow) / [action](/dsl/actions) |
| realtime / storage / features | [realtime](/dsl/realtime) / [storage](/guide/storage) / [features](/dsl/features) |
| 生成产物与二次开发 | [生成的项目结构](/guide/project-structure) |

## 相关

- [模块化模型](/dsl/modules)、[application](/dsl/application)
- [entity 与 field](/dsl/entity)、[relation 与 index](/dsl/relation-index)、[enum / menu / dashboard](/dsl/enum-menu-dashboard)、[chart](/dsl/charts)
- [自动生成值与业务编码](/dsl/generated-values)、[注解总览](/dsl/annotations)
- [认证与登录](/dsl/auth)、[权限](/dsl/permissions)、[dataflow](/dsl/dataflow)、[action](/dsl/actions)
- [CLI 与发布](/guide/cli)、[生成的项目结构](/guide/project-structure)
