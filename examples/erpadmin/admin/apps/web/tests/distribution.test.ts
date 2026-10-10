import { expect, test } from "bun:test";
import { createDataProvider, createGraphQLDataProvider } from "../app/data-provider";

test("REST distribution fetches aggregated counts without a page-size limit", async () => {
  const requests: string[] = [];
  const fetcher = (async (url: RequestInfo | URL) => { requests.push(String(url)); return Response.json([{ value: "draft", count: 150 }, { value: "approved", count: 100 }]); }) as typeof fetch;
  const result = await createDataProvider(fetcher).custom?.({ url: "/api/v1/users/distribution", method: "get", query: { field: "role" } });
  expect(result?.data.items).toEqual([{ value: "draft", count: 150 }, { value: "approved", count: 100 }]);
  expect(requests).toEqual(["/api/v1/users/distribution?field=role"]);
  await expect(createDataProvider(fetcher).custom?.({ url: "/api/v1/users/distribution", method: "get", query: { field: "missing" } })).rejects.toThrow("Unknown distribution field");
});

test("GraphQL distribution selects the same server aggregate", async () => {
  const requests: string[] = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { requests.push(String(init?.body)); return Response.json({ data: { usersDistribution: [{ value: "draft", count: 150 }] } }); }) as typeof fetch;
  const result = await createGraphQLDataProvider(fetcher).custom?.({ url: "/api/v1/users/distribution", method: "get", query: { field: "role" } });
  expect(result?.data.items).toEqual([{ value: "draft", count: 150 }]);
  expect(JSON.parse(requests[0]!).variables).toEqual({ field: "role" });
});
