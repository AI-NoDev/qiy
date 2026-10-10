# application

```ts
application qiy-erp-admin {
  // 数据库
  database postgresql {
    extension pgvector;
  }

  // 前端数据源
  api {
    client graphql;
    cors {
      origin "https://admin.example.com";
    }
  }

  // 服务端插件
  elysia {
    bearer;
    jwt { name accessToken; secretEnv QIY_ACCESS_SECRET; }
    graphqlAdapter adapter yoga;
  }

  storage { provider s3; }
  auth { provider oidc; user users; subjectField externalSubject; roleField role; }
  workflow orderInventory;
}
```

## database

```ts
database postgresql { extension pgvector; }
database sqlite {}
database mysql {}
```

必须放在 `application` 开头。当前支持 PostgreSQL、SQLite 与 MySQL。

## workspace

`workspace` 是可选的现有 Bun 项目集成配置，属于 `.qiy` 模型本身。它只影响 `qiy init`，不会把凭据写入模型：

```qiy
workspace {
  name admin;
  aliases {
    server ops-api;
    web ops-console;
    deploy ops-admin;
  }
  packages {
    server "@example/ops-api";
    web "@example/ops-console";
  }
}
```

`name`、目录 alias 和 package name 都是可选的；未声明时分别回退到 `application` 名称、`<name>-server`、`<name>-web`、`<name>` 和默认 package name。`-n` 可以作为一次性 CLI 覆盖。package name 使用引号，目录 alias 使用小写字母、数字和连字符。

## api

```ts
api { client rest; }
api { client graphql; }
```

前端只能选一个客户端；服务端仍会同时提供 REST 端点。

## elysia

| 配置 | 说明 |
| --- | --- |
| `bearer;` | Bearer 令牌解析 |
| `serverTiming;` | Server-Timing 响应头 |
| `html;` | HTML 响应 |
| `drizzle;` | Drizzle 查询插件 |
| `jwt { name ...; secretEnv ...; }` | JWT；secret 从环境变量读取 |
| `static { assets "public"; prefix "/public-assets"; }` | 静态资源；prefix 必须以 `/` 开头 |
| `graphqlAdapter adapter native|yoga|apollo;` | GraphQL 适配器 |
| `cron { job ... pattern "..." task cleanupMissingAttachments; }` | 定时任务 |

## storage

```ts
storage { provider local; }
storage { provider s3; }
```

## auth

```ts
auth { provider oidc; user users; subjectField externalSubject; roleField role; }
```

`provider` 为 `oidc`、`oauth2`、`sso`；`user` 指向应用内的用户实体。

## env

Qiy 从模型生成 server 与 web 包各自的环境文件。独立 `create` 项目默认位于 `apps/server/`、`apps/web/`；`qiy init` 使用 `.qiy` 的 workspace alias，例如 `apps/ops-api/.env.production`、`apps/ops-console/.env.development`。环境文件位于 Admin 自己的包内；`qiy init` 不读取、覆盖或合并宿主根目录已有的 `.env`、`.env.example` 或 `.env.development`。启动脚本分别加载 development/production 文件。

```qiy
env {
  variable PAYMENT_API_URL {
    development "http://localhost:8080";
    production required;
    example "https://api.example.com";
  }
  variable PAYMENT_API_TOKEN {
    secret;
    development generate;
    production required;
    example required;
  }
}
```

变量名使用大写字母、数字和下划线。未配置的自定义变量在相应文件中留空；`required` 会生成待填写的空值；`generate` 仅可用于 secret 的 development 值，每次新建 admin 时生成随机值。标记为 `secret` 的变量不能在 `.qiy` 中写入字面值。`VITE_` 前缀变量写入 web 环境文件并进入浏览器 bundle，不能标记为 secret。开发和生产 server env 文件会被 Git/Docker 忽略；example 文件用于检查字段及复制示例，不包含真实 secret。

`auth provider oidc|oauth2|sso` 会自动加入 `QIY_OIDC_ISSUER`、`QIY_OIDC_AUDIENCE` 和 `QIY_OIDC_JWKS_URL`。当前这些配置用于验证 issuer/JWKS 签发的 access token，不代表生成 OAuth authorization-code client，也不会生成 client ID/secret。

## workflow

```ts
workflow orderInventory;
```

生成订单提交、审批、出库、取消与库存预占事务链路。目前仅 PostgreSQL、且要求约定的 `orders`、`orderItems`、`inventoryItems` 实体。

## scope

```ts
scope orders customerId claim tenant.customerId;
```

声明资源级的数据范围策略，读取与写入都会被守卫约束。目前为基础切片，完整策略仍待完成。
