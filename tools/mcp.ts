import { readFileSync } from "node:fs";
import { explainQiySource } from "./commands/explain";
import { qiyExplanationSchema } from "./qiy-schema";
import { findQiyError, qiyErrorCatalog } from "./error-catalog";

export const MCP_PROTOCOL_VERSION = "2024-11-05";
const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type McpResponse = JsonRpcSuccess | JsonRpcFailure;

const tools = [
  {
    name: "qiy_explain",
    description: "Parse and explain a Qiy model from source text without writing files. Returns entities, fields, relations, permissions, dataflows, charts and counts, or a structured error.",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string", description: "Complete .qiy model source." } },
      required: ["source"],
      additionalProperties: false,
    },
  },
  {
    name: "qiy_schema",
    description: "Return the JSON Schema for qiy_explain / `qiy explain --json` output.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "qiy_error_catalog",
    description: "List stable Qiy error codes, titles, fixes and documentation links.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

function textContent(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function callTool(name: string, args: Record<string, unknown>) {
  if (name === "qiy_explain") {
    const source = args.source;
    if (typeof source !== "string" || source.trim() === "") return textContent("qiy_explain requires a non-empty source string", true);
    try {
      return textContent(explainQiySource(source, "<mcp>"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const known = findQiyError(message);
      return textContent({ valid: false, error: message, ...(known ? { code: known.code, title: known.title, fix: known.fix, docs: known.docs } : {}) }, true);
    }
  }
  if (name === "qiy_schema") return textContent(qiyExplanationSchema);
  if (name === "qiy_error_catalog") return textContent(qiyErrorCatalog.map(({ code, title, description, fix, docs }) => ({ code, title, description, fix, docs })));
  return textContent(`Unknown tool: ${name}`, true);
}

/** Handles one JSON-RPC message from an MCP stdio client. */
export function handleMcpMessage(message: unknown): McpResponse | undefined {
  if (!message || typeof message !== "object") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  }
  const request = message as JsonRpcRequest;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return { jsonrpc: "2.0", id: request.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  const id = request.id ?? null;
  if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return undefined;
  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "qiy", version: VERSION },
      },
    };
  }
  if (request.method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (request.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const name = params.name;
    if (typeof name !== "string") return { jsonrpc: "2.0", id, error: { code: -32602, message: "tools/call requires a tool name" } };
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {};
    return { jsonrpc: "2.0", id, result: callTool(name, args) };
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${request.method}` } };
}

/** Runs the line-delimited JSON-RPC MCP server over stdin/stdout. */
export async function runMcpServer(): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  const write = (response: McpResponse | undefined) => {
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  };
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          write(handleMcpMessage(JSON.parse(line)));
        } catch (error) {
          write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } });
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) {
    try {
      write(handleMcpMessage(JSON.parse(buffer)));
    } catch (error) {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } });
    }
  }
}
