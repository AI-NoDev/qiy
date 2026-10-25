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
  const [state, setState] = useState<DocsPageState>({ loading: qiyFeatureFlags.apiDocs });
  useEffect(() => {
    if (!qiyFeatureFlags.apiDocs) {
      setState({ loading: false });
      return;
    }
    // This route lives inside the authenticated layout, so it does not need its
    // own auth query. An auth query in this route triggered a render loop
    // (hundreds of renders per second, blank page); rely on the guard layout and
    // fetch the docs envelope once.
    let cancelled = false;
    void fetchDocsEnvelope()
      .then((envelope) => { if (!cancelled) setState({ model: envelope.model, openApi: envelope.openApi, loading: false }); })
      .catch((cause: unknown) => { if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) }); });
    return () => { cancelled = true; };
  }, []);
  if (!docsEnabled) return <Navigate to="/" replace />;
  return <DocsOverviewPage {...state} />;
}
