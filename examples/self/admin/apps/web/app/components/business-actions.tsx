import { CanAccess, useCustomMutation, useInvalidate, useNotification, useTranslation } from "@refinedev/core";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, InputNumber, Modal, Popconfirm, Select, Space } from "antd";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { actionsFor, batchActionsFor, type QiyActionDefinition } from "../actions";

function CommandAction({ action, resource, recordId }: { action: QiyActionDefinition; resource: string; recordId: string }) {
  const { translate } = useTranslation();
  const { open: notify } = useNotification();
  const [open, setOpen] = useState(false); const [form] = Form.useForm(); const { mutateAsync, mutation } = useCustomMutation(); const invalidate = useInvalidate(); const queryClient = useQueryClient();
  const pendingRequest = useRef<{ payload: string; key: string } | null>(null);
  if (action.target.kind !== "dataflow") return null;
  const target = action.target; const fields = target.inputs.filter((field) => field.name !== target.idInput && field.required);
  const actionLabel = action.labelKey ? translate(action.labelKey, {}, action.label) : action.label;
  const confirmation = target.confirmKey ? translate(target.confirmKey, {}, target.confirm) : target.confirm;
  const run = async (values: Record<string, unknown> = {}) => {
    const body = Object.fromEntries(target.inputs.map((field) => [field.name, field.name === target.idInput ? recordId : values[field.name]]));
    const payload = JSON.stringify(body);
    if (!pendingRequest.current || pendingRequest.current.payload !== payload) pendingRequest.current = { payload, key: crypto.randomUUID() };
    try {
      await mutateAsync({ url: target.url, method: "post", successNotification: false, errorNotification: false, values: body, ...(target.idempotency ? { meta: { idempotencyKey: pendingRequest.current.key } } : {}) });
      pendingRequest.current = null;
      setOpen(false); form.resetFields(); notify?.({ type: "success", message: translate("notifications.success", {}, "Successful"), description: actionLabel });
      await invalidate({ resource, id: recordId, invalidates: ["detail", "list"] });
      await queryClient.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).toLowerCase().includes("audit") });
    } catch (error) { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
  };
  const button = <Button type="link" loading={mutation.isPending} onClick={fields.length ? () => setOpen(true) : confirmation ? undefined : () => void run()}>{actionLabel}</Button>;
  return <CanAccess resource={resource} action={action.name} params={{ id: recordId }}>{fields.length ? <>{button}<Modal open={open} title={actionLabel} okText={actionLabel} confirmLoading={mutation.isPending} onCancel={() => setOpen(false)} onOk={() => form.submit()}>{confirmation && <p>{confirmation}</p>}<Form form={form} layout="vertical" onFinish={(values) => void run(values)}>{fields.map((field) => <Form.Item key={field.name} name={field.name} label={field.commentKey ? translate(field.commentKey, {}, field.comment ?? field.name) : field.comment ?? field.name} rules={[{ required: true }]} valuePropName={field.type === "Boolean" ? "checked" : "value"}>{field.options ? <Select options={field.options} /> : field.type === "Boolean" ? <Checkbox /> : field.type === "Integer" || field.type === "Decimal" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>)}</Form></Modal></> : confirmation ? <Popconfirm title={confirmation} onConfirm={() => void run()}>{button}</Popconfirm> : button}</CanAccess>;
}

function BatchCommandAction({ action, resource, recordIds, onComplete }: { action: QiyActionDefinition; resource: string; recordIds: string[]; onComplete(): void }) {
  const { translate } = useTranslation(); const { open: notify } = useNotification(); const [open, setOpen] = useState(false); const [form] = Form.useForm(); const { mutateAsync, mutation } = useCustomMutation(); const invalidate = useInvalidate(); const queryClient = useQueryClient(); const pendingRequest = useRef<{ payload: string; key: string } | null>(null);
  if (action.target.kind !== "dataflow") return null;
  const target = action.target; const fields = target.inputs.filter((field) => field.name !== target.idInput && field.required); const actionLabel = action.labelKey ? translate(action.labelKey, {}, action.label) : action.label; const confirmation = target.confirmKey ? translate(target.confirmKey, {}, target.confirm) : target.confirm;
  const run = async (values: Record<string, unknown> = {}) => { const items = recordIds.map((recordId) => Object.fromEntries(target.inputs.map((field) => [field.name, field.name === target.idInput ? recordId : values[field.name]]))); const body = { items }; const payload = JSON.stringify(body); if (!pendingRequest.current || pendingRequest.current.payload !== payload) pendingRequest.current = { payload, key: crypto.randomUUID() }; try { await mutateAsync({ url: target.url, method: "post", successNotification: false, errorNotification: false, values: body, meta: { idempotencyKey: pendingRequest.current.key } }); pendingRequest.current = null; setOpen(false); form.resetFields(); onComplete(); notify?.({ type: "success", message: translate("notifications.success", {}, "Successful"), description: actionLabel }); await invalidate({ resource, invalidates: ["list"] }); await queryClient.invalidateQueries({ predicate: (query) => JSON.stringify(query.queryKey).toLowerCase().includes("audit") }); } catch (error) { notify?.({ type: "error", message: error instanceof Error ? error.message : String(error) }); } };
  const button = <Button loading={mutation.isPending} onClick={fields.length ? () => setOpen(true) : confirmation ? undefined : () => void run()}>{actionLabel} ({recordIds.length})</Button>;
  return <CanAccess resource={resource} action={action.name} params={{ ids: recordIds }}>{fields.length ? <>{button}<Modal open={open} title={actionLabel} okText={actionLabel} confirmLoading={mutation.isPending} onCancel={() => setOpen(false)} onOk={() => form.submit()}>{confirmation && <p>{confirmation}</p>}<Form form={form} layout="vertical" onFinish={(values) => void run(values)}>{fields.map((field) => <Form.Item key={field.name} name={field.name} label={field.commentKey ? translate(field.commentKey, {}, field.comment ?? field.name) : field.comment ?? field.name} rules={[{ required: true }]} valuePropName={field.type === "Boolean" ? "checked" : "value"}>{field.options ? <Select options={field.options} /> : field.type === "Boolean" ? <Checkbox /> : field.type === "Integer" || field.type === "Decimal" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>)}</Form></Modal></> : confirmation ? <Popconfirm title={confirmation} onConfirm={() => void run()}>{button}</Popconfirm> : button}</CanAccess>;
}

export function BusinessActions({ resource, placement, record }: { resource: string; placement: "list" | "show"; record: Record<string, unknown> }) { const { translate } = useTranslation(); const recordId = String(record.id); return <Space wrap>{actionsFor(resource, placement, record).map((action) => action.target.kind === "navigate" ? <CanAccess key={action.name} resource={resource} action={action.name} params={{ id: recordId }}><Link to={action.target.path.replace(":id", encodeURIComponent(recordId))}><Button type="link">{action.labelKey ? translate(action.labelKey, {}, action.label) : action.label}</Button></Link></CanAccess> : <CommandAction key={action.name} action={action} resource={resource} recordId={recordId} />)}</Space>; }
export function BatchBusinessActions({ resource, recordIds, onComplete }: { resource: string; recordIds: string[]; onComplete(): void }) { if (!recordIds.length) return null; return <Space wrap>{batchActionsFor(resource).map((action) => <BatchCommandAction key={action.name} action={action} resource={resource} recordIds={recordIds} onComplete={onComplete} />)}</Space>; }
