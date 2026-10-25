import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { qiyFeatureFlags } from "../features";
import { fetchOpenApiDocument } from "../docs";
import { fetchCurrentIdentity } from "../auth";
import { ApiDocsPage, type ApiDocsPageProps } from "../components/api-docs-page";

export default function ApiDocsRoute() {
  const [state, setState] = useState<{ spec?: unknown; identity?: ApiDocsPageProps["identity"]; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    // No auth hooks in route modules: they caused a render loop. The guard
    // layout handles redirects; fetch the spec + cached identity once.
    let cancelled = false;
    void (async () => {
      try {
        const [spec, identity] = await Promise.all([fetchOpenApiDocument(), fetchCurrentIdentity()]);
        if (!cancelled) setState({ spec, identity: (identity ?? undefined) as ApiDocsPageProps["identity"], loading: false });
      } catch (cause) {
        if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (!qiyFeatureFlags.apiDocs) return <Navigate to="/" replace />;
  return <ApiDocsPage {...state} />;
}
