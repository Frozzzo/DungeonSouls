import { beforeEach, describe, expect, it } from "vitest";
import { registerSchema } from "@/lib/validation/auth";
import { createCharacterSchema } from "@/lib/validation/character";
import { BALANCE } from "@/game/balance";
import { CONSUMABLES, dismantleYield } from "@/game/items/consumables";
import { MAX_TICKS } from "@/game/simulation/context";
import { STARTER_SKILLS } from "@/game/skills/definitions";
import { registerUser } from "@/server/auth/service";
import { createCharacter, deleteCharacter, getOwnedCharacter } from "@/server/characters/service";
import { db } from "@/server/db";
import { getRunForPlay, startRun, submitRun } from "@/server/dungeon/service";
import { craftPotion, dismantleItem, equipItem, unequipItem } from "@/server/equipment/service";
import { DomainError } from "@/server/errors";
import { listInventory } from "@/server/inventory/service";
import { equipSkill, getSkillTree, learnSkill } from "@/server/skills/service";
import { playWithBot } from "../support/sim";
import { resetDatabase, uniqueUser } from "./helpers";

let ip = 0;
async function newUser() {
  ip += 1;
  return (await registerUser(registerSchema.parse(uniqueUser("prog")), `9.9.${Math.floor(ip / 250)}.${ip % 250}`)).userId;
}
async function newCharacter(userId: string, name: string, classId: "TANK" | "DPS" | "HEALER" = "DPS") {
  return createCharacter(userId, createCharacterSchema.parse({ name, classId }));
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
};
async function giveItem(characterId: string, baseItemId: string, rarity: "COMMON" | "RARE" | "EPIC" = "COMMON", affixes: { id: string; value: number }[] = []) {
  return db.itemInstance.create({ data: { characterId, baseItemId, rarity, itemLevel: 1, affixes } });
}
async function potionCount(characterId: string) {
  return (await db.consumableStack.findUnique({ where: { characterId_consumableId: { characterId, consumableId: "HEALTH_POTION" } } }))?.quantity ?? 0;
}

beforeEach(resetDatabase);

describe("progresión inicial", () => {
  it("un personaje nuevo empieza con su habilidad inicial equipada, un punto de habilidad y pociones", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Novato", "HEALER");
    expect(c.skillPoints).toBe(BALANCE.progression.startingSkillPoints);
    const tree = await getSkillTree(userId, c.id);
    expect(tree!.loadout[0].skill).toMatchObject({ id: STARTER_SKILLS.HEALER, rank: 1 });
    expect(tree!.loadout.slice(1).every((l) => l.skill === null)).toBe(true);
    expect(await potionCount(c.id)).toBe(BALANCE.consumables.startingPotions);
    // Borrar el personaje elimina todo lo suyo (incluido el equipo puesto).
    const item = await giveItem(c.id, "acolyte-staff");
    await equipItem(userId, { characterId: c.id, itemId: item.id });
    await deleteCharacter(userId, c.id, "Novato");
    expect(await db.itemInstance.count()).toBe(0);
    expect(await db.equipmentSlot.count()).toBe(0);
  });
});

