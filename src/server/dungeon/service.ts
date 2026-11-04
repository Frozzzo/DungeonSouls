import "server-only";
import { randomInt } from "node:crypto";
import { type Character, type DungeonRun, Prisma } from "@/generated/prisma/client";
import { MAX_FLOOR, floorRules } from "@/game/dungeon/floors";
import { generateFloorLoot } from "@/game/items/loot";
import { CONSUMABLES, potionsForRun, potionsFoundOnFloor } from "@/game/items/consumables";
import { emptyGear } from "@/game/items/equipment";
import { LOADOUT_SLOTS } from "@/game/skills/rules";
import { applyExperience } from "@/game/progression/experience";
import { MAX_SEED } from "@/game/random/rng";
import { computeFloorXp } from "@/game/rewards/experience";
import { replay } from "@/game/simulation/replay";
import { SIM_VERSION, type SimConfig, type SimPlayerConfig, type SimSummary } from "@/game/simulation/types";
import { computeCharacterStats } from "@/game/stats/compute";
import type { ClassId } from "@/game/types";
import { BALANCE } from "@/game/balance";
import { affixesSchema } from "@/lib/validation/items";
import { allocatedSnapshotSchema, type RunOutcome, runOutcomeSchema, type SubmitRunInput } from "@/lib/validation/run";
import { gearSnapshotSchema, loadoutSnapshotSchema } from "@/lib/validation/progression";
import { allocatedFrom, gearFrom, loadEquippedItems } from "@/server/characters/service";
import { loadLoadout } from "@/server/skills/service";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { withSerializableRetry } from "@/server/transactions";
import { type ItemView, toItemView } from "@/server/inventory/service";

/** Envíos incompletos admitidos por intento antes de abandonarlo (limita el coste de repetir partidas). */
const MAX_REJECTED_SUBMISSIONS = 5;

export interface RunPlayView {
  id: string;
  characterId: string;
  characterName: string;
  floor: number;
  config: SimConfig;
}

export interface RunResultView {
  runId: string;
  characterId: string;
  floor: number;
  status: "COMPLETED" | "FAILED";
  outcome: RunOutcome;
  items: ItemView[];
  nextFloor: number | null;
}

export interface RunHistoryEntry {
  id: string;
  floor: number;
  status: DungeonRun["status"];
  startedAt: Date;
  xp: number | null;
  seconds: number | null;
}

/** Pisos que el personaje puede empezar: del 1 al siguiente del más profundo completado. */
export function unlockedFloors(highestFloorCleared: number): number[] {
  const max = Math.min(MAX_FLOOR, highestFloorCleared + 1);
  return Array.from({ length: max }, (_, i) => i + 1);
}

/**
 * Jugador de la simulación reconstruido SOLO con datos del servidor: la instantánea tomada al
 * empezar (nivel, puntos, habilidades equipadas con su rango, bonificación del equipo y pociones).
 */
export function playerConfigFromRun(run: DungeonRun, character: { id: string; name: string; class: ClassId }): SimPlayerConfig {
  const allocated = allocatedSnapshotSchema.parse(run.allocatedAtStart);
  const loadout = run.loadoutAtStart === null ? LOADOUT_SLOTS.map(() => null) : loadoutSnapshotSchema.parse(run.loadoutAtStart);
  const gear = run.gearAtStart === null ? { bonus: emptyGear(), uniqueEffects: [] } : gearSnapshotSchema.parse(run.gearAtStart);
  const stats = computeCharacterStats({ classId: character.class, level: run.levelAtStart, allocated, gear: gear.bonus });
  return {
    id: character.id,
    name: character.name,
    classId: character.class,
    level: run.levelAtStart,
    stats: stats.derived,
    loadout,
    potions: run.potionsAtStart,
    uniqueEffects: gear.uniqueEffects,
  };
}

function buildSimConfig(run: DungeonRun, character: { id: string; name: string; class: ClassId }): SimConfig {
  return { version: run.simVersion, seed: run.seed, floor: run.floor, difficulty: run.difficulty, players: [playerConfigFromRun(run, character)] };
}

/**
 * Instantánea de la progresión de un personaje para un intento nuevo (dentro de una transacción):
 * cambiar habilidades o equipo después no altera la partida empezada.
 */
