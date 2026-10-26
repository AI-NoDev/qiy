# Authentication, permissions and policy

Use this file when you add login, identity providers, roles, atomic permissions, data scope, row/field policy, page guards or command authorization - and when you must state what the generated security model does *not* protect.

Canonical reference: https://ai-nodev.github.io/qiy/dsl/permissions (`/dsl/auth` for providers and sessions)

## Contents

- [Choose an auth mode](#choose-an-auth-mode)
- [auth block grammar](#auth-block-grammar)
- [User model contract](#user-model-contract)
- [Sessions, tokens and password policy](#sessions-tokens-and-password-policy)
- [OTP login](#otp-login)
- [Multi-provider and hybrid login](#multi-provider-and-hybrid-login)
- [Provider settings and environment variables](#provider-settings-and-environment-variables)
- [Permission declarations](#permission-declarations)
- [Effective permissions and endpoints](#effective-permissions-and-endpoints)
- [Command authorization (allow)](#command-authorization-allow)
- [Row and field policy (restrict)](#row-and-field-policy-restrict)
- [Data scope (scope)](#data-scope-scope)
- [Page rules (pages)](#page-rules-pages)
- [Declaration to artifact map](#declaration-to-artifact-map)
- [Security boundaries and limits](#security-boundaries-and-limits)
- [Pitfalls](#pitfalls)

## Choose an auth mode

| Mode | Declaration | Generated result |
| --- | --- | --- |
| Local password | `provider local;` | Argon2id verify + HS256 session JWT + `/auth/login` + Refine `AuthPage` |
| Single OAuth/OIDC/SSO | `provider oidc;` (also `oauth2`, `sso`, `okta`, `auth0`, `azure-ad-b2c`, `keycloak`, `google`, `kinde`) | Browser PKCE + server JWKS verification; one `QIY_OIDC_ISSUER/AUDIENCE/JWKS_URL` block |
| Multiple providers | `providers okta, keycloak, google;` | Login buttons from `GET /api/v1/auth/providers`; one `QIY_OIDC_<ID>_*` block per provider |
| Hybrid (password + OAuth) | `providers local, okta, google;` plus username/password fields | One login page with password form + provider buttons; first-login onboarding, bind/unbind, profile page |
| One-time password | `provider otp;` | `/auth/otp/request` + `/auth/otp/verify`, 5-minute signed challenge, 12-hour session |
| Host integration | `mode integration` | No Qiy server, no Qiy auth; host adapter supplies identity ([workspace-integration.md](workspace-integration.md)) |

Derived modes: a model has local login when `provider local` or `providers` contains `local`; also has hybrid when local login **and** at least one OAuth provider. A provider selector page appears for hybrid or >= 2 OAuth providers.

An application without `auth` generates no guard and **refuses to start in production** unless `QIY_DEV_MODE=1`.

## auth block grammar

```text
auth {
  ( "provider" <id> [ "{" ( "subjectField" <field> ";" | "claim" <name> ";" )* "}" | ";" ] )
| "providers" <id> ( "," <id> )* ";"
| "user" <entity> ";"
| "subjectField" <field> ";"
| "roleField" <field> ";"
| "usernameField" <field> ";"
| "passwordField" <field> ";"
| "profileField" <field> ";"
}
```

```qiy
auth {
  providers local, okta, google;
  user users;
  subjectField subject;          // canonical external identity column
  roleField role;                // required: enum with exactly admin/operator/viewer
  usernameField email;           // local / otp login identifier
  passwordField passwordHash;    // local password hash
  profileField oauthProfiles;    // optional: per-provider profile JSON
  provider okta { subjectField oktaSubject; }
  provider google { subjectField googleSubject; claim sub; }
}
```

`provider <id> { ... }` is a **mapping block**, not a second login mode. It must name an already-configured provider. `provider` and `providers` are mutually exclusive.

| Attribute | Required | Default | Rule |
| --- | --- | --- | --- |
| `provider` | one of two | - | Single provider: `local`, `otp`, `oidc`, `oauth2`, `sso`, `okta`, `auth0`, `azure-ad-b2c`, `keycloak`, `google`, `kinde` |
| `providers` | one of two | - | Comma list; unique; cannot contain `otp`; may contain `local` |
| `user` | yes | - | Declared user entity (`Auth: unknown user entity X`) |
| `subjectField` | required for OAuth family | empty | Required + unique + Text column |
| `roleField` | yes | - | Enum whose values are **exactly** `admin`, `operator`, `viewer` |
| `usernameField` | required for `local`/`otp` | empty | Required + unique + Text; must differ from `passwordField` |
| `passwordField` | required for `local` | empty | Nullable Text; never appears in the API schema |
| `profileField` | no | empty | Nullable Text JSON; only with at least one OAuth provider |
| mapping `subjectField` | required in hybrid | - | Existing nullable + unique Text column |
| mapping `claim` | no | `sub` | Plain claim name `[A-Za-z_][A-Za-z0-9_]*`; quotes are rejected |

## User model contract

```qiy
enum userRole {
  value admin;
  value operator;
  value viewer;
}

entity users table users @label("Users") {
  field id UUID @id;
  field email Text @unique;                       // usernameField
  field displayName Text @nullable;
  field passwordHash Text @nullable;              // passwordField
  field role userRole;                            // roleField
  field subject Text @unique;                     // canonical subjectField
  field oktaSubject Text @unique @nullable;       // per-provider mapping column
  field orgId UUID @nullable;                     // enables scope claim org.id for local/API-key sessions
  field oauthProfiles Text @nullable;             // profileField
  field permissions Text @nullable;               // permission from database field
}
```

| Field role | Requirement | Error (excerpt) |
| --- | --- | --- |
| `usernameField` | required, unique, Text | `Auth: usernameField must be a required unique Text field` |
| `passwordField` | nullable Text | `Auth: passwordField must be a nullable Text field storing the password hash` |
| distinct columns | - | `Auth: usernameField and passwordField must be different fields` |
| `subjectField` | required, unique, Text (with OAuth) | `Auth: subjectField must be a required unique Text field` |
| `roleField` | enum exactly admin/operator/viewer | `Auth: roleField must be an enum with admin, operator and viewer values` |
| per-provider column | exists, Text, nullable, unique | `Auth: provider okta subjectField oktaSubject must be nullable ...` |
| `profileField` | nullable Text | `Auth: profileField must be a nullable Text field storing per-provider profile metadata` |
| onboarding | every other required column must be nullable | `Auth: OAuth onboarding cannot populate required user fields: ...; make them nullable` |
| scope claim column (local/hybrid) | users needs a matching column (`org.id` -> `orgId`) | `Data scope claim org.id needs a matching field on users (expected orgId) ...` |

Identity write rules (not configurable):

| Mode | Column | Value |
| --- | --- | --- |
| Single provider, no mapping | `subjectField` | `<iss>|<sub>` |
| Mapping with `claim` | mapped subject field | that claim's string value |
| Mapping without `claim` | mapped subject field | `sub` |
| Hybrid onboarding | mapped column **and** canonical `subjectField` | mapped column `sub`; canonical `<provider>:<subject>` |
| Local password bootstrap (hybrid) | canonical `subjectField` | `local:<username>` |

## Sessions, tokens and password policy

| Token | Issued by | Algorithm | Lifetime | Payload/use |
| --- | --- | --- | --- | --- |
| Local password session | `POST /auth/login` | HS256 (`QIY_AUTH_SECRET`) | **12 hours** | `iss=aud=qiy-admin`, `sub=<user id>`, `role`, `typ=qiy-local` |
| OTP session | `POST /auth/otp/verify` | HS256 | 12 hours | same `sub`/`role`, `typ=qiy-otp` |
| OTP challenge | `POST /auth/otp/request` | HS256 | **5 minutes** | `typ=qiy-otp-challenge`, `identifier`, `otpHash`, `valid`, `sub` |
| Onboarding token | `POST /auth/exchange` (hybrid) | HS256 | **10 minutes** | `typ=qiy-onboarding`, `provider`, `identitySubject`, optional username/email/name |
| Provider access token | IdP | RS256/ES256 | IdP policy | Server routes by unverified `iss` to that provider's JWKS, then verifies |
| API key | `POST /api/v1/auth/api-keys` | HMAC-SHA256 stored | optional expiry | See [system-features.md](system-features.md) |

- The Web stores the access token in `localStorage["qiy.access_token"]`; multi-provider also stores `id_token`/`expires_at`; `/auth/me` identity is cached 60 seconds and invalidated by token changes.
- Single-provider OIDC uses `qiy.expires_at` (60 seconds early) and one silent `prompt=none` renewal. **No refresh token**: 401 clears the session and redirects to login.
- The server signs/verifies session tokens; the browser only holds strings. `role` is inside the token but **every request re-reads the user row** (`findUserById`), so a demotion applies on the next request.
- Provider `iss` must exactly match a configured provider issuer (trailing `/` stripped); audience or client id may match; algorithms limited to RS256/ES256.
- Claims are flattened into `Principal.claims` (`org.id`, `realm_access.roles`), used by `scope`, `permission from claim` and `restrict mask claim`. `iss/aud/exp/iat/nbf/jti/sub` are excluded.
- Password hashing: `Bun.password.hash(..., { algorithm: "argon2id" })`; **minimum 8 characters**, no complexity rules. Unknown accounts still run one dummy Argon2id verify before 401.
- Login response `{ accessToken, tokenType: "Bearer", expiresIn: 43200, id, name, role }`; failures are a uniform 401 `Invalid username or password`.
- No self-service password change is generated. Operate accounts with `bun run auth:bootstrap-admin` (initial admin, refuses if an admin exists) and `bun run auth:set-password` (unique row by username/email).
- The login page has no register, forgot-password or remember-me links. Accounts are created by bootstrap, an administrator, or hybrid onboarding.

## OTP login

```qiy
auth { provider otp; user users; usernameField email; roleField role; }
```

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /api/v1/auth/otp/request` | `{ identifier }` (1..190 chars) | `{ challengeToken, expiresIn: 300, devCode? }` |
| `POST /api/v1/auth/otp/verify` | `{ identifier, challengeToken, code }` (code 4..12) | `{ accessToken, tokenType, expiresIn: 43200, id, name, role }` |

- Codes are 6 digits; the challenge is an HMAC-SHA256(`identifier\ncode`) signed token, so it needs no process memory and scales horizontally.
- Delivery adapter: `POST QIY_OTP_DELIVERY_URL` with `{ recipient, code, expiresIn: 300 }`; adds `Authorization: Bearer` when `QIY_OTP_DELIVERY_TOKEN` is set; must be HTTPS and return 2xx.
- Delivery failure -> **502** `{ errorKey: "auth.otpDeliveryFailed" }` and **no** challenge is issued. Dev mode adds adapter detail; production returns generic text. Codes are never logged.
- `QIY_OTP_DELIVERY_TIMEOUT_MS` default 10000 (100..60000).
- Unknown identifiers get the same 200 + challenge with `valid:false`; verify then 401 (no account enumeration).
- `QIY_DEV_MODE=1` + `QIY_OTP_DEV_CODE` uses the fixed code and echoes `devCode`; never allowed in production.
- Limits: no per-identifier/IP rate limit; a challenge can be reused within its 5-minute window (no one-time consumption record). Add rate limiting and persistence in the delivery adapter or gateway if needed.

## Multi-provider and hybrid login

| Endpoint | local | single provider | multi provider | hybrid | otp |
| --- | --- | --- | --- | --- | --- |
| `POST /auth/login` | yes | - | - | yes | - |
| `GET /auth/providers` | - | - | `{ providers }` | `{ providers, local: true }` | - |
| `POST /auth/exchange` | - | - | raw `{ access_token, id_token?, expires_in? }` | session or `{ needsOnboarding }` | - |
| `POST /auth/oauth/register` | - | - | - | yes | - |
| `POST /auth/bind` / `POST /auth/unbind` | - | - | - | yes | - |
| `GET /auth/identities` | yes | - | - | yes | - |
| `POST /auth/otp/request` / `verify` | - | - | - | - | yes |
| `GET /auth/me` | yes | yes | yes | yes | yes |

Hybrid first-login onboarding:

1. Provider button -> PKCE authorize -> callback sends `code` + `code_verifier` to `POST /auth/exchange`.
2. If the provider identity column already maps to a user, a 12-hour session is issued.
3. Otherwise `{ needsOnboarding: true, onboardingToken, provider, profile }`; the Web opens `/auth/onboarding`.
4. `POST /auth/oauth/register { onboardingToken, username, email?, password }`. Only the token's `provider`/`subject` are trusted; username/email duplicates return 409; the password uses the same Argon2id + 8-character rule; the role comes from `QIY_OIDC_DEFAULT_ROLE` (default `viewer`, invalid values fail at startup); it writes `displayName`, the provider profile metadata, the mapped identity column and canonical `subjectField = <provider>:<subject>`.
5. The onboarding token is valid for 10 minutes; expired/tampered/wrong-issuer tokens return 401 and require a new provider login.

Profile page (`/profile`, hybrid only) reads `GET /api/v1/auth/identities`:

```json
{
  "user": { "id": "...", "username": "ops@example.com", "email": "ops@example.com", "name": "Ops", "role": "operator" },
  "password": { "set": true },
  "providers": [
    { "id": "okta", "label": "Okta", "bound": true, "subject": "00u...", "email": "ops@example.com", "name": "Ops" },
    { "id": "google", "label": "Google", "bound": false }
  ],
  "loginMethodCount": 2
}
```

| Operation | Endpoint | Rule |
| --- | --- | --- |
| Bind | `POST /auth/bind` with `{ provider, code, codeVerifier, redirectUri }` or `{ onboardingToken }` | Requires a session; identity owned by another account -> 409; writes the mapped column + profile |
| Unbind | `POST /auth/unbind` with `{ provider }` | Requires a session; removing the **last** login method -> 409 `Cannot remove the last login method...` |
| Bind button | `beginProviderBind` on `/profile` | Same PKCE flow; callback carries `?linked=<provider>` |

Non-hybrid multi-provider mode **does not create accounts**. A valid IdP identity with no user row logs in but has no principal data (403). Create rows and fill provider columns first; `auth:bootstrap-admin` only creates a local account.

## Provider settings and environment variables

`QIY_OIDC_<PROVIDER>_*` uses the provider name uppercased with non-alphanumerics replaced by `_`: `okta` -> `OKTA`, `azure-ad-b2c` -> `AZURE_AD_B2C`.

| Provider id | Issuer shape | Audience | JWKS | Identity claim |
| --- | --- | --- | --- | --- |
| `okta` | `https://<domain>/oauth2/default` | `api://default` or custom AS audience | `/oauth2/default/v1/keys` | `sub` |
| `keycloak` | `https://<host>/realms/<realm>` | `account` or client id | `/realms/<realm>/protocol/openid-connect/certs` | `sub` (roles usually in `realm_access.roles`) |
| `google` | `https://accounts.google.com` | OAuth client id | `https://www.googleapis.com/oauth2/v3/certs` | `sub` (no built-in groups) |
| `kinde` | `https://<subdomain>.kinde.com` | client id | `/.well-known/jwks.json` | `sub` |
| `azure-ad-b2c` | `https://<tenant>.b2clogin.com/<tenantId>/<policy>/v2.0/` | app client id | `<policy>/discovery/v2.0/keys` | `sub` (custom policies often add `roles`) |
| `auth0` | `https://<tenant>.<region>.auth0.com/` | API identifier | `/.well-known/jwks.json` | `sub` |
| `oidc`/`oauth2`/`sso` | your issuer | your audience | your JWKS | `sub` |
| Dex (via `keycloak`/`oidc`) | `https://<host>/dex` | `qiy-admin` or your client | `/dex/keys` | `sub` (no `roles`/`groups` by default) |

These are configuration starting points, not acceptance claims: verify each real tenant (issuer, audience, JWKS, claims, logout, third-party cookie behavior) in its own environment. `tools/verify-*.ts` scripts prove protocol shape, not your tenant.

Server variables:

| Variable | Default | Required when | Notes |
| --- | --- | --- | --- |
| `QIY_AUTH_SECRET` | random in dev, empty in prod | local / hybrid / OTP / API keys | **>= 32 chars** or startup throws; signs sessions, OTP challenges, onboarding tokens and peppers API keys. Rotation invalidates all of them |
| `QIY_OIDC_ISSUER` / `_AUDIENCE` / `_JWKS_URL` | empty | single OAuth provider | issuer/JWKS must be HTTPS |
| `QIY_OIDC_<ID>_ISSUER` / `_AUDIENCE` / `_JWKS_URL` | empty | hybrid / multi | all three required or the provider is skipped; issuer must match token `iss` exactly |
| `QIY_OIDC_<ID>_AUTHORIZATION_URL` / `_TOKEN_URL` / `_CLIENT_ID` | empty | hybrid / multi | public login-page fields; a missing one hides the provider from `/auth/providers` |
| `QIY_OIDC_<ID>_SCOPE` | `openid profile email` | hybrid / multi | authorization scope |
| `QIY_OIDC_<ID>_REDIRECT_URI` | global `QIY_OIDC_REDIRECT_URI` | hybrid / multi | must match the IdP registration |
| `QIY_OIDC_<ID>_CLIENT_SECRET` | empty | confidential clients | server only; never a `VITE_` value |
| `QIY_OIDC_<ID>_LOGOUT_URL` | empty | optional | browser logout redirect |
| `QIY_OIDC_JWKS_TIMEOUT_MS` | `5000` | OAuth | single JWKS request timeout, min 1 |
| `QIY_OIDC_JWKS_COOLDOWN_MS` | `30000` | OAuth | minimum interval before refetching on an unknown `kid` |
| `QIY_OIDC_JWKS_CACHE_MAX_AGE_MS` | `600000` | OAuth | key cache age; also the worst-case revocation delay |
| `QIY_OIDC_DEFAULT_ROLE` | `viewer` | hybrid | onboarding role; must be admin/operator/viewer |
| `QIY_OTP_DELIVERY_URL` / `_TOKEN` / `_TIMEOUT_MS` | empty / empty / `10000` | otp | HTTPS adapter, optional bearer, 100..60000 ms |
| `QIY_OTP_DEV_CODE` | `246810` in dev | otp dev | fixed code + `devCode` echo; only with `QIY_DEV_MODE=1` |
| `QIY_DEV_MODE` | `1` without auth, else `0` | - | startup gate for no-auth apps, OTP dev code, error detail |

Web variables are generated **only for single-provider OIDC**: `VITE_QIY_AUTHORIZATION_URL`, `VITE_QIY_TOKEN_URL`, `VITE_QIY_CLIENT_ID`, `VITE_QIY_AUTH_SCOPE`, `VITE_QIY_REDIRECT_URI`, `VITE_QIY_LOGOUT_URL`, `VITE_QIY_API_TRANSPORT`. Multi/hybrid modes read public config from `/auth/providers` and never send a client secret to the browser.

## Permission declarations

`permission` declarations must be **contiguous immediately after `messages`**, before `workflow`/`enum`/`entity`. Any non-empty permission model requires a generated `auth` block, and at least one `permission field`.

```qiy
permission field    <Name> "<value>" [@label(...)] [@comment(...)] ;
permission group    <Name> [@label(...)] [@comment(...)] { A, B, ... } [;]
permission group    <Name> [@label(...)] [@comment(...)] = A & B & ... ;
permission from database field <entity>.<field> ;
permission from claim <provider> "<claim>" ;
permission verification <Name> [@label(...)] [@comment(...)] {
  input { field <name> Text|Array<String>; ... }
  return <expression> ;
}
```

| Form | Rules |
| --- | --- |
| `field` | Value non-empty, no whitespace, globally unique, case-sensitive. Convention `<domain>:<action>` (`inventory:receive`). This string is the contract shared with claims, DB columns, OpenAPI `x-qiy-permissions` and 403 `missing` |
| `group` (list) | Members are permission fields or other groups; trailing comma allowed; trailing `;` optional |
| `group` (`= A & B`) | **`&` is union**, not intersection. No intersection operator exists. Must end with `;` |
| `from database field` | At most one per model; column must be a `Text` field on the auth user entity |
| `from claim` | Provider must be a configured OAuth/OIDC provider; `local`/`otp` are rejected; duplicate provider+claim rejected; multiple entries allowed |
| `verification` | Must have `return`; `input` optional; input types are only `Text` and `Array<String>` |

Group semantics: unknown member (`unknown member`), empty group, duplicate member, self reference and cycles are rejected. A group named `admin`/`operator`/`viewer` becomes a **role group**: a principal with that role receives all expanded values. Groups expand recursively into a sorted, de-duplicated set.

Database column content contract:

```text
["inventory:receive","manager"]   # JSON string array (recommended)
inventory:receive,manager         # comma/space separated text (compatible)
```

- Non-string array elements are dropped; text starting with `[` that fails JSON parsing makes the whole source empty (fail-closed).
- Each entry is matched against declared permission values first, then expanded as a group name; unknown entries are ignored.
- A failed database read never 500s `/auth/me`: that source is ignored and role groups/claims still apply.

Claim sources: `^[A-Za-z_][A-Za-z0-9_.-]*` (dots allowed for flattened keys such as `realm.roles`). At runtime only the **claim name** is read, regardless of which configured provider supplied it; the provider in the declaration is a configuration constraint, not runtime isolation. Values are normalized like the DB column: string arrays keep strings and dedupe; a string is split on commas/whitespace; numbers/booleans/null/objects yield nothing. The IdP must actually issue the claim (Google needs a custom `groups` mapping; Dex issues no roles/groups by default).

Verification expression grammar:

```text
expression  := orExpr
orExpr      := andExpr ( "||" andExpr )*
andExpr     := unary ( "&&" unary )*
unary       := "!" unary | "(" orExpr ")" | comparison
comparison  := operand op operand
operand     := "self" "." ( "permissions" | "groups" | "role" )
             | "input" "." <name>
             | <quoted string>
op          := [ "not" ] ( "some" | "all" ) ( "included" "in" | "in" )
             | "="
             | "!="
```

Precedence: `!` > `( )` > `&&` > `||`. Operands normalize to string sets; comparisons are order-independent.

| Operator | Alias | Semantics | `missing` diagnostic |
| --- | --- | --- | --- |
| `all included in` | `all in` | left subset of right | left elements not in right |
| `some included in` | `some in` | intersection non-empty | left elements |
| `not all included in` | `not all in` | not a subset | none |
| `not some included in` | `not some in` | disjoint | intersection elements |
| `=` | - | set equality | symmetric difference |
| `!=` | - | set inequality | none |

`missing` is explanatory only; `allowed` is authoritative. `self.role` cannot be used in a membership comparison against another role set (`role membership comparison requires a non-role set`) - compare it with `=`/`!=` and a literal. `input` fields are required once declared (a missing one is 400); undeclared fields are ignored; `self` is reserved.

Where verification is evaluated: `POST /api/v1/auth/verify-permission` (any authenticated principal may self-check; it cannot check another user), `dataflow ... allow verification Name` (inputs must have same-named `@required` Text/enum flow inputs), `action ... allow verification Name` (navigate only, no inputs, visibility only), and the Web `CanAccess` for input-free verifications.

## Effective permissions and endpoints

Effective permissions are the union of three sources, **additive only**:

| Source | Declaration | Runtime read |
| --- | --- | --- |
| Role group | none needed | `principal.role`; a group named after the role applies automatically |
| Database column | `permission from database field users.permissions;` | the user row's Text column |
| OAuth claim | `permission from claim okta "roles";` | verified id_token claims (local/OTP sessions have none) |

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/auth/permissions
# { "permissions": ["inventory:receive","report:read"], "groups": ["admin","operator"] }

curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"verification":"CanAccessUserApi","input":{"permission":["api:getUser"]}}' \
  http://localhost:3000/api/v1/auth/verify-permission
# { "allowed": false, "missing": ["api:putUser"] }
```

| Endpoint | Auth | Behavior |
| --- | --- | --- |
| `GET /api/v1/auth/permissions` | session or API key | `{ permissions, groups }`, sorted and unique |
| `POST /api/v1/auth/verify-permission` | same | `{ verification, input? }` -> `{ allowed }` or `{ allowed: false, missing }`; unknown verification/missing input/type error 400; unauthenticated 401 |
| `GET /api/v1/auth/me` | same | `{ ...principal, permissions, groups }`; OIDC principals also carry `claims` |

API keys are equal to a session for permissions but have **no id_token claims**: their `claims` contain only scope-derived keys read from user columns (`org.id` <- `orgId`). Therefore `permission from claim` never applies to API keys, and a `verification` that reads a claim set evaluates as empty (fail-closed).

## Command authorization (allow)

Authorization is written on the **dataflow**; a dataflow-bound action inherits it. Two forms are mutually exclusive per command.

```qiy
dataflow receiveInventory @label("Receive") {
  allow permission InventoryReceivePermission;
  ...
}

dataflow shipSalesOrder @label("Ship") {
  allow verification CanShipOrders;
  ...
}

dataflow reserveStock @label("Reserve") {
  allow roles admin, operator;   # legacy form
  ...
}
```

| Rule | dataflow | action (`navigate`) | action (bound dataflow) |
| --- | --- | --- | --- |
| `allow roles` | only `admin`/`operator`, non-empty, no duplicates | non-empty subset of admin/operator/viewer | forbidden (declare it on the dataflow) |
| `allow permission` | one or more permission fields/groups, expanded to values at generation | allowed; controls button/page visibility | forbidden |
| `allow verification` | verification may have inputs; each needs a same-named `@required` Text/enum flow input | verification must have **no** input (`requires inputs and cannot guard a navigate action`) | forbidden |
| Default | `admin, operator` | resource default | inherited from the dataflow |

Runtime (inside the command route, before the transaction):

- Unauthenticated -> 401. Role not allowed -> 403 `{ error: "Command execution is restricted" }`.
- Missing permission -> 403 `{ error: "Missing required permissions: ...", errorKey: "command.forbidden", missing }`.
- Failed verification -> 403 `{ errorKey: "command.forbidden" }` with optional `missing`; unknown verification -> 403; bad input shape -> 400.
- **admin does not bypass an explicit allowlist**: `allow roles operator;` rejects admin too.
- `/api/v1/commands` is exempt from the generic role guard (authentication only); the command route enforces authorization, so a non-admin/operator principal holding the permission can run the command.
- Checks happen before idempotency receipt lookup and the transaction; a denial writes no business data, audit or receipt. Replay re-checks; an existing receipt does not grant access.
- The Web records `commandPolicies` (roles, expanded permissions, input-free verification) and prefers permission/verification checks when `/auth/me` carries permission metadata; a verification with inputs falls back to the role list in the browser while the server still enforces.

## Row and field policy (restrict)

```text
restrict <resource> {
  allow roles <role> [, <role>]* ;                      // at most once
  when <field> claim <claim> ;                          // row predicate: field == claim
  when <field> ==|!= "<v>" [, "<v>"] ;                  // literals (==/!= take exactly one value)
  when <field> in|notIn "<v>" [, "<v>"] ;               // sets, max 64
  when ( <condition> or <condition> ) ;                 // disjunction group
  when <boolean-expression> ;                           // not / and / or / parentheses
  mask <field> [roles <r>, ...] [claim <present|absent> <claim>] mode <omit|null|redact> [replacement "<text>"] ;
}
```

```qiy
restrict orders {
  allow roles admin, operator;
  when tenantId claim tenant.id;
  when status in "draft", "pending";
  when ( ownerId claim user.id or scope );
  when amount > field cost;
  mask unitCost roles operator, viewer mode redact replacement "***";
  mask internalNote claim absent compliance.level mode omit;
}
```

| Setting | Values | Default | Semantics |
| --- | --- | --- | --- |
| `allow roles` | admin/operator/viewer, non-empty, unique | unrestricted | Whether the resource is usable at all; admin is **not** exempt |
| `when <field> claim <claim>` | non-null, non-PK field; claim may contain dots | - | Row predicate, `==`; missing claim -> 403 |
| `when <field> == / != "<v>"` | one value | - | Literal row predicate; types Text/enum/Integer/Decimal/Money/Date/Time/DateTime |
| `when <field> in / notIn "<v1>", ...` | <= 64 unique values | - | Set predicate (`hide` semantics) |
| `when <a> <op> field <b>` | `<`, `<=`, `>`, `>=`, `==`, `!=`; comparable classes must match | - | Cross-field comparison; UUID only `==`/`!=` |
| `when scope` | requires a matching `scope` on the same resource | - | Scope atom, can be OR-ed |
| `when ... and/or/not/(...)` | general boolean expression | - | ANDed onto rows/groups |
| `mask <field>` | non-PK, non-`Vector` field; optional roles and claim presence | `mode omit` | Field masking, see below |

Runtime (`security/policy.ts`):

| Case | Result |
| --- | --- |
| Role not in `allow roles` | 403 `policy.resourceDenied` |
| Claim row predicate with missing claim | 403 `policy.missingClaim` |
| Literal row predicate | Generates an always-false predicate (`__qiy_policy_never_matches__`); rows are hidden, no error |
| All disjunction branches dropped for missing claims | 403 `policy.missingClaim` (fail-closed, never "all rows") |
| Expression cannot be evaluated (e.g. `scope` without value) | 403 `policy.missingClaim` |
| `not (branch with missing claim)` | Unsatisfiable, never "allow everything" |
| Writing a masked field | 400 `policy.maskedField` (masking is read **and** write) |
| Import containing a masked column | 400 `Masked fields cannot be imported: ...` (`import.maskedField`) |
| Aggregating a masked field | 403 `policy.maskedField` |
| Reading | `mask(record)` applies per role/claim: `omit` deletes the key, `null` sets null, `redact` substitutes the fixed string |

Row predicates push down to SQL for list/detail/aggregate/trend/export/update/delete - never client-side filtering. Rows AND together; each group ORs internally and ANDs with rows; expressions AND on top. `mask` is the only mechanism that truly hides data; `pages` field rules only stop rendering.

Hard mutual exclusions (generation fails closed):

- A resource with **any** `restrict` block cannot appear in a `dataflow` (context load or create target): `Restrict <resource>: dataflow <name> cannot use a restricted resource until command authorization applies the same row policy`. This applies even if the block only has `allow roles` or `mask`.
- Realtime cannot subscribe to a resource with a `restrict` row predicate (`when`): `restrict row predicates cannot be enforced on a shared channel`. Role/mask-only restrictions may coexist; `mask` trims the payload before enqueue.

## Data scope (scope)

```text
scope <resource> <field> claim <claim> [ tree <treeEntity> <parentField> ] ;
```

```qiy
scope orders customerId claim tenant.customerId;
scope warehouses orgId claim org.id tree organizations parentId;
```

| Slot | Rule |
| --- | --- |
| resource | Entity or table name; at most one declaration per resource |
| field | `UUID` or `Text`; not a database-enforced restriction on primary keys, but use a tenant/FK column |
| claim | `^[a-zA-Z_][a-zA-Z0-9_.-]*$`, read from `principal.claims` |
| `tree <entity> <parentField>` | Entity must exist; parent field UUID/Text; types must match the scope field, tree primary key and parent. Generates a `WITH RECURSIVE` subtree CTE (64-level cap) and an organization tree page at `/<treeResource>/tree`; missing parents/self-references/cycles are surfaced as orphans |
| local/hybrid auth | Every scope claim needs a matching users column (`org.id` -> `orgId`), otherwise generation fails: `Data scope claim org.id needs a matching field on users ...` |

Runtime:

| Path | Behavior |
| --- | --- |
| Reads (list/detail/aggregate/trend/export/GraphQL) | Adds `field = claim value` (or subtree expansion); missing claim -> 403 `Missing required data scope claim: <claim>` |
| Claim points to a missing node | Empty subtree -> empty result, never full data |
| Writes (create/update) | The scope field is **forced** to the claim value; client values are overwritten |
| Dataflow | `update` may not touch a scope field (`cannot update scope field`); `create` derives it (`create scope field ... is derived from the authenticated principal`) |
| `restrict { when (scope or ...) }` | The repository-level implicit scope filter is skipped so OR semantics hold; the expression is evaluated instead |
| API key | Claims are derived from user columns (`org.id` <- `orgId`), so scope applies |

## Page rules (pages)

```qiy
pages orders {
  list   roles admin, operator, viewer;
  show   roles admin, operator, viewer;
  create roles admin, operator;
  edit   roles admin, operator;
  delete roles admin;
  field totalCost roles admin;    // UI only: non-admins do not see the field
}
```

| Rule | Detail |
| --- | --- |
| Actions | `list`, `show`, `create`, `edit`, `delete`; each at most once |
| Roles | Non-empty, unique, only admin/operator/viewer |
| Undeclared actions | Not restricted by page rules (still subject to `restrict.roles` and the role model) |
| `field <name> roles ...` | UI rendering only (`canSeeField`); it does **not** filter API responses - use `mask` to hide data |
| Empty block | At least one action or field rule, else `requires at least one page action or field rule` |

Three enforcement layers:

1. Server guard (`auth/guard.ts`): REST maps by method/path (`GET` list -> `list`, `GET /:id` -> `show`, `POST` -> `create`, `PATCH|PUT` -> `edit`, `DELETE` -> `delete`, `export` read -> `list`, `import` read -> `list` / write -> `create`); GraphQL maps by root field; failure is 403 `Page access denied`.
2. Web: `qiyAccessControlProvider` checks resource role policy then page rules; `resource-page-guard.tsx` wraps the four CRUD routes with `CanAccess`, so a direct URL also renders a 403 result.
3. API docs: `/api/v1/openapi.json` and `/api/v1/docs/model` trim operations by `pages` (a viewer only keeps `list`/`show`).

## Declaration to artifact map

| DSL | Artifact | Enforcement point |
| --- | --- | --- |
| `auth { ... }` | `auth/guard.ts`, `auth/local.ts`, `auth/oidc.ts`, `auth/hybrid.ts`, `auth/password.ts` | Every request -> `Principal | null` |
| `permission field/group/from` | `auth/permissions.ts` (`PERMISSION_FIELD_VALUES`, `PERMISSION_GROUPS`, `PERMISSION_CLAIM_SOURCES`), `auth/permission-routes.ts` | `/auth/permissions`, `/auth/verify-permission`, `/auth/me`, command routes |
| `permission verification` | `PERMISSION_VERIFICATIONS` (serialized expression data) | Verification endpoint, `allow verification`, Web `CanAccess` (input-free) |
| `restrict` | `security/policy.ts` (`policies`, `resolvePolicy`), resource repositories/routes | Row pushdown, mask read/write, resource-level 403 |
| `scope` | `security/policy.ts` (`scopeResources`, `scopeHelpers`), `resolveScope()`, tree helper | Read/write implicit filtering |
| `pages` | `PageRules` in `auth/guard.ts`, `pageRules` in `web/app/auth.ts`, `resources[].fields[].roles` | REST/GraphQL guards, page guard, field rendering, docs filtering |
| `dataflow allow` | 403 decisions in the command route; Web `commandPolicies` | `/api/v1/commands/<name>`, button visibility |
| `action allow` | Web `commandPolicies` + business-page route guard | Buttons and `/:id/<action>` pages |
| `features apiKeys` | `qiy_api_keys`, `auth/api-keys.ts`, `withApiKeyAuthentication` | Bearer / `X-API-Key` fallback authentication |

Stable error keys (frontend-translatable): `command.forbidden` (403), `policy.denied` (403), `policy.resourceDenied` (403), `policy.missingClaim` (403), `policy.maskedField` (400/403), `policy.misconfigured` (500, generator defect). Business `require ... @error(t("key"))` returns default-locale text plus `errorKey`.

## Security boundaries and limits

1. **Hidden buttons are not authorization.** `when`, `pages` and `CanAccess` are UX. Writes are enforced by server `restrict`/`scope`/`allow`/`require`.
2. **Permissions only add.** Every source can only add values. To demote, change the role, the DB column or the IdP claim - there is no subtraction in the DSL, and `mask` cannot revoke a permission.
3. **admin does not bypass explicit allowlists.** `restrict { allow roles operator; }` and `allow roles operator;` both reject admin. Add admin explicitly if operations need it.
4. **admin short-circuits only in docs**: `/api/v1/openapi.json` is unfiltered for admin, but row predicates and `allow roles` still check admin (`mayUseResource` has no admin special case).
5. **Field masks are read/write and cover every generated read path** (list/detail/aggregate/export/realtime payload), but the database column remains plaintext: backups, direct DB access, application logs and external systems are **not** protected. Masked fields also cannot be imported.
6. **`restrict` blocks and dataflows are mutually exclusive**; row predicates and realtime are mutually exclusive. Do not treat "the command cannot see it" as row isolation.
7. **Shared realtime channels cannot do row isolation.** Only field `mask` trimming and `when <field> claim <claim>` segmented channels exist.
8. **API keys are session-equivalent.** Leakage grants the user's full permissions (role group + DB column + scope claims). Only an HMAC-SHA256 hash is stored server-side; revocation/expiry takes effect immediately.
9. **The OpenAPI document is a filtered HTTP endpoint**, not an admin-only artifact or a complete attack-surface list. `allow verification` commands appear only to admin, and row-level scope is not represented in the document structure. Separately, the Elysia plugin's `/api/v1/openapi` is public and has **no** Qiy permission filtering - never treat it as the production document source.
10. **No rate limiting is generated**: no login failure limit, no account lockout, no CAPTCHA, and OTP challenges are reusable within their 5-minute window. Put rate limiting at the gateway/WAF or the delivery adapter.
11. **No self-service password change**; account operations are CLI scripts. No refresh tokens; a 12-hour token plus IdP session is the whole story.
12. **Defaults must be made explicit**: no `restrict.allow roles` means no role restriction; undeclared `pages` actions are unrestricted; no dataflow `allow` means `admin, operator`.
13. **The `role` column is authoritative**: a stale JWT `role` is ignored because the user row is re-read; do not assume token payload equals current permissions.
14. **Permission values are a contract**: claims, DB columns, `x-qiy-permissions` and 403 `missing` all use the value string; renaming breaks external IdP/script integrations.
15. **Integration mode has no Qiy enforcement**: host adapters own authentication and authorization ([workspace-integration.md](workspace-integration.md)).

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Permission declarations require a generated auth block` | `permission` without `auth` | Add `auth` or delete the permission model |
| `provider is not a configured OAuth/OIDC provider` | claim source uses an unconfigured provider, or `local`/`otp` | Add the provider to `providers`, or use a database column |
| Command 403 with empty `missing` | verification used a negated set operator or an operator without diagnostics | Trust `allowed`; `missing` is explanatory |
| Non-admin cannot see a command button | `allow permission` not satisfied or permission metadata missing | Check `/auth/me` `permissions`; DB/claim entries must be permission values or group names |
| Non-admin cannot see a command in API docs | Principal lacks all expanded permission values | Check group expansion; docs and execution share the same check |
| `dataflow ... cannot use a restricted resource` | Command context/create uses a resource with any `restrict` block | Remove the resource from the command or drop its `restrict` |
| `restrict row predicates cannot be enforced on a shared channel` | Realtime plus a row `when` on the same resource | Use `when <field> claim <claim>` or disable realtime for it |
| `Page access denied` | `pages` disallows the action for the role | Adjust `pages`; export uses `list`, import writes use `create` |
| `Missing required data scope claim: org.id` | Principal lacks the claim (local session without the column) | Use OIDC, add the users column, or use an API key |
| Writing a masked field returns 400 | `mask` is bidirectional | Remove the mask or allow the role |
| Group cycle / self reference | Groups reference each other | Flatten to a list or rewrite as a union |
| `QIY_AUTH_SECRET must be at least 32 characters` | Missing/short production secret | `openssl rand -hex 32` into the secret manager |
| Login page shows no provider buttons | Provider's ISSUER/AUDIENCE/JWKS/AUTHORIZATION_URL/CLIENT_ID incomplete | Fill `QIY_OIDC_<ID>_*`; `/auth/providers` lists only complete configs |
| Immediate 401 after login | Token `iss` differs from the configured issuer | Use the discovery issuer verbatim (trailing `/` aside) |
| `State mismatch in the provider callback` | Concurrent logins in one browser / cleared sessionStorage | Log in again |
| `The provider token exchange failed` | Redirect mismatch, missing client secret, unreachable token endpoint | Align redirect, add the secret, set `HTTPS_PROXY` |
| Onboarding returns 409 | Username/email exists or the identity is bound to another account | Pick another username or bind from the original account |
| Unbind returns 409 | It is the last login method | Set a password or bind another provider first |
| OTP 502 `auth.otpDeliveryFailed` | Adapter unreachable, non-2xx, timeout or non-HTTPS | Check the delivery URL, token, timeout and network |

## Related references

- [Language reference](language-reference.md) - exact auth/permission block placement and settings
- [Dataflows and actions](dataflows-actions.md) - `allow`, resources, commands
- [System features](system-features.md) - API keys, OpenAPI, system pages
- [Storage and realtime](storage-realtime.md) - realtime roles and claim channels
- [Testing and deployment](testing-deployment.md) - auth acceptance and production checks
- [Troubleshooting](troubleshooting.md) - 401/403 symptom table

## Canonical docs

- [permissions (permission / restrict / scope / pages)](https://ai-nodev.github.io/qiy/dsl/permissions)
- [auth](https://ai-nodev.github.io/qiy/dsl/auth)
- [application: auth/scope/restrict/pages](https://ai-nodev.github.io/qiy/dsl/application)
- [auth guide](https://ai-nodev.github.io/qiy/guide/auth)
- [real services acceptance](https://ai-nodev.github.io/qiy/guide/real-services)
