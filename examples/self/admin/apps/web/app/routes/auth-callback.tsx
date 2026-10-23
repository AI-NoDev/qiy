import { Alert, Card, Spin } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { completeProviderLogin } from "../auth/oidc-multi";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  useEffect(() => { let active = true; void completeProviderLogin(new URL(window.location.href)).then((target) => { if (active) navigate(target || "/", { replace: true }); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); }); return () => { active = false; }; }, [navigate]);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card>{error ? <Alert type="error" showIcon message={error} /> : <Spin />}</Card></main>;
}
