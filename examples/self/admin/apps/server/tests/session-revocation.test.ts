import { expect, test } from "bun:test";
import { client } from "../src/db";
import { isSessionRevoked, revokeUserSessions } from "../src/auth/session-revocations";

const DDL = "CREATE TABLE qiy_session_revocations (userId TEXT PRIMARY KEY, revokedBefore INTEGER NOT NULL)";

test("revokes tokens issued before the revocation watermark", async () => {
  client.exec("DROP TABLE IF EXISTS qiy_session_revocations");
  client.exec(DDL);
  try {
    const userId = "00000000-0000-4000-8000-0000000000aa";
    const issuedAt = Math.floor(Date.now() / 1000) - 60;
    expect(await isSessionRevoked(userId, issuedAt)).toBe(false);
    const revokedBefore = await revokeUserSessions(userId);
    expect(await isSessionRevoked(userId, issuedAt)).toBe(true);
    expect(await isSessionRevoked(userId, Math.floor(revokedBefore.getTime() / 1000) + 60)).toBe(false);
  } finally {
    client.exec("DROP TABLE IF EXISTS qiy_session_revocations");
  }
});
