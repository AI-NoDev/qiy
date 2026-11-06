import { useTranslation } from "@refinedev/core";

export default function Login() { const { translate } = useTranslation(); return <main style={{ padding: 40 }}>{translate("qiy.loginNotConfigured", {}, "Authentication is not configured for this application.")}</main>; }
