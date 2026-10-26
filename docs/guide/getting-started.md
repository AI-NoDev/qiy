# 快速开始

这一页只讲一件事：**用 `qiy` 命令创建一个项目，改模型，运行。**

## 1. 安装 CLI

从 [GitHub Releases](https://github.com/AI-NoDev/qiy/releases/latest) 下载对应平台的可执行文件，放到 `PATH` 中：

```bash
# 以 Linux x64 为例
chmod +x qiy-<version>-linux-x64
sudo mv qiy-<version>-linux-x64 /usr/local/bin/qiy

qiy --version
qiy doctor
```

Qiy 需要 [Bun](https://bun.sh) 1.3+。`qiy doctor` 会检查 Bun、CLI 模板和工作区是否就绪。

## 2. 创建项目

```bash
qiy create project shop
cd shop
```

生成的是一个**模型项目**，不是生成器仓库：

```text
shop/
  qiy.project.json        # 项目名、模型入口、生成目录
  model/
    app.qiy               # 入口：只放 database 和 include
    modules/
      10-catalog.qiy      # 实体与字段
      20-relations.qiy    # 关系
      30-ui.qiy           # 菜单、图表
      40-permissions.qiy  # 权限示例（默认注释）
      50-dataflows.qiy    # 事务命令示例（默认注释）
      60-messages.qiy     # 多语言示例（默认注释）
  README.md
```

默认 `standard` 模板已经包含一个可运行的 products / orders 示例。只要最小项目：

```bash
qiy create project tiny --template minimal
```

## 3. 启动开发环境

```bash
qiy dev
```

首次运行会依次：

1. 从 `model/app.qiy` 生成 `admin/`；
2. 安装生成工作区的依赖；
3. 生成并执行数据库迁移（默认 SQLite）；
4. 启动 API 和 Admin。

打开终端提示的 Admin 地址（默认 `http://localhost:5173`），进入 `/products` 就能看到第一个列表和 CRUD。API 默认在 `http://localhost:3000`。

## 4. 修改模型

编辑 `model/modules/10-catalog.qiy`：

```qiy
entity products {
  field id UUID @id;
  field name Text @unique;
  field price Money(12, 2) @nullable;
  field stock Integer @nullable;
}
```

然后：

```bash
qiy generate    # 重新生成 admin/，保留扩展文件和本地环境变量
qiy check       # 只校验模型，不写文件
```

重新生成后重启 `qiy dev`；开发时更推荐：

```bash
qiy dev --watch
```

`--watch` 会监听 `model/` 下的 `.qiy` 变更，防抖后自动重新生成、迁移并让 dev server 重新加载。保存模型即可看到字段变化。

## 5. 常用命令

所有命令都在项目根目录运行，都会自动找到 `qiy.project.json`：

| 命令 | 作用 |
| --- | --- |
| `qiy check` | 校验模型并打印实体/字段/关系统计，不写文件 |
| `qiy generate` | 生成或同步 `admin/` |
| `qiy dev` | 生成 + 首次安装/迁移 + 启动开发环境 |
| `qiy test` | 运行生成项目的测试 |
| `qiy build` | 生产构建 |
| `qiy preview` | 本地内存预览（不可部署） |
| `qiy explain` | 查看规范化模型摘要 |
| `qiy explain --errors` | 查看错误码与修复建议 |

## 6. 连接真实数据库

默认模板使用 SQLite。改成 PostgreSQL/MySQL 只需要编辑 `model/app.qiy`：

```qiy
database postgresql {}
```

然后在生成的工作区配置连接串：

```bash
# 编辑 admin/apps/server/.env.development 中的 DATABASE_URL
qiy dev
```

生产环境变量写在 `admin/apps/server/.env.production`；`qiy generate` 不会覆盖已有环境变量值。

## 7. 下一步

- [设计理念](/guide/design-philosophy)：为什么 Qiy 是项目优先、命令优先、模块优先
- [项目结构](/guide/project-structure)：`model/`、`admin/` 和扩展点
- [定义数据模型](/guide/data-modeling)：实体、字段、关系
- [CLI 参考](/guide/cli)：全部命令与参数
