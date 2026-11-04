import { describe, expect, it } from "vitest";
import { CLASS_DEFINITIONS } from "@/game/classes/definitions";
import { getBaseItem } from "@/game/items/bases";
import { CONSUMABLES, dismantleYield, potionsForRun } from "@/game/items/consumables";
import { checkEquipItem, emptyGear, gearBonus, itemBonus, slotsForCategory } from "@/game/items/equipment";
import { SKILL_DEFINITIONS, STARTER_SKILLS, skillsForClass } from "@/game/skills/definitions";
import { buildLoadout, checkEquipSkill, checkLearn, MAX_EQUIPPED_SKILLS, resolveSkill, skillCooldown } from "@/game/skills/rules";
import { computeCharacterStats } from "@/game/stats/compute";
import { CLASS_IDS, type ClassId, zeroAttributes } from "@/game/types";

const learner = (classId: ClassId, level: number, skillPoints: number, learned: Record<string, number> = {}) => ({ classId, level, skillPoints, learned });

describe("árbol de habilidades: definiciones", () => {
  it("cada clase tiene 3 ramas con habilidades básicas y al menos una definitiva, y la inicial es básica de nivel 1", () => {
    for (const classId of CLASS_IDS) {
      const skills = skillsForClass(classId);
      const branches = CLASS_DEFINITIONS[classId].skillBranches.map((b) => b.id);
      expect(branches).toHaveLength(3);
      for (const b of branches) expect(skills.filter((s) => s.branchId === b && s.kind === "BASIC").length, b).toBeGreaterThanOrEqual(2);
      expect(skills.filter((s) => s.kind === "ULTIMATE").length).toBeGreaterThanOrEqual(1);
      const starter = skills.find((s) => s.id === STARTER_SKILLS[classId])!;
      expect(starter).toMatchObject({ kind: "BASIC", requiredLevel: 1, requires: [] });
    }
  });

  it("ids únicos, ramas válidas y requisitos que existen en la misma clase y son alcanzables", () => {
    const ids = new Set(SKILL_DEFINITIONS.map((s) => s.id));
    expect(ids.size).toBe(SKILL_DEFINITIONS.length);
    for (const s of SKILL_DEFINITIONS) {
      expect(CLASS_DEFINITIONS[s.classId].skillBranches.some((b) => b.id === s.branchId), s.id).toBe(true);
      for (const r of s.requires) {
        const req = SKILL_DEFINITIONS.find((x) => x.id === r.skillId);
        expect(req?.classId, `${s.id} requiere ${r.skillId}`).toBe(s.classId);
        expect(r.rank).toBeLessThanOrEqual(req!.maxRank);
      }
    }
  });

  it("el enfriamiento nunca llega a 0 ni baja del mínimo, en ningún rango", () => {
    for (const s of SKILL_DEFINITIONS) {
      expect(s.minCooldown, s.id).toBeGreaterThan(0);
      let previous = Infinity;
      for (let rank = 1; rank <= s.maxRank + 3; rank++) {
        const cd = skillCooldown(s, rank);
        expect(cd, `${s.id} rango ${rank}`).toBeGreaterThan(0);
        expect(cd).toBeGreaterThanOrEqual(s.minCooldown);
        expect(cd).toBeLessThanOrEqual(previous);
        previous = cd;
      }
      expect(resolveSkill(s.id, 999, s.classId)!.cooldown).toBeGreaterThan(0);
    }
  });

  it("los rangos mejoran la magnitud con tope en el rango máximo", () => {
    const r1 = resolveSkill("dps-whirlwind", 1, "DPS")!;
    const r3 = resolveSkill("dps-whirlwind", 3, "DPS")!;
    const r9 = resolveSkill("dps-whirlwind", 9, "DPS")!;
    const mult = (s: typeof r1) => (s.effects[0].kind === "NOVA" ? s.effects[0].multiplier : 0);
    expect(mult(r3)).toBeGreaterThan(mult(r1));
    expect(r9.rank).toBe(5);
    expect(resolveSkill("dps-whirlwind", 1, "TANK")).toBeNull();
    expect(resolveSkill("no-existe", 1, "DPS")).toBeNull();
  });
});

