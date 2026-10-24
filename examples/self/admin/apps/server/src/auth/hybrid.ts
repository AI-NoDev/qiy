import { createProductionAuthenticator as createLocalAuthenticator } from "./local";
import { createProductionAuthenticator as createProviderAuthenticator } from "./oidc";
import type { Authenticator } from "./guard";

/**
 * Hybrid authentication: signed password sessions (issuer "qiy-admin") and
 * OAuth/OIDC provider tokens share one bearer authenticator. The provider side
 * only verifies tokens whose issuer matches a configured provider, so an
 * unknown or forged token is never accepted.
 */
export function createProductionAuthenticator(): Authenticator {
  const local = createLocalAuthenticator();
  const providers = createProviderAuthenticator();
  return async (request) => (await local(request)) ?? (await providers(request));
}
