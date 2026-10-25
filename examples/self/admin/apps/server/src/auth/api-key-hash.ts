import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** API keys look like qiy_<8 char prefix>_<43 char base64url secret>. */
export const API_KEY_PREFIX = "qiy";
export const API_KEY_PREFIX_LENGTH = 8;
export const API_KEY_MAX_ACTIVE = 10;
export const API_KEY_MAX_NAME = 80;
export const API_KEY_SECRET_LENGTH = 32;
export const API_KEY_LAST_USED_THROTTLE_MS = 60_000;

export interface ParsedApiKey { prefix: string; secret: string }
export interface GeneratedApiKey { key: string; prefix: string; hash: string }

/** The pepper is QIY_AUTH_SECRET; a missing/short secret fails closed. */
export function apiKeyPepper(): string {
  const value = Bun.env.QIY_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("QIY_AUTH_SECRET must be at least 32 characters to hash API keys");
  return value;
}

/** HMAC-SHA256 (peppered SHA-256) of the secret half only; the prefix is not secret. */
export function hashApiKey(secret: string, pepper: string = apiKeyPepper()): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Builds a fresh key: qiy_<8 hex prefix>_<base64url secret>. Only the hash is stored. */
export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(API_KEY_PREFIX_LENGTH / 2).toString("hex");
  const secret = randomBytes(API_KEY_SECRET_LENGTH).toString("base64url");
  return { key: API_KEY_PREFIX + "_" + prefix + "_" + secret, prefix, hash: hashApiKey(secret) };
}

/** Parses a presented key without touching the database. */
export function parseApiKey(value: string): ParsedApiKey | null {
  const match = new RegExp("^" + API_KEY_PREFIX + "_([a-f0-9]{" + API_KEY_PREFIX_LENGTH + "})_([A-Za-z0-9_-]{" + API_KEY_SECRET_LENGTH + ",})$").exec(value);
  return match ? { prefix: match[1]!, secret: match[2]! } : null;
}

/** Constant-time verification of a presented key against a stored hash. */
export function verifyApiKeyHash(presented: string, storedHash: string, pepper: string = apiKeyPepper()): boolean {
  const parsed = parseApiKey(presented);
  if (!parsed) return false;
  return hashesEqual(hashApiKey(parsed.secret, pepper), storedHash);
}

/** Masked display value: qiy_<prefix>_********. The full key is shown once on create. */
export function maskApiKeyPrefix(prefix: string): string {
  return API_KEY_PREFIX + "_" + prefix + "_********";
}

/** First API key source: Authorization: Bearer qiy_... or X-API-Key: qiy_.... */
export function apiKeyFromRequest(request: Request): string | null {
  const header = request.headers.get("x-api-key");
  if (header && header.startsWith(API_KEY_PREFIX + "_")) return header.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match && match[1]!.startsWith(API_KEY_PREFIX + "_")) return match[1]!.trim();
  return null;
}

/** Session bearer tokens must never be treated as API keys. */
export function isApiKeyLike(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX + "_");
}

export function validateApiKeyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("API key name is required");
  if (trimmed.length > API_KEY_MAX_NAME) throw new Error("API key name must be at most " + API_KEY_MAX_NAME + " characters");
  return trimmed;
}

export function validateApiKeyExpiry(value: string | Date | null | undefined, now: Date = new Date()): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("API key expiresAt must be an ISO date-time");
  if (parsed.getTime() <= now.getTime()) throw new Error("API key expiresAt must be in the future");
  return parsed;
}

export function isApiKeyExpired(expiresAt: Date | number | string | null | undefined, now: Date = new Date()): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  const value = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(value) && value <= now.getTime();
}

export function canCreateApiKey(activeCount: number): boolean {
  return activeCount < API_KEY_MAX_ACTIVE;
}

/** Records returned by the list/create/revoke routes never include hash or secret. */
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

export function toApiKeyRecord(row: { id: string; name: string; prefix: string; createdAt: Date | number | string; lastUsedAt: Date | number | string | null; expiresAt: Date | number | string | null; revokedAt: Date | number | string | null }): ApiKeyRecord {
  const iso = (value: Date | number | string | null) => value === null || value === undefined ? null : new Date(value instanceof Date ? value.getTime() : typeof value === "number" ? value : String(value)).toISOString();
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    maskedKey: maskApiKeyPrefix(row.prefix),
    createdAt: iso(row.createdAt)!,
    lastUsedAt: iso(row.lastUsedAt),
    expiresAt: iso(row.expiresAt),
    revokedAt: iso(row.revokedAt),
  };
}
