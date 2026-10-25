/** Generated API-key client and pure helpers for the access-key page. */
import { qiyAuthToken } from "./auth";

export const QIY_API_KEY_MAX_ACTIVE = 10;
export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}
export interface CreatedApiKey { key: string; record: ApiKeyRecord }
export interface QiyIdentityLike { id?: string; role?: string; permissions?: unknown; groups?: unknown }
export type ApiKeyStatusFilter = "all" | "active" | "revoked" | "expired";
export interface ApiKeyPermissionTag { key: string; kind: "role" | "permission" | "group"; value: string }

function authHeaders(): Record<string, string> {
  const token = qiyAuthToken();
  return { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) };
}

async function apiKeyRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw Object.assign(new Error(body?.error ?? "API key request failed (" + response.status + ")"), { statusCode: response.status });
  return body;
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const body = await apiKeyRequest("/api/v1/auth/api-keys") as { items: ApiKeyRecord[] };
  return body.items;
}

export async function createApiKey(input: { name: string; expiresAt?: string | null }): Promise<CreatedApiKey> {
  return await apiKeyRequest("/api/v1/auth/api-keys", { method: "POST", body: JSON.stringify({ name: input.name, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) }) }) as CreatedApiKey;
}

export async function revokeApiKey(id: string): Promise<void> {
  await apiKeyRequest("/api/v1/auth/api-keys/" + encodeURIComponent(id), { method: "DELETE" });
}

export function maskedApiKey(prefix: string): string {
  return "qiy_" + prefix + "_********";
}

/** Number of keys that are neither revoked nor expired (the server enforces the same rule). */
export function countActiveApiKeys(records: readonly ApiKeyRecord[], now: Date = new Date()): number {
  return records.filter((record) => !record.revokedAt && (!record.expiresAt || new Date(record.expiresAt).getTime() > now.getTime())).length;
}

export function canCreateApiKey(records: readonly ApiKeyRecord[], now: Date = new Date()): boolean {
  return countActiveApiKeys(records, now) < QIY_API_KEY_MAX_ACTIVE;
}

export function defaultApiKeyName(records: readonly ApiKeyRecord[], now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return "Key " + stamp;
}

export function formatApiKeyDate(value: string | null, locale: string): string {
  if (!value) return "\u2014";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale);
}

export type ApiKeyStatus = "active" | "revoked" | "expired";
export function apiKeyStatus(record: Pick<ApiKeyRecord, "revokedAt" | "expiresAt">, now: Date = new Date()): ApiKeyStatus {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

export function apiKeyStatusOptions(): ApiKeyStatusFilter[] {
  return ["all", "active", "revoked", "expired"];
}

/** Case-insensitive search across name, prefix and localized status label. */
export function apiKeyMatches(record: ApiKeyRecord, query: string, now: Date = new Date()): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return [record.name, record.prefix, record.maskedKey, apiKeyStatus(record, now)].some((value) => value.toLowerCase().includes(trimmed));
}

/** Search + status filter used by the access-key page. */
export function filterApiKeys(records: readonly ApiKeyRecord[], input: { search?: string; status?: ApiKeyStatusFilter } = {}, now: Date = new Date()): ApiKeyRecord[] {
  const status = input.status ?? "all";
  const search = input.search ?? "";
  return records.filter((record) => (status === "all" || apiKeyStatus(record, now) === status) && apiKeyMatches(record, search, now));
}

/** Flatten the current identity into role/permission/group tags with hover explanations. */
export function permissionTags(identity: QiyIdentityLike | null | undefined): ApiKeyPermissionTag[] {
  if (!identity) return [];
  const tags: ApiKeyPermissionTag[] = [];
  if (typeof identity.role === "string" && identity.role) tags.push({ key: "role:" + identity.role, kind: "role", value: identity.role });
  const toValues = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : typeof value === "string" ? value.split(/[\s,]+/).filter(Boolean) : [];
  for (const permission of toValues(identity.permissions)) tags.push({ key: "permission:" + permission, kind: "permission", value: permission });
  for (const group of toValues(identity.groups)) tags.push({ key: "group:" + group, kind: "group", value: group });
  return tags;
}

/** Relative time for last-used/created cells (tooltips carry the full timestamp). */
export function relativeTime(value: string | null, now: Date = new Date(), locale = "en-US"): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const deltaSeconds = Math.round((parsed.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(deltaSeconds);
  const unit: Intl.RelativeTimeFormatUnit = absolute < 60 ? "second" : absolute < 3_600 ? "minute" : absolute < 86_400 ? "hour" : absolute < 2_592_000 ? "day" : "month";
  const divisor = unit === "second" ? 1 : unit === "minute" ? 60 : unit === "hour" ? 3_600 : unit === "day" ? 86_400 : 2_592_000;
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(deltaSeconds / divisor), unit);
}

/** Curl snippets shown on the access-key page. */
export function apiKeyCurlExamples(baseUrl = "http://localhost:3000"): { bearer: string; header: string } {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    bearer: "curl -H 'Authorization: Bearer qiy_<prefix>_<secret>' " + base + "/api/v1/inventory",
    header: "curl -H 'X-API-Key: qiy_<prefix>_<secret>' " + base + "/api/v1/inventory",
  };
}
