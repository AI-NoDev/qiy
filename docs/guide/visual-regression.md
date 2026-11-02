# 布局快照（视觉回归）

生成应用的视觉回归使用 **DOM/文本布局快照**，而不是像素截图。目标是跨平台稳定，捕获结构性回归：页面标题、侧边栏、搜索框、列顺序、危险操作是否出现。

## 覆盖

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

快照位于：

```text
e2e/generated.spec.ts-snapshots/view-layout.json
```

配置 `snapshotPathTemplate` 去掉了平台后缀，因此 Windows/Linux/macOS 共用同一份基线。

## 运行

```bash
bun run e2e:generated
```

更新基线：

```bash
bun run e2e:generated --update-snapshots
```

## 为什么不用像素

- 字体、抗锯齿、DPR 在 CI 与本地不同，像素基线容易假失败；
- 布局快照直接验证“用户能看到什么结构”，更适合 generated admin 的稳定层；
- 真正视觉走查仍应在浏览器中人工或使用专用视觉平台完成。

## 边界

- 不检测颜色、间距、像素级对齐；
- 不覆盖所有页面，目前覆盖只读 view 列表；
- 文案变更会更新快照，需要 code review 确认是预期变化。
