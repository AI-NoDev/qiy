# relation 与 index

`relation` 声明外键（`one`）或多对多关联（`many`）以及对应的关联 UI，`index` 声明数据库索引。两者都写在 `entity` 之外（索引写在实体块内）。

```qiy
entity customers @display("{$.name}") {
  field id UUID @id;
  field name Text;
}

entity orders {
  field id UUID @id;
  field customerId UUID;                       // 外键源字段：UUID、非空
  field code Text @unique;

  index orders_customer_idx btree(customerId);
  index orders_code_uq btree(code) @unique;
}

relation orderCustomer orders customerId customers id one @onDelete(restrict);
```

## relation

### 语法

```text
relation <name> <fromEntity> <fromField> <toEntity> <toField> <one|many>
         [@onDelete(<restrict|cascade|setNull>)]
         [@comment("…" | t("key"))]
         ;
```

| 槽位 | 取值 | 说明 |
| --- | --- | --- |
| `<name>` | 标识符，全局唯一 | 重名报 `Relation X: invalid or duplicate name` |
| `<fromEntity>` / `<fromField>` | `one`：已声明实体 + 该实体的 `UUID` 字段；`many`：已声明实体 + **未声明**的字段名 | 外键源；`many` 时 `fromField` 是关系自动创建的 id 数组字段（如 `labelIds`）。同一 `fromEntity.fromField` 只能有一条 relation（`duplicate source field`） |
| `<toEntity>` / `<toField>` | 已声明实体 + `UUID` 主键或 `@unique` 字段 | 关系目标 |
| 基数 | `one` / `many` | `one`：外键列；`many`：多对多，生成连接表，见 [多对多](#多对多-many) |
| `@onDelete(...)` | `restrict` / `cascade` / `setNull` | 仅 `one`，映射到数据库 `ON DELETE`；缺省交给数据库默认 |
| `@comment(...)` | 字面量或 `t("key")` | `one`：外键列的 JSDoc；`many`：API 文档与表单提示 |

### 默认值与校验

| 规则 | 错误信息 / 行为 |
| --- | --- |
| 非法基数 | `Unsupported relation cardinality X` |
| 两端字段必须是 `UUID` | `V3 foreign keys require UUID fields` |
| 目标字段必须主键或 `@unique` | `target field must be primary or unique` |
| 源字段不能是 `@generated` | `foreign key X is server-generated and cannot reference another record` |
| 源字段不能是 `@code` | `foreign key X cannot be a @code field` |
| `setNull` 要求源字段可空 | `setNull requires a nullable source field` |
| 实体/字段必须存在 | `Relation X: referenced entity does not exist` / `unknown source field` / `unknown target field` |
| 未知注解 | `Unsupported relation attribute @X` |
| 未知 onDelete | `Unsupported onDelete action X` |
| 同一源字段只能一条 relation | `duplicate source field X.Y` |

补充：

- **只支持单列外键**（复合外键没有语法）。多对多直接写 `many`；连接记录本身需要额外字段（数量、角色、排序）时，改用显式连接实体 + 两条 `one` 关系。
- **自关联**（`fromEntity === toEntity`）合法，Drizzle 会生成带显式返回类型的 `.references((): AnyPgColumn => …)`；`setNull` 常用于组织树 `parentId`。
- **没有 relation 的 `UUID` 字段会被当成系统引用**：服务端自动生成 UUIDv4 并在表单隐藏。真实外键必须声明 relation，否则用户无法选择目标记录（见 [自动生成值](/dsl/generated-values)）。
- `relation` 必须写在所有 `entity` 之后（解析器先消费完 `entity` 才读 `relation`）。
- `relation` 不参与授权；行/字段策略由 `restrict` 表达（见 [application · restrict](/dsl/application#restrict)）。

### 生成结果

| 产物 | 内容 |
| --- | --- |
| Drizzle schema | 外键列 `.references(() => 目标.字段, { onDelete: "cascade" \| "set null" \| "restrict" })`；自关联使用显式回调类型；外键列的 JSDoc 来自 `@comment` |
| 迁移 | 对应 `FOREIGN KEY … ON DELETE …` 约束 |
| 列表页 | 外键列渲染为**目标实体的显示文本**（`@tableDisplay` → `@display` → 自然显示字段），而不是裸 UUID |
| 详情页/抽屉 | 关联记录卡片 + 可点击进入；抽屉内可继续嵌套打开下一层 |
| 表单 | 外键渲染为 `RelationSelect`（下拉搜索、显示目标文本），不可能手输 UUID |
| Dataflow | `context { order = entity orders by id input.orderId; }` 要求按主键加载，与 relation 无关 |

### 多对多（many）

```qiy
entity labels @display("{$.name}") {
  field id UUID @id;
  field name Text @unique;
  field deletedAt DateTime @nullable @softDelete;
}

relation announcementLabels announcements labelIds labels id many @comment("Labels shown on the announcement");
```

`announcements` 因此多出一个虚拟字段 `labelIds`：读取时是已排序的目标 id 数组，写入时整体替换。

| 规则 | 错误信息 |
| --- | --- |
| `fromField` 不能是已声明的列 | `many-to-many field X.Y must not be declared as a column; the relation creates it` |
| `fromField` 必须是合法标识符 | `invalid many-to-many field name X` |
| 源实体主键必须是名为 `id` 的 `UUID` | `many-to-many source X needs a UUID primary key named id` |
| 目标字段必须是 `UUID` 主键或 `@unique` | `many-to-many target X.Y must be a UUID primary or unique field` |
| 不能写 `@onDelete` | `@onDelete is not supported on many-to-many relations; link rows are always removed with either side` |
| 连接表名（relation 名转 snake_case）不能与实体表、系统表或 `qiy_` 前缀冲突 | `join table X collides with an existing table; rename the relation` |
| relation 名不能与实体、视图、系统 schema 导出重名，也不能以 `qiy` 开头 | `the join table is exported as X, which collides with another schema export` |
| 目标实体有 `scope … tree` | `many-to-many target X uses a tree scope, which link validation cannot bound; link to an entity with a plain scope` |
| 目标实体有数据范围（`scope`）时，源实体必须用同一个 claim 限定范围；写入时只能关联同范围的目标 | `many-to-many target X is scoped by claim C, so Y must be scoped by the same claim` |

| 产物 | 内容 |
| --- | --- |
| Drizzle schema | 连接表 `<relation_snake>`：`sourceId`、`targetId` 两列，复合主键，两端外键都 `ON DELETE CASCADE`，`targetId` 带索引 |
| REST / GraphQL | 创建、更新接受 `labelIds: uuid[] \| null`（最多 500 个、不允许重复；`null` 或 `[]` 清空；省略则不改）；响应带 `labelIds` 数组 |
| 写入 | 与主记录同一事务：先校验所有目标存在、未软删、在同一数据范围，否则整笔回滚并返回 `400`（`errorKey: "relation.unknownTarget"`）；然后替换连接行；审计记录包含该字段 |
| 读取 | 只返回仍可见的目标（软删目标被隐藏） |
| 过滤 | `labelIds` 支持 `eq`（包含某个目标）和 `in`（包含任一目标），走 `IN (子查询)` |
| CSV | 导出为 JSON id 数组；导入接受同样格式 |
| 列表 / 详情 | 单元格渲染为多个可点击的目标显示文本，整页批量加载 |
| 表单 | 多选 `RelationSelect`（远程搜索，已选项即使不在第一页也会显示） |
| 删除 | 删除任一端（硬删）时，连接行随外键级联删除 |

### 外键 UI：批量查询、Drawer 与批量加载

- **列表页批量查询**：列表渲染时把当前页所有可见外键值按目标资源分组（去重、忽略空值、每资源最多 **200** 个 id），由 `app/components/relation-batch.tsx` 的 `RelationBatchProvider` 用 Refine `useMany` 调用 DataProvider 的 `getMany`，每个目标资源只发一条请求：

  ```text
  GET /api/v1/<target>?page=1&pageSize=<ids.length>&filters=[{"field":"id","operator":"in","value":"id1,id2"}]
  ```

  服务端把逗号分隔的 `value` 解析成 `IN (...)`；`getMany` 校验/去重 id，空 id 直接返回 `{ data: [] }`。单条路径（详情页关联表、Drawer 正文、下拉）仍用 `useOne`；批量路径下单元格自身的 `useOne` 被禁用（`enabled: false`）。
- **Drawer**：点击外键单元格打开抽屉，内容与目标记录的**详情页一致**（共用 `RecordDetails`）：渲染全部 `showVisible` 字段、枚举 Tag、继续可点的外键、本地化日期、文件下载链接、空值占位；目标实体声明了 `@relationDetail` 时，摘要块保留在字段详情上方。抽屉宽度 `min(92vw, 760px)`，头部面包屑「目标资源列表 → 当前记录详情页」，右上角“打开详情”可跳到详情页，底部有关闭按钮。嵌套外键会叠加打开，每层面包屑反映当前层记录。
- **角色可见性**：`pages … field X roles …` 生成的 `canSeeField` 同时作用于 Drawer 正文字段，外键单元格与抽屉保持一致。

### 示例

```qiy
# 一对多：客户 → 订单
relation orderCustomer orders customerId customers id one @onDelete(restrict);

# 级联删除明细
relation lineOrder orderItems orderId orders id one @onDelete(cascade);

# 可空自关联（组织树）
relation orgParent orgs parentId orgs id one @onDelete(setNull);

# 多对多：工单关注人
relation ticketWatchers tickets watcherIds users id many;
```

### 进阶用法

- **自关联 + 树范围**：`relation orgParent orgs parentId orgs id one @onDelete(setNull)` 配合 `scope warehouses orgId claim org.id tree orgs parentId` 生成组织子树可见性（见 [application · scope](/dsl/application#scope)）。
- **显示文本**：给目标实体声明 `@tableDisplay("{$.code} · {$.name}")` 后，列表外键列、Drawer 标题、下拉选项统一使用该文本；否则按 `@display` → 自然字段回退。
- **外键索引**：PostgreSQL 不会为外键自动建索引。列表按外键过滤时要显式声明（见下方 index 示例）：
  `index orders_customer_idx btree(customerId);`
- **删除策略选择**：有明细依赖用 `restrict`（先删明细）或 `cascade`（随主记录删除）；可选上级用 `setNull`（源字段必须 `@nullable`）。

### 常见错误

| 错误 | 原因 | 修复 |
| --- | --- | --- |
| `Relation X: unknown source field orders.customerId` | 字段未声明，或拼写不同 | 先声明字段（注意区分实体名与表名） |
| `Relation X: target field must be primary or unique` | 目标字段既不是 `@id` 也不是 `@unique` | 给目标字段加 `@unique`，或改指向主键 |
| `Relation X: V3 foreign keys require UUID fields` | 用了 Text/Integer 做外键 | 外键两端必须是 UUID |
| `Relation X: setNull requires a nullable source field` | `setNull` + 非空源字段 | 加 `@nullable`，或改用 `restrict`/`cascade` |
| `Relation X: many-to-many field tickets.watcherIds must not be declared as a column` | `many` 关系的源字段又在实体里声明了 | 删掉该字段声明，由关系创建 |
| 保存时 `400 relation.unknownTarget` | 提交的 id 不存在、已软删或不在你的数据范围 | 刷新选项后重选 |
| 表单里外键变成只读、创建时被随机填充 | 忘写 relation，UUID 被当作系统引用 | 补 `relation` 声明 |
| `Expected relation near token N` | `relation` 写在了 `entity` 之前 | 把所有 `relation` 移到所有实体之后 |

## index

### 语法

```text
index <name> <btree|hnsw|ivfflat> ( <field> [<opclass>] [, ...] )
      [@unique] [@concurrently]
      [@comment("…" | t("key"))]
      ;
```

### 参数

| 槽位 | 取值 | 说明 |
| --- | --- | --- |
| `<name>` | 标识符，**全局唯一** | 重名报 `Entity X.<index>: duplicate index name` |
| 方法 | `btree` / `hnsw` / `ivfflat` | 其它值报 `Unsupported index method X` |
| 列 | 该实体的字段名 | 至少一列；未知字段报 `unknown field X` |
| `opclass` | 向量算子类 | 仅向量索引需要：`vector_l2_ops`、`vector_ip_ops`、`vector_cosine_ops` |
| `@unique` | 布尔 | 生成唯一索引；向量索引不能唯一 |
| `@concurrently` | 布尔 | 迁移后由 `db:migrate` 用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS` 建索引（仅 PostgreSQL） |
| `@comment(...)` | 字面量或 `t("key")` | 索引的 JSDoc |

### 默认值与校验

| 规则 | 错误信息 |
| --- | --- |
| 索引必须有名字与至少一列 | `an index needs a name and columns` |
| `hnsw`/`ivfflat` 需要 PostgreSQL + `pgvector` | `hnsw requires PostgreSQL and pgvector` |
| 向量索引必须单列、非唯一、列为 `Vector` 且带合法 opclass | `vector index must have one column and cannot be unique` / `vector index requires a Vector field and compatible opclass` |
| 向量维度 ≤ 2000（索引限制） | `hnsw vector dimension cannot exceed 2000` |
| btree 列不能带 opclass | `btree opclass is not supported by this adapter` |
| `@concurrently` 仅 PostgreSQL | `concurrently requires PostgreSQL` |
| 未知索引属性 | `Unsupported index attribute @X` |

### 生成结果

- Drizzle `index("name").on(table.a, table.b)` / `uniqueIndex(...)`；向量索引带 `.using("hnsw", table.embedding.op("vector_cosine_ops"))`。
- 迁移 SQL 中同名索引；`@concurrently` 索引不进 Drizzle 迁移（迁移在事务里执行，PostgreSQL 不允许事务内 `CONCURRENTLY`），而是由生成的 `db:migrate` 在迁移完成后、事务外执行 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`；中断留下的 INVALID 索引会先删除再重建。
- 声明了 `extension pgvector;`/`postgis` 时，`db:migrate` 在首个迁移前执行 `create extension if not exists`（drizzle-kit 不会生成扩展语句）。
- MySQL 上被索引的 `Text`/`File` 列会收窄为 `varchar(255)` 以便建索引。

### 示例

```qiy
entity products {
  field id UUID @id;
  field sku Text @unique;
  field name Text;
  field warehouseId UUID;
  field embedding Vector(1536) @nullable @extension(pgvector);

  index products_sku_uq btree(sku) @unique;
  index products_name_idx btree(name);
  index products_warehouse_idx btree(warehouseId);
  index products_embedding_hnsw hnsw(embedding vector_cosine_ops) @comment("相似度检索");
}
```

### 性能提示

- **外键列**：PostgreSQL 不自动为外键建索引；`WHERE customerId = ?`、列表过滤、级联删除都会变慢，按需加 `btree(<fk>)`。
- **唯一约束优先用字段 `@unique`**；多列唯一（例如 `warehouseId + productId`）只能用 `index … @unique`。
- **复合索引顺序**：把等值过滤列放前、范围/排序列放后（如 `btree(status, placedAt)` 服务 `status = ? ORDER BY placedAt`）。
- **向量检索**：`hnsw` 通常比 `ivfflat` 召回更稳；三者都要求 `Vector` 列与 opclass，且维度 ≤ 2000 才能建索引（列本身可到 16000）。
- **大表上线**：PostgreSQL 用 `@concurrently` 避免长时间写锁；SQLite/MySQL 会直接报错，需要手写迁移。
- **索引不是越多越好**：每个索引都会拖慢写入与迁移；只为真实查询路径建索引。

### 常见错误

| 错误 | 修复 |
| --- | --- |
| `products_name_idx: unknown field title` | 列名用字段名（不是 `@column` 的物理列名） |
| `hnsw requires PostgreSQL and pgvector` | 切到 PostgreSQL 并声明 `extension pgvector;` |
| `vector index requires a Vector field and compatible opclass` | 补 opclass，如 `hnsw(embedding vector_cosine_ops)` |
| `btree opclass is not supported by this adapter` | 去掉 btree 列上的 opclass |
| `duplicate index name` | 索引名全局唯一，加表名前缀 |

## 相关

- [entity 与 field](/dsl/entity)：字段类型、`@unique`、显示模板
- [application · scope](/dsl/application#scope)：树范围与自关联
- [自动生成值与业务编码](/dsl/generated-values)：为什么外键必须声明 relation
- [权限（permission）](/dsl/permissions)：授权不是 relation 的职责
