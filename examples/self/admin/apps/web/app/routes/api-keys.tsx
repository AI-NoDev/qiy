import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { qiyFeatureFlags } from "../features";
import { listApiKeyEvents, listApiKeys, type ApiKeyEvent, type ApiKeyRecord, type QiyIdentityLike } from "../api-keys";
import { fetchCurrentIdentity } from "../auth";
import { ApiKeysPage } from "../components/api-keys-page";

export default function ApiKeysRoute() {
  const [state, setState] = useState<{ records?: ApiKeyRecord[]; events?: ApiKeyEvent[]; identity?: QiyIdentityLike; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // No auth hooks in route modules (render-loop hazard); the guarded layout
    // owns redirects, this effect fetches the key list, audit events + cached identity once.
    let cancelled = false;
    void (async () => {
      try {
        const [records, events, identity] = await Promise.all([listApiKeys(), listApiKeyEvents(), fetchCurrentIdentity()]);
        if (!cancelled) setState({ records, events, identity: identity ?? undefined, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!qiyFeatureFlags.apiKeys) return <Navigate to="/" replace />;
  return <ApiKeysPage initialRecords={state.records} initialEvents={state.events} identity={state.identity} loading={state.loading} error={state.error} />;
}
