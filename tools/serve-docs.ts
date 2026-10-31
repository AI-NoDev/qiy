import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Tiny static server for the built VitePress site, used by Playwright. */
const root = fileURLToPath(new URL("../docs/.vitepress/dist/", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const candidate = Bun.file(join(root, path || "index.html"));
    if (await candidate.exists()) return new Response(candidate);
    const html = Bun.file(join(root, `${path.replace(/\/$/, "")}.html`));
    if (await html.exists()) return new Response(html);
    const fallback = Bun.file(join(root, path.replace(/\/$/, ""), "index.html"));
    if (await fallback.exists()) return new Response(fallback);
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Docs preview: http://127.0.0.1:${port}`);
