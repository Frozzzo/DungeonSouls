import "server-only";
import type { AuthAttemptKind } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { hashToken } from "./tokens";

/**
 * Limitador basado en Postgres: funciona igual con una o muchas instancias de Vercel,
 * porque el contador vive en la base de datos y no en memoria.
 * Las claves se guardan con hash para no almacenar correos ni IPs en claro.
 */
export function rateLimitKey(scope: "email" | "ip", value: string): string {
  return `${scope}:${hashToken(value.toLowerCase())}`;
}

export async function countRecentAttempts(
  kind: AuthAttemptKind,
  key: string,
  windowMs: number,
  onlyFailures: boolean,
): Promise<number> {
  return db.authAttempt.count({
    where: {
      kind,
      key,
      createdAt: { gte: new Date(Date.now() - windowMs) },
      ...(onlyFailures ? { success: false } : {}),
    },
  });
}

export async function recordAttempts(kind: AuthAttemptKind, keys: string[], success: boolean): Promise<void> {
  await db.authAttempt.createMany({ data: keys.map((key) => ({ kind, key, success })) });
  // Limpieza oportunista de registros antiguos (más de 1 día) para que la tabla no crezca sin límite.
  if (Math.random() < 0.05) {
    await db.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  }
}
