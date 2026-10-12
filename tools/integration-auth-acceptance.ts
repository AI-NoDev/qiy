export const integrationAuthAcceptance = `import { afterAll, beforeAll, expect, test } from "bun:test";
import { qiyIntegrationAuthProvider, qiyIntegrationFetch } from "./app/host/auth";
import { hostRequest } from "./app/host/data-provider";

const secret = new TextEncoder().encode("qiy-host-acceptance-secret-at-least-32-bytes");
let token = "";
let refreshes = 0;
let apiRequests = 0;
let server: ReturnType<typeof Bun.serve>;
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

async function issue(role: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ sub: "host-admin-1", role, iss: "qiy-host", aud: "qiy-admin", exp: Math.floor(Date.now() / 1000) + 300 });
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return signingInput + "." + Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput))).toString("base64url");
}

async function verify(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, Buffer.from(parts[2]!, "base64url"), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!valid) throw new Error("Invalid JWT signature");
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as { sub?: string; role?: string; iss?: string; aud?: string; exp?: number };
  if (payload.iss !== "qiy-host" || payload.aud !== "qiy-admin" || !payload.exp || payload.exp <= Date.now() / 1000) throw new Error("Invalid JWT claims");
  return payload;
}

beforeAll(async () => {
  token = await issue("viewer");
  server = Bun.serve({ port: 0, async fetch(request) {
    apiRequests++;
    if (new URL(request.url).pathname !== "/api/v2/products") return Response.json({ error: "Wrong API path" }, { status: 404 });
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return Response.json({ error: "Missing bearer" }, { status: 401 });
    try {
      const payload = await verify(authorization.slice(7));
      if (payload.role !== "admin" || payload.sub !== "host-admin-1") return Response.json({ error: "Admin allowlist denied" }, { status: 403 });
      return Response.json({ data: [{ id: "product-1", title: "Host product" }], total: 1 });
    } catch { return Response.json({ error: "Invalid bearer" }, { status: 401 }); }
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { origin: server.url.origin },
    qiyHostAuth: {
      getAccessToken: async () => token,
      check: async () => true,
      getIdentity: async () => ({ id: "host-admin-1", name: "Host Admin" }),
      onError: async (error: unknown) => {
        if ((error as { statusCode?: number }).statusCode === 401 || (error as { statusCode?: number }).statusCode === 403) {
          refreshes++;
          token = await issue("admin");
          return { logout: false };
        }
        return {};
      },
    },
  } });
});

afterAll(() => {
  server.stop(true);
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
});

test("host owns JWT refresh while Qiy never replays the rejected request", async () => {
  let failure: unknown;
  try { await hostRequest("products"); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ statusCode: 403, message: "Admin allowlist denied" });
  expect(apiRequests).toBe(1);
  expect(await qiyIntegrationAuthProvider.onError(failure)).toEqual({ logout: false });
  expect(refreshes).toBe(1);
  expect(apiRequests).toBe(1);
  const page = await hostRequest("products") as { data: Array<{ id: string }>; total: number };
  expect(page).toEqual({ data: [{ id: "product-1", title: "Host product" }], total: 1 });
  expect(apiRequests).toBe(2);
  expect((await qiyIntegrationAuthProvider.check()).authenticated).toBe(true);
  expect(await qiyIntegrationAuthProvider.getIdentity?.()).toEqual({ id: "host-admin-1", name: "Host Admin" });
});

test("the helper sends the host token only to the configured API boundary", async () => {
  const before = apiRequests;
  expect((await qiyIntegrationFetch("products")).status).toBe(200);
  expect(apiRequests).toBe(before + 1);
  await expect(qiyIntegrationFetch("https://outside.example/api/v2/products")).rejects.toThrow("outside");
  expect(apiRequests).toBe(before + 1);
});
`;
