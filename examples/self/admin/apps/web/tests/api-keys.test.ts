import { expect, test } from "bun:test";
import {
  QIY_API_KEY_MAX_ACTIVE,
  apiKeyCurlExamples,
  apiKeyMatches,
  apiKeyStatus,
  apiKeyStatusOptions,
  canCreateApiKey,
  countActiveApiKeys,
  defaultApiKeyName,
  filterApiKeys,
  formatApiKeyDate,
  maskedApiKey,
  permissionTags,
  relativeTime,
  type ApiKeyRecord,
} from "../app/api-keys";

const now = new Date("2026-01-01T00:00:00Z");
const active: ApiKeyRecord = { id: "a", name: "Deploy", prefix: "abcdef12", maskedKey: "qiy_abcdef12_********", createdAt: "2025-12-01T00:00:00Z", lastUsedAt: null, expiresAt: null, revokedAt: null };
const expired: ApiKeyRecord = { ...active, id: "b", name: "Old key", prefix: "bbbbbbbb", expiresAt: "2025-12-31T00:00:00Z" };
const revoked: ApiKeyRecord = { ...active, id: "c", name: "Revoked key", prefix: "cccccccc", revokedAt: "2025-12-31T00:00:00Z" };

test("status, counts and limits mirror the server rules", () => {
  expect(maskedApiKey("abcdef12")).toBe("qiy_abcdef12_********");
  expect(apiKeyStatus(active, now)).toBe("active");
  expect(apiKeyStatus(expired, now)).toBe("expired");
  expect(apiKeyStatus(revoked, now)).toBe("revoked");
  expect(countActiveApiKeys([active, expired, revoked], now)).toBe(1);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE - 1 }, () => active), now)).toBe(true);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE }, () => active), now)).toBe(false);
  expect(defaultApiKeyName([], now)).toBe("Key 2026-01-01");
  expect(formatApiKeyDate(null, "en-US")).toBe("\u2014");
  expect(formatApiKeyDate("2026-01-01T00:00:00Z", "en-US")).toContain("2026");
  expect(apiKeyStatusOptions()).toEqual(["all", "active", "revoked", "expired"]);
});

test("searches and filters keys by name, prefix and status", () => {
  expect(apiKeyMatches(active, "dep")).toBe(true);
  expect(apiKeyMatches(active, "abcdef12")).toBe(true);
  expect(apiKeyMatches(active, "revoked")).toBe(false);
  expect(filterApiKeys([active, expired, revoked], { search: "" }, now).map((record) => record.id)).toEqual(["a", "b", "c"]);
  expect(filterApiKeys([active, expired, revoked], { search: "deploy" }, now).map((record) => record.id)).toEqual(["a"]);
  expect(filterApiKeys([active, expired, revoked], { search: "", status: "revoked" }, now).map((record) => record.id)).toEqual(["c"]);
  expect(filterApiKeys([active, expired, revoked], { search: "", status: "expired" }, now).map((record) => record.id)).toEqual(["b"]);
  expect(filterApiKeys([active, expired, revoked], { search: "missing" }, now)).toEqual([]);
});

test("maps identity permissions and formats relative times and curl examples", () => {
  expect(permissionTags({ role: "operator", permissions: ["inventory:receive", "report:read"], groups: ["ManagerRole"] })).toEqual([
    { key: "role:operator", kind: "role", value: "operator" },
    { key: "permission:inventory:receive", kind: "permission", value: "inventory:receive" },
    { key: "permission:report:read", kind: "permission", value: "report:read" },
    { key: "group:ManagerRole", kind: "group", value: "ManagerRole" },
  ]);
  expect(permissionTags(null)).toEqual([]);
  expect(relativeTime("2025-12-31T23:59:00Z", now, "en-US")).toContain("ago");
  expect(relativeTime("2025-12-31T23:59:00Z", now, "zh-CN")).toContain("\u524d");
  expect(relativeTime(null, now, "en-US")).toBe("");
  const curls = apiKeyCurlExamples("http://localhost:3000/");
  expect(curls.bearer).toContain("Authorization: Bearer qiy_");
  expect(curls.header).toContain("X-API-Key: qiy_");
  expect(curls.bearer).toContain("http://localhost:3000/api/v1/inventory");
});
