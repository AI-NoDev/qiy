import { expect, test } from "bun:test";
import { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";

test("REST trend requests the selected UTC day window", async () => {
  const requests: string[] = [];
  const fetcher = (async (url: RequestInfo | URL) => { requests.push(String(url)); return Response.json([{ day: "2026-10-06", count: 2 }]); }) as typeof fetch;
  const endpoint = "/api/v1/orders/trend";
  const result = await createDataProvider(fetcher).custom?.({ url: endpoint, method: "get", query: { field: "createdAt", days: 30 } });
  expect(result?.data.items).toEqual([{ day: "2026-10-06", count: 2 }]);
  expect(requests).toEqual([endpoint + "?field=createdAt&days=30"]);
  await expect(createDataProvider(fetcher).custom?.({ url: endpoint, method: "get", query: { field: "createdAt", days: 366 } })).rejects.toThrow("Invalid trend days");
  await expect(createDataProvider(fetcher).custom?.({ url: endpoint, method: "get", query: { field: "missing", days: 30 } })).rejects.toThrow("Unknown trend field");
});

test("GraphQL trend requests the same field and day window", async () => {
  const requests: string[] = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { requests.push(String(init?.body)); return Response.json({ data: { ordersTrend: [{ day: "2026-10-06", count: 2 }] } }); }) as typeof fetch;
  const result = await createGraphQLDataProvider(fetcher).custom?.({ url: "/api/v1/orders/trend", method: "get", query: { field: "createdAt", days: 30 } });
  expect(result?.data.items).toEqual([{ day: "2026-10-06", count: 2 }]);
  expect(JSON.parse(requests[0]!).variables).toEqual({ field: "createdAt", days: 30 });
});
