import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { LoginInput, RegisterInput } from "@/lib/validation/auth";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { AUTH_CONFIG } from "./config";
import { getDummyHash, hashPassword, verifyPassword } from "./password";
import { countRecentAttempts, rateLimitKey, recordAttempts } from "./rate-limit";

const { rateLimits } = AUTH_CONFIG;

export async function registerUser(input: RegisterInput, ip: string): Promise<{ userId: string }> {
  const ipKey = rateLimitKey("ip", ip);
  const attempts = await countRecentAttempts("REGISTER", ipKey, rateLimits.registerPerIp.windowMs, false);
  if (attempts >= rateLimits.registerPerIp.max) {
    throw new DomainError("RATE_LIMITED", "Demasiados registros desde esta conexión. Inténtalo más tarde.");
  }
  await recordAttempts("REGISTER", [ipKey], true);

  const passwordHash = await hashPassword(input.password);
  try {
    const user = await db.user.create({
      data: {
        email: input.email,
        username: input.username,
        usernameKey: input.username.toLowerCase(),
        passwordHash,
      },
      select: { id: true },
    });
    return { userId: user.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Mensaje genérico: no revela si el correo o el usuario ya existen por separado.
      throw new DomainError("ACCOUNT_EXISTS", "Ese correo o nombre de usuario ya está en uso.");
    }
    throw error;
  }
}

export async function authenticateUser(input: LoginInput, ip: string): Promise<{ userId: string }> {
  const emailKey = rateLimitKey("email", input.email);
  const ipKey = rateLimitKey("ip", ip);
  const [emailFailures, ipFailures] = await Promise.all([
    countRecentAttempts("LOGIN", emailKey, rateLimits.loginPerEmail.windowMs, true),
    countRecentAttempts("LOGIN", ipKey, rateLimits.loginPerIp.windowMs, true),
  ]);
  if (emailFailures >= rateLimits.loginPerEmail.max || ipFailures >= rateLimits.loginPerIp.max) {
    throw new DomainError("RATE_LIMITED", "Demasiados intentos fallidos. Espera unos minutos.");
  }

  const user = await db.user.findUnique({ where: { email: input.email }, select: { id: true, passwordHash: true } });
  const valid = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));

  if (!user || !valid) {
    await recordAttempts("LOGIN", [emailKey, ipKey], false);
    throw new DomainError("INVALID_CREDENTIALS", "Correo o contraseña incorrectos.");
  }
  await recordAttempts("LOGIN", [emailKey, ipKey], true);
  return { userId: user.id };
}
