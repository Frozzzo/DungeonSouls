import "server-only";
import { type Character, Prisma } from "@/generated/prisma/client";
import { BALANCE } from "@/game/balance";
import { applyAllocation, describeAllocationError } from "@/game/stats/allocation";
import { type CharacterStats, computeCharacterStats } from "@/game/stats/compute";
import { xpToNextLevel } from "@/game/progression/experience";
import type { Attributes, ClassId } from "@/game/types";
import type { AllocateStatsInput, CreateCharacterInput } from "@/lib/validation/character";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";

/** Vista segura de un personaje: lo que la interfaz necesita, con estadísticas calculadas en el servidor. */
export interface CharacterView {
  id: string;
  name: string;
  classId: ClassId;
  level: number;
  experience: number;
  experienceToNext: number;
  statPoints: number;
  skillPoints: number;
  allocated: Attributes;
  stats: CharacterStats;
  createdAt: Date;
}

export function allocatedFrom(c: Character): Attributes {
  return {
    strength: c.allocatedStrength,
    dexterity: c.allocatedDexterity,
    intelligence: c.allocatedIntelligence,
    vitality: c.allocatedVitality,
  };
}

export function toCharacterView(c: Character): CharacterView {
  const allocated = allocatedFrom(c);
  return {
    id: c.id,
    name: c.name,
    classId: c.class,
    level: c.level,
    experience: c.experience,
    experienceToNext: xpToNextLevel(c.level),
    statPoints: c.statPoints,
    skillPoints: c.skillPoints,
    allocated,
    stats: computeCharacterStats({ classId: c.class, level: c.level, allocated }),
    createdAt: c.createdAt,
  };
}

export const nameKeyOf = (name: string) => name.trim().toLocaleLowerCase("es");

export async function listCharacters(userId: string): Promise<CharacterView[]> {
  const rows = await db.character.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.map(toCharacterView);
}

/** Devuelve el personaje solo si pertenece al usuario. Nunca revela personajes ajenos. */
export async function getOwnedCharacter(userId: string, characterId: string): Promise<CharacterView | null> {
  const row = await db.character.findFirst({ where: { id: characterId, userId } });
  return row ? toCharacterView(row) : null;
}

export async function createCharacter(userId: string, input: CreateCharacterInput): Promise<CharacterView> {
  try {
    // Transacción serializable: el recuento y la creación no pueden intercalarse con otra petición.
    const row = await db.$transaction(
      async (tx) => {
        const count = await tx.character.count({ where: { userId } });
        if (count >= BALANCE.characters.maxPerUser) {
          throw new DomainError(
            "CHARACTER_LIMIT",
            `Has alcanzado el máximo de ${BALANCE.characters.maxPerUser} personajes.`,
          );
        }
        return tx.character.create({
          data: {
            userId,
            name: input.name,
            nameKey: nameKeyOf(input.name),
            class: input.classId,
            statPoints: BALANCE.progression.startingStatPoints,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return toCharacterView(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new DomainError("NAME_TAKEN", "Ese nombre ya está en uso.");
      if (error.code === "P2034") throw new DomainError("CONFLICT", "Conflicto al crear el personaje. Vuelve a intentarlo.");
    }
    throw error;
  }
}

/**
 * Asigna puntos de atributo. La validación usa las mismas reglas que el cliente (src/game),
 * pero el resultado se recalcula aquí y la escritura es condicional: si otra petición gastó
 * los puntos entretanto, no se aplica nada (sin doble gasto).
 */
export async function allocateStats(userId: string, input: AllocateStatsInput): Promise<CharacterView> {
  const current = await db.character.findFirst({ where: { id: input.characterId, userId } });
  if (!current) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");

  const delta: Attributes = {
    strength: input.strength,
    dexterity: input.dexterity,
    intelligence: input.intelligence,
    vitality: input.vitality,
  };
  const result = applyAllocation(allocatedFrom(current), current.statPoints, delta);
  if (!result.ok) throw new DomainError("INVALID_ALLOCATION", describeAllocationError(result.error));

  const spent = current.statPoints - result.remainingPoints;
  const updated = await db.character.updateMany({
    where: { id: current.id, userId, statPoints: current.statPoints, updatedAt: current.updatedAt },
    data: {
      statPoints: { decrement: spent },
      allocatedStrength: { increment: delta.strength },
      allocatedDexterity: { increment: delta.dexterity },
      allocatedIntelligence: { increment: delta.intelligence },
      allocatedVitality: { increment: delta.vitality },
    },
  });
  if (updated.count !== 1) {
    throw new DomainError("CONFLICT", "El personaje cambió mientras asignabas puntos. Recarga y vuelve a intentarlo.");
  }
  const fresh = await db.character.findFirstOrThrow({ where: { id: current.id, userId } });
  return toCharacterView(fresh);
}

/** Borra un personaje propio. Exige escribir su nombre exacto, comprobado contra la base de datos. */
export async function deleteCharacter(userId: string, characterId: string, confirmName: string): Promise<void> {
  const current = await db.character.findFirst({ where: { id: characterId, userId }, select: { name: true } });
  if (!current) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");
  if (confirmName.trim() !== current.name) {
    throw new DomainError("CONFIRMATION_MISMATCH", "Escribe el nombre exacto del personaje para confirmar.");
  }
  const deleted = await db.character.deleteMany({ where: { id: characterId, userId } });
  if (deleted.count !== 1) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");
}
