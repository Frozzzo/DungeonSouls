import { beforeEach, describe, expect, it } from "vitest";
import { registerSchema } from "@/lib/validation/auth";
import { createCharacterSchema } from "@/lib/validation/character";
import { MAX_TICKS } from "@/game/simulation/context";
import type { InputSegment } from "@/game/simulation/input";
import { registerUser } from "@/server/auth/service";
import { allocateStats, createCharacter, getOwnedCharacter } from "@/server/characters/service";
import { db } from "@/server/db";
import { getRunForPlay, startRun, submitRun, unlockedFloors } from "@/server/dungeon/service";
import { listInventory } from "@/server/inventory/service";
import { DomainError } from "@/server/errors";
import { playWithBot } from "../support/sim";
import { resetDatabase, uniqueUser } from "./helpers";

let ip = 0;
async function newUser() {
  ip += 1;
  return (await registerUser(registerSchema.parse(uniqueUser("dun")), `8.8.${Math.floor(ip / 250)}.${ip % 250}`)).userId;
}
async function newCharacter(userId: string, name: string, classId: "TANK" | "DPS" | "HEALER" = "DPS") {
  return createCharacter(userId, createCharacterSchema.parse({ name, classId }));
}
/** Juega el intento con el piloto automático usando la configuración que da el servidor. */
async function botSegments(userId: string, runId: string): Promise<InputSegment[]> {
  const play = await getRunForPlay(userId, runId);
  if (!play) throw new Error("intento no jugable");
  const { segments, state } = playWithBot(play.config);
  expect(state.status).toBe("VICTORY");
  return segments;
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
};

beforeEach(resetDatabase);

describe("intentos de piso", () => {
  it("solo se pueden empezar pisos desbloqueados y un nuevo intento abandona el anterior", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Descenso");
    expect(unlockedFloors(0)).toEqual([1]);
    expect(await code(startRun(userId, { characterId: c.id, floor: 2 }))).toBe("FLOOR_LOCKED");
    const first = await startRun(userId, { characterId: c.id, floor: 1 });
    const second = await startRun(userId, { characterId: c.id, floor: 1 });
    const runs = await db.dungeonRun.findMany({ where: { characterId: c.id }, orderBy: { startedAt: "asc" } });
    expect(runs.map((r) => [r.id, r.status])).toEqual([
      [first.runId, "ABANDONED"],
      [second.runId, "ACTIVE"],
    ]);
    expect(runs[1].seed).toBeGreaterThan(0);
    expect(runs[1].difficulty).toBe("NORMAL");
  });

  it("nadie puede empezar ni jugar intentos de personajes ajenos", async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const c = await newCharacter(owner, "Propio");
    expect(await code(startRun(intruder, { characterId: c.id, floor: 1 }))).toBe("NOT_FOUND");
    const { runId } = await startRun(owner, { characterId: c.id, floor: 1 });
    expect(await getRunForPlay(intruder, runId)).toBeNull();
    expect(await code(submitRun(intruder, { runId, segments: [[10, 0, 0, 0, 0, 0]] }))).toBe("NOT_FOUND");
  });

  it("la instantánea del personaje se fija al empezar: asignar puntos después no cambia la partida", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Instante");
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    const before = await getRunForPlay(userId, runId);
    await allocateStats(userId, { characterId: c.id, strength: 0, dexterity: 5, intelligence: 0, vitality: 0 });
    const after = await getRunForPlay(userId, runId);
    expect(after!.config).toEqual(before!.config);
  });
});