describe("árbol de habilidades: aprender y mejorar", () => {
  it("aprender cuesta puntos y respeta clase, nivel y requisitos", () => {
    expect(checkLearn(learner("TANK", 1, 1), "tank-challenging-shout")).toEqual({ ok: true, nextRank: 1, cost: 1 });
    expect(checkLearn(learner("TANK", 1, 0), "tank-challenging-shout")).toEqual({ ok: false, error: "NOT_ENOUGH_POINTS" });
    expect(checkLearn(learner("TANK", 5, 3), "dps-rend")).toEqual({ ok: false, error: "WRONG_CLASS" });
    expect(checkLearn(learner("TANK", 1, 3), "tank-iron-ward")).toEqual({ ok: false, error: "LEVEL_TOO_LOW" });
    // Embate de escudo exige Grito desafiante R1.
    expect(checkLearn(learner("TANK", 3, 3), "tank-shield-bash")).toEqual({ ok: false, error: "MISSING_REQUIREMENT" });
    expect(checkLearn(learner("TANK", 3, 3, { "tank-challenging-shout": 1 }), "tank-shield-bash").ok).toBe(true);
    expect(checkLearn(learner("TANK", 3, 3), "nada")).toEqual({ ok: false, error: "UNKNOWN_SKILL" });
  });

  it("la mejora tiene tope: en el rango máximo ya no se puede subir", () => {
    const def = SKILL_DEFINITIONS.find((s) => s.id === "dps-rend")!;
    const learned: Record<string, number> = {};
    let points = 20;
    for (let i = 0; i < def.maxRank; i++) {
      const check = checkLearn(learner("DPS", 10, points, learned), def.id);
      expect(check.ok).toBe(true);
      if (check.ok) {
        learned[def.id] = check.nextRank;
        points -= check.cost;
      }
    }
    expect(learned[def.id]).toBe(def.maxRank);
    expect(checkLearn(learner("DPS", 10, points, learned), def.id)).toEqual({ ok: false, error: "MAX_RANK" });
  });
});

describe("árbol de habilidades: equipar (3 básicas + 1 definitiva)", () => {
  const learnedAll = Object.fromEntries(skillsForClass("DPS").map((s) => [s.id, 1]));

  it("las definitivas solo van en su hueco y las básicas en los otros", () => {
    const ctx = { classId: "DPS" as const, learned: learnedAll };
    expect(checkEquipSkill(ctx, "dps-blade-storm", "ULTIMATE").ok).toBe(true);
    expect(checkEquipSkill(ctx, "dps-blade-storm", "BASIC_1")).toEqual({ ok: false, error: "WRONG_SLOT" });
    expect(checkEquipSkill(ctx, "dps-rend", "ULTIMATE")).toEqual({ ok: false, error: "WRONG_SLOT" });
    expect(checkEquipSkill({ classId: "DPS", learned: {} }, "dps-rend", "BASIC_1")).toEqual({ ok: false, error: "NOT_LEARNED" });
    expect(checkEquipSkill(ctx, "tank-bulwark", "BASIC_1")).toEqual({ ok: false, error: "WRONG_CLASS" });
  });

  it("como máximo 4 equipadas, sin repetir y descartando lo inválido", () => {
    const loadout = buildLoadout("DPS", learnedAll, [
      { slot: "BASIC_1", skillId: "dps-rend" },
      { slot: "BASIC_2", skillId: "dps-rend" }, // repetida
      { slot: "BASIC_2", skillId: "dps-whirlwind" },
      { slot: "BASIC_3", skillId: "dps-blade-storm" }, // definitiva en hueco básico
      { slot: "ULTIMATE", skillId: "dps-blade-storm" },
      { slot: "ULTIMATE", skillId: "dps-death-sentence" }, // hueco ocupado
      { slot: "BASIC_1", skillId: "tank-bulwark" }, // otra clase
    ]);
    expect(loadout).toHaveLength(MAX_EQUIPPED_SKILLS);
    expect(loadout.map((e) => e?.skillId ?? null)).toEqual(["dps-rend", "dps-whirlwind", null, "dps-blade-storm"]);
  });
});

