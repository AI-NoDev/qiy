import { useGetIdentity, useIsAuthenticated, useTranslation } from "@refinedev/core";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { qiyFeatureFlags } from "../features";
import { listApiKeys, type ApiKeyRecord, type QiyIdentityLike } from "../api-keys";
import { ApiKeysPage } from "../components/api-keys-page";

export default function ApiKeysRoute() {
  const { translate } = useTranslation();
  const auth = useIsAuthenticated();
  const identityQuery = useGetIdentity<QiyIdentityLike>();
  const isAuthenticated = auth.data?.authenticated === true;
  const [state, setState] = useState<{ records?: ApiKeyRecord[]; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    if (!isAuthenticated) {
      setState({ loading: false });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const records = await listApiKeys();
        if (!cancelled) setState({ records, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);
  if (!qiyFeatureFlags.apiKeys) return <Navigate to="/" replace />;
  if (!auth.isLoading && !isAuthenticated) return <Navigate to="/auth/login" replace />;
  if (auth.isLoading) return <div>{translate("qiy.loading", {}, "Loading")}</div>;
  return <ApiKeysPage {...state} identity={identityQuery.data ?? undefined} />;
}
