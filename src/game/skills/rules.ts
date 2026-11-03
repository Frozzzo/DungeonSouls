import type { ClassId } from "../types";
import { getSkill, type SkillDefinition, type SkillEffect, type SkillKind } from "./definitions";

/** Huecos de habilidad: 3 básicas + 1 definitiva. El ataque básico no ocupa hueco. */
export const LOADOUT_SLOTS = ["BASIC_1", "BASIC_2", "BASIC_3", "ULTIMATE"] as const;
export type LoadoutSlot = (typeof LOADOUT_SLOTS)[number];
export const MAX_EQUIPPED_SKILLS = LOADOUT_SLOTS.length;

export const slotKind = (slot: LoadoutSlot): SkillKind => (slot === "ULTIMATE" ? "ULTIMATE" : "BASIC");
export const slotIndex = (slot: LoadoutSlot): number => LOADOUT_SLOTS.indexOf(slot);

/** Rangos aprendidos por id de habilidad. */
export type LearnedSkills = Readonly<Record<string, number>>;

/** Habilidad equipada en un hueco (lo que recibe la simulación). */
export interface EquippedSkill {
  skillId: string;
  rank: number;
}
/** Una posición por hueco, en el orden de LOADOUT_SLOTS. */
export type Loadout = readonly (EquippedSkill | null)[];

/** Valores de una habilidad para un rango concreto. */
export interface ResolvedSkill {
  id: string;
  name: string;
  kind: SkillKind;
  rank: number;
  resourceCost: number;
  /** Segundos; siempre ≥ minCooldown > 0. */
  cooldown: number;
  effects: SkillEffect[];
}

const clampRank = (def: SkillDefinition, rank: number) => Math.max(1, Math.min(def.maxRank, Math.floor(rank)));

/** Enfriamiento a un rango: baja con los rangos, pero nunca de `minCooldown` (y nunca llega a 0). */
export function skillCooldown(def: SkillDefinition, rank: number): number {
  const r = clampRank(def, rank);
  const value = def.cooldown - def.cooldownPerRank * (r - 1);
  return Math.max(def.minCooldown, 0.05, Math.round(value * 100) / 100);
}

/** Factor de magnitud de los efectos a un rango (1 en el rango 1). */
export function rankFactor(def: SkillDefinition, rank: number): number {
  return 1 + def.rankScaling * (clampRank(def, rank) - 1);
}

function scaleEffect(effect: SkillEffect, f: number): SkillEffect {
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  switch (effect.kind) {
    case "FORTIFY":
      return { ...effect, reduction: Math.min(0.85, r4(effect.reduction * f)) };
    case "NOVA":
    case "CONE":
    case "DASH":
    case "PROJECTILE":
      return { ...effect, multiplier: r4(effect.multiplier * f) };
    case "HEAL":
    case "BARRIER":
    case "REGEN":
      return { ...effect, base: r4(effect.base * f), magicScaling: r4(effect.magicScaling * f), maxHpRatio: r4(effect.maxHpRatio * f) };
    case "EMPOWER":
      return { ...effect, bonus: r4(effect.bonus * f) };
  }
}

/** Resuelve una habilidad para la clase indicada. Devuelve null si no existe o es de otra clase. */
export function resolveSkill(skillId: string, rank: number, classId: ClassId): ResolvedSkill | null {
  const def = getSkill(skillId);
  if (!def || def.classId !== classId || rank < 1) return null;
  const r = clampRank(def, rank);
  const f = rankFactor(def, r);
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    rank: r,
    resourceCost: def.resourceCost,
    cooldown: skillCooldown(def, r),
    effects: def.effects.map((e) => scaleEffect(e, f)),
  };
}

export type LearnError = "UNKNOWN_SKILL" | "WRONG_CLASS" | "LEVEL_TOO_LOW" | "MISSING_REQUIREMENT" | "MAX_RANK" | "NOT_ENOUGH_POINTS";

export type LearnCheck = { ok: true; nextRank: number; cost: number } | { ok: false; error: LearnError };

