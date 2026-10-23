import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { beginProviderLogin, fetchAuthProviders, type QiyAuthProviderPublic } from "../auth/oidc-multi";

export default function Login() {
  const [providers, setProviders] = useState<QiyAuthProviderPublic[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; void fetchAuthProviders().then((list) => { if (active) { setProviders(list); setLoading(false); } }).catch((caught: unknown) => { if (active) { setError(caught instanceof Error ? caught.message : String(caught)); setLoading(false); } }); return () => { active = false; }; }, []);
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}>
    <Card style={{ width: 420 }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Qiy Admin</Typography.Title>
        <Typography.Text type="secondary">Choose an identity provider to sign in.</Typography.Text>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {loading ? <Spin /> : null}
        <Space direction="vertical" style={{ width: "100%" }}>
          {providers.map((provider) => <Button key={provider.id} block size="large" onClick={() => void beginProviderLogin(provider)}>{provider.label}</Button>)}
        </Space>
        {!loading && providers.length === 0 && !error ? <Alert type="warning" showIcon message="No identity provider is configured on the server" /> : null}
      </Space>
    </Card>
  </main>;
}
