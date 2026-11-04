import "server-only";
import { randomInt } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { BALANCE } from "@/game/balance";
import { MAX_FLOOR } from "@/game/dungeon/floors";
import type { ClassId } from "@/game/types";
import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH } from "@/lib/validation/expedition";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { withSerializableRetry } from "@/server/transactions";

const MAX_MEMBERS = BALANCE.multiplayer.maxPartySize;

export interface PartyMemberView {
  userId: string;
  username: string;
  characterId: string;
  characterName: string;
  classId: ClassId;
  level: number;
  ready: boolean;
  isLeader: boolean;
}

export interface PartyView {
  id: string;
  code: string;
  status: "OPEN" | "IN_EXPEDITION";
  isLeader: boolean;
  myCharacterId: string;
  members: PartyMemberView[];
  /** Pisos que todos los miembros tienen desbloqueados. */
  floors: number[];
  /** Expedición en curso del grupo y si el usuario sigue participando en ella. */
  activeExpedition: { id: string; floor: number; participating: boolean } | null;
  maxMembers: number;
}

export function generatePartyCode(): string {
  let code = "";
  for (let i = 0; i < PARTY_CODE_LENGTH; i++) code += PARTY_CODE_ALPHABET[randomInt(PARTY_CODE_ALPHABET.length)];
  return code;
}

/** Pisos disponibles para el grupo: hasta el siguiente al más profundo que TODOS han completado. */
export function partyFloors(highestCleared: readonly number[]): number[] {
  const max = Math.min(MAX_FLOOR, Math.min(...highestCleared) + 1);
  return Array.from({ length: Math.max(1, max) }, (_, i) => i + 1);
}

function isUnique(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withSerializableRetry(() => db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new DomainError("CONFLICT", "Conflicto con otra acción del grupo. Vuelve a intentarlo.");
    }
    throw error;
  });
}

export async function getMyParty(userId: string): Promise<PartyView | null> {
  const me = await db.partyMember.findUnique({ where: { userId }, select: { partyId: true, characterId: true } });
  if (!me) return null;
  const party = await db.party.findUnique({
    where: { id: me.partyId },
    include: {
      members: { orderBy: { joinedAt: "asc" }, include: { user: { select: { username: true } }, character: true } },
      expeditions: { where: { status: "ACTIVE" }, orderBy: { startedAt: "desc" }, take: 1, include: { runs: { select: { characterId: true, status: true } } } },
    },
  });
  if (!party || party.status === "CLOSED") return null;
  const expedition = party.expeditions[0] ?? null;
  return {
    id: party.id,
    code: party.code,
    status: party.status,
    isLeader: party.leaderUserId === userId,
    myCharacterId: me.characterId,
    members: party.members.map((m) => ({
      userId: m.userId,
      username: m.user.username,
      characterId: m.characterId,
      characterName: m.character.name,
      classId: m.character.class,
      level: m.character.level,
      ready: m.ready,
      isLeader: m.userId === party.leaderUserId,
    })),
    floors: partyFloors(party.members.map((m) => m.character.highestFloorCleared)),
    activeExpedition: expedition
      ? { id: expedition.id, floor: expedition.floor, participating: expedition.runs.some((r) => r.characterId === me.characterId && r.status === "ACTIVE") }
      : null,
    maxMembers: MAX_MEMBERS,
  };
}

async function requireOwnCharacter(tx: Prisma.TransactionClient, userId: string, characterId: string) {
  const character = await tx.character.findFirst({ where: { id: characterId, userId } });
  if (!character) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");
  return character;
}

/** Crea un grupo con el usuario como líder. Un usuario solo puede estar en un grupo. */
export async function createParty(userId: string, input: { characterId: string }): Promise<{ code: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await serializable(async (tx) => {
        await requireOwnCharacter(tx, userId, input.characterId);
        if (await tx.partyMember.findUnique({ where: { userId } })) throw new DomainError("ALREADY_IN_PARTY", "Ya estás en un grupo. Sal de él primero.");
        const party = await tx.party.create({ data: { code: generatePartyCode(), leaderUserId: userId } });
        await tx.partyMember.create({ data: { partyId: party.id, userId, characterId: input.characterId } });
        return { code: party.code };
      });
    } catch (error) {
      // Código repetido (muy improbable): se genera otro. Usuario ya en un grupo: se informa.
      if (!isUnique(error)) throw error;
      const target = String((error as Prisma.PrismaClientKnownRequestError).meta?.target ?? "");
      if (!target.includes("code")) throw new DomainError("ALREADY_IN_PARTY", "Ya estás en un grupo. Sal de él primero.");
    }
  }
  throw new DomainError("CONFLICT", "No se pudo crear el grupo. Vuelve a intentarlo.");
}

