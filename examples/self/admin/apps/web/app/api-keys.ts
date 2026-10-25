/** Generated API-key client and pure helpers for the access-key tab. */
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
