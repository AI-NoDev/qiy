import { useLogList, useTranslation } from "@refinedev/core";
import { Alert, Card, Table } from "antd";
import { useState } from "react";

type AuditEntry = { id: string; action: string; createdAt: string; author: { id: string; name: string; deleted: boolean } | null };
export function AuditHistory({ resource, recordId }: { resource: string; recordId: string }) {
  const [page, setPage] = useState(1);
  const { translate } = useTranslation();
  const query = useLogList<{ data: AuditEntry[]; total: number }>({ resource, meta: { id: recordId, page, pageSize: 10 } });
  return <Card title={translate("audit.title", "Audit history")} style={{ marginTop: 16 }}>{query.error ? <Alert type="error" message={query.error.message} /> : <Table<AuditEntry> rowKey="id" loading={query.isLoading} dataSource={query.data?.data ?? []} pagination={{ current: page, pageSize: 10, total: query.data?.total ?? 0, showSizeChanger: false, onChange: setPage }} columns={[{ title: translate("audit.action", "Action"), dataIndex: "action" }, { title: translate("audit.author", "Author"), render: (_, row) => row.author?.name ?? translate("audit.system", "System") }, { title: translate("audit.time", "Time"), dataIndex: "createdAt" }]} />}</Card>;
}
