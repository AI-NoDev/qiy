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