/** ¿Puede el personaje aprender (o subir un rango) esta habilidad? Reglas compartidas por cliente y servidor. */
export function checkLearn(input: { classId: ClassId; level: number; skillPoints: number; learned: LearnedSkills }, skillId: string): LearnCheck {
  const def = getSkill(skillId);
  if (!def) return { ok: false, error: "UNKNOWN_SKILL" };
  if (def.classId !== input.classId) return { ok: false, error: "WRONG_CLASS" };
  const current = input.learned[skillId] ?? 0;
  if (current >= def.maxRank) return { ok: false, error: "MAX_RANK" };
  if (input.level < def.requiredLevel) return { ok: false, error: "LEVEL_TOO_LOW" };
  if (def.requires.some((req) => (input.learned[req.skillId] ?? 0) < req.rank)) return { ok: false, error: "MISSING_REQUIREMENT" };
  if (input.skillPoints < def.pointCost) return { ok: false, error: "NOT_ENOUGH_POINTS" };
  return { ok: true, nextRank: current + 1, cost: def.pointCost };
}

export function describeLearnError(error: LearnError): string {
  switch (error) {
    case "UNKNOWN_SKILL":
      return "Esa habilidad no existe.";
    case "WRONG_CLASS":
      return "Esa habilidad no pertenece a tu clase.";
    case "LEVEL_TOO_LOW":
      return "Tu nivel todavía es demasiado bajo para esa habilidad.";
    case "MISSING_REQUIREMENT":
      return "Antes debes aprender las habilidades previas.";
    case "MAX_RANK":
      return "Esa habilidad ya está en su rango máximo.";
    case "NOT_ENOUGH_POINTS":
      return "No tienes puntos de habilidad suficientes.";
  }
}

export type EquipSkillError = "UNKNOWN_SKILL" | "WRONG_CLASS" | "NOT_LEARNED" | "WRONG_SLOT";

/** ¿Se puede poner esta habilidad en este hueco? */
export function checkEquipSkill(input: { classId: ClassId; learned: LearnedSkills }, skillId: string, slot: LoadoutSlot): { ok: true } | { ok: false; error: EquipSkillError } {
  const def = getSkill(skillId);
  if (!def) return { ok: false, error: "UNKNOWN_SKILL" };
  if (def.classId !== input.classId) return { ok: false, error: "WRONG_CLASS" };
  if ((input.learned[skillId] ?? 0) < 1) return { ok: false, error: "NOT_LEARNED" };
  if (def.kind !== slotKind(slot)) return { ok: false, error: "WRONG_SLOT" };
  return { ok: true };
}

export function describeEquipSkillError(error: EquipSkillError): string {
  switch (error) {
    case "UNKNOWN_SKILL":
      return "Esa habilidad no existe.";
    case "WRONG_CLASS":
      return "Esa habilidad no pertenece a tu clase.";
    case "NOT_LEARNED":
      return "Primero tienes que aprender esa habilidad.";
    case "WRONG_SLOT":
      return "Las definitivas van en su hueco propio y las básicas en los otros tres.";
  }
}

/**
 * Construye el equipamiento de habilidades que recibe la simulación a partir de lo guardado.
 * Descarta lo que no sea válido (otra clase, sin aprender, hueco equivocado o repetido), de modo
 * que nunca hay más de 3 básicas + 1 definitiva.
 */
export function buildLoadout(classId: ClassId, learned: LearnedSkills, slots: readonly { slot: LoadoutSlot; skillId: string }[]): (EquippedSkill | null)[] {
  const out: (EquippedSkill | null)[] = LOADOUT_SLOTS.map(() => null);
  const used = new Set<string>();
  for (const { slot, skillId } of slots) {
    const i = slotIndex(slot);
    if (i < 0 || out[i] || used.has(skillId)) continue;
    if (!checkEquipSkill({ classId, learned }, skillId, slot).ok) continue;
    out[i] = { skillId, rank: learned[skillId] };
    used.add(skillId);
  }
  return out;
}