export async function progressionSnapshot(tx: Prisma.TransactionClient, character: Character) {
  const [loadout, equipped, potions] = await Promise.all([
    loadLoadout(tx, character.id, character.class),
    loadEquippedItems(tx, character.id),
    tx.consumableStack.findUnique({ where: { characterId_consumableId: { characterId: character.id, consumableId: CONSUMABLES.HEALTH_POTION.id } } }),
  ]);
  return {
    levelAtStart: character.level,
    allocatedAtStart: allocatedFrom(character),
    loadoutAtStart: loadoutSnapshotSchema.parse(loadout),
    gearAtStart: gearSnapshotSchema.parse(gearFrom(equipped)),
    potionsAtStart: potionsForRun(potions?.quantity ?? 0),
  };
}

/**
 * Suma (o resta) pociones con una única sentencia atómica que respeta el tope y nunca baja de 0.
 * Se usa dentro de la transacción que cierra el intento.
 */
async function adjustPotions(tx: Prisma.TransactionClient, characterId: string, delta: number) {
  if (delta === 0) return;
  const potion = CONSUMABLES.HEALTH_POTION;
  await tx.consumableStack.upsert({
    where: { characterId_consumableId: { characterId, consumableId: potion.id } },
    create: { characterId, consumableId: potion.id, quantity: 0 },
    update: {},
  });
  await tx.$executeRaw`UPDATE "ConsumableStack" SET "quantity" = LEAST(${potion.maxStack}::int, GREATEST(0, "quantity" + ${delta}::int)) WHERE "characterId" = ${characterId} AND "consumableId" = ${potion.id}`;
}

/**
 * Empieza un intento de un piso. Fija semilla, dificultad e instantánea del personaje.
 * Un personaje solo tiene un intento activo: empezar otro abandona el anterior.
 */
