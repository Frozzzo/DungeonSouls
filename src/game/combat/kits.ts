import type { ClassId } from "../types";

/**
 * Kit de combate de cada clase en la Fase 2: ataque básico y una habilidad característica.
 * El árbol de habilidades completo (3 básicas + 1 ultimate equipables) llega en la Fase 3 y
 * reutilizará estas mismas estructuras. Tiempos en segundos, distancias en casillas.
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

export type AbilityEffect =
  | { kind: "FORTIFY"; reduction: number; duration: number }
  | { kind: "WHIRLWIND"; radius: number; multiplier: number; damageType: DamageType }
  | { kind: "HEAL"; base: number; magicScaling: number };

export interface SignatureAbility {
  id: string;
  name: string;
  description: string;
  cost: number;
  cooldown: number;
  effect: AbilityEffect;
}

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
  ability: SignatureAbility;
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
    ability: {
      id: "tank-bulwark",
      name: "Bastión",
      description: "Reduce a la mitad el daño recibido durante 4 s. Cuesta Furia, que se gana golpeando y recibiendo golpes.",
      cost: 40,
      cooldown: 12,
      effect: { kind: "FORTIFY", reduction: 0.5, duration: 4 },
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
    ability: {
      id: "dps-whirlwind",
      name: "Torbellino",
      description: "Gira con las hojas desplegadas e inflige daño elevado a todos los enemigos cercanos.",
      cost: 40,
      cooldown: 5,
      effect: { kind: "WHIRLWIND", radius: 2.3, multiplier: 1.7, damageType: "PHYSICAL" },
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
    ability: {
      id: "healer-mending-light",
      name: "Luz restauradora",
      description: "Restaura vida según tu daño mágico y tu curación realizada. Consume maná: adminístralo.",
      cost: 35,
      cooldown: 7,
      effect: { kind: "HEAL", base: 25, magicScaling: 1.5 },
    },
    resource: { start: "FULL", regenPerSecond: 2.5, gainOnHit: 0, gainOnHurt: 0 },
  },
};

export function getCombatKit(classId: ClassId): CombatKit {
  return COMBAT_KITS[classId];
}
