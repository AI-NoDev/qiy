import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const spec = {
  openapi: "3.1.0",
  info: { title: "Demo API", version: "1.0.0" },
  servers: [{ url: "/", description: "Same origin" }],
  tags: [{ name: "orders", description: "Orders" }, { name: "auth", description: "Auth" }],
  paths: {
    "/api/v1/orders": {
      get: {
        tags: ["orders"],
        summary: "List orders",
        security: [{ bearerSession: [] }, { apiKey: [] }],
        "x-qiy-roles": ["admin", "operator"],
        "x-qiy-permissions": [],
        parameters: [{ name: "page", in: "query", required: false, schema: { type: "integer" } }],
        responses: { "200": { description: "Paginated records" } },
      },
      post: {
        tags: ["orders"],
        summary: "Create order",
        security: [{ bearerSession: [] }],
        "x-qiy-roles": ["admin"],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { number: { type: "string" } } } } } },
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v1/auth/me": { get: { tags: ["auth"], summary: "Current principal", security: [{ bearerSession: [] }], responses: { "200": { description: "Principal" } } } },
  },
  "x-qiy-principal": { role: "operator", permissions: ["inventory:receive"] },
};

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useGetIdentity: () => ({ data: { id: "admin", role: "admin" }, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({ ...router, Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children), Navigate: () => null }));

const { ApiDocsPage } = await import("../app/components/api-docs-page");

test("renders the API reference page with tags, operations, parameters and curl", () => {
  const html = renderToStaticMarkup(createElement(ApiDocsPage, { spec }));
  expect(html).toContain("API reference");
  expect(html).toContain("Download OpenAPI");
  expect(html).toContain("Demo API");
  expect(html).toContain("orders");
  expect(html).toContain("auth");
  expect(html).toContain("GET");
  expect(html).toContain("/api/v1/orders");
  expect(html).toContain("List orders");
  expect(html).toContain("Parameters");
  expect(html).toContain("Request body");
  expect(html).toContain("Responses");
  expect(html).toContain("Security");
  expect(html).toContain("curl -X GET");
  expect(html).toContain("Authorization: Bearer");
  expect(html).toContain("Role: operator");
  expect(html).toContain("Permissions: inventory:receive");
  expect(html).toContain("data-tooltip");
  expect(html).toContain("filtered by the current account permissions");
  expect(html).toContain("operation(s)");
});

test("filters operations with the search box", () => {
  const filtered = renderToStaticMarkup(createElement(ApiDocsPage, { spec, initialSearch: "auth/me" }));
  expect(filtered).toContain("Current principal");
  expect(filtered).not.toContain("List orders");
  const noResults = renderToStaticMarkup(createElement(ApiDocsPage, { spec, initialSearch: "does-not-exist" }));
  expect(noResults).toContain("No operations match this search");
  expect(noResults).not.toContain("/api/v1/orders");
});

test("renders loading, error and empty states without network effects", () => {
  const empty = renderToStaticMarkup(createElement(ApiDocsPage, { spec: undefined }));
  expect(empty).toContain("Nothing to show");
  const loading = renderToStaticMarkup(createElement(ApiDocsPage, { spec, loading: true }));
  expect(loading).toContain("ant-spin");
  const error = renderToStaticMarkup(createElement(ApiDocsPage, { spec, error: "boom" }));
  expect(error).toContain("boom");
});
