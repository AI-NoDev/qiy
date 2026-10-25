# 自动生成值与业务编码（@code / @generated）

业务编码与系统 UUID 不应该由用户在表单里手工输入：UUID 无法记忆、容易输错（例如把 `parentId` 填成 `dasda` 会得到 `422 Expected union value`），业务单据号则需要稳定、唯一且可读。Qiy 把这两类值交给服务端生成，模型只声明规则。

```qiy
entity orgs @label("Organizations") {
  field id UUID @id;                                 // 主键：服务端生成，无需注解
  field code Text @unique @code("ORG-{YYYY}{MM}-{seq:4}");
  field name Text;
  field parentId UUID @nullable;                     // 外键，见 relation
  field externalId UUID @nullable @generated(uuid);  // 显式 UUIDv4
}

relation orgParent orgs parentId orgs id one @onDelete(setNull);
```

创建后 `code` 形如 `ORG-202611-0001`，`externalId` 是 UUIDv4；请求体不需要、也不应该携带这两个字段。

## 字段注解

| 注解 / 形态 | 适用类型 | 生成时机 | 说明 |
| --- | --- | --- | --- |
| `@code("模板")` | `Text`（不能是枚举字段、不能是主键） | 服务端 create | 按模板渲染业务编码 |
| `@generated(uuid)` / `@generated` | `UUID`（不能是主键） | 服务端 create | 生成 UUIDv4 |
| 无注解的非主键 `UUID` 且**没有** relation | `UUID` | 服务端 create | 视为“系统引用”，默认生成 UUIDv4 并在表单隐藏 |
| `field id UUID @id` | `UUID` | 服务端 create | 主键永远生成，不需要注解 |
| 有 relation 的 `UUID` 源字段 | `UUID` | 用户选择 | 真实外键，**不会**被自动生成（见下方警告） |

> ⚠️ **外键必须声明 relation。** 一个 `UUID` 字段如果没有 relation，Qiy 会把它当成“系统生成值”并在创建时写入随机 UUID。真实外键（如 `shipments.warehouseId`）必须声明 `relation`，否则表单不会让用户选择目标记录，也不会得到正确的引用。反过来，外键源字段不能是 `@generated` 或 `@code`（生成期报错）。

生成期校验（解析期与 `validateDatabaseIR` 各执行一次，错误信息带实体/字段名）：

| 规则 | 错误信息 |
| --- | --- |
| `@code` 只能用于非枚举 `Text` | `@code requires a Text field without an enum` |
| `@code` 不能用于主键 | `@code cannot be used on a primary key` |
| `@code` 与 `@generated` 互斥 | `@code and @generated cannot be combined` / `@generated and @code cannot be combined` |
| 同一个字段只能一个 `@code` / `@generated` | `duplicate @code annotation` / `duplicate @generated annotation` |
| `@generated` 只接受 `uuid` | `unsupported @generated value X; only uuid is supported` |
| `@generated` 只能用于 `UUID` | `@generated(uuid) requires a UUID field` |
| 主键上的 `@generated` 是多余的 | `@generated is not needed on a primary key; ids are always generated` |
| 外键源字段不能生成 | `foreign key X.Y is server-generated and cannot reference another record` / `cannot be a @code field` |
| 模板非法或缺少唯一 token | `invalid @code template "…": …` |

## 模板语法

`@code("…")` 的模板是一门极小的、生成期完全校验的字符串语言；其余字符一律按字面量保留。

| Token | 含义 | 取值范围 |
| --- | --- | --- |
| `{uuid}` | 随机 UUIDv4 | — |
| `{YYYY}` | 四位年 | 按 `QIY_CODE_TIMEZONE` 渲染 |
| `{YY}` | 两位年 | 同上 |
| `{MM}` | 月（两位） | `01`–`12` |
| `{DD}` | 日（两位） | `01`–`31` |
| `{HH}` | 小时（24 制，两位） | `00`–`23` |
| `{mm}` | 分钟（两位） | `00`–`59` |
| `{ss}` | 秒（两位） | `00`–`59` |
| `{SSS}` | 毫秒（三位） | `000`–`999` |
| `{YYYYMMDD}` 等拼接写法 | 任意有序组合的日期/时间部分 | 解析器按固定长度（`YYYY`=4、`SSS`=3、其余=2）拆分 |
| `{seq}` / `{seq:4}` | 序号，默认宽度 1，补零到 N 位 | 宽度 `1`–`12` |
| `{count+1}` / `{count+1:4}` | `{seq}` / `{seq:N}` 的别名（兼容旧模型） | 同上 |
| `{$.seq}` / `{$.count+1[:N]}` | 历史写法别名 | 同上 |
| `{random:10}` | 10 位随机串，默认字符集 `a-zA-Z0-9` | 长度 `1`–`256` |
| `{random:8:A-F0-9}` | 指定字符集的随机串 | 只允许 ASCII 字母数字与升序区间 |
| `{random a-z/A-Z/0-9 length 10}` | 自然写法，`/` 分隔字符集 | 等价于 `{random:10}` |
| <code v-pre>{{</code> / <code v-pre>}}</code> | 字面量 `{` / `}` | — |
| 其他文本 | 原样保留 | — |

