import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { AUTH_CONFIG } from "./config";
import { type SessionUser, validateSessionToken } from "./sessions";

/** Lee y valida la sesión una sola vez por petición. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(AUTH_CONFIG.sessionCookieName)?.value;
  if (!token) return null;
  const session = await validateSessionToken(token);
  return session?.user ?? null;
});

/** Protege una página o acción privada: redirige a /login si no hay sesión. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(AUTH_CONFIG.sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(AUTH_CONFIG.sessionCookieName);
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(AUTH_CONFIG.sessionCookieName)?.value;
}

/** IP del cliente según la cabecera que fija Vercel. Solo se usa para limitar intentos. */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
