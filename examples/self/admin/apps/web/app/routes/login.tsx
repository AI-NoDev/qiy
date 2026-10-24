import { AuthPage } from "@refinedev/antd";
import { useEffect, useState } from "react";
import { fetchAuthProviders } from "../auth/oidc-multi";

/**
 * One login page for password accounts and every OAuth provider configured on
 * the server. AuthPage renders the credentials form; the providers prop adds one
 * button per provider (the login mutation then starts the PKCE redirect).
 */
export default function Login() {
  const [providers, setProviders] = useState<Array<{ name: string; label: string }>>([]);
  useEffect(() => { let active = true; void fetchAuthProviders().then((list) => { if (active) setProviders(list.map((provider) => ({ name: provider.id, label: provider.label }))); }).catch(() => undefined); return () => { active = false; }; }, []);
  return <AuthPage type="login" title="Qiy Admin" providers={providers} registerLink={false} forgotPasswordLink={false} rememberMe={false} formProps={{ layout: "vertical" }} />;
}
