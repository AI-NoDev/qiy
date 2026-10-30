import { Create, Edit, useForm } from "@refinedev/antd";
import { Alert, Button, Form, Input, InputNumber, Select, Switch, Space, Tag, Typography, Upload } from "antd";
import { canSeeField, createFormFields, editFormFields, generatedFormFields, type ResourceDefinition, type ResourceEnumValue, type ResourceField } from "../resources";
import { qiyIcons } from "../icons";
import { useGetIdentity, useTranslation } from "@refinedev/core";
import { isDateFieldType } from "../date-fields";
import { RelationSelect } from "./relation-field";
import { DateFieldInput } from "./date-field";

function EnumLabel({ item }: { item: ResourceEnumValue }) {
  const { translate } = useTranslation();
  const Icon = item.icon ? qiyIcons[item.icon as keyof typeof qiyIcons] : undefined;
  const comment = item.commentKey ? translate(item.commentKey, {}, item.comment) : item.comment;
  return <Space title={comment}>{Icon && <Icon />}{translate(item.labelKey, {}, item.label ?? item.name)}</Space>;
}

async function encodeBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

function FileInput({ field, resource, resourceId }: { field: ResourceField; resource: string; resourceId?: string }) {
  const form = Form.useFormInstance();
  const { translate } = useTranslation();
  const mimeTypes = field.mimeTypes ?? ["*/*"]; const maxBytes = field.maxBytes ?? 25 * 1024 * 1024; const uploadMode = field.uploadMode ?? "binary";
  const multiple = field.type === "Files";
  const maxFiles = multiple ? field.maxFiles ?? 6 : 1;
  const watched = Form.useWatch(field.name, form) as unknown;
  const keys: string[] = multiple
    ? (Array.isArray(watched) ? watched.map(String).filter(Boolean) : [])
    : (typeof watched === "string" && watched ? [watched] : []);
  const send = async (file: File): Promise<string> => {
    const token = typeof window === "undefined" ? undefined : window.localStorage.getItem("qiy.access_token");
    const key = `uploads/${crypto.randomUUID()}-${String(file.name ?? "file").replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
    const params = new URLSearchParams({ key, fileName: String(file.name ?? "file"), resource, field: field.name });
    if (resourceId) params.set("resourceId", resourceId);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = uploadMode === "base64"
      ? await fetch("/api/v1/files/base64", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ key, fileName: String(file.name ?? "file"), resource, field: field.name, ...(resourceId ? { resourceId } : {}), contentType: file.type || "application/octet-stream", data: await encodeBase64(file) }) })
      : await fetch(`/api/v1/files?${params}`, { method: "POST", body: file, headers });
    if (!response.ok) throw new Error(translate("qiy.uploadFailed", { status: response.status }));
    return key;
  };
  const setKeys = (next: string[]) => form.setFieldValue(field.name, multiple ? next : next[0]);
  return <Space direction="vertical" style={{ width: "100%" }}>
    <Upload multiple={multiple} maxCount={maxFiles} accept={mimeTypes.includes("*/*") ? undefined : mimeTypes.join(",")} showUploadList={false} beforeUpload={(file) => {
      const accepted = mimeTypes.some((mime) => mime === "*/*" || mime === file.type || (mime.endsWith("/*") && file.type.startsWith(mime.slice(0, -1))));
      if (!accepted || file.size > maxBytes || keys.length >= maxFiles) return Upload.LIST_IGNORE;
      return true;
    }} customRequest={async ({ file, onError, onSuccess }) => {
      try {
        const key = await send(file as File);
        setKeys(multiple ? [...keys, key] : [key]);
        onSuccess?.({ key });
      } catch (error) { onError?.(error as Error); }
    }}><Button>{translate("qiy.upload", {}, multiple ? "Add files" : "Upload file")}</Button></Upload>
    {multiple && keys.length > 0 && <Space wrap>{keys.map((key) => <Tag key={key} closable onClose={() => setKeys(keys.filter((item) => item !== key))}>{key.split("/").pop()}</Tag>)}</Space>}
  </Space>;
}

export function ResourceForm({ resource, id }: { resource: ResourceDefinition; id?: string }) {
  const { data: identity } = useGetIdentity<{ role?: string }>();
  const { translate } = useTranslation();
  // Generated values (@code / @generated / system UUIDs) are rendered by the
  // server: the create form hides them, the edit form shows them read-only, and
  // neither form submits them. List/show pages render the stored value normally.
  const generatedFields = generatedFormFields(resource);
  const fields = (id ? editFormFields(resource) : createFormFields(resource)).filter((field) => canSeeField(field, identity?.role));
  const generatedNames = id ? new Set(generatedFields.map((field) => field.name)) : new Set<string>();
  const autoGeneratedHint = translate("qiy.autoGenerated", {}, "This value is generated automatically by the server.");
  // Picker placeholders are form chrome, so they are translated instead of being
  // hardcoded English; DateFieldInput otherwise falls back to the format string.
  const temporalPlaceholders = {
    Date: translate("qiy.pickDate", {}, "Select date"),
    Time: translate("qiy.pickTime", {}, "Select time"),
    DateTime: translate("qiy.pickDateTime", {}, "Select date and time"),
  } as const;
  // Create/edit titles and buttons use the entity's singular name (`@singular`),
  // falling back to the resource label so models without the annotation keep working.
  const singular = translate(resource.singularKey, {}, translate(resource.labelKey, {}, resource.singular));
  const { formProps, saveButtonProps, query, onFinish } = useForm<Record<string, unknown>>({ resource: resource.name, id, action: id ? "edit" : "create", redirect: "list" });
  const content = <>
    {query?.isError && <Alert type="error" showIcon message={String(query.error)} />}
    <Form {...formProps} layout="vertical" validateMessages={{ required: translate("qiy.requiredWithLabel", {}, "${label} is required") }} style={{ maxWidth: 720 }} onFinish={(values) => { const record = values as Record<string, unknown>; return onFinish(Object.fromEntries(fields.flatMap((field) => { if (generatedNames.has(field.name)) return []; const value = record[field.name]; return (value === undefined || value === null || value === "") && field.nullable ? [] : [[field.name, field.type === "Integer" ? Number(value) : value]]; }))); }}>
      {fields.map((field) => field.autoGenerated
        ? <Form.Item key={field.name} name={field.name} label={translate(field.labelKey, {}, field.label)} tooltip={autoGeneratedHint}><Input disabled /></Form.Item>
        : <Form.Item key={field.name} name={field.name} label={translate(field.labelKey, {}, field.label)} tooltip={field.commentKey ? translate(field.commentKey, {}, field.comment) : field.comment} rules={[{ required: !field.nullable }]}>{field.type === "File" || field.type === "Files" ? <FileInput field={field} resource={resource.name} resourceId={id} /> : field.relation ? <RelationSelect relation={field.relation} fieldName={field.name} /> : field.enumValues ? <Select options={field.enumValues.map((item) => ({ value: item.name, label: <EnumLabel item={item} /> }))} /> : isDateFieldType(field.type) ? <DateFieldInput type={field.type} placeholder={temporalPlaceholders[field.type]} /> : field.type === "Integer" ? <InputNumber style={{ width: "100%" }} /> : field.type === "Boolean" ? <Switch /> : <Input />}</Form.Item>)}
      {generatedFields.length > 0 && <Typography.Text type="secondary">{autoGeneratedHint}</Typography.Text>}
    </Form>
  </>;
  return id
    ? <Edit resource={resource.name} recordItemId={id} title={translate("qiy.editResource", { resource: singular }, "Edit " + singular)} saveButtonProps={saveButtonProps}>{content}</Edit>
    : <Create resource={resource.name} title={translate("qiy.createResource", { resource: singular }, "Create " + singular)} saveButtonProps={saveButtonProps}>{content}</Create>;
}
