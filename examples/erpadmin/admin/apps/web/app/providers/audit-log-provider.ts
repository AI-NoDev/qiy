import type { AuditLogProvider } from "@refinedev/core";
import { qiyAuthToken } from "../auth";
import { resourceNames } from "../resources";

export function createAuditLogProvider(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch): AuditLogProvider {
  return {
    get: async ({ resource, meta, action, author }) => {
      if (!(resourceNames as readonly string[]).includes(resource)) throw new Error("Unknown audit resource");
      const params = new URLSearchParams({ resource, page: String(meta?.page ?? 1), pageSize: String(meta?.pageSize ?? 20) });
      if (meta?.id !== undefined) params.set("resourceId", String(meta.id));
      if (action) params.set("action", ({ create: resource + ".created", update: resource + ".updated", delete: resource + ".deleted" } as Record<string, string>)[action] ?? action);
      if (author?.id !== undefined) params.set("actorId", String(author.id));
      const token = qiyAuthToken();
      const response = await fetcher("/api/v1/audit-logs/?" + params, { headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.error ?? "Audit request failed"), { statusCode: response.status });
      return body;
    },
    create: async () => { throw new Error("Audit events are written in server transactions; client writes are disabled"); },
    update: async () => { throw new Error("Authoritative audit history is immutable"); },
  };
}
export const auditLogProvider = createAuditLogProvider();
