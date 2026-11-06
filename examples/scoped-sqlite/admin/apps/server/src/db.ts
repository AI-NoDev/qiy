import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const filename = Bun.env.DATABASE_URL ?? "./qiy.sqlite";
export const client = new Database(filename);
// SQLite leaves foreign keys unenforced unless every connection opts in.
client.exec("PRAGMA foreign_keys = ON");
export const db = drizzle(client, { schema });
