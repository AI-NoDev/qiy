import { join, resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function verifyGeneratedRuntime(workspace: string): Promise<void> {
  const cwd = join(resolve(workspace), "apps/server");
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
  const port = reservation.port;
  reservation.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const request = (path: string, headers?: Record<string, string>) => fetch(origin + path, { headers, signal: AbortSignal.timeout(5000) });
  const preview = Bun.spawn([process.execPath, "src/preview.ts"], {
    cwd, env: { ...Bun.env, PORT: String(port), QIY_STORAGE_PROVIDER: "local", QIY_STORAGE_METADATA: "memory" },
    stdout: "ignore", stderr: "pipe",
  });
  const previewErrors = new Response(preview.stderr).text();
  try {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline && preview.exitCode === null) {
      try {
        const response = await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json() as { ok?: boolean }).ok === true) { ready = true; break; }
      } catch {}
      await Bun.sleep(100);
    }
    assert(ready, "Generated preview did not become healthy");
    const index = await request("/");
    assert(index.ok && index.headers.get("content-type")?.includes("text/html"), "Built homepage unavailable");
    const html = await index.text();
    assert(html.includes("/assets/"), "Built homepage has no client assets");
    const nested = await request("/users", { Accept: "text/html" });
    assert(nested.ok && await nested.text() === html, "SPA deep link does not return built index");
    const asset = html.match(/(?:src|href)="(\/assets\/[^" ]+)"/)?.[1];
    assert(asset, "Built client asset URL missing");
    assert((await request(asset)).ok, "Built client asset not served");
    const users = await request("/api/v1/users");
    assert(users.ok, "Preview resource API unavailable");
    const page = await users.json() as { data?: unknown[]; total?: number };
    assert(Array.isArray(page.data) && typeof page.total === "number", "Preview resource contract invalid");
    const openapi = await request("/api/v1/openapi/json");
    assert(openapi.ok && typeof (await openapi.json() as { paths?: unknown }).paths === "object", "OpenAPI schema unavailable");
    const unknown = await request("/api/v1/unknown-resource", { Accept: "text/html" });
    assert(unknown.status === 404 && !unknown.headers.get("content-type")?.includes("text/html"), "Unknown API fell back to SPA");
  } finally {
    preview.kill();
    await preview.exited;
    await previewErrors;
  }
  const production = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd, env: { ...Bun.env, DATABASE_URL: ":memory:", PORT: String(port), QIY_DEV_MODE: "0", QIY_STORAGE_PROVIDER: "local", QIY_STORAGE_METADATA: "database" },
    stdout: "ignore", stderr: "pipe",
  });
  const productionErrors = new Response(production.stderr).text();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([production.exited, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Unauthenticated production entry failed to stop")), 10000);
    })]);
    assert(code !== 0 && (await productionErrors).includes("Unauthenticated V0 admin API is disabled"), "Unauthenticated production entry did not fail closed");
  } finally {
    if (timeout) clearTimeout(timeout);
    if (production.exitCode === null) production.kill();
    await production.exited;
    await productionErrors;
  }
  console.log("Generated runtime: health, SPA, asset, resource API, OpenAPI, API isolation and production fail-closed passed");
}

if (import.meta.main) {
  const workspace = Bun.argv[2];
  if (!workspace) throw new Error("Usage: bun tools/verify-generated-runtime.ts <built-create-delete-workspace>");
  await verifyGeneratedRuntime(workspace);
}
