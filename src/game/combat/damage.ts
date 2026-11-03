import { BALANCE } from "../balance";

/**
 * Fórmulas de daño y mitigación compartidas por jugadores, enemigos y jefes.
 * Todas devuelven enteros para que la vida se mantenga en enteros dentro de la simulación.
 */

/** Reducción de daño por armadura para un enemigo de un nivel dado (misma curva que los personajes). */
export function armorReduction(armor: number, level: number): number {
  const dr = BALANCE.derived.damageReduction;
  const value = armor / (armor + dr.constant + level * dr.perLevel);
  return Math.min(dr.cap, Math.max(0, value));
}

export interface DamageRoll {
  amount: number;
  crit: boolean;
}

/**
 * Daño saliente: base × multiplicador × variación (±10 %), con posible crítico.
 * `roll1` y `roll2` son números en [0,1) del generador determinista.
 */
export function rollOutgoingDamage(
  base: number,
  multiplier: number,
  critChance: number,
  critMultiplier: number,
  roll1: number,
  roll2: number,
): DamageRoll {
  const { variance } = BALANCE.combat;
  const spread = 1 - variance + roll1 * variance * 2;
  const crit = roll2 < critChance;
  const raw = base * multiplier * spread * (crit ? critMultiplier : 1);
  return { amount: Math.max(1, Math.round(raw)), crit };
}

/**
 * Daño recibido tras mitigación. `reductions` son fracciones independientes (armadura,
 * bloqueo frontal, Bastión...) que se aplican multiplicativamente, con techo global.
 */
export function mitigate(amount: number, reductions: readonly number[]): number {
  let remaining = 1;
  for (const r of reductions) remaining *= 1 - Math.min(1, Math.max(0, r));
  remaining = Math.max(remaining, 1 - BALANCE.combat.maxTotalMitigation);
  return Math.max(1, Math.round(amount * remaining));
}
