import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import { allocateStatsSchema, createCharacterSchema } from "@/lib/validation/character";

describe("validación de autenticación", () => {
  it("normaliza el correo", () => {
    const r = loginSchema.parse({ email: "  Heroe@Example.COM ", password: "x" });
    expect(r.email).toBe("heroe@example.com");
  });

  it("exige contraseñas coincidentes y de longitud mínima", () => {
    const base = { email: "a@b.co", username: "heroe_1" };
    expect(registerSchema.safeParse({ ...base, password: "corta", confirmPassword: "corta" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "suficientemente-larga", confirmPassword: "otra-distinta-x" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "suficientemente-larga", confirmPassword: "suficientemente-larga" }).success).toBe(true);
  });

  it("rechaza nombres de usuario con caracteres no permitidos", () => {
    const r = registerSchema.safeParse({ email: "a@b.co", username: "<script>", password: "1234567890", confirmPassword: "1234567890" });
    expect(r.success).toBe(false);
  });
});

describe("validación de personajes", () => {
  it("acepta nombres con acentos y normaliza espacios", () => {
    const r = createCharacterSchema.parse({ name: "  Ñandú   el  Bravo ", classId: "TANK" });
    expect(r.name).toBe("Ñandú el Bravo");
  });

  it("rechaza clases inexistentes y nombres inválidos", () => {
    expect(createCharacterSchema.safeParse({ name: "Valido", classId: "MAGE" }).success).toBe(false);
    expect(createCharacterSchema.safeParse({ name: "1abc", classId: "DPS" }).success).toBe(false);
    expect(createCharacterSchema.safeParse({ name: "ab", classId: "DPS" }).success).toBe(false);
  });

  it("convierte los puntos del formulario y rechaza negativos", () => {
    const ok = allocateStatsSchema.parse({ characterId: "c1", strength: "2", dexterity: "0", intelligence: "1", vitality: "0" });
    expect(ok.strength).toBe(2);
    expect(allocateStatsSchema.safeParse({ characterId: "c1", strength: "-1", dexterity: 0, intelligence: 0, vitality: 0 }).success).toBe(false);
  });
});
