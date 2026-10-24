import { readFileSync, writeFileSync } from "node:fs";
const envPath = "examples/self/admin/apps/server/.env.development";
const lines = readFileSync(envPath, "utf8")
  .split(/\r?\n/)
  .filter((line) => !/^QIY_OIDC_OIDC_|^QIY_OIDC_OKTA_/.test(line));
lines.push(
  "QIY_OIDC_OKTA_ISSUER=http://localhost:5556/dex",
  "QIY_OIDC_OKTA_AUDIENCE=qiy-admin",
  "QIY_OIDC_OKTA_JWKS_URL=http://localhost:5556/dex/keys",
  "QIY_OIDC_OKTA_AUTHORIZATION_URL=http://localhost:5556/dex/auth",
  "QIY_OIDC_OKTA_TOKEN_URL=http://localhost:5556/dex/token",
  "QIY_OIDC_OKTA_CLIENT_ID=qiy-admin",
  "QIY_OIDC_OKTA_SCOPE=openid profile email offline_access",
  "QIY_OIDC_OKTA_REDIRECT_URI=http://localhost:5174/auth/callback",
);
writeFileSync(envPath, lines.join("\n") + "\n");
console.log("okta (dex-backed, default subject) provider configured");
