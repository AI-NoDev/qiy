import { CanAccess, useCustomMutation, useGetIdentity, useInvalidate } from "@refinedev/core";
import { Button, Popconfirm, Space, message } from "antd";

type Command = "submit" | "approve" | "ship" | "cancel";
export function OrderWorkflowActions({ id, status }: { id: string; status: string }) {
  const { data: identity } = useGetIdentity<{ role?: string }>();
  const { mutateAsync, mutation } = useCustomMutation();
  const invalidate = useInvalidate();
  const run = async (command: Command) => {
    try {
      await mutateAsync({ url: `/api/v1/orders/${encodeURIComponent(id)}/${command}`, method: "post", values: {}, ...(command === "submit" ? { meta: { idempotencyKey: crypto.randomUUID() } } : {}) });
      await invalidate({ resource: "orders", id, invalidates: ["detail", "list"] });
      void message.success("操作成功");
    } catch (error) { void message.error(String(error)); }
  };
  return <CanAccess resource="orders" action="edit"><Space wrap style={{ marginTop: 16 }}>
    {status === "draft" && <Button type="primary" loading={mutation.isPending} onClick={() => void run("submit")}>提交订单</Button>}
    {status === "submitted" && identity?.role === "admin" && <Button type="primary" loading={mutation.isPending} onClick={() => void run("approve")}>审批订单</Button>}
    {status === "approved" && <Popconfirm title="确认出库并扣减库存？" onConfirm={() => void run("ship")}><Button type="primary" loading={mutation.isPending}>出库</Button></Popconfirm>}
    {(status === "draft" || status === "submitted") && <Popconfirm title="确认取消订单并释放预占？" onConfirm={() => void run("cancel")}><Button danger loading={mutation.isPending}>取消订单</Button></Popconfirm>}
  </Space></CanAccess>;
}
