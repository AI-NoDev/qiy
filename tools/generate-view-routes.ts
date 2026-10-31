import type { DatabaseIR } from "./database-ir";

/** Generates read-only REST list/detail routes for `view` declarations. */
export function renderViewRoutes(database: DatabaseIR, requiresAuth: boolean): string | undefined {
  const views = database.views ?? [];
  if (views.length === 0) return undefined;
  const imports = views.map((view) => `${view.name}`).join(", ");
  const routes = views.map((view) => {
    const hasId = view.columns.includes("id");
    const detail = hasId ? `
    .get("/${view.name}/:id", async ({ params, request, status }) => {
      ${requiresAuth ? "const principal = await authenticate(request);\n      if (!principal) return status(401, { error: \"Authentication required\" });" : ""}
      const [row] = await db.select().from(${view.name}).where(eq(${view.name}.id, params.id)).limit(1);
      return row ?? status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String() }) })` : "";
    return `    .get("/${view.name}", async ({ query, request, status }) => {
      ${requiresAuth ? "const principal = await authenticate(request);\n      if (!principal) return status(401, { error: \"Authentication required\" });" : ""}
      const page = Math.max(1, Math.floor(Number(query.page ?? 1)));
      const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize ?? 20))));
      const [data, totalRows] = await Promise.all([
        db.select().from(${view.name}).limit(pageSize).offset((page - 1) * pageSize),
        db.select({ count: count() }).from(${view.name}),
      ]);
      return { data, total: Number(totalRows[0]?.count ?? 0) };
    }, { query: t.Object({ page: t.Optional(t.Numeric({ minimum: 1 })), pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })) }) })${detail}`;
  }).join("\n");
  return `import { Elysia, t } from "elysia";
import { count, eq } from "drizzle-orm";
import { db } from "./db";
import { ${imports} } from "./schema";

type ViewAuthenticate = (request: Request) => Promise<unknown>;

export function createViewRoutes(authenticate: ViewAuthenticate) {
  return new Elysia({ prefix: "/api/v1" })
${routes};
}
`;
}
