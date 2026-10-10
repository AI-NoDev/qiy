# Qiy DSL 总览

Qiy 项目文件以 `qiy v0;` 开头，随后是一个 `application` 块。当前语法是受限文本方言，由 Qiy CLI 解析并生成完整的管理后台、API、数据层和部署配置。

```ts
qiy v0;

application qiy-erp-admin {
  database postgresql {}
  storage { provider local; }
  auth { provider oidc; user users; subjectField externalSubject; roleField role; }
  workflow orderInventory;
}
```

## 顶层结构

| 块 | 作用 |
| --- | --- |
| `database` | 目标数据库方言与扩展 |
| `api` | 前端 DataProvider 选择与 CORS |
| `elysia` | 服务端插件组合 |
| `storage` | 文件存储 provider |
| `auth` | 外部身份映射 |
| `workflow` | 业务工作流声明 |
| `enum` | 有限枚举与配色、icon |
| `entity` | 实体、字段与索引 |
| `relation` | 实体关系与外键策略 |
| `scope` | 数据范围策略 |
| `menu` | 菜单分组与层级 |
| `dashboard` | 概览页指标 |

## 标识符与注释

- 标识符匹配 `[a-zA-Z_][a-zA-Z_0-9-]*`；
- 注释使用 `//`；
- 字符串使用双引号或单引号。
- 项目可以通过 [`include` 模块](../guide/modules) 将 `application` 内容拆分到多个相对 `.qiy` 文件。

## 生成命令

```powershell
bun run tools/generate-app.ts <source> <output-dir> [--sync]
```

`source` 是 `.qiy` 项目文件。输出目录必须为空，除非显式传入 `--sync`。

## 各章节

- [application](/dsl/application)：数据库、API、认证、存储、工作流
- [entity 与 field](/dsl/entity)：字段类型与属性
- [relation 与 index](/dsl/relation-index)：关系与索引
- [enum / menu / dashboard](/dsl/enum-menu-dashboard)：界面配置