describe("habilidades", () => {
  it("aprender gasta puntos, respeta requisitos y el tope de rango", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Aprendiz", "TANK");
    expect(await code(learnSkill(userId, { characterId: c.id, skillId: "tank-shield-bash" }))).toBe("LEVEL_TOO_LOW");
    expect(await code(learnSkill(userId, { characterId: c.id, skillId: "dps-rend" }))).toBe("WRONG_CLASS");
    expect(await learnSkill(userId, { characterId: c.id, skillId: "tank-challenging-shout" })).toEqual({ rank: 1 });
    expect(await code(learnSkill(userId, { characterId: c.id, skillId: "tank-challenging-shout" }))).toBe("NOT_ENOUGH_POINTS");

    // Con muchos puntos y nivel alto, la mejora se detiene en el rango máximo.
    await db.character.update({ where: { id: c.id }, data: { skillPoints: 20, level: 10 } });
    for (let r = 2; r <= 5; r++) expect(await learnSkill(userId, { characterId: c.id, skillId: "tank-challenging-shout" })).toEqual({ rank: r });
    expect(await code(learnSkill(userId, { characterId: c.id, skillId: "tank-challenging-shout" }))).toBe("MAX_RANK");
    const fresh = await getOwnedCharacter(userId, c.id);
    expect(fresh!.skillPoints).toBe(16);
    const row = await db.characterSkill.findUniqueOrThrow({ where: { characterId_skillId: { characterId: c.id, skillId: "tank-challenging-shout" } } });
    expect(row.rank).toBe(5);
  });

  it("peticiones simultáneas no gastan el mismo punto dos veces", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Gemelo", "DPS");
    // 1 punto inicial; dos peticiones a la vez por habilidades distintas.
    const results = await Promise.all([
      code(learnSkill(userId, { characterId: c.id, skillId: "dps-rend" })),
      code(learnSkill(userId, { characterId: c.id, skillId: "dps-whirlwind" })),
    ]);
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    const fresh = await getOwnedCharacter(userId, c.id);
    expect(fresh!.skillPoints).toBe(0);
    const ranks = await db.characterSkill.findMany({ where: { characterId: c.id } });
    expect(ranks.reduce((a, s) => a + s.rank, 0)).toBe(2); // inicial + 1
  });

  it("máximo 3 básicas + 1 definitiva, sin repetir y solo aprendidas", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Equipado", "DPS");
    await db.character.update({ where: { id: c.id }, data: { skillPoints: 10, level: 6 } });
    for (const s of ["dps-rend", "dps-rend", "dps-shadow-step", "dps-whirlwind", "dps-blade-storm"]) await learnSkill(userId, { characterId: c.id, skillId: s });

    expect(await code(equipSkill(userId, { characterId: c.id, slot: "BASIC_2", skillId: "dps-fan-of-knives" }))).toBe("NOT_LEARNED");
    expect(await code(equipSkill(userId, { characterId: c.id, slot: "BASIC_2", skillId: "dps-blade-storm" }))).toBe("WRONG_SLOT");
    expect(await code(equipSkill(userId, { characterId: c.id, slot: "ULTIMATE", skillId: "dps-rend" }))).toBe("WRONG_SLOT");
    await equipSkill(userId, { characterId: c.id, slot: "BASIC_2", skillId: "dps-rend" });
    await equipSkill(userId, { characterId: c.id, slot: "BASIC_3", skillId: "dps-shadow-step" });
    await equipSkill(userId, { characterId: c.id, slot: "ULTIMATE", skillId: "dps-blade-storm" });
    // Mover una habilidad equipada a otro hueco no la duplica.
    await equipSkill(userId, { characterId: c.id, slot: "BASIC_1", skillId: "dps-rend" });
    let tree = await getSkillTree(userId, c.id);
    expect(tree!.loadout.map((l) => l.skill?.id ?? null)).toEqual(["dps-rend", null, "dps-shadow-step", "dps-blade-storm"]);
    expect(await db.characterLoadoutSlot.count({ where: { characterId: c.id } })).toBeLessThanOrEqual(4);
    await equipSkill(userId, { characterId: c.id, slot: "BASIC_3", skillId: "" });
    tree = await getSkillTree(userId, c.id);
    expect(tree!.loadout[2].skill).toBeNull();
  });

  it("el intento usa la instantánea de habilidades tomada al entrar", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Instante", "DPS");
    await learnSkill(userId, { characterId: c.id, skillId: "dps-rend" });
    await equipSkill(userId, { characterId: c.id, slot: "BASIC_2", skillId: "dps-rend" });
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    const before = await getRunForPlay(userId, runId);
    expect(before!.config.players[0].loadout).toEqual([{ skillId: "dps-whirlwind", rank: 1 }, { skillId: "dps-rend", rank: 1 }, null, null]);
    await equipSkill(userId, { characterId: c.id, slot: "BASIC_2", skillId: "" });
    expect((await getRunForPlay(userId, runId))!.config).toEqual(before!.config);
  });

  it("nadie puede tocar las habilidades de un personaje ajeno", async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const c = await newCharacter(owner, "Ajeno", "TANK");
    expect(await getSkillTree(intruder, c.id)).toBeNull();
    expect(await code(learnSkill(intruder, { characterId: c.id, skillId: "tank-challenging-shout" }))).toBe("NOT_FOUND");
    expect(await code(equipSkill(intruder, { characterId: c.id, slot: "BASIC_1", skillId: "" }))).toBe("NOT_FOUND");
  });
});

