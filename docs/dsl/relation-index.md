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

关系列在生成的列表页、详情页和关联表中不再显示原始 UUID：它显示目标实体的 `@tableDisplay`（缺省 `@display`，再缺省可读字段）文本并链接到目标记录；点击打开 Drawer，正文来自目标实体的 `@relationDetail`，并带“打开详情”按钮跳转详情页。创建/编辑表单的外键下拉同样使用目标实体的显示文本。为外键目标实体声明显示注解即可，详见 [entity 的实体显示注解](/dsl/entity#实体显示注解-django-风格)。

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
