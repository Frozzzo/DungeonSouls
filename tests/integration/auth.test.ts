import { beforeEach, describe, expect, it } from "vitest";
import { AUTH_CONFIG } from "@/server/auth/config";
import { authenticateUser, registerUser } from "@/server/auth/service";
import { createSession, invalidateSessionToken, validateSessionToken } from "@/server/auth/sessions";
import { hashToken } from "@/server/auth/tokens";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { registerSchema } from "@/lib/validation/auth";
import { resetDatabase, uniqueUser } from "./helpers";

beforeEach(resetDatabase);

describe("registro e inicio de sesión", () => {
  it("registra un usuario sin guardar la contraseña en claro", async () => {
    const input = registerSchema.parse(uniqueUser());
    const { userId } = await registerUser(input, "1.1.1.1");
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.email).toBe(input.email);
    expect(user.passwordHash).not.toContain(input.password);
  });

  it("no permite correos ni nombres de usuario duplicados (sin distinguir mayúsculas)", async () => {
    const input = registerSchema.parse(uniqueUser());
    await registerUser(input, "1.1.1.1");
    await expect(registerUser({ ...input, username: "otro_nombre" }, "1.1.1.2")).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
    await expect(
      registerUser({ ...input, email: "otro@example.test", username: input.username.toUpperCase() }, "1.1.1.3"),
    ).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
  });

  it("inicia sesión con credenciales válidas y rechaza las inválidas con el mismo mensaje", async () => {
    const input = registerSchema.parse(uniqueUser());
    const { userId } = await registerUser(input, "2.2.2.2");
    await expect(authenticateUser({ email: input.email, password: input.password }, "2.2.2.2")).resolves.toEqual({ userId });

    const wrongPassword = await authenticateUser({ email: input.email, password: "mala-contraseña" }, "2.2.2.2").catch((e) => e);
    const unknownUser = await authenticateUser({ email: "nadie@example.test", password: "x" }, "2.2.2.2").catch((e) => e);
    expect(wrongPassword).toBeInstanceOf(DomainError);
    expect(wrongPassword.message).toBe(unknownUser.message);
  });

  it("bloquea tras demasiados intentos fallidos para un mismo correo", async () => {
    const input = registerSchema.parse(uniqueUser());
    await registerUser(input, "3.3.3.3");
    for (let i = 0; i < AUTH_CONFIG.rateLimits.loginPerEmail.max; i++) {
      await expect(authenticateUser({ email: input.email, password: "incorrecta" }, `10.0.0.${i}`)).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    }
    // Incluso con la contraseña correcta, el límite sigue activo.
    await expect(authenticateUser({ email: input.email, password: input.password }, "10.0.0.99")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("limita los registros por IP", async () => {
    for (let i = 0; i < AUTH_CONFIG.rateLimits.registerPerIp.max; i++) {
      await registerUser(registerSchema.parse(uniqueUser(`r${i}`)), "4.4.4.4");
    }
    await expect(registerUser(registerSchema.parse(uniqueUser("extra")), "4.4.4.4")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("sesiones", () => {
  it("crea, valida y cierra sesiones guardando solo el hash del token", async () => {
    const { userId } = await registerUser(registerSchema.parse(uniqueUser()), "5.5.5.5");
    const { token } = await createSession(userId);

    const stored = await db.session.findFirstOrThrow({ where: { userId } });
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(stored.tokenHash).not.toBe(token);

    const session = await validateSessionToken(token);
    expect(session?.user.id).toBe(userId);

    await invalidateSessionToken(token);
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("rechaza tokens caducados o inventados", async () => {
    const { userId } = await registerUser(registerSchema.parse(uniqueUser()), "6.6.6.6");
    const { token } = await createSession(userId);
    await db.session.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(token)).toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await validateSessionToken("inventado")).toBeNull();
  });
});
