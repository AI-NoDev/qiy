import packageMetadata from "../package.json" with { type: "json" };
import { explainQiySource } from "./commands/explain";
import { qiyExplanationSchema } from "./qiy-schema";
import { findQiyError, qiyErrorCatalog } from "./error-catalog";

declare const __QIY_VERSION__: string;
const VERSION = typeof __QIY_VERSION__ === "string" ? __QIY_VERSION__ : packageMetadata.version;

export const AGENT_DEFAULT_PORT = 7331;
const MAX_SOURCE_BYTES = 1_000_000;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json", Allow: allow } });
}

/** Read-only HTTP API used by local agents: explain/validate source, schema and error catalog. */
export async function handleAgentRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return json({ ok: true, name: "qiy", version: VERSION });
  }
  if (url.pathname === "/schema") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return json(qiyExplanationSchema);
  }
  if (url.pathname === "/errors") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return json(qiyErrorCatalog.map(({ code, title, description, fix, docs }) => ({ code, title, description, fix, docs })));
  }
  if (url.pathname === "/explain" || url.pathname === "/validate") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) return json({ error: "Content-Type must be application/json" }, 415);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_SOURCE_BYTES) return json({ error: "Request body too large" }, 413);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const source = body && typeof body === "object" ? (body as { source?: unknown }).source : undefined;
    if (typeof source !== "string" || source.trim() === "") return json({ error: "source must be a non-empty string" }, 400);
    if (source.length > MAX_SOURCE_BYTES) return json({ error: "source too large" }, 413);
    try {
      return json(explainQiySource(source, "<agent>"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const known = findQiyError(message);
      return json({ valid: false, error: message, ...(known ? { code: known.code, title: known.title, fix: known.fix, docs: known.docs } : {}) }, 422);
    }
  }
  return json({ error: "Not found" }, 404);
}

export function startAgentServer(port = AGENT_DEFAULT_PORT): ReturnType<typeof Bun.serve> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid agent port: ${port}`);
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: handleAgentRequest });
  console.log(`Qiy agent API listening on http://127.0.0.1:${server.port}`);
  return server;
}
