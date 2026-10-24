import { useLogout, useNotification, useTranslation } from "@refinedev/core";
import { Alert, Button, Card, Descriptions, List, Popconfirm, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { beginProviderBind } from "../auth/oidc-multi";
import { fetchIdentities, unbindProvider, type QiyIdentities, type QiyIdentityProvider } from "../auth/account";

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
  const bind = async (provider: QiyIdentityProvider) => {
    setBusy(provider.id);
    try { await beginProviderBind(provider.id); }
    catch (caught) { open?.({ type: "error", message: caught instanceof Error ? caught.message : String(caught) }); setBusy(undefined); }
  };
  if (error && !identities) return <Alert type="error" showIcon message={error} />;
  if (!identities) return <Spin />;
  const passwordSet = identities.password.set;
  const canRemove = (provider: QiyIdentityProvider) => passwordSet || identities.providers.some((other) => other.id !== provider.id && other.bound);
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Typography.Title level={2} style={{ margin: 0 }}>{translate("qiy.profileTitle", {}, "Profile")}</Typography.Title>
    <Card title={translate("qiy.account", {}, "Account")} extra={<Button onClick={() => logout()}>{translate("qiy.signOut", {}, "Sign out")}</Button>}>
      <Descriptions column={1} items={[
        { key: "username", label: translate("qiy.username", {}, "Username"), children: identities.user.username },
        { key: "email", label: translate("qiy.email", {}, "Email"), children: identities.user.email },
        { key: "name", label: translate("qiy.name", {}, "Name"), children: identities.user.name },
        { key: "role", label: translate("qiy.role", {}, "Role"), children: <Tag color="blue">{translate("qiy.enums.userRole.values." + identities.user.role, {}, identities.user.role)}</Tag> },
        { key: "password", label: translate("qiy.password", {}, "Password"), children: passwordSet ? <Tag color="green">{translate("qiy.passwordSet", {}, "Set")}</Tag> : <Tag>{translate("qiy.passwordNotSet", {}, "Not set")}</Tag> },
      ]} />
    </Card>
    <Card title={translate("qiy.linkedMethods", {}, "Linked sign-in methods")}>
      <List<QiyIdentityProvider> dataSource={identities.providers} locale={{ emptyText: translate("qiy.noProviders", {}, "No OAuth providers configured") }} renderItem={(provider) => <List.Item actions={provider.bound
        ? [<Popconfirm key="unbind" title={translate("qiy.unlinkTitle", { provider: provider.label })} description={canRemove(provider) ? translate("qiy.unlinkKeep", {}, "You can link it again later.") : translate("qiy.unlinkLast", {}, "This is your last sign-in method.")} disabled={!canRemove(provider)} onConfirm={() => void unbind(provider)}><Button danger loading={busy === provider.id} disabled={!canRemove(provider)}>{translate("qiy.unbind", {}, "Unbind")}</Button></Popconfirm>]
        : [<Button key="bind" type="primary" loading={busy === provider.id} onClick={() => void bind(provider)}>{translate("qiy.bind", {}, "Bind")}</Button>]}>
        <List.Item.Meta title={<Space><Tag color={provider.bound ? "green" : "default"}>{provider.label}</Tag>{provider.bound ? <Typography.Text type="secondary">{translate("qiy.linked", {}, "Linked")}</Typography.Text> : null}</Space>} description={provider.bound ? <Typography.Text type="secondary">{provider.email ?? provider.name ?? provider.subject ?? translate("qiy.linked", {}, "Linked")}</Typography.Text> : <Typography.Text type="secondary">{translate("qiy.notLinked", {}, "Not linked yet")}</Typography.Text>} />
      </List.Item>} />
    </Card>
  </Space>;
}
