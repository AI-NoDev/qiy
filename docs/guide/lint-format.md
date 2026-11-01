# Lint 与格式

Qiy 仓库使用 **oxlint** 做静态检查，使用 `qiy fmt` 处理 `.qiy` 模型格式。

## 命令

```bash
bun run lint       # 检查 tools/ 与 tests/，有告警即失败
bun run lint:fix   # 自动修复可修复项
bun run check      # TypeScript 类型检查
bun run qiy fmt    # 格式化 .qiy 模型
```

## 配置

[`.oxlintrc.json`](https://github.com/AI-NoDev/qiy/blob/main/.oxlintrc.json)：

- 只启用 `correctness` 类别，作为错误；
- 关闭与生成器模板字符串冲突的规则：
  - `no-constant-condition`
  - `no-useless-escape`
  - `unicorn/no-useless-fallback-in-spread`
  - `oxc/const-comparisons`
  - `typescript/no-non-null-asserted-optional-chain`

## CI

`verify` 作业在 Type-check 后执行 `bun run lint`；告警会阻断合并。

## 边界

- oxlint 不替代 TypeScript；两者都要通过。
- 生成器会输出大量模板字符串，部分「无用转义/常量条件」是生成代码的一部分，因此按规则关闭，而不是全局降级。
- 当前没有全仓自动格式化；`qiy fmt` 只负责 DSL，TypeScript 保持现有风格。
