import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../schema";
import { hashPassword } from "./password";

const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  if ((await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1)).length) throw new Error("An admin account already exists");
  const username = (await terminal.question("email: ")).trim();
  if (!username) throw new Error("Username is required");
  
  const password = await terminal.question("Password (minimum 8 characters): ");
  const values = { "email": username, "role": "admin", "passwordHash": await hashPassword(password), "subject": "local:" + username,  };
  await db.insert(users).values({ ...values, id: crypto.randomUUID() } as typeof users.$inferInsert);
  console.log("Initial admin account created for " + username);
} finally { terminal.close(); }
