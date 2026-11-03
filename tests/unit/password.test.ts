import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { generateSessionToken, hashToken } from "@/server/auth/tokens";

describe("contraseñas", () => {
  it("verifica la contraseña correcta y rechaza la incorrecta", async () => {
    const hash = await hashPassword("correcta-caballo-batería");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain("correcta");
    expect(await verifyPassword("correcta-caballo-batería", hash)).toBe(true);
    expect(await verifyPassword("incorrecta", hash)).toBe(false);
  });

  it("usa sal aleatoria", async () => {
    expect(await hashPassword("misma-contraseña")).not.toBe(await hashPassword("misma-contraseña"));
  });

  it("rechaza hashes con formato inválido", async () => {
    expect(await verifyPassword("x", "md5$abc")).toBe(false);
  });
});

describe("tokens de sesión", () => {
  it("son aleatorios y se guardan con hash", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
  });
});
