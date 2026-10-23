type RealtimeAdminEnvironment = {
  QIY_REALTIME_ADMIN_URL?: string;
  QIY_REALTIME_ADMIN_TOKEN?: string;
  PORT?: string;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function usage(): string {
  return "Usage: bun src/realtime-admin.ts <metrics|prometheus|health|dead|replay|cleanup> [ids...|retentionDays]";
}

function baseUrl(environment: RealtimeAdminEnvironment): string {
  const configured = environment.QIY_REALTIME_ADMIN_URL ?? `http://127.0.0.1:${environment.PORT ?? "3000"}/api/v1/realtime/outbox`;
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("QIY_REALTIME_ADMIN_URL must use http or https");
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function parseRetentionDays(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("retentionDays must be an integer between 1 and 3650");
  return days;
}

export async function runRealtimeAdmin(
  argv: string[],
  environment: RealtimeAdminEnvironment = Bun.env as RealtimeAdminEnvironment,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  const token = environment.QIY_REALTIME_ADMIN_TOKEN?.trim();
  if (!token) throw new Error("QIY_REALTIME_ADMIN_TOKEN is required");
  const [command, ...arguments_] = argv;
  const root = baseUrl(environment);
  let url = root;
  let method = "GET";
  let body: string | undefined;
  if (command === "metrics") url += "/metrics";
  else if (command === "prometheus") url += "/metrics/prometheus";
  else if (command === "health") url += "/health";
  else if (command === "dead") url += "/dead";
  else if (command === "replay") {
    if (arguments_.length < 1 || arguments_.length > 100 || new Set(arguments_).size !== arguments_.length) throw new Error("replay requires 1-100 unique event UUIDs");
    method = "POST";
    url += "/replay";
    body = JSON.stringify({ ids: arguments_ });
  } else if (command === "cleanup") {
    if (arguments_.length > 1) throw new Error(usage());
    method = "DELETE";
    const retentionDays = parseRetentionDays(arguments_[0]);
    url += `/delivered${retentionDays === undefined ? "" : `?retentionDays=${retentionDays}`}`;
  } else throw new Error(usage());
  const response = await fetcher(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body,
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text && response.headers.get("content-type")?.startsWith("text/plain")) payload = text;
  else if (text) {
    try { payload = JSON.parse(text); } catch { payload = { error: text }; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : `Realtime administration failed with HTTP ${response.status}`;
    throw Object.assign(new Error(message), { statusCode: response.status, payload });
  }
  return payload;
}

if (import.meta.main) {
  runRealtimeAdmin(Bun.argv.slice(2)).then((payload) => console.log(typeof payload === "string" ? payload.trimEnd() : JSON.stringify(payload))).catch((error) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), statusCode: (error as { statusCode?: number }).statusCode }));
    process.exitCode = 1;
  });
}
