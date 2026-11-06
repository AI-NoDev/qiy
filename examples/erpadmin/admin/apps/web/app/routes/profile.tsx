import { useLogout, useNotification, useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Descriptions, List, Popconfirm, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { fetchIdentities, revokeAllSessions, unbindProvider, type QiyIdentities, type QiyIdentityProvider } from "../auth/account";

export default function Profile() {
  const [searchParams] = useSearchParams();
  const { open } = useNotification();
  const { translate } = useTranslation();
  const { mutate: logout } = useLogout();
  const [identities, setIdentities] = useState<QiyIdentities>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const load = async () => {
    try { setIdentities(await fetchIdentities()); setError(undefined); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  useEffect(() => { void load(); }, []);
  const linked = searchParams.get("linked");
  useEffect(() => { if (linked) open?.({ type: "success", message: translate("qiy.linkedToast", { provider: linked }) }); }, [linked, open, translate]);
  const unbind = async (provider: QiyIdentityProvider) => {
    setBusy(provider.id);
    try { await unbindProvider(provider.id); await load(); open?.({ type: "success", message: translate("qiy.unlinkedToast", { provider: provider.label }) }); }
    catch (caught) { open?.({ type: "error", message: caught instanceof Error ? caught.message : String(caught) }); }
    finally { setBusy(undefined); }
  };
  const revokeAll = async () => {
    setBusy("revoke-all");
    try { await revokeAllSessions(); open?.({ type: "success", message: translate("qiy.revokeAllDone", {}, "All sessions revoked") }); logout(); }
    catch (caught) { open?.({ type: "error", message: caught instanceof Error ? caught.message : String(caught) }); setBusy(undefined); }
  };
  
  if (error && !identities) return <Alert type="error" showIcon message={error} />;
  if (!identities) return <Spin />;
  const passwordSet = identities.password.set;
  const canRemove = (provider: QiyIdentityProvider) => passwordSet || identities.providers.some((other) => other.id !== provider.id && other.bound);
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Typography.Title level={2} style={{ margin: 0 }}>{translate("qiy.profileTitle", {}, "Profile")}</Typography.Title>
    <Card title={translate("qiy.account", {}, "Account")} extra={<Space><Popconfirm title={translate("qiy.revokeAllConfirm", {}, "Sign out every device? Existing local sessions stop working immediately.")} onConfirm={() => void revokeAll()} okText={translate("qiy.revokeAll", {}, "Sign out all devices")} cancelText={translate("qiy.cancel", {}, "Cancel")}><Button danger loading={busy === "revoke-all"}>{translate("qiy.revokeAll", {}, "Sign out all devices")}</Button></Popconfirm><Button onClick={() => logout()}>{translate("qiy.signOut", {}, "Sign out")}</Button></Space>}>
      <Descriptions column={1} items={[
        { key: "username", label: translate("qiy.username", {}, "Username"), children: identities.user.username },
        { key: "email", label: translate("qiy.email", {}, "Email"), children: identities.user.email },
        { key: "name", label: translate("qiy.name", {}, "Name"), children: identities.user.name },
        { key: "role", label: translate("qiy.role", {}, "Role"), children: <Tag color="blue">{translate("qiy.enums.userRole.values." + identities.user.role, {}, identities.user.role)}</Tag> },
        { key: "password", label: translate("qiy.password", {}, "Password"), children: passwordSet ? <Tag color="green">{translate("qiy.passwordSet", {}, "Set")}</Tag> : <Tag>{translate("qiy.passwordNotSet", {}, "Not set")}</Tag> },
      ]} />
    </Card>
  </Space>;
}
