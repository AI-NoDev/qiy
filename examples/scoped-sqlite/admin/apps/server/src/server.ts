import { resolve } from "node:path";
import { createApp } from "./app";
import { createHandler } from "./http";

import { RecordsRepository } from "./modules/records/records.repository";

if (Bun.env.QIY_DEV_MODE !== "1") {
  throw new Error("Unauthenticated V0 admin API is disabled: set QIY_DEV_MODE=1 for local development only");
}

if (Bun.env.QIY_STORAGE_METADATA !== "database") throw new Error("QIY_STORAGE_METADATA=database is required for production file metadata");
const app = await createApp({ records: RecordsRepository }, async () => ({ id: "dev", name: "Local Admin", role: "admin" }));
const clientRoot = resolve(import.meta.dir, "../../web/build/client");
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(Bun.env.PORT ?? 3000), fetch: createHandler((request) => app.handle(request), clientRoot) });
console.log(`Qiy app listening on http://localhost:${server.port}`);
