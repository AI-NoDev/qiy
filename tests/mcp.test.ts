import { expect, test } from "bun:test";
import { MCP_PROTOCOL_VERSION, handleMcpMessage } from "../tools/mcp";

test("MCP initialize advertises tools capability", () => {
  const response = handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  expect(response).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "qiy" } } });
});

test("MCP tools/list exposes explain, schema and error catalog", () => {
  const response = handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }) as { result: { tools: Array<{ name: string }> } };
  expect(response.result.tools.map((tool) => tool.name)).toEqual(["qiy_explain", "qiy_schema", "qiy_error_catalog"]);
});

test("MCP qiy_explain parses source and returns structured errors", () => {
  const ok = handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "qiy_explain", arguments: { source: "qiy v0; application demo { database sqlite {} entity items { field id UUID @id; field name Text; } }" } } }) as { result: { content: Array<{ text: string }> } };
  expect(JSON.parse(ok.result.content[0]!.text)).toMatchObject({ valid: true, application: { name: "demo" }, entities: [{ name: "items" }] });
  const bad = handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "qiy_explain", arguments: { source: "not a model" } } }) as { result: { isError: boolean; content: Array<{ text: string }> } };
  expect(bad.result.isError).toBe(true);
  expect(JSON.parse(bad.result.content[0]!.text).valid).toBe(false);
});

test("MCP schema and method errors", () => {
  const schema = handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "qiy_schema", arguments: {} } }) as { result: { content: Array<{ text: string }> } };
  expect(JSON.parse(schema.result.content[0]!.text).title).toBeDefined();
  const unknown = handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "unknown" }) as { error: { code: number } };
  expect(unknown.error.code).toBe(-32601);
});
