# 集成现有 Bun 项目

`qiy create` 用于新建独立的 Turborepo + Bun workspace。已有服务、认证和 API 的项目应使用 `qiy init`：它把生成的后台作为两个可维护 package 挂入当前 Bun workspace，而不是复制或替换你的根应用。

## 前置条件

在目标项目根目录，`package.json` 必须声明 Bun：

```json
{
  "packageManager": "bun@1.3.13"
}
```

Qiy 会保留已有 workspace pattern，并在缺失时加入 `apps/*`。如果 `package.json`、生成目标目录或 Qiy 脚本名称与现有内容冲突，命令会失败而不是覆盖。

## 生成独立项目

```bash
qiy create -f ./models/admin.qiy -n catalog-admin -o ./out/catalog-admin
```

`-n` 指定生成 workspace 的 package 名；`-o` 必须是空目录，更新独立生成项目时使用 `--sync`。

## 挂载到宿主项目

把集成配置直接写在 `.qiy` 的 `workspace` 块中。Qiy 不需要额外的用户配置文件；模型、别名和生成包名称可以一起提交和复用。

```qiy [models/admin.qiy]
qiy v0;
application admin {
  database postgresql {}
  workspace {
    name admin;
    aliases {
      server ops-api;
      web ops-console;
      deploy ops-admin;
    }
    packages {
      server "@ovyqo/ops-api";
      web "@ovyqo/ops-console";
    }
  }
  entity users {
    field id UUID @id;
  }
}
```

```bash
# 必须在宿主 Bun 项目的根目录运行
qiy init -f ./models/admin.qiy
bun install
bun run qiy:admin:typecheck
```

生成布局如下：

```text
host-project/
├── apps/
│   ├── ops-api/                 # Qiy 的 Bun + Elysia API
│   └── ops-console/             # Qiy 的 Refine SPA
├── deploy/ops-admin/            # nginx、Kubernetes、Vercel 示例
├── ops-admin.Dockerfile
├── docker-compose.ops-admin.yml
├── .qiy-admin.generated.json    # Qiy 拥有的文件清单
└── package.json                 # 合并 apps/* 与 qiy:admin:* scripts
```

`server`、`web`、`deploy` 是目录/文件 alias，只允许小写字母、数字和连字符；`packages.server`、`packages.web` 是对应 app 的 `package.json.name`，可使用 npm scope。

## 同步与扩展边界

```bash
qiy init -f ./models/admin.qiy --sync
```

`--sync` 只会更新 `.qiy-admin.generated.json` 中已经登记的生成文件，删除模型不再生成的登记文件。它不会覆盖任意同路径的宿主文件；路径冲突会直接失败。把项目定制放在未由 Qiy 管理的文件中，例如：

```text
apps/ops-api/src/host-extension.ts
apps/ops-api/src/integrations/ovyqo-auth.ts
apps/ops-console/app/plugins/ovyqo-data-provider.ts
apps/ops-console/app/hooks/use-connector-status.ts
```

当前版本不会自动把 Qiy 的 REST/GraphQL DataProvider 转换为任意现有 API。已有 JWT、刷新 Cookie、请求头、响应 envelope、权限与审计规则，应在上述扩展层显式实现并测试。CORS 仅解决浏览器 Origin 检查，不解决 API 契约差异。

## 仅接入现有 API

如果宿主已拥有 Bun/Elysia API、用户体系和数据库，不应生成第二套 server。使用 `mode integration` 只挂载一个 Refine Web package：

```qiy [models/catalog-admin.qiy]
qiy v0;
application catalog-admin {
  database sqlite {}
  mode integration;
  integration {
    apiBase "/api/v2";
    auth cookie { csrfCookie "XSRF-TOKEN"; csrfHeader "X-XSRF-TOKEN"; };
  }
  workspace {
    name catalog;
    aliases { web host-admin; }
    packages { web "@example/host-admin"; }
  }
  entity products {
    field id UUID @id;
    field title Text;
  }
}
```

只能在宿主根目录运行：

```bash
qiy init -f ./models/catalog-admin.qiy
```

Integration 默认只生成 list/show 页面，并不创建 `apps/server`、Drizzle schema、迁移、Docker/Compose 或部署文件。`apps/host-admin/app/host/data-provider.ts`、`auth.ts`、`access-control.ts` 是未托管适配器，`qiy init --sync` 不会覆盖它们。请在这些文件中映射宿主的 JWT、刷新 Cookie、API URL、envelope 和权限；不要把 token 或 client secret 写到 `.qiy`。

生成的 Refine 已接入宿主 AccessControlProvider。请在宿主桥接对象中提供 `can`，返回明确的 `{ can: true }` 才允许访问；缺失、异常或无效响应均拒绝。导航 action 的按钮和页面会提交同一资源/action 名称及 `params.id`，直接访问业务页也会检查。

```ts [apps/host-admin/app/host/access-control.ts]
import type { QiyHostAuthBridge } from "./auth";

window.qiyHostAuth = {
  ...window.qiyHostAuth,
  can: async ({ resource, action }) => {
    return { can: resource === "products" && ["list", "show"].includes(action) };
  },
} satisfies QiyHostAuthBridge;
```

上例只演示接口，实际项目应保留生成适配器的异常拒绝逻辑，并依据宿主策略验证记录权限。客户端判断不能替代 API 授权。已有未托管 `access-control.ts` 在同步时保留；升级后若缺少 `qiyIntegrationAccessControlProvider` 导出，请手动合并适配器与宿主策略。

Cookie 模式要求 API 与后台同源，非 GET/HEAD/OPTIONS 请求必须存在配置的可读 CSRF Cookie；登录会话 Cookie 本身仍应由宿主设为 HttpOnly。Bearer/portal 模式可配置外部 API。生成的请求 helper 将目标限制在有效 `apiBase` 的 origin 与路径内，并拒绝自动重定向，避免向其他地址发送 token 或 CSRF 值；`VITE_QIY_API_BASE` 同时影响 DataProvider 与认证请求。既有未托管 `auth.ts` 不会被 `--sync` 修补，升级时请手动审阅并移植这些限制。宿主仍需执行服务端权限、CSRF 校验和刷新会话逻辑。

`hostRequest` 抛出的 API 错误保留 `statusCode`，Refine AuthProvider 将错误直接传给可选的 `window.qiyHostAuth.onError(error)`。宿主可以在该钩子处理自己的会话恢复或登录跳转；未提供钩子时，401 跳转 `/auth/login`，不调用宿主 logout，403 和服务器错误不触发登录跳转。Qiy 不自动刷新 token 或重放请求，尤其不能默认重放产生副作用的业务命令。已有 `auth.ts` 与 `data-provider.ts` 属于未托管文件，升级需要手动合并此错误契约。

Bearer/portal 模式的发布验收会由本地宿主签发并验证带 issuer、audience、subject、过期时间和角色的 HS256 JWT。第一次请求使用 viewer token，宿主 API 的管理员白名单返回 403；`onError` 由宿主显式刷新为 admin token，但 Qiy 不自动重放，下一次由调用方发起的请求才成功。这个验收证明传输和职责边界，不代表你的签名算法、JWKS、刷新 Cookie 或管理员目录已经被 Qiy 实现。

`dataflow`、`auth`、`storage`、`elysia`、`scope`、`workflow` 与 `env` 不能用于 integration 模式，因为它们表示 Qiy 自己生成服务端的能力。需要命令/审计时，应把 UI contract 和宿主 API 的实现一起维护在未托管扩展中。
