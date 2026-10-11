import { Create, Edit, useForm, useSelect } from "@refinedev/antd";
import { Alert, Button, Form, Input, InputNumber, Select, Space, Upload } from "antd";
import type { ResourceDefinition, ResourceEnumValue, ResourceField } from "../resources";
import { qiyIcons } from "../icons";
import { useTranslation } from "@refinedev/core";
import { t, type QiyLocale } from "../i18n";

function RelationSelect({ relation }: { relation: NonNullable<ResourceField["relation"]> }) {
  const { selectProps } = useSelect<Record<string, unknown>>({
    resource: relation.resource,
    optionLabel: relation.labelField,
    optionValue: "id",
    pagination: { pageSize: 100 },
    onSearch: (value) => [{ field: "__search", operator: "contains", value }],
  });
  return <Select {...selectProps} showSearch optionFilterProp="label" allowClear />;
}

function EnumLabel({ item }: { item: ResourceEnumValue }) {
  const Icon = item.icon ? qiyIcons[item.icon as keyof typeof qiyIcons] : undefined;
  return <Space>{Icon && <Icon />}{item.label ?? item.name}</Space>;
}

function FileInput({ name, resource, resourceId }: { name: string; resource: string; resourceId?: string }) {
  const form = Form.useFormInstance();
  return <Upload showUploadList={false} customRequest={async ({ file, onError, onSuccess }) => {
    try {
      const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
      const key = `uploads/${crypto.randomUUID()}-${String((file as File).name ?? "file").replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
      const params = new URLSearchParams({ key, fileName: String((file as File).name ?? "file"), resource });
      if (resourceId) params.set("resourceId", resourceId);
      const response = await fetch(`/api/v1/files?${params}`, { method: "POST", body: file as Blob, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
      form.setFieldValue(name, key);
      onSuccess?.(await response.json());
    } catch (error) { onError?.(error as Error); }
  }}><Button>上传文件</Button></Upload>;
}

export function ResourceForm({ resource, id }: { resource: ResourceDefinition; id?: string }) {
  const fields = resource.fields.filter((field) => field.formVisible && !field.primaryKey && field.type !== "Vector");
  const { getLocale, translate } = useTranslation(); const locale: QiyLocale = getLocale() === "en-US" ? "en-US" : "zh-CN";
  const { formProps, saveButtonProps, query, onFinish } = useForm<Record<string, unknown>>({ resource: resource.name, id, action: id ? "edit" : "create", redirect: "list" });
  const content = <>
    {query?.isError && <Alert type="error" showIcon message={String(query.error)} />}
    <Form {...formProps} layout="vertical" style={{ maxWidth: 720 }} onFinish={(values) => { const record = values as Record<string, unknown>; return onFinish(Object.fromEntries(fields.flatMap((field) => { const value = record[field.name]; return (value === undefined || value === "") && field.nullable ? [] : [[field.name, field.type === "Integer" ? Number(value) : value]]; }))); }}>
      {fields.map((field) => <Form.Item key={field.name} name={field.name} label={field.label} tooltip={field.commentKey ? translate(field.commentKey, {}, field.comment) : field.comment} rules={[{ required: !field.nullable }]}>{field.type === "File" ? <FileInput name={field.name} resource={resource.name} resourceId={id} /> : field.relation ? <RelationSelect relation={field.relation} /> : field.enumValues ? <Select options={field.enumValues.map((item) => ({ value: item.name, label: <EnumLabel item={item} /> }))} /> : field.type === "Integer" ? <InputNumber style={{ width: "100%" }} /> : <Input />}</Form.Item>)}
    </Form>
  </>;
  return id
    ? <Edit resource={resource.name} recordItemId={id} title={`${t(locale, "edit")} ${resource.label}`} saveButtonProps={saveButtonProps}>{content}</Edit>
    : <Create resource={resource.name} title={`${t(locale, "new")} ${resource.label}`} saveButtonProps={saveButtonProps}>{content}</Create>;
}