describe("validación de piso y recompensas", () => {
  it("una victoria verificada concede XP, botín y desbloquea el piso siguiente", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Vencedor");
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    const result = await submitRun(userId, { runId, segments: await botSegments(userId, runId) });

    expect(result.status).toBe("COMPLETED");
    expect(result.outcome.result).toBe("VICTORY");
    expect(result.outcome.xp!.total).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.nextFloor).toBe(2);

    const fresh = await getOwnedCharacter(userId, c.id);
    const totalXp = result.outcome.xp!.total;
    expect(fresh!.highestFloorCleared).toBe(1);
    expect(fresh!.level).toBe(result.outcome.levelAfter);
    if (fresh!.level === 1) expect(fresh!.experience).toBe(totalXp);
    expect(unlockedFloors(fresh!.highestFloorCleared)).toEqual([1, 2]);

    const grants = await db.rewardGrant.findMany({ where: { characterId: c.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0].idempotencyKey).toBe(`run:${runId}:${c.id}`);
    const inv = await listInventory(userId, c.id);
    expect(inv.total).toBe(result.items.length);
  });

  it("repetir el envío (incluso a la vez) no duplica XP ni objetos", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Repetido");
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    const segments = await botSegments(userId, runId);
    const [a, b] = await Promise.all([submitRun(userId, { runId, segments }), submitRun(userId, { runId, segments })]);
    const c3 = await submitRun(userId, { runId, segments });
    expect(a.outcome.xp).toEqual(b.outcome.xp);
    expect(c3.items.map((i) => i.id)).toEqual(a.items.map((i) => i.id));
    expect(await db.rewardGrant.count({ where: { characterId: c.id } })).toBe(1);
    expect(await db.itemInstance.count({ where: { characterId: c.id } })).toBe(a.items.length);
    const fresh = await getOwnedCharacter(userId, c.id);
    expect(fresh!.experience + (fresh!.level > 1 ? 100 : 0)).toBe(a.outcome.xp!.total);
  });

  it("la XP solo sale de la repetición en el servidor: una derrota no concede nada", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Quieto");
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    // Quedarse quieto todo el tiempo: el piso no se completa (derrota por tiempo).
    const result = await submitRun(userId, { runId, segments: [[MAX_TICKS, 0, 0, 0, 0, 0]] });
    expect(result.status).toBe("FAILED");
    expect(result.outcome.xp).toBeNull();
    expect(result.items).toEqual([]);
    const fresh = await getOwnedCharacter(userId, c.id);
    expect(fresh).toMatchObject({ level: 1, experience: 0, highestFloorCleared: 0 });
    expect(await db.rewardGrant.count()).toBe(0);
  });

  it("entradas que no terminan la partida se rechazan y, tras varios intentos, el intento se abandona", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Incompleto");
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    for (let i = 0; i < 5; i++) expect(await code(submitRun(userId, { runId, segments: [[20, 100, 0, 0, 0, 0]] }))).toBe("INCOMPLETE");
    expect((await db.dungeonRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("ABANDONED");
    expect(await code(submitRun(userId, { runId, segments: [[20, 100, 0, 0, 0, 0]] }))).toBe("RUN_CLOSED");
    expect((await getOwnedCharacter(userId, c.id))!.experience).toBe(0);
  });

  it("un intento empezado con otra versión de las reglas no se valida", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Antiguo");
    const { runId } = await startRun(userId, { characterId: c.id, floor: 1 });
    const segments = await botSegments(userId, runId);
    await db.dungeonRun.update({ where: { id: runId }, data: { simVersion: 0 } });
    expect(await code(submitRun(userId, { runId, segments }))).toBe("VERSION_MISMATCH");
    expect(await db.rewardGrant.count()).toBe(0);
  });

  it("las entradas de otra partida (otra semilla) no sirven para ganar", async () => {
    const userId = await newUser();
    const c = await newCharacter(userId, "Tramposo");
    const { runId: a } = await startRun(userId, { characterId: c.id, floor: 1 });
    const segments = await botSegments(userId, a);
    const { runId: b } = await startRun(userId, { characterId: c.id, floor: 1 });
    const outcome = await code(submitRun(userId, { runId: b, segments }));
    // Con otro mapa la secuencia no termina en victoria: o no termina o es derrota.
    if (outcome === "OK") expect((await db.dungeonRun.findUniqueOrThrow({ where: { id: b } })).status).toBe("FAILED");
    else expect(outcome).toBe("INCOMPLETE");
    expect(await db.rewardGrant.count()).toBe(0);
  });
});

describe("inventario", () => {
  it("se guarda, se recupera con filtros y es privado", async () => {
    const userId = await newUser();
    const other = await newUser();
    const c = await newCharacter(userId, "Coleccion", "TANK");
    await db.itemInstance.createMany({
      data: [
        { characterId: c.id, baseItemId: "iron-helm", rarity: "COMMON", itemLevel: 1, affixes: [] },
        { characterId: c.id, baseItemId: "bearded-axe", rarity: "EPIC", itemLevel: 2, affixes: [{ id: "STRENGTH", value: 4 }] },
        { characterId: c.id, baseItemId: "mystic-robe", rarity: "RARE", itemLevel: 1, affixes: [] },
      ],
    });
    const all = await listInventory(userId, c.id, { sort: "rarity" });
    expect(all.items.map((i) => i.rarity)).toEqual(["EPIC", "RARE", "COMMON"]);
    expect(all.items[0].affixes).toEqual(["+4 Fuerza"]);
    expect(all.items.find((i) => i.baseItemId === "mystic-robe")!.usableByClass).toBe(false);
    expect((await listInventory(userId, c.id, { category: "HELMET" })).items).toHaveLength(1);
    expect((await listInventory(userId, c.id, { minRarity: "RARE" })).items).toHaveLength(2);
    expect(await code(listInventory(other, c.id))).toBe("NOT_FOUND");
  });
});
