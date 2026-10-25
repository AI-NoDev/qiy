import { expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiKeyRecord } from "../app/api-keys";

const records: ApiKeyRecord[] = [
  { id: "a", name: "Deploy", prefix: "abcdef12", maskedKey: "qiy_abcdef12_********", createdAt: "2025-12-01T00:00:00Z", lastUsedAt: "2025-12-31T23:59:00Z", expiresAt: null, revokedAt: null },
  { id: "b", name: "Old key", prefix: "bbbbbbbb", maskedKey: "qiy_bbbbbbbb_********", createdAt: "2025-11-01T00:00:00Z", lastUsedAt: null, expiresAt: "2025-12-31T00:00:00Z", revokedAt: null },
  { id: "c", name: "Revoked key", prefix: "cccccccc", maskedKey: "qiy_cccccccc_********", createdAt: "2025-10-01T00:00:00Z", lastUsedAt: null, expiresAt: null, revokedAt: "2025-12-31T00:00:00Z" },
];
const identity = { id: "admin", role: "operator", permissions: ["inventory:receive", "report:read"], groups: ["ManagerRole"] };

const refine = await import("@refinedev/core");
mock.module("@refinedev/core", () => ({
  ...refine,
  useTranslation: () => ({ translate: (_key: string, _params?: unknown, fallback?: string) => fallback ?? "", getLocale: () => "en-US", changeLocale: async () => "en-US" }),
  useGetIdentity: () => ({ data: identity, isLoading: false }),
  useNotification: () => ({ open: () => undefined }),
}));
const router = await import("react-router");
mock.module("react-router", () => ({ ...router, Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement("a", { href: to, ...rest }, children), Navigate: () => null }));

const { ApiKeysPage } = await import("../app/components/api-keys-page");

test("renders the access-keys page with curl examples, permission tags and rows", () => {
  const html = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records }));
  expect(html).toContain("Access keys");
  expect(html).toContain("Authorization: Bearer qiy_");
  expect(html).toContain("X-API-Key: qiy_");
  expect(html).toContain("role: operator");
  expect(html).toContain("permission: inventory:receive");
  expect(html).toContain("group: ManagerRole");
  expect(html).toContain("data-tooltip");
  expect(html).toContain("Deploy");
  expect(html).toContain("qiy_abcdef12_********");
  expect(html).toContain("Active");
  expect(html).toContain("Expired");
  expect(html).toContain("Revoked");
  expect(html).toContain("Create key");
  expect(html).toContain("/system/api-docs");
});

test("filters keys by search and status", () => {
  const search = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialSearch: "Old key" }));
  expect(search).toContain("Old key");
  expect(search).not.toContain("Deploy");
  const revoked = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialStatus: "revoked" }));
  expect(revoked).toContain("Revoked key");
  expect(revoked).not.toContain("Deploy");
});

test("renders the create modal and the one-time secret flow", () => {
  const create = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialCreateOpen: true }));
  expect(create).toContain("Create key");
  expect(create).toContain("Expires (optional)");
  expect(create).toContain("inherits your current role and permissions");
  const secret = renderToStaticMarkup(createElement(ApiKeysPage, { identity, initialRecords: records, initialSecret: "qiy_abcdef12_one-time-secret" }));
  expect(secret).toContain("Save this secret now");
  expect(secret).toContain("shown only once");
  expect(secret).toContain("qiy_abcdef12_one-time-secret");
});
