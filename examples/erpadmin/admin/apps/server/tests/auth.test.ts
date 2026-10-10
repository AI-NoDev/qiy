import { expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createOidcAuthenticator } from "../src/auth/verify";

test("verifies issuer, audience and rotating JWKS keys before resolving subject", async () => {
  const first = await generateKeyPair("RS256");
  const second = await generateKeyPair("RS256");
  const firstJwk = { ...await exportJWK(first.publicKey), kid: "first", alg: "RS256" };
  const secondJwk = { ...await exportJWK(second.publicKey), kid: "second", alg: "RS256" };
  const seen: string[] = [];
  const authenticate = createOidcAuthenticator({ issuer: "https://id.example.test", audience: "qiy-admin", keySet: createLocalJWKSet({ keys: [firstJwk, secondJwk] }), roleField: "role", findUser: async (subject) => { seen.push(subject); return subject === "https://id.example.test|user-1" ? { id: "user-1", role: "operator", displayName: "Operator" } : null; } });
  const token = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "second" }).setIssuer("https://id.example.test").setAudience("qiy-admin").setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(second.privateKey);
  const request = (value: string) => new Request("http://localhost/api/v1/orders", { headers: { Authorization: "Bearer " + value } });
  expect(await authenticate(request(token))).toEqual({ id: "user-1", name: "Operator", role: "operator" });
  expect(seen).toEqual(["https://id.example.test|user-1"]);
  expect(await authenticate(new Request("http://localhost/api/v1/orders"))).toBeNull();
  const wrongAudience = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "first" }).setIssuer("https://id.example.test").setAudience("other-app").setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(first.privateKey);
  await expect(authenticate(request(wrongAudience))).rejects.toThrow();
  const wrongIssuer = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "first" }).setIssuer("https://other.example.test").setAudience("qiy-admin").setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(first.privateKey);
  await expect(authenticate(request(wrongIssuer))).rejects.toThrow();
  expect(seen).toEqual(["https://id.example.test|user-1"]);
});