describe("equipo", () => {
  it("equipar cambia las estadísticas del personaje y del intento; respeta clase y hueco", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Armado", "TANK");
    const axe = await giveItem(c.id, "bearded-axe", "EPIC", [{ id: "STRENGTH", value: 5 }]);
    const robe = await giveItem(c.id, "mystic-robe");
    const ring1 = await giveItem(c.id, "bone-ring", "RARE", [{ id: "VITALITY", value: 3 }]);
    const ring2 = await giveItem(c.id, "bone-ring");

    // La comparación se calcula en el servidor antes de equipar.
    const inv = await listInventory(userId, c.id);
    const axeView = inv.items.find((i) => i.id === axe.id)!;
    expect(axeView.comparison!.slot).toBe("WEAPON");
    expect(axeView.comparison!.changes.physicalDamage![1]).toBeGreaterThan(axeView.comparison!.changes.physicalDamage![0]);
    expect(inv.items.find((i) => i.id === robe.id)!.comparison!.blocker).not.toBeNull();

    const naked = (await getOwnedCharacter(userId, c.id))!.stats.derived;
    expect(await equipItem(userId, { characterId: c.id, itemId: axe.id })).toEqual({ slot: "WEAPON" });
    // La comparación predijo exactamente las estadísticas que quedan al equiparlo.
    expect((await getOwnedCharacter(userId, c.id))!.stats.derived.physicalDamage).toBe(axeView.comparison!.changes.physicalDamage![1]);
    expect(await code(equipItem(userId, { characterId: c.id, itemId: robe.id }))).toBe("WRONG_CLASS");
    expect(await code(equipItem(userId, { characterId: c.id, itemId: axe.id, slot: "HELMET" }))).toBe("WRONG_SLOT");
    expect(await equipItem(userId, { characterId: c.id, itemId: ring1.id })).toEqual({ slot: "ACCESSORY_1" });
    expect(await equipItem(userId, { characterId: c.id, itemId: ring2.id })).toEqual({ slot: "ACCESSORY_2" });

    const dressed = (await getOwnedCharacter(userId, c.id))!;
    expect(dressed.stats.derived.physicalDamage).toBeGreaterThan(naked.physicalDamage);
    expect(dressed.stats.derived.maxHealth).toBeGreaterThan(naked.maxHealth);

    // El intento recibe las estadísticas con el equipo puesto.
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    const play = await getRunForPlay(userId, runId);
    expect(play!.config.players[0].stats).toEqual(dressed.stats.derived);

    // Quitar devuelve el objeto a la mochila; el intento ya empezado no cambia.
    await unequipItem(userId, { characterId: c.id, slot: "WEAPON" });
    expect((await getOwnedCharacter(userId, c.id))!.stats.derived.physicalDamage).toBe(naked.physicalDamage);
    expect((await getRunForPlay(userId, runId))!.config.players[0].stats).toEqual(dressed.stats.derived);

    const after = await listInventory(userId, c.id);
    expect(after.equipment.find((e) => e.slot === "ACCESSORY_1")!.item!.id).toBe(ring1.id);
    expect(after.equipment.find((e) => e.slot === "WEAPON")!.item).toBeNull();
    expect(after.total).toBe(4);
  });

  it("el Grillete de Varkhul activa su efecto único en el intento", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Carcelero", "DPS");
    const shackle = await giveItem(c.id, "jailer-shackle");
    await equipItem(userId, { characterId: c.id, itemId: shackle.id });
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    expect((await getRunForPlay(userId, runId))!.config.players[0].uniqueEffects).toEqual(["DODGE_EMPOWER"]);
  });

  it("no se pueden equipar objetos ajenos", async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const a = await newCharacter(owner, "Dueno", "DPS");
    const b = await newCharacter(intruder, "Ladron", "DPS");
    const item = await giveItem(a.id, "twin-shivs");
    expect(await code(equipItem(intruder, { characterId: b.id, itemId: item.id }))).toBe("NOT_FOUND");
    expect(await code(equipItem(intruder, { characterId: a.id, itemId: item.id }))).toBe("NOT_FOUND");
    expect(await code(dismantleItem(intruder, { characterId: b.id, itemId: item.id }))).toBe("NOT_FOUND");
  });
});

