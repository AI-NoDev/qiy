import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../schema";
import { hashPassword } from "./password";

const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const username = (await terminal.question("Username or email: ")).trim();
  const password = await terminal.question("New password (minimum 8 characters): ");
  const passwordHash = await hashPassword(password);
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, username)).limit(2);
  if (rows.length !== 1) throw new Error("Expected exactly one matching user");
  await db.update(users).set({ passwordHash: passwordHash }).where(eq(users.id, rows[0]!.id));
  console.log("Password updated for " + username);
} finally { terminal.close(); }