模板级约束：

| 规则 | 错误信息 |
| --- | --- |
| 非空、≤ 512 字符 | `the pattern must be a non-empty string` / `the pattern must be at most 512 characters` |
| 必须至少含一个 `{…}` token | `the pattern must contain at least one {…} token` |
| 必须含一个唯一性 token（`seq`/`count+1`/`random`/`uuid`） | `the pattern needs {seq}, {count+1}, {random:…} or {uuid} so generated codes stay unique` |
| 未知 token | <code v-pre>unknown token {X}; allowed tokens are {uuid}, {YYYY}, … Escape a literal brace as {{ or }}</code> |
| `{` 未闭合 / `}` 未转义 / 嵌套花括号 | <code v-pre>unclosed token; write a matching } or escape the brace as {{</code> / <code v-pre>unescaped }; write }} for a literal closing brace</code> / `nested braces are not supported` |
| 宽度/长度非数字或越界 | `a sequence width must be between 1 and 12` / `a random length must be between 1 and 256` |
| 字符集非法 | `charset range "a-" is missing its end character` / `must be two increasing ASCII alphanumerics` / `random charset characters must be ASCII alphanumerics` |

### 示例

| 模板 | 生成结果（示例） |
| --- | --- |
| `ORG-{YYYY}{MM}-{seq:4}` | `ORG-202611-0001` |
| `CUS-{YYYYMMDD}-{seq:4}` | `CUS-20261130-0001` |
| `PO-{YYYYMMDD}-{seq:4}` | `PO-20261130-0001` |
| `DD_{YYYYMMDD}{HHmmss}-{seq:4}-{random:10}` | `DD_20261130102030-0001-K7mQ2pXa9L` |
| `{count+1:6}` | `000001` |
| `{YY}/{DD} {HH}:{mm}:{ss}.{SSS}` | `26/30 10:20:30.456` |
| `{random:8:A-F0-9}` | `3A9F0C2D` |
| `{uuid}` | `3f2a…`（UUIDv4） |
| <code v-pre>A{{B}}C</code> | `A{B}C` |

## 序号与分桶

- **分桶键** = 模板中所有日期/时间 token 按声明顺序渲染后的拼接；没有日期 token 时为空字符串（对该实体/字段全局递增）。
- 序号按 `(entity, field, bucket)` 三元组持久化在 `qiy_code_sequences` 表；并发创建不会拿到相同序号。
- `PO-{YYYYMMDD}-{seq:4}` 每天从 `0001` 重新开始；`{YYYY}{MM}` 按月重置；`{YYYYMMDD}{HHmmss}` 每秒重置。
- 同一模板里的多个 `{seq}` / `{count+1}` **共享同一个已分配序号**，只按各自宽度补零。
- 回填旧日期会消耗对应桶的序号（例如当天已用 2 个，再以当天日期生成得到 `003`），不会与已有值冲突。
- `{SSS}` 取真实毫秒（不做时区换算），其余日期/时间部分按配置时区渲染。

**时区**：`QIY_CODE_TIMEZONE` 指定 IANA 时区，缺省 `UTC`。`QIY_CODE_TIMEZONE=Asia/Shanghai` 时 `2026-11-30T23:30:00Z` 渲染为 `20261201`。非法时区在第一次渲染时报 `QIY_CODE_TIMEZONE is not a valid IANA timezone: "…"`，不会静默回退。

**唯一性**：模板必须自带唯一性 token（`seq`/`count+1`/`random`/`uuid`），否则生成阶段直接失败（纯日期模板会产出重复编码）。业务编码通常再配合 `@unique` 使用：唯一约束冲突时服务端重新生成并重试。

## 运行时行为

生成的服务端 `apps/server/src/generated-values.ts`（若模型有 `@code` 字段还会有生成测试）是唯一的生成路径：

| 行为 | 说明 |
| --- | --- |
| 渲染位置 | 永远在服务端；浏览器不计算、不提交生成值 |
| 客户端传值 | 被 `qiyStripGeneratedValues` 忽略（原对象不被修改） |
| 创建路径 | REST `POST`、GraphQL `create*`、CSV 导入、批量创建统一走 repository 的 `qiyCreateWithGeneratedValues` |
| 更新路径 | `PATCH`/GraphQL `update*` 剥离生成字段；若补丁只剩生成字段则返回原记录（幂等 no-op） |
| 序号表 | `qiy_code_sequences(entity, field, bucket, value)`，复合主键；只有存在 `@code` 时才生成该表 |
| PostgreSQL / SQLite | 单条原子 `INSERT … ON CONFLICT DO UPDATE … RETURNING` 分配，并发安全 |
| MySQL | 事务内 `SELECT … FOR UPDATE` 后插入/自增；并发首次插入冲突时重试 |
| 冲突重试 | 唯一约束冲突时重新生成，最多 **5** 次（`QIY_GENERATED_ATTEMPTS`） |
| 重试耗尽 | 抛 `QiyGeneratedValueConflict`，REST 返回 **409** `{ error, errorKey: "generated.conflict" }`（不是 500） |
| UUID 字段 | `crypto.randomUUID()`（UUIDv4）；每次创建都不同 |

