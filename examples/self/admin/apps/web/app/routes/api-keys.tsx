import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { qiyFeatureFlags } from "../features";
import { listApiKeys, type ApiKeyRecord, type QiyIdentityLike } from "../api-keys";
import { fetchCurrentIdentity } from "../auth";
import { ApiKeysPage } from "../components/api-keys-page";

export default function ApiKeysRoute() {
  const [state, setState] = useState<{ records?: ApiKeyRecord[]; identity?: QiyIdentityLike; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // No auth hooks in route modules (render-loop hazard); the guarded layout
    // owns redirects, this effect fetches the key list + cached identity once.
    let cancelled = false;
    void (async () => {
      try {
        const [records, identity] = await Promise.all([listApiKeys(), fetchCurrentIdentity()]);
        if (!cancelled) setState({ records, identity: identity ?? undefined, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!qiyFeatureFlags.apiKeys) return <Navigate to="/" replace />;
  return <ApiKeysPage {...state} />;
}
