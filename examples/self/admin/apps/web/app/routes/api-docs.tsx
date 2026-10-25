import { useGetIdentity, useIsAuthenticated, useTranslation } from "@refinedev/core";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { qiyFeatureFlags } from "../features";
import { fetchOpenApiDocument } from "../docs";
import { ApiDocsPage } from "../components/api-docs-page";

export default function ApiDocsRoute() {
  const { translate } = useTranslation();
  const auth = useIsAuthenticated();
  const identityQuery = useGetIdentity<{ role?: string; permissions?: string[]; groups?: string[] }>();
  const isAuthenticated = auth.data?.authenticated === true;
  const [state, setState] = useState<{ spec?: unknown; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    if (!isAuthenticated) {
      setState({ loading: false });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const spec = await fetchOpenApiDocument();
        if (!cancelled) setState({ spec, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);
  if (!qiyFeatureFlags.apiDocs) return <Navigate to="/" replace />;
  if (!auth.isLoading && !isAuthenticated) return <Navigate to="/auth/login" replace />;
  if (auth.isLoading) return <div>{translate("qiy.loading", {}, "Loading")}</div>;
  return <ApiDocsPage {...state} identity={identityQuery.data ?? undefined} />;
}
