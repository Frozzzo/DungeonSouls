import "server-only";
import { randomInt } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { deriveSeed, MAX_SEED } from "@/game/random/rng";
import { SIM_VERSION, type SimConfig } from "@/game/simulation/types";
import type { ExpeditionResultInput } from "@/lib/validation/expedition";
import type { ExpeditionRoomConfig } from "@/realtime/protocol";
import { createTicket } from "@/realtime/signing";
import { db } from "@/server/db";
import { finalizeRun, playerConfigFromRun, progressionSnapshot } from "@/server/dungeon/service";
import { DomainError } from "@/server/errors";
import { partyFloors } from "@/server/parties/service";
import { realtimeConfig } from "@/server/realtime/config";
import { withSerializableRetry } from "@/server/transactions";

export interface ExpeditionPlayView {
  expeditionId: string;
  characterId: string;
  runId: string;
  floor: number;
  config: SimConfig;
}

/**
 * El líder empieza una expedición: fija piso, dificultad y semilla, y crea un intento (con la
 * instantánea de progresión) por miembro. Todos deben estar listos y tener el piso desbloqueado.
 */
export async function startExpedition(userId: string, input: { floor: number }): Promise<{ expeditionId: string }> {
  if (!realtimeConfig()) throw new DomainError("REALTIME_DISABLED", "El juego en grupo no está configurado en este servidor.");
  try {
    return await withSerializableRetry(() =>
      db.$transaction(
        async (tx) => {
          const me = await tx.partyMember.findUnique({ where: { userId }, include: { party: true } });
          if (!me) throw new DomainError("NOT_IN_PARTY", "No estás en un grupo.");
          const party = me.party;
          if (party.leaderUserId !== userId) throw new DomainError("NOT_LEADER", "Solo el líder puede empezar la expedición.");
          if (party.status !== "OPEN") throw new DomainError("IN_EXPEDITION", "El grupo ya está en una expedición.");
          const members = await tx.partyMember.findMany({ where: { partyId: party.id }, orderBy: { joinedAt: "asc" }, include: { character: true } });
          const notReady = members.filter((m) => !m.ready && m.userId !== userId);
          if (notReady.length > 0) throw new DomainError("NOT_READY", "Todos los miembros deben estar listos.");
          if (!partyFloors(members.map((m) => m.character.highestFloorCleared)).includes(input.floor)) {
            throw new DomainError("FLOOR_LOCKED", "Algún miembro aún no ha desbloqueado ese piso.");
          }
          const seed = randomInt(1, MAX_SEED);
          const expedition = await tx.expedition.create({
            data: { partyId: party.id, floor: input.floor, difficulty: "NORMAL", seed, simVersion: SIM_VERSION, playerCount: members.length },
          });
          for (const [slot, m] of members.entries()) {
            // Un personaje solo tiene un intento activo.
            await tx.dungeonRun.updateMany({ where: { characterId: m.characterId, status: "ACTIVE" }, data: { status: "ABANDONED", endedAt: new Date() } });
            await tx.dungeonRun.create({
              data: {
                characterId: m.characterId,
                floor: input.floor,
                difficulty: "NORMAL",
                seed,
                simVersion: SIM_VERSION,
                expeditionId: expedition.id,
                partySlot: slot,
                ...(await progressionSnapshot(tx, m.character)),
              },
            });
          }
          await tx.party.update({ where: { id: party.id }, data: { status: "IN_EXPEDITION" } });
          await tx.partyMember.updateMany({ where: { partyId: party.id }, data: { ready: false } });
          return { expeditionId: expedition.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new DomainError("CONFLICT", "Conflicto al empezar la expedición. Vuelve a intentarlo.");
    }
    throw error;
  }
}

async function loadExpedition(expeditionId: string) {
  return db.expedition.findUnique({
    where: { id: expeditionId },
    include: { runs: { orderBy: { partySlot: "asc" }, include: { character: { select: { id: true, name: true, class: true, userId: true } } } } },
  });
}

type LoadedExpedition = NonNullable<Awaited<ReturnType<typeof loadExpedition>>>;

function simConfigOf(expedition: LoadedExpedition): SimConfig {
  return {
    version: expedition.simVersion,
    seed: expedition.seed,
    floor: expedition.floor,
    difficulty: expedition.difficulty,
    players: expedition.runs.map((run) => playerConfigFromRun(run, run.character)),
  };
}

/** Datos para jugar: solo si la expedición y el intento del usuario siguen activos. */
export async function getExpeditionForPlay(userId: string, expeditionId: string): Promise<ExpeditionPlayView | null> {
  const expedition = await loadExpedition(expeditionId);
  if (!expedition || expedition.status !== "ACTIVE" || expedition.simVersion !== SIM_VERSION) return null;
  const mine = expedition.runs.find((r) => r.character.userId === userId && r.status === "ACTIVE");
  if (!mine) return null;
  return { expeditionId: expedition.id, characterId: mine.characterId, runId: mine.id, floor: expedition.floor, config: simConfigOf(expedition) };
}

/** Intento del usuario en una expedición (activo o cerrado), para mostrar su resultado. */
export async function getMyExpeditionRun(userId: string, expeditionId: string) {
  return db.dungeonRun.findFirst({
    where: { expeditionId, character: { userId } },
    select: { id: true, characterId: true, status: true, expedition: { select: { status: true, floor: true } } },
  });
}

/** Ticket firmado (60 s) para conectarse a la sala. Se pide uno nuevo en cada (re)conexión. */
export async function issueTicket(userId: string, expeditionId: string): Promise<{ url: string; ticket: string }> {
  const realtime = realtimeConfig();
  if (!realtime) throw new DomainError("REALTIME_DISABLED", "El juego en grupo no está configurado en este servidor.");
  const play = await getExpeditionForPlay(userId, expeditionId);
  if (!play) throw new DomainError("NOT_FOUND", "No participas en ninguna expedición activa con ese id.");
  const ticket = await createTicket(realtime.secret, { expeditionId, userId, characterId: play.characterId });
  return { url: `${realtime.url}/expeditions/${encodeURIComponent(expeditionId)}`, ticket };
}

/** Configuración de la sala para el servidor de partida (petición firmada). */
export async function getRoomConfig(expeditionId: string): Promise<ExpeditionRoomConfig | null> {
  const expedition = await loadExpedition(expeditionId);
  if (!expedition || expedition.status !== "ACTIVE") return null;
  return {
    expeditionId,
    config: simConfigOf(expedition),
    inactivePlayerIds: expedition.runs.filter((r) => r.status !== "ACTIVE").map((r) => r.characterId),
  };
}

const END_STATUS = { VICTORY: "COMPLETED", DEFEAT: "DEFEATED", ABANDONED: "ABANDONED" } as const;

/**
 * Aplica el resultado firmado del servidor de partida. Idempotente: cada intento se cierra con una
 * escritura condicional y su recompensa tiene clave única `exp:<expedición>:<personaje>`, así que
 * repetir la petición (o recibirla dos veces a la vez) no concede nada más.
 */
export async function applyExpeditionResult(result: ExpeditionResultInput): Promise<{ status: "APPLIED" | "ALREADY_APPLIED" | "NOT_FOUND" }> {
  const expedition = await loadExpedition(result.expeditionId);
  if (!expedition) return { status: "NOT_FOUND" };
  if (expedition.status !== "ACTIVE") return { status: "ALREADY_APPLIED" };

  for (const run of expedition.runs) {
    if (run.status !== "ACTIVE") continue;
    const player = result.players.find((p) => p.id === run.characterId);
    if (!player || player.left || result.status === "ABANDONED") {
      await db.dungeonRun.updateMany({ where: { id: run.id, status: "ACTIVE" }, data: { status: "ABANDONED", endedAt: new Date() } });
      continue;
    }
    await finalizeRun(run, {
      result: result.status,
      defeatReason: result.defeatReason,
      ticks: result.ticks,
      summary: result.summary,
      potionsUsed: Math.max(0, run.potionsAtStart - player.potionsLeft),
      // Cada personaje tiene su propio botín (dos de la misma clase no reciben lo mismo).
      lootSeed: deriveSeed(expedition.seed, 0x1007 + (run.partySlot ?? 0)),
    });
  }

  await db.$transaction(async (tx) => {
    const closed = await tx.expedition.updateMany({
      where: { id: expedition.id, status: "ACTIVE" },
      data: { status: END_STATUS[result.status], result: result as unknown as Prisma.InputJsonValue, endedAt: new Date() },
    });
    if (closed.count === 1) await tx.party.updateMany({ where: { id: expedition.partyId, status: "IN_EXPEDITION" }, data: { status: "OPEN" } });
  });
  return { status: "APPLIED" };
}

/**
 * El líder da por terminada una expedición atascada (p. ej. nadie llegó a conectarse). Los intentos
 * se abandonan; si después llega un resultado del servidor de partida, se ignora.
 */
export async function cancelExpedition(userId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const me = await tx.partyMember.findUnique({ where: { userId }, include: { party: true } });
    if (!me || me.party.leaderUserId !== userId) throw new DomainError("NOT_LEADER", "Solo el líder puede terminar la expedición.");
    const expeditions = await tx.expedition.findMany({ where: { partyId: me.partyId, status: "ACTIVE" }, select: { id: true } });
    const ids = expeditions.map((e) => e.id);
    await tx.dungeonRun.updateMany({ where: { expeditionId: { in: ids }, status: "ACTIVE" }, data: { status: "ABANDONED", endedAt: new Date() } });
    await tx.expedition.updateMany({ where: { id: { in: ids }, status: "ACTIVE" }, data: { status: "ABANDONED", endedAt: new Date() } });
    await tx.party.updateMany({ where: { id: me.partyId, status: "IN_EXPEDITION" }, data: { status: "OPEN" } });
  });
}

/** Un jugador abandona su participación (sin recompensas). La sala lo marca al recibir "leave". */
export async function leaveExpedition(userId: string, expeditionId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.dungeonRun.updateMany({ where: { expeditionId, status: "ACTIVE", character: { userId } }, data: { status: "ABANDONED", endedAt: new Date() } });
    // Si ya no queda nadie, la expedición termina y el grupo vuelve a la sala de espera.
    if ((await tx.dungeonRun.count({ where: { expeditionId, status: "ACTIVE" } })) > 0) return;
    const closed = await tx.expedition.updateMany({ where: { id: expeditionId, status: "ACTIVE" }, data: { status: "ABANDONED", endedAt: new Date() } });
    if (closed.count === 1) {
      const { partyId } = await tx.expedition.findUniqueOrThrow({ where: { id: expeditionId }, select: { partyId: true } });
      await tx.party.updateMany({ where: { id: partyId, status: "IN_EXPEDITION" }, data: { status: "OPEN" } });
    }
  });
}
