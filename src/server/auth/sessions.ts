import "server-only";
import { db } from "@/server/db";
import { AUTH_CONFIG } from "./config";
import { generateSessionToken, hashToken } from "./tokens";

export interface SessionUser {
  id: string;
  email: string;
  username: string;
}

export interface ValidatedSession {
  sessionId: string;
  expiresAt: Date;
  user: SessionUser;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + AUTH_CONFIG.sessionTtlMs);
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string): Promise<ValidatedSession | null> {
  if (!token || token.length > 128) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, username: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  if (now - session.lastUsedAt.getTime() > AUTH_CONFIG.lastUsedWriteIntervalMs) {
    await db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(now) } });
  }

  return { sessionId: session.id, expiresAt: session.expiresAt, user: session.user };
}

export async function invalidateSessionToken(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function invalidateAllUserSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}
