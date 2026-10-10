import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const filename = Bun.env.DATABASE_URL ?? "./qiy.sqlite";
export const client = new Database(filename);
export const db = drizzle(client, { schema });
