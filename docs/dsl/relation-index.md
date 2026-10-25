# relation 与 index

## relation

```ts
relation orderCustomer orders customerId customers id one;
relation orderItemOrder orderItems orderId orders id one @onDelete(cascade);
```

```text
relation <name> <fromEntity> <fromField> <toEntity> <toField> one|many [@onDelete(...)]
```

基数只支持 `one` 与 `many`。`one` 生成外键与关联选择器；`many` 用于反向集合。`@onDelete` 支持 `restrict`、`cascade`、`setNull`。

关系列在生成的列表页、详情页和关联表中不再显示原始 UUID：它显示目标实体的 `@tableDisplay`（缺省 `@display`，再缺省可读字段）文本并链接到目标记录；点击打开 Drawer。Drawer 的内容与目标记录的**详情页一致**：它与 `routes/show.tsx` 共用 `app/components/record-details.tsx` 的 `RecordDetails`，渲染全部 `showVisible` 字段并遵守 `canSeeField` 的当前角色可见性，枚举显示为 Tag、外键继续用 `RelationCell`（点开则是下一层 Drawer）、Date/Time 走同一本地化格式化、File 字段是下载链接、Vector 与空值分别显示占位文案；目标实体声明了 `@relationDetail` 时，它的摘要块保留在字段详情上方。Drawer 宽度为 `min(92vw, 760px)`，头部面包屑是「目标资源列表 → 当前记录详情页」（抽屉内点击面包屑或右上角“打开详情”可进入详情页），底部有关闭按钮。嵌套外键的 Drawer 会叠加打开，每层面包屑反映当前层记录。创建/编辑表单的外键下拉同样使用目标实体的显示文本。为外键目标实体声明显示注解即可，详见 [entity 的实体显示注解](/dsl/entity#实体显示注解-django-风格)。

### 外键批量查询（getMany / useMany）

列表页不会为每个外键单元格发一条 `GET /api/v1/<resource>/<id>`。生成器把当前页所有可见外键值按目标资源分组（去重、忽略空值、每资源最多 200 个 id），由 `app/components/relation-batch.tsx` 的 `RelationBatchProvider` 用 Refine `useMany` 调用数据提供者的 `getMany`，每个目标资源只发一条列表请求：

```text
GET /api/v1/<target>?page=1&pageSize=<ids.length>&filters=[{"field":"id","operator":"in","value":"id1,id2"}]
```

服务端仓库把逗号分隔的 `value` 解析成 `IN (...)`，所以一页三列外键通常只增加 1~3 条请求，而不是几十条。`getMany` 会校验/去重 id、空 id 直接返回 `{ data: [] }`，并把超过 100 个 id 的批次按服务端 `pageSize` 上限分块。单条记录路径（详情页关联表、Drawer 正文、外键下拉，以及没有 `getMany` 的 host integration 数据提供者）仍走原来的 `useOne`；列表单元格在拿到批量记录后会把自身的 `useOne` 查询设为 `enabled: false`。生成的 Web 测试覆盖 `buildRelationBatchPlan` 的分组/去重/截断、`getMany` 的请求 URL 与 filters、以及批量上下文下 `RelationCell` 不再逐条请求。

## index

```ts
index products_title_idx btree(title);
index users_email_idx btree(email) @unique;
index inventory_warehouse_product_idx btree(warehouseId, productId) @unique;
index products_embedding_hnsw hnsw(embedding vector_cosine_ops);
```

## 与权限的关系

关系与外键策略本身不参与授权；它们影响 dataflow 的 `context` 加载和命令的 allow 规则。若某条命令会跨实体写入，用 [权限（permission）](/dsl/permissions#dataflow-action-的-allow-形式) 的 `allow permission` / `allow verification` 声明执行条件，而不是在生成代码里追加角色判断。

方法支持 `btree`、`hnsw`、`ivfflat`。列可以带 opclass（向量索引需要）。索引属性支持 `@unique` 与 `@concurrently`。

未实现的能力会在生成前报错，而不是被忽略。
