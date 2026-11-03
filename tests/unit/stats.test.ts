import { describe, expect, it } from "vitest";
import { BALANCE } from "@/game/balance";
import { CLASS_LIST } from "@/game/classes/definitions";
import { computeAttributes, computeCharacterStats, computeDerivedStats } from "@/game/stats/compute";
import { CLASS_IDS, zeroAttributes } from "@/game/types";

describe("computeAttributes", () => {
  it("nivel 1 sin asignar devuelve los atributos base de la clase", () => {
    for (const def of CLASS_LIST) {
      expect(computeAttributes({ classId: def.id, level: 1, allocated: zeroAttributes() })).toEqual(def.baseAttributes);
    }
  });

  it("suma crecimiento por nivel, puntos asignados y bonificaciones", () => {
    const attrs = computeAttributes({
      classId: "TANK",
      level: 3,
      allocated: { strength: 2, dexterity: 0, intelligence: 0, vitality: 1 },
      bonus: { strength: 0, dexterity: 5, intelligence: 0, vitality: 0 },
    });
    // base 14/7/5/16 + 2 niveles de crecimiento (2/1/0/3)
    expect(attrs).toEqual({ strength: 14 + 4 + 2, dexterity: 7 + 2 + 5, intelligence: 5, vitality: 16 + 6 + 1 });
  });

  it("aplica el techo total por atributo y limita el nivel al máximo", () => {
    const attrs = computeAttributes({
      classId: "DPS",
      level: 10_000,
      allocated: zeroAttributes(),
      bonus: { strength: 0, dexterity: 99_999, intelligence: 0, vitality: 0 },
    });
    expect(attrs.dexterity).toBe(BALANCE.attributes.maxTotalPerAttribute);
  });
});

describe("computeDerivedStats", () => {
  it("cada clase destaca en su rol a nivel 1", () => {
    const s = Object.fromEntries(
      CLASS_IDS.map((id) => [id, computeCharacterStats({ classId: id, level: 1, allocated: zeroAttributes() }).derived]),
    );
    expect(s.TANK.maxHealth).toBeGreaterThan(s.HEALER.maxHealth);
    expect(s.TANK.maxHealth).toBeGreaterThan(s.DPS.maxHealth);
    expect(s.TANK.damageReduction).toBeGreaterThan(s.DPS.damageReduction);
    expect(s.DPS.physicalDamage).toBeGreaterThan(s.TANK.physicalDamage);
    expect(s.DPS.critChance).toBeGreaterThan(s.TANK.critChance);
    expect(s.HEALER.healingPower).toBeGreaterThan(s.TANK.healingPower);
    expect(s.HEALER.magicDamage).toBeGreaterThan(s.TANK.magicDamage);
  });

  it("respeta los límites aunque los atributos sean extremos", () => {
    const huge = { strength: 600, dexterity: 600, intelligence: 600, vitality: 600 };
    for (const id of CLASS_IDS) {
      const d = computeDerivedStats(id, BALANCE.progression.maxLevel, huge);
      expect(d.damageReduction).toBeLessThanOrEqual(BALANCE.derived.damageReduction.cap);
      expect(d.critChance).toBeLessThanOrEqual(BALANCE.derived.crit.chanceCap);
      expect(d.critMultiplier).toBeLessThanOrEqual(BALANCE.derived.crit.multiplierCap);
      expect(d.healingPower).toBeLessThanOrEqual(BALANCE.derived.healingPower.cap);
      for (const value of Object.values(d)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("es determinista (cliente y servidor obtienen el mismo resultado)", () => {
    const input = { classId: "HEALER" as const, level: 7, allocated: { strength: 1, dexterity: 2, intelligence: 3, vitality: 4 } };
    expect(computeCharacterStats(input)).toEqual(computeCharacterStats(input));
  });

  it("más vitalidad implica más vida, y más inteligencia más maná para el Oráculo", () => {
    const base = computeCharacterStats({ classId: "HEALER", level: 1, allocated: zeroAttributes() }).derived;
    const vit = computeCharacterStats({ classId: "HEALER", level: 1, allocated: { ...zeroAttributes(), vitality: 5 } }).derived;
    const int = computeCharacterStats({ classId: "HEALER", level: 1, allocated: { ...zeroAttributes(), intelligence: 5 } }).derived;
    expect(vit.maxHealth).toBeGreaterThan(base.maxHealth);
    expect(int.maxResource).toBeGreaterThan(base.maxResource);
  });

  it("la furia del Guardián es fija (no escala con atributos)", () => {
    const a = computeCharacterStats({ classId: "TANK", level: 1, allocated: zeroAttributes() }).derived;
    const b = computeCharacterStats({ classId: "TANK", level: 20, allocated: { strength: 50, dexterity: 50, intelligence: 50, vitality: 50 } }).derived;
    expect(a.maxResource).toBe(b.maxResource);
  });
});