describe("desmontar y pociones", () => {
  it("desmontar borra el objeto y da material; un objeto equipado no se puede desmontar", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Herrero", "DPS");
    const keep = await giveItem(c.id, "twin-shivs", "EPIC");
    const junk = await giveItem(c.id, "travel-boots", "RARE");
    await equipItem(userId, { characterId: c.id, itemId: keep.id });
    expect(await code(dismantleItem(userId, { characterId: c.id, itemId: keep.id }))).toBe("ITEM_EQUIPPED");
    // La base de datos también lo impide.
    await expect(db.itemInstance.delete({ where: { id: keep.id } })).rejects.toThrow();

    const r = await dismantleItem(userId, { characterId: c.id, itemId: junk.id });
    expect(r.gained).toBe(dismantleYield("RARE", 1));
    expect(await db.itemInstance.findUnique({ where: { id: junk.id } })).toBeNull();
    expect(await code(dismantleItem(userId, { characterId: c.id, itemId: junk.id }))).toBe("NOT_FOUND");
    const inv = await listInventory(userId, c.id);
    expect(inv.materials[0].quantity).toBe(r.gained);
  });

  it("fabricar pociones gasta material y respeta el tope", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Alquimia", "HEALER");
    expect(await code(craftPotion(userId, { characterId: c.id }))).toBe("NOT_ENOUGH_MATERIALS");
    expect(await potionCount(c.id)).toBe(BALANCE.consumables.startingPotions);
    await db.materialStack.create({ data: { characterId: c.id, materialId: "ABYSSAL_DUST", quantity: 1000 } });
    const cap = CONSUMABLES.HEALTH_POTION.maxStack;
    for (let i = BALANCE.consumables.startingPotions; i < cap; i++) await craftPotion(userId, { characterId: c.id });
    expect(await code(craftPotion(userId, { characterId: c.id }))).toBe("POTIONS_FULL");
    expect(await potionCount(c.id)).toBe(cap);
    const dust = await db.materialStack.findFirstOrThrow({ where: { characterId: c.id } });
    expect(dust.quantity).toBe(1000 - (cap - BALANCE.consumables.startingPotions) * CONSUMABLES.HEALTH_POTION.craftCost.quantity);
  });

  it("las pociones del intento están limitadas y el servidor descuenta solo las que la repetición muestra bebidas", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Sediento", "DPS");
    await db.consumableStack.update({ where: { characterId_consumableId: { characterId: c.id, consumableId: "HEALTH_POTION" } }, data: { quantity: 5 } });
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    const play = await getRunForPlay(userId, runId);
    expect(play!.config.players[0].potions).toBe(CONSUMABLES.HEALTH_POTION.perRun);

    // Partida que solo bebe pociones con la vida llena (no se gastan) y luego pierde por tiempo:
    // la derrota no descuenta nada.
    const result = await submitRun(userId, { runId, segments: [[MAX_TICKS, 0, 0, 0, 0, 64]] });
    expect(result.status).toBe("FAILED");
    expect(result.outcome.potionsUsed).toBe(0);
    expect(await potionCount(c.id)).toBe(5);
  });

  it("una victoria descuenta las pociones bebidas, suma las encontradas y no se aplica dos veces", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Bebedor", "DPS");
    const start = await potionCount(c.id);
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    // Semilla fija en la que el piloto recibe algún golpe; bebe en cuanto pierde vida.
    await db.dungeonRun.update({ where: { id: runId }, data: { seed: 5 } });
    const play = await getRunForPlay(userId, runId);
    const { segments, state } = playWithBot(play!.config, Infinity, { drinkWhenHurt: true });
    expect(state.status).toBe("VICTORY");
    const used = state.summary.potionsUsed;
    expect(used).toBeGreaterThan(0);
    const [a, b] = await Promise.all([submitRun(userId, { runId, segments }), submitRun(userId, { runId, segments })]);
    expect(a.outcome.potionsUsed).toBe(used);
    expect(b.outcome).toEqual(a.outcome);
    const expected = Math.min(CONSUMABLES.HEALTH_POTION.maxStack, start - used + a.outcome.potionsFound);
    expect(a.outcome.potionsFound).toBeGreaterThan(0);
    expect(await potionCount(c.id)).toBe(expected);
  });
});
