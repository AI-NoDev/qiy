# 设计理念

Qiy 的目标不是"生成一堆代码"，而是让**一个人或一个 AI Agent 用最少的命令和最简单的模型，得到一套可长期维护的全栈应用**。所有设计取舍都围绕这一点。

## 1. 项目优先，命令优先

用户不需要理解生成器内部，只需要理解三个对象：

```text
项目（qiy.project.json）
  ├─ 模型（model/，人和 Agent 写）
  └─ 生成物（admin/，Qiy 管理）
```

对应三条命令：

```bash
qiy create project shop   # 创建项目
qiy generate              # 从模型生成
qiy dev                   # 生成并运行
```

命令行是唯一入口。文档、错误信息、AI Skill 都围绕命令组织，而不是围绕仓库目录或生成器实现。

## 2. 模块化是默认，不是高级技巧

模型按**业务域**拆分，而不是按生成器步骤拆分：

```text
model/
  app.qiy                  # 入口：database + include
  modules/
    10-catalog.qiy         # 商品、订单
    20-relations.qiy       # 关系
    30-ui.qiy              # 菜单、图表
    40-permissions.qiy     # 权限（按需启用）
    50-dataflows.qiy       # 事务命令（按需启用）
```

小项目可以只用一个文件；项目变大时，不需要重构入口，只需要增加模块。

## 3. 先能跑，再变复杂

默认模板必须能直接 `qiy dev` 跑起来。权限、认证、dataflow、实时、存储等能力以**可选模块 + 注释示例**提供，不强迫新用户一次理解全部 DSL。

复杂度只在你需要时出现，这是 Qiy 的"渐进式披露"。

## 4. 语法接近需求，但保持确定性

Qiy 的语法不是配置文件，也不是自由自然语言，而是**受限的自然语法**：

- 关键词少、标点少、顺序稳定；
- 读起来像业务描述：`entity orders`、`field price Money(12,2)`、`relation orderProduct ...`；
- 同一语义只有一种规范写法；格式化器保证 AI 和人写出的风格一致；
- 不用自然语言解析器处理"给订单加个金额"这类模糊输入——这会让结果不可复现。Agent 应该生成**结构化、可校验**的文本。

当前 V0 语法已经稳定；更简洁的字段/关系写法（如 `customer: Customer`、`lines: OrderLine[]`）会以 v1 语法提案的方式演进，并保留 v0 兼容与 `qiy fmt` 迁移，不会静默改变现有模型。

## 5. 显式授权，默认安全

- 隐藏按钮不是授权；服务端 `allow`/`require`/`restrict`/`scope` 才是边界；
- 生产 API 默认拒绝无认证启动；
- 密钥只放环境变量或 secret manager，不写进 `.qiy`；
- 生成物可重新生成，手写扩展放在 `extensions/`，边界由 `.qiy-generated.json` 明确。

## 6. AI Agent 是一等用户

Qiy 为 Agent 提供：

- `qiy create project` / `qiy generate` / `qiy check` / `qiy dev` 等确定性命令；
- `qiy explain --json` + `qiy schema` 的机器可读模型摘要；
- `qiy explain --errors` 的稳定错误码和修复建议；
- `qiy skill install` 安装官方 Agent Skill，离线包含完整 DSL 参考；
- 固定目录、固定文件名、幂等命令、可重复的生成结果。

Agent 不需要猜"应该把文件放哪"或"改哪个生成文件"，只需要读 `qiy.project.json`、改 `model/`、跑命令。

## 7. 文档也遵守同样的理念

- 每页先给**目标**和**命令**，再给语法；
- 快速开始不出现 `git clone` 或 `tools/` 内部脚本；
- 生成器维护者文档与应用开发者文档分开；
- 所有示例都可以从空项目开始复现。

## 8. 可验证，才算完成

`qiy check`、`qiy test`、`qiy build` 是完成定义的一部分。Qiy 不承诺"生成即正确"，而是让模型校验、类型检查、生成测试和真实数据库验收都可用一条命令重复执行。
