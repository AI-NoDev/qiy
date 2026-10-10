import { expect, test } from "bun:test";
import { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";

const orderId = "00000000-0000-4000-8000-000000000001";
for (const [name, createProvider] of [["REST", createDataProvider], ["GraphQL", createGraphQLDataProvider]] as const) {
  test(`${name} workflow posts to the same-origin command with idempotency header`, async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json({ id: orderId, status: "submitted" });
    };
    const result = await createProvider(fetcher).custom?.({ url: `/api/v1/orders/${orderId}/submit`, method: "post", meta: { idempotencyKey: "request-1" } });
    expect(result?.data).toEqual({ id: orderId, status: "submitted" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`/api/v1/orders/${orderId}/submit`);
    expect(requests[0]?.init?.method).toBe("POST");
    expect((requests[0]?.init?.headers as Record<string, string>)["idempotency-key"]).toBe("request-1");
  });

  test(`${name} workflow rejects arbitrary commands and surfaces server errors`, async () => {
    const fetcher = async () => Response.json({ error: "Only draft orders can be submitted" }, { status: 409 });
    const provider = createProvider(fetcher);
    await expect(provider.custom?.({ url: `/api/v1/orders/${orderId}/publish`, method: "post" })).rejects.toThrow("Unknown workflow command");
    await expect(provider.custom?.({ url: `/api/v1/orders/${orderId}/submit`, method: "post" })).rejects.toThrow("Only draft orders can be submitted");
  });
}