describe("equipo: estadísticas y restricciones", () => {
  it("las armas suman daño, las armaduras armadura y los afijos atributos y crítico", () => {
    const weapon = itemBonus({ baseItemId: "twin-shivs", rarity: "RARE", itemLevel: 2, affixes: [{ id: "DEXTERITY", value: 5 }, { id: "CRIT_CHANCE", value: 3 }] });
    expect(weapon.weaponDamage).toBeGreaterThan(0);
    expect(weapon.attributes.dexterity).toBe(5);
    expect(weapon.critChance).toBeCloseTo(0.03);
    const helm = itemBonus({ baseItemId: "chain-coif", rarity: "COMMON", itemLevel: 1, affixes: [{ id: "ARMOR", value: 4 }] });
    expect(helm.armor).toBe(5 + 4);
    expect(itemBonus({ baseItemId: "desconocido", rarity: "COMMON", itemLevel: 1, affixes: [] })).toEqual(emptyGear());
  });

  it("el equipo cambia las estadísticas derivadas con las fórmulas únicas", () => {
    const allocated = zeroAttributes();
    const naked = computeCharacterStats({ classId: "DPS", level: 3, allocated });
    const gear = gearBonus([
      { baseItemId: "twin-shivs", rarity: "EPIC", itemLevel: 3, affixes: [{ id: "VITALITY", value: 6 }, { id: "CRIT_CHANCE", value: 4 }] },
      { baseItemId: "brigandine", rarity: "COMMON", itemLevel: 1, affixes: [] },
    ]);
    const dressed = computeCharacterStats({ classId: "DPS", level: 3, allocated, gear });
    expect(dressed.derived.physicalDamage).toBeGreaterThan(naked.derived.physicalDamage);
    expect(dressed.derived.armor).toBeGreaterThan(naked.derived.armor);
    expect(dressed.derived.maxHealth).toBeGreaterThan(naked.derived.maxHealth);
    expect(dressed.derived.critChance).toBeCloseTo(naked.derived.critChance + 0.04, 4);
  });

  it("restricciones de clase, nivel y hueco", () => {
    const robe = getBaseItem("mystic-robe");
    const plate = getBaseItem("plate-cuirass");
    const ring = getBaseItem("bone-ring");
    expect(checkEquipItem({ classId: "TANK", level: 1 }, robe, "CHEST")).toEqual({ ok: false, error: "WRONG_CLASS" });
    expect(checkEquipItem({ classId: "TANK", level: 1 }, plate, "CHEST")).toEqual({ ok: true });
    expect(checkEquipItem({ classId: "TANK", level: 1 }, plate, "HELMET")).toEqual({ ok: false, error: "WRONG_SLOT" });
    expect(checkEquipItem({ classId: "HEALER", level: 1 }, plate, "CHEST")).toEqual({ ok: false, error: "WRONG_CLASS" });
    expect(checkEquipItem({ classId: "DPS", level: 1 }, ring, "ACCESSORY_2")).toEqual({ ok: true });
    expect(checkEquipItem({ classId: "DPS", level: 0 }, ring, "ACCESSORY_1")).toEqual({ ok: false, error: "LEVEL_TOO_LOW" });
    expect(slotsForCategory("ACCESSORY")).toEqual(["ACCESSORY_1", "ACCESSORY_2"]);
    expect(checkEquipItem({ classId: "DPS", level: 1 }, undefined, "WEAPON")).toEqual({ ok: false, error: "UNKNOWN_ITEM" });
  });
});

describe("consumibles y desmontaje", () => {
  it("las pociones por piso están limitadas y el enfriamiento es > 0", () => {
    expect(potionsForRun(0)).toBe(0);
    expect(potionsForRun(2)).toBe(2);
    expect(potionsForRun(99)).toBe(CONSUMABLES.HEALTH_POTION.perRun);
    expect(CONSUMABLES.HEALTH_POTION.cooldown).toBeGreaterThan(0);
  });

  it("desmontar da más material cuanto mayor es la rareza", () => {
    expect(dismantleYield("COMMON", 1)).toBeGreaterThan(0);
    expect(dismantleYield("MYTHIC", 1)).toBeGreaterThan(dismantleYield("RARE", 1));
    expect(dismantleYield("RARE", 5)).toBeGreaterThan(dismantleYield("RARE", 1));
  });
});
