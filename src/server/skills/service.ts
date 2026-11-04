import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getClassDefinition } from "@/game/classes/definitions";
import { getSkill, type SkillKind, skillsForClass } from "@/game/skills/definitions";
import { describeEffect } from "@/game/skills/describe";
import {
  buildLoadout,
  checkEquipSkill,
  checkLearn,
  describeEquipSkillError,
  describeLearnError,
  type EquippedSkill,
  LOADOUT_SLOTS,
  type LearnedSkills,
  type LoadoutSlot,
  resolveSkill,
  skillCooldown,
} from "@/game/skills/rules";
import type { ClassId } from "@/game/types";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { withSerializableRetry } from "@/server/transactions";

type DbClient = Prisma.TransactionClient | typeof db;

export interface SkillNodeView {
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
  rank: number;
  maxRank: number;
  requiredLevel: number;
  requires: { name: string; rank: number; met: boolean }[];
  resourceCost: number;
  /** Enfriamiento con el rango actual (o el del rango 1 si no se ha aprendido). */
  cooldown: number;
  nextCooldown: number | null;
  effects: string[];
  nextEffects: string[] | null;
  canLearn: boolean;
  /** Motivo por el que no se puede aprender o mejorar (null si se puede). */
  blocker: string | null;
  equippedSlot: LoadoutSlot | null;
}

export interface SkillTreeView {
  characterId: string;
  characterName: string;
  classId: ClassId;
  level: number;
  skillPoints: number;
  resourceName: string;
  branches: { id: string; name: string; description: string; skills: SkillNodeView[] }[];
  loadout: { slot: LoadoutSlot; skill: { id: string; name: string; rank: number } | null }[];
}

/** Rangos aprendidos y huecos guardados de un personaje. */
export async function loadSkillState(client: DbClient, characterId: string): Promise<{ learned: LearnedSkills; slots: { slot: LoadoutSlot; skillId: string }[] }> {
  const [skills, slots] = await Promise.all([
    client.characterSkill.findMany({ where: { characterId } }),
    client.characterLoadoutSlot.findMany({ where: { characterId } }),
  ]);
  const learned: Record<string, number> = {};
  for (const s of skills) learned[s.skillId] = s.rank;
  return { learned, slots: slots.map((s) => ({ slot: s.slot, skillId: s.skillId })) };
}

/** Equipamiento de habilidades válido (lo que recibirá la simulación). */
export async function loadLoadout(client: DbClient, characterId: string, classId: ClassId): Promise<(EquippedSkill | null)[]> {
  const { learned, slots } = await loadSkillState(client, characterId);
  return buildLoadout(classId, learned, slots);
}

/** Árbol de habilidades de un personaje propio. */
export async function getSkillTree(userId: string, characterId: string): Promise<SkillTreeView | null> {
  const character = await db.character.findFirst({ where: { id: characterId, userId } });
  if (!character) return null;
  const { learned, slots } = await loadSkillState(db, character.id);
  const loadout = buildLoadout(character.class, learned, slots);
  const def = getClassDefinition(character.class);
  const progress = { classId: character.class, level: character.level, skillPoints: character.skillPoints, learned };

  const node = (skillId: string): SkillNodeView => {
    const s = getSkill(skillId)!;
    const rank = learned[s.id] ?? 0;
    const now = resolveSkill(s.id, Math.max(1, rank), character.class)!;
    const next = rank > 0 && rank < s.maxRank ? resolveSkill(s.id, rank + 1, character.class) : null;
    const check = checkLearn(progress, s.id);
    const slotIndex = loadout.findIndex((e) => e?.skillId === s.id);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      kind: s.kind,
      rank,
      maxRank: s.maxRank,
      requiredLevel: s.requiredLevel,
      requires: s.requires.map((r) => ({ name: getSkill(r.skillId)?.name ?? r.skillId, rank: r.rank, met: (learned[r.skillId] ?? 0) >= r.rank })),
      resourceCost: s.resourceCost,
      cooldown: now.cooldown,
      nextCooldown: next ? skillCooldown(s, rank + 1) : null,
      effects: now.effects.map(describeEffect),
      nextEffects: next ? next.effects.map(describeEffect) : null,
      canLearn: check.ok,
      blocker: check.ok ? null : describeLearnError(check.error),
      equippedSlot: slotIndex >= 0 ? LOADOUT_SLOTS[slotIndex] : null,
    };
  };

  const skills = skillsForClass(character.class);
  return {
    characterId: character.id,
    characterName: character.name,
    classId: character.class,
    level: character.level,
    skillPoints: character.skillPoints,
    resourceName: def.resource.name,
    branches: def.skillBranches.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      // Básicas primero (por nivel), definitivas al final.
      skills: skills
        .filter((s) => s.branchId === b.id)
        .sort((a, c) => (a.kind === c.kind ? a.requiredLevel - c.requiredLevel : a.kind === "BASIC" ? -1 : 1))
        .map((s) => node(s.id)),
    })),
    loadout: LOADOUT_SLOTS.map((slot, i) => {
      const e = loadout[i];
      return { slot, skill: e ? { id: e.skillId, name: getSkill(e.skillId)!.name, rank: e.rank } : null };
    }),
  };
}

function mapConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) {
    throw new DomainError("CONFLICT", "El personaje cambió mientras tanto. Vuelve a intentarlo.");
  }
  throw error;
}

/**
 * Aprende una habilidad o sube un rango. Las reglas (clase, nivel, requisitos, tope de rango,
 * puntos) son las mismas que ve el cliente, pero se comprueban aquí dentro de una transacción
 * serializable con escrituras condicionales: dos peticiones a la vez no gastan el mismo punto
 * ni superan el rango máximo.
 */
export async function learnSkill(userId: string, input: { characterId: string; skillId: string }): Promise<{ rank: number }> {
  try {
    return await withSerializableRetry(() =>
      db.$transaction(
        async (tx) => {
          const character = await tx.character.findFirst({ where: { id: input.characterId, userId } });
          if (!character) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");
          const { learned } = await loadSkillState(tx, character.id);
          const check = checkLearn({ classId: character.class, level: character.level, skillPoints: character.skillPoints, learned }, input.skillId);
          if (!check.ok) throw new DomainError(check.error, describeLearnError(check.error));

          const spent = await tx.character.updateMany({
            where: { id: character.id, skillPoints: { gte: check.cost } },
            data: { skillPoints: { decrement: check.cost } },
          });
          if (spent.count !== 1) throw new DomainError("NOT_ENOUGH_POINTS", describeLearnError("NOT_ENOUGH_POINTS"));

          if (check.nextRank === 1) {
            await tx.characterSkill.create({ data: { characterId: character.id, skillId: input.skillId, rank: 1 } });
          } else {
            const raised = await tx.characterSkill.updateMany({
              where: { characterId: character.id, skillId: input.skillId, rank: check.nextRank - 1 },
              data: { rank: check.nextRank },
            });
            if (raised.count !== 1) throw new DomainError("CONFLICT", "El personaje cambió mientras tanto. Vuelve a intentarlo.");
          }
          return { rank: check.nextRank };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    return mapConflict(error);
  }
}

/**
 * Pone una habilidad en un hueco (o lo vacía con skillId = ""). Si la habilidad ya estaba en otro
 * hueco, se mueve. Las restricciones únicas de la tabla garantizan como máximo 4 y sin repetir.
 * Un intento ya empezado no cambia: la partida usa la instantánea tomada al entrar.
 */
export async function equipSkill(userId: string, input: { characterId: string; slot: LoadoutSlot; skillId: string }): Promise<void> {
  try {
    await withSerializableRetry(() =>
      db.$transaction(
        async (tx) => {
          const character = await tx.character.findFirst({ where: { id: input.characterId, userId }, select: { id: true, class: true } });
          if (!character) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");
          if (input.skillId === "") {
            await tx.characterLoadoutSlot.deleteMany({ where: { characterId: character.id, slot: input.slot } });
            return;
          }
          const { learned } = await loadSkillState(tx, character.id);
          const check = checkEquipSkill({ classId: character.class, learned }, input.skillId, input.slot);
          if (!check.ok) throw new DomainError(check.error, describeEquipSkillError(check.error));
          await tx.characterLoadoutSlot.deleteMany({ where: { characterId: character.id, OR: [{ slot: input.slot }, { skillId: input.skillId }] } });
          await tx.characterLoadoutSlot.create({ data: { characterId: character.id, slot: input.slot, skillId: input.skillId } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    mapConflict(error);
  }
}
