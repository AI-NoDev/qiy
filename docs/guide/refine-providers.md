# Refine providers

Qiy generates the Refine provider layer together with the API contract. The generated application uses one `DataProvider` for CRUD, an `AuthProvider` for login, an `AccessControlProvider` for UI checks, the Ant Design notification provider, `@refinedev/kbar` for the command palette, and an optional `AuditLogProvider` for server-owned history.

## Generated paths

```text
apps/web/app/root.tsx                         # Refine, layout and providers
apps/web/app/data-provider.ts                 # REST or GraphQL DataProvider
apps/web/app/auth.ts                          # AuthProvider and AccessControlProvider
apps/web/app/auth/oidc-client.ts              # Authorization Code + PKCE client for external IdPs
apps/web/app/providers/audit-log-provider.ts  # AuditLogProvider
apps/web/app/components/audit-history.tsx     # useLogList detail panel
```

## Authentication

For `provider local`, the login route uses Refine and Ant Design's official `AuthPage`. Its email field is mapped to the `.qiy` `usernameField`, so it also supports ordinary usernames. The server verifies the password hash and returns a bearer access token.

```text
apps/web/app/routes/login.tsx                 # AuthPage login
apps/server/src/auth/local.ts                 # password verification and token issue
```

Okta, Auth0, Azure AD B2C, Keycloak, Google, Kinde and generic OIDC/OAuth2/SSO use the generated Authorization Code + PKCE flow. The callback validates state before exchanging the code and never accepts a browser client secret. OTP uses a separate request/verify UI and server challenge contract; it is not treated as OIDC.

`Authenticated` protects the application shell. A missing token redirects to `/auth/login`; an API `401` invokes `AuthProvider.onError` and logs the user out. A `403` preserves the session and is rendered as an authorization failure.

## Command palette

The template wraps Refine with `RefineKbarProvider` and renders `RefineKbar` inside the Refine context. The default shortcut exposes generated resources and their registered list/create/edit/show routes without maintaining a second command registry.

## Data and notifications

The generated DataProvider is the only CRUD entry point used by list, form and show pages. Select `rest` or `graphql` in `.qiy`; Qiy can generate both server endpoints, but the web package selects one client.

Success and error messages use Refine's `useNotification` and the configured Ant Design `useNotificationProvider`. This keeps mutation messages consistent with Refine's mutation hooks and avoids mixing an unconfigured global `antd` message instance into generated pages.

## Access control

`CanAccess` wraps resource routes, menu entries, list actions, detail actions and declared business actions. The provider checks the current identity and the same resource/action policy used by the server. It only controls visibility and navigation; every API and dataflow command repeats authorization on the server.

Field visibility is generated from `visible`, `listVisible`, `formVisible` and `showVisible`. A hidden field is still protected by the server schema and must not be treated as a security boundary in a hand-written extension.

## Audit logs

When `auth` is configured, the server writes audit events in the same transaction as the business mutation. Qiy generates an audit table and a read-only `GET /api/v1/audit-logs/` route. The web package registers Refine's `AuditLogProvider`; the detail page renders `useLogList` behind `CanAccess action="audit"`.

The public projection contains event id, resource, action, time, resource id and an author projection. The author is a left join to the configured auth user entity, so deleting or anonymizing a user does not erase the historical actor id. Password hashes and raw metadata are never returned. Client `create` and `update` audit calls are rejected because browser-provided audit records are forgeable.

The current generated read route is admin-only and rejects scoped-resource reads until persisted tenant or scope metadata is declared. This fail-closed behavior prevents a dashboard from accidentally exposing another tenant's history. Tenant audit filtering remains a separate implementation item.

## Extending a generated project

Keep custom providers and domain behavior in files outside the Qiy manifest, or in the generated host adapter for `qiy init`. `--sync` may rewrite files registered by the manifest, while hand-written extensions are retained. If an existing API has a different envelope, URL or refresh-cookie contract, implement that mapping in the host DataProvider/AuthProvider and test it independently.
