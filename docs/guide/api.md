# API 与数据源

## 选择客户端

Qiy 可以同时生成 REST 与 GraphQL 服务端，但前端 DataProvider 只能选一个：

```ts
api { client rest; }
```

或：

```ts
api { client graphql; }
```

服务端挂载 `/api/v1/*`；选择 GraphQL 时额外挂载 `/graphql`。

## CORS

```ts
api {
  client rest;
  cors {
    origin "https://admin.example.com";
    origin "http://127.0.0.1:3001";
  }
}
```

origin 必须是精确的 `http(s)` 源，不允许通配符或路径。

## Elysia 插件

```ts
elysia {
  bearer;
  serverTiming;
  html;
  drizzle;
  jwt { name accessToken; secretEnv QIY_ACCESS_SECRET; }
  static { assets "public"; prefix "/public-assets"; }
  graphqlAdapter adapter yoga;
  cron { job attachmentCleanup pattern "0 0 * * *" task cleanupMissingAttachments; }
}
```

`bearer` 解析令牌，`jwt` 负责签发与校验，`serverTiming` 添加耗时头，`static` 托管指定目录，`graphqlAdapter` 可选 `native` / `yoga` / `apollo`，`cron` 提供定时任务，`drizzle` 与数据库连接。

## REST 端点

```text
GET    /api/v1/:resources          列表，分页、排序、过滤、搜索
POST   /api/v1/:resources          创建
GET    /api/v1/:resources/:id      详情
PUT    /api/v1/:resources/:id      更新
DELETE /api/v1/:resources/:id      删除
DELETE /api/v1/:resources          批量删除
```

契约由同一份 IR 生成，server 侧的校验与 web 侧 DataProvider 类型不会发生字段漂移。
