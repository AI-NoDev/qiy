# 快速开始

## 环境准备

- [Bun](https://bun.sh) 1.3 或更高版本
- 可选：Node.js 20+（部分前端工具链回退路径）
- 可选：PostgreSQL（V0 的内存预览不需要数据库）

```bash
bun --version
```

## 克隆与安装

```bash
git clone https://github.com/AI-NoDev/qiy.git
cd qiy
bun install
```

## 生成第一个 Admin

仓库自带一个 Catalog 示例：

```powershell
bun run tools/generate-app.ts examples/catalog/app.qiy out/catalog-admin
```

推荐使用统一 CLI：

```powershell
bun run qiy -- generate examples/catalog/app.qiy out/catalog-admin
```

## 运行

```powershell
cd out/catalog-admin
bun install
bun run test
bun run typecheck
bun run build
bun run preview
```

打开 `http://127.0.0.1:3000/products`，可以看到产品列表与完整 CRUD。

:::warning 预览模式
`preview` 仅绑定本机回环地址，数据保存在内存中，**不可部署到公网**。
:::

## 连接真实数据库

以 PostgreSQL 为例：

1. 由数据库管理员启用 `vector` 等扩展；
2. 复制 `apps/server/.env.example` 为 `apps/server/.env` 并填写连接串；
3. 生成并执行迁移；
4. 分别启动 API 与前端。

```powershell
cd apps/server
cp .env.example .env
# 编辑 .env 填写 DATABASE_URL
cd ../..
bun run db:migrate
bun run dev:server
```

另一个终端：

```powershell
bun run dev:web
```

正式 API 在未设置 `QIY_DEV_MODE=1` 时会拒绝启动，这是刻意保留的安全闸门。

## 试一个复杂例子

ERP 压力示例包含 7 个实体、6 条关系、订单工作流和分层菜单：

```powershell
bun run tools/generate-app.ts examples/erpadmin/app.qiy out/erpadmin
cd out/erpadmin
bun install
bun run typecheck
bun run test
bun run build
```

## 下一步

- 了解 [生成的项目结构](/guide/project-structure)
- 学习 [定义数据模型](/guide/data-modeling)
