# HTTP Agent API

`qiy agent` 在本机 loopback 启动只读 HTTP API，供 Agent、IDE 或本地工具调用。它和 `qiy mcp` 使用同一套 explain/schema/error-catalog 能力，但走 JSON HTTP。

```bash
qiy agent                 # 127.0.0.1:7331
qiy agent --port 8088
```

只绑定 `127.0.0.1`；没有远程监听选项。

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | `{ ok, name, version }` |
| `GET` | `/schema` | `qiy explain --json` 的 JSON Schema |
| `GET` | `/errors` | 稳定错误码、修复建议、文档链接 |
| `POST` | `/explain` | body `{ "source": "<.qiy 源码>" }` |
| `POST` | `/validate` | 与 `/explain` 相同（语义别名） |

## 示例

```bash
curl -s http://127.0.0.1:7331/explain \
  -H 'Content-Type: application/json' \
  -d '{"source":"qiy v0; application demo { database sqlite {} entity items { field id UUID @id; field name Text; } }"}'
```

成功返回与 `qiy explain --json` 相同的结构；解析失败返回 HTTP `422`：

```json
{
  "valid": false,
  "error": "Expected field or index",
  "code": "QIY...",
  "fix": "..."
}
```

## 安全边界

- 只读：不写工作区、不执行生成、不安装依赖、不读任意路径；
- 只监听 `127.0.0.1`；
- `Content-Type` 必须是 `application/json`；
- 请求体上限 1MB；
- 不接受 URL 或文件路径，只接受源码字符串；
- 没有认证；不要把它暴露到公网或反向代理。

## 与 MCP 的分工

- `qiy mcp`：stdio，适合 Claude/Cursor 等 MCP 客户端；
- `qiy agent`：HTTP，适合脚本、编辑器插件、浏览器外工具或本地服务间调用。

两者都不替代 `qiy generate`；生成仍需在用户权限下由 CLI 执行。