/** Se une a un grupo abierto con un personaje propio. Máximo 4 miembros (comprobado en la transacción). */
export async function joinParty(userId: string, input: { code: string; characterId: string }): Promise<void> {
  try {
    await serializable(async (tx) => {
      await requireOwnCharacter(tx, userId, input.characterId);
      if (await tx.partyMember.findUnique({ where: { userId } })) throw new DomainError("ALREADY_IN_PARTY", "Ya estás en un grupo. Sal de él primero.");
      const party = await tx.party.findUnique({ where: { code: input.code }, include: { _count: { select: { members: true } } } });
      if (!party || party.status === "CLOSED") throw new DomainError("NOT_FOUND", "No existe ningún grupo con ese código.");
      if (party.status !== "OPEN") throw new DomainError("IN_EXPEDITION", "Ese grupo está en mitad de una expedición.");
      if (party._count.members >= MAX_MEMBERS) throw new DomainError("PARTY_FULL", `El grupo está lleno (máximo ${MAX_MEMBERS}).`);
      await tx.partyMember.create({ data: { partyId: party.id, userId, characterId: input.characterId } });
    });
  } catch (error) {
    if (isUnique(error)) throw new DomainError("ALREADY_IN_PARTY", "Ya estás en un grupo (o ese personaje ya está en uno).");
    throw error;
  }
}

/**
 * Sale del grupo. Si estaba en una expedición, su intento se abandona (sin recompensas). Si era el
 * líder, el liderazgo pasa al miembro más antiguo; si no queda nadie, el grupo se cierra.
 */
export async function leaveParty(userId: string): Promise<void> {
  await serializable(async (tx) => {
    const me = await tx.partyMember.findUnique({ where: { userId } });
    if (!me) return;
    await tx.dungeonRun.updateMany({
      where: { characterId: me.characterId, status: "ACTIVE", expedition: { partyId: me.partyId, status: "ACTIVE" } },
      data: { status: "ABANDONED", endedAt: new Date() },
    });
    await tx.partyMember.delete({ where: { id: me.id } });
    const party = await tx.party.findUniqueOrThrow({ where: { id: me.partyId } });
    const next = await tx.partyMember.findFirst({ where: { partyId: me.partyId }, orderBy: { joinedAt: "asc" } });
    if (!next) {
      await tx.party.update({ where: { id: party.id }, data: { status: "CLOSED" } });
      await tx.expedition.updateMany({ where: { partyId: party.id, status: "ACTIVE" }, data: { status: "ABANDONED", endedAt: new Date() } });
      await tx.dungeonRun.updateMany({ where: { status: "ACTIVE", expedition: { partyId: party.id } }, data: { status: "ABANDONED", endedAt: new Date() } });
    } else if (party.leaderUserId === userId) {
      await tx.party.update({ where: { id: party.id }, data: { leaderUserId: next.userId } });
    }
  });
}

export async function setReady(userId: string, ready: boolean): Promise<void> {
  const updated = await db.partyMember.updateMany({ where: { userId, party: { status: "OPEN" } }, data: { ready } });
  if (updated.count !== 1) throw new DomainError("NOT_IN_PARTY", "No estás en un grupo abierto.");
}

/** El líder expulsa a un miembro (solo con el grupo abierto). */
export async function kickMember(userId: string, targetUserId: string): Promise<void> {
  if (userId === targetUserId) throw new DomainError("INVALID", "Para irte, usa «Salir del grupo».");
  await serializable(async (tx) => {
    const me = await tx.partyMember.findUnique({ where: { userId }, include: { party: true } });
    if (!me || me.party.leaderUserId !== userId) throw new DomainError("NOT_LEADER", "Solo el líder puede expulsar.");
    if (me.party.status !== "OPEN") throw new DomainError("IN_EXPEDITION", "No se puede expulsar durante una expedición.");
    const removed = await tx.partyMember.deleteMany({ where: { userId: targetUserId, partyId: me.partyId } });
    if (removed.count !== 1) throw new DomainError("NOT_FOUND", "Ese jugador no está en el grupo.");
  });
}
