import type { ClassId } from "../types";

/**
 * Kit de combate fijo de cada clase: ataque básico y reglas del recurso. Las habilidades
 * equipables (3 básicas + 1 definitiva) viven en src/game/skills. Tiempos en segundos,
 * distancias en casillas.
 */
export type DamageType = "PHYSICAL" | "MAGIC";

export type BasicAttack =
  | {
      kind: "MELEE_ARC";
      name: string;
      range: number;
      /** Coseno de la semiapertura (literal). */
      cosHalfAngle: number;
      multiplier: number;
      damageType: DamageType;
      windup: number;
      recovery: number;
      cooldown: number;
    }
  | {
      kind: "PROJECTILE";
      name: string;
      range: number;
      speed: number;
      radius: number;
      multiplier: number;
      damageType: DamageType;
      windup: number;
      recovery: number;
      cooldown: number;
    };

export interface ResourceRules {
  /** Recurso al empezar el piso: lleno o vacío. */
  start: "FULL" | "EMPTY";
  regenPerSecond: number;
  /** Recurso ganado por cada ataque que impacta (Furia). */
  gainOnHit: number;
  /** Recurso ganado al recibir daño (Furia). */
  gainOnHurt: number;
}

export interface CombatKit {
  basic: BasicAttack;
  resource: ResourceRules;
}

export const COMBAT_KITS: Record<ClassId, CombatKit> = {
  TANK: {
    basic: {
      kind: "MELEE_ARC",
      name: "Golpe de escudo",
      range: 1.7,
      cosHalfAngle: 0.5,
      multiplier: 1,
      damageType: "PHYSICAL",
      windup: 0.15,
      recovery: 0.3,
      cooldown: 0.15,
    },
    resource: { start: "EMPTY", regenPerSecond: 0, gainOnHit: 10, gainOnHurt: 6 },
  },
  DPS: {
    basic: {
      kind: "MELEE_ARC",
      name: "Tajo doble",
      range: 1.45,
      cosHalfAngle: 0.6427876096865394,
      multiplier: 0.8,
      damageType: "PHYSICAL",
      windup: 0.1,
      recovery: 0.2,
      cooldown: 0.1,
    },
    resource: { start: "FULL", regenPerSecond: 10, gainOnHit: 0, gainOnHurt: 0 },
  },
  HEALER: {
    basic: {
      kind: "PROJECTILE",
      name: "Chispa sagrada",
      range: 8.5,
      speed: 11,
      radius: 0.25,
      multiplier: 1,
      damageType: "MAGIC",
      windup: 0.15,
      recovery: 0.3,
      cooldown: 0.15,
    },
    resource: { start: "FULL", regenPerSecond: 2.5, gainOnHit: 0, gainOnHurt: 0 },
  },
};

export function getCombatKit(classId: ClassId): CombatKit {
  return COMBAT_KITS[classId];
}
