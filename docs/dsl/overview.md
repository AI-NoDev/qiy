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
| `elysia` | 服务端插件组合 |
| `storage` | 文件存储 provider |
| `auth` | 外部身份映射 |
| `messages` | 多语言消息字典与默认语言，供模型描述和 Refine 界面引用 |
| `workflow` | 业务工作流声明 |
| `enum` | 有限枚举与配色、icon |
| `entity` | 实体、字段与索引 |
| `relation` | 实体关系与外键策略 |
| `scope` | 数据范围策略 |
| `menu` | 菜单分组与层级 |
| `dashboard` | 概览页指标 |
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

语言选择器包含内置中英文及模型声明的语言。Ant Design 组件按已声明的语言自动加载中英、日、韩、法、德、西班牙、巴西葡萄牙、俄、埃及阿拉伯、印地、意大利及繁体中文语言包；其他标签的组件暂回退英语。阿拉伯语、波斯语、希伯来语和乌尔都语切换为 RTL，并同步页面 `lang` / `dir`。

当前仅预置部分 Refine 中英文常用键，其他语言需要在模型中提供翻译；缺失项目 key 回退默认字典。尚未覆盖的自定义页面固定文字、全部 Refine 功能键及服务端业务错误不会自动翻译。四语言完整例子见 [multilingual/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/multilingual/app.qiy)。

## CLI 使用

```powershell
bun run tools/generate-app.ts <source> <output-dir> [--sync]
```

`source` 是 `.qiy` 项目文件。输出目录必须为空，除非显式传入 `--sync`。

## 各章节

- [application](/dsl/application)：数据库、API、认证、存储、工作流
- [entity 与 field](/dsl/entity)：字段类型与属性
- [relation 与 index](/dsl/relation-index)：关系与索引
- [enum / menu / dashboard](/dsl/enum-menu-dashboard)：界面配置
- [dataflow](/dsl/dataflow)：可执行子集、生命周期与后续路线
- [action](/dsl/actions)：列表/详情操作、命令确认与手写业务页扩展
- [realtime](/dsl/realtime)：资源订阅、角色 capability 与 Refine LiveProvider
