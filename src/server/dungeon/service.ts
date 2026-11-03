import "server-only";
import { randomInt } from "node:crypto";
import { type DungeonRun, Prisma } from "@/generated/prisma/client";
import { MAX_FLOOR, floorRules } from "@/game/dungeon/floors";
import { generateFloorLoot } from "@/game/items/loot";
import { applyExperience } from "@/game/progression/experience";
import { MAX_SEED } from "@/game/random/rng";
import { computeFloorXp } from "@/game/rewards/experience";
import { replay } from "@/game/simulation/replay";
import { SIM_VERSION, type SimConfig } from "@/game/simulation/types";
import { computeCharacterStats } from "@/game/stats/compute";
import type { ClassId } from "@/game/types";
import { BALANCE } from "@/game/balance";
import { affixesSchema } from "@/lib/validation/items";
import { allocatedSnapshotSchema, type RunOutcome, runOutcomeSchema, type SubmitRunInput } from "@/lib/validation/run";
import { allocatedFrom } from "@/server/characters/service";
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

/** Configuración de simulación reconstruida SOLO con datos del servidor. */
function buildSimConfig(run: DungeonRun, character: { id: string; name: string; class: ClassId }): SimConfig {
  const allocated = allocatedSnapshotSchema.parse(run.allocatedAtStart);
  const stats = computeCharacterStats({ classId: character.class, level: run.levelAtStart, allocated });
  return {
    version: run.simVersion,
    seed: run.seed,
    floor: run.floor,
    difficulty: run.difficulty,
    players: [{ id: character.id, name: character.name, classId: character.class, level: run.levelAtStart, stats: stats.derived }],
  };
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
              levelAtStart: character.level,
              allocatedAtStart: allocatedFrom(character),
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
  if (!run || run.status !== "ACTIVE") return null;
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
  const victory = state.status === "VICTORY";
  const character = await db.character.findFirstOrThrow({ where: { id: run.characterId, userId } });
  const baseOutcome = {
    result: state.status as "VICTORY" | "DEFEAT",
    defeatReason: state.defeatReason,
    ticks: result.ticks,
    kills: state.summary.kills,
    bossDefeated: state.summary.bossDefeated,
    damageDealt: state.summary.damageDealt,
    damageTaken: state.summary.damageTaken,
    dodges: state.summary.dodges,
  };

  if (!victory) {
    const outcome: RunOutcome = { ...baseOutcome, xp: null, levelBefore: character.level, levelAfter: character.level, itemsLost: 0 };
    await db.dungeonRun.updateMany({
      where: { id: run.id, status: "ACTIVE" },
      data: { status: "FAILED", outcome: runOutcomeSchema.parse(outcome), ticks: result.ticks, endedAt: new Date() },
    });
    return (await getRunResult(userId, run.id)) ?? fail();
  }

  const rules = floorRules(run.floor);
  const xp = computeFloorXp({
    floor: run.floor,
    difficulty: run.difficulty,
    level: run.levelAtStart,
    kills: state.summary.kills,
    boss: rules.boss,
    bossDefeated: state.summary.bossDefeated,
  });
  const drops = generateFloorLoot({ seed: run.seed, floor: run.floor, difficulty: run.difficulty, classId: character.class, boss: rules.boss });

  try {
    await db.$transaction(async (tx) => {
      // 1) Cierra el intento. Si otra petición ya lo cerró, no se concede nada aquí.
      const closed = await tx.dungeonRun.updateMany({ where: { id: run.id, status: "ACTIVE" }, data: { status: "COMPLETED", ticks: result.ticks, endedAt: new Date() } });
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
      const grant = await tx.rewardGrant.create({
        data: { idempotencyKey: `run:${run.id}:${character.id}`, characterId: character.id, runId: run.id, xp: xp.total, levelsGained: progress.levelsGained },
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

      const outcome: RunOutcome = { ...baseOutcome, xp, levelBefore: current.level, levelAfter: progress.level, itemsLost: drops.length - kept.length };
      await tx.dungeonRun.update({ where: { id: run.id }, data: { outcome: runOutcomeSchema.parse(outcome) } });
    });
  } catch (error) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (!(error instanceof AlreadyClosed) && !duplicate) throw error;
  }
  return (await getRunResult(userId, run.id)) ?? fail();
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
