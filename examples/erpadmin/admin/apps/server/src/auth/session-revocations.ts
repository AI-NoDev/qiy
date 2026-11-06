import { eq } from "drizzle-orm";
import { db } from "../db";
import { qiySessionRevocations } from "../schema";

/** Invalidates every local-access token issued before the returned instant. */
export async function revokeUserSessions(userId: string): Promise<Date> {
  const revokedBefore = new Date();
  const rows = await db.select().from(qiySessionRevocations).where(eq(qiySessionRevocations.userId, userId)).limit(1);
  if (rows[0]) await db.update(qiySessionRevocations).set({ revokedBefore }).where(eq(qiySessionRevocations.userId, userId));
  else await db.insert(qiySessionRevocations).values({ userId, revokedBefore });
  return revokedBefore;
}

/** Checks a JWT iat (seconds) against the user's revocation watermark. */
export async function isSessionRevoked(userId: string, issuedAtSeconds: number): Promise<boolean> {
  const rows = await db.select().from(qiySessionRevocations).where(eq(qiySessionRevocations.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) return false;
  const before = row.revokedBefore instanceof Date ? row.revokedBefore : new Date(row.revokedBefore as number | string);
  return Number.isFinite(before.getTime()) && issuedAtSeconds * 1000 < before.getTime();
}
