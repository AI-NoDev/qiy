import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocsModel } from "../app/docs";

const model: DocsModel = {
  app: { name: "Test app", description: "Supply chain demo" },
  features: { overview: true, apiDocs: true, apiKeys: true },
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

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useGetIdentity: () => ({ data: { id: "admin", role: "admin" }, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({ ...router, Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children), Navigate: () => null }));

const { DocsOverviewPage } = await import("../app/components/docs-page");

test("renders the entity tab with the generated UML source", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, initialTab: "entities" }));
  expect(html).toContain("Feature overview");
  expect(html).toContain('data-diagram="classDiagram');
  expect(html).toContain("e_users");
  expect(html).toContain("Relations");
  expect(html).toContain("entities");
  expect(html).toContain("dataflows");
  expect(html).toContain("permissions");
  expect(html).not.toContain("API reference");
  expect(html).not.toContain("Access keys");
  expect(html).not.toContain("data-diagram=\"flowchart");
  expect((html.match(/data-diagram=/g) ?? []).length).toBe(1);
});

test("renders the dataflow tab with exactly one flowchart", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, initialTab: "dataflows" }));
  expect(html).toContain('data-diagram="flowchart LR');
  expect(html).toContain("d_receiveStock_step_0");
  expect(html).toContain("Receive stock");
  expect((html.match(/data-diagram=/g) ?? []).length).toBe(1);
});

test("renders the permission model tab without mounting other tabs", () => {
  const html = renderToStaticMarkup(createElement(DocsOverviewPage, { model, initialTab: "permissions" }));
  expect(html).toContain("Permissions");
  expect(html).toContain("admin");
  expect(html).not.toContain('data-diagram="classDiagram');
  expect(html).not.toContain('data-diagram="flowchart');
});
