import { expect, test } from "bun:test";
import { runRealtimeAdmin } from "../src/realtime-admin";

test("uses an administrator bearer token and returns machine-readable metrics", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await runRealtimeAdmin(["metrics"], {
    QIY_REALTIME_ADMIN_URL: "https://admin.example/api/v1/realtime/outbox/",
    QIY_REALTIME_ADMIN_TOKEN: "secret-admin-token",
  }, async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ pending: 2, leased: 1, deadLettered: 0, delivered: 5, oldestPendingAt: null });
  });
  expect(result).toEqual({ pending: 2, leased: 1, deadLettered: 0, delivered: 5, oldestPendingAt: null });
  expect(requests[0]?.url).toBe("https://admin.example/api/v1/realtime/outbox/metrics");
  expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer secret-admin-token");
});

test("routes replay and cleanup through authenticated audited HTTP endpoints", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json({ ok: true });
  };
  const environment = { QIY_REALTIME_ADMIN_TOKEN: "admin", PORT: "3100" };
  await runRealtimeAdmin(["replay", "00000000-0000-4000-8000-000000000001"], environment, fetcher);
  await runRealtimeAdmin(["cleanup", "30"], environment, fetcher);
  expect(requests[0]?.url).toBe("http://127.0.0.1:3100/api/v1/realtime/outbox/replay");
  expect(requests[0]?.init?.method).toBe("POST");
  expect(requests[0]?.init?.body).toBe('{"ids":["00000000-0000-4000-8000-000000000001"]}');
  expect(requests[1]?.url).toBe("http://127.0.0.1:3100/api/v1/realtime/outbox/delivered?retentionDays=30");
  expect(requests[1]?.init?.method).toBe("DELETE");
});

test("reads health JSON and Prometheus text through the same authenticated API", async () => {
  const requests: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    requests.push(String(input));
    if (String(input).endsWith("/metrics/prometheus")) return new Response("qiy_realtime_outbox_pending 2\n", { headers: { "content-type": "text/plain; version=0.0.4" } });
    return Response.json({ status: "ok", alerts: [] });
  };
  const environment = { QIY_REALTIME_ADMIN_TOKEN: "admin" };
  expect(await runRealtimeAdmin(["health"], environment, fetcher)).toEqual({ status: "ok", alerts: [] });
  expect(await runRealtimeAdmin(["prometheus"], environment, fetcher)).toBe("qiy_realtime_outbox_pending 2\n");
  expect(requests).toEqual([
    "http://127.0.0.1:3000/api/v1/realtime/outbox/health",
    "http://127.0.0.1:3000/api/v1/realtime/outbox/metrics/prometheus",
  ]);
});

test("fails closed without credentials or with ambiguous arguments", async () => {
  await expect(runRealtimeAdmin(["metrics"], {})).rejects.toThrow("QIY_REALTIME_ADMIN_TOKEN is required");
  await expect(runRealtimeAdmin(["replay", "same", "same"], { QIY_REALTIME_ADMIN_TOKEN: "admin" })).rejects.toThrow("unique event UUIDs");
  await expect(runRealtimeAdmin(["cleanup", "0"], { QIY_REALTIME_ADMIN_TOKEN: "admin" })).rejects.toThrow("between 1 and 3650");
});
