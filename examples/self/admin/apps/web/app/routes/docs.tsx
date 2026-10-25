import { useIsAuthenticated, useTranslation } from "@refinedev/core";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { docsEnabled, qiyFeatureFlags } from "../features";
import { fetchDocsEnvelope, type DocsModel } from "../docs";
import { DocsOverviewPage } from "../components/docs-page";

export interface DocsPageState {
  model?: DocsModel;
  openApi?: unknown;
  loading: boolean;
  error?: string;
}

export default function DocsRoute() {
  const { translate } = useTranslation();
  const auth = useIsAuthenticated();
  const isAuthenticated = auth.data?.authenticated === true;
  const authLoading = auth.isLoading;
  const [state, setState] = useState<DocsPageState>({ loading: qiyFeatureFlags.apiDocs });
  useEffect(() => {
    if (!isAuthenticated || !qiyFeatureFlags.apiDocs) {
      setState({ loading: false });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const envelope = await fetchDocsEnvelope();
        if (!cancelled) setState({ model: envelope.model, openApi: envelope.openApi, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);
  if (!docsEnabled) return <Navigate to="/" replace />;
  if (!authLoading && !isAuthenticated) return <Navigate to="/auth/login" replace />;
  if (authLoading) return <div>{translate("qiy.loading", {}, "Loading")}</div>;
  return <DocsOverviewPage {...state} />;
}