### 种子与迁移

种子/迁移可以显式写入业务编码（`examples/self` 的 seed 保留 `ACME`、`SUP-1`、`PO-2026-001` 这类人工编码）；`@code` 只对之后通过 API/UI/CSV 新建的记录生效。Dataflow 的 `create` 语句是服务端显式脚本，必须自己在 `create { … }` 里给出生成字段的值（生成期会检查非空字段是否都写了）。直接 SQL 写入同理。

## 生成的前端行为

| 页面 | 表现 |
| --- | --- |
| 列表页 | 与普通字段一致（可用 `@listVisible(false)` 隐藏，如 `externalId`） |
| 新建表单 | 生成字段不渲染输入框；表单底部显示只读提示 `qiy.autoGenerated`（zh-CN / en-US 内置，可由 `messages` 覆盖） |
| 编辑表单 | 生成字段以禁用输入框显示当前值，且不参与提交；提示 `qiy.autoGenerated` |
| 详情页 / 抽屉 | 正常显示生成值 |
| CSV 导入 | 与 REST 创建走同一 repository 路径；生成字段列可以省略，即使提供了也会被服务端覆盖 |
| GraphQL | create 输入里生成字段是可选；服务端覆盖 |

`resources.ts` 为这些字段标 `autoGenerated: true`，`isFormEditable` 因此返回 false；`@code`/`@generated` 字段即使在模型里写了 `@formVisible(true)` 也不会出现在创建表单。

## 进阶用法

```qiy
entity invoices @label("发票") @display("{$.number}") {
  field id UUID @id;
  field number Text @unique @code("INV-{YYYY}{MM}-{seq:5}");
  field serial Text @unique @code("{YYYYMMDD}-{random:6:0-9}");       // 纯随机流水
  field externalId UUID @nullable @generated(uuid);                   // 对外引用
  field warehouseId UUID;                                             // 外键：必须声明 relation
  field issuedAt DateTime;
}

relation invoiceWarehouse invoices warehouseId warehouses id one;
```

- **每桶容量**：`{seq:4}` 把 1…9999 补零成 4 位；超过 9999 后输出更宽的数字（不截断），需要更长流水号就把宽度调大。
- **按天/按月编号**：把需要的日期部分放进同一个 token（`{YYYYMMDD}`、`{YYYYMM}`）即可控制重置粒度。
- **多字段同桶**：同一实体两个 `@code` 字段各有独立的 `(field, bucket)` 计数器，互不影响。
- **随机段**：`{random:N:charset}` 适合不便暴露业务量的场景；它同样计入唯一性 token，可与 `{seq}` 混用。
- **时区一致**：跨区域部署时给 server 设置统一的 `QIY_CODE_TIMEZONE`，否则同一时刻可能落到不同日期桶。

## 常见错误

| 错误 | 原因 | 修复 |
| --- | --- | --- |
| `Field code: @code requires a Text field without an enum` | 对 UUID/枚举字段用 `@code` | 改成 `Text` 非枚举字段 |
| `Field externalId: @generated(uuid) requires a UUID field` | 对 Text 用 `@generated` | 用 `@code("…")` 或改 UUID |
| `Field code: @code and @generated cannot be combined` | 同一字段两个注解 | 只留一个 |
| `invalid @code template "ORG-{YYYYMM}": the pattern needs {seq}, {count+1}, {random:…} or {uuid}` | 模板只有日期 | 加 `{seq:4}` 或 `{random:6}` |
| `unknown token {N}` | 写了不存在的 token | 只用上表 token |
| <code v-pre>unescaped }; write }} for a literal closing brace</code> | 字面量 `}` 没转义 | 写 <code v-pre>}}</code> |
| `QIY_CODE_TIMEZONE is not a valid IANA timezone` | 环境变量拼错 | 用 `Asia/Shanghai` 这类 IANA 名称 |
| 创建返回 409 `generated.conflict` | 5 次重试仍冲突（模板熵太低或唯一约束过多） | 提高模板随机性/宽度 |
| 外键创建后被随机 UUID 填充 | 忘写 relation | 补 `relation` 声明 |

## 相关

- [entity 与 field](/dsl/entity)：字段类型与属性矩阵
- [relation 与 index](/dsl/relation-index)：自关联与 `setNull`
- [application · env](/dsl/application#env)：`QIY_CODE_TIMEZONE` 之类的运行时变量
- [dataflow](/dsl/dataflow)：命令里的 `create` 需要显式给出生成字段值
