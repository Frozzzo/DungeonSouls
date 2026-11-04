import { describe, expect, it } from "vitest";
import { armorReduction, mitigate, rollOutgoingDamage } from "@/game/combat/damage";
import { applyStatus, tickStatuses } from "@/game/combat/status";
import { emptyKills } from "@/game/simulation/create";
import { AFFIXES } from "@/game/items/affixes";
import { BASE_ITEMS, getBaseItem } from "@/game/items/bases";
import { canClassUse, generateFloorLoot } from "@/game/items/loot";
import { RARITIES, RARITY_IDS } from "@/game/items/rarities";
import { computeFloorXp, levelGapFactor } from "@/game/rewards/experience";
import { BALANCE } from "@/game/balance";
import { submitRunSchema } from "@/lib/validation/run";
import { affixesSchema } from "@/lib/validation/items";

describe("daño y mitigación", () => {
  it("la variación queda en ±10 % y el crítico multiplica", () => {
    expect(rollOutgoingDamage(100, 1, 0, 2, 0, 0.99)).toEqual({ amount: 90, crit: false });
    expect(rollOutgoingDamage(100, 1, 0, 2, 0.99999, 0.99).amount).toBe(110);
    expect(rollOutgoingDamage(100, 1, 0.5, 2, 0.5, 0.1)).toEqual({ amount: 200, crit: true });
  });

  it("la mitigación se combina multiplicativamente con techo global y daño mínimo 1", () => {
    expect(mitigate(100, [0.5])).toBe(50);
    expect(mitigate(100, [0.5, 0.5])).toBe(25);
    expect(mitigate(100, [0.9, 0.9, 0.9])).toBe(Math.round(100 * (1 - BALANCE.combat.maxTotalMitigation)));
    expect(mitigate(1, [0.99])).toBe(1);
    expect(armorReduction(1e9, 1)).toBe(BALANCE.derived.damageReduction.cap);
  });

  it("los estados se renuevan sin acumularse y caducan", () => {
    const list = [] as Parameters<typeof applyStatus>[0];
    applyStatus(list, "SLOW", 3);
    applyStatus(list, "SLOW", 2);
    expect(list).toEqual([{ id: "SLOW", ticks: 3, value: 0 }]);
    expect(tickStatuses(tickStatuses(tickStatuses(list)))).toEqual([]);
  });
});

describe("experiencia de piso", () => {
  const kills = { ...emptyKills(), STALKER: 3, ARCHER: 1 };
  it("suma enemigos, piso y jefe con escalado por profundidad", () => {
    const xp = computeFloorXp({ floor: 1, difficulty: "NORMAL", level: 1, kills, boss: null, bossDefeated: false });
    expect(xp).toMatchObject({ enemies: 3 * 12 + 14, boss: 0, clear: 20, levelFactor: 1, total: 70 });
    const boss = computeFloorXp({ floor: 5, difficulty: "NORMAL", level: 4, kills: emptyKills(), boss: "ASH_JAILER", bossDefeated: true });
    expect(boss.boss).toBe(260);
    const hard = computeFloorXp({ floor: 1, difficulty: "HARD", level: 1, kills, boss: null, bossDefeated: false });
    expect(hard.total).toBeGreaterThan(xp.total);
  });

  it("reduce la XP del contenido muy inferior al nivel del personaje, con mínimo", () => {
    expect(levelGapFactor(3, 1)).toBe(1);
    expect(levelGapFactor(5, 1)).toBeCloseTo(0.7);
    expect(levelGapFactor(60, 1)).toBe(BALANCE.rewards.minXpFactor);
  });
});

describe("botín", () => {
  it("es determinista y solo contiene objetos usables por la clase", () => {
    for (const classId of ["TANK", "DPS", "HEALER"] as const) {
      for (let seed = 1; seed < 200; seed++) {
        const a = generateFloorLoot({ seed, floor: 2, difficulty: "NORMAL", classId, boss: null });
        expect(a).toEqual(generateFloorLoot({ seed, floor: 2, difficulty: "NORMAL", classId, boss: null }));
        expect(a.length).toBeGreaterThanOrEqual(1);
        for (const drop of a) {
          const base = getBaseItem(drop.baseItemId)!;
          expect(canClassUse(classId, base)).toBe(true);
          expect(base.exclusiveTo).toBeUndefined();
          expect(affixesSchema.safeParse(drop.affixes).success).toBe(true);
          expect(drop.affixes).toHaveLength(RARITIES[drop.rarity].affixes);
        }
      }
    }
  });

  it("el jefe entrega su recompensa exclusiva (legendaria o mítica) y al menos un raro", () => {
    const loot = generateFloorLoot({ seed: 5, floor: 5, difficulty: "NORMAL", classId: "DPS", boss: "ASH_JAILER" });
    expect(loot[0].baseItemId).toBe("jailer-shackle");
    expect(["LEGENDARY", "MYTHIC"]).toContain(loot[0].rarity);
    expect(RARITY_IDS.indexOf(loot[1].rarity)).toBeGreaterThanOrEqual(RARITY_IDS.indexOf("RARE"));
  });

  it("la distribución de rarezas favorece lo común y la dificultad mejora las raras", () => {
    const count = (difficulty: "NORMAL" | "ABYSS") => {
      let rare = 0;
      let total = 0;
      for (let seed = 1; seed <= 3000; seed++) {
        for (const d of generateFloorLoot({ seed, floor: 3, difficulty, classId: "TANK", boss: null })) {
          total++;
          if (RARITY_IDS.indexOf(d.rarity) >= RARITY_IDS.indexOf("RARE")) rare++;
        }
      }
      return rare / total;
    };
    const normal = count("NORMAL");
    expect(normal).toBeGreaterThan(0.08);
    expect(normal).toBeLessThan(0.2);
    expect(count("ABYSS")).toBeGreaterThan(normal * 1.5);
  });

  it("los afijos respetan sus topes incluso a nivel muy alto", () => {
    for (let seed = 1; seed < 100; seed++) {
      for (const d of generateFloorLoot({ seed, floor: 500, difficulty: "ABYSS", classId: "HEALER", boss: null })) {
        for (const a of d.affixes) expect(a.value).toBeLessThanOrEqual(AFFIXES[a.id].max);
      }
    }
    expect(new Set(BASE_ITEMS.map((b) => b.id)).size).toBe(BASE_ITEMS.length);
  });
});

describe("validación del envío de una partida", () => {
  it("acepta solo intenciones y rechaza campos de resultado enviados por el cliente", () => {
    const ok = { runId: "abc", segments: [[10, 100, 0, 0, 0, 1]] };
    expect(submitRunSchema.safeParse(ok).success).toBe(true);
    expect(submitRunSchema.safeParse({ ...ok, xp: 99999 }).success).toBe(false);
    expect(submitRunSchema.safeParse({ runId: "abc", segments: [[10, 500, 0, 0, 0, 1]] }).success).toBe(false);
    expect(submitRunSchema.safeParse({ runId: "abc", segments: [[10, 0, 0, 0, 0, 256]] }).success).toBe(false);
    expect(submitRunSchema.safeParse({ runId: "abc", segments: [[10, 0, 0, 0, 0, 255]] }).success).toBe(true);
    expect(submitRunSchema.safeParse({ runId: "abc", segments: [[0, 0, 0, 0, 0, 0]] }).success).toBe(false);
    expect(submitRunSchema.safeParse({ runId: "abc", segments: [[24000, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0]] }).success).toBe(false);
  });
});
