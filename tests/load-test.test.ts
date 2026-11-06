import { expect, test } from "bun:test";
import { evaluateThresholds, mergeReports, runLoad, summarizeLatencies, type LoadReport } from "../tools/load-test";

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

test("duration mode runs until the deadline and warmup requests are not measured", async () => {
  let hits = 0;
  const server = Bun.serve({ port: 0, fetch() { hits++; return new Response("ok"); } });
  try {
    const report = await runLoad({ url: `http://127.0.0.1:${server.port}/`, durationMs: 300, warmup: 5, concurrency: 4 });
    expect(report.durationMs).toBeGreaterThanOrEqual(300);
    expect(report.total).toBeGreaterThan(0);
    expect(report.total).toBe(hits - 5);
    expect(report.samples).toHaveLength(report.total);
    expect(report.errorRate).toBe(0);
    expect(report.generators).toBe(1);
  } finally {
    server.stop(true);
  }
});

function report(samples: number[], statuses: Record<string, number>, requestsPerSecond: number, durationMs: number): LoadReport {
  const total = samples.length;
  const failed = Object.entries(statuses).filter(([status]) => status === "error" || Number(status) >= 400).reduce((sum, [, count]) => sum + count, 0);
  return { url: "http://target/", total, success: total - failed, failed, errorRate: failed / total, durationMs, requestsPerSecond, latencyMs: summarizeLatencies(samples), statuses, errors: [], generators: 1, samples };
}

test("reports from concurrent generators merge into exact percentiles and summed throughput", () => {
  const merged = mergeReports([report([1, 2, 3, 4], { "200": 4 }, 100, 1000), report([5, 6, 7, 8, 9, 10], { "200": 5, "500": 1 }, 150, 1200)]);
  expect(merged.total).toBe(10);
  expect(merged.failed).toBe(1);
  expect(merged.errorRate).toBeCloseTo(0.1);
  expect(merged.requestsPerSecond).toBe(250);
  expect(merged.durationMs).toBe(1200);
  expect(merged.generators).toBe(2);
  expect(merged.statuses).toEqual({ "200": 9, "500": 1 });
  expect(merged.latencyMs).toEqual(summarizeLatencies([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  expect(() => mergeReports([{ ...report([1], { "200": 1 }, 1, 1), samples: undefined }])).toThrow("write it with --out");
  expect(() => mergeReports([])).toThrow();
});

test("thresholds cover error rate, p95, p99 and minimum throughput", () => {
  const sample = report([10, 20, 30, 40, 200], { "200": 4, "503": 1 }, 50, 100);
  expect(evaluateThresholds(sample, {})).toEqual(["error rate 20.00% exceeds 0.00%"]);
  expect(evaluateThresholds(sample, { maxErrorRate: 0.25 })).toEqual([]);
  expect(evaluateThresholds(sample, { maxErrorRate: 0.25, p95Ms: 100, p99Ms: 150, minRequestsPerSecond: 60 })).toEqual([
    "p95 200.0ms exceeds 100ms",
    "p99 200.0ms exceeds 150ms",
    "throughput 50.0 req/s is below 60 req/s",
  ]);
});
