# 视觉回归

生成应用的视觉回归分两层：

| 层 | 比较对象 | 入口 | 基线 |
| --- | --- | --- | --- |
| 布局快照 | DOM/文本结构：标题、侧边栏、搜索框、列顺序、危险操作是否出现 | `bun run e2e:generated` | `e2e/generated.spec.ts-snapshots/view-layout.json` |
| 像素快照 | 整页截图：颜色、间距、字体、对齐、亮/暗主题 | `bun run e2e:visual` | `e2e/generated-visual.spec.ts-snapshots/*.png` |

## 布局快照

`e2e/generated.spec.ts` 中的只读 view 页面：

```json
{
  "heading": "product_names",
  "sidebar": true,
  "search": true,
  "columns": ["id", "name", "操作"],
  "hasCreate": false,
  "hasImport": false,
  "hasExport": true
}
```

配置 `snapshotPathTemplate` 去掉了平台后缀，因此 Windows/Linux/macOS 共用同一份基线。

## 像素快照

`e2e/generated-visual.spec.ts` 用 Playwright `toHaveScreenshot` 对新建表单（`/products/new`）分别截取亮色与暗色主题，与 PNG 基线逐像素比较。

字体、抗锯齿和系统字体回退在 Windows/macOS/Linux 之间不同，直接在宿主机截图会让基线假失败。因此 `bun run e2e:visual`（`tools/e2e-visual.ts`）会：

1. 用与 `@playwright/test` 同版本的官方镜像 `mcr.microsoft.com/playwright:v<版本>-noble` 启动 `playwright run-server`；
2. 以 `connectOptions.exposeNetwork: "<loopback>"` 连接容器里的浏览器，让它访问宿主机上的 E2E Admin（`localhost:5187`）；
3. 只运行 `visual` 项目，结束后停止容器。

所以本地与 CI 的截图都来自同一个 Linux 浏览器和字体栈，一份基线即可。前提是本机有 Docker。

```bash
bun run e2e:visual                      # 比较
bun run e2e:visual --update-snapshots   # 更新基线（确认差异符合预期后提交 PNG）
```

失败时 Playwright 在 `test-results/` 写出 `*-actual.png`、`*-expected.png` 与 `*-diff.png`；CI 的 `generated-e2e` 作业失败时会把该目录上传为 `generated-e2e-results` artifact。

## 运行

```bash
bun run e2e:generated                       # 布局快照 + CRUD/回收站 E2E
bun run e2e:generated --update-snapshots    # 更新布局基线
bun run e2e:visual                          # 像素快照（需要 Docker）
```

E2E 会在 `tmp/e2e-admin` 重新生成 fixture 应用，并自行启动 API（`:3187`）与 Admin（`:5187`），从不复用已在运行的服务，所以本机 `5173`/`3000` 上的其它开发服务器不会被误测；端口被占用时直接失败。API 以 `/api/v1/health` 应答为就绪，全局 setup（`e2e/fixtures/warm-up.ts`）会先把用例访问的路由各加载一遍，吸收首次编译和 Vite 依赖预构建引起的重载。端口可用 `QIY_E2E_API_PORT`、`QIY_E2E_WEB_PORT` 覆盖。

## 边界

- 像素快照覆盖新建表单的亮/暗主题；列表页数据随 E2E 累积变化，不做像素比较，由布局快照与 CRUD E2E 覆盖。
- Playwright 镜像版本跟随 `@playwright/test` 升级；升级后浏览器渲染可能变化，需要重新生成并审阅基线。
- 文案或主题变更会改变快照，需要在 code review 中确认是预期变化。
