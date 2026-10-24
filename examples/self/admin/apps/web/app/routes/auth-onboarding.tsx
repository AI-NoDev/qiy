import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { decodeOnboardingToken, registerOAuthUser } from "../auth/oidc-multi";

interface OnboardingValues { username: string; email?: string; password: string; confirmPassword: string }

/**
 * Shown after the first OAuth sign-in for an identity that has no users row.
 * The IdP username/email prefill the form; the user may adjust them and must set
 * a password so the account also works with password login.
 */
export default function AuthOnboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const claims = token ? decodeOnboardingToken(token) : null;
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const initialUsername = claims?.username ?? claims?.email ?? claims?.subject ?? "";
  const initialEmail = claims?.email ?? "";
  const submit = async (values: OnboardingValues) => {
    setSubmitting(true);
    setError(undefined);
    try {
      await registerOAuthUser({ onboardingToken: token, username: values.username.trim(), email: (values.email ?? values.username).trim(), password: values.password });
      navigate("/", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  };
  if (!token) return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card style={{ width: 480 }}><Alert type="error" showIcon message="This onboarding link is invalid or has expired." /><Button style={{ marginTop: 16 }} onClick={() => navigate("/auth/login", { replace: true })}>Back to sign in</Button></Card></main>;
  return <main style={{ padding: 40, display: "flex", justifyContent: "center" }}><Card style={{ width: 480 }}>
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>Finish creating your account</Typography.Title>
      <Typography.Text type="secondary">{claims?.provider ? "Signed in with " + claims.provider + ". " : ""}Confirm the account details and choose a password.</Typography.Text>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <Form layout="vertical" initialValues={{ username: initialUsername, email: initialEmail, password: "", confirmPassword: "" }} onFinish={(values) => void submit(values as OnboardingValues)}>
        <Form.Item name="username" label="Email" rules={[{ required: true, message: "This field is required" }]}><Input autoComplete="username" /></Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true, min: 8, message: "Use at least 8 characters" }]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Form.Item name="confirmPassword" label="Confirm password" dependencies={["password"]} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value: string) => value === getFieldValue("password") ? Promise.resolve() : Promise.reject(new Error("Passwords do not match")) })]}><Input.Password autoComplete="new-password" /></Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting}>Create account and sign in</Button>
      </Form>
      <Typography.Text type="secondary">Already have an account with a password? <Typography.Link onClick={() => navigate("/auth/login", { replace: true })}>Sign in</Typography.Link> and link this provider from your profile.</Typography.Text>
    </Space>
  </Card></main>;
}
