import { extname, resolve, sep } from "node:path";

export function createHandler(api: (request: Request) => Response | Promise<Response>, clientRoot: string) {
  const root = resolve(clientRoot);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/graphql" || url.pathname.startsWith("/graphql/")) return api(request);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return new Response(null, { status: 400 }); }
    const path = resolve(root, pathname.replace(/^\/+/, ""));
    if (path !== root && !path.startsWith(root + sep)) return new Response(null, { status: 403 });
    const file = Bun.file(path === root ? resolve(root, "index.html") : path);
    if (await file.exists()) return new Response(request.method === "HEAD" ? null : file);
    if (extname(path) || !request.headers.get("accept")?.includes("text/html")) return new Response(null, { status: 404 });
    const index = Bun.file(resolve(root, "index.html"));
    if (!await index.exists()) return new Response("Web build missing: run bun run --bun build in web/", { status: 503 });
    return new Response(request.method === "HEAD" ? null : index, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  };
}
