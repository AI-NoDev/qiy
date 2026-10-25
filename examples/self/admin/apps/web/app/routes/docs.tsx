import { useIsAuthenticated, useTranslation } from "@refinedev/core";
import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { overviewEnabled } from "../features";
import { fetchDocsModel, type DocsModel } from "../docs";
import { DocsOverviewPage } from "../components/docs-page";

export default function DocsRoute() {
  const { translate } = useTranslation();
  const auth = useIsAuthenticated();
  const isAuthenticated = auth.data?.authenticated === true;
  const authLoading = auth.isLoading;
  const [state, setState] = useState<{ model?: DocsModel; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    if (!isAuthenticated) {
      setState({ loading: false });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const model = await fetchDocsModel();
        if (!cancelled) setState({ model, loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);
  if (!overviewEnabled) return <Navigate to="/" replace />;
  if (!authLoading && !isAuthenticated) return <Navigate to="/auth/login" replace />;
  if (authLoading) return <div>{translate("qiy.loading", {}, "Loading")}</div>;
  return <DocsOverviewPage {...state} />;
}
