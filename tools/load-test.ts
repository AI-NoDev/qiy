export interface LoadOptions {
  url: string;
  requests?: number;
  /** Time-bound mode: keep sending until this many milliseconds elapse (overrides `requests`). */
  durationMs?: number;
  /** Requests sent before measuring; excluded from the report. */
  warmup?: number;
  concurrency?: number;
  timeoutMs?: number;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface LoadThresholds {
  p95Ms?: number;
  p99Ms?: number;
  /** Fraction of failed requests tolerated, 0..1 (default 0: any failure fails the run). */
  maxErrorRate?: number;
  minRequestsPerSecond?: number;
}

export interface LoadReport {
  url: string;
  total: number;
  success: number;
  failed: number;
  errorRate: number;
  durationMs: number;
  requestsPerSecond: number;
  latencyMs: { min: number; p50: number; p90: number; p95: number; p99: number; max: number };
  statuses: Record<string, number>;
  errors: string[];
  /** Number of load generators merged into this report (1 for a single run). */
  generators: number;
  /** Raw latency samples, kept so reports from several machines merge into exact percentiles. */
  samples?: number[];
}

export function summarizeLatencies(values: number[]): LoadReport["latencyMs"] {
  if (values.length === 0) return { min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (percentile: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1))]!;
  return { min: sorted[0]!, p50: at(50), p90: at(90), p95: at(95), p99: at(99), max: sorted.at(-1)! };
}

function failedCount(statuses: Record<string, number>): number {
  return Object.entries(statuses).filter(([status]) => status === "error" || Number(status) >= 400).reduce((sum, [, count]) => sum + count, 0);
}

