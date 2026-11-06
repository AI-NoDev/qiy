import { CanAccess, useCustomMutation, useGetIdentity, useInvalidate, useNotification, useTranslation } from "@refinedev/core";
import { Button, Popconfirm, Space } from "antd";

type Command = "submit" | "approve" | "ship" | "cancel";
export function OrderWorkflowActions({ id, status }: { id: string; status: string }) {
  const { data: identity } = useGetIdentity<{ role?: string }>();
  const { translate } = useTranslation();
  const { open: notify } = useNotification();
  const { mutateAsync, mutation } = useCustomMutation();
  const invalidate = useInvalidate();
  const run = async (command: Command) => {
    try {
      await mutateAsync({ url: `/api/v1/orders/${encodeURIComponent(id)}/${command}`, method: "post", successNotification: false, errorNotification: false, values: {}, ...(command === "submit" ? { meta: { idempotencyKey: crypto.randomUUID() } } : {}) });
      await invalidate({ resource: "orders", id, invalidates: ["detail", "list"] });
      notify?.({ type: "success", message: translate("notifications.success", {}, "Successful") });
    } catch (error) { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  };
  return <CanAccess resource="orders" action="edit" params={{ id }}><Space wrap style={{ marginTop: 16 }}>
    {status === "draft" && <Button type="primary" loading={mutation.isPending} onClick={() => void run("submit")}>{translate("orders.actions.submit", {}, "Submit order")}</Button>}
    {status === "submitted" && identity?.role === "admin" && <Button type="primary" loading={mutation.isPending} onClick={() => void run("approve")}>{translate("orders.actions.approve", {}, "Approve order")}</Button>}
    {status === "approved" && <Popconfirm title={translate("orders.actions.shipConfirm", {}, "Confirm shipment and deduct inventory?")} onConfirm={() => void run("ship")}><Button type="primary" loading={mutation.isPending}>{translate("orders.actions.ship", {}, "Ship")}</Button></Popconfirm>}
    {(status === "draft" || status === "submitted") && <Popconfirm title={translate("orders.actions.cancelConfirm", {}, "Cancel order and release reservations?")} onConfirm={() => void run("cancel")}><Button danger loading={mutation.isPending}>{translate("orders.actions.cancel", {}, "Cancel order")}</Button></Popconfirm>}
  </Space></CanAccess>;
}
