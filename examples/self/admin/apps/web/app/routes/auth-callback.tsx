import { Alert, Card, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "@refinedev/core";
import { completeProviderCallback } from "../auth/oidc-multi";

/** Finishes a provider sign-in: onboarding, linked provider or a normal session. */
export default function AuthCallback() {
  const navigate = useNavigate();
  const { translate } = useTranslation();
  const started = useRef(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // No "active" cleanup guard here: React StrictMode runs the cleanup between
    // the double-invoked effects, and the second pass is skipped by the ref, so an
    // active flag would silently swallow the navigation and leave the spinner up.
    void completeProviderCallback(new URL(window.location.href))
      .then((target) => navigate(target, { replace: true }))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [navigate]);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card style={{ width: 420 }}>{error ? <Alert type="error" showIcon message={error} /> : <><Spin /><Typography.Paragraph style={{ marginTop: 16 }}>{translate("qiy.completingSignIn", {}, "Completing sign-in…")}</Typography.Paragraph></>}</Card></main>;
}
