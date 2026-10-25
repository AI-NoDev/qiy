import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocsModel } from "../app/docs";

const model: DocsModel = {
  app: { name: "Test app", description: "Supply chain demo" },
  features: { apiDocs: true, apiKeys: true },
  principal: { role: "admin", permissions: ["inventory:receive"] },
  entities: [
    { name: "users", tableName: "users", label: "Users", labelKey: "qiy.resources.users.label", singular: "User", plural: "Users", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.users.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }], relations: [] },
    { name: "orders", tableName: "orders", label: "Orders", labelKey: "qiy.resources.orders.label", singular: "Order", plural: "Orders", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.orders.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }], relations: [{ field: "userId", toTable: "users", toField: "id" }] },
  ],
  relations: [{ fromTable: "orders", field: "userId", toTable: "users", toField: "id" }],
  enums: [],
  dataflows: [{ name: "receiveStock", label: "Receive stock", labelKey: "qiy.dataflows.receiveStock.label", allowRoles: ["admin"], allowPermissions: [], verification: null, inputs: [{ name: "quantity", type: "Integer", required: true, label: "quantity", labelKey: "" }], contexts: [{ name: "inventory", entity: "inventory" }], steps: [{ name: "load", actions: [{ kind: "update", summary: "update inventory" }] }], result: "inventory" }],
  permissions: { fields: [], groups: [], verifications: [] },
};
const spec = { openapi: "3.1.0", info: { title: "Test API", version: "1.0.0" }, paths: {} };

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  CanAccess: ({ children }: { children?: ReactNode }) => children,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useIsAuthenticated: () => ({ isAuthenticated: true, isLoading: false }),
  useGetIdentity: () => ({ data: { id: "admin", role: "admin" }, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({
  ...router,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children),
  Navigate: () => null,
}));

const { DocsOverviewPage } = await import("../app/components/docs-page");

test("renders the entity tab with the generated UML source", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, openApi: spec, initialTab: "entities" }));
  expect(html).toContain("Feature overview");
  expect(html).toContain('data-diagram="classDiagram');
  expect(html).toContain("e_users");
  expect(html).toContain("Relations");
});

test("renders the dataflow tab with a flowchart source", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, openApi: spec, initialTab: "dataflows" }));
  expect(html).toContain('data-diagram="flowchart LR');
  expect(html).toContain("d_receiveStock_step_0");
  expect(html).toContain("Receive stock");
});

test("renders the Scalar API-reference placeholder with the permission note", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, openApi: spec, initialTab: "api" }));
  expect(html).toContain("qiy-docs-scalar-placeholder");
  expect(html).toContain("filtered by the current account permissions");
});

test("renders the access-key tab with its create/list UI", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, openApi: spec, initialTab: "apiKeys" }));
  expect(html).toContain("API keys");
  expect(html).toContain("Create key");
  expect(html).toContain("No API keys yet");
});
