# MCP server

Qiy ships a local **Model Context Protocol** server over stdio. Agents can
validate and explain `.qiy` source without running generation or scraping CLI
output.

## Start

```bash
qiy mcp
```

The server speaks line-delimited JSON-RPC 2.0. It reads from stdin and writes
one JSON response per line; logs must go to stderr (Qiy writes none).

Typical MCP client configuration:

```json
{
  "mcpServers": {
    "qiy": {
      "command": "qiy",
      "args": ["mcp"]
    }
  }
}
```

If `qiy` is not on `PATH`, use the absolute executable path or `bunx qiy mcp`.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `qiy_explain` | `{ "source": "<complete .qiy model>" }` | Same structure as `qiy explain --json`: application, entities, fields, relations, permissions, dataflows, charts, counts |
| `qiy_schema` | `{}` | JSON Schema for the explain result |
| `qiy_error_catalog` | `{}` | Stable error codes, titles, fixes and docs links |

`qiy_explain` is read-only: it parses the supplied source in memory and never
writes files. On invalid input the tool returns `isError: true` with either a
stable `code` or the raw parser message.

## Protocol

- `initialize` returns protocol `2024-11-05` and `tools` capability.
- `notifications/initialized` and `notifications/cancelled` are accepted without
  a response.
- `tools/list` returns the tools above.
- `tools/call` returns MCP `content` blocks; the text block contains pretty JSON.
- Unknown methods return JSON-RPC `-32601`; malformed JSON returns `-32700`.

## Security

The MCP server does not read arbitrary paths, execute generated code, install
packages or write the workspace. It only parses the source string supplied by
the client. Generation still belongs to `qiy generate` / `qiy dev` under the
user's normal CLI permissions.

## Example

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"qiy_explain","arguments":{"source":"qiy v0; application demo { database sqlite {} entity items { field id UUID @id; field name Text; } }"}}}
```
