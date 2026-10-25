import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { overviewEnabled } from "../features";
import { fetchDocsModel, type DocsModel } from "../docs";
import { DocsOverviewPage } from "../components/docs-page";

export default function DocsRoute() {
  const [state, setState] = useState<{ model?: DocsModel; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // The route lives inside the guarded layout; using auth hooks here caused a
    // render loop, so fetch the model once and let the layout handle redirects.
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
  }, []);
  if (!overviewEnabled) return <Navigate to="/" replace />;
  return <DocsOverviewPage {...state} />;
}
