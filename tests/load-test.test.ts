import { expect, test } from "bun:test";
import { runLoad, summarizeLatencies } from "../tools/load-test";

test("percentiles are ordered and bounded", () => {
  expect(summarizeLatencies([5, 1, 3, 2, 4])).toEqual({ min: 1, p50: 3, p90: 5, p95: 5, p99: 5, max: 5 });
  expect(summarizeLatencies([])).toEqual({ min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 });
});

test("load smoke reports successes, HTTP failures and status counts", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      return new URL(request.url).pathname === "/fail" ? new Response("bad", { status: 500 }) : new Response("ok");
    },
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const ok = await runLoad({ url: `${base}/`, requests: 30, concurrency: 5 });
    expect(ok.total).toBe(30);
    expect(ok.success).toBe(30);
    expect(ok.failed).toBe(0);
    expect(ok.statuses["200"]).toBe(30);
    expect(ok.latencyMs.p95).toBeGreaterThanOrEqual(0);
    const bad = await runLoad({ url: `${base}/fail`, requests: 12, concurrency: 3 });
    expect(bad.success).toBe(0);
    expect(bad.failed).toBe(12);
    expect(bad.statuses["500"]).toBe(12);
  } finally {
    server.stop(true);
  }
});