export async function startRun(userId: string, input: { characterId: string; floor: number }): Promise<{ runId: string }> {
  try {
    return await withSerializableRetry(() =>
      db.$transaction(
        async (tx) => {
          const character = await tx.character.findFirst({ where: { id: input.characterId, userId } });
          if (!character) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");
          if (!unlockedFloors(character.highestFloorCleared).includes(input.floor)) {
            throw new DomainError("FLOOR_LOCKED", "Ese piso todavía no está desbloqueado.");
          }
          await tx.dungeonRun.updateMany({
            where: { characterId: character.id, status: "ACTIVE" },
            data: { status: "ABANDONED", endedAt: new Date() },
          });
          const run = await tx.dungeonRun.create({
            data: {
              characterId: character.id,
              floor: input.floor,
              // La Fase 2 usa Normal; la selección de dificultad llega en la Fase 5 (el modelo ya la registra).
              difficulty: "NORMAL",
              seed: randomInt(1, MAX_SEED),
              simVersion: SIM_VERSION,
              ...(await progressionSnapshot(tx, character)),
            },
          });
          return { runId: run.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new DomainError("CONFLICT", "Conflicto al empezar el piso. Vuelve a intentarlo.");
    }
    throw error;
  }
}

async function findOwnedRun(userId: string, runId: string) {
  return db.dungeonRun.findFirst({
    where: { id: runId, character: { userId } },
    include: { character: { select: { id: true, name: true, class: true, userId: true } } },
  });
}

/** Datos para jugar un intento activo propio (o null). */
export async function getRunForPlay(userId: string, runId: string): Promise<RunPlayView | null> {
  const run = await findOwnedRun(userId, runId);
  // Los intentos de una expedición se juegan en el servidor de partida, no aquí.
  if (!run || run.status !== "ACTIVE" || run.expeditionId !== null) return null;
  if (run.simVersion !== SIM_VERSION) {
    // Empezado con otras reglas: no se podría validar. Se abandona sin penalización.
    await abandonRun(userId, run.id);
    return null;
  }
  return { id: run.id, characterId: run.characterId, characterName: run.character.name, floor: run.floor, config: buildSimConfig(run, run.character) };
}

export async function abandonRun(userId: string, runId: string): Promise<void> {
  await db.dungeonRun.updateMany({
    where: { id: runId, status: "ACTIVE", character: { userId } },
    data: { status: "ABANDONED", endedAt: new Date() },
  });
}

/** Resultado de un intento ya cerrado (para reintentos de red y para la pantalla de resultados). */
export async function getRunResult(userId: string, runId: string): Promise<RunResultView | null> {
  const run = await db.dungeonRun.findFirst({
    where: { id: runId, character: { userId } },
    include: { character: { select: { class: true } }, rewardGrant: { include: { items: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!run || (run.status !== "COMPLETED" && run.status !== "FAILED")) return null;
  const outcome = runOutcomeSchema.parse(run.outcome);
  const items = (run.rewardGrant?.items ?? []).map((i) => toItemView(i, run.character.class)).filter((v): v is ItemView => v !== null);
  const nextFloor = run.status === "COMPLETED" && run.floor < MAX_FLOOR ? run.floor + 1 : null;
  return { runId: run.id, characterId: run.characterId, floor: run.floor, status: run.status, outcome, items, nextFloor };
}

/**
 * Valida un piso y concede las recompensas.
 *
 * El cliente solo envía sus intenciones. El servidor reconstruye la partida (semilla, dificultad
 * e instantánea guardadas), la vuelve a ejecutar y solo si el resultado es una victoria calcula
 * la XP y el botín. Todo se escribe en una transacción con escrituras condicionales y una clave
 * de idempotencia única: repetir el envío devuelve el mismo resultado sin conceder nada más.
 */
export async function submitRun(userId: string, input: SubmitRunInput): Promise<RunResultView> {
  const run = await findOwnedRun(userId, input.runId);
  if (!run) throw new DomainError("NOT_FOUND", "Partida no encontrada.");

  if (run.status === "COMPLETED" || run.status === "FAILED") {
    const existing = await getRunResult(userId, run.id);
    if (existing) return existing;
  }
  if (run.status !== "ACTIVE") throw new DomainError("RUN_CLOSED", "Esta partida ya no está activa.");
  // Una expedición en grupo la resuelve el servidor de partida: no se acepta una repetición del cliente.
  if (run.expeditionId !== null) throw new DomainError("EXPEDITION_RUN", "Esta partida se juega en grupo.");

  if (run.simVersion !== SIM_VERSION) {
    await abandonRun(userId, run.id);
    throw new DomainError("VERSION_MISMATCH", "El juego se actualizó durante la partida. Empieza el piso de nuevo.");
  }

  const config = buildSimConfig(run, run.character);
  const result = replay(config, input.segments);

  if (!result.finished) {
    // Entradas que no terminan la partida: no hay resultado que validar.
    const updated = await db.dungeonRun.update({
      where: { id: run.id },
      data: { rejectedSubmissions: { increment: 1 } },
      select: { rejectedSubmissions: true },
    });
    if (updated.rejectedSubmissions >= MAX_REJECTED_SUBMISSIONS) await abandonRun(userId, run.id);
    throw new DomainError("INCOMPLETE", "La partida enviada no ha terminado. No se ha concedido nada.");
  }

  const { state } = result;
  await finalizeRun(run, {
    result: state.status as "VICTORY" | "DEFEAT",
    defeatReason: state.defeatReason,
    ticks: result.ticks,
    summary: state.summary,
    // Pociones bebidas según la repetición (nunca más de las que llevaba: lo limita la simulación).
    potionsUsed: Math.min(run.potionsAtStart, state.summary.potionsUsed),
    lootSeed: run.seed,
  });
  return (await getRunResult(userId, run.id)) ?? fail();
}

/** Resultado ya verificado por el servidor (repetición en solitario o servidor de partida). */
export interface VerifiedOutcome {
  result: "VICTORY" | "DEFEAT";
  defeatReason: "DOWNED" | "TIMEOUT" | null;
  ticks: number;
  summary: SimSummary;
  potionsUsed: number;
  /** Semilla del botín de este personaje (en grupo, distinta para cada uno). */
  lootSeed: number;
}

/**
 * Cierra un intento activo con un resultado verificado y concede las recompensas.
 *
 * Todo se escribe en una transacción con escrituras condicionales y una clave de idempotencia
 * única: si otra petición ya cerró el intento (o lo repite), no se concede nada más.
 */
export async function finalizeRun(run: DungeonRun, verified: VerifiedOutcome): Promise<void> {
  const character = await db.character.findUniqueOrThrow({ where: { id: run.characterId } });
  const baseOutcome = {
    result: verified.result,
    defeatReason: verified.defeatReason,
    ticks: verified.ticks,
    kills: verified.summary.kills,
    bossDefeated: verified.summary.bossDefeated,
    damageDealt: verified.summary.damageDealt,
    damageTaken: verified.summary.damageTaken,
    dodges: verified.summary.dodges,
    potionsUsed: Math.max(0, Math.min(run.potionsAtStart, verified.potionsUsed)),
  };

  if (verified.result !== "VICTORY") {
    const outcome: RunOutcome = { ...baseOutcome, xp: null, levelBefore: character.level, levelAfter: character.level, itemsLost: 0, potionsFound: 0 };
    await db.$transaction(async (tx) => {
      const closed = await tx.dungeonRun.updateMany({
        where: { id: run.id, status: "ACTIVE" },
        data: { status: "FAILED", outcome: runOutcomeSchema.parse(outcome), ticks: verified.ticks, endedAt: new Date() },
      });
      // Solo quien cierra el intento descuenta las pociones (un reenvío no las descuenta otra vez).
      if (closed.count === 1) await adjustPotions(tx, character.id, -baseOutcome.potionsUsed);
    });
    return;
  }

  const rules = floorRules(run.floor);
  const xp = computeFloorXp({
    floor: run.floor,
    difficulty: run.difficulty,
    level: run.levelAtStart,
    kills: verified.summary.kills,
    boss: rules.boss,
    bossDefeated: verified.summary.bossDefeated,
  });
  const drops = generateFloorLoot({ seed: verified.lootSeed, floor: run.floor, difficulty: run.difficulty, classId: character.class, boss: rules.boss });

  try {
    await db.$transaction(async (tx) => {
      // 1) Cierra el intento. Si otra petición ya lo cerró, no se concede nada aquí.
      const closed = await tx.dungeonRun.updateMany({ where: { id: run.id, status: "ACTIVE" }, data: { status: "COMPLETED", ticks: verified.ticks, endedAt: new Date() } });
      if (closed.count !== 1) throw new AlreadyClosed();

      // 2) XP y subida de nivel con las reglas compartidas, escritura condicional sobre el progreso leído.
      const current = await tx.character.findFirstOrThrow({ where: { id: character.id } });
      const progress = applyExperience({ level: current.level, experience: current.experience }, xp.total);
      const updated = await tx.character.updateMany({
        where: { id: current.id, level: current.level, experience: current.experience },
        data: {
          level: progress.level,
          experience: progress.experience,
          statPoints: { increment: progress.statPointsGained },
          skillPoints: { increment: progress.skillPointsGained },
          highestFloorCleared: Math.max(current.highestFloorCleared, run.floor),
        },
      });
      if (updated.count !== 1) throw new DomainError("CONFLICT", "El personaje cambió mientras se validaba el piso. Vuelve a enviarlo.");

      // 3) Registro idempotente de la recompensa.
      const idempotencyKey = run.expeditionId ? `exp:${run.expeditionId}:${character.id}` : `run:${run.id}:${character.id}`;
      const grant = await tx.rewardGrant.create({
        data: { idempotencyKey, characterId: character.id, runId: run.id, xp: xp.total, levelsGained: progress.levelsGained },
      });

      // 4) Botín, respetando la capacidad del inventario.
      const owned = await tx.itemInstance.count({ where: { characterId: character.id } });
      const room = Math.max(0, BALANCE.rewards.inventoryCapacity - owned);
      const kept = drops.slice(0, room);
      if (kept.length > 0) {
        await tx.itemInstance.createMany({
          data: kept.map((d) => ({
            characterId: character.id,
            baseItemId: d.baseItemId,
            rarity: d.rarity,
            itemLevel: d.itemLevel,
            affixes: affixesSchema.parse(d.affixes),
            sourceRewardGrantId: grant.id,
          })),
        });
      }

      // 5) Pociones: se descuentan las bebidas y se suman las encontradas (con tope).
      const potionsFound = potionsFoundOnFloor(rules.boss !== null);
      await adjustPotions(tx, character.id, potionsFound - baseOutcome.potionsUsed);

      const outcome: RunOutcome = {
        ...baseOutcome,
        xp,
        levelBefore: current.level,
        levelAfter: progress.level,
        itemsLost: drops.length - kept.length,
        potionsFound,
      };
      await tx.dungeonRun.update({ where: { id: run.id }, data: { outcome: runOutcomeSchema.parse(outcome) } });
    });
  } catch (error) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (!(error instanceof AlreadyClosed) && !duplicate) throw error;
  }
}

class AlreadyClosed extends Error {}

function fail(): never {
  throw new DomainError("RUN_CLOSED", "No se pudo recuperar el resultado de la partida.");
}

export async function listRecentRuns(userId: string, characterId: string, limit = 8): Promise<RunHistoryEntry[]> {
  const rows = await db.dungeonRun.findMany({
    where: { characterId, character: { userId } },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { rewardGrant: { select: { xp: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    floor: r.floor,
    status: r.status,
    startedAt: r.startedAt,
    xp: r.rewardGrant?.xp ?? null,
    seconds: r.ticks === null ? null : Math.round(r.ticks / BALANCE.simulation.tickRate),
  }));
}

export async function getActiveRunId(userId: string, characterId: string): Promise<string | null> {
  const run = await db.dungeonRun.findFirst({ where: { characterId, status: "ACTIVE", character: { userId } }, select: { id: true }, orderBy: { startedAt: "desc" } });
  return run?.id ?? null;
}
