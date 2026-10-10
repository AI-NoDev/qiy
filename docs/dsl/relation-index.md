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

## index

```ts
index products_title_idx btree(title);
index users_email_idx btree(email) @unique;
index inventory_warehouse_product_idx btree(warehouseId, productId) @unique;
index products_embedding_hnsw hnsw(embedding vector_cosine_ops);
```

方法支持 `btree`、`hnsw`、`ivfflat`。列可以带 opclass（向量索引需要）。索引属性支持 `@unique` 与 `@concurrently`。

未实现的能力会在生成前报错，而不是被忽略。
