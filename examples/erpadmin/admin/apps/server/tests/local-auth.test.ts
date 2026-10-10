import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createLocalAuthRoutes } from "../src/auth/local";
import { hashPassword, signAccessToken, verifyAccessToken, verifyPassword } from "../src/auth/password";

const secret = "qiy-local-auth-test-secret-value-32";

test("hashes and verifies local passwords without storing plaintext", async () => {
  const hash = await hashPassword("correct-horse-battery");
  expect(hash).toStartWith("$argon2id$");
  expect(hash).not.toContain("correct-horse-battery");
  expect(await verifyPassword(hash, "correct-horse-battery")).toBe(true);
  expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  expect(await verifyPassword(null, "correct-horse-battery")).toBe(false);
});

test("round-trips a signed local access token and rejects tampering", async () => {
  const token = await signAccessToken({ id: "user-1", role: "admin" }, secret, "qiy-admin");
  expect(await verifyAccessToken(token, secret, "qiy-admin")).toEqual({ id: "user-1", role: "admin" });
  expect(await verifyAccessToken(token, secret + "x", "qiy-admin")).toBeNull();
  expect(await verifyAccessToken(token + "x", secret, "qiy-admin")).toBeNull();
  expect(await verifyAccessToken(token, secret, "other-app")).toBeNull();
});

test("local login route issues a bearer token and rejects invalid credentials", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const passwordHash = await hashPassword("correct-password");
  const user = { id: "user-1", "email": "admin", "passwordHash": passwordHash, "role": "admin" } as unknown as import("../src/auth/local").LocalUser;
  const app = new Elysia().use(createLocalAuthRoutes(async (username) => username === "admin" ? user : null));
  const login = (username: string, password: string) => app.handle(new Request("http://localhost/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }));
  const success = await login("admin", "correct-password");
  expect(success.status).toBe(200);
  const payload = await success.json() as { accessToken: string; role: string };
  expect(payload.role).toBe("admin");
  expect(await verifyAccessToken(payload.accessToken, secret, "qiy-admin")).toEqual({ id: "user-1", role: "admin" });
  expect((await login("admin", "wrong-password")).status).toBe(401);
  expect((await login("missing", "wrong-password")).status).toBe(401);
  expect((await app.handle(new Request("http://localhost/api/v1/auth/password", { method: "POST" }))).status).toBe(404);
});
