# 错误码目录

Qiy 的解析、校验与 CLI 失败都会给出原始错误信息；其中常见错误还带有稳定错误码（`QIY10xx`），便于脚本、AI Agent 和文档检索定位问题。

```bash
qiy explain --errors
qiy explain --errors --json
qiy explain broken.qiy          # 人类可读错误 + 错误码 + 修复建议
qiy explain broken.qiy --json   # { valid: false, error, code?, title?, fix?, docs? }
```

`qiy explain --errors --json` 输出 `code`、`title`、`description`、`fix`、`docs` 五个字段，代码定义在 `tools/error-catalog.ts`。错误码只描述**错误类别**，不替代原始错误信息；具体 token、字段名仍以 `error` 为准。

## 速查表

| 错误码 | 类别 | 典型修复 |
| --- | --- | --- |
| [QIY1001](#qiy1001) | 不支持的注解 | 删除或换成当前上下文允许的 `@label`/`@comment` 等 |
| [QIY1002](#qiy1002) | 重复注解 | 每个声明只保留一次 |
| [QIY1003](#qiy1003) | 意外 token / 声明顺序 | 按 application 固定块顺序重排 |
| [QIY1004](#qiy1004) | permission 缺少 auth | 添加 `auth` 块与用户实体，或删除权限声明 |
| [QIY1005](#qiy1005) | permission verification 语法错误 | 按 verification 文法检查 input/操作符/self 集合 |
| [QIY1006](#qiy1006) | 关系引用不存在 | 在实体之后声明，并检查实体/字段名 |
| [QIY1007](#qiy1007) | chart 数据/属性错误 | 检查 kind、data、labels、按枚举字段 group by |
| [QIY1008](#qiy1008) | 业务编码模板错误 | `@code` 放在唯一 Text 字段，使用支持的 token |
| [QIY1009](#qiy1009) | scope claim 缺少字段 | 给用户/资源实体补租户字段，或修正 scope |
| [QIY1010](#qiy1010) | pages/restrict 规则错误 | 检查 resource、field、role、action 是否声明 |
| [QIY1011](#qiy1011) | integration 模式限制 | 集成模式删除 auth/scope/dataflow/storage 等服务器能力 |
| [QIY1012](#qiy1012) | features 依赖缺失 | 补 `auth` 或关闭 `apiDocs`/`apiKeys` |
| [QIY1013](#qiy1013) | Ant Design 图标名非法 | 使用真实存在的 `*Outlined` 图标 |
| [QIY1014](#qiy1014) | skill 本地修改 | 检查后 `qiy skill install --force` |
| [QIY1015](#qiy1015) | skill 未安装 | 先 `qiy skill install`，或用 `--global`/`--dir` |
| [QIY1016](#qiy1016) | `--sync` 目标非法 | 只对 `.qiy-generated.json` 工作区使用 `--sync` |

## QIY1001 {#qiy1001}

**不支持的注解。** 某个块或字段使用了当前上下文不接受的 `@annotation`。

修复：查 [注解清单](./annotations)，删除未知注解。支持的注解取决于目标（字段、实体、枚举值、菜单、action 等）。

## QIY1002 {#qiy1002}

**重复注解。** 同一个注解在一个声明中出现多次。

修复：保留一个；Qiy 不会静默采用最后一个值。

## QIY1003 {#qiy1003}

**意外 token / 声明顺序。** 最常见原因是 application 内块顺序写错。

修复：按固定顺序书写：`database` → `mode` → `integration` → `workspace` → `ui` → `api` → `features` → `realtime` → `elysia` → `storage` → `auth` → `env` → `messages` → `permission` → `workflow` → `enum` → `entity` → `relation` → `scope`/`restrict`/`pages` → `menu` → `dashboard`/`chart` → `dataflow` → `action`。错误信息里的 token N 可帮助定位。

## QIY1004 {#qiy1004}

**permission 声明缺少 auth。** 没有 `auth` 块/用户实体时无法解析角色与 claims。

修复：添加 `auth` 块和用户实体，或删除 permission 声明。

## QIY1005 {#qiy1005}

**permission verification 语法错误。** input 类型、section、操作符或 `self.*` 集合不被支持。

修复：对照 [权限系统](./permissions) 的 verification 文法，只使用文档列出的 input 类型、比较运算符和 `self.permissions`/`self.groups`/`self.role`。

## QIY1006 {#qiy1006}

**关系引用不存在。** relation 指向未声明的实体/字段，或 cardinality 非法。

修复：在实体之后声明 `relation <name> <fromEntity> <fromField> <toEntity> <toField> one|many;`，并确认字段名拼写一致。

## QIY1007 {#qiy1007}

**chart 数据/属性错误。** 未知/重复/缺失属性、非法 kind、或对非枚举字段 `group by`。

修复：按 [chart DSL](./charts) 使用 `icon`/`title`/`data`/`labels` 赋值；`group by` 只能指向枚举字段；同名 chart 的同一 kind 只能出现一次。

## QIY1008 {#qiy1008}

**业务编码模板错误。** `@code` 不在唯一 Text 字段，或模板 token 不受支持。

修复：参考 [generated-values](./generated-values)，使用 `{seq}`、`{seq:4}`、日期片段、`{random:n}` 等受支持 token。

## QIY1009 {#qiy1009}

**scope claim 缺少匹配字段。** 数据范围声明了 claim，但用户实体或目标资源没有用于解析该 claim 的字段。

修复：在 auth 用户实体和目标资源上添加对应字段，或修正 `scope <resource> <field> claim <claim>;` 中的字段/claim 名称。

## QIY1010 {#qiy1010}

**pages / restrict 规则错误。** 引用了未声明的 resource、field、role 或 page action。

修复：核对 `pages`/`restrict` 与实体、字段、`admin|operator|viewer` 角色。注意：`pages`/`when` 的字段规则只影响 UI，服务端授权仍依赖 `allow`/`require`/`restrict`/`scope`。

## QIY1011 {#qiy1011}

**integration 模式限制。** 在 `mode integration` 中使用了仅适用于生成服务器的块。

修复：集成模式删除 `auth`、`scope`、`restrict`、`workflow`、`dataflow`、`storage`、`elysia`、`env`；这些由宿主负责。

## QIY1012 {#qiy1012}

**features 依赖缺失。** `features apiDocs` 或 `apiKeys` 需要 `auth` 等前置条件。

修复：补齐依赖的 `auth` 块/用户实体，或关闭对应 feature。参考 [features](./features)。

## QIY1013 {#qiy1013}

**Ant Design 图标名非法。** `@icon` 或 chart icon 不符合 `[A-Z][a-zA-Z0-9]*Outlined` 格式。

修复：使用真实存在的 Ant Design `*Outlined` 图标（如 `TeamOutlined`）。格式正确但 Ant Design 未导出的名字会在生成项目 typecheck/build 阶段报未导出成员。

## QIY1014 {#qiy1014}

**skill 本地修改。** `qiy skill install/update` 检测到官方文件被改动，默认拒绝覆盖。

修复：确认改动后执行 `qiy skill install --force`（或 `qiy skill update --force`）；无关文件始终保留。

## QIY1015 {#qiy1015}

**skill 未安装。** `qiy skill update/uninstall` 找不到官方安装。

修复：先执行 `qiy skill install`；如果安装在用户级或自定义目录，加 `--global` 或 `--dir <path>`。

## QIY1016 {#qiy1016}

**`--sync` 目标非法。** 目标目录不是 Qiy 生成的工作区（缺少 `.qiy-generated.json`）。

修复：`--sync` 只用于 Qiy 生成的工作区；新目录直接运行 `qiy generate` 或 `qiy init`。
