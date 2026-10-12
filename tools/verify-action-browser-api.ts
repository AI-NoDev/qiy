import { strict as assert } from "node:assert";

const base = Bun.argv[2] ?? "http://localhost:3026";
const address = new URL(base);
if (!["localhost", "127.0.0.1"].includes(address.hostname)) throw new Error("Browser fixture acceptance only targets localhost");
const reviewId = "00000000-0000-4000-8000-000000000003";
async function login(role: "admin" | "viewer") {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `${role}@qiy.test`, password: "qiy-browser-test-only" }),
  });
  assert.equal(response.status, 200, `${role} login`);
  const result = await response.json() as { accessToken: string };
  assert.equal(typeof result.accessToken, "string");
  return result.accessToken;
}
async function command(path: string, body: unknown, token?: string, language = "en-US") {
  return fetch(`${base}/api/v1/commands/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": language, "idempotency-key": crypto.randomUUID(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}
const input = { reviewId, reason: "Must not modify locked review" };
const viewer = await login("viewer");
assert.equal((await command("archiveReview", input)).status, 401, "anonymous command");
assert.equal((await command("archiveReview", input, viewer)).status, 403, "viewer command");
assert.equal((await command("archiveReview/batch", { items: [input] }, viewer)).status, 403, "viewer batch");
const admin = await login("admin");
const blocked = await command("archiveReview", input, admin, "zh-CN");
assert.equal(blocked.status, 409, "locked review rule");
assert.equal((await blocked.json() as { errorKey: string }).errorKey, "review.blocked");
const record = await fetch(`${base}/api/v1/reviews/${reviewId}`, { headers: { authorization: `Bearer ${viewer}` } });
assert.equal(record.status, 200);
const persisted = await record.json() as { data?: { status: string; note: string }; status?: string; note?: string };
const review = persisted.data ?? persisted;
assert.equal(review.status, "locked");
assert.equal(review.note, "Locked review");
console.log("Browser fixture API acceptance passed: local login, anonymous 401, viewer single/batch 403, business rejection with translation key, locked row unchanged.");
