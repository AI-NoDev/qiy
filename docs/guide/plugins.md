# 生成器插件

生成器插件让你在 Qiy 生成核心工作区后追加文件，而不修改 Qiy 模板或生成器。

## 启用

在 `qiy.project.json` 增加 `plugins`：

```json
{
  "formatVersion": 1,
  "name": "shop",
  "template": "standard",
  "model": "model/app.qiy",
  "output": "admin",
  "plugins": ["./plugins/reports.ts"]
}
```

路径必须相对项目根目录，不能是绝对路径或逃出根目录。插件只在 **项目模式**（`qiy generate` / `qiy dev`）运行；旧式显式 `qiy generate <source> <output>` 不加载插件。

## 插件模块

默认导出一个对象：

```ts
export default {
  name: "reports",
  version: "1.0.0",
  generate({ appName, project, files }) {
    return {
      "apps/server/src/extensions/reports.ts":
        `export const app = ${JSON.stringify(appName)};\n` +
        `export const entities = ${project.database.entities.length};\n`,
      "docs/reports.md": `# ${appName} reports\n\nGenerated ${Object.keys(files).length} core files.\n`,
    };
  },
};
```

- `project` 是解析后的 Qiy IR，只读使用；
- `files` 是核心生成文件快照（只读）；
- 返回值是 `工作区相对路径 -> 字符串内容`；
- 返回 `undefined` 表示不追加文件；
- 插件可以 `async`；
- 插件文件会写入 `.qiy-generated.json`，随 `--sync` 清理。

## 安全边界

- 插件 **不能覆盖** 核心生成文件；返回已存在的路径会报错；
- 路径必须是工作区内的相对路径，`..`、绝对路径会被拒绝；
- 插件不接收写文件 API，只返回内容；
- 插件是本地代码，拥有与 CLI 相同的进程权限；只安装你信任的插件。
- 两个插件不能同名。

## 验证

```bash
qiy generate
qiy diff
```

`qiy diff` 也应用插件，因此能预览插件新增/变更的文件。
