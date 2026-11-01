export interface LoadOptions {
  url: string;
  requests?: number;
  concurrency?: number;
  timeoutMs?: number;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  p95Ms?: number;
}

export interface LoadReport {
  url: string;
  total: number;
  success: number;
  failed: number;
  durationMs: number;
  requestsPerSecond: number;
  latencyMs: { min: number; p50: number; p90: number; p95: number; p99: number; max: number };
  statuses: Record<string, number>;
  errors: string[];
}

export function summarizeLatencies(values: number[]): LoadReport["latencyMs"] {
  if (values.length === 0) return { min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (percentile: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1))]!;
  return { min: sorted[0]!, p50: at(50), p90: at(90), p95: at(95), p99: at(99), max: sorted.at(-1)! };
}

/** Runs a bounded, dependency-free HTTP load smoke and reports latency/error data. */
export async function runLoad(options: LoadOptions): Promise<LoadReport> {
  const url = new URL(options.url);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Load test URL must use http or https");
  const total = Math.max(1, Math.floor(options.requests ?? 100));
  const concurrency = Math.min(total, Math.max(1, Math.floor(options.concurrency ?? 10)));
  const timeoutMs = Math.max(100, Math.floor(options.timeoutMs ?? 10_000));
  const latencies: number[] = [];
  const statuses: Record<string, number> = {};
  const errors: string[] = [];
  let next = 0;
  const startedAt = performance.now();
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= total) return;
      const requestStarted = performance.now();
      try {
        const response = await fetch(options.url, {
          method: options.method ?? "GET",
          headers: options.headers,
          body: options.body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        latencies.push(performance.now() - requestStarted);
        statuses[String(response.status)] = (statuses[String(response.status)] ?? 0) + 1;
        await response.body?.cancel();
      } catch (error) {
        latencies.push(performance.now() - requestStarted);
        errors.push(error instanceof Error ? error.message : String(error));
        statuses.error = (statuses.error ?? 0) + 1;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const durationMs = performance.now() - startedAt;
  const failed = Object.entries(statuses).filter(([status]) => status === "error" || Number(status) >= 400).reduce((sum, [, count]) => sum + count, 0);
  return {
    url: options.url,
    total,
    success: total - failed,
    failed,
    durationMs,
    requestsPerSecond: durationMs > 0 ? (total / durationMs) * 1000 : 0,
    latencyMs: summarizeLatencies(latencies),
    statuses,
    errors: errors.slice(0, 10),
  };
}

function usage(): string {
  return `Usage: bun run load:test --url <http://127.0.0.1:3000/api/v1/health> [options]

Options:
  --url <url>            Target URL (required)
  --requests <n>         Total requests (default 100)
  --concurrency <n>      Parallel workers (default 10)
  --timeout <ms>         Per-request timeout (default 10000)
  --method <verb>        GET/POST/PUT/PATCH/DELETE (default GET)
  --header <k:v>         Add a header; repeatable
  --body <text>          Request body
  --p95 <ms>             Fail when p95 exceeds this threshold
  --json                 Print the JSON report only
`;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage());
    return;
  }
  const url = option(args, "--url");
  if (!url) {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  const headers: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== "--header") continue;
    const value = args[index + 1] ?? "";
    const separator = value.indexOf(":");
    if (separator > 0) headers[value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
  }
  const p95 = option(args, "--p95");
  const report = await runLoad({
    url,
    requests: Number(option(args, "--requests") ?? 100),
    concurrency: Number(option(args, "--concurrency") ?? 10),
    timeoutMs: Number(option(args, "--timeout") ?? 10_000),
    method: (option(args, "--method") as LoadOptions["method"]) ?? "GET",
    headers: Object.keys(headers).length ? headers : undefined,
    body: option(args, "--body"),
    p95Ms: p95 === undefined ? undefined : Number(p95),
  });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Load test: ${report.total} requests, ${report.requestsPerSecond.toFixed(1)} req/s\n`);
    process.stdout.write(`  success=${report.success} failed=${report.failed} duration=${report.durationMs.toFixed(0)}ms\n`);
    process.stdout.write(`  latency ms: p50=${report.latencyMs.p50.toFixed(1)} p90=${report.latencyMs.p90.toFixed(1)} p95=${report.latencyMs.p95.toFixed(1)} p99=${report.latencyMs.p99.toFixed(1)} max=${report.latencyMs.max.toFixed(1)}\n`);
    process.stdout.write(`  statuses: ${Object.entries(report.statuses).map(([status, count]) => `${status}=${count}`).join(" ")}\n`);
    if (report.errors.length) process.stdout.write(`  errors: ${report.errors.join("; ")}\n`);
  }
  if (report.failed > 0) process.exitCode = 1;
  if (p95 !== undefined && Number.isFinite(Number(p95)) && report.latencyMs.p95 > Number(p95)) {
    process.stderr.write(`p95 ${report.latencyMs.p95.toFixed(1)}ms exceeds ${p95}ms\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
