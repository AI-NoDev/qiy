import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../src/http";

describe("same-origin API and SPA hosting", () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-static-"));
  const handle = createHandler(() => new Response("api"), root);
  test("API wins over SPA fallback", async () => {
    await Bun.write(join(root, "index.html"), "<h1>Qiy</h1>");
    expect(await (await handle(new Request("http://localhost/api/v1/health"))).text()).toBe("api");
    expect(await (await handle(new Request("http://localhost/graphql", { method: "POST" }))).text()).toBe("api");
    expect(await (await handle(new Request("http://localhost/graphql/", { method: "POST" }))).text()).toBe("api");
    expect(await (await handle(new Request("http://localhost/example/one/edit", { headers: { accept: "text/html" } }))).text()).toContain("Qiy");
  });
  test("serves assets but never returns HTML for missing files", async () => {
    await Bun.write(join(root, "asset.js"), "export default 1;");
    expect(await (await handle(new Request("http://localhost/asset.js"))).text()).toContain("default 1");
    expect((await handle(new Request("http://localhost/missing.js", { headers: { accept: "text/html" } }))).status).toBe(404);
    expect((await handle(new Request("http://localhost/example"))).status).toBe(404);
    expect((await handle(new Request("http://localhost/example", { method: "POST" }))).status).toBe(405);
    rmSync(root, { recursive: true, force: true });
  });
});
