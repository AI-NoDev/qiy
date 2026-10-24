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
    let active = true;
    void completeProviderCallback(new URL(window.location.href))
      .then((target) => { if (active) navigate(target, { replace: true }); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
  }, [navigate]);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card style={{ width: 420 }}>{error ? <Alert type="error" showIcon message={error} /> : <><Spin /><Typography.Paragraph style={{ marginTop: 16 }}>{translate("qiy.completingSignIn", {}, "Completing sign-in…")}</Typography.Paragraph></>}</Card></main>;
}
