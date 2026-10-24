import { expect, test } from "bun:test";
import { SignJWT } from "jose";
import { createOnboardingToken, readOnboardingToken } from "../src/auth/oidc";

const secret = "qiy-hybrid-auth-test-secret-value-at-least-32";

test("signs and verifies a short-lived provider onboarding token", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const token = await createOnboardingToken({ provider: "okta", subject: "subject-1", username: "new@example.test", email: "new@example.test", name: "New User" });
  const claims = await readOnboardingToken(token);
  expect(claims.provider).toBe("okta");
  expect(claims.subject).toBe("subject-1");
  expect(claims.email).toBe("new@example.test");
});

test("rejects a tampered, expired or foreign onboarding token", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const token = await createOnboardingToken({ provider: "okta", subject: "subject-1" });
  await expect(readOnboardingToken(token + "x")).rejects.toThrow();
  const foreign = await new SignJWT({ typ: "qiy-onboarding", provider: "okta", identitySubject: "subject-1" }).setProtectedHeader({ alg: "HS256" }).setIssuer("qiy-admin").setAudience("qiy-admin").setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode("a-different-secret-that-is-long-enough-32"));
  await expect(readOnboardingToken(foreign)).rejects.toThrow();
  const expired = await new SignJWT({ typ: "qiy-onboarding", provider: "okta", identitySubject: "subject-1" }).setProtectedHeader({ alg: "HS256" }).setIssuer("qiy-admin").setAudience("qiy-admin").setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 1800).sign(new TextEncoder().encode(secret));
  await expect(readOnboardingToken(expired)).rejects.toThrow();
});