/** Runs a bounded, dependency-free HTTP load smoke and reports latency/error data. */
export async function runLoad(options: LoadOptions): Promise<LoadReport> {
  const url = new URL(options.url);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Load test URL must use http or https");
  const durationLimit = options.durationMs !== undefined && Number.isFinite(options.durationMs) && options.durationMs > 0 ? Math.floor(options.durationMs) : undefined;
  const total = durationLimit ? Number.POSITIVE_INFINITY : Math.max(1, Math.floor(options.requests ?? 100));
  const concurrency = Math.min(total, Math.max(1, Math.floor(options.concurrency ?? 10)));
  const timeoutMs = Math.max(100, Math.floor(options.timeoutMs ?? 10_000));
  const send = (signal: AbortSignal) => fetch(options.url, { method: options.method ?? "GET", headers: options.headers, body: options.body, signal });
  const warmup = Math.max(0, Math.floor(options.warmup ?? 0));
  for (let index = 0; index < warmup; index++) {
    try {
      const response = await send(AbortSignal.timeout(timeoutMs));
      await response.body?.cancel();
    } catch {
      // Warmup only primes connections and caches; its failures are not measured.
    }
  }
  const latencies: number[] = [];
  const statuses: Record<string, number> = {};
  const errors: string[] = [];
  let next = 0;
  const startedAt = performance.now();
  const deadline = durationLimit ? startedAt + durationLimit : Number.POSITIVE_INFINITY;
  const worker = async () => {
    while (true) {
      if (performance.now() >= deadline) return;
      const index = next++;
      if (index >= total) return;
      const requestStarted = performance.now();
      try {
        const response = await send(AbortSignal.timeout(timeoutMs));
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
  const measured = latencies.length;
  const failed = failedCount(statuses);
  return {
    url: options.url,
    total: measured,
    success: measured - failed,
    failed,
    errorRate: measured > 0 ? failed / measured : 0,
    durationMs,
    requestsPerSecond: durationMs > 0 ? (measured / durationMs) * 1000 : 0,
    latencyMs: summarizeLatencies(latencies),
    statuses,
    errors: errors.slice(0, 10),
    generators: 1,
    samples: latencies,
  };
}

/**
 * Merges reports from load generators that ran concurrently against the same
 * target: counts and samples add up, throughput is the sum of each generator's
 * throughput, and percentiles are recomputed from the combined samples.
 */
export function mergeReports(reports: LoadReport[]): LoadReport {
  if (reports.length === 0) throw new Error("mergeReports needs at least one report");
  const missing = reports.findIndex((report) => !Array.isArray(report.samples));
  if (missing >= 0) throw new Error(`Report ${missing + 1} has no latency samples; write it with --out`);
  const statuses: Record<string, number> = {};
  for (const report of reports) for (const [status, count] of Object.entries(report.statuses)) statuses[status] = (statuses[status] ?? 0) + count;
  const samples = reports.flatMap((report) => report.samples!);
  const total = reports.reduce((sum, report) => sum + report.total, 0);
  const failed = failedCount(statuses);
  return {
    url: [...new Set(reports.map((report) => report.url))].join(", "),
    total,
    success: total - failed,
    failed,
    errorRate: total > 0 ? failed / total : 0,
    durationMs: Math.max(...reports.map((report) => report.durationMs)),
    requestsPerSecond: reports.reduce((sum, report) => sum + report.requestsPerSecond, 0),
    latencyMs: summarizeLatencies(samples),
    statuses,
    errors: reports.flatMap((report) => report.errors).slice(0, 10),
    generators: reports.reduce((sum, report) => sum + (report.generators ?? 1), 0),
    samples,
  };
}

/** Returns one message per violated threshold; an empty list means the run passed. */
export function evaluateThresholds(report: LoadReport, thresholds: LoadThresholds): string[] {
  const violations: string[] = [];
  const maxErrorRate = thresholds.maxErrorRate ?? 0;
  if (report.errorRate > maxErrorRate) violations.push(`error rate ${(report.errorRate * 100).toFixed(2)}% exceeds ${(maxErrorRate * 100).toFixed(2)}%`);
  if (thresholds.p95Ms !== undefined && report.latencyMs.p95 > thresholds.p95Ms) violations.push(`p95 ${report.latencyMs.p95.toFixed(1)}ms exceeds ${thresholds.p95Ms}ms`);
  if (thresholds.p99Ms !== undefined && report.latencyMs.p99 > thresholds.p99Ms) violations.push(`p99 ${report.latencyMs.p99.toFixed(1)}ms exceeds ${thresholds.p99Ms}ms`);
  if (thresholds.minRequestsPerSecond !== undefined && report.requestsPerSecond < thresholds.minRequestsPerSecond) violations.push(`throughput ${report.requestsPerSecond.toFixed(1)} req/s is below ${thresholds.minRequestsPerSecond} req/s`);
  return violations;
}

function usage(): string {
  return `Usage: bun run load:test --url <http://127.0.0.1:3000/api/v1/health> [options]
       bun run load:test --merge <report.json> <report.json> ... [thresholds]

Options:
  --url <url>              Target URL (required unless --merge)
  --requests <n>           Total requests (default 100)
  --duration <seconds>     Send for this long instead of a fixed request count
  --warmup <n>             Unmeasured warmup requests (default 0)
  --concurrency <n>        Parallel workers (default 10)
  --timeout <ms>           Per-request timeout (default 10000)
  --method <verb>          GET/POST/PUT/PATCH/DELETE (default GET)
  --header <k:v>           Add a header; repeatable
  --body <text>            Request body
  --out <file>             Write the JSON report with latency samples (for --merge)
  --merge <files...>       Combine reports from concurrent load generators
  --json                   Print the JSON report only

Thresholds (exit code 1 when violated):
  --p95 <ms>               Fail when p95 exceeds this
  --p99 <ms>               Fail when p99 exceeds this
  --max-error-rate <0..1>  Tolerated failed-request fraction (default 0)
  --min-rps <n>            Fail when throughput is below this
`;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(args: string[], name: string): number | undefined {
  const value = option(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage());
    return;
  }
  const thresholds: LoadThresholds = {
    p95Ms: numberOption(args, "--p95"),
    p99Ms: numberOption(args, "--p99"),
    maxErrorRate: numberOption(args, "--max-error-rate"),
    minRequestsPerSecond: numberOption(args, "--min-rps"),
  };
  if (thresholds.maxErrorRate !== undefined && thresholds.maxErrorRate > 1) throw new Error("--max-error-rate must be between 0 and 1");
  let report: LoadReport;
  const mergeIndex = args.indexOf("--merge");
  if (mergeIndex >= 0) {
    const rest = args.slice(mergeIndex + 1);
    const end = rest.findIndex((arg) => arg.startsWith("--"));
    const files = end < 0 ? rest : rest.slice(0, end);
    if (files.length === 0) throw new Error("--merge needs at least one report file");
    report = mergeReports(await Promise.all(files.map(async (file) => await Bun.file(file).json() as LoadReport)));
  } else {
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
    const durationSeconds = numberOption(args, "--duration");
    report = await runLoad({
      url,
      requests: numberOption(args, "--requests") ?? 100,
      durationMs: durationSeconds === undefined ? undefined : durationSeconds * 1000,
      warmup: numberOption(args, "--warmup"),
      concurrency: numberOption(args, "--concurrency") ?? 10,
      timeoutMs: numberOption(args, "--timeout") ?? 10_000,
      method: (option(args, "--method") as LoadOptions["method"]) ?? "GET",
      headers: Object.keys(headers).length ? headers : undefined,
      body: option(args, "--body"),
    });
  }
  const out = option(args, "--out");
  if (out) await Bun.write(out, JSON.stringify(report));
  const { samples: _samples, ...printable } = report;
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
  } else {
    const generators = report.generators > 1 ? ` from ${report.generators} generators` : "";
    process.stdout.write(`Load test: ${report.total} requests${generators}, ${report.requestsPerSecond.toFixed(1)} req/s\n`);
    process.stdout.write(`  success=${report.success} failed=${report.failed} errorRate=${(report.errorRate * 100).toFixed(2)}% duration=${report.durationMs.toFixed(0)}ms\n`);
    process.stdout.write(`  latency ms: p50=${report.latencyMs.p50.toFixed(1)} p90=${report.latencyMs.p90.toFixed(1)} p95=${report.latencyMs.p95.toFixed(1)} p99=${report.latencyMs.p99.toFixed(1)} max=${report.latencyMs.max.toFixed(1)}\n`);
    process.stdout.write(`  statuses: ${Object.entries(report.statuses).map(([status, count]) => `${status}=${count}`).join(" ")}\n`);
    if (report.errors.length) process.stdout.write(`  errors: ${report.errors.join("; ")}\n`);
  }
  const violations = evaluateThresholds(report, thresholds);
  for (const violation of violations) process.stderr.write(`${violation}\n`);
  if (violations.length) process.exitCode = 1;
}

if (import.meta.main) await main();
