# Production Verification Checklist

Use this checklist when a user asks whether a generated project is ready to deploy:

| Check | It proves | It does not prove |
| --- | --- | --- |
| `qiy create` or `qiy init` succeeds | Model files and packages were generated | Runtime, database, identity, storage, or business correctness |
| `bun run typecheck` passes | Generated TypeScript is structurally valid | Transaction and authorization behavior |
| `bun test` passes | Included tests pass in their configured environment | Real PostgreSQL/MySQL, IdP, S3, concurrency, or rollback |
| `bun run build` passes | The build pipeline completes | Production deployment health |
| `preview` opens locally | Local demo path works | Public exposure, durable data, secrets, or multi-replica safety |

Before a real deployment, verify:

1. Database dialect, migrations, indexes, transactions, rollback, and concurrency.
2. The actual Okta/Auth0/Azure AD B2C/Keycloak/Google/Kinde or generic OIDC issuer, PKCE redirect/logout allowlists, JWKS rotation, claims mapping, session policy, roles, and tenant authorization. For OTP, verify the email/SMS adapter, rate limits, replay resistance and provider failure behavior.
3. S3-compatible uploads, signed reads, ownership checks, orphan cleanup, retention, and failure recovery.
4. The generated API contract against the real frontend and any host-system adapters.
5. Docker/Kubernetes/serverless health checks, secrets, logging, metrics, backups, and SPA/API proxy routing.

For a product with connector authorization, queues, encrypted tokens, revocation, audit, or synchronization workflows, keep those responsibilities in domain services and test them independently. CRUD generation does not implement them automatically.
